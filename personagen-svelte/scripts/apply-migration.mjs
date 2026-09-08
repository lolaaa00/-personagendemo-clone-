#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Migration runner — the ONLY supported way to change the production schema.
//
//   node scripts/apply-migration.mjs --status                 list ORDER: applied / pending / DRIFTED
//   node scripts/apply-migration.mjs <file.sql> [...]         apply (transactional, recorded, idempotent)
//   node scripts/apply-migration.mjs --dry-run <file.sql>     show what would run, touch nothing
//   node scripts/apply-migration.mjs --record-existing --through <file>
//                                                             stamp ORDER files up to <file> as already live
//                                                             (first run on a DB that predates the ledger)
//   node scripts/apply-migration.mjs --unrecord <name>...     remove a WRONG 'recorded' stamp (never an applied one)
//   node scripts/apply-migration.mjs --rehash [--dry-run]     one-time: move ledger rows written under the old
//                                                             byte-sensitive hash onto the content hash
//   node scripts/apply-migration.mjs --all                    apply every pending ORDER file, in order
//
// Guarantees (see docs/monetization/durable-implementation-plan.md, D6):
//   * each file runs inside BEGIN/COMMIT together with its ledger row — a failing
//     statement leaves neither the schema change nor the record;
//   * a file whose checksum differs from the recorded one is REFUSED — edit
//     history is never replayed, a new migration is written instead;
//   * a file already recorded with the same checksum is a no-op;
//   * the checksum is a CONTENT hash: CRLF/CR are normalised to LF and a BOM is
//     stripped before hashing, so a record written from a Windows checkout
//     verifies from a Linux worktree or CI and vice versa.
//
// Transport: the same `${PUBLIC_SUPABASE_URL}/pg/query` endpoint the legacy
// run-migrations.js used, authenticated with the service-role key from .env.
// Read-only invocations (--status, --dry-run) never send anything but SELECTs.
// ═══════════════════════════════════════════════════════════════════════════

import { hashSql, classifyChecksum } from './lib/migration-checksum.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const supabaseDir = join(appRoot, 'supabase');

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
	const envPath = join(appRoot, '.env');
	const out = { ...process.env };
	if (!existsSync(envPath)) return out;
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		if (!(m[1] in process.env)) out[m[1]] = v;
	}
	return out;
}
const env = loadEnv();
const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// ── ORDER (single source of truth: supabase/migrations.json) ────────────────
async function loadOrder() {
	const raw = JSON.parse(readFileSync(join(supabaseDir, 'migrations.json'), 'utf8'));
	if (!Array.isArray(raw)) throw new Error('migrations.json must be an array of [file, note]');
	return raw.map(([file, note]) => ({ file, note }));
}

// Checksums live in scripts/lib/migration-checksum.mjs: a CONTENT hash (CRLF
// folded to LF, BOM stripped) so a record written from any checkout verifies
// from every other one. `classifyChecksum` is the only drift authority here.
const sha256 = hashSql;

