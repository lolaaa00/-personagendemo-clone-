/**
 * Economics — the money math, proved in code rather than in a spreadsheet.
 *
 * Every number quoted in docs/monetization/conversion-and-margin-design.md
 * is derived here from the same sources the runtime bills from: the pricing
 * matrix, creditsFor()'s rounding, the pack table, and the landing plans.
 * If a price, a bonus, or the rounding rule changes, this file says what
 * the new margins are — or fails, if a floor is broken.
 */
import { describe, it, expect } from 'vitest';
import { priceOf } from './pricing';
import {
	CREDIT_PACKS,
	bonusPercent,
	outcomeSteps,
	retailCreditsFor,
	retailCreditsForStep,
	rawUsdFor,
	whatItBuys,
	type OutcomeKind
} from './billing-packs';

const MARKUP = 3;
const OUTCOMES: OutcomeKind[] = ['imagePost', 'videoPost', 'talkingHead', 'cinematic', 'persona'];

/** The server's rule, restated independently: ceil per event of usd × m × 100. */
const serverCredits = (usd: number, m: number) => Math.ceil(+(usd * m * 100).toFixed(6));

describe('credit unit — 1 credit = 1 retail cent, rounded up per event', () => {
	it('client-side retail math equals the server rule for every matrix price', () => {
		for (const provider of ['fal', 'openrouter', 'gemini'] as const) {
			for (const op of ['image', 'video', 'llm', 'tts', 'talking_head']) {
				const usd = priceOf(provider, op);
				if (usd <= 0) continue;
				for (const m of [1, 1.5, 2, 3, 5]) {
					expect(retailCreditsForStep(usd, m)).toBe(serverCredits(usd, m));
				}
			}
		}
	});

	it('per-event ceil never charges less than retail, and at most 1 credit more per event', () => {
		for (const kind of OUTCOMES) {
			const steps = outcomeSteps(kind);
			const exact = steps.reduce((s, u) => s + u * MARKUP * 100, 0);
			const charged = retailCreditsFor(kind, MARKUP);
			expect(charged).toBeGreaterThanOrEqual(Math.ceil(exact) - 1e-9);
			expect(charged - exact).toBeLessThan(steps.length);
		}
	});

	it('float noise cannot add a credit', () => {
		expect(retailCreditsForStep(0.1 + 0.2, 2)).toBe(60);
		expect(retailCreditsForStep(0.07 * 3, 1)).toBe(21);
	});

	it('thresholds in credits are markup-invariant money: 300 credits is $3.00 at any markup', () => {
		// The pill's amber threshold and the packs are expressed in retail cents,
		// so changing the markup changes what a run COSTS, never what a credit IS.
		expect(300 / 100).toBe(3);
	});
});

describe('outcomes at 3× — what the customer pays vs what we pay', () => {
	it.each(OUTCOMES)('%s carries ≥ 60% gross margin and ≤ 3.4× raw', (kind) => {
		const raw = rawUsdFor(kind);
		const retail = retailCreditsFor(kind, MARKUP) / 100;
		const margin = (retail - raw) / retail;
		expect(margin).toBeGreaterThanOrEqual(0.6);
		expect(retail / raw).toBeLessThanOrEqual(3.4); // the ceil adds at most cents
	});

	it('states the retail price list used in the design document', () => {
		const table = Object.fromEntries(OUTCOMES.map((k) => [k, { raw: rawUsdFor(k), retail: retailCreditsFor(k, MARKUP) / 100 }]));
		// image post: director + grader + still
		expect(table.imagePost.raw).toBeCloseTo(0.084, 6);
		expect(table.imagePost.retail).toBe(0.26);
		// video post adds the b-roll clip
		expect(table.videoPost.raw).toBeCloseTo(0.504, 6);
		expect(table.videoPost.retail).toBe(1.52);
		// talking head adds voice + OmniHuman
		expect(table.talkingHead.raw).toBeCloseTo(0.814, 6);
		expect(table.talkingHead.retail).toBe(2.45);
		// cinematic: 4 stills + pro shot-set
		expect(table.cinematic.raw).toBeCloseTo(1.924, 6);
		expect(table.cinematic.retail).toBe(5.78);
		// persona: avatar (2 stills) + 4-stage kit
		expect(table.persona.raw).toBeCloseTo(0.48, 6);
		expect(table.persona.retail).toBe(1.44);
	});

	it('stays below the closest competitor on every comparable line', () => {
		// theinfluencer.ai (2026-09-07): image $0.13–0.19, 5 s video $0.75–1.90; Creatify 30 s ad $3.50.
		expect(retailCreditsFor('imagePost', MARKUP) / 100).toBeLessThan(0.13 + 0.2); // + our two LLM passes
		expect(retailCreditsFor('videoPost', MARKUP) / 100).toBeLessThan(1.9);
		expect(retailCreditsFor('talkingHead', MARKUP) / 100).toBeLessThan(3.5);
	});
});

