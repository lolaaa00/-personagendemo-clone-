#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Database-level verification of the credits schema — SAFE ON PRODUCTION.
//
// Every check runs inside BEGIN … ROLLBACK in a single /pg/query session, so
// nothing persists: no wallet, no ledger row, no test user survives. It proves
// the guarantees the unit tests cannot (they mock the DB):
//   1. credit_apply upserts the wallet on first touch
//   2. 'set' targets a balance; ledger delta = target − previous
//   3. insufficient funds RAISE (fail closed) unless allow_negative
//   4. unmetered accounts waive debits and record what they would have cost
//   5. the per-event debit unique index rejects a second debit for one event
//   6. the stripe_event_id unique index rejects a replay
//   7. SUM(delta) == balance_credits after every step
//   8. app roles cannot call credit_apply / edit the ledger / edit subscriptions
//   9. the schema ledger records this migration
//
//   node scripts/verify-credits-db.mjs
// Exit 0 = every assertion held.
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

// One session, one transaction, rolled back at the end. Each numbered step
// writes a row into a TEMP results table so we get every assertion back in
// one round-trip, then ROLLBACK discards everything (temp table included).
const SQL = `
BEGIN;
CREATE TEMP TABLE _v (step TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

-- a throwaway auth user (rolled back with everything else)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-4000-8000-00000000c0de', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'verify-credits@personagen.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

DO $$
DECLARE u UUID := '00000000-0000-4000-8000-00000000c0de'; b BIGINT; d BIGINT; raised BOOLEAN; ev UUID; ledger_sum BIGINT;
        welcome BIGINT := COALESCE((SELECT (value #>> '{}')::bigint FROM public.platform_settings WHERE key = 'signup_credits'), 0);
BEGIN
  -- 0. the signup trigger granted welcome credits to the throwaway user above
  SELECT balance_credits INTO b FROM public.credit_accounts WHERE user_id = u;
  INSERT INTO _v SELECT '0 signup trigger grants welcome credits (platform_settings.signup_credits)',
    COALESCE(b, 0) = welcome AND (welcome = 0 OR EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = u AND kind = 'grant' AND note LIKE 'welcome%')),
    'welcome=' || welcome || ' balance=' || COALESCE(b, 0);

  -- 1. a grant lands on top of the welcome balance
  b := public.credit_apply(u, 500, 'grant', 'verify grant', NULL);
  INSERT INTO _v SELECT '1 grant adds 500 on top of welcome credits', b = welcome + 500 AND EXISTS (SELECT 1 FROM public.credit_accounts WHERE user_id = u), 'balance=' || b;

  -- 2. set targets a balance; ledger delta = target - previous
  b := public.credit_apply(u, 300, 'set', 'verify set', NULL);
  SELECT delta INTO d FROM public.credit_ledger WHERE user_id = u ORDER BY seq DESC LIMIT 1;
  INSERT INTO _v SELECT '2 set → 300, ledger delta = 300 − previous (latest by seq)', b = 300 AND d = 300 - (welcome + 500), 'balance=' || b || ' delta=' || d;

  -- 3. insufficient funds RAISE (fail closed)
  raised := false;
  BEGIN
    PERFORM public.credit_apply(u, -1000, 'debit', 'too much', NULL);
  EXCEPTION WHEN OTHERS THEN raised := SQLERRM LIKE 'INSUFFICIENT_CREDITS%';
  END;
  INSERT INTO _v SELECT '3 debit beyond balance raises INSUFFICIENT_CREDITS', raised, '';
  -- ...and allow_negative permits it (post-spend settle)
  b := public.credit_apply(u, -1000, 'debit', 'settle', NULL, NULL, NULL, NULL, NULL, 0, true);
  INSERT INTO _v SELECT '3b allow_negative settles to -700', b = -700, 'balance=' || b;

  -- 4. unmetered waives
  PERFORM public.credit_set_mode(u, 'unmetered');
  b := public.credit_apply(u, -50, 'debit', 'comped', NULL);
  SELECT waived_credits INTO d FROM public.credit_ledger WHERE user_id = u ORDER BY seq DESC LIMIT 1;
  INSERT INTO _v SELECT '4 unmetered: balance unchanged, waived=50', b = -700 AND d = 50, 'balance=' || b || ' waived=' || d;
  PERFORM public.credit_set_mode(u, 'credits');

  -- 5. per-event debit is idempotent
  INSERT INTO public.generation_events (user_id, provider, operation, model, est_cost) VALUES (u, 'fal', 'image', 'verify', 0.08) RETURNING id INTO ev;
  PERFORM public.credit_apply(u, -8, 'debit', 'event debit', NULL, ev, NULL, NULL, NULL, 0, true);
  raised := false;
  BEGIN
    PERFORM public.credit_apply(u, -8, 'debit', 'event debit again', NULL, ev, NULL, NULL, NULL, 0, true);
  EXCEPTION WHEN unique_violation THEN raised := true;
  END;
  INSERT INTO _v SELECT '5 second debit for the same generation_event rejected', raised, '';

  -- 6. stripe replay rejected
  PERFORM public.credit_apply(u, 1000, 'purchase', 'checkout', NULL, NULL, NULL, NULL, 'evt_verify_1');
  raised := false;
  BEGIN
    PERFORM public.credit_apply(u, 1000, 'purchase', 'checkout replay', NULL, NULL, NULL, NULL, 'evt_verify_1');
  EXCEPTION WHEN unique_violation THEN raised := true;
  END;
  INSERT INTO _v SELECT '6 stripe_event_id replay rejected', raised, '';

  -- 7. ledger sums to the cached balance
  SELECT COALESCE(SUM(delta), 0) INTO ledger_sum FROM public.credit_ledger WHERE user_id = u;
  SELECT balance_credits INTO b FROM public.credit_accounts WHERE user_id = u;
  INSERT INTO _v SELECT '7 SUM(ledger.delta) == credit_accounts.balance', ledger_sum = b, 'sum=' || ledger_sum || ' balance=' || b;
END $$;

-- 8. app roles are locked out
INSERT INTO _v SELECT '8a authenticated cannot EXECUTE credit_apply',
  NOT has_function_privilege('authenticated', 'public.credit_apply(uuid,bigint,text,text,uuid,uuid,uuid,uuid,text,bigint,boolean)', 'EXECUTE'), '';
INSERT INTO _v SELECT '8b authenticated cannot INSERT/UPDATE/DELETE credit_ledger',
  NOT has_table_privilege('authenticated', 'public.credit_ledger', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.credit_ledger', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.credit_ledger', 'DELETE'), '';
INSERT INTO _v SELECT '8c subscriptions has no user insert/update/delete policy',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND cmd IN ('INSERT','UPDATE','DELETE')), '';
INSERT INTO _v SELECT '8d authenticated cannot read platform_admins',
  NOT has_table_privilege('authenticated', 'public.platform_admins', 'SELECT'), '';

-- 9. migration ledger
INSERT INTO _v SELECT '9 schema_migrations records credits_migration.sql + seq',
  EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = 'credits_migration.sql')
  AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = 'credits_ledger_seq_migration.sql'), '';
-- 9b. ledger rows are strictly ordered by seq (gaps are fine — a rejected
--     insert still consumes an identity value; order and uniqueness are what matter)
INSERT INTO _v SELECT '9b credit_ledger.seq orders rows by insertion (first=grant, last=purchase, all distinct)',
  (SELECT count(*) = count(DISTINCT seq) FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c0de')
  AND (SELECT kind FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c0de' ORDER BY seq ASC LIMIT 1) = 'grant'
  AND (SELECT kind FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c0de' ORDER BY seq DESC LIMIT 1) = 'purchase', '';

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
	console.error('no assertion rows returned — the transaction may have aborted early. Raw:', JSON.stringify(res.data).slice(0, 500));
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
