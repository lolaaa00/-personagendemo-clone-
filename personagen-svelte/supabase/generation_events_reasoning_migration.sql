-- ═══════════════════════════════════════════════════════════════════════════
-- Thinking tokens, told apart from the answer.
--
-- generation_events.tokens_out said the quality grader emitted ~1,100 output
-- tokens per call for a 7-field JSON grade that is ~90 tokens long. The stage
-- view (generation_events_stage_migration.sql) could name the stage but not
-- explain it; the explanation took a probe call on 2026-09-17:
--
--   completion_tokens 1,054, completion_tokens_details.reasoning_tokens 950
--
-- Gemini 3.5 Flash thinks by default, and the thinking is billed as output at
-- the output rate. So 90% of the grader's cost was deliberation over a weighted
-- sum whose weights are written into the prompt. No prompt bound touches that;
-- a reasoning budget does — the same call at effort=minimal returned 148
-- completion tokens, 0 reasoning, a valid grade, for $0.0018 against $0.0099.
-- Thinking cannot be switched off on that endpoint, only budgeted.
--
-- This records the split so the next such question is answered from the
-- ledger rather than a probe. tokens_reasoning is the thinking part of
-- tokens_out (OpenRouter: completion_tokens_details.reasoning_tokens; Gemini:
-- usageMetadata.thoughtsTokenCount). 0 = the provider said none; NULL = it did
-- not say. RECORDED, NOT BILLED, like every other usage column — the quote the
-- user approved is still the bill.
--
-- llm_stage_usage gains the average and the share of output that was thinking.
-- The view is dropped and recreated rather than CREATE OR REPLACEd: Postgres
-- lets a replacement only APPEND columns, and the share belongs beside the
-- tokens it describes. Nothing depends on the view. The REVOKE is restated
-- because a dropped view loses its grants.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; DROP VIEW IF EXISTS + CREATE VIEW.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.generation_events
  ADD COLUMN IF NOT EXISTS tokens_reasoning INTEGER;

COMMENT ON COLUMN public.generation_events.tokens_reasoning IS
  'Of tokens_out, the model''s hidden thinking. 0 = the provider reported none; NULL = it did not say. Recorded, not billed.';

DROP VIEW IF EXISTS public.llm_stage_usage;

CREATE VIEW public.llm_stage_usage AS
SELECT
  stage,
  count(*)                                        AS calls,
  round(avg(tokens_in)::numeric, 0)               AS avg_tokens_in,
  round(avg(tokens_out)::numeric, 0)              AS avg_tokens_out,
  round(avg(tokens_reasoning)::numeric, 0)        AS avg_tokens_reasoning,
  -- thinking / all output, over the calls that reported the split
  round(
    sum(tokens_reasoning)::numeric
      / nullif(sum(tokens_out) FILTER (WHERE tokens_reasoning IS NOT NULL), 0),
    2
  )                                               AS reasoning_share,
  round(avg(est_cost)::numeric, 6)                AS table_usd,
  round(avg(measured_cost)::numeric, 8)           AS measured_usd,
  round(sum(coalesce(measured_cost, est_cost))::numeric, 6) AS total_usd,
  max(created_at)                                 AS last_seen
FROM public.generation_events
WHERE operation = 'llm' AND stage IS NOT NULL
GROUP BY stage;

COMMENT ON VIEW public.llm_stage_usage IS
  'Tokens and cost per run stage. reasoning_share is the fraction of output that was hidden thinking. A director_retry_* or director_rewrite_* row is a script paid for twice; its share of director calls is the retry rate.';

REVOKE ALL ON public.llm_stage_usage FROM PUBLIC, anon, authenticated;
