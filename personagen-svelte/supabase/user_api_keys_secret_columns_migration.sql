-- ═══════════════════════════════════════════════════════════════════════════
-- BYOK secret tables, stage B: `authenticated` reads metadata, never ciphertext.
--
-- user_api_keys_column_grants_migration.sql (stage A, live since 2026-09-15)
-- took TRUNCATE and everything else away from anon/authenticated on the two
-- tables that store AES-256-GCM ciphertext of users' provider API keys, and
-- left SELECT table-wide on purpose: the server still decrypted through
-- `locals.supabase` — anon key + the user's JWT, i.e. the SAME `authenticated`
-- role as the browser — and Postgres cannot tell those two readers apart.
-- Revoking the secret columns then would have broken every BYOK generation,
-- and broken it silently: every resolver does `.catch(() => null)` and falls
-- back to the platform's own key.
--
-- THE PREREQUISITE IS NOW MET (this repository, same change set):
--
--   1. Every read of (encrypted_value, iv, auth_tag) goes through the
--      service-role client, scoped by user_id, whatever client the caller
--      passed in — src/lib/server/user-api-keys.ts readStoredSecret(), which
--      getUserApiKey() and zernio-keys.ts getZernioKeySecretById() are now
--      thin wrappers over. The Zernio "test" route reads through the same
--      wrapper. No code path selects a secret column as `authenticated`;
--      no query on either table uses `select('*')`
--      (src/lib/server/user-api-keys-service-read.spec.ts scans for both).
--
--   2. A decrypt failure is no longer invisible. Before rethrowing,
--      readStoredSecret() stamps the row status='error' with a short,
--      secret-free last_error, and Settings → API keys renders both. The
--      resolvers' fallback to the platform key is unchanged and deliberate
--      (billing already attributes such a run to the platform rate); what
--      changed is that the user can now see WHY their key stopped being used.
--
-- WHAT THIS MIGRATION DOES
--
--   `authenticated` loses the table-wide SELECT on both tables and is
--   re-granted SELECT on exactly the NON-secret columns — every column of each
--   table definition in client_bootstrap.sql ( neither table has a later ADD COLUMN)
--   except encrypted_value, iv and auth_tag. A signed-in user can still list,
--   save, test and delete their own keys (metadata SELECT + the INSERT/UPDATE/
--   DELETE stage A left in place; RLS unchanged) but can no longer read their
--   own ciphertext — so a leaked session, an XSS, or a curious user with the
--   anon key can no longer exfiltrate ciphertext to pair with a later key leak.
--   service_role keeps everything; it is the reader now.
--
-- MECHANICS (why this is not a three-column REVOKE)
--   A table-level GRANT SELECT covers every column, and a column-level REVOKE
--   cannot carve a hole in it. The only way to express "these columns and not
--   those" is to drop the table-level grant and re-issue SELECT per column,
--   which is what the four statements below do. REVOKE on the table also
--   revokes any column-level SELECT already there, so re-running this file
--   ends in the same state — idempotent. PostgREST serves any request whose
--   select-list is inside the grant and answers 42501 to the rest; every query
--   the app makes against these two tables names its columns explicitly.
--   An upsert's RETURNING list and an UPDATE's WHERE (user_id, provider / id)
--   only touch granted columns; ON CONFLICT DO UPDATE reads EXCLUDED, not the
--   table, so INSERT/UPDATE privilege alone still carries the save path.
--
-- Rollback (if a BYOK path 42501s after apply — it should not):
--   GRANT SELECT ON TABLE public.user_api_keys TO authenticated;
--   GRANT SELECT ON TABLE public.zernio_keys   TO authenticated;
--   NOTIFY pgrst, 'reload schema';
--
-- Idempotent: REVOKE and GRANT are declarative — re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Stage B. authenticated reads metadata columns only ──────────────────────

REVOKE SELECT ON TABLE public.user_api_keys FROM authenticated;
GRANT SELECT (id, user_id, provider, masked_value, last_four, status, last_error, last_tested_at, created_at, updated_at) ON TABLE public.user_api_keys TO authenticated;

REVOKE SELECT ON TABLE public.zernio_keys FROM authenticated;
GRANT SELECT (id, user_id, label, masked_value, last_four, status, last_error, last_tested_at, created_at, updated_at) ON TABLE public.zernio_keys TO authenticated;

-- service_role is the reader now (readStoredSecret) and must keep full access.
-- Re-asserted here so this file is complete on its own.
GRANT ALL ON TABLE public.user_api_keys TO service_role;
GRANT ALL ON TABLE public.zernio_keys   TO service_role;

-- PostgREST caches privileges with the schema; without this the REST layer can
-- keep serving a column it no longer has rights to until the service restarts.
NOTIFY pgrst, 'reload schema';
