import { describe, it, expect } from 'vitest';
import { CREDIT_PACKS, packById, bonusPercent, whatItBuys } from './billing-packs';

describe('credit packs — sold at par, bonus on the bigger ones', () => {
	it('every pack delivers at least its price in credits (1 credit = 1 retail cent)', () => {
		for (const p of CREDIT_PACKS) {
			expect(p.credits).toBeGreaterThanOrEqual(p.usdCents);
			expect(p.credits - p.bonus).toBe(p.usdCents);
		}
	});

	it('bonus grows with pack size and is capped at 20% (keeps ≥2.5× on a 3× markup)', () => {
		const pct = CREDIT_PACKS.map(bonusPercent);
		for (let i = 1; i < pct.length; i++) expect(pct[i]).toBeGreaterThanOrEqual(pct[i - 1]);
		expect(Math.max(...pct)).toBeLessThanOrEqual(20);
	});

	it('looks up by id and rejects unknown ids', () => {
		expect(packById('pack_25')?.usdCents).toBe(2500);
		expect(packById('nope')).toBeNull();
		expect(packById(undefined)).toBeNull();
	});

	it('what-it-buys scales down with markup', () => {
		const atCost = whatItBuys(1000, 1);
		const retail = whatItBuys(1000, 3);
		expect(atCost.imagePosts).toBeGreaterThan(retail.imagePosts);
		expect(retail.videoPosts).toBe(Math.floor(1000 / Math.ceil(0.5 * 3 * 100)));
		expect(retail.textCards).toBe(Infinity);
	});
});
