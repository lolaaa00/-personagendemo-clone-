-- ═══════════════════════════════════════════════════════════════════════════
-- Usage evidence survives a user deletion, the way the money already does.
--
-- credit_ledger.user_id is ON DELETE SET NULL — "financial history is
-- retained" — and generation_events.billed_user_id and post_id are SET NULL
-- too. But generation_events.user_id and agent_id were ON DELETE CASCADE. So
-- when a throwaway user is deleted the debit survives and the usage row that
-- explains it — provider, operation, model, est_cost, and now tokens and the
-- provider's measured cost — is destroyed. Measured on 2026-09-17: 199 orphan
-- debits worth $1.99 with ZERO surviving events. Money left; nothing recorded
-- what bought it. And the price_table_drift view reads exactly the rows that
-- test traffic deletes, so the fastest way to gather calibration data was the
-- one way that erased it.
--
-- Both keys become SET NULL and user_id becomes nullable. A row with a null
-- user is pseudonymous and is invisible to every non-admin reader: the RLS
-- policy is `auth.uid() = user_id`, which no session can satisfy against NULL.
--
-- Real account deletion is UNCHANGED. /api/account/delete lists
-- generation_events among the tables it deletes explicitly for that user, so
-- a person who asks to be removed still is. What changes is only that a bare
-- DELETE FROM auth.users — the admin API, the smoke's cleanup — no longer takes
-- the usage record down with it.
--
-- Idempotent: DROP IF EXISTS + ADD, and DROP NOT NULL is a no-op when already
-- nullable.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.generation_events
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.generation_events
  DROP CONSTRAINT IF EXISTS generation_events_user_id_fkey;
ALTER TABLE public.generation_events
  ADD CONSTRAINT generation_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.generation_events
  DROP CONSTRAINT IF EXISTS generation_events_agent_id_fkey;
ALTER TABLE public.generation_events
  ADD CONSTRAINT generation_events_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.generation_events.user_id IS
  'Actor at the time of the call. NULL after that user is deleted: the usage row is retained pseudonymously, like credit_ledger, so the spend it explains is never orphaned. Real account deletion removes the row explicitly via /api/account/delete.';
