/**
 * Credit packs — client-safe (no server imports).
 *
 * Credits are retail cents (1 credit = $0.01 at retail), so every pack sells
 * AT PAR: the amount the customer sees on the wallet pill after buying is the
 * amount they paid. Larger packs carry a bonus — the standard wallet-SaaS
 * ladder (Runway, Higgsfield, Kling all do this) — which raises average order
 * value more than it costs in margin: at a 3× markup a 20% bonus still leaves
 * the top pack at 2.5× raw cost.
 *
 * Packs are charged in USD (Stripe presents the local currency at checkout
 * when adaptive pricing is on); the app shows the equivalent in the visitor's
 * currency next to the USD price so nothing is a surprise.
 */

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

/**
 * "What does this buy?" — rough retail prices per outcome at a given markup,
 * so the page can say "≈ 40 image posts or 8 video posts" instead of a number.
 * Raw estimates: image post ≈ $0.082 (still + director), video post ≈ $0.50
 * (still + director + b-roll clip), talking head ≈ $0.81. Text cards are $0.
 */
export function whatItBuys(credits: number, markup: number) {
	const m = Number.isFinite(markup) && markup >= 1 ? markup : 1;
	const per = (rawUsd: number) => Math.ceil(rawUsd * m * 100);
	return {
		imagePosts: Math.floor(credits / per(0.082)),
		videoPosts: Math.floor(credits / per(0.5)),
		talkingHeads: Math.floor(credits / per(0.81)),
		textCards: Infinity
	};
}
