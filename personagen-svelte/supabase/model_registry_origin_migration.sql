-- Model registry: row provenance as a first-class column.
--
-- "Where did this row come from" used to be inferred: a wired row with no
-- discovered_at was a seed, anything else came from whichever catalog matched
-- its provider, and price_source='seed' was also being used to mean "no parsed
-- price" on catalog rows. The Model Manager showed that inference as a section
-- heading ("Discovered on fal"), which one displaced seed already contradicted.
-- The origin now travels with the row, is constrained, and is what the page
-- filters, sorts and labels on.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.model_registry ADD COLUMN IF NOT EXISTS origin TEXT;

-- Backfill from the only evidence that exists today.
UPDATE public.model_registry
   SET origin = CASE
                  WHEN discovered_at IS NULL THEN 'seed'
                  WHEN provider = 'openrouter' THEN 'openrouter_catalog'
                  ELSE 'fal_catalog'
                END
 WHERE origin IS NULL;

ALTER TABLE public.model_registry DROP CONSTRAINT IF EXISTS model_registry_origin_check;
ALTER TABLE public.model_registry
  ADD CONSTRAINT model_registry_origin_check
  CHECK (origin IN ('seed', 'fal_catalog', 'openrouter_catalog', 'manual'));

ALTER TABLE public.model_registry ALTER COLUMN origin SET NOT NULL;
-- Rows created by any path that forgets to say where it came from are flagged
-- as hand-made rather than silently passing as catalog truth.
ALTER TABLE public.model_registry ALTER COLUMN origin SET DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS model_registry_origin_idx ON public.model_registry (user_id, origin);
