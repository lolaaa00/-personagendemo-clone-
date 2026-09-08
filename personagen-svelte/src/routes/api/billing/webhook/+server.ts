import { json, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyWebhookSignature, stripeWebhookConfigured, validatePaidSession, refundClawback } from '$lib/server/stripe';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { packById } from '$lib/billing-packs';
import { logSystemActivity } from '$lib/server/activity';
import { loadPlanCatalog, planFromCatalog, includedResetClawback, mapStripeStatus, isPaidPlan } from '$lib/server/plans';

/**
 * POST /api/billing/webhook — Stripe events → wallet + subscriptions.
 *
 *   checkout.session.completed / async_payment_succeeded
 *     mode=payment       → credit_apply(+pack credits, 'purchase')   keyed by SESSION id
 *     mode=subscription  → subscriptions row (plan, customer, subscription id)
 *   invoice.paid         → included-credit RESET of the previous period, then
 *                          grant for the new one; both keyed by INVOICE id
 *   customer.subscription.updated / deleted → status + period end
 *   charge.refunded      → credit_apply(−credits, 'refund') keyed by EVENT id,
 *                          cumulative-safe
 *
 * Idempotent by construction: every wallet write carries a stripe_event_id
 * with a unique partial index on credit_ledger — a replay is a 23505 and a
 * 200. The raw body is verified against STRIPE_WEBHOOK_SECRET before anything
 * is parsed; without the secret the route refuses everything. Pack and plan
 * come from metadata OUR server wrote; amounts are a sanity check that
 * tolerates promotion codes and Adaptive Pricing (validatePaidSession).
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!stripeWebhookConfigured()) return json({ error: 'webhook not configured' }, { status: 503 });
	const raw = await request.text();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stripe webhook payloads are dynamic by design; every field is validated before use
	let event: any;
	try {
		event = verifyWebhookSignature(raw, request.headers.get('stripe-signature'), (env.STRIPE_WEBHOOK_SECRET ?? '').trim());
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 400 });
	}

	const svc = getServiceSupabase();
	const type = String(event?.type ?? '');
	const obj = event?.data?.object ?? {};
	const dup = (error: { code?: string; message?: string } | null) => error?.code === '23505' || /duplicate key/i.test(error?.message ?? '');
	const apply = (args: Record<string, unknown>) =>
		svc.rpc('credit_apply', { p_actor: null, p_event: null, p_post: null, p_agent: null, p_waived: 0, p_allow_negative: false, ...args });

	// ── one-time packs ─────────────────────────────────────────────────────
	if ((type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') && obj.mode !== 'subscription') {
		const userId = obj.metadata?.user_id ?? obj.client_reference_id;
		const pack = packById(obj.metadata?.pack_id);
		if (!userId || !pack) return json({ error: 'session lacks user/pack metadata' }, { status: 400 });
		const v = validatePaidSession(obj, pack);
		if (!v.ok) {
			if (v.reason === 'not paid') return text('ignored: not paid');
			console.error('[billing] session rejected', { session: obj.id, reason: v.reason });
			return json({ error: v.reason }, { status: 400 });
		}
		const { error } = await apply({
			p_user: userId,
			p_delta: pack.credits,
			p_kind: 'purchase',
			p_note: `Stripe ${pack.label} pack (${(pack.usdCents / 100).toFixed(2)} USD, session ${obj.id})`,
			p_stripe_event: String(obj.id)
		});
		if (error) {
			if (dup(error)) return text('ok: already applied');
			console.error('[billing] credit_apply failed', error.message);
			return json({ error: 'wallet write failed' }, { status: 500 });
		}
		if (obj.customer) await svc.from('credit_accounts').update({ stripe_customer_id: String(obj.customer) }).eq('user_id', userId).is('stripe_customer_id', null);
		logSystemActivity({ userId, action: 'billing.purchase.completed', outcome: 'ok', creditsDelta: pack.credits, meta: { pack: pack.id, usd_cents: pack.usdCents, session: String(obj.id) } });
		return text('ok');
	}

	// ── subscription started ───────────────────────────────────────────────
	if (type === 'checkout.session.completed' && obj.mode === 'subscription') {
		const userId = obj.metadata?.user_id ?? obj.client_reference_id;
		const plan = String(obj.metadata?.plan ?? '').toLowerCase();
		if (!userId || !isPaidPlan(plan)) return json({ error: 'session lacks user/plan metadata' }, { status: 400 });
		const row = planFromCatalog(await loadPlanCatalog(svc), plan);
		const { error } = await svc.from('subscriptions').upsert(
			{
				user_id: userId,
				plan,
				status: 'active',
				stripe_customer_id: obj.customer ? String(obj.customer) : null,
				stripe_subscription_id: obj.subscription ? String(obj.subscription) : null,
				included_credits: row?.included_credits ?? 0,
				persona_limit: row?.persona_limit ?? null,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);
		if (error) {
			console.error('[billing] subscription upsert failed', error.message);
			return json({ error: 'subscription write failed' }, { status: 500 });
		}
		if (obj.customer) await svc.from('credit_accounts').update({ stripe_customer_id: String(obj.customer) }).eq('user_id', userId).is('stripe_customer_id', null);
		logSystemActivity({ userId, action: 'billing.subscription.started', outcome: 'ok', meta: { plan, session: String(obj.id) } });
		return text('ok');
	}

	// ── each paid invoice: reset last period's included credit, grant this period's ──
	if (type === 'invoice.paid') {
		const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id ?? null;
		if (!subId) return text('ignored: invoice without subscription');
		let { data: sub } = await svc.from('subscriptions').select('user_id, plan, status, included_credits, last_included_grant_credits').eq('stripe_subscription_id', subId).maybeSingle();
		if (!sub) {
			// The session.completed event may not have arrived yet — recover from the subscription metadata.
			const meta = obj.subscription_details?.metadata ?? obj.lines?.data?.[0]?.metadata ?? {};
			if (meta.user_id && isPaidPlan(String(meta.plan ?? '').toLowerCase())) {
				const plan = String(meta.plan).toLowerCase();
				const row = planFromCatalog(await loadPlanCatalog(svc), plan);
				await svc.from('subscriptions').upsert(
					{ user_id: meta.user_id, plan, status: 'active', stripe_subscription_id: subId, stripe_customer_id: obj.customer ? String(obj.customer) : null, included_credits: row?.included_credits ?? 0, persona_limit: row?.persona_limit ?? null, updated_at: new Date().toISOString() },
					{ onConflict: 'user_id' }
				);
				({ data: sub } = await svc.from('subscriptions').select('user_id, plan, status, included_credits, last_included_grant_credits').eq('stripe_subscription_id', subId).maybeSingle());
			}
		}
		if (!sub) return json({ error: 'unknown subscription' }, { status: 400 });
		const catalog = planFromCatalog(await loadPlanCatalog(svc), String(sub.plan));
		const included = Number(catalog?.included_credits ?? sub.included_credits ?? 0);
		const period = obj.lines?.data?.[0]?.period ?? {};
		const periodStart = period.start ? new Date(period.start * 1000).toISOString() : new Date().toISOString();
		const periodEnd = period.end ? new Date(period.end * 1000).toISOString() : null;

		// 1. reset: take back the unspent remainder of the previous included grant
		const { data: wallet } = await svc.from('credit_accounts').select('balance_credits').eq('user_id', sub.user_id).maybeSingle();
		const back = includedResetClawback(Number(sub.last_included_grant_credits ?? 0), Number(wallet?.balance_credits ?? 0));
		if (back > 0) {
			const { error } = await apply({ p_user: sub.user_id, p_delta: -back, p_kind: 'adjustment', p_note: `${sub.plan} plan: unspent included credit reset at renewal (invoice ${obj.id})`, p_stripe_event: `inv:${obj.id}:reset` });
			if (error && !dup(error)) {
				console.error('[billing] reset failed', error.message);
				return json({ error: 'wallet write failed' }, { status: 500 });
			}
		}
		// 2. grant this period's included credit
		if (included > 0) {
			const { error } = await apply({ p_user: sub.user_id, p_delta: included, p_kind: 'grant', p_note: `${sub.plan} plan: included media credit for the period starting ${periodStart.slice(0, 10)} (invoice ${obj.id})`, p_stripe_event: `inv:${obj.id}` });
			if (error && !dup(error)) {
				console.error('[billing] included grant failed', error.message);
				return json({ error: 'wallet write failed' }, { status: 500 });
			}
		}
		await svc.from('subscriptions').update({ status: 'active', last_included_grant_credits: included, included_credits: included, current_period_start: periodStart, current_period_end: periodEnd, updated_at: new Date().toISOString() }).eq('stripe_subscription_id', subId);
		logSystemActivity({ userId: sub.user_id, action: 'billing.subscription.renewed', outcome: 'ok', creditsDelta: included - back, meta: { plan: sub.plan, invoice: String(obj.id), reset: back, granted: included } });
		return text('ok');
	}

	// ── status changes ─────────────────────────────────────────────────────
	if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
		const status = type === 'customer.subscription.deleted' ? 'canceled' : mapStripeStatus(obj.status);
		const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
		if (obj.current_period_end) patch.current_period_end = new Date(obj.current_period_end * 1000).toISOString();
		const { data: rows } = await svc.from('subscriptions').update(patch).eq('stripe_subscription_id', String(obj.id)).select('user_id, plan');
		const row = rows?.[0];
		if (row) logSystemActivity({ userId: row.user_id, action: status === 'canceled' ? 'billing.subscription.ended' : 'billing.subscription.renewed', outcome: status === 'past_due' ? 'error' : 'ok', meta: { plan: row.plan, status, stripe_event: String(event.id) } });
		return text(row ? 'ok' : 'ignored: unknown subscription');
	}

	// ── refunds ────────────────────────────────────────────────────────────
	if (type === 'charge.refunded') {
		const userId = obj.metadata?.user_id;
		const credits = Number(obj.metadata?.credits);
		const amount = Number(obj.amount);
		const refunded = Number(obj.amount_refunded);
		if (!userId || !Number.isFinite(credits) || credits <= 0 || !amount || !refunded) return text('ignored: no wallet mapping');
		const { data: prior } = await svc.from('credit_ledger').select('delta').eq('user_id', userId).eq('kind', 'refund').like('note', `%charge ${obj.id}%`);
		const alreadyBack = (prior ?? []).reduce((s: number, r: { delta?: number | string }) => s + Math.abs(Number(r.delta) || 0), 0);
		const back = refundClawback(credits, amount, refunded, alreadyBack);
		if (back <= 0) return text('ok: nothing further to claw back');
		const { error } = await apply({
			p_user: userId,
			p_delta: -back,
			p_kind: 'refund',
			p_note: `Stripe refund ${(refunded / 100).toFixed(2)} of ${(amount / 100).toFixed(2)} USD (charge ${obj.id})`,
			p_stripe_event: String(event.id),
			p_allow_negative: true
		});
		if (error) {
			if (dup(error)) return text('ok: already applied');
			console.error('[billing] refund apply failed', error.message);
			return json({ error: 'wallet write failed' }, { status: 500 });
		}
		logSystemActivity({ userId, action: 'billing.purchase.completed', outcome: 'ok', creditsDelta: -back, meta: { refund: true, charge: String(obj.id), stripe_event: String(event.id) } });
		return text('ok');
	}

	return text(`ignored: ${type}`);
};
