-- ═══════════════════════════════════════════════════════════════════════════
-- Reconciliation also checks the PRICE, not just the bookkeeping.
--
-- credit_reconcile_mismatches() compared the ledger to the event and stopped
-- there: it asked "was this event debited exactly once, for the credits the
-- event recorded?" That catches an unbilled run and a wrong-sized debit, and it
-- is blind to the case that matters most at scale — an event PRICED wrongly.
-- If creditsFor() drifts, or a markup change half-applies, every event is
-- recorded at the wrong price and debited consistently with it: ledger and
-- event agree perfectly, every customer is overcharged, and the hourly
-- reconciliation reports 0 forever. Proven by scripts/verify-reconciliation-db.mjs,
-- which plants an event priced at 7x and watched the old function miss it.
--
-- The check is `credits = ceil(est_cost × credit_markup × 100)`, applied ONLY to
-- events created after the markup last changed. Older events were priced under
-- the old rate and are correct as recorded; flagging them would be a false
-- alarm every time an operator moves the number, which is the fastest way to
-- teach people to ignore an alert.
--
-- The returned `reason` says which class of damage it is, so the admin timeline
-- and /api/health can tell "someone was not billed" apart from "everyone was
-- billed the wrong price".
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.credit_reconcile_mismatches(INTEGER);

CREATE OR REPLACE FUNCTION public.credit_reconcile_mismatches(p_hours INTEGER DEFAULT 24)
RETURNS TABLE (
  event_id    UUID,
  reason      TEXT,
  est_cost    NUMERIC,
  credits     BIGINT,
  expected    BIGINT,
  debited     BIGINT,
  debit_rows  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH m AS (
    SELECT
      COALESCE((SELECT (value #>> '{}')::numeric FROM public.platform_settings WHERE key = 'credit_markup'), 1) AS markup,
      -- Events priced before the markup last moved are correct at the OLD rate.
      COALESCE(
        (SELECT max(changed_at) FROM public.platform_settings_history WHERE key = 'credit_markup'),
        '-infinity'::timestamptz
      ) AS priced_since
  ), ev AS (
    SELECT
      e.id,
      e.created_at,
      e.est_cost,
      e.credits,
      ceil(e.est_cost * (SELECT markup FROM m) * 100)::bigint AS expected,
      COALESCE(-(SELECT sum(l.delta) FROM public.credit_ledger l
                  WHERE l.generation_event_id = e.id AND l.kind = 'debit'), 0)::bigint AS debited,
      (SELECT count(*) FROM public.credit_ledger l
        WHERE l.generation_event_id = e.id AND l.kind = 'debit')::bigint AS debit_rows
    FROM public.generation_events e
    WHERE e.key_source = 'platform'
      AND e.created_at > now() - make_interval(hours => GREATEST(1, p_hours))
      AND e.credits > 0
  )
  SELECT
    id,
    CASE
      WHEN debit_rows = 0 THEN 'unbilled'          -- generated, never charged
      WHEN debit_rows > 1 THEN 'double_billed'     -- more than one debit for one event
      WHEN debited <> credits THEN 'wrong_amount'  -- charged something else entirely
      ELSE 'wrong_price'                           -- ledger agrees, but the price is not est_cost x markup
    END AS reason,
    est_cost, credits, expected, debited, debit_rows
  FROM ev
  WHERE debit_rows <> 1
     OR debited <> credits
     OR (created_at > (SELECT priced_since FROM m) AND credits <> expected)
  ORDER BY id;
$$;
REVOKE ALL ON FUNCTION public.credit_reconcile_mismatches(INTEGER) FROM PUBLIC, anon, authenticated;
