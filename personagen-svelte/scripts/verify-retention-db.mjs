#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Does usage evidence survive a bare user deletion, the way the money does?
//
// Plants a throwaway user with one generation event and one debit against it,
// deletes the user the way the admin API and the smoke's cleanup do, and asks
// what is left. Everything runs inside BEGIN … ROLLBACK in one /pg/query
// session, so nothing persists — same pattern as verify-reconciliation-db.mjs.
//
// Run it BEFORE applying generation_events_retain_on_delete_migration.sql and
// the retention checks FAIL: that is the defect, shown rather than described.
// Run it after and they pass. A verifier that only ever passes proves nothing.
//
//   node scripts/verify-retention-db.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

function loadEnv() {
	const out = { ...process.env };
	const p = join(appRoot, '.env');
	if (!existsSync(p)) return out;
	for (const line of readFileSync(p, 'utf8').split('\n')) {
		const m = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		if (!(m[1] in process.env)) out[m[1]] = v;
	}
	return out;
}
const env = loadEnv();
const URL_ = (env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
	console.error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
	process.exit(2);
}

async function pg(query) {
	const r = await fetch(`${URL_}/pg/query`, {
		method: 'POST',
		headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query })
	});
	const t = await r.text();
	let d;
	try { d = JSON.parse(t); } catch { d = t; }
	return { ok: r.ok, status: r.status, data: d };
}

// Fixed ids so a crashed run can never collide with real rows, and so the
// script is idempotent under ROLLBACK.
const U = '00000000-0000-4000-8000-0000000000e7';
const E = '00000000-0000-4000-8000-0000000000e8';

const SQL = `
BEGIN;
CREATE TEMP TABLE _v (step TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('${U}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'verify-retention@personagen.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

DO $$
DECLARE
  u UUID := '${U}';
  e UUID := '${E}';
  n_events INT; n_debits INT; ev_user UUID; ev_agent UUID; ev_cost NUMERIC;
  del_user TEXT; del_agent TEXT;
BEGIN
  PERFORM public.credit_apply(u, 1000, 'grant', 'retention verifier float', NULL);

  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
  VALUES (e, u, 'openrouter', 'llm', 'gemini-3.5-flash', 0.012, u, 'platform', 4);
  PERFORM public.credit_apply(u, -4, 'debit', 'retention verifier', NULL, e);

  -- ── 0. the plant actually happened (guards every later check against vacuity)
  SELECT count(*) INTO n_events FROM public.generation_events WHERE id = e;
  SELECT count(*) INTO n_debits FROM public.credit_ledger WHERE generation_event_id = e AND kind = 'debit';
  INSERT INTO _v VALUES ('0 one event and one debit were planted', n_events = 1 AND n_debits = 1, 'events=' || n_events || ' debits=' || n_debits);

  -- ── the deletion under test: a BARE user delete, as the admin API and the
  --    smoke's cleanup do it. Not /api/account/delete, which removes events
  --    explicitly and is unchanged by the migration.
  DELETE FROM auth.users WHERE id = u;

  -- ── 1a. CONTROL: the money survives today (credit_ledger.user_id is SET NULL).
  --     Found by its note, NOT by its event link — see 1b for why.
  SELECT count(*) INTO n_debits FROM public.credit_ledger WHERE note = 'retention verifier' AND kind = 'debit' AND user_id IS NULL;
  INSERT INTO _v VALUES ('1a the debit row survives the user, pseudonymised', n_debits = 1, 'orphan debit rows=' || n_debits);

  -- ── 1b. the debit still points at its event. credit_ledger.generation_event_id
  --     is ON DELETE SET NULL, so when the event cascades away the ledger's LINK
  --     is scrubbed too: the debit survives but can never be explained again.
  --     Production 2026-09-17: 199 orphan debits, 199 with the link scrubbed, 0 intact.
  SELECT count(*) INTO n_debits FROM public.credit_ledger WHERE note = 'retention verifier' AND kind = 'debit' AND generation_event_id = e;
  INSERT INTO _v VALUES ('1b the surviving debit still points at its event', n_debits = 1,
    CASE WHEN n_debits = 1 THEN 'link intact' ELSE 'LINK SCRUBBED — this debit is now unexplainable forever' END);

  -- ── 2. THE FIX: the usage row that explains that debit survives too
  SELECT count(*) INTO n_events FROM public.generation_events WHERE id = e;
  INSERT INTO _v VALUES ('2 the generation event survives the user deletion', n_events = 1,
    CASE WHEN n_events = 1 THEN 'retained' ELSE 'CASCADED AWAY — the debit is now unexplainable' END);

  -- ── 3. and it is pseudonymised, not dangling: user_id NULL, cost intact
  SELECT user_id, agent_id, est_cost INTO ev_user, ev_agent, ev_cost FROM public.generation_events WHERE id = e;
  INSERT INTO _v VALUES ('3 the retained event has user_id NULL and its cost intact',
    n_events = 1 AND ev_user IS NULL AND ev_cost = 0.012,
    'user_id=' || coalesce(ev_user::text,'NULL') || ' est_cost=' || coalesce(ev_cost::text,'NULL'));

  -- ── 4/5. the constraints say SET NULL, for both keys that used to cascade
  SELECT confdeltype INTO del_user  FROM pg_constraint WHERE conname = 'generation_events_user_id_fkey';
  SELECT confdeltype INTO del_agent FROM pg_constraint WHERE conname = 'generation_events_agent_id_fkey';
  INSERT INTO _v VALUES ('4 generation_events.user_id is ON DELETE SET NULL',  del_user  = 'n', 'confdeltype=' || coalesce(del_user,'?'));
  INSERT INTO _v VALUES ('5 generation_events.agent_id is ON DELETE SET NULL', del_agent = 'n', 'confdeltype=' || coalesce(del_agent,'?'));

  -- ── 6. a retained row is invisible to the user-scoped policy by construction
  INSERT INTO _v VALUES ('6 the RLS policy cannot match a NULL user_id',
    EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'generation_events' AND policyname = 'generation_events_select_own' AND qual LIKE '%uid() = user_id%'),
    'policy present and keyed on user_id');
END $$;

SELECT step, ok, detail FROM _v ORDER BY step;
ROLLBACK;
`;

const r = await pg(SQL);
if (!r.ok) {
	console.error('verification transaction failed:', JSON.stringify(r.data).slice(0, 800));
	process.exit(2);
}
const rows = Array.isArray(r.data) ? r.data : [];
if (rows.length === 0) {
	console.error('no assertion rows came back — the run proved nothing');
	process.exit(2);
}
let failed = 0;
for (const row of rows) {
	if (!row.ok) failed++;
	console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step}${row.detail ? `  — ${row.detail}` : ''}`);
}
console.log(`\n${rows.length - failed}/${rows.length} retention assertions held (rolled back, nothing persisted)`);
process.exit(failed ? 1 : 0);
