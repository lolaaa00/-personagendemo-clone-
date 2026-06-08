import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

/**
 * Create a service-role Supabase client for webhook writes.
 * Webhooks are unauthenticated (no user session), so we need
 * the service role key to bypass RLS.
 */
function getServiceSupabase(): SupabaseClient {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !serviceKey) {
		throw new Error('Supabase service-role credentials not configured');
	}
	return createClient(url, serviceKey);
}

export const POST: RequestHandler = async ({ request }) => {
	const secretKey = env.STRIPE_SECRET_KEY;
	const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

	if (!secretKey || !webhookSecret) {
		throw error(500, 'Stripe webhook not configured');
	}

	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		throw error(400, 'Missing stripe-signature header');
	}

	const stripe = getStripe(secretKey);
	const body = await request.text();

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
	} catch (err) {
		console.error('[Stripe Webhook] Signature verification failed:', err);
		throw error(400, 'Webhook signature verification failed');
	}

	const supabase = getServiceSupabase();

	try {
		switch (event.type) {
			case 'checkout.session.completed': {
				await handleCheckoutCompleted(stripe, supabase, event.data.object as Stripe.Checkout.Session);
				break;
			}
			case 'customer.subscription.updated': {
				await handleSubscriptionUpdated(supabase, event.data.object as Stripe.Subscription);
				break;
			}
			case 'customer.subscription.deleted': {
				await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription);
				break;
			}
			case 'invoice.payment_failed': {
				await handlePaymentFailed(supabase, event.data.object as Stripe.Invoice);
				break;
			}
			default: {
				console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
			}
		}
	} catch (err) {
		console.error(`[Stripe Webhook] Error processing ${event.type}:`, err);
		// Still return 200 to prevent Stripe from retrying indefinitely
		return json({ received: true, error: 'Processing error' }, { status: 200 });
	}

	return json({ received: true });
};

async function handleCheckoutCompleted(
	stripe: Stripe,
	supabase: SupabaseClient,
	session: Stripe.Checkout.Session
) {
	const userId = session.metadata?.supabase_user_id;
	const plan = session.metadata?.plan;
	const subscriptionId = session.subscription as string;
	const customerId = session.customer as string;

	if (!userId || !plan || !subscriptionId) {
		console.error('[Stripe Webhook] Missing metadata on checkout session:', session.id);
		return;
	}

	// Retrieve the subscription to get period details
	const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as any;

	const { error: upsertError } = await supabase.from('subscriptions').upsert(
		{
			user_id: userId,
			stripe_customer_id: customerId,
			stripe_subscription_id: subscriptionId,
			plan,
			status: 'active',
			current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
			current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'user_id' }
	);

	if (upsertError) {
		console.error('[Stripe Webhook] Supabase upsert error:', upsertError);
		throw upsertError;
	}

	console.log(`[Stripe Webhook] Subscription activated for user ${userId}, plan: ${plan}`);
}

async function handleSubscriptionUpdated(
	supabase: SupabaseClient,
	subscription: Stripe.Subscription
) {
	const userId = subscription.metadata?.supabase_user_id;
	if (!userId) {
		console.error('[Stripe Webhook] No supabase_user_id in subscription metadata:', subscription.id);
		return;
	}

	const plan = subscription.metadata?.plan ?? 'unknown';
	const statusMap: Record<string, string> = {
		active: 'active',
		past_due: 'past_due',
		canceled: 'canceled',
		unpaid: 'past_due',
		trialing: 'trialing',
		incomplete: 'incomplete',
		incomplete_expired: 'canceled',
		paused: 'paused'
	};

	const subAny = subscription as any;

	const { error: updateError } = await supabase
		.from('subscriptions')
		.update({
			plan,
			status: statusMap[subscription.status] ?? subscription.status,
			stripe_subscription_id: subscription.id,
			current_period_start: new Date(subAny.current_period_start * 1000).toISOString(),
			current_period_end: new Date(subAny.current_period_end * 1000).toISOString(),
			updated_at: new Date().toISOString()
		})
		.eq('user_id', userId);

	if (updateError) {
		console.error('[Stripe Webhook] Subscription update error:', updateError);
		throw updateError;
	}

	console.log(`[Stripe Webhook] Subscription updated for user ${userId}: ${subscription.status}`);
}

async function handleSubscriptionDeleted(
	supabase: SupabaseClient,
	subscription: Stripe.Subscription
) {
	const userId = subscription.metadata?.supabase_user_id;
	if (!userId) {
		// Fallback: look up by stripe_subscription_id
		const { data } = await supabase
			.from('subscriptions')
			.select('user_id')
			.eq('stripe_subscription_id', subscription.id)
			.maybeSingle();

		if (!data) {
			console.error('[Stripe Webhook] Cannot find user for deleted subscription:', subscription.id);
			return;
		}

		await supabase
			.from('subscriptions')
			.update({
				status: 'canceled',
				updated_at: new Date().toISOString()
			})
			.eq('user_id', data.user_id);

		console.log(`[Stripe Webhook] Subscription canceled for user ${data.user_id}`);
		return;
	}

	const { error: updateError } = await supabase
		.from('subscriptions')
		.update({
			status: 'canceled',
			updated_at: new Date().toISOString()
		})
		.eq('user_id', userId);

	if (updateError) {
		console.error('[Stripe Webhook] Subscription delete error:', updateError);
		throw updateError;
	}

	console.log(`[Stripe Webhook] Subscription canceled for user ${userId}`);
}

async function handlePaymentFailed(
	supabase: SupabaseClient,
	invoice: Stripe.Invoice
) {
	const subscriptionId = (invoice as any).subscription as string;
	if (!subscriptionId) return;

	// Find user by subscription ID
	const { data } = await supabase
		.from('subscriptions')
		.select('user_id')
		.eq('stripe_subscription_id', subscriptionId)
		.maybeSingle();

	if (!data) {
		console.error('[Stripe Webhook] No subscription found for invoice:', invoice.id);
		return;
	}

	const { error: updateError } = await supabase
		.from('subscriptions')
		.update({
			status: 'past_due',
			updated_at: new Date().toISOString()
		})
		.eq('user_id', data.user_id);

	if (updateError) {
		console.error('[Stripe Webhook] Payment failed update error:', updateError);
		throw updateError;
	}

	console.log(`[Stripe Webhook] Payment failed for user ${data.user_id}, marked as past_due`);
}

