/**
 * Invariant D11, checked on every test run: a source file that talks to a
 * paid provider host is either metered (it goes through assertWithinBudget +
 * recordCostEvents, directly or via metering.ts / runBudgetedAssetJob) or it is
 * listed below as FREE with the reason it costs nothing.
 *
 * Adding a provider call somewhere new makes this fail until the call is
 * metered or consciously allow-listed — which is the point.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const PROVIDER_HOSTS = [/fal\.run/, /queue\.fal\.run/, /fal\.ai\//, /openrouter\.ai/, /generativelanguage\.googleapis\.com/, /api\.firecrawl\.dev/, /api\.elevenlabs/];
const METERED_MARKERS = [/assertWithinBudget\(/, /recordCostEvents\(/, /meteredCall\(/, /meteredAiClient\(/, /runBudgetedAssetJob\(/];

/** path (posix, relative to src/) → why it is free */
const FREE_PATHS: Record<string, string> = {
	'lib/models.ts': 'static model catalog — URLs are constants, nothing is called',
	'lib/server/model-registry.ts': 'model listing / schema probes — no inference, no per-call charge',
	'lib/server/ai-client.ts': 'client factory — every generate() call site is wrapped by trackAi (packs) or meteredAiClient (engine)',
	'routes/api/settings/api-keys/+server.ts': 'key validation pings; the Firecrawl ping is one page and documented in the assessment'
};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		// Server code only: .ts under src/. Svelte pages never hold provider keys; a
		// host name in page copy (the docs hub) is prose, not a call.
		else if (/\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) out.push(p);
	}
	return out;
}

describe('metering audit — every provider call site is metered or explicitly free', () => {
	const files = walk(ROOT);
	const talkers = files.filter((f) => {
		const s = readFileSync(f, 'utf8');
		return PROVIDER_HOSTS.some((h) => h.test(s));
	});

	it('finds the provider call sites at all (guard against a silent regex miss)', () => {
		expect(talkers.length).toBeGreaterThanOrEqual(5);
	});

	it.each(talkers.map((f) => [relative(ROOT, f).replace(/\\/g, '/'), f]))('%s', (rel, abs) => {
		const s = readFileSync(abs, 'utf8');
		const metered = METERED_MARKERS.some((m) => m.test(s));
		const free = FREE_PATHS[rel];
		expect(metered || !!free, `${rel} calls a provider but is neither metered nor allow-listed in FREE_PATHS`).toBe(true);
	});

	it('every FREE_PATHS entry still exists (no stale allow-list)', () => {
		for (const rel of Object.keys(FREE_PATHS)) {
			expect(files.map((f) => relative(ROOT, f).replace(/\\/g, '/'))).toContain(rel);
		}
	});
});
