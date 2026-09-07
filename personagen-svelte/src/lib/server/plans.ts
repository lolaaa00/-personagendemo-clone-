/**
 * Plans — subscriptions with an included monthly media wallet.
 *
 * The catalog lives in the database (plan_catalog, service-only, editable
 * from the console later); PLAN_FALLBACK is the same table for a database
 * that has not been migrated yet. Included credit RESETS each period, the
 * industry norm and what keeps the plan price predictable:
 *
 *   on invoice.paid for period N+1
 *     remainder = min(last_included_grant, balance)   ← unspent part of period N's grant
 *     adjustment −remainder (never touches purchased or welcome credit,
 *                            which sit "under" the included grant)
 *     grant      +included_credits for period N+1
 *
 * Both writes carry a stripe_event_id derived from the invoice id, so a
 * replayed invoice.paid is inert (unique partial index on credit_ledger).
 */

import { getServiceSupabase } from './service-supabase';

export interface PlanRow {
	plan: string;
	name: string;
	price_usd_cents: number;
	included_credits: number;
	persona_limit: number | null;
	brand_brief_limit: number | null;
	features: string[];
	sort: number;
	active: boolean;
}

export const PLAN_FALLBACK: PlanRow[] = [
	{ plan: 'free', name: 'Free', price_usd_cents: 0, included_credits: 0, persona_limit: null, brand_brief_limit: null, features: ['Welcome credit to start', 'Unlimited text posts', 'All 13 platforms'], sort: 0, active: true },
	{ plan: 'studio', name: 'Studio', price_usd_cents: 7_900, included_credits: 4_000, persona_limit: 3, brand_brief_limit: 1, features: ['3 personas', '$40 / month of media generation included', 'Unlimited text posts', 'All 13 platforms', '1 brand brief', 'Advisor + Semi-autonomous', 'Standard video + lip-sync'], sort: 1, active: true },
	{ plan: 'brand', name: 'Brand', price_usd_cents: 29_900, included_credits: 18_000, persona_limit: 10, brand_brief_limit: 3, features: ['10 personas', '$180 / month of media generation included', 'Unlimited text posts', 'All 13 platforms', '3 brand briefs', 'All three autonomy levels', 'Cinematic multi-shot + talking head', 'Spend ledger + verified publishing', 'Approval queue'], sort: 2, active: true },
	{ plan: 'agency', name: 'Agency', price_usd_cents: 89_900, included_credits: 60_000, persona_limit: null, brand_brief_limit: null, features: ['Unlimited personas', '$600 / month of media generation included', 'Unlimited text posts', 'All 13 platforms', 'Unlimited brand briefs', 'Priority generation queue', 'Teams + shared workspaces', 'Bring your own keys — generation at no charge', 'API access + dedicated manager'], sort: 3, active: true }
];

export const PAID_PLANS = ['studio', 'brand', 'agency'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function isPaidPlan(p: unknown): p is PaidPlan {
	return typeof p === 'string' && (PAID_PLANS as readonly string[]).includes(p);
}

/** Catalog from the database, falling back to the static table (never-brick). */
export async function loadPlanCatalog(client?: any): Promise<PlanRow[]> {
	try {
		const svc = client ?? getServiceSupabase();
		const { data, error } = await svc.from('plan_catalog').select('plan, name, price_usd_cents, included_credits, persona_limit, brand_brief_limit, features, sort, active').order('sort');
		if (error || !data?.length) return PLAN_FALLBACK;
		return data.map((r: any) => ({
			plan: r.plan,
			name: r.name,
			price_usd_cents: Number(r.price_usd_cents),
			included_credits: Number(r.included_credits),
			persona_limit: r.persona_limit === null ? null : Number(r.persona_limit),
			brand_brief_limit: r.brand_brief_limit === null ? null : Number(r.brand_brief_limit),
			features: Array.isArray(r.features) ? r.features : [],
			sort: Number(r.sort ?? 0),
			active: r.active !== false
		}));
	} catch {
		return PLAN_FALLBACK;
	}
}

export function planFromCatalog(catalog: PlanRow[], plan: string): PlanRow | null {
	return catalog.find((p) => p.plan === plan) ?? null;
}

/**
 * How much of the previous period's included grant to take back before the
 * new one lands. Never more than the balance (purchased credit is untouched
 * because it sits under the included grant), never negative.
 */
export function includedResetClawback(lastIncludedGrant: number, balance: number): number {
	const last = Math.max(0, Math.floor(Number(lastIncludedGrant) || 0));
	const bal = Math.floor(Number(balance) || 0);
	if (last <= 0 || bal <= 0) return 0;
	return Math.min(last, bal);
}

/** Stripe subscription status → our subscriptions.status check values. */
export function mapStripeStatus(s: string | null | undefined): 'active' | 'canceled' | 'past_due' | 'trialing' {
	switch (String(s ?? '').toLowerCase()) {
		case 'trialing':
			return 'trialing';
		case 'past_due':
		case 'unpaid':
		case 'incomplete':
			return 'past_due';
		case 'canceled':
		case 'incomplete_expired':
			return 'canceled';
		default:
			return 'active';
	}
}

/**
 * Persona limit for a user: null = unlimited. Reads the subscription row and
 * the catalog through the service client (RLS would still allow own-row reads,
 * but the catalog is service-only). A user with no row is on 'free'.
 */
export async function personaLimitFor(userId: string, client?: any): Promise<{ plan: string; limit: number | null }> {
	const svc = client ?? getServiceSupabase();
	const [{ data: sub }, catalog] = await Promise.all([
		svc.from('subscriptions').select('plan, status, persona_limit').eq('user_id', userId).maybeSingle(),
		loadPlanCatalog(svc)
	]);
	const active = sub && (sub.status === 'active' || sub.status === 'trialing');
	const plan = active ? String(sub.plan ?? 'free') : 'free';
	if (sub && sub.persona_limit !== null && sub.persona_limit !== undefined && active) return { plan, limit: Number(sub.persona_limit) };
	const row = planFromCatalog(catalog, plan);
	return { plan, limit: row?.persona_limit ?? null };
}

/** Message when creating one more persona would exceed the plan; null when allowed. */
export async function personaLimitExceeded(userId: string, client?: any): Promise<string | null> {
	const svc = client ?? getServiceSupabase();
	const { plan, limit } = await personaLimitFor(userId, svc);
	if (limit === null) return null;
	const { count } = await svc.from('agents').select('id', { count: 'exact', head: true }).eq('user_id', userId);
	if ((count ?? 0) >= limit) {
		return `Your ${plan} plan includes ${limit} persona${limit === 1 ? '' : 's'}. Upgrade on the Billing page to add more.`;
	}
	return null;
}
