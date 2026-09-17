-- ═══════════════════════════════════════════════════════════════════════════
-- Which STAGE of a run made each LLM call.
--
-- Every text call recorded `model: gemini-3.5-flash`, whether it was the
-- director writing the script, a hook-retry or QC-rewrite regenerating the
-- ENTIRE script, the quality grader, or the fit judge. So the token capture
-- shipped this week could say a call emitted 1,500 output tokens and nothing
-- could say which stage did it. The one attempt to reason about it from token
-- shapes alone guessed the wrong stage (the grader; it was the director).
--
-- A retry or rewrite doubles a post's LLM cost, silently. Nothing recorded the
-- rate. With `stage` on the event, llm_stage_usage answers "which stage is
-- verbose" and "how often does a post pay for its script twice" from data.
--
-- Nullable and additive: rows before this migration, and any non-LLM row, are
-- simply unattributed.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.generation_events
  ADD COLUMN IF NOT EXISTS stage TEXT;

COMMENT ON COLUMN public.generation_events.stage IS
  'Run stage that made the call: director, director_retry_hook, director_rewrite_qc, director_retry_shots, qc_grade, fit_judge, engine:<action>. NULL = not an attributed LLM call.';

CREATE OR REPLACE VIEW public.llm_stage_usage AS
SELECT
  stage,
  count(*)                                        AS calls,
  round(avg(tokens_in)::numeric, 0)               AS avg_tokens_in,
  round(avg(tokens_out)::numeric, 0)              AS avg_tokens_out,
  round(avg(est_cost)::numeric, 6)                AS table_usd,
  round(avg(measured_cost)::numeric, 8)           AS measured_usd,
  round(sum(coalesce(measured_cost, est_cost))::numeric, 6) AS total_usd,
  max(created_at)                                 AS last_seen
FROM public.generation_events
WHERE operation = 'llm' AND stage IS NOT NULL
GROUP BY stage;

COMMENT ON VIEW public.llm_stage_usage IS
  'Tokens and cost per run stage. A director_retry_* or director_rewrite_* row is a script paid for twice; its share of director calls is the retry rate.';

REVOKE ALL ON public.llm_stage_usage FROM PUBLIC, anon, authenticated;
