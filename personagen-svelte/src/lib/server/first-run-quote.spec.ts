/**
 * A persona's FIRST post must quote what it will actually charge.
 *
 * With no pinned face, generateUgcPack calls ensureCharacterRef mid-run, which
 * runs generateCharacterPortrait: three paid image calls (hero portrait,
 * character sheet, avatar hero shot), each billed to the wallet through
 * generation_events. None of them appeared in the composer's quote, so the
 * first image post for a persona quoted about a quarter of what it debited —
 * and every later post for that persona quoted correctly, which is the shape
 * that keeps a pricing bug hidden.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceOf } from '$lib/pricing';
import { FORMAT_CATALOG, planPipeline, planTotalUsd } from '$lib/formats';

const IDENTITY_CALLS = 3;
const nano = priceOf('fal', 'image', 'nano');
const llm = priceOf('openrouter', 'llm');

describe('the size of the gap this closes', () => {
	it('an unquoted identity set is most of a first image post’s real cost', () => {
		const quotedBefore = llm + nano; // director + still
		const actual = quotedBefore + IDENTITY_CALLS * nano;
		expect(actual / quotedBefore).toBeGreaterThan(3); // ~3.9x
	});

	it('quoting it makes the first post’s quote equal its charge', () => {
		const quotedNow = llm + IDENTITY_CALLS * nano + nano;
		expect(quotedNow).toBeCloseTo(llm + nano + IDENTITY_CALLS * nano, 6);
	});
});

describe('the route quotes and gates it', () => {
	const route = readFileSync(
		join(
			__dirname,
			'..',
			'..',
			'routes',
			'api',
			'agent',
			'[agentId]',
			'generate-post',
			'+server.ts'
		),
		'utf8'
	);

	it('quotes three one-off identity steps only when no face is pinned', () => {
		// The hand-built per-format step arrays this originally guarded were
		// replaced by planPipeline (one catalog, one planner). The invariant did
		// not change: these three calls must reach the quote. They now ride
		// PlanInput.oneOffs — stages that belong to no FORMAT but will run on THIS
		// run — and are shipped with the plan so the composer re-prices to the same
		// number instead of recomputing a real charge client-side.
		expect(route).toContain('const needsIdentitySet = useCharacter && !characterRef;');
		for (const step of [
			'identity: hero portrait (one-off)',
			'identity: character sheet (one-off)',
			'identity: avatar hero shot (one-off)'
		]) {
			expect(route).toContain(step);
		}
		expect(route).toContain('oneOffs,');
		expect(route).toMatch(/const oneOffs: PipelineStep\[\] = needsIdentitySet/);
	});

	it('includes the same cost in the pre-run credit gate', () => {
		// Quoting it but not gating it would still let a thin wallet start a run
		// it cannot pay for, which is the failure the gate exists to prevent.
		expect(route).toContain("identityUsd = 3 * priceOf('fal', 'image', 'nano')");
		expect(route).toMatch(/const roughUsd =\s*\n?\s*identityUsd \+/);
	});

	it('skips it for a graphic still or a supplied reference, which never trigger the chain', () => {
		const gate = route.slice(
			route.indexOf('let identityUsd = 0;'),
			route.indexOf('const roughUsd')
		);
		expect(gate).toContain('genInput.characterRefOverride');
		expect(gate).toContain("genInput.stillStyle !== 'graphic'");
	});
});

describe('the text calls that always run are quoted', () => {
	const route = readFileSync(
		join(
			__dirname,
			'..',
			'..',
			'routes',
			'api',
			'agent',
			'[agentId]',
			'generate-post',
			'+server.ts'
		),
		'utf8'
	);

	it('the PREVIEW quotes the Director AND the pre-media grader, because both always run', () => {
		// This is the assertion the original guarded, and it must be about the
		// QUOTE, not the gate. gradeDraftWithRetry() runs unconditionally before
		// any media is bought, on both the standard and cinematic paths. The
		// route's hand-built step arrays were replaced by planPipeline, and for a
		// while the grader lived in the credit gate and nowhere in the plan — so
		// the composer showed a price one text call short on EVERY format while
		// the gate looked correct. It is a stage now, which is the only way the
		// preview and the run can agree. Retries stay unquoted on purpose.
		for (const f of FORMAT_CATALOG) {
			if (!f.steps.includes('director')) continue;
			expect(f.steps, `${f.id} quotes a Director with no grader`).toContain('grader');
		}
		const text = { id: 'm', label: 'm', usd: llm, provider: 'openrouter' };
		const steps = planPipeline({
			formatId: 'photo',
			fixed: {
				director: text,
				grader: text,
				still: { id: 'n', label: 'n', usd: nano, provider: 'fal' }
			}
		});
		expect(steps.filter((s) => s.usd === llm)).toHaveLength(2);
		expect(planTotalUsd(steps)).toBeCloseTo(2 * llm + nano, 6);
	});

	it('the gate counts both text calls as well', () => {
		// Named once so a future branch cannot reintroduce the asymmetry by copying
		// the wrong neighbour — one branch used to count a single call, and it was
		// the branch that also bought a video.
		expect(route).toContain("const llm2 = 2 * priceOf('openrouter', 'llm');");
		const gate = route.slice(
			route.indexOf('const roughUsd ='),
			route.indexOf('assertWithinBudget')
		);
		expect(gate).not.toMatch(/[^2] \* priceOf\('openrouter', 'llm'\)/);
	});
});
