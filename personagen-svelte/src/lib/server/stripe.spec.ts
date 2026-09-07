import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const stripe = await import('./stripe');

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('stripe — enablement', () => {
	it('is off without a secret key and on with one', () => {
		expect(stripe.stripeEnabled()).toBe(false);
		mockEnv.STRIPE_SECRET_KEY = 'sk_test_x';
		expect(stripe.stripeEnabled()).toBe(true);
	});
});

describe('stripe — form encoding', () => {
	it('flattens nested objects and arrays the way Stripe expects', () => {
		const s = stripe.formEncode({
			mode: 'payment',
			line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 2500 } }],
			metadata: { user_id: 'u1' },
			skip: undefined
		});
		expect(s.split('&').sort()).toEqual(
			[
				'mode=payment',
				'line_items%5B0%5D%5Bquantity%5D=1',
				'line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd',
				'line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2500',
				'metadata%5Buser_id%5D=u1'
			].sort()
		);
	});
});

describe('stripe — checkout session', () => {
	it('posts a par-priced session with the user and credits in BOTH metadata slots', async () => {
		mockEnv.STRIPE_SECRET_KEY = 'sk_test_x';
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }), { status: 200 });
		}) as unknown as typeof fetch;
		const out = await stripe.createCheckoutSession({
			userId: 'u1',
			email: 'a@b.c',
			packId: 'pack_25',
			credits: 2600,
			usdCents: 2500,
			label: 'Creator',
			successUrl: 'https://app/billing?status=success',
			cancelUrl: 'https://app/billing?status=cancel',
			idempotencyKey: 'idem-1',
			fetchImpl
		});
		expect(out).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
		expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
		const headers = calls[0].init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer sk_test_x');
		expect(headers['Idempotency-Key']).toBe('idem-1');
		const body = decodeURIComponent(String(calls[0].init.body));
		expect(body).toContain('mode=payment');
		expect(body).toContain('line_items[0][price_data][unit_amount]=2500');
		expect(body).toContain('metadata[user_id]=u1');
		expect(body).toContain('metadata[credits]=2600');
		expect(body).toContain('payment_intent_data[metadata][user_id]=u1');
		expect(body).toContain('customer_email=a@b.c');
		expect(body).toContain('client_reference_id=u1');
	});

	it('surfaces the Stripe error message on a non-2xx', async () => {
		mockEnv.STRIPE_SECRET_KEY = 'sk_test_x';
		const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'No such price' } }), { status: 400 })) as unknown as typeof fetch;
		await expect(
			stripe.createCheckoutSession({
				userId: 'u1', email: null, packId: 'p', credits: 1, usdCents: 1, label: 'x',
				successUrl: 's', cancelUrl: 'c', idempotencyKey: 'k', fetchImpl
			})
		).rejects.toThrow('No such price');
	});
});

describe('stripe — webhook signature', () => {
	const secret = 'whsec_test_secret';
	const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

	it('accepts a header it signed itself and returns the parsed event', () => {
		const header = stripe.signWebhookPayload(body, secret, 1_700_000_000);
		const evt = stripe.verifyWebhookSignature(body, header, secret, 1_700_000_010);
		expect(evt.id).toBe('evt_1');
	});

	it('rejects a tampered body, a wrong secret, a stale timestamp, and a missing header', () => {
		const header = stripe.signWebhookPayload(body, secret, 1_700_000_000);
		expect(() => stripe.verifyWebhookSignature(body + ' ', header, secret, 1_700_000_010)).toThrow(/mismatch/);
		expect(() => stripe.verifyWebhookSignature(body, header, 'other', 1_700_000_010)).toThrow(/mismatch/);
		expect(() => stripe.verifyWebhookSignature(body, header, secret, 1_700_001_000)).toThrow(/tolerance/);
		expect(() => stripe.verifyWebhookSignature(body, null, secret, 1_700_000_010)).toThrow(/missing/);
		expect(() => stripe.verifyWebhookSignature(body, header, '', 1_700_000_010)).toThrow(/not configured/);
	});
});
