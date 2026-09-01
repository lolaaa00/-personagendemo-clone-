-- ═══════════════════════════════════════════════════════════════════════════
-- Model Registry: multi-provider support.
--
-- The registry only ever synced fal's catalog, so every OpenRouter route was a
-- hardcoded env-overridable constant priced from the static matrix in
-- src/lib/pricing.ts. That is exactly how the OpenRouter image route drifted
-- ~3.9x without anyone noticing: the code moved to Nano Banana 2
-- (google/gemini-3.1-flash-image) after flux-schnell started 404ing, but the
-- price table still billed the old model at the old rate.
--
-- Adding `provider` lets the registry hold BOTH catalogs, so an OpenRouter
-- route is discovered, priced from OpenRouter's own live /api/v1/models
-- response, and resolved the same way a fal route already is — no second
-- source of truth to fall out of sync.
--
-- Existing rows are all fal (that was the only sync), so the backfill is
-- unconditional and safe to replay.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.model_registry
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'fal';

-- Widen only if the constraint isn't already the multi-provider one.
ALTER TABLE public.model_registry DROP CONSTRAINT IF EXISTS model_registry_provider_check;
ALTER TABLE public.model_registry ADD CONSTRAINT model_registry_provider_check
  CHECK (provider IN ('fal', 'openrouter'));

-- Everything that existed before this migration came from syncFromFal().
UPDATE public.model_registry SET provider = 'fal' WHERE provider IS NULL;

CREATE INDEX IF NOT EXISTS idx_model_registry_user_provider
  ON public.model_registry(user_id, provider);

COMMENT ON COLUMN public.model_registry.provider IS
  'Which API serves this model — decides the call adapter and the sync that maintains it.';

-- Per-call price is a DERIVED number for token-billed providers (OpenRouter
-- bills image output per token; a per-call figure needs a tokens-per-image
-- assumption). Keeping the raw upstream rate makes that derivation auditable
-- instead of a magic number, and lets a re-sync recompute without guessing.
ALTER TABLE public.model_registry
  ADD COLUMN IF NOT EXISTS price_basis TEXT;

COMMENT ON COLUMN public.model_registry.price_basis IS
  'How price_usd was derived (e.g. "$60/M output tokens x 1290 tokens/image"). Audit trail for token-billed providers.';
