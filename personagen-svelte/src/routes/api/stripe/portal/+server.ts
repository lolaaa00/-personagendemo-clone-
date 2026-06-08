import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ locals, url }) => {
	const secretKey = env.STRIPE_SECRET_KEY;
	if (!secretKey) {
		throw error(500, 'Stripe is not configured');
	}

	const { session: authSession, user } = await locals.safeGetSession();
	if (!authSession || !user) {
		throw error(401, 'Authentication required');
	}

	// Look up the user's Stripe customer ID
	const { data: subscription } = await locals.supabase
		.from('subscriptions')
		.select('stripe_customer_id')
		.eq('user_id', user.id)
		.maybeSingle();

	if (!subscription?.stripe_customer_id) {
		throw error(404, 'No billing account found. Please subscribe to a plan first.');
	}

	const stripe = getStripe(secretKey);
	const origin = url.origin;

	try {
		const portalSession = await stripe.billingPortal.sessions.create({
			customer: subscription.stripe_customer_id,
			return_url: `${origin}/settings/billing`
		});

		return json({ url: portalSession.url });
	} catch (err) {
		console.error('[Stripe Portal Error]', err);
		const message = err instanceof Error ? err.message : 'Failed to create portal session';
		throw error(500, message);
	}
};
