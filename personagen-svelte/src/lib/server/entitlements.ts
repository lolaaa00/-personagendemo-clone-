/**
 * Entitlements — the one place that answers "does this plan include that?".
 *
 * The plan catalog sells nine feature lines. Before this module exactly one of
 * them (the persona limit) had code behind it; the rest were copy. This is the
 * gate the doors ask, and `plan_catalog.entitlements` is the data it reads.
 *
 * Two rules make it safe to ship into a live product:
 *
 *   1. An ABSENT key means NO RESTRICTION. An unmigrated database, a plan row
 *      an operator has not filled in, or a catalog read that fails outright all
 *      resolve to "allowed" rather than to a locked door.
 *   2. A paid plan is NEVER resolved below free (`atLeast`). Free is seeded
 *      permissive because every live account is on it today, so every gate here
 *      is currently inert — and a paying customer can never be handed less than
 *      someone paying nothing, which is what a naive per-plan lookup would do
 *      the moment plans opened.
 *
 * Tightening free (one UPDATE, quoted in plan_entitlements_migration.sql) is
 * what arms all of this. Nothing else has to change.
 */

import { getServiceSupabase } from './service-supabase';
import { loadPlanCatalog, planFromCatalog, type PlanRow } from './plans';

export type AutonomyLevel = 'advisor' | 'semi_autonomous' | 'fully_autonomous';

const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
	advisor: 0,
	semi_autonomous: 1,
	fully_autonomous: 2
};

export interface Entitlements {
	plan: string;
	/** null = unlimited */
	personaLimit: number | null;
	/** null = unlimited */
	brandBriefLimit: number | null;
	maxAutonomy: AutonomyLevel;
	/** cinematic multi-shot and talking head, as opposed to standard video */
	cinematic: boolean;
	teams: boolean;
	apiAccess: boolean;
	byok: boolean;
	/** served first when the autopilot run cannot serve everyone */
	priority: boolean;
}

/** What an absent key means, everywhere. */
export const UNRESTRICTED: Omit<Entitlements, 'plan'> = {
	personaLimit: null,
	brandBriefLimit: null,
	maxAutonomy: 'fully_autonomous',
	cinematic: true,
	teams: true,
	apiAccess: true,
	byok: true,
	priority: false // a privilege, not a restriction: absent means "no priority"
};

export function isAutonomyLevel(v: unknown): v is AutonomyLevel {
	return v === 'advisor' || v === 'semi_autonomous' || v === 'fully_autonomous';
}

/** Parse one catalog row into entitlements. Anything unreadable stays open. */
export function entitlementsFromRow(row: PlanRow | null, plan: string): Entitlements {
	const raw = (row as unknown as { entitlements?: unknown })?.entitlements;
	const e = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const bool = (k: string, fallback: boolean) => (typeof e[k] === 'boolean' ? (e[k] as boolean) : fallback);
	return {
		plan,
		personaLimit: row?.persona_limit ?? null,
		brandBriefLimit: row?.brand_brief_limit ?? null,
		maxAutonomy: isAutonomyLevel(e.max_autonomy) ? e.max_autonomy : UNRESTRICTED.maxAutonomy,
		cinematic: bool('cinematic', UNRESTRICTED.cinematic),
		teams: bool('teams', UNRESTRICTED.teams),
		apiAccess: bool('api', UNRESTRICTED.apiAccess),
		byok: bool('byok', UNRESTRICTED.byok),
		priority: bool('priority', UNRESTRICTED.priority)
	};
}

/** The more permissive of two entitlement sets, axis by axis. */
export function atLeast(base: Entitlements, other: Entitlements): Entitlements {
	const limit = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.max(a, b));
	return {
		plan: base.plan,
		personaLimit: limit(base.personaLimit, other.personaLimit),
		brandBriefLimit: limit(base.brandBriefLimit, other.brandBriefLimit),
		maxAutonomy: AUTONOMY_RANK[base.maxAutonomy] >= AUTONOMY_RANK[other.maxAutonomy] ? base.maxAutonomy : other.maxAutonomy,
		cinematic: base.cinematic || other.cinematic,
		teams: base.teams || other.teams,
		apiAccess: base.apiAccess || other.apiAccess,
		byok: base.byok || other.byok,
		// priority is a privilege of the plan the user actually pays for; it does
		// not float up from free (which never has it).
		priority: base.priority
	};
}

/** Plan ordering for the priority queue. Unknown plans sort last. */
export function planRank(plan: string | null | undefined): number {
	switch (plan) {
		case 'agency':
			return 3;
		case 'brand':
			return 2;
		case 'studio':
		case 'pro':
			return 1;
		default:
			return 0;
	}
}

/**
 * Entitlements for a user. A user with no subscription row, or one that is not
 * active, is on free. Never throws: a failure resolves to unrestricted, because
 * an outage must not lock people out of features they are paying for.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase; narrowing it here alone would be a fiction
export async function entitlementsFor(userId: string, client?: any): Promise<Entitlements> {
	try {
		const svc = client ?? getServiceSupabase();
		const [{ data: sub }, catalog] = await Promise.all([
			svc.from('subscriptions').select('plan, status, persona_limit').eq('user_id', userId).maybeSingle(),
			loadPlanCatalog(svc)
		]);
		const active = sub && (sub.status === 'active' || sub.status === 'trialing');
		const plan = active ? String(sub.plan ?? 'free') : 'free';
		const mine = entitlementsFromRow(planFromCatalog(catalog, plan), plan);
		// A subscription row may override the persona limit (a comped seat count).
		if (active && sub.persona_limit !== null && sub.persona_limit !== undefined) {
			mine.personaLimit = Number(sub.persona_limit);
		}
		if (plan === 'free') return mine;
		return atLeast(mine, entitlementsFromRow(planFromCatalog(catalog, 'free'), 'free'));
	} catch {
		return { plan: 'free', ...UNRESTRICTED };
	}
}

/** The refusal body every gated door returns, so they read the same way. */
export function planRefusal(feature: string, plan: string): { success: false; code: 'PLAN_FEATURE'; error: string; billingUrl: string } {
	return {
		success: false,
		code: 'PLAN_FEATURE',
		error: `${feature} is not included in the ${plan} plan. See the Billing page to compare plans.`,
		billingUrl: '/billing'
	};
}
