/**
 * The composer never offers a spend the seat cannot make — and says so in the
 * seat's own terms, with the SERVER's verdict.
 *
 * Every endpoint the composer resolves against demands a creator seat via
 * checkAgentAccess(..., 'creator'), and the preview call is the first thing the
 * dialog does. A viewer therefore never reaches the steps: the preview refuses
 * with 403. That refusal used to render as "Can't prepare this generation" with
 * a Retry button — a permission denial framed as an outage, with a retry that
 * cannot ever succeed. Five seat roles driven through the composer found it.
 *
 * Why the verdict is the server's and not the layout's `seat`: access is per
 * persona (agent_access_role), while the layout's seat is the account's HIGHEST
 * membership seat — an upper bound. A Viewer in one workspace who owns personas
 * of their own may generate for those; a client-side gate on the seat would
 * block them. The server already decides at preview time; the composer only has
 * to render that decision as a designed state.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilities, seatBlockedReason, FULL_ACCESS } from '$lib/seat';

const SRC = readFileSync(
	join(__dirname, 'components', 'generation', 'GenerationComposer.svelte'),
	'utf8'
);
const WORKSPACES = readFileSync(join(__dirname, 'server', 'workspaces.ts'), 'utf8');

describe('seat capabilities agree with what the spend routes enforce', () => {
	it('a viewer cannot create, everyone from creator up can', () => {
		expect(capabilities('viewer').canCreate).toBe(false);
		for (const r of ['creator', 'manager', 'admin', 'owner'] as const) {
			expect(capabilities(r).canCreate, r).toBe(true);
		}
	});

	it('the blocked reason names the seat and what is needed, never "Forbidden"', () => {
		const reason = seatBlockedReason(capabilities('viewer'), 'creator');
		expect(reason).toMatch(/Viewer/);
		expect(reason).toMatch(/Creator/);
		expect(reason).toMatch(/workspace admin/i);
		expect(reason).not.toMatch(/forbidden|403/i);
	});

	it('is null for every seat that may spend — a gate must never over-block', () => {
		for (const r of ['creator', 'manager', 'admin', 'owner'] as const) {
			expect(seatBlockedReason(capabilities(r), 'creator'), r).toBeNull();
		}
		expect(seatBlockedReason(FULL_ACCESS, 'creator')).toBeNull();
	});
});

describe('the server refuses a seat with 403 and the composer reads exactly that', () => {
	it('checkAgentAccess answers an insufficient role with status 403 and a sentence', () => {
		// The composer keys its designed denial off this status. If the server ever
		// moved to another code, the denial would silently degrade to "Retry".
		const refusal = WORKSPACES.slice(WORKSPACES.indexOf('if (!roleAtLeast(role, minRole))'));
		expect(refusal).toMatch(/status:\s*403/);
		expect(refusal).toMatch(/message:\s*`This action requires \$\{minRole\}\+ access/);
	});

	it('reads the refusal from the response, never from the layout seat', () => {
		expect(SRC).toMatch(/loadBlockedBySeat = res\.status === 403 && data\?\.success === false/);
		expect(SRC).not.toMatch(/seatBlockedReason|\$page\.data\?\.seat/);
	});

	it('resets the verdict on every resolve, so switching persona re-decides', () => {
		const fn = SRC.slice(
			SRC.indexOf('async function loadPreview()'),
			SRC.indexOf('const res = await fetch')
		);
		expect(fn).toMatch(/loadBlockedBySeat = false;/);
	});
});

describe('the seat denial is a designed state, not an outage', () => {
	const card = SRC.slice(SRC.indexOf('{:else if loadError}'), SRC.indexOf('{:else if preview}'));

	it('exists at all (an empty slice would pass every negative below)', () => {
		expect(card.length).toBeGreaterThan(200);
	});

	it('names the seat in the headline', () => {
		expect(card).toMatch(/loadBlockedBySeat\s*\?\s*'Your seat cannot generate for this persona'/);
	});

	it('offers no Retry for a seat refusal, and says who can change it', () => {
		const seatBranch = card.slice(
			card.indexOf('{:else if loadBlockedBySeat}'),
			card.lastIndexOf('{:else}')
		);
		expect(seatBranch.length).toBeGreaterThan(0);
		expect(seatBranch).not.toMatch(/Retry|loadPreview\(\)/);
		expect(seatBranch).toMatch(/workspace admin/i);
	});

	it('keeps Retry for the genuinely transient failure', () => {
		const tail = card.slice(card.lastIndexOf('{:else}'));
		expect(tail).toMatch(/onclick=\{\(\) => loadPreview\(\)\}>Retry</);
	});

	it('the confirm carries the reason and can never enable without a preview', () => {
		const btn = SRC.slice(SRC.indexOf('disabled={submitting ||'), SRC.indexOf('onclick={confirm}'));
		expect(btn.length).toBeGreaterThan(0);
		expect(btn).toMatch(/!preview/);
		expect(btn).toMatch(/title=\{loadBlockedBySeat\s*\?\s*loadError/);
	});
});
