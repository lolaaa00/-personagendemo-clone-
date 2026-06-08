import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/public';

export interface BillingSubscription {
	plan: string;
	status: string;
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
	current_period_start: string | null;
	current_period_end: string | null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isDevBypass = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (isDevBypass) {
		return {
			subscription: {
				plan: 'free',
				status: 'inactive',
				stripe_customer_id: null,
				stripe_subscription_id: null,
				current_period_start: null,
				current_period_end: null
			} satisfies BillingSubscription
		};
	}

	const { user } = await locals.safeGetSession();
	if (!user) {
		return {
			subscription: {
				plan: 'free',
				status: 'inactive',
				stripe_customer_id: null,
				stripe_subscription_id: null,
				current_period_start: null,
				current_period_end: null
			} satisfies BillingSubscription
		};
	}

	const { data: subscription } = await locals.supabase
		.from('subscriptions')
		.select(
			'plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end'
		)
		.eq('user_id', user.id)
		.maybeSingle();

	return {
		subscription: (subscription ?? {
			plan: 'free',
			status: 'inactive',
			stripe_customer_id: null,
			stripe_subscription_id: null,
			current_period_start: null,
			current_period_end: null
		}) satisfies BillingSubscription
	};
};
