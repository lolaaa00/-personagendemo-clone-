/**
 * Every user-triggered path that spends must say what it will cost BEFORE it
 * spends it.
 *
 * The inner gate inside the generation path passes no estimate, so it defaults
 * to one credit — it rejects an EMPTY wallet and nothing else. That is by
 * design, and it is only safe while the route above it quotes the real run.
 * Four paths did not: refine-post, generate-avatar, generate-reference-kit and
 * autopilot's generate_now. A wallet holding a single credit could start a
 * multi-image job and finish it overdrawn, with only the NEXT run refused.
 *
 * These are source-level assertions on purpose: the alternative is booting the
 * whole generation pipeline to prove an arithmetic gate, and what actually
 * regressed here was a missing call, not a wrong number.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (...p: string[]) => readFileSync(new URL(`../../${p.join('/')}`, import.meta.url), 'utf-8');

const routes = {
	'generate-post': read('routes', 'api', 'agent', '[agentId]', 'generate-post', '+server.ts'),
	'refine-post': read('routes', 'api', 'agent', '[agentId]', 'refine-post', '+server.ts'),
	autopilot: read('routes', 'api', 'autopilot', '+server.ts')
};
const generate = read('lib', 'server', 'content', 'generate.ts');

describe('the files under test were actually read', () => {
	it.each(Object.entries(routes))('%s is non-empty and is the route it claims to be', (_name, src) => {
		expect(src.length).toBeGreaterThan(500);
		expect(src).toContain('RequestHandler');
	});

	it('generate.ts is the real one', () => {
		expect(generate.length).toBeGreaterThan(50_000);
		expect(generate).toContain('runBudgetedAssetJob');
	});
});

describe('a route that spends quotes first', () => {
	it.each(Object.entries(routes))('%s calls assertWithinBudget with a real estimate', (name, src) => {
		expect(src, `${name} never gates`).toContain('assertWithinBudget(');
		// creditsFor(...) of something — not the bare 1-credit default.
		expect(src, `${name} gates without quoting`).toMatch(/assertWithinBudget\([^)]*creditsFor\(/);
	});

	it.each(Object.entries(routes))('%s answers 402 with somewhere to go', (name, src) => {
		expect(src, `${name} has no INSUFFICIENT_CREDITS branch`).toContain('INSUFFICIENT_CREDITS');
		expect(src, `${name} refuses without a billing link`).toContain("billingUrl: '/billing'");
		expect(src).toContain('402');
	});

	it('refine quotes the media it is about to re-roll, not a flat number', () => {
		// A re-roll is a new image plus a new clip; pricing it as one image would
		// let a wallet start a video it cannot pay for.
		expect(routes['refine-post']).toContain('refineUsd');
		expect(routes['refine-post']).toMatch(/priceOf\('fal', 'video'|priceOf\('fal', 'talking_head'\)/);
	});

	it('autopilot quotes a whole pack before it detaches', () => {
		// generate_now 202s immediately and chains one pack per empty slot, so the
		// quote has to happen before the dispatch, not inside the detached run.
		const a = routes.autopilot;
		expect(a).toContain('packUsd');
		expect(a.indexOf('assertWithinBudget(')).toBeLessThan(a.indexOf('runAutopilotDraftGeneration({ agentId })'));
	});
});

describe('the asset jobs quote the images they are about to run', () => {
	it('runBudgetedAssetJob takes an estimate and uses it', () => {
		expect(generate).toMatch(/estimatedUsd\s*=\s*0/);
		expect(generate).toMatch(/assertWithinBudget\(supabase, userId, agentId, estimatedUsd > 0 \? creditsFor\(estimatedUsd\) : 1\)/);
	});

	it('every call site passes one', () => {
		// Three jobs: portrait, character sheet, kit stage. A fourth added without
		// a quote would leave this count behind.
		// The generic definition reads `runBudgetedAssetJob<T>(`, so this counts
		// call sites only: portrait, character sheet, kit stage.
		const calls = generate.split('runBudgetedAssetJob(').length - 1;
		expect(calls).toBe(3);
		expect(generate).toContain('async function runBudgetedAssetJob<T>(');
		expect(generate).toContain('portraitQuoteUsd');
		expect(generate).toContain('sheetQuoteUsd');
	});

	it('the portrait quote counts all three paid images, not just the first', () => {
		// hero portrait on the chosen model, then sheet and hero shot on nano.
		expect(generate).toMatch(/portraitQuoteUsd = portraitModel\.usd \+ 2 \* priceOf\('fal', 'image', 'nano'\)/);
	});
});

describe('attribution loss is not filed as an analytics blip', () => {
	it('dropping a money column while credits are on is an error, not a warning', () => {
		// The debit still fires from the in-memory value, so the money moves while
		// the row it is keyed to cannot be attributed — invisible to every
		// reconciliation view, which filters on key_source = 'platform'.
		expect(generate).toContain('ATTRIBUTION LOST');
		expect(generate).toMatch(/const money = \[\.\.\.dropped\]\.filter/);
	});
});
