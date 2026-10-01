import { describe, it, expect } from 'vitest';
import {
	PLAN_FALLBACK,
	mapStripeStatus,
	isPaidPlan,
	planFromCatalog,
	loadPlanCatalog,
	invalidatePlanCatalog
} from './plans';

describe('plans — catalog and margins', () => {
	it('every paid plan includes a wallet worth ≤ 67% of its price and ≥ 77% margin floor at 3×', () => {
		for (const p of PLAN_FALLBACK.filter((x) => x.price_usd_cents > 0)) {
			expect(p.included_credits / p.price_usd_cents).toBeLessThanOrEqual(0.67);
			const rawIfFullyUsed = p.included_credits / 100 / 3;
			expect(
				(p.price_usd_cents / 100 - rawIfFullyUsed) / (p.price_usd_cents / 100)
			).toBeGreaterThanOrEqual(0.77);
		}
	});

	it('matches the landing page prices exactly', () => {
		expect(planFromCatalog(PLAN_FALLBACK, 'studio')?.price_usd_cents).toBe(7900);
		expect(planFromCatalog(PLAN_FALLBACK, 'brand')?.price_usd_cents).toBe(29900);
		expect(planFromCatalog(PLAN_FALLBACK, 'agency')?.price_usd_cents).toBe(89900);
		expect(isPaidPlan('studio')).toBe(true);
		expect(isPaidPlan('free')).toBe(false);
	});
});

describe('plans — Stripe status mapping', () => {
	it('maps to the four statuses the table accepts', () => {
		expect(mapStripeStatus('active')).toBe('active');
		expect(mapStripeStatus('trialing')).toBe('trialing');
		expect(mapStripeStatus('past_due')).toBe('past_due');
		expect(mapStripeStatus('unpaid')).toBe('past_due');
		expect(mapStripeStatus('canceled')).toBe('canceled');
		expect(mapStripeStatus('incomplete_expired')).toBe('canceled');
		expect(mapStripeStatus('paused')).toBe('past_due');
		expect(mapStripeStatus(undefined)).toBe('past_due');
	});
});

describe('plans — the catalog cache', () => {
	// Four rows read on every request that resolves entitlements, including every
	// portal navigation once the client reads them. Cheap to cache, and the only
	// dangerous mistake is caching a FAILED read.
	function client(rows: unknown[] | null, error: unknown = null) {
		const calls = { n: 0 };
		return {
			calls,
			from: () => ({
				select: () => ({
					order: async () => {
						calls.n++;
						return { data: rows, error };
					}
				})
			})
		};
	}

	it('reads once and serves the rest from memory', async () => {
		invalidatePlanCatalog();
		const c = client([
			{
				plan: 'free',
				name: 'Free',
				price_usd_cents: 0,
				included_credits: 0,
				persona_limit: null,
				brand_brief_limit: null,
				features: [],
				sort: 0,
				active: true,
				entitlements: {}
			}
		]);
		await loadPlanCatalog(c as never);
		await loadPlanCatalog(c as never);
		await loadPlanCatalog(c as never);
		expect(c.calls.n).toBe(1);
	});

	it('does NOT cache the never-brick fallback', async () => {
		// Caching a failed read would turn one bad query into 30 seconds of wrong
		// answers — and the fallback is what a gate resolves against.
		invalidatePlanCatalog();
		const c = client(null, { message: 'boom' });
		const a = await loadPlanCatalog(c as never);
		const b = await loadPlanCatalog(c as never);
		expect(a).toBe(PLAN_FALLBACK);
		expect(b).toBe(PLAN_FALLBACK);
		expect(c.calls.n, 'a failed read must be retried, not cached').toBe(2);
	});

	it('a throwing client is not cached either', async () => {
		invalidatePlanCatalog();
		const c = {
			calls: { n: 0 },
			from() {
				this.calls.n++;
				throw new Error('down');
			}
		};
		await loadPlanCatalog(c as never);
		await loadPlanCatalog(c as never);
		expect(c.calls.n).toBe(2);
	});

	it('invalidatePlanCatalog forces the next read to hit the database', async () => {
		invalidatePlanCatalog();
		const c = client([
			{
				plan: 'free',
				name: 'Free',
				price_usd_cents: 0,
				included_credits: 0,
				persona_limit: null,
				brand_brief_limit: null,
				features: [],
				sort: 0,
				active: true,
				entitlements: {}
			}
		]);
		await loadPlanCatalog(c as never);
		invalidatePlanCatalog();
		await loadPlanCatalog(c as never);
		expect(c.calls.n).toBe(2);
	});
});
