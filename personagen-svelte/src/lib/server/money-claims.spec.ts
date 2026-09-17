/**
 * Every money claim the product makes in writing must be true of the pipeline.
 *
 * Method, from the concurrent audit and sharpened after it beat severity-ranking
 * twice: take each written claim and find the line that must enforce it. A
 * claim with no enforcing line is either false or unverifiable. Applied to my
 * own copy it found two false ones, both mine:
 *
 *   "Text posts are free"          — a text post runs the Director and the
 *                                    grader, so it debits 2 credits. Free was
 *                                    never true; the card is free, the writing
 *                                    is not.
 *   "Failed runs are not charged"  — recordCostEvents flushes in a `finally`,
 *                                    so a run that dies after buying images is
 *                                    charged for them. That is correct (the
 *                                    provider was paid) and the sentence was
 *                                    not.
 *
 * These assertions fail if the copy drifts back, or if a pricing change makes a
 * true claim false.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceOf } from '$lib/pricing';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const landing = read('routes', '+page.svelte');
const billing = read('routes', '(portal)', 'billing', '+page.svelte');
const generate = read('lib', 'server', 'content', 'generate.ts');

describe('what a text post actually costs', () => {
	it('is not zero: the Director and the grader both bill', () => {
		// The card itself renders locally for $0; the writing does not.
		expect(priceOf('local', 'image')).toBe(0);
		expect(priceOf('openrouter', 'llm')).toBeGreaterThan(0);
		const textPostUsd = 2 * priceOf('openrouter', 'llm');
		expect(textPostUsd).toBeGreaterThan(0);
	});

	it('no surface claims text posts are free', () => {
		for (const [name, copy] of [['landing', landing], ['billing', billing]] as const) {
			expect(copy, `${name} still claims text posts are free`).not.toMatch(/text posts?[^.]{0,40}\b(are|is)\s+(always\s+)?free/i);
			expect(copy, `${name} still claims text posts cost nothing`).not.toMatch(/text posts? cost nothing/i);
		}
	});
});

describe('what happens to a run that fails partway', () => {
	it('the ledger is flushed in a finally, so work already paid for is charged', () => {
		// This is the correct behaviour — the provider took the money — which is
		// exactly why the copy had to change rather than the code.
		const idx = generate.indexOf('recordCostEvents');
		expect(idx).toBeGreaterThan(-1);
		expect(generate).toMatch(/finally\s*\{[\s\S]{0,400}recordCostEvents/);
	});

	it('no surface promises that failed runs are never charged', () => {
		expect(billing).not.toMatch(/failed runs are not charged/i);
	});
});

describe('claims that ARE enforced stay enforced', () => {
	it('"never expires" has no expiry mechanism to contradict it', () => {
		const credits = read('lib', 'server', 'credits.ts');
		expect(credits).not.toMatch(/expir/i);
	});

	it('"at par" is true of every pack: credits delivered >= cents paid', async () => {
		const { CREDIT_PACKS } = await import('$lib/billing-packs');
		for (const p of CREDIT_PACKS) expect(p.credits).toBeGreaterThanOrEqual(p.usdCents);
		expect(billing).toMatch(/\$25 buys \$25\.00/);
	});
});

describe('"Cancel any time" has a line behind it', () => {
	const route = read('routes', 'api', 'billing', 'cancel', '+server.ts');
	const stripe = read('lib', 'server', 'stripe.ts');

	it('the promise appears on the pricing page and on billing', () => {
		expect(landing).toMatch(/cancel any time/i);
		expect(billing).toMatch(/cancel any time/i);
	});

	it('a cancellation route exists and reaches Stripe', () => {
		// It promised cancellation for months with no route, no portal link, and
		// subscribe answering "Contact us to change plans".
		expect(route).toContain('cancelSubscriptionAtPeriodEnd');
		expect(stripe).toContain('cancel_at_period_end: true');
	});

	it('cancels at period end, not immediately — the month was paid for', () => {
		expect(stripe).not.toMatch(/method:\s*'DELETE'[\s\S]{0,80}subscriptions/);
		expect(route).toContain('resume');
		expect(stripe).toContain('cancel_at_period_end: false');
	});

	it('the billing page offers it rather than hiding it behind support', () => {
		expect(billing).toContain("setCancellation(false)");
		expect(billing).toMatch(/Cancel plan/);
	});
});

describe('"Only what actually ran" — a call that threw did not run', () => {
	const generate = read('lib', 'server', 'content', 'generate.ts');
	const metering = read('lib', 'server', 'metering.ts');

	it('the billing page still makes the promise', () => {
		expect(billing).toMatch(/Only what actually ran/i);
	});

	it('both metering wrappers record AFTER the provider returns', () => {
		// trackAi used to push the cost BEFORE awaiting, so a provider call that
		// threw was billed anyway — the exact opposite of the sentence above, and
		// a disagreement with meteredCall, which already recorded only on success.
		const track = generate.slice(generate.indexOf('function trackAi'), generate.indexOf('function trackAi') + 900);
		expect(track).toMatch(/const out = await ai\.generate\(prompt, \{ \.\.\.opts/);
		expect(track.indexOf('await ai.generate')).toBeLessThan(track.indexOf('costEvents.push'));
		expect(metering).toMatch(/const out = await ai\.generate\(prompt, \{ \.\.\.opts/);
		expect(metering.indexOf('await ai.generate')).toBeLessThan(metering.indexOf('recordCostEvents('));
	});

	it('a call that succeeded is still recorded when a later step dies', () => {
		// The other half of the promise: the ledger flushes in a finally, so work
		// already paid for is billed even though the run failed overall.
		expect(generate).toMatch(/finally \{[\s\S]{0,200}recordCostEvents\(/);
	});
});
