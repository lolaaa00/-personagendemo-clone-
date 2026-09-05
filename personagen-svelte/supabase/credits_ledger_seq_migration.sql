-- ═══════════════════════════════════════════════════════════════════════════
-- credit_ledger.seq — a total order for the money trail.
--
-- created_at is the TRANSACTION timestamp, so several ledger rows written in
-- one transaction (a grant then a set; four debits for one generation) share
-- it exactly, and "the latest row" becomes ambiguous. An identity column gives
-- every row a strictly increasing position regardless of clock or transaction
-- boundaries. Readers order by seq; created_at stays for humans.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_seq ON public.credit_ledger (seq);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_seq ON public.credit_ledger (user_id, seq DESC);
