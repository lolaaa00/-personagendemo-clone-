#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Database-level verification of the activity-log schema — SAFE ON PRODUCTION.
// Everything runs inside BEGIN … ROLLBACK; nothing persists.
//
//   1. an event for "now" lands in this month's partition (not the default)
//   2. an event for a month with no partition lands in the DEFAULT partition
//      (inserts never fail for a missing month)
//   3. rollup_activity_daily() aggregates and is idempotent
//   4. anonymize_user_activity() nulls user_id, keeps subject_hash, drops presence
//   5. app roles cannot write events / read presence / call admin functions
//   6. admin_auth_events() reads GoTrue's audit trail
//   7. prune_activity_partitions() with a huge retention drops nothing
//
//   node scripts/verify-activity-db.mjs
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
async function pg(query) {
	const r = await fetch(`${URL_}/pg/query`, {
		method: 'POST',
		headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query })
	});
	const t = await r.text();
	let d;
	try {
		d = JSON.parse(t);
	} catch {
		d = t;
	}
	return { ok: r.ok, status: r.status, data: d };
}

const SQL = `
BEGIN;
CREATE TEMP TABLE _v (step TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE u UUID := '00000000-0000-4000-8000-00000000ac71'; sh TEXT := 'verify-subject-hash'; part TEXT; n INTEGER; n2 INTEGER; anon INTEGER; far DATE := (date_trunc('month', now()) + interval '14 months')::date;
BEGIN
  -- 1. current month → month partition
  INSERT INTO public.user_activity_events (user_id, subject_hash, actor_kind, category, action, outcome, duration_ms)
  VALUES (u, sh, 'user', 'nav', 'nav.page.view', 'ok', 12);
  SELECT tableoid::regclass::text INTO part FROM public.user_activity_events WHERE subject_hash = sh ORDER BY id DESC LIMIT 1;
  INSERT INTO _v SELECT '1 current-month event lands in month partition', part LIKE '%user_activity_events_' || to_char(now(), 'YYYY_MM'), part;

  -- 2. far-future month (no partition) → DEFAULT partition, insert does not fail
  INSERT INTO public.user_activity_events (occurred_at, user_id, subject_hash, actor_kind, category, action)
  VALUES (far, u, sh, 'user', 'nav', 'nav.page.view');
  SELECT tableoid::regclass::text INTO part FROM public.user_activity_events WHERE subject_hash = sh AND occurred_at::date = far LIMIT 1;
  INSERT INTO _v SELECT '2 month without a partition lands in DEFAULT partition', part LIKE '%user_activity_events_default', part;

  -- 3. rollup is idempotent
  INSERT INTO public.user_activity_events (user_id, subject_hash, actor_kind, category, action, outcome, duration_ms)
  VALUES (u, sh, 'user', 'generation', 'post.generate.requested', 'error', 40);
  n := public.rollup_activity_daily(current_date);
  n2 := public.rollup_activity_daily(current_date);
  INSERT INTO _v SELECT '3 rollup_activity_daily aggregates and re-runs cleanly',
    n >= 2 AND n2 = n AND (SELECT errors FROM public.user_activity_daily WHERE day = current_date AND subject_hash = sh AND action = 'post.generate.requested') = 1,
    'rows=' || n || ' rerun=' || n2;

  -- 4. anonymise keeps rows + subject_hash, drops user_id + presence
  INSERT INTO public.user_presence (user_id, last_seen_at) VALUES (u, now());
  anon := public.anonymize_user_activity(u);
  INSERT INTO _v SELECT '4 anonymize: user_id NULL, subject_hash kept, presence gone',
    anon = 3
    AND (SELECT count(*) FROM public.user_activity_events WHERE subject_hash = sh) = 3
    AND (SELECT count(*) FROM public.user_activity_events WHERE user_id = u) = 0
    AND NOT EXISTS (SELECT 1 FROM public.user_presence WHERE user_id = u),
    'anonymised=' || anon;

  -- 7. pruning with a huge window drops nothing
  INSERT INTO _v SELECT '7 prune_activity_partitions(36500) drops nothing', cardinality(public.prune_activity_partitions(36500)) = 0, '';
END $$;

-- 5. app roles locked out
INSERT INTO _v SELECT '5a authenticated cannot INSERT/UPDATE/DELETE user_activity_events',
  NOT has_table_privilege('authenticated', 'public.user_activity_events', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.user_activity_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.user_activity_events', 'DELETE'), '';
INSERT INTO _v SELECT '5b authenticated cannot read user_presence / user_activity_daily',
  NOT has_table_privilege('authenticated', 'public.user_presence', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.user_activity_daily', 'SELECT'), '';
INSERT INTO _v SELECT '5c authenticated cannot EXECUTE admin_auth_events / anonymize / rollup / prune',
  NOT has_function_privilege('authenticated', 'public.admin_auth_events(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.anonymize_user_activity(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.rollup_activity_daily(date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.prune_activity_partitions(integer)', 'EXECUTE'), '';

-- 6. GoTrue trail readable through the function
INSERT INTO _v SELECT '6 admin_auth_events() returns GoTrue login history',
  (SELECT count(*) FROM public.admin_auth_events(NULL, 50)) > 0, '';

SELECT step, ok, detail FROM _v ORDER BY step;
ROLLBACK;
`;

const res = await pg(SQL);
if (!res.ok) {
	console.error(`pg/query ${res.status}:`, typeof res.data === 'string' ? res.data.slice(0, 800) : JSON.stringify(res.data).slice(0, 800));
	process.exit(1);
}
const rows = Array.isArray(res.data) ? res.data : [];
if (rows.length === 0) {
	console.error('no assertion rows returned. Raw:', JSON.stringify(res.data).slice(0, 500));
	process.exit(1);
}
let failed = 0;
for (const r of rows) {
	const ok = r.ok === true || r.ok === 't';
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${rows.length - failed}/${rows.length} assertions held · everything rolled back`);
process.exit(failed ? 1 : 0);
