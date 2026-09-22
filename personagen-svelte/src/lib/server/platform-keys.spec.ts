/**
 * The platform key inventory — read-only, value-free, and it must stay both.
 *
 * Since customer BYOK was withdrawn (2026-09-21) every generation for every
 * customer runs on the platform's own keys, so "is FAL_API_KEY even set in this
 * deployment" went from a curiosity to an outage question. Before this file the
 * only way to answer it was to shell into the container.
 *
 * The risk of a panel like this is that it becomes a key MANAGER: a text field
 * that rewrites the platform's spending credentials from a browser, and a
 * "masked" preview that puts six characters of a live secret into every
 * screenshot of the page. These tests pin it to neither — booleans, timestamps
 * and counts, nothing else.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { platformKeyStatuses } = await import('./platform-keys');

const SECRET = 'sk-this-must-never-appear-anywhere';

/** A stub of the one query this module makes. */
function stubDb(rows: Array<{ provider: string; created_at: string }> | null, throws = false) {
	const tables: string[] = [];
	const builder = {
		select: () => builder,
		eq: () => builder,
		gte: () => builder,
		order: () => builder,
		limit: async () => (throws ? Promise.reject(new Error('relation missing')) : { data: rows })
	};
	return {
		tables,
		from(table: string) {
			tables.push(table);
			if (throws) throw new Error('relation missing');
			return builder;
		}
	};
}

const iso = (d: string) => new Date(d).toISOString();

describe('it reports whether a key exists, never what it is', () => {
	it('carries no key value anywhere in the payload', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.FAL_API_KEY = SECRET;
		mockEnv.OPENROUTER_API_KEY = SECRET;

		const out = await platformKeyStatuses(stubDb([]));
		const serialized = JSON.stringify(out);
		expect(serialized).not.toContain(SECRET);
		// Not even a fragment: a masked preview is still a secret in a screenshot.
		expect(serialized).not.toContain(SECRET.slice(0, 6));
		expect(serialized).not.toMatch(/sk-/);
	});

	it('configured is a boolean derived from presence alone', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.FAL_API_KEY = SECRET;
		const out = await platformKeyStatuses(stubDb([]));
		const fal = out.find((k) => k.id === 'fal_ai')!;
		const openrouter = out.find((k) => k.id === 'openrouter')!;
		expect(fal.configured).toBe(true);
		expect(openrouter.configured).toBe(false);
		expect(Object.keys(fal)).not.toContain('value');
		expect(Object.keys(fal)).not.toContain('masked');
	});

	it('treats whitespace as unset — a variable set to " " is not a key', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.GEMINI_API_KEY = '   ';
		const out = await platformKeyStatuses(stubDb([]));
		expect(out.find((k) => k.id === 'gemini')!.configured).toBe(false);
	});
});

describe('it names the variable and the consequence, so the problem is actionable', () => {
	it('a missing generation key says there is no customer fallback any more', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		const out = await platformKeyStatuses(stubDb([]));
		const fal = out.find((k) => k.id === 'fal_ai')!;
		expect(fal.configured).toBe(false);
		expect(fal.envVar).toBe('FAL_API_KEY');
		expect(fal.problem).toContain('FAL_API_KEY');
		expect(fal.problem).toMatch(/no customer key to fall back to/i);
	});

	it('a missing Zernio says the different thing that is true of Zernio', async () => {
		// Zernio is the one key customers still bring, so its absence degrades
		// rather than stops — saying "every generation will fail" would be wrong.
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		const out = await platformKeyStatuses(stubDb([]));
		const zernio = out.find((k) => k.id === 'zernio')!;
		expect(zernio.problem).toMatch(/own Zernio key/i);
		expect(zernio.problem).not.toMatch(/no customer key to fall back to/i);
	});

	it('a configured key with no recent call is flagged softly, not as broken', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.FIRECRAWL_API_KEY = SECRET;
		const out = await platformKeyStatuses(stubDb([]));
		const fc = out.find((k) => k.id === 'firecrawl')!;
		expect(fc.configured).toBe(true);
		expect(fc.problem).toMatch(/expected if nothing uses it/i);
		expect(fc.problem).toMatch(/revoked/i);
	});

	it('a configured key that is working has no problem at all', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.FAL_API_KEY = SECRET;
		const out = await platformKeyStatuses(
			stubDb([{ provider: 'fal', created_at: iso('2026-09-21T23:51:19Z') }])
		);
		const fal = out.find((k) => k.id === 'fal_ai')!;
		expect(fal.problem).toBeNull();
		expect(fal.events30d).toBe(1);
	});
});

describe('usage is read newest-first, and counted', () => {
	it('lastUsedAt is the most recent row, not an arbitrary one', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.OPENROUTER_API_KEY = SECRET;
		// The query orders descending, so the first row seen is the latest.
		const out = await platformKeyStatuses(
			stubDb([
				{ provider: 'openrouter', created_at: iso('2026-09-21T23:00:00Z') },
				{ provider: 'openrouter', created_at: iso('2026-09-20T10:00:00Z') },
				{ provider: 'openrouter', created_at: iso('2026-09-19T10:00:00Z') }
			])
		);
		const or = out.find((k) => k.id === 'openrouter')!;
		expect(or.lastUsedAt).toBe(iso('2026-09-21T23:00:00Z'));
		expect(or.events30d).toBe(3);
	});

	it('maps a catalogue entry to its COST provider name, not its id', async () => {
		// fal_ai is the key row; 'fal' is what the ledger records. Getting this
		// backwards would report every fal key as never used.
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.FAL_API_KEY = SECRET;
		const out = await platformKeyStatuses(
			stubDb([{ provider: 'fal', created_at: iso('2026-09-21T12:00:00Z') }])
		);
		expect(out.find((k) => k.id === 'fal_ai')!.events30d).toBe(1);
	});
});

describe('it never bricks the console', () => {
	it('an unreadable events table still reports configuration', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		mockEnv.FAL_API_KEY = SECRET;
		const out = await platformKeyStatuses(stubDb(null, true));
		expect(out.length).toBeGreaterThan(0);
		expect(out.find((k) => k.id === 'fal_ai')!.configured).toBe(true);
		expect(out.find((k) => k.id === 'fal_ai')!.lastUsedAt).toBeNull();
	});

	it('lists only providers the platform actually holds a key for', async () => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		const ids = (await platformKeyStatuses(stubDb([]))).map((k) => k.id);
		expect(ids).toEqual(['zernio', 'fal_ai', 'openrouter', 'gemini', 'firecrawl']);
		// Higgsfield issues no key and Kie is not wired, so neither has a row here.
		expect(ids).not.toContain('higgsfield');
		expect(ids).not.toContain('kie_ai');
	});
});

describe('the module cannot become a key manager by accident', () => {
	const src = readFileSync(new URL('./platform-keys.ts', import.meta.url), 'utf-8');

	it('the file was actually read', () => {
		expect(src.length).toBeGreaterThan(400);
		expect(src).toContain('export async function platformKeyStatuses');
	});

	it('writes nothing and reads no secret column', () => {
		for (const forbidden of ['.update(', '.insert(', '.upsert(', '.delete(', 'encrypted_value']) {
			expect(src, forbidden).not.toContain(forbidden);
		}
	});
});
