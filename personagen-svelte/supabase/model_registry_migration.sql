-- ============================================================
-- Model Registry — the Model Manager's backing table
--
-- One row per generation model per user. Two populations:
--   wired=true   — models with a code adapter (seeded from MODEL_CATALOG);
--                  these can be enabled/disabled, priced, scored, and set
--                  as the per-kind default. The generate endpoints resolve
--                  against ACTIVE wired rows.
--   wired=false  — models discovered from the fal catalog sync; visible in
--                  the manager (date, price, lab, schema probe) but staged:
--                  they cannot generate until an adapter ships (Phase 2).
--
-- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS) for direct replay and
-- for concatenation by build-bootstrap.mjs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image_t2i', 'image_edit', 'video_i2v', 'tts')),
  label TEXT NOT NULL,
  lab TEXT,
  released_at DATE,
  -- Per-call USD estimate shown and summed everywhere; provenance tracked so
  -- a manual price is never silently overwritten by a re-parse.
  price_usd NUMERIC(10, 4),
  pricing_text TEXT,
  price_source TEXT DEFAULT 'seed' CHECK (price_source IN ('seed', 'parsed', 'manual')),
  -- Editable quality score (1-10) — powers the value-per-dollar ranking.
  quality INT CHECK (quality BETWEEN 1 AND 10),
  tier TEXT CHECK (tier IN ('budget', 'balanced', 'premium')),
  -- Typical seconds per generation (estimate, editable).
  latency_s INT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('active', 'disabled', 'available', 'quarantined')),
  wired BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  deprecated BOOLEAN NOT NULL DEFAULT false,
  -- Schema facts (from models.ts for wired rows, from the OpenAPI probe for
  -- discovered rows).
  multi_ref BOOLEAN,
  supports_audio BOOLEAN,
  supports_duration BOOLEAN,
  size_param TEXT,
  probe JSONB,
  note TEXT,
  discovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_registry_user_id ON public.model_registry(user_id);
CREATE INDEX IF NOT EXISTS idx_model_registry_user_kind ON public.model_registry(user_id, kind);

ALTER TABLE public.model_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "model_registry_select_own" ON public.model_registry;
CREATE POLICY "model_registry_select_own" ON public.model_registry
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "model_registry_insert_own" ON public.model_registry;
CREATE POLICY "model_registry_insert_own" ON public.model_registry
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "model_registry_update_own" ON public.model_registry;
CREATE POLICY "model_registry_update_own" ON public.model_registry
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "model_registry_delete_own" ON public.model_registry;
CREATE POLICY "model_registry_delete_own" ON public.model_registry
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS model_registry_updated_at ON public.model_registry;
CREATE TRIGGER model_registry_updated_at
  BEFORE UPDATE ON public.model_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