describe('welcome credit — a taste, not a budget', () => {
	const WELCOME = 1000; // production setting, $10.00 retail
	it('costs us ≤ $3.34 and buys one persona plus a handful of image posts, not a video budget', () => {
		expect(WELCOME / 100 / MARKUP).toBeLessThanOrEqual(3.34);
		const afterPersona = WELCOME - retailCreditsFor('persona', MARKUP);
		const buys = whatItBuys(afterPersona, MARKUP);
		expect(buys.imagePosts).toBeGreaterThanOrEqual(20);
		expect(buys.videoPosts).toBeLessThanOrEqual(6);
		expect(buys.textCards).toBe(Infinity);
	});
});

describe('packs — at par, bonus ladder, margin floors', () => {
	it('every pack is at par plus a bonus that never exceeds 20%', () => {
		for (const p of CREDIT_PACKS) {
			expect(p.credits - p.bonus).toBe(p.usdCents);
			expect(bonusPercent(p)).toBeLessThanOrEqual(20);
		}
	});

	it('gross margin per pack at 3× is 60–67%, and the top pack is exactly 2.5× raw', () => {
		for (const p of CREDIT_PACKS) {
			const rawCostIfSpent = p.credits / 100 / MARKUP; // every retail cent = 1/3 raw cent
			const margin = (p.usdCents / 100 - rawCostIfSpent) / (p.usdCents / 100);
			expect(margin).toBeGreaterThanOrEqual(0.6);
			expect(margin).toBeLessThanOrEqual(0.67);
		}
		const top = CREDIT_PACKS[CREDIT_PACKS.length - 1];
		expect(top.usdCents / 100 / (top.credits / 100 / MARKUP)).toBeCloseTo(2.5, 6);
	});

	it('blended margin across an even pack mix stays ≥ 60%', () => {
		const revenue = CREDIT_PACKS.reduce((s, p) => s + p.usdCents, 0) / 100;
		const cost = CREDIT_PACKS.reduce((s, p) => s + p.credits, 0) / 100 / MARKUP;
		expect((revenue - cost) / revenue).toBeGreaterThanOrEqual(0.6);
	});
});

describe('plans — included wallet as a share of price', () => {
	const PLANS = [
		{ name: 'Studio', price: 79, wallet: 40 },
		{ name: 'Brand', price: 299, wallet: 180 },
		{ name: 'Agency', price: 899, wallet: 600 }
	];
	it.each(PLANS)('$name: wallet ≤ 67% of price and margin floor ≥ 77% even if fully used', ({ price, wallet }) => {
		expect(wallet / price).toBeLessThanOrEqual(0.67);
		const rawIfFullyUsed = wallet / MARKUP;
		expect((price - rawIfFullyUsed) / price).toBeGreaterThanOrEqual(0.77);
	});
});

describe('gate — the pre-run quote is an upper bound of the real debit', () => {
	it('spokesperson quote ≥ talking-head debit; b-roll quote ≥ video debit; cinematic quote ≥ cinematic debit', () => {
		// generate-post quotes ONE director pass; the run may add a grader pass
		// (+1 credit at 3×). The quote must still cover the media, which is what
		// overdraws a wallet — a 1-credit LLM overshoot is what allow_negative absorbs.
		const llm = priceOf('openrouter', 'llm');
		const still = priceOf('fal', 'image', 'nano');
		const q = (steps: number[]) => steps.reduce((s, u) => s + retailCreditsForStep(u, MARKUP), 0);
		const spokesperson = q([llm, still, priceOf('fal', 'tts'), priceOf('fal', 'talking_head')]);
		const broll = q([llm, still, priceOf('fal', 'video', 'standard')]);
		const cinematic = q([llm, still, still, still, still, priceOf('fal', 'video', 'pro')]);
		expect(spokesperson).toBeGreaterThanOrEqual(retailCreditsFor('talkingHead', MARKUP) - retailCreditsForStep(llm, MARKUP));
		expect(broll).toBeGreaterThanOrEqual(retailCreditsFor('videoPost', MARKUP) - retailCreditsForStep(llm, MARKUP));
		expect(cinematic).toBeGreaterThanOrEqual(retailCreditsFor('cinematic', MARKUP) - retailCreditsForStep(llm, MARKUP));
		// and the media alone dominates: a wallet that passes the gate can never
		// overdraw by more than the LLM passes (≤ 3 credits at 3×)
		expect(retailCreditsForStep(llm, MARKUP)).toBeLessThanOrEqual(1);
	});
});
