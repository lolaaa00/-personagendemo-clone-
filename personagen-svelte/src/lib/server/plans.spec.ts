import { describe, it, expect } from 'vitest';
import { PLAN_FALLBACK, includedResetClawback, mapStripeStatus, isPaidPlan, planFromCatalog } from './plans';

describe('plans — catalog and margins', () => {
	it('every paid plan includes a wallet worth ≤ 67% of its price and ≥ 77% margin floor at 3×', () => {
		for (const p of PLAN_FALLBACK.filter((x) => x.price_usd_cents > 0)) {
			expect(p.included_credits / p.price_usd_cents).toBeLessThanOrEqual(0.67);
			const rawIfFullyUsed = p.included_credits / 100 / 3;
			expect((p.price_usd_cents / 100 - rawIfFullyUsed) / (p.price_usd_cents / 100)).toBeGreaterThanOrEqual(0.77);
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

describe('plans — included credit reset', () => {
	it('nothing spent: the whole previous grant comes back before the new one', () => {
		expect(includedResetClawback(4000, 4000)).toBe(4000);
	});
	it('partly spent: only the unspent part comes back', () => {
		expect(includedResetClawback(4000, 1500)).toBe(1500);
	});
	it('overspent into purchased credit: purchased credit is untouched (balance below the grant → take the balance only)', () => {
		// balance 900 with a 4 000 grant means the user spent 3 100 of included credit
		// AND the reset takes at most 900 — never more than the wallet holds.
		expect(includedResetClawback(4000, 900)).toBe(900);
	});
	it('purchased credit on top of a full grant survives', () => {
		// 4 000 included + 2 600 purchased = 6 600; reset takes 4 000, leaves the 2 600
		expect(6600 - includedResetClawback(4000, 6600)).toBe(2600);
	});
	it('first period, empty wallet, garbage → 0', () => {
		expect(includedResetClawback(0, 5000)).toBe(0);
		expect(includedResetClawback(4000, 0)).toBe(0);
		expect(includedResetClawback(NaN, NaN)).toBe(0);
		expect(includedResetClawback(-5, 100)).toBe(0);
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
		expect(mapStripeStatus(undefined)).toBe('active');
	});
});
