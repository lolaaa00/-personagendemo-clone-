/**
 * Credit packs + retail cost of outcomes — client-safe (no server imports).
 *
 * Credits are retail cents (1 credit = $0.01 at retail), so every pack sells
 * AT PAR: the amount the customer sees on the wallet pill after buying is the
 * amount they paid. Larger packs carry a bonus — the standard wallet-SaaS
 * ladder (Runway, Higgsfield, Kling all do this) — which raises average order
 * value more than it costs in margin: at a 3× markup a 20% bonus still leaves
 * the top pack at 2.5× raw cost (60% gross margin).
 *
 * Retail cost of an outcome is computed EXACTLY the way the ledger debits it:
 * per step, ceil(raw × markup × 100), summed — from the same PRICING_MATRIX
 * the server bills from. No second copy of any price lives here.
 *
 * Packs are charged in USD (Stripe presents the local currency at checkout
 * when adaptive pricing is on); the app shows the equivalent in the visitor's
 * currency next to the USD price so nothing is a surprise.
 */

import { priceOf } from './pricing';

export interface CreditPack {
	id: string;
	/** Price in USD cents, charged by Stripe. */
	usdCents: number;
	/** Credits delivered (retail cents), including bonus. */
	credits: number;
	/** Bonus credits included in `credits` (0 for the entry pack). */
	bonus: number;
	label: string;
	/** Which pack the page highlights. */
	featured?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
	{ id: 'pack_10', usdCents: 1_000, credits: 1_000, bonus: 0, label: 'Starter' },
	{ id: 'pack_25', usdCents: 2_500, credits: 2_600, bonus: 100, label: 'Creator', featured: true },
	{ id: 'pack_50', usdCents: 5_000, credits: 5_500, bonus: 500, label: 'Studio' },
	{ id: 'pack_100', usdCents: 10_000, credits: 12_000, bonus: 2_000, label: 'Brand' }
];

export function packById(id: string | null | undefined): CreditPack | null {
	return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

/** Bonus as a whole percentage of the base credits (for the badge). */
export function bonusPercent(p: CreditPack): number {
	return p.bonus > 0 ? Math.round((p.bonus / (p.credits - p.bonus)) * 100) : 0;
}

/** Same rounding as server/credits.ts creditsFor(): ceil per step, float-noise safe. */
export function retailCreditsForStep(rawUsd: number, markup: number): number {
	const n = Number(rawUsd);
	if (!Number.isFinite(n) || n <= 0) return 0;
	const m = Number.isFinite(markup) && markup >= 1 ? markup : 1;
	return Math.ceil(+(n * m * 100).toFixed(6));
}

export type OutcomeKind = 'imagePost' | 'videoPost' | 'talkingHead' | 'cinematic' | 'persona';

/**
 * The paid steps of each outcome, in raw USD, mirroring the pipelines the
 * composer preview quotes (generate-post) and the persona routes run.
 * LLM passes: the director plus the QC grader (a retry is possible but not
 * typical), so two calls are quoted rather than one.
 */
export function outcomeSteps(kind: OutcomeKind): number[] {
	const llm = priceOf('openrouter', 'llm');
	const still = priceOf('fal', 'image', 'nano');
	switch (kind) {
		case 'imagePost':
			return [llm, llm, still];
		case 'videoPost':
			return [llm, llm, still, priceOf('fal', 'video', 'standard')];
		case 'talkingHead':
			return [llm, llm, still, priceOf('fal', 'tts'), priceOf('fal', 'talking_head')];
		case 'cinematic':
			return [llm, llm, still, still, still, still, priceOf('fal', 'video', 'pro')];
		case 'persona':
			// avatar edit + hero shot, then the 4-stage reference kit
			return [still, still, still, still, still, still];
	}
}

/** Retail credits an outcome will debit at a markup (sum of per-step ceils). */
export function retailCreditsFor(kind: OutcomeKind, markup: number): number {
	return outcomeSteps(kind).reduce((s, usd) => s + retailCreditsForStep(usd, markup), 0);
}

/** Raw provider USD of an outcome (what we pay). */
export function rawUsdFor(kind: OutcomeKind): number {
	return +outcomeSteps(kind).reduce((s, usd) => s + usd, 0).toFixed(6);
}

/**
 * "What does this buy?" — so the page can say "≈ 40 image posts or 8 video
 * posts" instead of a number. Text cards are $0 and never counted.
 */
export function whatItBuys(
	credits: number,
	markup: number,
	/**
	 * Per-stage USD from the live registry (server/outcome-prices.ts). When
	 * given, it replaces the static table for that outcome — the table priced a
	 * video post at $1.58 that the composer never charged (round-2 re-audit).
	 */
	liveSteps?: Partial<Record<'imagePost' | 'videoPost' | 'talkingHead', number[]>>
) {
	const per = (k: OutcomeKind) => {
		const steps = (liveSteps as Partial<Record<OutcomeKind, number[]>> | undefined)?.[k];
		const credits = steps
			? steps.reduce((s, usd) => s + retailCreditsForStep(usd, markup), 0)
			: retailCreditsFor(k, markup);
		return Math.max(1, credits);
	};
	const c = Math.max(0, Number(credits) || 0);
	return {
		imagePosts: Math.floor(c / per('imagePost')),
		videoPosts: Math.floor(c / per('videoPost')),
		talkingHeads: Math.floor(c / per('talkingHead')),
		textCards: Infinity
	};
}
