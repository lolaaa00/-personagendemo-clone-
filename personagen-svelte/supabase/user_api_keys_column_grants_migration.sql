-- ═══════════════════════════════════════════════════════════════════════════
-- BYOK secret tables: GRANT hygiene, and the column split that is NOT yet safe.
--
-- Two tables store AES-256-GCM ciphertext of a user's provider API keys:
--   public.user_api_keys   (provider, encrypted_value, iv, auth_tag, …)
--   public.zernio_keys     (label,    encrypted_value, iv, auth_tag, …)
-- Both have RLS with `auth.uid() = user_id` on all four verbs. Neither has ever
-- had a single REVOKE. Measured on the live database 2026-09-15:
--
--   anon           SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   authenticated  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
-- on ALL 13 columns of BOTH tables. That is the default `GRANT ALL TO anon,
-- authenticated` Supabase hands every new public table, never narrowed.
--
-- WHAT THIS MIGRATION FIXES (stage A, below — live SQL)
--
--   1. anon loses everything. RLS already returns zero rows to anon
--      (auth.uid() is NULL, so `auth.uid() = user_id` is never true), so this
--      costs the app nothing — but TRUNCATE is NOT governed by RLS AT ALL.
--      A role holding TRUNCATE can empty the table regardless of any policy.
--      Today both anon and authenticated hold it on the two tables that store
--      every user's provider credentials: one statement would delete every
--      stored key on the platform, and RLS would not say a word.
--      This is the same reasoning, and the same fix, as the money tables in
--      credit_roles_policies_migration.sql ("RLS denied the DML, but TRUNCATE
--      is not governed by RLS at all").
--
--   2. authenticated keeps EXACTLY the four verbs the app uses — SELECT,
--      INSERT, UPDATE, DELETE — and loses TRUNCATE, REFERENCES and TRIGGER,
--      none of which any code path issues.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO (stage B — commented out)
--
--   The obvious next step is to revoke SELECT on the three secret columns
--   (encrypted_value, iv, auth_tag) from `authenticated`, so that a signed-in
--   user can read their own row's metadata but not their own ciphertext. The
--   ciphertext is useless without USER_SECRETS_ENCRYPTION_KEY (server-only), so
--   that is blast radius rather than a live breach: ciphertext exfiltrated today
--   plus a key leak later equals plaintext.
--
--   It is NOT safe to apply yet, and applying it today would be worse than the
--   hole it closes. `locals.supabase` is built from PUBLIC_SUPABASE_ANON_KEY
--   plus the user's JWT (src/lib/server/supabase.ts:7-22), so it connects AS
--   the `authenticated` role — and the SERVER decrypts BYOK keys through that
--   same client, not through the service role:
--
--     src/lib/server/user-api-keys.ts:100   .select('encrypted_value, iv, auth_tag')
--     src/lib/server/zernio-keys.ts:35      .select('encrypted_value, iv, auth_tag')
--     src/routes/api/settings/zernio-keys/+server.ts:124
--
--   Postgres cannot tell "the browser reading its own ciphertext" from "the
--   server reading it on that user's behalf" — it is one role, one grant.
--   Revoking the column would therefore break every BYOK generation, and break
--   it SILENTLY: the call sites swallow the failure and fall back to the
--   platform's own key —
--
--     src/lib/server/content/generate.ts:364,368   .catch(() => null)
--     src/lib/server/ai-client.ts:163,169          .catch(() => null)
--
--   so every "bring your own key" user would quietly start spending the
--   platform's money instead of their own, with nothing in the logs.
--
--   PREREQUISITE for stage B: move those three reads onto the service-role
--   client (createSupabaseServiceClient / getServiceSupabase), which bypasses
--   RLS and is unaffected by these grants, and make the decrypt failure loud
--   instead of `.catch(() => null)`. Then uncomment stage B into a NEW
--   migration file. Procedure: docs/runbooks/rotate-user-secrets.md.
--
-- NOTE ON MECHANICS (the subtle part, for whoever applies stage B)
--   A table-level `GRANT SELECT` confers SELECT on every column, including ones
--   added later, and a column-level REVOKE cannot carve a hole in it. The only
--   way to express "these columns and not those" is to drop the table-level
--   grant entirely and re-issue SELECT per allowed column — which is why stage
--   B lists all ten survivors explicitly rather than revoking three.
--   PostgREST then serves any request whose select-list is inside the grant and
--   fails the rest with 42501; every query the app makes against these two
--   tables already names its columns explicitly (there is no `select('*')`
--   anywhere), so the settings pages keep working untouched.
--
-- Idempotent: REVOKE and GRANT are declarative — re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Stage A. anon loses everything; authenticated keeps only what it uses ───

REVOKE ALL ON TABLE public.user_api_keys FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.zernio_keys   FROM anon, PUBLIC;

-- Re-issued from zero so TRUNCATE / REFERENCES / TRIGGER cannot survive.
-- SELECT stays table-wide here on purpose: the server still decrypts through
-- this role. Narrowing it is stage B, and has a code prerequisite.
REVOKE ALL ON TABLE public.user_api_keys FROM authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_api_keys TO authenticated;

REVOKE ALL ON TABLE public.zernio_keys   FROM authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON TABLE public.zernio_keys   TO authenticated;

-- service_role is the server's own identity (bypasses RLS) and must keep full
-- access — it is what stage B moves the decrypt reads onto.
GRANT ALL ON TABLE public.user_api_keys TO service_role;
GRANT ALL ON TABLE public.zernio_keys   TO service_role;

-- PostgREST caches privileges with the schema; without this the REST layer can
-- keep serving a column it no longer has rights to until the service restarts.
NOTIFY pgrst, 'reload schema';


-- ── Stage B. NOT ACTIVE — see the header. Do not uncomment in place; copy ───
-- ── into a new migration once the three decrypt reads use service_role.   ───
--
-- BEGIN STAGE B
-- REVOKE SELECT ON TABLE public.user_api_keys FROM authenticated;
-- GRANT SELECT (id, user_id, provider, masked_value, last_four, status, last_error, last_tested_at, created_at, updated_at) ON TABLE public.user_api_keys TO authenticated;
-- REVOKE SELECT ON TABLE public.zernio_keys FROM authenticated;
-- GRANT SELECT (id, user_id, label, masked_value, last_four, status, last_error, last_tested_at, created_at, updated_at) ON TABLE public.zernio_keys TO authenticated;
-- NOTIFY pgrst, 'reload schema';
-- END STAGE B
