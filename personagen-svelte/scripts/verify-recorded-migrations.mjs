#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Read-only audit of the migration ledger's 'recorded' stamps.
//
// A 'recorded' row means "this file was stamped as already present when the
// ledger was introduced" — the runner never executed it. That stamp can be
// wrong (2026-09-07: three files were stamped but never applied, one of which
// silently stripped the billing attribution from every generation event). This
// script parses each recorded file for the objects it creates — tables, columns,
// functions, indexes — and checks they exist. Nothing is written.
//
//   node scripts/verify-recorded-migrations.mjs            report
//   node scripts/verify-recorded-migrations.mjs --strict   exit 1 on any missing object
//
// To repair: node scripts/apply-migration.mjs --unrecord <file> && node scripts/apply-migration.mjs supabase/<file>
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const env = { ...process.env };
const envPath = join(appRoot, '.env');
if (existsSync(envPath)) {
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		if (!(m[1] in process.env)) env[m[1]] = v;
	}
}
const URL_ = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
	console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
	process.exit(1);
}
const STRICT = process.argv.includes('--strict');
async function pg(query) {
	const r = await fetch(`${URL_}/pg/query`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
	const t = await r.text();
	if (!r.ok) throw new Error(`pg/query ${r.status}: ${t.slice(0, 300)}`);
	return JSON.parse(t);
}

const recorded = await pg(`select name from schema_migrations where mode = 'recorded' order by applied_at, name`);
const tables = new Set((await pg(`select table_name from information_schema.tables where table_schema = 'public'`)).map((r) => r.table_name));
const cols = new Set((await pg(`select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public'`)).map((r) => r.c));
const fns = new Set((await pg(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).map((r) => r.proname));
const idx = new Set((await pg(`select indexname from pg_indexes where schemaname = 'public'`)).map((r) => r.indexname));

/** Strip comments, then split on ';' so a match never spans two statements. */
function statements(sql) {
	const noComments = sql.replace(/--[^\n]*/g, '');
	// keep DO $$ ... $$ blocks intact (they contain ';')
	const out = [];
	let buf = '';
	let inDollar = false;
	for (const line of noComments.split('\n')) {
		if ((line.split('$$').length - 1) % 2 === 1) inDollar = !inDollar;
		buf += line + '\n';
		if (!inDollar && line.trim().endsWith(';')) {
			out.push(buf);
			buf = '';
		}
	}
	if (buf.trim()) out.push(buf);
	return out;
}

let missing = 0;
for (const { name } of recorded) {
	const path = join(appRoot, 'supabase', name);
	if (!existsSync(path)) {
		console.log(`??      ${name}: file missing from supabase/`);
		continue;
	}
	const want = [];
	for (const st of statements(readFileSync(path, 'utf8'))) {
		let m;
		if ((m = st.match(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)/i))) want.push(['table', m[1], tables.has(m[1])]);
		if ((m = st.match(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)/i))) {
			const table = m[1];
			for (const c of st.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/gi)) want.push(['column', `${table}.${c[1]}`, cols.has(`${table}.${c[1]}`)]);
		}
		for (const f of st.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi)) want.push(['function', f[1], fns.has(f[1])]);
		for (const i of st.matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS\s+)?(\w+)/gi)) want.push(['index', i[1], idx.has(i[1])]);
	}
	const bad = want.filter((w) => !w[2]);
	missing += bad.length;
	console.log(`${bad.length ? 'MISSING' : 'ok     '} ${name}  (${want.length} objects)${bad.length ? '\n         ' + bad.map((b) => `${b[0]} ${b[1]}`).join(', ') : ''}`);
}
console.log(`\n${recorded.length} recorded-only migrations · ${missing} missing object(s)`);
process.exit(STRICT && missing > 0 ? 1 : 0);
