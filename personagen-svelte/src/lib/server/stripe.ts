/**
 * Stripe — the two calls the wallet needs, over plain fetch (no SDK, nothing
 * to install, nothing that can drift from the pinned API version).
 *
 *   createCheckoutSession()  hosted Checkout for one credit pack; the user id
 *                            and the credits ride in metadata on BOTH the
 *                            session and the PaymentIntent, so a later refund
 *                            (which arrives on the charge) can be mapped back
 *                            without a lookup table.
 *   verifyWebhookSignature() Stripe-Signature v1 scheme — HMAC-SHA256 of
 *                            "<t>.<raw body>", constant-time compare, replay
 *                            window of 5 minutes.
 *
 * Enablement is one env var: STRIPE_SECRET_KEY. Absent → stripeEnabled() is
 * false, /billing shows the packs with "Payments open soon", and checkout
 * returns 503 instead of a broken redirect. STRIPE_WEBHOOK_SECRET is required
 * for the webhook to accept anything at all (an unsigned webhook would let
 * anyone mint credits).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

const API = 'https://api.stripe.com/v1';
const API_VERSION = '2025-08-27.basil';

export function stripeEnabled(): boolean {
	return !!(env.STRIPE_SECRET_KEY ?? '').trim();
}

export function stripeWebhookConfigured(): boolean {
	return !!(env.STRIPE_WEBHOOK_SECRET ?? '').trim();
}

/** Flatten {a:{b:1}, c:[x]} into Stripe's form encoding: a[b]=1, c[0]=x. */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string {
	const parts: string[] = [];
	const walk = (v: unknown, key: string) => {
		if (v === undefined || v === null) return;
		if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${key}[${i}]`));
		else if (typeof v === 'object') for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, key ? `${key}[${k}]` : k);
		else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
	};
	walk(obj, prefix);
	return parts.join('&');
}

async function stripePost<T = any>(path: string, body: Record<string, unknown>, idempotencyKey?: string, fetchImpl: typeof fetch = fetch): Promise<T> {
	const key = (env.STRIPE_SECRET_KEY ?? '').trim();
	if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
	const res = await fetchImpl(`${API}${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'Stripe-Version': API_VERSION,
			...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
		},
		body: formEncode(body),
		signal: AbortSignal.timeout(15_000)
	});
	const text = await res.text();
	let parsed: any = null;
	try {
		parsed = JSON.parse(text);
	} catch {
		/* non-JSON error body */
	}
	if (!res.ok) throw new Error(parsed?.error?.message ?? `Stripe ${res.status}: ${text.slice(0, 200)}`);
	return parsed as T;
}

export interface CheckoutInput {
	userId: string;
	email: string | null;
	packId: string;
	credits: number;
	usdCents: number;
	label: string;
	successUrl: string;
	cancelUrl: string;
	/** Existing Stripe customer, if the wallet already has one. */
	customerId?: string | null;
	/** Unique per attempt — protects a double-click from opening two sessions. */
	idempotencyKey: string;
	fetchImpl?: typeof fetch;
}

export async function createCheckoutSession(i: CheckoutInput): Promise<{ id: string; url: string }> {
	const metadata = { user_id: i.userId, pack_id: i.packId, credits: String(i.credits) };
	const session = await stripePost<{ id: string; url: string }>(
		'/checkout/sessions',
		{
			mode: 'payment',
			client_reference_id: i.userId,
			...(i.customerId ? { customer: i.customerId } : i.email ? { customer_email: i.email, customer_creation: 'always' } : {}),
			line_items: [
				{
					quantity: 1,
					price_data: {
						currency: 'usd',
						unit_amount: i.usdCents,
						product_data: {
							name: `${i.label} pack — ${(i.credits / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} of generation credit`,
							description: 'Credits never expire. Spent only on AI generation you start.'
						}
					}
				}
			],
			metadata,
			payment_intent_data: { metadata },
			success_url: i.successUrl,
			cancel_url: i.cancelUrl,
			allow_promotion_codes: true,
			billing_address_collection: 'auto'
		},
		i.idempotencyKey,
		i.fetchImpl
	);
	if (!session?.url) throw new Error('Stripe returned no checkout URL');
	return { id: session.id, url: session.url };
}

/**
 * Verify a Stripe-Signature header against the RAW request body.
 * Returns the parsed event on success, throws on any failure.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): any {
	if (!secret) throw new Error('webhook secret not configured');
	if (!header) throw new Error('missing Stripe-Signature header');
	let t = '';
	const v1: string[] = [];
	for (const part of header.split(',')) {
		const [k, v] = part.split('=', 2).map((s) => s?.trim());
		if (k === 't') t = v ?? '';
		else if (k === 'v1' && v) v1.push(v);
	}
	if (!t || v1.length === 0) throw new Error('malformed Stripe-Signature header');
	const ts = Number(t);
	if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) throw new Error('Stripe-Signature timestamp outside tolerance');
	const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
	const ok = v1.some((sig) => {
		const a = Buffer.from(sig, 'hex');
		const b = Buffer.from(expected, 'hex');
		return a.length === b.length && timingSafeEqual(a, b);
	});
	if (!ok) throw new Error('Stripe-Signature mismatch');
	return JSON.parse(rawBody);
}

/** Test helper / local tooling: build a valid header for a body. */
export function signWebhookPayload(rawBody: string, secret: string, tsSec = Math.floor(Date.now() / 1000)): string {
	const sig = createHmac('sha256', secret).update(`${tsSec}.${rawBody}`, 'utf8').digest('hex');
	return `t=${tsSec},v1=${sig}`;
}
