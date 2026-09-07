#!/usr/bin/env node
/**
 * Svelte warning ratchet.
 *
 * `npm run check` reports 0 errors and ~118 warnings. A gate that demanded zero
 * would be switched off within a week, so instead every warning class is capped
 * at its current count and the cap may only go DOWN. New instances of a class
 * fail the deploy; fixing instances is rewarded by this script telling you to
 * lower the number.
 *
 * The class that matters is `state_referenced_locally`: `let x = $state(data.foo)`
 * captures the value at component-init, so after a client-side navigation to a
 * different record the field silently shows the previous record's value. The
 * persona page resyncs by hand; most other pages do not.
 *
 * Usage:
 *   node scripts/check-warnings-ceiling.mjs            # gate (used by deploy.ps1)
 *   node scripts/check-warnings-ceiling.mjs --update   # rewrite ceilings to today's counts
 *   node scripts/check-warnings-ceiling.mjs --list     # show every warning, grouped
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const CEILINGS = join(here, 'warning-ceilings.json');

const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const list = args.has('--list');

/**
 * Run svelte-check and return its machine-readable lines.
 *
 * Invoked as `node node_modules/svelte-check/bin/svelte-check`, not through npx:
 * Node refuses to spawn a `.cmd` shim without a shell on Windows (EINVAL), and
 * turning the shell on would mean quoting paths that contain spaces.
 */
function runCheck() {
	const bin = join(app, 'node_modules', 'svelte-check', 'bin', 'svelte-check');
	if (!existsSync(bin)) {
		console.error('[warnings] svelte-check is not installed — run npm install.');
		process.exit(2);
	}
	try {
		return execFileSync(
			process.execPath,
			[bin, '--tsconfig', './tsconfig.json', '--output', 'machine'],
			{ cwd: app, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
		);
	} catch (e) {
		// svelte-check exits non-zero when it reports problems; the output is still
		// on stdout and is exactly what we want to measure.
		if (e.stdout) return e.stdout;
		console.error('[warnings] could not run svelte-check:', e.message);
		process.exit(2);
	}
}

/**
 * One machine line looks like:
 *   <ts> WARNING "src\\path\\File.svelte" 12:34 "message\nhttps://svelte.dev/e/some_code"
 * The trailing docs URL is the stable class id. CSS/a11y warnings without a URL
 * are grouped by a normalised prefix of the message instead.
 */
function classify(line) {
	const url = line.match(/svelte\.dev\/e\/([a-z0-9_]+)/i);
	if (url) return url[1];
	const msg = line.match(/"([^"]*)"\s*$/);
	if (!msg) return 'unclassified';
	return (
		'other:' +
		msg[1]
			.toLowerCase()
			.replace(/'[^']*'/g, "'x'")
			.replace(/[^a-z0-9' ]+/g, ' ')
			.trim()
			.split(/\s+/)
			.slice(0, 6)
			.join('_')
	);
}

const out = runCheck();
const lines = out.split(/\r?\n/);

const errors = [];
const counts = new Map();
const samples = new Map();

for (const line of lines) {
	if (/^\d+ ERROR /.test(line)) errors.push(line);
	if (!/^\d+ WARNING /.test(line)) continue;
	const code = classify(line);
	counts.set(code, (counts.get(code) ?? 0) + 1);
	if (!samples.has(code)) samples.set(code, []);
	samples.get(code).push(line.replace(/^\d+ WARNING /, '').slice(0, 160));
}

if (errors.length > 0) {
	// npm run check already fails the deploy on errors; say so and stop rather
	// than reporting a misleading warning verdict against a broken build.
	console.error(`[warnings] svelte-check reported ${errors.length} ERROR(s) — fix those first.`);
	process.exit(1);
}

if (list) {
	for (const [code, n] of [...counts].sort((a, b) => b[1] - a[1])) {
		console.log(`\n${code} (${n})`);
		for (const s of samples.get(code)) console.log('   ' + s);
	}
	process.exit(0);
}

if (update || !existsSync(CEILINGS)) {
	const next = Object.fromEntries([...counts].sort((a, b) => a[0].localeCompare(b[0])));
	writeFileSync(CEILINGS, JSON.stringify(next, null, '\t') + '\n', 'utf8');
	console.log(`[warnings] ceilings written for ${Object.keys(next).length} classes.`);
	process.exit(0);
}

const ceilings = JSON.parse(readFileSync(CEILINGS, 'utf8'));
let failed = false;
const lowered = [];

for (const [code, n] of [...counts].sort((a, b) => b[1] - a[1])) {
	const cap = ceilings[code];
	if (cap === undefined) {
		console.error(`[warnings] NEW warning class "${code}" (${n}).`);
		console.error(`           Fix it, or accept it with: node scripts/check-warnings-ceiling.mjs --update`);
		for (const s of samples.get(code).slice(0, 3)) console.error('             ' + s);
		failed = true;
	} else if (n > cap) {
		console.error(`[warnings] "${code}" rose to ${n}, ceiling is ${cap}.`);
		for (const s of samples.get(code).slice(0, 5)) console.error('             ' + s);
		failed = true;
	} else if (n < cap) {
		lowered.push(`${code}: ${cap} -> ${n}`);
	}
}

for (const code of Object.keys(ceilings)) {
	if (!counts.has(code) && ceilings[code] > 0) lowered.push(`${code}: ${ceilings[code]} -> 0`);
}

if (lowered.length > 0) {
	console.log('[warnings] improved since the last ceiling update:');
	for (const l of lowered) console.log('             ' + l);
	console.log('           Lock it in: node scripts/check-warnings-ceiling.mjs --update');
}

if (failed) {
	process.exit(1);
}

const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`[warnings] OK — ${total} warnings, none above its ceiling.`);
