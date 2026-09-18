/**
 * The persona page offers a write control only to a seat that may use it.
 *
 * Five seat roles driven across the portal on 2026-09-17 left one residue: the
 * persona page rendered Delete Persona, Disconnect and Publish now to every seat,
 * and the server refused the click with a 403 — the one behaviour the seat model
 * exists to prevent. The page's `seat` is now the persona's own role (resolved in
 * +page.server.ts), so each control can be disabled with the seat sentence.
 *
 * Who may do what, from seat.ts: deleting a persona outright is owner-only;
 * managing connections and publishing are manager and above.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilities } from '$lib/seat';

const PAGE = readFileSync(
	join(__dirname, '..', '..', 'routes', '(portal)', 'personas', '[agentId]', '+page.svelte'),
	'utf8'
);
const buttons = PAGE.split('<button').map((c) =>
	c.slice(0, c.indexOf('</button') > 0 ? c.indexOf('</button') : 800)
);
const tagWith = (marker: string) => {
	const hits = buttons.filter((b) => b.includes(marker));
	expect(hits.length, `exactly one <button> carries ${marker}`).toBe(1);
	return hits[0];
};

describe('the seat model behind the three controls', () => {
	it('only the owner deletes a persona; admin and below do not', () => {
		expect(capabilities('owner').canDeletePersona).toBe(true);
		expect(capabilities('admin').canDeletePersona).toBe(false);
	});
	it('connections and publishing are manager and above', () => {
		for (const r of ['manager', 'admin', 'owner'] as const) {
			expect(capabilities(r).canManageConnections, r).toBe(true);
			expect(capabilities(r).canPublish, r).toBe(true);
		}
		for (const r of ['creator', 'viewer'] as const) {
			expect(capabilities(r).canManageConnections, r).toBe(false);
			expect(capabilities(r).canPublish, r).toBe(false);
		}
	});
});

describe('the persona page disables each control with the reason', () => {
	it('Delete Persona is owner-gated', () => {
		const tag = tagWith('onclick={deleteAgent}');
		expect(tag).toMatch(/disabled=\{!seat\.canDeletePersona\}/);
		expect(tag).toMatch(/title=\{seatBlockedReason\(seat, 'owner'\)/);
	});
	it('Connect is manager-gated', () => {
		const tag = tagWith('connectPlatform(p.key)');
		expect(tag).toMatch(/\|\| !seat\.canManageConnections\}/);
		expect(tag).toMatch(/title=\{seatBlockedReason\(seat, 'manager'\) \?\? `Connect/);
	});
	it('Disconnect is manager-gated', () => {
		const tag = tagWith('disconnectPlatform(platform.key)');
		expect(tag).toMatch(/disabled=\{!seat\.canManageConnections\}/);
		expect(tag).toMatch(/title=\{seatBlockedReason\(seat, 'manager'\)/);
	});
	it('Publish now is manager-gated without losing its own disabled conditions', () => {
		const tag = tagWith('onclick={confirmPublishFallback}');
		expect(tag).toMatch(/publishFallbackSelected\.length === 0 \|\| !seat\.canPublish/);
		expect(tag).toMatch(/title=\{seatBlockedReason\(seat, 'manager'\)/);
	});
	it('the page reads the seat the server resolved for THIS persona', () => {
		expect(PAGE).toMatch(/const seat = \$derived\(\(\(data as any\)\.seat \?\? FULL_ACCESS\)/);
		const server = readFileSync(
			join(__dirname, '..', '..', 'routes', '(portal)', 'personas', '[agentId]', '+page.server.ts'),
			'utf8'
		);
		expect(server).toMatch(/seat: capabilities\(role \?\? 'owner'\)/);
	});
});
