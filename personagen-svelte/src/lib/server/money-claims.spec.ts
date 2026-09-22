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
import { PROVIDER_CATALOGUE } from '$lib/providers';
import { PIPELINE_META, PIPELINE_USD, WRITING_USD } from '$lib/studio-templates';

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

	it('the Studio prices the writing it pays for, on every tile (audit UX-001)', () => {
		// The audit's lead finding: the Studio labelled 'Text card' Free while
		// /billing said eight cents and the docs said every format spends. Both
		// the display string and the number the composer and Campaign Planner
		// actually sum must carry the writing — the planner quoted a month of text
		// posts at exactly $0 because PIPELINE_USD['Text card'] was 0.
		const textPostUsd = 2 * priceOf('openrouter', 'llm');
		expect(WRITING_USD).toBeCloseTo(textPostUsd, 6);
		for (const [pipeline, usd] of Object.entries(PIPELINE_USD)) {
			expect(usd, `${pipeline} prices below its own writing`).toBeGreaterThanOrEqual(WRITING_USD);
		}
		for (const [pipeline, meta] of Object.entries(PIPELINE_META)) {
			expect(meta.usd, `${pipeline} tile says Free`).not.toMatch(/free/i);
		}
		const studio = read('routes', '(portal)', 'personas', '[agentId]', '+page.svelte');
		expect(studio).not.toContain("'No media cost'");
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

describe('customer BYOK for generation is withdrawn, and the copy says so', () => {
	const persona = read('routes', '(portal)', 'personas', '[agentId]', '+page.svelte');
	const guides = read('routes', '(portal)', 'guides', '+page.svelte');
	const demo = read('lib', 'components', 'docs', 'KeyRoutingDemo.svelte');

	it('the catalogue holds the rule every sentence below depends on', () => {
		// Bring your own key where the key is an IDENTITY, never where it is a
		// COST. If a cost provider is ever re-opened this fails FIRST, which is
		// the point: the sentences after it go false at the same moment.
		const costly = PROVIDER_CATALOGUE.filter((p) => p.billsToUserKey);
		expect(costly.length, 'no cost providers — the scan would be vacuous').toBeGreaterThan(0);
		for (const p of costly) {
			expect(p.byok.supported, `${p.id} bills a user key AND still allows BYOK`).toBe(false);
		}
		// and the one key a customer may still bring never carries a per-call cost
		const byok = PROVIDER_CATALOGUE.filter((p) => p.byok.supported);
		expect(byok.length, 'nothing is BYOK-able — Zernio should be').toBeGreaterThan(0);
		for (const p of byok) expect(p.billsToUserKey, `${p.id}`).toBe(false);
	});

	it('no customer surface still says a key of theirs pays for a generation', () => {
		for (const [name, copy] of [
			['billing', billing],
			['persona Studio', persona],
			['guides', guides],
			['docs demo', demo]
		] as const) {
			expect(copy.length, `${name} was not read`).toBeGreaterThan(500);
			expect(copy, name).not.toMatch(/your own provider account/i);
			expect(copy, name).not.toMatch(/never charged to your wallet/i);
			expect(copy, name).not.toMatch(/you pay the provider directly/i);
			expect(copy, name).not.toMatch(/runs on YOUR key/);
			expect(copy, name).not.toMatch(/ALWAYS wins over the platform key/i);
		}
	});

	it('no guide still teaches a customer to save a withdrawn provider key', () => {
		// The phrase scan above ran green while an entire guide — "Get an
		// OpenRouter key", nine steps ending "Once saved, YOUR key pays — not the
		// wallet" — sat untouched in the same file. It was missed because the scan
		// looked for sentences somebody had thought to list, and this one used
		// different words.
		//
		// So this derives the forbidden names from the catalogue instead of
		// listing them: any provider whose customer BYOK is withdrawn must not
		// appear in the docs as something to obtain, paste or save. Re-open one in
		// providers.ts and this goes green again on its own.
		const withdrawn = PROVIDER_CATALOGUE.filter((p) => p.keyProvider && !p.byok.supported);
		expect(withdrawn.length, 'nothing withdrawn — the scan would be vacuous').toBeGreaterThan(0);
		for (const p of withdrawn) {
			// Provider labels are plain words today; escaped anyway so adding one
			// with punctuation cannot quietly turn this scan into a wildcard.
			const label = p.label.replace(/[^\w\s]/g, (c) => '\\' + c);
			for (const pattern of [
				new RegExp(`Get an? ${label}[^']{0,20}key`, 'i'),
				new RegExp(`paste your ${label}[^']{0,20}key`, 'i'),
				new RegExp(`Find the ${label} card`, 'i')
			]) {
				expect(guides, `${p.label}: ${pattern}`).not.toMatch(pattern);
			}
		}
		// And the specific claim that outlived the first sweep.
		expect(guides).not.toMatch(/YOUR key pays/i);
	});

	it('the Studio names the wallet the SERVER resolved, never a key it probed', () => {
		// It used to fetch /api/settings/api-keys from the browser and conclude
		// "your own key pays" from a row that is now inert — a money claim built
		// on a fact the server had already overruled.
		expect(persona).not.toContain('api/settings/api-keys');
		expect(persona).toContain('data.credits?.paid_by');
		expect(persona).toContain('agent.workspace_id');
	});

	it('billing answers whose wallet is charged, since that is the live question', () => {
		expect(billing).toContain('Whose wallet is charged?');
		expect(billing).toMatch(/workspace/i);
	});

	it('the docs teach persona → workspace → owner, not two purses', () => {
		expect(guides).toContain('Which wallet pays for a generation?');
		expect(demo).toContain('inWorkspace');
		expect(demo).not.toContain('ownWriting');
		expect(demo).toMatch(/resolveBillingAccount/);
	});
});
