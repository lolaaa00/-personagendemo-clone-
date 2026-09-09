#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Role-by-role verification of the credit policies — SAFE ON PRODUCTION.
//
// One transaction, rolled back at the end. Creates an owner, an admin seat, a
// creator seat and an outsider, a workspace with a persona, wallets for all,
// then runs each assertion AS THAT ROLE (SET LOCAL ROLE + JWT claims), exactly
// the way PostgREST would. Proves what unit tests cannot:
//
//   anon           cannot read any money table
//   creator seat   sees only its own wallet row and ledger
//                  sees the owner's balance through workspace_wallets()
//                  cannot update a wallet, delete an event, call credit_apply,
//                  or bill a stranger on a generation_events insert
//                  may bill the workspace owner (owner pays)
//   admin seat     sees the workspace's generation events
//   outsider       sees nothing of the workspace, workspace_wallets() is empty
//   platform admin is_platform_admin() answers only about the caller
//   owner          sees events billed to it even when not the actor
//
//   node scripts/verify-roles-db.mjs
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

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const ADMIN = '00000000-0000-4000-8000-0000000000a2';
const CREATOR = '00000000-0000-4000-8000-0000000000a3';
const OUTSIDER = '00000000-0000-4000-8000-0000000000a4';
const WS = '00000000-0000-4000-8000-0000000000b1';
const AGENT = '00000000-0000-4000-8000-0000000000c1';

const user = (id, email) =>
	`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
	 VALUES ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);`;

/** Run `body` as an app role with a JWT for `uid`, record ok/detail, restore the session role. */
const asRole = (step, role, uid, body, expectError = null) => `
DO $$
DECLARE ok BOOLEAN := false; detail TEXT := '';
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', ${uid ? `'{"sub":"${uid}","role":"${role}"}'` : `'{"role":"${role}"}'`}, true);
    PERFORM set_config('request.jwt.claim.sub', ${uid ? `'${uid}'` : `''`}, true);
    PERFORM set_config('request.jwt.claim.role', '${role}', true);
    SET LOCAL ROLE ${role};
    ${body}
    RESET ROLE;
    ${expectError ? `ok := false; detail := 'expected ${expectError} but succeeded';` : ''}
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    ${expectError ? `ok := (SQLSTATE = '${expectError}'); detail := SQLSTATE || ' ' || left(SQLERRM, 90);` : `ok := false; detail := SQLSTATE || ' ' || left(SQLERRM, 120);`}
  END;
  INSERT INTO _v VALUES ('${step.replace(/'/g, "''")}', ok, detail);
END $$;`;

