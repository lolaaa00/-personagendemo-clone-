-- ═══════════════════════════════════════════════════════════════════════════
-- What the provider said the call actually consumed.
--
-- Until now a text generation was billed a flat table rate — $0.002 for an LLM
-- call whether it used a hundred tokens or a hundred thousand (src/lib/pricing.ts
-- states the basis: "All values are USD per call"). OpenRouter returns a `usage`
-- block on every response, including a real `cost` in USD, and the client read
-- it and threw it away. So the only ground truth in the system was discarded,
-- and the price table — maintained by hand — was the sole basis for every bill.
--
-- That table has been measurably wrong before, in both directions: an OpenRouter
-- still was billed $0.02 against a real $0.077, a 3.9x under-bill that also
-- under-counted the per-seat spend caps.
--
-- RECORDED, NOT BILLED. est_cost stays the billing basis and stays authoritative
-- on purpose: the number quoted to the user BEFORE the run comes from the same
-- table, and "the quote is an upper bound on the bill" is a promise this system
-- keeps. A measured cost higher than the table must not silently become the
-- charge. The fix for a wrong price is to correct the TABLE, which moves the
-- quote and the bill together — and these columns are what make that correction
-- measurable rather than guessed.
--
-- All three are NULLABLE and stay nullable. A provider that reports nothing has
-- to be distinguishable from one that reported zero: 0 would read as "free".
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.generation_events
  ADD COLUMN IF NOT EXISTS tokens_in      INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_out     INTEGER,
  ADD COLUMN IF NOT EXISTS measured_cost  NUMERIC(12, 8);

-- Same shape as the est_cost guard: a negative consumption is a bug, not data.
ALTER TABLE public.generation_events
  DROP CONSTRAINT IF EXISTS generation_events_usage_nonnegative;
ALTER TABLE public.generation_events
  ADD CONSTRAINT generation_events_usage_nonnegative
  CHECK (
    (tokens_in     IS NULL OR tokens_in     >= 0) AND
    (tokens_out    IS NULL OR tokens_out    >= 0) AND
    (measured_cost IS NULL OR measured_cost >= 0)
  );

COMMENT ON COLUMN public.generation_events.measured_cost IS
  'USD the PROVIDER reported for this call. Ground truth, recorded for price-table calibration. NOT the billing basis — est_cost is, because the pre-run quote comes from the same table and the quote is an upper bound on the bill.';

-- ── the report this exists for ──────────────────────────────────────────────
-- Where the hand-maintained table disagrees with what providers actually
-- charged, per provider/operation/model, over rows that carry a measurement.
-- A price row whose drift_ratio sits far from 1.0 is mis-priced by that factor
-- in that direction, and every quote built on it is wrong by the same factor.
CREATE OR REPLACE VIEW public.price_table_drift AS
SELECT
  provider,
  operation,
  model,
  count(*)                                            AS measured_calls,
  round(avg(est_cost)::numeric, 6)                    AS table_usd,
  round(avg(measured_cost)::numeric, 8)               AS measured_usd,
  CASE WHEN avg(est_cost) > 0
       THEN round((avg(measured_cost) / avg(est_cost))::numeric, 4)
  END                                                 AS drift_ratio,
  round((sum(measured_cost) - sum(est_cost))::numeric, 6) AS unbilled_usd,
  max(created_at)                                     AS last_seen
FROM public.generation_events
WHERE measured_cost IS NOT NULL
GROUP BY provider, operation, model;

COMMENT ON VIEW public.price_table_drift IS
  'Hand-maintained price table vs what providers actually charged. drift_ratio > 1 means we are under-billing that row by that factor; unbilled_usd is the running total we absorbed.';

REVOKE ALL ON public.price_table_drift FROM PUBLIC, anon, authenticated;
