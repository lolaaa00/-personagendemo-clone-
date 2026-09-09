#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Database backup — the whole of production, to files on your disk.
//
//   node scripts/backup-db.mjs                 write a dated backup
//   node scripts/backup-db.mjs --out DIR       somewhere other than ./backup
//   node scripts/backup-db.mjs --verify [DIR]  re-read a backup and check it
//   node scripts/backup-db.mjs --sql [DIR]     emit restore.sql from a backup
//   node scripts/backup-db.mjs --check-restore    prove the backup still loads
//
// There was no backup of any kind. 20 MB holds every account, every credit
// balance and the whole ledger; a lost volume loses the business, not a
// deployment. This is the smallest thing that fixes that: read-only SELECTs
// through the same /pg/query endpoint the migration runner uses, one JSON file
// per table, plus a manifest recording row counts and the migration ledger head
// so a restore can prove it is putting data back into the schema it came from.
//
// THE FILES CONTAIN SECRETS. auth.users carries password hashes; user_api_keys
// and zernio_keys carry encrypted provider keys — the ciphertext only, since
// the passphrase lives in the server environment and never in the database, so
// a stolen backup alone cannot decrypt them. ./backup is gitignored. Keep it
// that way, and treat a copy the way you would treat the database itself.
//
// Restoring: --sql writes restore.sql beside the backup. Every row goes back
// through json_populate_recordset(null::public.<table>, '<the json we dumped>'),
// so POSTGRES does the type coercion — no hand-written literal has to be right
// about arrays, jsonb, timestamps or enums. Foreign keys are deferred with
// session_replication_role = replica, which removes load order as a question.
// The file is not run for you; read it, then run it against the empty database.
//
// Partition CHILDREN are skipped: selecting the parent returns every row, so
// dumping both would double every activity event.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

function die(msg) {
	console.error(`\n  ${msg}\n`);
	process.exit(1);
}

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
	const path = join(appRoot, '.env');
	if (!existsSync(path)) die('.env not found next to package.json — run this from the app checkout.');
	const out = {};
	for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
		if (!line.includes('=') || line.trim().startsWith('#')) continue;
		const i = line.indexOf('=');
		out[line.slice(0, i).trim()] = line
			.slice(i + 1)
			.trim()
			.replace(/^["']|["']$/g, '');
	}
	return out;
}
const env = loadEnv();
const URL_BASE = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) die('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env');

async function q(sql) {
	const res = await fetch(`${URL_BASE}/pg/query`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
		body: JSON.stringify({ query: sql })
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`not JSON: ${text.slice(0, 300)}`);
	}
	if (!Array.isArray(parsed)) throw new Error(`unexpected shape: ${text.slice(0, 300)}`);
	return parsed;
}

/** Every base table in public, minus partition children (the parent has the rows). */
async function tablesToDump() {
	const rows = await q(
		"SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
			"WHERE n.nspname = 'public' AND c.relkind IN ('r','p') " +
			'AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid) ORDER BY 1'
	);
	return rows.map((r) => r.name);
}

// auth.users is not ours to model, so take the columns a restore needs and no
// more. Without it every credit balance points at an account that is gone.
const AUTH_COLUMNS =
	'id, email, encrypted_password, email_confirmed_at, created_at, updated_at, ' +
	'last_sign_in_at, raw_user_meta_data, raw_app_meta_data, is_super_admin, phone';