// bodies that must SUCCEED set ok := true themselves
const SQL = `
BEGIN;
CREATE TEMP TABLE _v (step TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;
${user(OWNER, 'verify-owner@personagen.test')}
${user(ADMIN, 'verify-admin@personagen.test')}
${user(CREATOR, 'verify-creator@personagen.test')}
${user(OUTSIDER, 'verify-outsider@personagen.test')}
INSERT INTO public.workspaces (id, owner_id, name) VALUES ('${WS}', '${OWNER}', 'Verify WS');
INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by) VALUES ('${WS}', '${ADMIN}', 'admin', '${OWNER}'), ('${WS}', '${CREATOR}', 'creator', '${OWNER}');
INSERT INTO public.agents (id, user_id, workspace_id, name, handle, niche, status, soul, gradient, initial) VALUES ('${AGENT}', '${OWNER}', '${WS}', 'Verify Persona', '@verify', 'test', 'active', 'x', 'g', 'V');
SELECT public.credit_apply('${OWNER}', 5000, 'grant', 'verify owner', NULL);
SELECT public.credit_apply('${CREATOR}', 100, 'grant', 'verify creator', NULL);
INSERT INTO public.platform_admins (user_id) VALUES ('${ADMIN}');
-- an event the creator made against the workspace persona, billed to the owner (service insert, as the app does)
INSERT INTO public.generation_events (id, user_id, agent_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
VALUES ('00000000-0000-4000-8000-0000000000e1', '${CREATOR}', '${AGENT}', 'fal', 'image', 'nano', 0.08, '${OWNER}', 'platform', 24);

${asRole('anon cannot read credit_accounts', 'anon', null, `PERFORM 1 FROM public.credit_accounts LIMIT 1;`, '42501')}
${asRole('anon cannot read credit_ledger', 'anon', null, `PERFORM 1 FROM public.credit_ledger LIMIT 1;`, '42501')}
${asRole('anon cannot read generation_events', 'anon', null, `PERFORM 1 FROM public.generation_events LIMIT 1;`, '42501')}
${asRole('anon cannot call is_platform_admin', 'anon', null, `PERFORM public.is_platform_admin('${ADMIN}');`, '42501')}

${asRole('creator sees only its own wallet row', 'authenticated', CREATOR, `
    IF (SELECT count(*) FROM public.credit_accounts) = 1 AND (SELECT user_id FROM public.credit_accounts LIMIT 1) = '${CREATOR}' THEN ok := true; ELSE detail := 'rows=' || (SELECT count(*) FROM public.credit_accounts); END IF;`)}
${asRole('creator sees only its own ledger', 'authenticated', CREATOR, `
    IF (SELECT count(*) FROM public.credit_ledger WHERE user_id <> '${CREATOR}') = 0 AND (SELECT count(*) FROM public.credit_ledger) >= 1 THEN ok := true; ELSE detail := 'foreign rows=' || (SELECT count(*) FROM public.credit_ledger WHERE user_id <> '${CREATOR}'); END IF;`)}
${asRole('creator reads the owner balance through workspace_wallets()', 'authenticated', CREATOR, `
    IF (SELECT balance_credits FROM public.workspace_wallets() WHERE workspace_id = '${WS}') = __OWNER_EXPECTED__ AND (SELECT role FROM public.workspace_wallets() WHERE workspace_id = '${WS}') = 'creator' THEN ok := true; ELSE detail := coalesce((SELECT balance_credits::text FROM public.workspace_wallets() WHERE workspace_id = '${WS}'), 'no row'); END IF;`)}
${asRole('creator cannot update a wallet (privilege revoked)', 'authenticated', CREATOR, `UPDATE public.credit_accounts SET balance_credits = 999999 WHERE user_id = '${CREATOR}';`, '42501')}
${asRole('creator cannot delete a generation event', 'authenticated', CREATOR, `DELETE FROM public.generation_events WHERE id = '00000000-0000-4000-8000-0000000000e1';`, '42501')}
${asRole('creator cannot truncate the ledger', 'authenticated', CREATOR, `TRUNCATE public.credit_ledger;`, '42501')}
${asRole('creator cannot call credit_apply', 'authenticated', CREATOR, `PERFORM public.credit_apply('${CREATOR}', 100000, 'grant', 'steal', NULL);`, '42501')}
${asRole('creator cannot call platform_setting_set', 'authenticated', CREATOR, `PERFORM public.platform_setting_set('credit_markup', '1'::jsonb, NULL, 'steal');`, '42501')}
${asRole('creator cannot update its subscription', 'authenticated', CREATOR, `UPDATE public.subscriptions SET plan = 'enterprise' WHERE user_id = '${CREATOR}';`, '42501')}
${asRole('creator cannot bill a stranger on an event insert', 'authenticated', CREATOR, `
    INSERT INTO public.generation_events (user_id, agent_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
    VALUES ('${CREATOR}', '${AGENT}', 'fal', 'image', 'nano', 0.08, '${OUTSIDER}', 'platform', 24);`, '42501')}
${asRole('creator may bill the workspace owner on an event insert (owner pays)', 'authenticated', CREATOR, `
    INSERT INTO public.generation_events (user_id, agent_id, provider, operation, model, est_cost, billed_user_id, key_source, credits)
    VALUES ('${CREATOR}', '${AGENT}', 'fal', 'image', 'nano', 0.08, '${OWNER}', 'platform', 24); ok := true;`)}
${asRole('creator asking is_platform_admin about someone else gets false', 'authenticated', CREATOR, `
    IF public.is_platform_admin('${ADMIN}') = false THEN ok := true; END IF;`)}
${asRole('admin seat asking about itself gets true', 'authenticated', ADMIN, `
    IF public.is_platform_admin('${ADMIN}') = true THEN ok := true; END IF;`)}
${asRole('admin seat sees the workspace generation events', 'authenticated', ADMIN, `
    IF (SELECT count(*) FROM public.generation_events WHERE agent_id = '${AGENT}') >= 1 THEN ok := true; END IF;`)}
${asRole('owner sees events billed to it though it was not the actor', 'authenticated', OWNER, `
    IF (SELECT count(*) FROM public.generation_events WHERE billed_user_id = '${OWNER}' AND user_id = '${CREATOR}') >= 1 THEN ok := true; END IF;`)}
${asRole('owner sees its own workspace wallet with role owner', 'authenticated', OWNER, `
    IF (SELECT role FROM public.workspace_wallets() WHERE workspace_id = '${WS}') = 'owner' THEN ok := true; END IF;`)}
${asRole('outsider sees no workspace wallet', 'authenticated', OUTSIDER, `
    IF (SELECT count(*) FROM public.workspace_wallets()) = 0 THEN ok := true; END IF;`)}
${asRole('outsider sees none of the workspace events', 'authenticated', OUTSIDER, `
    IF (SELECT count(*) FROM public.generation_events WHERE agent_id = '${AGENT}') = 0 THEN ok := true; END IF;`)}
${asRole('outsider cannot read the owner wallet', 'authenticated', OUTSIDER, `
    IF (SELECT count(*) FROM public.credit_accounts WHERE user_id = '${OWNER}') = 0 THEN ok := true; END IF;`)}

SELECT step, ok, detail FROM _v;
ROLLBACK;
`;

// Users inserted straight into auth.users are NOT funded: the welcome grant
// lives in /api/auth/signup, because GoTrue applies app_metadata after the row
// is inserted and no AFTER INSERT trigger can see it. So the owner's balance is
// exactly the 5 000 granted here.
const r = await pg(SQL.replace(/__OWNER_EXPECTED__/g, String(5000)));
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
console.log(`\n${rows.length - failed}/${rows.length} role assertions held (rolled back, nothing persisted)`);
process.exit(failed ? 1 : 0);
