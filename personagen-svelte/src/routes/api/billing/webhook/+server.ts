import { json, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyWebhookSignature, stripeWebhookConfigured } from '$lib/server/stripe';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { packById } from '$lib/billing-packs';
import { logSystemActivity } from '$lib/server/activity';

/**
 * POST /api/billing/webhook — Stripe events → wallet.
 *
 *   checkout.session.completed / async_payment_succeeded  → credit_apply(+credits, 'purchase')
 *   charge.refunded                                        → credit_apply(−credits, 'refund')
 *
 * Idempotent by construction: every write carries stripe_event_id, which has
 * a unique partial index on credit_ledger, so a replayed event is a 23505
 * and a 200 — never a second credit. The raw body is verified against
 * STRIPE_WEBHOOK_SECRET before anything is parsed; without the secret the
 * route refuses everything (an unsigned webhook could mint credits).
 *
 * Amounts are re-validated against the pack table, not trusted from metadata:
 * a session must have paid exactly the pack price to deliver the pack credits.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!stripeWebhookConfigured()) return json({ error: 'webhook not configured' }, { status: 503 });
	const raw = await request.text();
	let event: any;
	try {
		event = verifyWebhookSignature(raw, request.headers.get('stripe-signature'), (env.STRIPE_WEBHOOK_SECRET ?? '').trim());
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 400 });
	}

	const svc = getServiceSupabase();
	const type = String(event?.type ?? '');
	const obj = event?.data?.object ?? {};

	if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
		if (obj.payment_status !== 'paid') return text('ignored: not paid');
		const userId = obj.metadata?.user_id ?? obj.client_reference_id;
		const pack = packById(obj.metadata?.pack_id);
		if (!userId || !pack) return json({ error: 'session lacks user/pack metadata' }, { status: 400 });
		if (Number(obj.amount_total) !== pack.usdCents || String(obj.currency ?? 'usd').toLowerCase() !== 'usd') {
			console.error('[billing] amount mismatch', { session: obj.id, amount_total: obj.amount_total, expected: pack.usdCents });
			return json({ error: 'amount does not match pack' }, { status: 400 });
		}
		const { error } = await svc.rpc('credit_apply', {
			p_user: userId,
			p_delta: pack.credits,
			p_kind: 'purchase',
			p_note: `Stripe ${pack.label} pack (${(pack.usdCents / 100).toFixed(2)} USD, session ${obj.id})`,
			p_actor: null,
			p_event: null,
			p_post: null,
			p_agent: null,
			p_stripe_event: String(event.id),
			p_waived: 0,
			p_allow_negative: false
		});
		if (error) {
			if (error.code === '23505' || /duplicate key/i.test(error.message ?? '')) return text('ok: already applied');
			console.error('[billing] credit_apply failed', error.message);
			// 5xx → Stripe retries with backoff; the unique index keeps it safe.
			return json({ error: 'wallet write failed' }, { status: 500 });
		}
		if (obj.customer) {
			await svc.from('credit_accounts').update({ stripe_customer_id: String(obj.customer) }).eq('user_id', userId).is('stripe_customer_id', null);
		}
		logSystemActivity({ userId, action: 'billing.purchase.completed', outcome: 'ok', creditsDelta: pack.credits, meta: { pack: pack.id, usd_cents: pack.usdCents, stripe_event: String(event.id) } });
		return text('ok');
	}

	if (type === 'charge.refunded') {
		const userId = obj.metadata?.user_id;
		const credits = Number(obj.metadata?.credits);
		const amount = Number(obj.amount);
		const refunded = Number(obj.amount_refunded);
		if (!userId || !Number.isFinite(credits) || credits <= 0 || !amount || !refunded) return text('ignored: no wallet mapping');
		// Proportional: a partial refund claws back the same share of the credits.
		const back = Math.min(credits, Math.round((credits * refunded) / amount));
		const { error } = await svc.rpc('credit_apply', {
			p_user: userId,
			p_delta: -back,
			p_kind: 'refund',
			p_note: `Stripe refund ${(refunded / 100).toFixed(2)} of ${(amount / 100).toFixed(2)} USD (charge ${obj.id})`,
			p_actor: null,
			p_event: null,
			p_post: null,
			p_agent: null,
			p_stripe_event: String(event.id),
			p_waived: 0,
			p_allow_negative: true
		});
		if (error) {
			if (error.code === '23505' || /duplicate key/i.test(error.message ?? '')) return text('ok: already applied');
			console.error('[billing] refund apply failed', error.message);
			return json({ error: 'wallet write failed' }, { status: 500 });
		}
		logSystemActivity({ userId, action: 'billing.purchase.completed', outcome: 'ok', creditsDelta: -back, meta: { refund: true, stripe_event: String(event.id) } });
		return text('ok');
	}

	return text(`ignored: ${type}`);
};
