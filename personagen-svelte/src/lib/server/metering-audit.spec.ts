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
const PROVIDER_HOSTS = [
	/fal\.run/,
	/queue\.fal\.run/,
	/fal\.ai\//,
	/openrouter\.ai/,
	/generativelanguage\.googleapis\.com/,
	/api\.firecrawl\.dev/,
	/api\.elevenlabs/,
	/api\.kie\.ai/,
	/kie\.ai\//
];
// A host name is not the only way to reach a paid provider: an SDK reaches one
// with no URL in sight, so the symbol counts as a call site too.
const PROVIDER_SDKS = [/new GoogleGenAI\(/, /@google\/genai/];
const METERED_MARKERS = [
	/assertWithinBudget\(/,
	/recordCostEvents\(/,
	/meteredCall\(/,
	/meteredAiClient\(/,
	/runBudgetedAssetJob\(/
];

/** path (posix, relative to src/) → why it is free */
const FREE_PATHS: Record<string, string> = {
	'lib/models.ts': 'static model catalog — URLs are constants, nothing is called',
	'lib/server/model-registry.ts':
		'model listing / schema probes — no inference, no per-call charge',
	'lib/server/ai-client.ts':
		'client factory — every generate() call site is wrapped by trackAi (packs) or meteredAiClient (engine)',
	'routes/api/settings/api-keys/+server.ts':
		'key validation pings; the Firecrawl ping is one page and documented in the assessment'
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
		return PROVIDER_HOSTS.some((h) => h.test(s)) || PROVIDER_SDKS.some((h) => h.test(s));
	});

	it('finds the provider call sites at all (guard against a silent regex miss)', () => {
		expect(talkers.length).toBeGreaterThanOrEqual(5);
	});

	it.each(talkers.map((f) => [relative(ROOT, f).replace(/\\/g, '/'), f]))('%s', (rel, abs) => {
		const s = readFileSync(abs, 'utf8');
		const metered = METERED_MARKERS.some((m) => m.test(s));
		const free = FREE_PATHS[rel];
		expect(
			metered || !!free,
			`${rel} calls a provider but is neither metered nor allow-listed in FREE_PATHS`
		).toBe(true);
	});

	// The check above is FILE-level: one metering marker anywhere clears the whole
	// file. engine/+server.ts is ~2,800 lines and generate.ts is ~200 KB, so a new
	// unmetered call added to either would have passed in silence — the invariant
	// read as call-site coverage while only ever proving file presence. This
	// counts instead: every paid call must have cost accounting near it.
	const CALL = /(?:falSyncJson|falQueueJson|openRouterImageEdit|openRouterBrollVideo)\s*\(/;
	// the declarations of those helpers, which are not call sites
	const DECL =
		/(?:function|const)\s+(?:falSyncJson|falQueueJson|openRouterImageEdit|openRouterBrollVideo)/;
	const NEAR = [
		/costEvents\.push\(/,
		/meteredCall\(/,
		/runBudgetedAssetJob\(/,
		/recordCostEvents\(/,
		/assertWithinBudget\(/
	];
	const dense = ['lib/server/content/generate.ts', 'routes/api/engine/+server.ts'];

	/**
	 * Helpers that spend but do not price: each returns its result to a caller
	 * that pushes the cost event. Adding a NEW one is a deliberate act — it has
	 * to be named here, with the caller that prices it.
	 */
	const PRICED_BY_CALLER: Record<string, string> = {
		generateUgcImage: 'callers push the image cost with the model that actually ran',
		generateProductStill: 'priced by the pack that requested the still',
		generateGraphicStill: 'priced by the pack; free when the card renderer handles it',
		generateVoiceAudio: 'priced by the pack as fal/tts',
		generateTalkingHead: 'priced by the pack as fal/talking_head',
		generateBrollVideo: 'priced by the pack at the registry video rate',
		generateCinematicVideo: 'priced by the cinematic pack at the pro video rate'
	};

	/** Name of the function a line sits inside, for the allow-list above. */
	function enclosingFn(lines: string[], index: number): string {
		for (let i = index; i >= 0; i--) {
			const m = lines[i].match(/^(?:export )?(?:async )?function (\w+)|^const (\w+) = async/);
			if (m) return m[1] ?? m[2] ?? '';
		}
		return '';
	}

	it.each(dense)('%s — every paid call is accounted for at its own call site', (rel) => {
		const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
		const orphans: string[] = [];
		lines.forEach((line, i) => {
			if (!CALL.test(line) || DECL.test(line)) return;
			const window = lines.slice(Math.max(0, i - 4), i + 40).join('\n');
			if (NEAR.some((m) => m.test(window))) return;
			const fn = enclosingFn(lines, i);
			if (PRICED_BY_CALLER[fn]) return;
			orphans.push(`${rel}:${i + 1} (in ${fn || 'top level'}) — ${line.trim().slice(0, 70)}`);
		});
		expect(
			orphans,
			`paid call with no cost accounting nearby and no PRICED_BY_CALLER entry: ${orphans.join(' | ')}`
		).toEqual([]);
	});

	it('every PRICED_BY_CALLER helper still exists and still spends', () => {
		// A stale allow-list is how this check would quietly stop meaning anything:
		// a name left here after the function is gone excuses nothing, but it also
		// hides that nobody is maintaining the list.
		const src = readFileSync(join(ROOT, 'lib/server/content/generate.ts'), 'utf8');
		for (const fn of Object.keys(PRICED_BY_CALLER)) {
			expect(src, `${fn} is allow-listed but no longer defined`).toContain(`function ${fn}(`);
		}
	});

	it('the call-site scan actually found calls (an empty scan would pass vacuously)', () => {
		const found = dense.reduce(
			(n, rel) =>
				n +
				readFileSync(join(ROOT, rel), 'utf8')
					.split('\n')
					.filter((l) => CALL.test(l) && !DECL.test(l)).length,
			0
		);
		expect(found).toBeGreaterThanOrEqual(10);
	});
	/**
	 * THE HOLE THIS CLOSES. The rule above only inspects files that mention a
	 * provider HOSTNAME. A file that obtains a client through `resolveAiClient`
	 * and calls `.generate()` on it directly contains no hostname at all, so it
	 * was invisible to this audit — which is precisely the offence the audit was
	 * written for: the engine route and the voice preview called providers
	 * through the factory, and their spend never reached the ledger or the wallet.
	 *
	 * An audit that cannot see the shape of the bug it exists to catch is an
	 * assertion that cannot fail. Every indirect caller must be metered too.
	 */
	const CALLS_FACTORY = /\bresolveAiClient\s*\(/;
	const indirect = files.filter((f) => {
		const rel = relative(ROOT, f).replace(/\\/g, '/');
		// The factory's own definition, and prose that merely names it, are not calls.
		if (rel === 'lib/server/ai-client.ts') return false;
		const src = readFileSync(f, 'utf8');
		return src.split('\n').some((line) => !/^\s*(\*|\/\/)/.test(line) && CALLS_FACTORY.test(line));
	});

	it('finds the indirect call sites at all (guard against a silent regex miss)', () => {
		expect(indirect.length).toBeGreaterThanOrEqual(3);
	});

	it.each(indirect.map((f) => [relative(ROOT, f).replace(/\\/g, '/'), f]))(
		'%s obtains an AI client and must meter it',
		(rel, abs) => {
			const src = readFileSync(abs, 'utf8');
			const metered = METERED_MARKERS.some((m) => m.test(src)) || /\btrackAi\b/.test(src);
			expect(
				metered || !!FREE_PATHS[rel],
				`${rel} resolves an AI client but is neither metered nor allow-listed in FREE_PATHS`
			).toBe(true);
		}
	);

	it('every FREE_PATHS entry still exists (no stale allow-list)', () => {
		for (const rel of Object.keys(FREE_PATHS)) {
			expect(files.map((f) => relative(ROOT, f).replace(/\\/g, '/'))).toContain(rel);
		}
	});
});
