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
		join(__dirname, '..', '..', 'routes', 'api', 'agent', '[agentId]', 'generate-post', '+server.ts'),
		'utf8'
	);

	it('quotes three one-off identity steps only when no face is pinned', () => {
		expect(route).toContain('const needsIdentitySet = useCharacter && !characterRef;');
		for (const step of ['identity: hero portrait (one-off)', 'identity: character sheet (one-off)', 'identity: avatar hero shot (one-off)']) {
			expect(route).toContain(step);
		}
		expect(route).toContain('...identitySteps,');
	});

	it('includes the same cost in the pre-run credit gate', () => {
		// Quoting it but not gating it would still let a thin wallet start a run
		// it cannot pay for, which is the failure the gate exists to prevent.
		expect(route).toContain("identityUsd = 3 * priceOf('fal', 'image', 'nano')");
		expect(route).toContain('const roughUsd = identityUsd +');
	});

	it('skips it for a graphic still or a supplied reference, which never trigger the chain', () => {
		const gate = route.slice(route.indexOf('let identityUsd = 0;'), route.indexOf('const roughUsd'));
		expect(gate).toContain('genInput.characterRefOverride');
		expect(gate).toContain("genInput.stillStyle !== 'graphic'");
	});
});
