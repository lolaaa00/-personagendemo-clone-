-- ============================================================
-- agents.market — retire it as the persona profile's home (Persona Model v2, P0.6)
--
-- `agents.market` was declared `TEXT DEFAULT 'Australia'` (a market/country
-- string) and then, for a long stretch, carried the ENTIRE persona profile as a
-- JSON string. personas_profile_migration.sql (2026-08) gave the profile a real
-- JSONB column and backfilled it; the app kept dual-writing `market` only as a
-- never-brick fallback for a database that had not run that migration.
--
-- That fallback is obsolete: the migration ledger (000_schema_migrations.sql,
-- scripts/apply-migration.mjs, migrations-coverage.spec.ts, deploy.ps1's step 0)
-- now guarantees every deployment carries the JSONB column before code that
-- needs it can ship. As of the app commit that lands with this file, nothing
-- writes profile JSON to `market` any more (Persona Model v2 P0.6), and
-- readPersonaProfile() only parses `market` when it still happens to start with
-- '{' — a harmless, temporary read path for rows this migration does not touch.
--
-- This migration RESTORES `market` to its declared meaning for every row whose
-- profile already lives in personas_profile. It is ADDITIVE and NON-DESTRUCTIVE:
--   * rows whose personas_profile is NULL are left exactly as they are, JSON and
--     all — the read fallback still serves them until their next save writes the
--     JSONB column (the app has done that since 2026-08);
--   * rows already holding a plain market string are untouched;
--   * the value written is the column default, which is what every persona was
--     created with before the JSON took over. Persona Model v2 P1 will carry a
--     per-persona market token (creator.market) in the profile itself.
--
-- Idempotent: re-running matches nothing on the second pass.
-- ============================================================

DO $$
DECLARE
  restored INTEGER := 0;
BEGIN
  UPDATE public.agents
     SET market = 'Australia'
   WHERE market LIKE '{%'
     AND personas_profile IS NOT NULL;
  GET DIAGNOSTICS restored = ROW_COUNT;
  RAISE NOTICE 'agents.market restore: % row(s) returned to a market string', restored;
END $$;

COMMENT ON COLUMN public.agents.market IS
  'Market / country the persona operates in (default ''Australia''). The persona profile lives in personas_profile (JSONB); this column has NOT held profile JSON since market_restore_migration.sql (2026-09-08).';
