import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { env as publicEnv } from '$env/dynamic/public';
import { stripeEnabled, createSubscriptionCheckout } from '$lib/server/stripe';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { plansEnabled } from '$lib/server/flags';
import { loadPlanCatalog, planFromCatalog, isPaidPlan } from '$lib/server/plans';
import { logActivity } from '$lib/server/activity';
import { Throttle } from '$lib/server/throttle';

const subscribeLimiter = new Throttle(5, 60 * 1000);

/**
 * POST /api/billing/subscribe  { plan: 'studio' | 'brand' | 'agency' }
 *   → { url }  hosted Stripe Checkout in subscription mode. The webhook
 *              creates the subscription row on completion and grants the
 *              included wallet on every paid invoice.
 *   503 while plans are switched off or Stripe is not configured
 *   409 when the account already holds an active subscription (changing
 *       plans goes through Stripe's portal — not offered yet)
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	if (!plansEnabled()) return json({ success: false, error: 'Plans are not open yet.' }, { status: 503 });
	if (!stripeEnabled()) return json({ success: false, error: 'Payments are not open yet.' }, { status: 503 });
	const limit = subscribeLimiter.check(`subscribe:${user.id}`);
	if (!limit.allowed) return json({ success: false, error: `Too many attempts — try again in ${limit.retryAfterSeconds}s.` }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });

	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {
		/* no body */
	}
	const plan = String(body?.plan ?? '').toLowerCase();
	if (!isPaidPlan(plan)) return json({ success: false, error: 'Unknown plan' }, { status: 400 });
	const svc = getServiceSupabase();
	const row = planFromCatalog(await loadPlanCatalog(svc), plan);
	if (!row || !row.active || row.price_usd_cents <= 0) return json({ success: false, error: 'Plan not available' }, { status: 400 });

	const [{ data: sub }, { data: wallet }] = await Promise.all([
		svc.from('subscriptions').select('plan, status, stripe_subscription_id, stripe_customer_id').eq('user_id', user.id).maybeSingle(),
		svc.from('credit_accounts').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
	]);
	if (sub?.stripe_subscription_id && (sub.status === 'active' || sub.status === 'trialing')) {
		return json({ success: false, error: `You are on the ${sub.plan} plan already. Contact us to change plans.` }, { status: 409 });
	}

	const base = (publicEnv.PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '') || url.origin;
	try {
		const out = await createSubscriptionCheckout({
			userId: user.id,
			email: user.email ?? null,
			plan: row.plan,
			planName: row.name,
			usdCents: row.price_usd_cents,
			includedCredits: row.included_credits,
			successUrl: `${base}/billing?status=subscribed&plan=${row.plan}`,
			cancelUrl: `${base}/billing?status=cancel`,
			customerId: sub?.stripe_customer_id ?? wallet?.stripe_customer_id ?? null,
			idempotencyKey: randomUUID()
		});
		logActivity(locals, user.id, { action: 'billing.checkout.started', meta: { plan: row.plan, usd_cents: row.price_usd_cents, mode: 'subscription' } });
		return json({ success: true, url: out.url, sessionId: out.id });
	} catch (e) {
		console.error('[billing] subscribe failed:', (e as Error).message);
		return json({ success: false, error: 'Could not start checkout. Please try again in a moment.' }, { status: 502 });
	}
};