async function backup(outRoot) {
	const startedAt = new Date();
	const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const dir = join(outRoot, stamp);
	mkdirSync(dir, { recursive: true });

	const tables = await tablesToDump();
	const manifest = {
		taken_at: startedAt.toISOString(),
		source: URL_BASE,
		tables: {},
		auth_users: 0,
		migrations_head: null,
		migrations_count: 0,
		total_rows: 0
	};

	let total = 0;
	for (const t of tables) {
		if (!/^[a-z0-9_]+$/i.test(t)) die(`refusing to dump a table with an unexpected name: ${t}`);
		const rows = await q(`SELECT * FROM public."${t}"`);
		writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, '\t'), 'utf-8');
		manifest.tables[t] = rows.length;
		total += rows.length;
		process.stdout.write(`  ${t.padEnd(32)} ${String(rows.length).padStart(6)}\n`);
	}

	const users = await q(`SELECT ${AUTH_COLUMNS} FROM auth.users ORDER BY created_at`);
	writeFileSync(join(dir, 'auth_users.json'), JSON.stringify(users, null, '\t'), 'utf-8');
	manifest.auth_users = users.length;
	total += users.length;
	process.stdout.write(`  ${'auth.users'.padEnd(32)} ${String(users.length).padStart(6)}\n`);

	// The schema the data came from. A restore that cannot match this is a
	// restore into the wrong shape, and the manifest is where that shows up.
	const head = await q(
		'SELECT name FROM public.schema_migrations ORDER BY applied_at DESC, name DESC LIMIT 1'
	);
	const count = await q('SELECT count(*)::int AS n FROM public.schema_migrations');
	manifest.migrations_head = head[0]?.name ?? null;
	manifest.migrations_count = count[0]?.n ?? 0;
	manifest.total_rows = total;
	writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, '\t'), 'utf-8');

	console.log(`\n  ${total} rows from ${tables.length + 1} tables → ${dir}`);
	console.log(`  schema: ${manifest.migrations_count} migrations, head ${manifest.migrations_head}`);
	console.log('\n  These files hold password hashes and encrypted provider keys.');
	console.log('  Copy them somewhere safe; never commit them.\n');
	return dir;
}

/** Re-read a backup and check it against what its own manifest claims. */
function verify(dir) {
	const manifestPath = join(dir, 'manifest.json');
	if (!existsSync(manifestPath)) die(`no manifest.json in ${dir} — not a backup directory`);
	const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
	const problems = [];
	let checked = 0;

	const check = (file, expected, label) => {
		const f = join(dir, file);
		if (!existsSync(f)) return problems.push(`${label}: file missing`);
		let rows;
		try {
			rows = JSON.parse(readFileSync(f, 'utf-8'));
		} catch (e) {
			return problems.push(`${label}: unreadable (${e.message})`);
		}
		if (!Array.isArray(rows)) return problems.push(`${label}: not an array`);
		if (rows.length !== expected) return problems.push(`${label}: ${rows.length} rows, manifest says ${expected}`);
		checked++;
	};

	for (const [table, expected] of Object.entries(m.tables)) check(`${table}.json`, expected, table);
	check('auth_users.json', m.auth_users, 'auth.users');

	if (problems.length) {
		console.error(`\n  ${problems.length} problem(s) in ${dir}:`);
		for (const p of problems) console.error(`    · ${p}`);
		process.exit(1);
	}
	console.log(`\n  ${dir}`);
	console.log(`  ${checked} files match the manifest — ${m.total_rows} rows, taken ${m.taken_at}`);
	console.log(`  schema at capture: ${m.migrations_count} migrations, head ${m.migrations_head}\n`);
}

/**
 * Emit restore.sql for a backup. Nothing is executed — this writes a file.
 *
 * Every statement is the same shape, because the dumped JSON is already the
 * exact row: Postgres coerces it back through json_populate_recordset rather
 * than trusting a literal we wrote by hand.
 */
function emitSql(dir) {
	const manifestPath = join(dir, 'manifest.json');
	if (!existsSync(manifestPath)) die(`no manifest.json in ${dir} — not a backup directory`);
	const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
	const lit = (json) => `'${JSON.stringify(json).replace(/'/g, "''")}'`;

	const out = [];
	out.push('-- Restore generated by scripts/backup-db.mjs');
	out.push(`-- Source ${m.source}, taken ${m.taken_at}`);
	out.push(`-- Schema at capture: ${m.migrations_count} migrations, head ${m.migrations_head}`);
	out.push('--');
	out.push('-- Run client_bootstrap.sql FIRST, against an empty database, and check that');
	out.push('-- its migration count matches the header above. Then run this, once, as a');
	out.push('-- superuser (session_replication_role needs it), inside one transaction:');
	out.push('--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f restore.sql');
	out.push('');
	out.push('BEGIN;');
	out.push('SET session_replication_role = replica;  -- load order stops mattering');
	out.push('');

	const users = JSON.parse(readFileSync(join(dir, 'auth_users.json'), 'utf-8'));
	if (users.length) {
		out.push('-- auth.users first: everything else points at it.');
		out.push(`INSERT INTO auth.users (${Object.keys(users[0]).map((c) => `"${c}"`).join(', ')})`);
		out.push(`SELECT ${Object.keys(users[0]).map((c) => `"${c}"`).join(', ')}`);
		out.push(`FROM json_populate_recordset(null::auth.users, ${lit(users)})`);
		out.push('ON CONFLICT (id) DO NOTHING;');
		out.push('');
	}

	let statements = users.length ? 1 : 0;
	for (const table of Object.keys(m.tables)) {
		const rows = JSON.parse(readFileSync(join(dir, `${table}.json`), 'utf-8'));
		if (!rows.length) {
			out.push(`-- public.${table}: empty at capture`);
			continue;
		}
		out.push(`INSERT INTO public."${table}"`);
		out.push(`SELECT * FROM json_populate_recordset(null::public."${table}", ${lit(rows)})`);
		out.push('ON CONFLICT DO NOTHING;');
		out.push('');
		statements++;
	}

	out.push("SET session_replication_role = 'origin';");
	out.push('COMMIT;');
	const file = join(dir, 'restore.sql');
	writeFileSync(file, out.join('\n'), 'utf-8');
	console.log(`\n  ${statements} INSERT statements → ${file}`);
	console.log('  Read it before you run it. It is not executed for you.\n');
	return file;
}

