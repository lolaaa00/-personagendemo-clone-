#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Regenerates client_bootstrap.sql — the single file that takes an EMPTY
// Postgres/Supabase database to the schema HEAD expects.
//
//   node supabase/build-bootstrap.mjs
//
// Why this exists: migration.sql + apply_all_pending.sql together miss three
// tables the app queries at runtime (generation_events, user_api_keys,
// processed_rss_items) plus a dozen column adds. A fresh deploy built from the
// documented path boots and then 500s. This concatenates every migration in
// dependency-safe order and rewrites each statement to be re-runnable.
//
// Edit ORDER below when you add a migration; never hand-edit the .sql output.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Dependency-safe order. Rationale for the non-obvious placements:
//   - connections_provider_metadata BEFORE blotato_provider: the former creates
//     connections.provider with CHECK ('composio','zernio'); the latter widens
//     it to include 'blotato'.
//   - user_api_keys BEFORE blotato_provider: blotato_provider ALTERs
//     public.user_api_keys, which must already exist.
//   - brand_briefs_unique_migration.sql is DELIBERATELY OMITTED. It adds
//     UNIQUE(user_id) that multi_brand_briefs immediately drops, and its bare
//     ADD CONSTRAINT is the one non-idempotent statement in the whole set.
//     Net schema is identical without it.
//   - The 8 migrations already folded into apply_all_pending.sql are omitted
//     individually (see that file's header).
// ORDER lives in migrations.json — shared with scripts/apply-migration.mjs and
// /api/health so the bootstrap, the runner, and the pending-count all agree.
const ORDER = JSON.parse(readFileSync(join(here, 'migrations.json'), 'utf8'));

/** Rewrite a migration so every statement can be replayed against a DB that already has it. */
function makeReRunnable(sql) {
	let out = sql;

	// Strip pre-existing guards so we can re-emit them uniformly (no duplicates).
	out = out.replace(/^[ \t]*DROP POLICY IF EXISTS "[^"]+" ON [\w.]+;[ \t]*\r?\n/gm, '');
	out = out.replace(/^[ \t]*DROP TRIGGER IF EXISTS \w+ ON [\w.]+;[ \t]*\r?\n/gm, '');

	// CREATE TABLE public.x  ->  CREATE TABLE IF NOT EXISTS public.x
	out = out.replace(/CREATE TABLE (?!IF NOT EXISTS)(public\.\w+)/g, 'CREATE TABLE IF NOT EXISTS $1');

	// CREATE [UNIQUE] INDEX idx_x  ->  ... IF NOT EXISTS idx_x
	out = out.replace(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)(\w+)/g, (_m, u, n) => `CREATE ${u || ''}INDEX IF NOT EXISTS ${n}`);

	// ADD COLUMN x  ->  ADD COLUMN IF NOT EXISTS x
	out = out.replace(/ADD COLUMN (?!IF NOT EXISTS)/g, 'ADD COLUMN IF NOT EXISTS ');

	// Every CREATE POLICY gets a matching DROP immediately before it.
	out = out.replace(
		/CREATE POLICY "([^"]+)" ON ([\w.]+)/g,
		(_m, name, tbl) => `DROP POLICY IF EXISTS "${name}" ON ${tbl};\nCREATE POLICY "${name}" ON ${tbl}`
	);

	// Same for triggers (handles both `BEFORE UPDATE ON` and `AFTER INSERT ON`).
	out = out.replace(
		/CREATE TRIGGER (\w+)(\s+)(BEFORE|AFTER)(\s+)(\w+)(\s+)ON(\s+)([\w.]+)/g,
		(_m, name, s1, when, s2, evt, s3, s4, tbl) =>
			`DROP TRIGGER IF EXISTS ${name} ON ${tbl};\nCREATE TRIGGER ${name}${s1}${when}${s2}${evt}${s3}ON${s4}${tbl}`
	);

	return out;
}

const banner = (i, file, note) => {
	const title = `${String(i).padStart(2, '0')}. ${file}`;
	return [
		'',
		`-- ${'─'.repeat(74)}`,
		`-- ${title}`,
		`--     ${note}`,
		`-- ${'─'.repeat(74)}`,
		'',
	].join('\n');
};

const parts = [
	`-- ${'═'.repeat(74)}`,
	'-- PersonaGen — client_bootstrap.sql',
	'--',
	'-- GENERATED FILE — do not hand-edit. Regenerate with:',
	'--     node supabase/build-bootstrap.mjs',
	'--',
	'-- Takes an EMPTY Postgres 15+ database (with Supabase auth.users present)',
	'-- to the schema HEAD expects. Every statement is guarded, so the file is',
	'-- safe to re-run against a partially-migrated database.',
	'--',
	'-- Run it in ONE transaction (the Supabase SQL editor does this for you):',
	'--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f client_bootstrap.sql',
	`-- ${'═'.repeat(74)}`,
];

for (const [i, [file, note]] of ORDER.entries()) {
	const raw = readFileSync(join(here, file), 'utf8');
	parts.push(banner(i + 1, file, note), makeReRunnable(raw).trim(), '');
}

const sql = parts.join('\n') + '\n';
writeFileSync(join(here, 'client_bootstrap.sql'), sql, 'utf8');
console.log(`client_bootstrap.sql written — ${ORDER.length} migrations, ${sql.split('\n').length} lines`);
