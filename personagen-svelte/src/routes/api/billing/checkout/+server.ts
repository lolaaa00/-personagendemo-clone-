import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { env as publicEnv } from '$env/dynamic/public';
import { stripeEnabled, createCheckoutSession } from '$lib/server/stripe';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { packById } from '$lib/billing-packs';
import { logActivity } from '$lib/server/activity';
import { Throttle } from '$lib/server/throttle';

/** A double-click opens one session (idempotency key); a script opening fifty gets a 429. */
const checkoutLimiter = new Throttle(5, 60 * 1000);

/**
 * POST /api/billing/checkout  { packId }
 *   → { url }  hosted Stripe Checkout for one credit pack, charged in USD at
 *              par (credits are retail cents). The webhook credits the wallet;
 *              this route never touches a balance.
 *   503 when Stripe is not configured (STRIPE_SECRET_KEY unset) — the page
 *   already shows "Payments open soon", this is the belt to its braces.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	if (!stripeEnabled()) return json({ success: false, error: 'Payments are not open yet. Ask us for credits in the meantime.' }, { status: 503 });
	const limit = checkoutLimiter.check(`checkout:${user.id}`);
	if (!limit.allowed) {
		return json({ success: false, error: `Too many checkout attempts — try again in ${limit.retryAfterSeconds}s.` }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
	}

	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {
		/* empty body → no pack */
	}
	const pack = packById(typeof body.packId === 'string' ? body.packId : null);
	if (!pack) return json({ success: false, error: 'Unknown pack' }, { status: 400 });

	// Reuse the Stripe customer once one exists so purchases stack on one
	// customer record (receipts, refunds, and the portal all line up).
	let customerId: string | null = null;
	try {
		const { data } = await getServiceSupabase().from('credit_accounts').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
		customerId = data?.stripe_customer_id ?? null;
	} catch {
		/* wallet row may not exist yet — Stripe creates the customer */
	}

	const base = (publicEnv.PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '') || url.origin;
	try {
		const out = await createCheckoutSession({
			userId: user.id,
			email: user.email ?? null,
			packId: pack.id,
			credits: pack.credits,
			usdCents: pack.usdCents,
			label: pack.label,
			successUrl: `${base}/billing?status=success&pack=${pack.id}`,
			cancelUrl: `${base}/billing?status=cancel`,
			customerId,
			idempotencyKey: randomUUID()
		});
		logActivity(locals, user.id, { action: 'billing.checkout.started', meta: { pack: pack.id, usd_cents: pack.usdCents, credits: pack.credits } });
		return json({ success: true, url: out.url, sessionId: out.id });
	} catch (e) {
		console.error('[billing] checkout failed:', (e as Error).message);
		return json({ success: false, error: 'Could not start checkout. Please try again in a moment.' }, { status: 502 });
	}
};
