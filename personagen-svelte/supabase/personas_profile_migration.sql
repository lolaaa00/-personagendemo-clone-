-- ============================================================
-- agents.personas_profile — give the persona profile a real JSONB home
--
-- `agents.market` is declared `TEXT DEFAULT 'Australia'` (a country string) but
-- has been storing the ENTIRE persona profile as a JSON string: archetype,
-- contentFocus, targetAvatar, psychProfile, contentAngle, appearance{},
-- voiceProfile{}, ageRanges[], bios{}, handleCandidates[], confirmedHandles{},
-- displayName. No schema, no constraints, and every reader hand-rolls
-- `market.startsWith('{')` + JSON.parse.
--
-- This migration is ADDITIVE ONLY. It adds the JSONB column and backfills it.
-- It deliberately does NOT drop, rename, retype or clear `market`:
--   * not-yet-migrated read sites in the engine/generator still parse it, and
--   * the external `services/mcp-bridge` touches this table independently.
-- The app dual-writes both columns and reads personas_profile FIRST (see
-- src/lib/persona-profile-store.ts). `market` gets retired in a later,
-- separate migration once every reader is on the accessor.
--
-- Written idempotent (IF NOT EXISTS + a NULL-guarded backfill) so it can be
-- replayed directly AND concatenated by build-bootstrap.mjs.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. The column
-- ─────────────────────────────────────────────
-- Nullable with no default on purpose: NULL means "never migrated / never
-- saved", which is exactly the condition the backfill and the app-side
-- fallback to `market` both key off. A '{}' default would erase that signal.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS personas_profile JSONB;

-- ─────────────────────────────────────────────
-- 2. Backfill from the legacy market blob
-- ─────────────────────────────────────────────
-- Only rows where `market` actually looks like a JSON object are touched:
-- personas that still hold a genuine country string ('Australia') keep
-- personas_profile NULL, which is correct — they have no profile.
--
-- Done row-by-row inside an exception block rather than as one set-based
-- UPDATE ... market::jsonb, because a single malformed blob (truncated LLM
-- output, a stray '{' string) would abort the whole statement and fail the
-- migration. A row that can't be cast is simply left NULL; the app's
-- readPersonaProfile() fallback returns {} for it either way, so skipping is
-- lossless rather than destructive.
--
-- Re-runnable: the WHERE clause only matches rows that are still NULL, so a
-- second run is a no-op and can never clobber a profile saved since the first.
DO $$
DECLARE
  r RECORD;
  migrated INTEGER := 0;
  skipped  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, market
      FROM public.agents
     WHERE personas_profile IS NULL
       AND market LIKE '{%'
  LOOP
    BEGIN
      UPDATE public.agents
         SET personas_profile = r.market::jsonb
       WHERE id = r.id;
      migrated := migrated + 1;
    EXCEPTION WHEN others THEN
      -- Not valid JSON. Leave personas_profile NULL and let the app fall back.
      skipped := skipped + 1;
      RAISE NOTICE 'agents.market is not valid JSON for agent %, left unmigrated', r.id;
    END;
  END LOOP;
  RAISE NOTICE 'personas_profile backfill: % migrated, % skipped', migrated, skipped;
END $$;

-- ─────────────────────────────────────────────
-- 3. Indexes — intentionally none
-- ─────────────────────────────────────────────
-- No GIN index is created here. Every current read of the profile is by agent
-- id (or by the user's agent list), already served by the primary key and
-- idx_agents_user_id — a GIN index would be pure write overhead on the save
-- path with no reader. When persona search by trait ships ("all personas with
-- hair colour X", "archetype = The Educator"), add it then and size it to the
-- query shape:
--
--   CREATE INDEX IF NOT EXISTS idx_agents_personas_profile
--     ON public.agents USING GIN (personas_profile jsonb_path_ops);
--
-- (jsonb_path_ops, not the default jsonb_ops: containment `@>` is the only
-- operator such a search needs, and it builds a materially smaller index.)

-- ─────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────
-- Nothing to do: this is a new column on an existing table, and the agents
-- policies are row-scoped by user_id, so it inherits them unchanged.