async function pgQuery(query) {
	if (!SUPABASE_URL || !SERVICE_KEY) {
		throw new Error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (env or personagen-svelte/.env)');
	}
	const res = await fetch(`${SUPABASE_URL}/pg/query`, {
		method: 'POST',
		headers: {
			apikey: SERVICE_KEY,
			Authorization: `Bearer ${SERVICE_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ query })
	});
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	if (!res.ok) {
		const msg = typeof data === 'string' ? data : data?.message || data?.error || JSON.stringify(data);
		throw new Error(`pg/query ${res.status}: ${String(msg).slice(0, 500)}`);
	}
	return data;
}

async function ledgerExists() {
	const rows = await pgQuery(
		`SELECT 1 AS ok FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations'`
	);
	return Array.isArray(rows) && rows.length > 0;
}

async function readLedger() {
	if (!(await ledgerExists())) return new Map();
	const rows = await pgQuery(`SELECT name, checksum, applied_at, mode FROM public.schema_migrations`);
	return new Map((rows || []).map((r) => [r.name, r]));
}

function readMigration(fileArg) {
	const path = existsSync(fileArg) ? resolve(fileArg) : join(supabaseDir, fileArg);
	if (!existsSync(path)) throw new Error(`migration not found: ${fileArg}`);
	const sql = readFileSync(path, 'utf8');
	return { name: basename(path), path, sql, checksum: sha256(sql) };
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function wrap(m, mode = 'applied') {
	// The ledger INSERT rides in the same transaction as the schema change.
	return [
		'BEGIN;',
		m.sql,
		`INSERT INTO public.schema_migrations (name, checksum, applied_by, mode) VALUES (${q(m.name)}, ${q(m.checksum)}, ${q(`${env.USERNAME || env.USER || 'unknown'}@${hostname()}`)}, ${q(mode)});`,
		'COMMIT;',
		// PostgREST caches the schema; without this a column added here is
		// invisible to the REST layer (PGRST204) until the service restarts.
		"NOTIFY pgrst, 'reload schema';"
	].join('\n');
}

// ── commands ─────────────────────────────────────────────────────────────────
async function cmdStatus() {
	const order = await loadOrder();
	const ledger = await readLedger();
	let pending = 0,
		drifted = 0;
	const rows = [];
	for (const { file, note } of order) {
		const path = join(supabaseDir, file);
		if (!existsSync(path)) {
			rows.push(['MISSING-FILE', file, note]);
			drifted++;
			continue;
		}
		const checksum = sha256(readFileSync(path, 'utf8'));
		const rec = ledger.get(file);
		if (!rec) {
			rows.push(['pending', file, note]);
			pending++;
		} else if (rec.checksum !== checksum) {
			// A row written under the old byte-sensitive rule covers identical
			// content — say so, so nobody re-applies or rewrites a file over it.
			const legacy = classifyChecksum(readFileSync(path, 'utf8'), rec.checksum) === 'legacy';
			rows.push([
				legacy ? 'LEGACY-HASH' : 'DRIFTED',
				file,
				legacy
					? `same content, hashed before line-ending normalisation — run --rehash`
					: `recorded ${rec.checksum.slice(0, 8)} ≠ file ${checksum.slice(0, 8)}`
			]);
			drifted++;
		} else {
			rows.push([rec.mode === 'recorded' ? 'recorded' : 'applied', file, (rec.applied_at || '').slice(0, 19)]);
		}
	}
	for (const r of rows) console.log(r[0].padEnd(13), r[1].padEnd(58), r[2]);
	console.log(`\n${order.length} in ORDER · ${pending} pending · ${drifted} drifted${ledger.size === 0 ? ' · (ledger table absent — run 000_schema_migrations.sql first)' : ''}`);
	return { pending, drifted };
}

async function cmdApply(files, { dryRun }) {
	const ledger = await readLedger();
	for (const f of files) {
		const m = readMigration(f);
		const rec = ledger.get(m.name);
		if (rec && rec.checksum === m.checksum) {
			console.log(`skip     ${m.name} (already ${rec.mode}, checksum matches)`);
			continue;
		}
		if (rec && classifyChecksum(m.sql, rec.checksum) === 'legacy') {
			console.log(`skip     ${m.name} (already ${rec.mode}; recorded under the pre-normalisation hash — run --rehash to update the ledger)`);
			continue;
		}
		if (rec && rec.checksum !== m.checksum) {
			console.error(`REFUSED  ${m.name}: recorded checksum ${rec.checksum.slice(0, 8)} differs from file ${m.checksum.slice(0, 8)}. Write a new migration instead of editing an applied one.`);
			process.exitCode = 2;
			continue;
		}
		if (m.name !== '000_schema_migrations.sql' && !(await ledgerExists())) {
			throw new Error('schema_migrations table missing — apply 000_schema_migrations.sql first');
		}
		const sql = m.name === '000_schema_migrations.sql' ? m.sql + '\n' + wrap({ ...m, sql: '' }).replace('BEGIN;\n\n', 'BEGIN;\n') : wrap(m);
		if (dryRun) {
			console.log(`--- would apply ${m.name} (${m.checksum.slice(0, 8)}) ---\n${sql}\n`);
			continue;
		}
		process.stdout.write(`apply    ${m.name} (${m.checksum.slice(0, 8)}) … `);
		await pgQuery(sql);
		console.log('ok');
		ledger.set(m.name, { checksum: m.checksum, mode: 'applied' });
	}
}

/**
 * Stamp migrations that were applied by hand BEFORE the ledger existed.
 * Requires an explicit boundary — `--through <file>` stamps every ORDER entry
 * up to and including that file — because the runner cannot tell a live
 * migration from a brand-new one by looking at the list. (The first run of
 * this command stamped two never-applied files; that is why the boundary is
 * mandatory now.)
 */
async function cmdRecordExisting(through) {
	if (!(await ledgerExists())) throw new Error('apply 000_schema_migrations.sql first');
	if (!through) throw new Error('--record-existing needs --through <file>: the LAST migration known to be live on this database');
	const order = await loadOrder();
	const idx = order.findIndex((o) => o.file === through);
	if (idx < 0) throw new Error(`--through ${through} is not in migrations.json`);
	const ledger = await readLedger();
	const stmts = [];
	for (const { file } of order.slice(0, idx + 1)) {
		if (ledger.has(file)) continue;
		const path = join(supabaseDir, file);
		if (!existsSync(path)) continue;
		const checksum = sha256(readFileSync(path, 'utf8'));
		stmts.push(
			`INSERT INTO public.schema_migrations (name, checksum, applied_by, mode) VALUES (${q(file)}, ${q(checksum)}, ${q('record-existing')}, 'recorded') ON CONFLICT (name) DO NOTHING;`
		);
	}
	if (stmts.length === 0) return console.log('nothing to record');
	await pgQuery(['BEGIN;', ...stmts, 'COMMIT;'].join('\n'));
	console.log(`recorded ${stmts.length} pre-existing migration(s) through ${through}`);
}

/**
 * Remove a 'recorded' stamp that was wrong (the file was never actually
 * applied). Refuses to touch rows the runner itself applied — those represent
 * real schema changes and are never un-done from here.
 */
async function cmdUnrecord(names) {
	if (names.length === 0) throw new Error('--unrecord needs at least one migration name');
	const ledger = await readLedger();
	for (const n of names) {
		const rec = ledger.get(n);
		if (!rec) {
			console.log(`skip     ${n} (not in ledger)`);
			continue;
		}
		if (rec.mode !== 'recorded') {
			console.error(`REFUSED  ${n}: mode is '${rec.mode}' (applied by the runner) — only 'recorded' stamps can be removed`);
			process.exitCode = 2;
			continue;
		}
		await pgQuery(`DELETE FROM public.schema_migrations WHERE name = ${q(n)} AND mode = 'recorded';`);
		console.log(`unrecord ${n}`);
	}
}

/**
 * One-time repair for rows written before the hash ignored line endings.
 *
 * ONLY rewrites a row whose recorded checksum equals the file's RAW hash — that
 * is proof the row covers exactly these bytes under the old rule, so the update
 * changes bookkeeping and nothing else. A row whose content genuinely differs is
 * REFUSED and reported; that is real drift and still needs a human. No schema is
 * touched: this writes checksums in schema_migrations only.
 */
async function cmdRehash({ dryRun }) {
	if (!(await ledgerExists())) throw new Error('schema_migrations table missing');
	const order = await loadOrder();
	const ledger = await readLedger();
	const updates = [];
	const refused = [];
	for (const { file } of order) {
		const path = join(supabaseDir, file);
		const rec = ledger.get(file);
		if (!rec || !existsSync(path)) continue;
		const sql = readFileSync(path, 'utf8');
		const want = sha256(sql);
		const state = classifyChecksum(sql, rec.checksum);
		if (state === 'current') continue;
		if (state === 'legacy') updates.push({ file, from: rec.checksum, to: want });
		else refused.push({ file, recorded: rec.checksum, file_hash: want });
	}
	for (const r of refused) {
		console.error(`REFUSED  ${r.file}: recorded ${r.recorded.slice(0, 8)} matches neither the normalised (${r.file_hash.slice(0, 8)}) nor the raw hash — real drift, not a line-ending artefact`);
	}
	if (updates.length === 0) {
		console.log(refused.length ? 'nothing safe to rehash' : 'ledger already uses content hashes — nothing to do');
		if (refused.length) process.exitCode = 2;
		return;
	}
	for (const u of updates) console.log(`${dryRun ? 'would rehash' : 'rehash  '} ${u.file.padEnd(58)} ${u.from.slice(0, 8)} → ${u.to.slice(0, 8)}`);
	if (dryRun) {
		console.log(`\n${updates.length} row(s) would be updated · ${refused.length} refused · nothing was written`);
		return;
	}
	const stmts = updates.map((u) => `UPDATE public.schema_migrations SET checksum = ${q(u.to)} WHERE name = ${q(u.file)} AND checksum = ${q(u.from)};`);
	await pgQuery(['BEGIN;', ...stmts, 'COMMIT;'].join('\n'));
	console.log(`\nrehashed ${updates.length} ledger row(s)${refused.length ? ` · ${refused.length} REFUSED` : ''}`);
	if (refused.length) process.exitCode = 2;
}

async function cmdAll({ dryRun }) {
	const order = await loadOrder();
	const ledger = await readLedger();
	const pending = order.map((o) => o.file).filter((f) => !ledger.has(f) && existsSync(join(supabaseDir, f)));
	if (pending.length === 0) return console.log('no pending migrations');
	await cmdApply(pending, { dryRun });
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));
try {
	if (flags.has('--status')) {
		const { pending, drifted } = await cmdStatus();
		if (flags.has('--strict') && (pending > 0 || drifted > 0)) process.exitCode = 3;
	} else if (flags.has('--record-existing')) {
		const i = args.indexOf('--through');
		await cmdRecordExisting(i >= 0 ? args[i + 1] : null);
	} else if (flags.has('--unrecord')) await cmdUnrecord(files);
	else if (flags.has('--rehash')) await cmdRehash({ dryRun: flags.has('--dry-run') });
	else if (flags.has('--all')) await cmdAll({ dryRun: flags.has('--dry-run') });
	else if (files.length) await cmdApply(files, { dryRun: flags.has('--dry-run') });
	else {
		console.log(
			'usage: apply-migration.mjs --status [--strict] | --record-existing --through <file> | --unrecord <name>... | --rehash [--dry-run] | --all [--dry-run] | [--dry-run] <file.sql>...'
		);
		process.exitCode = 1;
	}
} catch (e) {
	console.error('ERROR:', e.message);
	process.exitCode = 1;
}
