import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStripe, PLANS, type PlanKey } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';

const PRICE_ID_MAP: Record<PlanKey, string> = {
	starter: 'STRIPE_STARTER_PRICE_ID',
	pro: 'STRIPE_PRO_PRICE_ID',
	enterprise: 'STRIPE_ENTERPRISE_PRICE_ID'
};

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const secretKey = env.STRIPE_SECRET_KEY;
	if (!secretKey) {
		throw error(500, 'Stripe is not configured');
	}

	const { session: authSession, user } = await locals.safeGetSession();
	if (!authSession || !user) {
		throw error(401, 'Authentication required');
	}

	const body = (await request.json()) as any;
	const plan = body.plan as PlanKey;

	if (!plan || !PLANS[plan]) {
		throw error(400, 'Invalid plan. Must be one of: starter, pro, enterprise');
	}

	const priceEnvKey = PRICE_ID_MAP[plan];
	const priceId = env[priceEnvKey];
	if (!priceId || priceId.startsWith('price_placeholder')) {
		throw error(500, `Price ID not configured for plan: ${plan}`);
	}

	const stripe = getStripe(secretKey);
	const origin = url.origin;

	try {
		// Look up existing Stripe customer ID from subscriptions table
		const { data: existingSub } = await locals.supabase
			.from('subscriptions')
			.select('stripe_customer_id')
			.eq('user_id', user.id)
			.maybeSingle();

		let customerId = existingSub?.stripe_customer_id;

		// Create Stripe customer if none exists
		if (!customerId) {
			const customer = await stripe.customers.create({
				email: user.email,
				metadata: {
					supabase_user_id: user.id
				}
			});
			customerId = customer.id;

			// Upsert the subscription record with the new customer ID
			await locals.supabase.from('subscriptions').upsert(
				{
					user_id: user.id,
					stripe_customer_id: customerId,
					plan: 'free',
					status: 'inactive'
				},
				{ onConflict: 'user_id' }
			);
		}

		// Create checkout session
		const checkoutSession = await stripe.checkout.sessions.create({
			customer: customerId,
			mode: 'subscription',
			line_items: [
				{
					price: priceId,
					quantity: 1
				}
			],
			success_url: `${origin}/settings/billing?success=true`,
			cancel_url: `${origin}/settings/billing?canceled=true`,
			subscription_data: {
				metadata: {
					supabase_user_id: user.id,
					plan
				}
			},
			metadata: {
				supabase_user_id: user.id,
				plan
			}
		});

		return json({ url: checkoutSession.url });
	} catch (err) {
		console.error('[Stripe Checkout Error]', err);
		const message = err instanceof Error ? err.message : 'Failed to create checkout session';
		throw error(500, message);
	}
};
