#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Pre-deploy preflight — the one command to run before ANY deploy.
//
//   node scripts/preflight.mjs                     enforce (exit non-zero unless every gate passes)
//   node scripts/preflight.mjs --warn-only         report, never block (always exit 0)
//   node scripts/preflight.mjs --max-age-minutes N override the backup freshness threshold
//
// WHY THIS EXISTS. deploy.ps1 gates a deploy on a proved backup and a signup
// probe — but deploy.ps1 is not the only way this app ships. A deploy can be
// triggered straight from the hosting panel against a pushed commit, and that
// path runs NONE of those gates: no backup, no restore proof, no ledger check,
// no signup probe. This script is the gate that travels with the repository
// instead of with one PowerShell entry point, so the same three questions get
// asked whichever way the code reaches production.
//
// THE THREE GATES, in this order:
//   1. migration ledger clean   node scripts/apply-migration.mjs --status --strict
//   2. backup exists, is fresh, and still restores   scripts/backup-db.mjs
//   3. signup gate closed       node scripts/preflight-auth.mjs
//
// PASS / FAIL / UNKNOWN. A gate that cannot RUN — no credentials, database
// unreachable — is UNKNOWN, never PASS. A preflight that fails into "looks
// fine" is worse than no preflight, because it is the reason nobody checks by
// hand any more. UNKNOWN blocks (exit 2) but is reported as ignorance, not as
// a verdict, so the remedy line can say "make it runnable" rather than "fix
// production".
//
// EXIT CODES
//   0  every gate passed (or --warn-only, whatever happened)
//   1  at least one gate FAILED — a real finding, do not deploy
//   2  no failures but at least one gate is UNKNOWN — nothing was proved
//
// READ-ONLY, with one exception: gate 2 writes a backup when the newest one on
// disk is older than the freshness threshold. Everything else is SELECTs.
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const backupRoot = join(appRoot, 'backup');

// ── freshness threshold ─────────────────────────────────────────────────────
// TWO HOURS, and the number is a judgement about how much data a restore is
// allowed to be missing — not a round number picked for looking tidy.
//
// Too long and the "restore point" predates work that has already happened:
// credit ledger rows, wallet balances, generated posts. Autopilot writes those
// on a slot grid across the 8am–8pm window — the default 3 posts/day lands on
// 08:00 / 14:00 / 20:00 (six-hour gaps) and the ceiling of 10/day on roughly
// 80-minute gaps. A two-hour bound means a restore is missing at most one
// generation slot's worth of money-bearing rows on the default schedule.
//
// Too short and every preflight re-dumps ~20 MB of production through
// /pg/query, so people stop running it — which costs more than a stale window
// ever does. Two hours is comfortably longer than one deploy session (run the
// preflight, fix the gate it caught, run it again, push), so the second run
// re-PROVES the existing backup instead of taking another one.
//
// And it is strictly tighter than the only two automatic triggers that exist
// (a deploy, or a migration that writes), so this gate can never call a backup
// "fresh" on the strength of yesterday's deploy.
const DEFAULT_MAX_AGE_MINUTES = 120;

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
	console.log(
		'\n  usage: node scripts/preflight.mjs [--warn-only] [--max-age-minutes N]\n\n' +
			'  Runs the three pre-deploy gates (migration ledger, proved backup, signup gate)\n' +
			'  and prints one verdict. Exit 0 = safe to deploy, 1 = a gate failed,\n' +
			'  2 = a gate could not be run so nothing was proved.\n'
	);
	process.exit(0);
}
const warnOnly = argv.includes('--warn-only');
const maxAgeMinutes = (() => {
	const inline = argv.find((a) => a.startsWith('--max-age-minutes='));
	const raw = inline ? inline.split('=')[1] : argv[argv.indexOf('--max-age-minutes') + 1];
	const n = Number(argv.includes('--max-age-minutes') || inline ? raw : NaN);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_MINUTES;
})();

// ── result model ────────────────────────────────────────────────────────────
const PASS = 'PASS';
const FAIL = 'FAIL';
const UNKNOWN = 'UNKNOWN';

/** @type {{n:number,name:string,state:string,detail:string,todo:string[]}[]} */
const results = [];
function record(n, name, state, detail, todo = []) {
	results.push({ n, name, state, detail, todo });
	return state;
}

// ── child processes ─────────────────────────────────────────────────────────
/**
 * Run a node script, streaming its output indented under the gate heading and
 * keeping a copy for classification. Never throws: a spawn failure comes back
 * as code null, which classifies as UNKNOWN like any other "could not run".
 */
