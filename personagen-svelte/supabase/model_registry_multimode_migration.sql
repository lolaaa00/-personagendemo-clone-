-- ═══════════════════════════════════════════════════════════════════════════
-- Model Registry: multi-mode models.
--
-- `kind` is singular, so a hybrid model had to be filed under exactly one mode
-- and became invisible to every other. That is wrong for how models actually
-- ship now: Nano Banana 2 does text-to-image AND image editing from one
-- endpoint; Gemini 3 Pro Image emits image AND text. Forcing a single kind
-- meant picking one capability and silently discarding the rest — and it was
-- already biting: filing hybrids as image_edit left image_t2i with no
-- OpenRouter row at all.
--
-- `kinds` is the full set a model can serve; `kind` is retained as the PRIMARY
-- mode for display, default-selection and backward compatibility, so nothing
-- that reads `kind` today changes behaviour. Resolution matches against
-- `kinds`, which is a superset containing `kind`.
--
-- input_modalities / output_modalities keep the provider's own capability
-- declaration verbatim, so a mode we don't model yet (audio out, video with
-- native audio, 3D) is still recorded at sync time and can be mapped later
-- without a re-sync or a guess.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.model_registry
  ADD COLUMN IF NOT EXISTS kinds TEXT[];

ALTER TABLE public.model_registry
  ADD COLUMN IF NOT EXISTS input_modalities TEXT[];

ALTER TABLE public.model_registry
  ADD COLUMN IF NOT EXISTS output_modalities TEXT[];

-- Backfill: every existing row serves exactly the one mode it was filed under.
-- Idempotent — only fills rows that haven't been backfilled yet.
UPDATE public.model_registry
   SET kinds = ARRAY[kind]
 WHERE kinds IS NULL OR cardinality(kinds) = 0;

-- Membership lookups drive resolution; GIN is the right index for @> / &&.
CREATE INDEX IF NOT EXISTS idx_model_registry_kinds
  ON public.model_registry USING GIN (kinds);

COMMENT ON COLUMN public.model_registry.kinds IS
  'Every mode this model can serve. Superset of `kind` (the primary/display mode). Resolution matches on this.';
COMMENT ON COLUMN public.model_registry.input_modalities IS
  'Provider-declared input modalities, verbatim (text/image/audio/video) — lets an unmapped mode be recognised later without a re-sync.';
COMMENT ON COLUMN public.model_registry.output_modalities IS
  'Provider-declared output modalities, verbatim.';
