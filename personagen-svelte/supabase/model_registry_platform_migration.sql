-- Model registry: one platform-owned catalog instead of a private copy per user.
--
-- Until now every account got its own seeded copy of the registry on first
-- visit (RLS: auth.uid() = user_id). Two consequences shipped as bugs: an
-- admin's price/default edits changed nothing for anyone else, and two
-- accounts seeded on different days disagreed about which models are wired.
--
-- A row with user_id IS NULL is PLATFORM-owned: everyone reads it, only a
-- platform admin writes it. Legacy per-user rows are left exactly as they are
-- and stay readable/writable by their owner, so nothing breaks while the new
-- build rolls out; application code prefers platform rows when any exist.
--
-- Uniqueness needs care: UNIQUE(user_id, model_id) does not constrain platform
-- rows at all, because NULLs are distinct in a unique index. owner_key is a
-- stored generated column that maps NULL to a fixed sentinel, so one plain
-- UNIQUE(owner_key, model_id) covers both scopes AND stays inferrable by
-- PostgREST's on_conflict (a partial index would not be).
--
-- Idempotent: safe to re-run.

-- 1. Platform rows have no owner.
ALTER TABLE public.model_registry ALTER COLUMN user_id DROP NOT NULL;

-- 2. One uniqueness rule for both scopes.
ALTER TABLE public.model_registry
  ADD COLUMN IF NOT EXISTS owner_key UUID
  GENERATED ALWAYS AS (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS model_registry_owner_model_key
  ON public.model_registry (owner_key, model_id);

CREATE INDEX IF NOT EXISTS model_registry_platform_kind_idx
  ON public.model_registry (kind) WHERE user_id IS NULL;

-- 3. RLS: platform rows are readable by every authenticated user and writable
--    only by a platform admin. Per-user rows keep exactly their old rules.
DROP POLICY IF EXISTS "model_registry_select_own" ON public.model_registry;
CREATE POLICY "model_registry_select_own" ON public.model_registry
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "model_registry_insert_own" ON public.model_registry;
CREATE POLICY "model_registry_insert_own" ON public.model_registry
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    OR (user_id IS NULL AND public.is_platform_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "model_registry_update_own" ON public.model_registry;
CREATE POLICY "model_registry_update_own" ON public.model_registry
  FOR UPDATE USING (
    auth.uid() = user_id
    OR (user_id IS NULL AND public.is_platform_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "model_registry_delete_own" ON public.model_registry;
CREATE POLICY "model_registry_delete_own" ON public.model_registry
  FOR DELETE USING (
    auth.uid() = user_id
    OR (user_id IS NULL AND public.is_platform_admin(auth.uid()))
  );

-- 4. Seed the platform catalog ONCE, from the richest existing copy (most rows,
--    then most wired), so the tuned prices, quality scores, defaults and probe
--    results an operator already entered survive. Does nothing on a fresh
--    install (no rows to copy) and nothing on re-run (platform rows exist).
INSERT INTO public.model_registry (
  user_id, provider, origin, model_id, kind, kinds, input_modalities, output_modalities,
  label, lab, released_at, price_usd, pricing_text, price_basis, price_source,
  quality, tier, latency_s, status, wired, is_default, deprecated,
  multi_ref, supports_audio, supports_duration, size_param, probe, note, discovered_at
)
SELECT
  NULL, r.provider, r.origin, r.model_id, r.kind, r.kinds, r.input_modalities, r.output_modalities,
  r.label, r.lab, r.released_at, r.price_usd, r.pricing_text, r.price_basis, r.price_source,
  r.quality, r.tier, r.latency_s, r.status, r.wired, r.is_default, r.deprecated,
  r.multi_ref, r.supports_audio, r.supports_duration, r.size_param, r.probe, r.note, r.discovered_at
FROM public.model_registry r
WHERE r.user_id = (
    SELECT user_id
      FROM public.model_registry
     WHERE user_id IS NOT NULL
     GROUP BY user_id
     ORDER BY COUNT(*) DESC, SUM(wired::int) DESC, user_id
     LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM public.model_registry p WHERE p.user_id IS NULL)
ON CONFLICT (owner_key, model_id) DO NOTHING;

-- 5. At most one default per kind in the platform catalog. Two defaults would
--    make effectiveResolve depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS model_registry_platform_one_default
  ON public.model_registry (kind) WHERE user_id IS NULL AND is_default;
