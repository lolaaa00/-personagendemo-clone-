/**
 * The review queue answers to the seat model — server first, page second.
 *
 * Measured on 2026-09-17 with the UX audit tenant (one owner, admin, manager,
 * creator and viewer seats on one workspace holding nine drafts): every member
 * seat got `total: 0` and "Queue is clear" from /review, and a manager's reject
 * was answered 404 "No matching drafts (already reviewed?)". The route filtered
 * `.eq('user_id', user.id)` on both GET and POST, so the queue was owner-only —
 * the seat whose whole purpose is approving could not see anything to approve,
 * while the persona page (RLS only) showed the same seat all six personas.
 *
 * The fix is in three layers, and each has to stay true:
 *  1. GET lists what RLS lets the seat see and carries the seat's role per post.
 *  2. POST checks manager access per persona before any update, and refuses the
 *     whole batch with the seat sentence — never "already reviewed?".
 *  3. The page disables every decision control for a row the seat cannot
 *     decide, with the reason, and tells a read-only seat once, up front.
 * Plus the persona page's seat is now that persona's role, not the layout's
 * upper bound.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilities, seatBlockedReason } from '$lib/seat';

const ROUTES = join(__dirname, '..', '..', 'routes');
const API = readFileSync(join(ROUTES, 'api', 'review', '+server.ts'), 'utf8');
// Code only: the route documents the old owner filter in a comment, and a
// comment cannot filter anything.
const API_CODE = API.replace(/^\s*\/\/.*$/gm, '');
const PAGE = readFileSync(join(ROUTES, '(portal)', 'review', '+page.svelte'), 'utf8');
const PERSONA = readFileSync(
	join(ROUTES, '(portal)', 'personas', '[agentId]', '+page.server.ts'),
	'utf8'
);
const DRAWER = readFileSync(
	join(__dirname, '..', 'components', 'feed', 'PostDrawer.svelte'),
	'utf8'
);

describe('the seat model says who decides', () => {
	it('approve/reject/restore is manager and above', () => {
		expect(capabilities('manager').canPublish).toBe(true);
		expect(capabilities('admin').canPublish).toBe(true);
		expect(capabilities('creator').canPublish).toBe(false);
		expect(capabilities('viewer').canPublish).toBe(false);
	});

	it('the reason names the seat and what would be needed', () => {
		const r = seatBlockedReason(capabilities('creator'), 'manager');
		expect(r).toMatch(/Creator/);
		expect(r).toMatch(/Manager/);
		expect(seatBlockedReason(capabilities('manager'), 'manager')).toBeNull();
	});
});

describe('/api/review is scoped by RLS and the seat, not by ownership', () => {
	it('never filters posts to the caller as owner', () => {
		// This one line was the whole bug. Twice.
		expect(API_CODE).not.toMatch(/eq\('user_id',\s*user\.id\)/);
	});

	it('GET resolves the role per persona and never over-grants an unresolved one', () => {
		const get = API.slice(API.indexOf('export const GET'), API.indexOf('export const POST'));
		expect(get).toMatch(/getAgentRole\(locals\.supabase, user\.id, id\)\) \?\? 'viewer'/);
		expect(get).toMatch(/role: roleByAgent\.get\(d\.agent_id\) \?\? 'viewer'/);
	});

	it('POST checks manager access per persona BEFORE the update, and refuses the batch', () => {
		const post = API.slice(API.indexOf('export const POST'));
		const check = post.indexOf("checkAgentAccess(locals.supabase, user.id, agentId, 'manager')");
		const update = post.indexOf('.update({ status: newStatus })');
		expect(check).toBeGreaterThan(0);
		expect(update).toBeGreaterThan(check);
		const guard = post.slice(check, update);
		expect(guard).toMatch(
			/return json\(\{ success: false, error: access\.message \}, \{ status: access\.status \}\)/
		);
	});
});

describe('the review page offers a decision only where the seat may make it', () => {
	// One opening tag per chunk: from `<button` to its `</button>` (or a bounded
	// slice), so a gate on a NEIGHBOURING element can never vouch for this one.
	const decisionButtons = PAGE.split('<button')
		.map((chunk) =>
			chunk.slice(0, chunk.indexOf('</button>') > 0 ? chunk.indexOf('</button>') : 600)
		)
		.filter((tag) =>
			/act\('approve'|act\('restore'|rejectOne\(|openRejectPicker\(|deletePost\(|deleteSelected/.test(
				tag
			)
		);

	it('finds the decision controls at all (the sample size is the assertion)', () => {
		// grid 3 · table 4 · board 3 · deck 2 · bulk 3 — an empty match list would
		// make every check below vacuous.
		expect(decisionButtons.length).toBeGreaterThanOrEqual(15);
	});

	it('every decision control is gated on the row (or the selection) with a reason', () => {
		const ungated = decisionButtons.filter((tag) => !/blockFor\(|bulkBlock/.test(tag));
		expect(ungated.map((c) => c.slice(0, 80))).toEqual([]);
	});

	it('the gate reads the server role with the never-brick default', () => {
		expect(PAGE).toMatch(/seatBlockedReason\(capabilities\(item\.role \?\? 'owner'\), 'manager'\)/);
	});

	it('a read-only seat is told once, up front', () => {
		expect(PAGE).toMatch(/<p class="seat-note" role="note">\{queueBlock\}<\/p>/);
		// ...and before anything is selected: the note precedes the bulk bar's own
		// {#if selected.size > 0}, where it first landed and was never seen.
		expect(PAGE.indexOf('class="seat-note"')).toBeLessThan(PAGE.indexOf('{#if selected.size > 0}'));
	});

	it('the drawer cannot approve, reject or delete what the page would not', () => {
		expect(PAGE).toMatch(/approveBlock=\{drawerPost \? blockFor\(drawerPost\) : null\}/);
		expect(DRAWER).toMatch(/approveBlock/);
		const approve = DRAWER.slice(
			DRAWER.indexOf('onclick={() => onApprove(post)}') - 400,
			DRAWER.indexOf('onclick={() => onApprove(post)}')
		);
		expect(approve).toMatch(/approveBlock/);
	});
});

describe('the persona page carries that persona’s seat, not the account’s upper bound', () => {
	it('resolves the role for params.agentId and overrides the layout seat', () => {
		expect(PERSONA).toMatch(/getAgentRole\(locals\.supabase, user\.id, params\.agentId\)/);
		expect(PERSONA).toMatch(/seat: capabilities\(role \?\? 'owner'\)/);
	});
});
