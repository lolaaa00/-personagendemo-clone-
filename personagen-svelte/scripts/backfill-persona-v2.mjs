/**
 * Persona Model v2 — silent backfill runner (P1.7).
 *
 *   node scripts/backfill-persona-v2.mjs --mode shadow [--base https://host] [--limit 500] [--agent <id>]
 *   node scripts/backfill-persona-v2.mjs --mode fill   ...
 *
 * A THIN HTTP CLIENT, like every other script in this repo. The work happens in
 * the app at POST /api/admin/persona-backfill, because that is where the `$lib`
 * aliases resolve, where the service client lives, and where the budget gate,
 * the credit gate and the generation-events ledger already sit ready for Tier 2.
 * A script that imported the backfill directly would have to reimplement all of
 * that or reach around it — see the endpoint's header for the full reasoning.
 *
 * `shadow` reads only and is the GATE to `fill`: a shadow report with zero
 * contradictions is what earns the right to write. `fill` persists, and refuses
 * to run without --yes, because an ops script that mutates a table on a bare
 * invocation will eventually be run by someone who meant to look.
 *
 * Credentials come from the environment, never from arguments — an argument
 * ends up in shell history:
 *   BACKFILL_ADMIN_EMAIL, BACKFILL_ADMIN_PASSWORD   (a platform admin)
 *
 * Always writes docs/audit/persona-backfill-<mode>-<date>.md. Exits non-zero on
 * any failure or contract violation, so CI can run the shadow pass.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

const args = process.argv.slice(2);
const opt = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(name);

const BASE = (opt('--base') || 'https://honeyx.monarchstack.com').replace(/\/$/, '');
const MODE = opt('--mode') || 'shadow';
const LIMIT = Number(opt('--limit') || 500);
const AGENT = opt('--agent') || null;
const EMAIL = process.env.BACKFILL_ADMIN_EMAIL;
const PASSWORD = process.env.BACKFILL_ADMIN_PASSWORD;

if (MODE !== 'shadow' && MODE !== 'fill') {
	console.error(`--mode must be 'shadow' or 'fill' (got '${MODE}')`);
	process.exit(2);
}
if (MODE === 'fill' && !flag('--yes')) {
	console.error('fill PERSISTS to the agents table. Re-run with --yes once a shadow report is clean.');
	process.exit(2);
}
if (!EMAIL || !PASSWORD) {
	console.error('Set BACKFILL_ADMIN_EMAIL and BACKFILL_ADMIN_PASSWORD (a platform admin).');
	process.exit(2);
}

const jar = new Map();
const absorb = (res) => {
	for (const c of res.headers.getSetCookie?.() ?? []) {
		const [pair] = c.split(';');
		const i = pair.indexOf('=');
		if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
	}
};
async function app(path, init = {}) {
	const headers = { ...(init.headers || {}) };
	if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
	const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
	absorb(res);
	return res;
}
const post = (path, body) =>
	app(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const login = await post('/api/auth/login', { email: EMAIL, password: PASSWORD });
if (login.status !== 200) {
	console.error(`login failed: HTTP ${login.status}`);
	process.exit(1);
}

const res = await post('/api/admin/persona-backfill', {
	mode: MODE,
	tier: 1,
	limit: LIMIT,
	...(AGENT ? { agentId: AGENT } : {})
});
const body = await res.json().catch(() => ({}));
if (!body.success) {
	console.error(`backfill failed: HTTP ${res.status} ${body.error ?? ''}`);
	process.exit(1);
}

const d = body.data;
const date = new Date().toISOString().slice(0, 10);
const report = join(REPO, 'docs', 'audit', `persona-backfill-${MODE}-${date}.md`);

const pathRows = Object.entries(d.addedByPath).sort((a, b) => b[1] - a[1]);
/** A handful of real examples beats a count — a reviewer can judge a value. */
const samples = (d.detail ?? []).filter((o) => o.added.length).slice(0, 5);

const lines = [
	`# Persona backfill — Tier ${d.tier}, ${MODE} — ${date}`,
	'',
	`Host \`${BASE}\`. Started ${d.startedAt}, finished ${d.finishedAt}.`,
	'',
	MODE === 'shadow'
		? '**Nothing was written.** This report states exactly what `fill` would do.'
		: '**This run PERSISTED.** Rows listed below were updated in the `agents` table.',
	'',
	'| | |',
	'|---|---|',
	`| Personas scanned | ${d.scanned} |`,
	`| Would change / changed | ${d.changed} |`,
	`| Rows written | ${d.written} |`,
	`| Failed | ${d.failed} |`,
	`| Stored as v1, upgraded on read | ${d.upgradedCount} |`,
	`| Contract violations | ${d.violations.length} |`,
	'',
	'## Leaves derived',
	'',
	pathRows.length ? '| Leaf | Personas |\n|---|---|' : '_Nothing to derive — every persona scanned already holds every Tier 1 leaf._',
	...pathRows.map(([p, n]) => `| \`${p}\` | ${n} |`),
	''
];

if (d.violations.length) {
	lines.push(
		'## CONTRACT VIOLATIONS',
		'',
		'Tier 1 wrote outside the leaves it declares in `TIER_1_DERIVED_LEAVES`.',
		'**This is a defect in the backfill, not a finding about these personas.**',
		'Do not run `fill` until it is fixed.',
		'',
		...d.violations.slice(0, 50).map((v) => `- \`${v}\``),
		''
	);
}

if (samples.length) {
	lines.push('## Sample of what would be added', '');
	for (const s of samples) {
		lines.push(`**${s.name ?? '(unnamed)'}** — \`${s.agentId}\`${s.upgraded ? ' _(stored as v1)_' : ''}`, '');
		for (const leaf of s.added.slice(0, 8)) {
			const value = typeof leaf.value === 'string' ? leaf.value : JSON.stringify(leaf.value);
			lines.push(`- \`${leaf.path}\` → ${String(value).slice(0, 200)}`);
		}
		lines.push('');
	}
}

const errors = (d.detail ?? []).filter((o) => o.error);
if (errors.length) {
	lines.push('## Failures', '', ...errors.slice(0, 25).map((e) => `- \`${e.agentId}\`: ${e.error}`), '');
}

if (d.detailTruncated) {
	lines.push(`_Per-agent detail is capped at 200 rows; the counts above cover all ${d.scanned}._`, '');
}

await mkdir(dirname(report), { recursive: true });
await writeFile(report, lines.join('\n'), 'utf8');

console.log(
	`tier ${d.tier} ${MODE}: scanned ${d.scanned}, ${MODE === 'shadow' ? 'would change' : 'changed'} ${d.changed}, wrote ${d.written}, failed ${d.failed}, violations ${d.violations.length}`
);
console.log(`report → ${report}`);
process.exit(d.failed || d.violations.length ? 1 : 0);
