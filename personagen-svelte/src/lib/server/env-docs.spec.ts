/**
 * ENVIRONMENT DOCUMENTATION — a knob nobody can find is a future outage.
 *
 * The client EasyPanel handover was blocked for weeks on environment repair.
 * Every variable the code reads but `.env.example` does not mention is a
 * setting only its author can diagnose: on 2026-09-05 that was 26 of them,
 * including behaviour-changing ones like `ADMIN_PIN`, `UGC_QUALITY_FLOOR` and
 * `PUBLISH_ENFORCE_ACTIVE_HOURS`.
 *
 * This spec fails when code reads a variable `.env.example` does not document.
 * Documenting it is one commented line; that is the whole cost.
 *
 * The reverse direction (documented but unread) is reported, never failed:
 * `services/` and the Docker/EasyPanel layer read some of these, and this spec
 * only sees `personagen-svelte/src`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcDir = join(appRoot, 'src');

/**
 * Supplied by the runtime, not by us: adapter-node and Vite read these directly
 * and there is nothing for a deployer to configure beyond the platform defaults.
 */
const RUNTIME_PROVIDED = new Set([
	'NODE_ENV',
	'PORT',
	'HOST',
	'ORIGIN',
	'BODY_SIZE_LIMIT',
	'ADDRESS_HEADER',
	'PROTOCOL_HEADER',
	'HOST_HEADER',
	'USERNAME',
	'USER',
	'CI'
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (/\.(ts|js|svelte)$/.test(entry.name)) out.push(full);
	}
	return out;
}

/**
 * Matches the four shapes the codebase uses to read a variable:
 *   env.NAME · privateEnv.NAME · publicEnv.NAME · process.env.NAME
 * and the bracket form env['NAME']. Anything lower-case or shorter than four
 * characters is a property access on some other object, not an env read.
 */
const READ_PATTERNS = [
	/\b(?:process\.env|privateEnv|publicEnv|env)\.([A-Z][A-Z0-9_]{3,})\b/g,
	/\b(?:process\.env|privateEnv|publicEnv|env)\[['"]([A-Z][A-Z0-9_]{3,})['"]\]/g,
	// Reads routed through a helper, where the name is a string argument rather
	// than a property: `intFromEnv('AUTOPILOT_MAX_PER_RUN', 24)`. Without this the
	// scanner has a blind spot exactly where a default is being applied, which is
	// where an undocumented knob does the most damage.
	/\b\w*[eE]nv\w*\(\s*['"]([A-Z][A-Z0-9_]{3,})['"]/g
];

function collectReads(): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const file of walk(srcDir)) {
		// A spec that documents an env name in prose must not itself create a
		// requirement — only real source reads count.
		if (/\.(spec|test)\.ts$/.test(file)) continue;
		const text = readFileSync(file, 'utf8');
		for (const pattern of READ_PATTERNS) {
			for (const m of text.matchAll(pattern)) {
				const name = m[1];
				if (RUNTIME_PROVIDED.has(name)) continue;
				if (!found.has(name)) found.set(name, []);
				const where = relative(appRoot, file).replace(/\\/g, '/');
				if (!found.get(name)!.includes(where)) found.get(name)!.push(where);
			}
		}
	}
	return found;
}

/** Names that appear at the start of a line in .env.example, commented or not. */
function collectDocumented(): Set<string> {
	const path = join(appRoot, '..', '.env.example');
	if (!existsSync(path)) return new Set();
	const text = readFileSync(path, 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^#?\s*([A-Z][A-Z0-9_]{3,})\s*=/gm)) names.add(m[1]);
	// Also honour a name mentioned inside a comment, so one group note can cover
	// several related slugs. Restricted to names containing an underscore: without
	// that, ordinary prose words in comments ("NOTE", "DISABLED", "OVERRIDES")
	// would count as documentation and quietly satisfy the gate.
	for (const m of text.matchAll(/^#.*?\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/gm)) names.add(m[1]);
	return names;
}

const reads = collectReads();
const documented = collectDocumented();

describe('.env.example documents every variable the app reads', () => {
	it('finds the example file', () => {
		expect(
			existsSync(join(appRoot, '..', '.env.example')),
			'.env.example is missing from the repo root'
		).toBe(true);
	});

	it('reads a plausible number of variables (the scanner still works)', () => {
		// Guards against a refactor that silently makes the scan match nothing,
		// which would turn this whole spec into a permanent false green.
		expect(reads.size).toBeGreaterThan(20);
	});

	it('leaves no variable undocumented', () => {
		const undocumented = [...reads.keys()].filter((n) => !documented.has(n)).sort();
		const detail = undocumented.map((n) => `  ${n}  (read in ${reads.get(n)![0]})`).join('\n');
		expect(
			undocumented,
			`These variables are read by the app but absent from .env.example.\n` +
				`Add one line each — commented is fine for optional knobs:\n${detail}`
		).toEqual([]);
	});

	it('reports variables documented but not read here (advisory only)', () => {
		const unread = [...documented].filter((n) => !reads.has(n)).sort();
		if (unread.length > 0) {
			// Not a failure: services/ and the deploy layer read some of these.
			console.log(
				`[env-docs] documented but not read in personagen-svelte/src: ${unread.join(', ')}`
			);
		}
		expect(true).toBe(true);
	});
});