/**
 * Prove the backup would go back in, without putting anything back in.
 *
 * A backup nobody has ever restored is a promise, not a guarantee. This runs
 * the SAME json_populate_recordset conversion restore.sql uses — as a SELECT,
 * so Postgres does every cast against the live schema and discards the result.
 * A column that has since changed type fails here instead of during an outage.
 *
 * It also names columns the schema no longer has: json_populate_recordset drops
 * those silently, so without this they would vanish on restore without a word.
 */
async function checkRestore(dir) {
	const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
	const problems = [];
	let proved = 0;
	let rowsProved = 0;

	const live = await q(
		"SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"
	);
	const liveCols = new Map();
	for (const r of live) {
		if (!liveCols.has(r.table_name)) liveCols.set(r.table_name, new Set());
		liveCols.get(r.table_name).add(r.column_name);
	}

	for (const [table, expected] of Object.entries(m.tables)) {
		if (expected === 0) continue;
		const rows = JSON.parse(readFileSync(join(dir, `${table}.json`), 'utf-8'));
		const cols = liveCols.get(table);
		if (!cols) {
			problems.push(`${table}: the table no longer exists`);
			continue;
		}
		const gone = Object.keys(rows[0]).filter((c) => !cols.has(c));
		if (gone.length) problems.push(`${table}: column(s) the schema has dropped — ${gone.join(', ')} would be lost`);

		const json = JSON.stringify(rows).replace(/'/g, "''");
		try {
			const out = await q(
				`SELECT count(*)::int AS n FROM json_populate_recordset(null::public."${table}", '${json}'::json)`
			);
			const n = out[0]?.n ?? -1;
			if (n !== rows.length) problems.push(`${table}: Postgres read back ${n} of ${rows.length} rows`);
			else {
				proved++;
				rowsProved += n;
			}
		} catch (e) {
			problems.push(`${table}: will NOT load — ${e.message.slice(0, 160)}`);
		}
	}

	if (problems.length) {
		console.error(`\n  ${problems.length} problem(s) — this backup would not restore cleanly:`);
		for (const p of problems) console.error(`    · ${p}`);
		process.exit(1);
	}
	console.log(`\n  ${rowsProved} rows across ${proved} tables convert back into the live schema.`);
	console.log('  Read-only: nothing was written.');
}

// ── main ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
	const i = argv.indexOf(name);
	return i === -1 ? null : (argv[i + 1] ?? '');
};

function latestBackupDir() {
	const root = join(appRoot, 'backup');
	if (!existsSync(root)) die('no ./backup directory');
	const kids = readdirSync(root)
		.filter((d) => existsSync(join(root, d, 'manifest.json')))
		.sort();
	if (!kids.length) die('./backup holds no backups');
	return join(root, kids[kids.length - 1]);
}

if (argv.includes('--check-restore')) {
	checkRestore(resolve(flag('--check-restore') || latestBackupDir())).catch((e) => die(e.message));
} else if (argv.includes('--sql')) {
	emitSql(resolve(flag('--sql') || latestBackupDir()));
} else if (argv.includes('--verify')) {
	verify(resolve(flag('--verify') || latestBackupDir()));
} else {
	const out = resolve(flag('--out') || join(appRoot, 'backup'));
	console.log(`\n  Reading ${URL_BASE}\n`);
	backup(out)
		.then((dir) => verify(dir))
		.catch((e) => die(`backup FAILED — the table it stopped on was not written: ${e.message}`));
}
