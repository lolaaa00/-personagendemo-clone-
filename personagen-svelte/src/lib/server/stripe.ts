import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export function getStripe(secretKey: string): Stripe {
	if (!stripeInstance) {
		stripeInstance = new Stripe(secretKey, { apiVersion: '2026-05-27.dahlia' as any });
	}
	return stripeInstance;
}

export const PLANS = {
	starter: {
		name: 'Starter',
		price: 49,
		agents: 2,
		posts: 100,
		features: [
			'2 AI Agents',
			'100 posts/month',
			'Content Calendar',
			'Basic Analytics',
			'Email Support'
		]
	},
	pro: {
		name: 'Pro',
		price: 149,
		agents: 5,
		posts: 500,
		features: [
			'5 AI Agents',
			'500 posts/month',
			'Content Forge',
			'Channel Decoder',
			'Trend Intelligence',
			'Priority Support'
		]
	},
	enterprise: {
		name: 'Enterprise',
		price: 399,
		agents: -1, // unlimited
		posts: -1,
		features: [
			'Unlimited AI Agents',
			'Unlimited posts',
			'All Intelligence Tools',
			'White-label Portal',
			'Dedicated Account Manager',
			'Custom Integrations'
		]
	}
} as const;

export type PlanKey = keyof typeof PLANS;