function run(args) {
	return new Promise((done) => {
		console.log(`      $ node ${args.join(' ')}`);
		const child = spawn(process.execPath, args, {
			cwd: appRoot,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let out = '';
		const pipe = (stream) => {
			let buf = '';
			stream.setEncoding('utf8');
			stream.on('data', (chunk) => {
				out += chunk;
				buf += chunk;
				const lines = buf.split('\n');
				buf = lines.pop() ?? '';
				for (const l of lines) console.log(`      | ${l.replace(/\s+$/, '')}`);
			});
			stream.on('end', () => {
				if (buf.trim()) console.log(`      | ${buf.replace(/\s+$/, '')}`);
			});
		};
		pipe(child.stdout);
		pipe(child.stderr);
		child.on('error', (e) => done({ code: null, out: `${out}\nspawn failed: ${e.message}` }));
		child.on('close', (code) => done({ code, out }));
	});
}

/**
 * Could this gate have reached the database at all?
 *
 * Everything here is the shape of "the check never ran", not "the check ran and
 * found something wrong". Missing credentials and an unreachable host both land
 * as UNKNOWN; so does an auth error from /pg/query, because a key that is
 * rejected proves nothing about the schema behind it.
 */
function unrunnableReason(text) {
	const t = String(text);
	if (/spawn failed:/i.test(t)) return 'the script could not be started at all';
	if (/PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/i.test(t))
		return 'database credentials are not readable here (personagen-svelte/.env or the environment)';
	if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|getaddrinfo/i.test(t))
		return 'the database host could not be reached';
	if (/pg\/query\s+(?:401|403|404|5\d\d)|HTTP\s+(?:401|403|404|5\d\d)/i.test(t))
		return 'the database rejected the request before any check could run';
	if (/not JSON:|unexpected shape:/i.test(t)) return 'the /pg/query endpoint answered with something that is not a result set';
	return null;
}

const CREDENTIAL_TODO = [
	'Put PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in personagen-svelte/.env, or export them.',
	'Then run this again. Until it runs, NOTHING about production has been proved.'
];

function unknownTodo(reason) {
	if (/credentials/.test(reason)) return CREDENTIAL_TODO;
	return [
		'Make the check runnable, then run `npm run preflight` again.',
		'An unreachable database is not a passing gate — it is an unanswered question.'
	];
}

// ── gate 1: migration ledger ────────────────────────────────────────────────
// --status --strict exits 3 when anything is pending or drifted, 0 when the
// ledger matches supabase/migrations.json exactly, and 1 on an error it could
// not classify (which is an unanswered question, not a clean ledger).
async function gateLedger() {
	console.log('\n  [1/3] Migration ledger — is the schema in the repo the schema in production?');
	const { code, out } = await run(['scripts/apply-migration.mjs', '--status', '--strict']);
	const tail = /(\d+) in ORDER . (\d+) pending . (\d+) drifted/.exec(out);
	const counts = tail ? `${tail[2]} pending, ${tail[3]} drifted of ${tail[1]}` : '';

	if (code === 0) return record(1, 'migration ledger', PASS, counts || 'ledger matches ORDER');
	if (code === 3) {
		return record(1, 'migration ledger', FAIL, counts || 'pending or drifted migrations', [
			'Apply them: node scripts/apply-migration.mjs --all   (it takes its own backup first).',
			'A DRIFTED row means a file changed after it was applied — write a NEW migration, never edit the old one.',
			'A LEGACY-HASH row is the same content hashed before line-ending normalisation: node scripts/apply-migration.mjs --rehash'
		]);
	}
	const reason = unrunnableReason(out) || `exit ${code}, which --status does not use for a verdict`;
	return record(1, 'migration ledger', UNKNOWN, reason, unknownTodo(reason));
}

// ── gate 2: a backup that exists, is fresh, and still restores ──────────────
/** Newest backup directory by the taken_at its own manifest records. */
function newestBackup() {
	if (!existsSync(backupRoot)) return null;
	let best = null;
	for (const name of readdirSync(backupRoot)) {
		const manifest = join(backupRoot, name, 'manifest.json');
		if (!existsSync(manifest)) continue;
		let takenAt = null;
		try {
			takenAt = new Date(JSON.parse(readFileSync(manifest, 'utf8')).taken_at);
		} catch {
			continue; // an unreadable manifest is not a backup we can date
		}
		if (!(takenAt instanceof Date) || Number.isNaN(takenAt.getTime())) continue;
		if (!best || takenAt > best.takenAt) best = { dir: join(backupRoot, name), takenAt };
	}
	return best;
}

const ageMinutes = (d) => Math.round((Date.now() - d.getTime()) / 60000);
const humanAge = (mins) =>
	mins < 90 ? `${mins} min old` : mins < 2880 ? `${(mins / 60).toFixed(1)} h old` : `${Math.round(mins / 1440)} days old`;

async function gateBackup() {
	console.log(
		`\n  [2/3] Backup — is there a restore point from the last ${maxAgeMinutes} minutes, and does it still load?`
	);
	const existing = newestBackup();
	const stale = !existing || ageMinutes(existing.takenAt) > maxAgeMinutes;

	let dir = existing?.dir ?? null;
	let took = false;
	if (stale) {
		console.log(
			existing
				? `      Newest backup is ${humanAge(ageMinutes(existing.takenAt))} — older than ${maxAgeMinutes} min. Taking a new one.`
				: '      No backup on disk. Taking one.'
		);
		const { code, out } = await run(['scripts/backup-db.mjs']);
		if (code !== 0) {
			const reason = unrunnableReason(out);
			if (reason) return record(2, 'backup', UNKNOWN, `could not take a backup — ${reason}`, unknownTodo(reason));
			return record(2, 'backup', FAIL, 'the backup did not complete', [
				'Read the output above: the table it stopped on was NOT written, so the directory is partial.',
				'Fix that table (or the connection), then run `npm run backup` until it finishes.'
			]);
		}
		took = true;
		dir = newestBackup()?.dir ?? null;
		if (!dir) {
			return record(2, 'backup', UNKNOWN, 'the backup reported success but no backup directory appeared', [
				`Check ${backupRoot} by hand — something wrote outside the expected location.`
			]);
		}
	} else {
		console.log(
			`      Reusing ${dir} (${humanAge(ageMinutes(existing.takenAt))}, inside the ${maxAgeMinutes} min window) — re-proving it rather than re-dumping production.`
		);
		// backup-db.mjs verifies a dump immediately after writing it, so this
		// only needs running on the reuse path: it is the check that catches a
		// file that has been truncated or deleted since it was taken.
		const { code, out } = await run(['scripts/backup-db.mjs', '--verify', dir]);
		if (code !== 0) {
			const reason = unrunnableReason(out);
			if (reason) return record(2, 'backup', UNKNOWN, `could not verify the backup — ${reason}`, unknownTodo(reason));
			return record(2, 'backup', FAIL, 'the backup on disk no longer matches its own manifest', [
				'A file is missing, truncated or unreadable — this backup cannot be trusted as a restore point.',
				'Take a fresh one: npm run backup'
			]);
		}
	}

	// The one that matters, on BOTH paths: the same json_populate_recordset
	// conversion a restore would do, as a SELECT against the live schema.
	const { code, out } = await run(['scripts/backup-db.mjs', '--check-restore', dir]);
	const age = humanAge(ageMinutes(newestBackup()?.takenAt ?? new Date()));
	if (code === 0) {
		return record(2, 'backup', PASS, `${took ? 'taken now' : `re-proved, ${age}`} — ${dir}`, []);
	}
	const reason = unrunnableReason(out);
	if (reason) return record(2, 'backup', UNKNOWN, `could not prove the restore — ${reason}`, unknownTodo(reason));
	return record(2, 'backup', FAIL, 'the backup will NOT load back into the live schema', [
		'Read the per-table lines above — each names a column that changed type or was dropped.',
		'A dropped column is silently discarded on restore, so this is data loss waiting to happen.',
		'Do not deploy a schema change on top of a backup that cannot come back.'
	]);
}

// ── gate 3: the signup gate ─────────────────────────────────────────────────
// DELIBERATELY invoked WITHOUT --warn-only. preflight-auth.mjs exits 0 under
// --warn-only whatever it finds, so a caller that reads its exit code learns
// nothing — that is exactly the shape of check this repository has already been
// bitten by. The child reports honestly; OUR --warn-only decides whether the
// overall verdict blocks. Exit 0 is ambiguous on its own (it also means "could
// not probe"), so the output is read to separate a clean gate from an unrun one.
async function gateSignup() {
	console.log('\n  [3/3] Signup gate — are both registration doors shut?');
	const { code, out } = await run(['scripts/preflight-auth.mjs']);

	if (code === 0) {
		if (/OK — ADMIN_PIN is set and the project refuses public signups/.test(out))
			return record(3, 'signup gate', PASS, 'ADMIN_PIN set and the project refuses public signups');
		if (/skipping probe|UNVERIFIED|could not reach/i.test(out)) {
			const reason = /skipping probe/i.test(out)
				? 'PUBLIC_SUPABASE_URL / ANON_KEY not readable here, so GoTrue was never asked'
				: 'the auth server could not be reached, so the signup setting is unverified';
			return record(3, 'signup gate', UNKNOWN, reason, [
				'This gate FAILS OPEN by design so a network blip cannot block shipping — which means it proved nothing.',
				'Re-run it from somewhere that can reach the Supabase auth endpoint before trusting the deploy.'
			]);
		}
		return record(3, 'signup gate', UNKNOWN, 'exited 0 with no verdict this script recognises', [
			'Read the output above and re-check scripts/preflight-auth.mjs — its contract has changed under this gate.'
		]);
	}
	if (code === 1) {
		const both = /Both doors are open/.test(out);
		const anon = /disable_signup=false/.test(out);
		const pin = /ADMIN_PIN is not set/.test(out);
		return record(
			3,
			'signup gate',
			FAIL,
			both ? 'BOTH doors open' : anon ? 'the anon-key door is open' : pin ? 'ADMIN_PIN is not set' : 'registration is open',
			[
				anon &&
					'Close the anon door FIRST: GOTRUE_DISABLE_SIGNUP=true on the auth service, or Authentication > Providers > Email > "Allow new users to sign up" OFF.',
				pin && 'Set ADMIN_PIN on the app service so /api/auth/signup has something to ask for.',
				'Registration keeps working after the flip — the route creates users with the service role.'
			].filter(Boolean)
		);
	}
	const reason = unrunnableReason(out) || `exit ${code}, which this check does not use for a verdict`;
	return record(3, 'signup gate', UNKNOWN, reason, unknownTodo(reason));
}

// ── run them ────────────────────────────────────────────────────────────────
// Every gate runs even after one fails. A preflight that stops at the first
// problem makes you run it three times to learn three things, and the backup —
// the expensive one — is the gate you least want to skip on a day when the
// ledger is already unhappy.
const started = Date.now();
console.log('\n  Pre-deploy preflight — the same gates deploy.ps1 runs, for the paths that do not run deploy.ps1.');
console.log(`  Root ${appRoot}`);
console.log(`  Backup freshness threshold: ${maxAgeMinutes} minutes.${warnOnly ? '  (--warn-only: nothing will block)' : ''}`);

await gateLedger();
await gateBackup();
await gateSignup();

// ── verdict ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.state === FAIL);
const unknown = results.filter((r) => r.state === UNKNOWN);
const elapsed = Math.round((Date.now() - started) / 1000);

console.log('\n  ─────────────────────────────────────────────────────────────────────────');
for (const r of results) {
	console.log(`  ${r.n}. ${r.name.padEnd(22)} ${r.state.padEnd(8)} ${r.detail}`);
}
console.log('  ─────────────────────────────────────────────────────────────────────────');

for (const r of results) {
	if (!r.todo.length || r.state === PASS) continue;
	console.log(`\n  ${r.n}. ${r.name} — ${r.state}. What to do:`);
	for (const line of r.todo) console.log(`       · ${line}`);
}

let exitCode = 0;
if (failed.length) {
	console.log(
		`\n  VERDICT: DO NOT DEPLOY — ${failed.length} gate(s) FAILED${unknown.length ? `, ${unknown.length} UNKNOWN` : ''}. (${elapsed}s)`
	);
	exitCode = 1;
} else if (unknown.length) {
	console.log(
		`\n  VERDICT: NOTHING PROVED — ${unknown.length} gate(s) could not run. This is not a pass. (${elapsed}s)`
	);
	exitCode = 2;
} else {
	console.log(`\n  VERDICT: SAFE TO DEPLOY — all ${results.length} gates passed. (${elapsed}s)`);
}

// Said on every run, including a clean one: the gate that passed is about the
// DATABASE. The media bytes are not in a backup at all and no deploy gate can
// make them be — teaching people otherwise is how a green check becomes a lie.
console.log('  Note: a passing backup gate proves the DATABASE restores. Media bytes are never in a backup.\n');

if (warnOnly && exitCode !== 0) {
	console.log('  --warn-only: reporting, not blocking. Exiting 0.\n');
	exitCode = 0;
}
process.exit(exitCode);
