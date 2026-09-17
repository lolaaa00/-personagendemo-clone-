/**
 * The landing page quotes prices in two places — a RECEIPT table and the
 * media-wallet FAQ — and nothing made them agree with each other or with
 * pricing.ts.
 *
 * Both failure modes shipped on 2026-09-17, in the same merge:
 *
 *   1. `59c3b2f` corrected the LLM rate from $0.002 to $0.012 and updated the
 *      FAQ prose to "about eight cents" for a text post. The RECEIPT table
 *      lived only on the feature branch, so the fix could not reach it: the
 *      merged page quoted two cents in the table and eight in the FAQ nine
 *      lines below it.
 *   2. The same merge recomputed the table to $1.58 for a video post, but the
 *      FAQ still said "roughly $2.40" — a figure inherited from a branch that
 *      had no table to reconcile against. Fixed by hand in `39233e1`.
 *
 * Both were caught by a person reading the page. money-claims.spec.ts asserts
 * what the copy must not CLAIM (nothing is free, nothing expires); this file
 * asserts the NUMBERS, against the only source that can settle them.
 *
 * The rule: every figure on that page is retail credits at the platform
 * markup, per-step ceiled exactly as the ledger debits them, divided by 100.
 * That is `retailCreditsFor` — the same function the billing page and the
 * wallet use — so a price change in pricing.ts moves this spec and the page
 * together, or fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceOf } from '$lib/pricing';
import { retailCreditsFor, retailCreditsForStep, type OutcomeKind } from '$lib/billing-packs';
import { CREDITS_PER_USD } from '$lib/money';

/**
 * The platform markup. Restated rather than imported because it is a database
 * setting (`credit_markup`) with no compile-time home — economics.spec.ts
 * states it the same way and for the same reason. If the deployed value moves,
 * both files and the page move with it.
 */
const MARKUP = 3;

const landing = readFileSync(
	join(__dirname, '..', '..', 'routes', '+page.svelte'),
	'utf8'
);

/** Retail dollars for an outcome, exactly as the ledger would debit it. */
const retailUsd = (kind: OutcomeKind) => retailCreditsFor(kind, MARKUP) / CREDITS_PER_USD;

/**
 * A text post is not an OutcomeKind: it buys no media at all. The RECEIPT row
 * states its own composition — "two LLM passes, no image charge" — so it is
 * derived from that claim rather than from a guess, and the note is asserted
 * below so the two cannot drift apart.
 */
const textPostRetailUsd =
	(2 * retailCreditsForStep(priceOf('openrouter', 'llm'), MARKUP)) / CREDITS_PER_USD;

/** The price string for one RECEIPT row, e.g. "≈ $0.08" -> 0.08. */
function receiptPrice(item: string): number {
	const row = new RegExp(`item: '${item}'[^}]*price: '([^']+)'`).exec(landing);
	expect(row, `no RECEIPT row for '${item}' — did the table move or get renamed?`).not.toBeNull();
	const n = Number(row![1].replace(/[^0-9.]/g, ''));
	expect(Number.isFinite(n), `RECEIPT '${item}' price is unparseable: ${row![1]}`).toBe(true);
	return n;
}

/** The note on one RECEIPT row. */
function receiptNote(item: string): string {
	const row = new RegExp(`item: '${item}'[^}]*note: '([^']+)'`).exec(landing);
	expect(row, `no note on RECEIPT row '${item}'`).not.toBeNull();
	return row![1];
}

describe('landing RECEIPT table agrees with pricing.ts', () => {
	it('a text post is the two LLM passes its own note claims, and nothing more', () => {
		// The note is load-bearing: it is what licenses deriving this row from
		// two LLM calls instead of an OutcomeKind. If someone adds a stage to a
		// text post, the note has to change and this assertion catches it.
		expect(receiptNote('Text post')).toMatch(/two LLM passes/i);
		expect(receiptNote('Text post')).toMatch(/no image charge/i);
		expect(receiptPrice('Text post')).toBeCloseTo(textPostRetailUsd, 2);
	});

	it('an image post is quoted at what an image post actually debits', () => {
		expect(receiptPrice('Image post')).toBeCloseTo(retailUsd('imagePost'), 2);
	});

	it('a video post is quoted at what a video post actually debits', () => {
		expect(receiptPrice('Video post')).toBeCloseTo(retailUsd('videoPost'), 2);
	});

	it('a talking head is quoted at what a talking head actually debits', () => {
		expect(receiptPrice('Talking head')).toBeCloseTo(retailUsd('talkingHead'), 2);
	});

	it('the rows are ordered cheapest to dearest, which is the claim the table makes visually', () => {
		const prices = ['Text post', 'Image post', 'Video post', 'Talking head'].map(receiptPrice);
		for (let i = 1; i < prices.length; i++) {
			expect(prices[i], `row ${i} is cheaper than the one above it`).toBeGreaterThan(prices[i - 1]);
		}
	});
});

describe('the media-wallet FAQ agrees with the table above it', () => {
	const WORD_CENTS: Record<string, number> = {
		one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
		nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
		seventy: 70, eighty: 80, ninety: 90
	};

	it('"about N cents" for a text post is the Text post row', () => {
		// This is failure mode 1. The prose and the table disagreed by 4x and
		// both shipped, because nothing compared them.
		const m = /about ([a-z]+) cents/i.exec(landing);
		expect(m, 'the FAQ no longer states a text-post price in words').not.toBeNull();
		const cents = WORD_CENTS[m![1].toLowerCase()];
		expect(cents, `unrecognised number word "${m![1]}" — add it to WORD_CENTS`).toBeDefined();
		expect(cents / 100).toBeCloseTo(receiptPrice('Text post'), 2);
	});

	it('the six-posts-a-day figure is six text posts', () => {
		const m = /six times a day spends around ([a-z]+) cents/i.exec(landing);
		expect(m, 'the FAQ no longer states a daily figure').not.toBeNull();
		const cents = WORD_CENTS[m![1].toLowerCase()];
		expect(cents, `unrecognised number word "${m![1]}"`).toBeDefined();
		// Rounded to the nearest ten cents in prose, so compare at that grain
		// rather than pretending the copy carries cent precision.
		expect(cents / 100).toBeCloseTo(6 * receiptPrice('Text post'), 1);
	});

	it('"roughly $N for a video post" is the Video post row', () => {
		// This is failure mode 2: the prose said $2.40 against a table that said
		// $1.58, which is also the talking-head row's neighbourhood — so the
		// prose was not merely stale, it was quoting a different product.
		const m = /roughly \$([0-9.]+) for a video post/i.exec(landing);
		expect(m, 'the FAQ no longer states a video-post price').not.toBeNull();
		// One decimal: the prose rounds to ten cents ("roughly $1.60" against
		// $1.58), which is honest rounding, not drift.
		expect(Number(m![1])).toBeCloseTo(receiptPrice('Video post'), 1);
	});

	it('no figure in the FAQ matches a DIFFERENT row better than its own', () => {
		// The $2.40 bug was nearer the talking-head row than the video row it
		// claimed to describe. A price that fits the wrong product is worse than
		// one that fits nothing, because it reads as deliberate.
		const m = /roughly \$([0-9.]+) for a video post/i.exec(landing);
		const quoted = Number(m![1]);
		const toVideo = Math.abs(quoted - receiptPrice('Video post'));
		const toTalkingHead = Math.abs(quoted - receiptPrice('Talking head'));
		expect(toVideo).toBeLessThan(toTalkingHead);
	});
});
