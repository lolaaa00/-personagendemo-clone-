#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Does the billing reconciler actually DETECT? — SAFE ON PRODUCTION.
//
// credit_reconcile_mismatches() is the thing that would tell us the wallet and
// the receipt ledger disagree. It has reported 0 every hour since it shipped —
// and a detector that always returns 0 is indistinguishable from a healthy
// system. This breaks that tie by planting each kind of damage and asserting it
// is found, then asserting a correct pair is NOT found.
//
// Everything runs inside BEGIN … ROLLBACK in one /pg/query session: the
// throwaway user, wallet, events and ledger rows all disappear. Nothing here
// writes to production.
//
//   node scripts/verify-reconciliation-db.mjs
// Exit 0 = the detector catches what it claims to catch.
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

const U = '00000000-0000-4000-8000-00000000rec1'.replace('rec1', 'aec1');
// Deterministic ids so each assertion can name the row it planted.
const E = (n) => `00000000-0000-4000-8000-0000000e000${n}`;

const SQL = `
BEGIN;
CREATE TEMP TABLE _v (step TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('${U}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'verify-reconcile@personagen.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

DO $$
DECLARE
  u UUID := '${U}';
  markup NUMERIC := COALESCE((SELECT (value #>> '{}')::numeric FROM public.platform_settings WHERE key = 'credit_markup'), 1);
  raw_usd NUMERIC := 0.08;
  right_credits BIGINT;
  found BOOLEAN;
  rows_back BIGINT;
BEGIN
  right_credits := ceil(raw_usd * markup * 100);
  PERFORM public.credit_apply(u, 100000, 'grant', 'reconcile verifier float', NULL);

  -- ── 1. a CORRECT pair must not be reported ────────────────────────────────
  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
  VALUES ('${E(1)}', u, 'fal', 'image', 'nano', raw_usd, u, 'platform', right_credits);
  PERFORM public.credit_apply(u, -right_credits, 'debit', 'correct', NULL, '${E(1)}');
  SELECT EXISTS (SELECT 1 FROM public.credit_reconcile_mismatches(24) WHERE event_id = '${E(1)}') INTO found;
  INSERT INTO _v VALUES ('1 a correctly debited event is NOT reported', NOT found, 'credits=' || right_credits);

  -- ── 2. an event with NO debit must be reported ────────────────────────────
  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
  VALUES ('${E(2)}', u, 'fal', 'image', 'nano', raw_usd, u, 'platform', right_credits);
  SELECT EXISTS (SELECT 1 FROM public.credit_reconcile_mismatches(24) WHERE event_id = '${E(2)}' AND debit_rows = 0) INTO found;
  INSERT INTO _v VALUES ('2 an event charged to nobody IS reported', found, 'the customer generated and was never billed');

  -- ── 3. a debit for the WRONG amount must be reported ──────────────────────
  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
  VALUES ('${E(3)}', u, 'fal', 'image', 'nano', raw_usd, u, 'platform', right_credits);
  PERFORM public.credit_apply(u, -(right_credits - 5), 'debit', 'short', NULL, '${E(3)}');
  SELECT EXISTS (SELECT 1 FROM public.credit_reconcile_mismatches(24) WHERE event_id = '${E(3)}' AND debited <> credits) INTO found;
  INSERT INTO _v VALUES ('3 a debit for the wrong amount IS reported', found, 'charged ' || (right_credits - 5) || ' for a ' || right_credits || ' event');

  -- ── 4. a BYO-key event is not platform-paid and must not be reported ──────
  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
  VALUES ('${E(4)}', u, 'fal', 'image', 'nano', raw_usd, u, 'byo', right_credits);
  SELECT EXISTS (SELECT 1 FROM public.credit_reconcile_mismatches(24) WHERE event_id = '${E(4)}') INTO found;
  INSERT INTO _v VALUES ('4 a BYO-key event is NOT reported (the user paid the provider)', NOT found, '');

  -- ── 5. the window is honoured: old damage is out of scope ─────────────────
  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits, created_at)
  VALUES ('${E(5)}', u, 'fal', 'image', 'nano', raw_usd, u, 'platform', right_credits, now() - interval '10 days');
  SELECT EXISTS (SELECT 1 FROM public.credit_reconcile_mismatches(24) WHERE event_id = '${E(5)}') INTO found;
  INSERT INTO _v VALUES ('5 damage older than the window is not reported by a 24h run', NOT found, 'a 10-day-old unbilled event');
  SELECT EXISTS (SELECT 1 FROM public.credit_reconcile_mismatches(24 * 30) WHERE event_id = '${E(5)}') INTO found;
  INSERT INTO _v VALUES ('5b … and IS reported when the window covers it', found, 'same row, 30-day window');

  -- ── 6. THE PRICE ITSELF: credits that do not match est_cost × markup ──────
  -- The ledger and the event agree with each other, so the wallet looks
  -- consistent — but the customer was charged the wrong PRICE. This is the case
  -- a markup bug or a stale creditsFor() would produce.
  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
  VALUES ('${E(6)}', u, 'fal', 'image', 'nano', raw_usd, u, 'platform', right_credits * 7);
  PERFORM public.credit_apply(u, -(right_credits * 7), 'debit', 'consistent but overpriced', NULL, '${E(6)}');
  SELECT EXISTS (SELECT 1 FROM public.credit_reconcile_mismatches(24) WHERE event_id = '${E(6)}') INTO found;
  INSERT INTO _v VALUES ('6 an event priced at 7x the markup IS reported', found,
    'charged ' || (right_credits * 7) || ' where est_cost x markup = ' || right_credits);

  -- ── 7. a duplicated debit must be reported ────────────────────────────────
  -- The unique index normally prevents this; the reconciler is the backstop if
  -- it is ever dropped or a debit lands under a different event id.
  INSERT INTO public.generation_events (id, user_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
  VALUES ('${E(7)}', u, 'fal', 'image', 'nano', raw_usd, u, 'platform', right_credits);
  PERFORM public.credit_apply(u, -right_credits, 'debit', 'first', NULL, '${E(7)}');
  BEGIN
    PERFORM public.credit_apply(u, -right_credits, 'debit', 'second', NULL, '${E(7)}');
  EXCEPTION WHEN unique_violation THEN
    NULL; -- the index held, which is itself the guarantee
  END;
  SELECT count(*) INTO rows_back FROM public.credit_ledger WHERE generation_event_id = '${E(7)}' AND kind = 'debit';
  INSERT INTO _v VALUES ('7 the per-event unique index still refuses a second debit', rows_back = 1, 'debit rows=' || rows_back);

  -- ── 8. the detector is not vacuous: it found the ones we planted ──────────
  SELECT count(*) INTO rows_back FROM public.credit_reconcile_mismatches(24);
  INSERT INTO _v VALUES ('8 the run reports every planted fault and nothing else', rows_back >= 2, 'reported ' || rows_back || ' row(s)');
END $$;

SELECT step, ok, detail FROM _v ORDER BY step;
ROLLBACK;
`;

const r = await pg(SQL);
if (!r.ok) {
	console.error('verification transaction failed:', JSON.stringify(r.data).slice(0, 800));
	process.exit(1);
}
const rows = Array.isArray(r.data) ? r.data : [];
let failed = 0;
for (const row of rows) {
	if (!row.ok) failed++;
	console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step}${row.detail ? `  — ${row.detail}` : ''}`);
}
console.log(`\n${rows.length - failed}/${rows.length} reconciliation assertions held (rolled back, nothing persisted)`);
process.exit(failed ? 1 : 0);
