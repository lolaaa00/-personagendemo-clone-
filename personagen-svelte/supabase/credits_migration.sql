-- ═══════════════════════════════════════════════════════════════════════════
-- Credits — the wallet the spend ledger debits.
--
-- generation_events is a RECEIPT (what ran, at what estimated USD). It never
-- touched a balance because none existed. This migration adds:
--   * credit_accounts   one wallet per BILLING user (workspace owner, else the
--                       persona owner), cached balance, billing_mode
--   * credit_ledger     append-only money trail; balance_after on every row
--   * credit_apply()    the ONLY way a balance moves: SECURITY DEFINER, row
--                       lock, fail-closed on insufficient funds, upserts the
--                       wallet on first touch (no signup-trigger dependency —
--                       one prod account predates the trigger)
--   * generation_events.billed_user_id / key_source / credits — attribution
--   * subscriptions RLS lockdown — users could UPDATE their own plan
--
-- Unit: 1 credit = 1 cent of ESTIMATED provider cost (ceil(est_cost * 100)).
-- Margin lives in the Stripe price of a pack, never in this schema.
-- See docs/monetization/credit-system-forensic-assessment-and-plan.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── wallets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_accounts (
  user_id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_credits         BIGINT NOT NULL DEFAULT 0,
  billing_mode            TEXT NOT NULL DEFAULT 'credits' CHECK (billing_mode IN ('credits', 'unmetered')),
  stripe_customer_id      TEXT,
  low_balance_notified_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_accounts_stripe_customer
  ON public.credit_accounts (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit_accounts_select_own" ON public.credit_accounts;
CREATE POLICY "credit_accounts_select_own" ON public.credit_accounts
  FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies: the balance moves only through credit_apply().

DROP TRIGGER IF EXISTS credit_accounts_updated_at ON public.credit_accounts;
CREATE TRIGGER credit_accounts_updated_at
  BEFORE UPDATE ON public.credit_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── ledger (append-only) ────────────────────────────────────────────────────
-- user_id is SET NULL on account deletion (not cascaded): financial history
-- outlives the account. balance_after is the wallet's cached balance after
-- this row, so SUM(delta) per user must always equal credit_accounts.balance.
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  delta               BIGINT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('grant', 'purchase', 'debit', 'refund', 'adjustment', 'set')),
  balance_after       BIGINT NOT NULL,
  waived_credits      BIGINT NOT NULL DEFAULT 0,
  generation_event_id UUID REFERENCES public.generation_events(id) ON DELETE SET NULL,
  post_id             UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  agent_id            UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  stripe_event_id     TEXT,
  actor_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON public.credit_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_kind_created ON public.credit_ledger (kind, created_at DESC);
-- Idempotency: a webhook replay or a retried debit for the same generation
-- event cannot apply twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_stripe_event
  ON public.credit_ledger (stripe_event_id) WHERE stripe_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_debit_per_event
  ON public.credit_ledger (generation_event_id) WHERE kind = 'debit' AND generation_event_id IS NOT NULL;

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit_ledger_select_own" ON public.credit_ledger;
CREATE POLICY "credit_ledger_select_own" ON public.credit_ledger
  FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.credit_ledger FROM anon, authenticated;

-- ── attribution on the spend ledger ─────────────────────────────────────────
ALTER TABLE public.generation_events ADD COLUMN IF NOT EXISTS billed_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.generation_events ADD COLUMN IF NOT EXISTS key_source TEXT CHECK (key_source IN ('platform', 'byo', 'none'));
ALTER TABLE public.generation_events ADD COLUMN IF NOT EXISTS credits BIGINT;
CREATE INDEX IF NOT EXISTS idx_generation_events_billed ON public.generation_events (billed_user_id, created_at);

COMMENT ON COLUMN public.generation_events.billed_user_id IS 'Wallet charged: workspace owner for workspace personas, else the persona owner. user_id remains the ACTOR.';
COMMENT ON COLUMN public.generation_events.key_source IS 'platform = our key paid the provider (credits apply); byo = the user''s own key; none = no provider call (local/storage).';
COMMENT ON COLUMN public.generation_events.credits IS 'ceil(est_cost * 100). 0 when waived (byo / unmetered / local).';

-- ── the single balance mutator ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.credit_apply(
  p_user           UUID,
  p_delta          BIGINT,
  p_kind           TEXT,
  p_note           TEXT    DEFAULT NULL,
  p_actor          UUID    DEFAULT NULL,
  p_event          UUID    DEFAULT NULL,
  p_post           UUID    DEFAULT NULL,
  p_agent          UUID    DEFAULT NULL,
  p_stripe_event   TEXT    DEFAULT NULL,
  p_waived         BIGINT  DEFAULT 0,
  p_allow_negative BOOLEAN DEFAULT false
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bal  BIGINT;
  v_mode TEXT;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'credit_apply: p_user is required' USING ERRCODE = '22004';
  END IF;
  IF p_kind NOT IN ('grant', 'purchase', 'debit', 'refund', 'adjustment', 'set') THEN
    RAISE EXCEPTION 'credit_apply: unknown kind %', p_kind USING ERRCODE = '22023';
  END IF;

  -- Wallet on first touch; then lock it for the rest of the transaction.
  INSERT INTO public.credit_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_credits, billing_mode INTO v_bal, v_mode
    FROM public.credit_accounts WHERE user_id = p_user FOR UPDATE;

  -- 'set': the caller passes the TARGET balance in p_delta.
  IF p_kind = 'set' THEN
    p_delta := p_delta - v_bal;
  END IF;

  -- Comped accounts: record what it would have cost, charge nothing.
  IF p_delta < 0 AND v_mode = 'unmetered' THEN
    p_waived := COALESCE(p_waived, 0) + (-p_delta);
    p_delta  := 0;
  END IF;

  IF p_delta < 0 AND NOT p_allow_negative AND v_bal + p_delta < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS: balance % < required %', v_bal, -p_delta
      USING ERRCODE = 'P0001';
  END IF;

  v_bal := v_bal + p_delta;
  UPDATE public.credit_accounts SET balance_credits = v_bal WHERE user_id = p_user;

  INSERT INTO public.credit_ledger
    (user_id, delta, kind, balance_after, waived_credits, generation_event_id, post_id, agent_id, stripe_event_id, actor_user_id, note)
  VALUES
    (p_user, p_delta, p_kind, v_bal, COALESCE(p_waived, 0), p_event, p_post, p_agent, p_stripe_event, p_actor, p_note);

  RETURN v_bal;
END;
$$;
-- Deliberately NOT granted to authenticated/anon: every caller is a server
-- route or the Stripe webhook using the service role.
REVOKE ALL ON FUNCTION public.credit_apply(UUID, BIGINT, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Admin: switch billing mode. Service-role only (no grant).
CREATE OR REPLACE FUNCTION public.credit_set_mode(p_user UUID, p_mode TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_mode NOT IN ('credits', 'unmetered') THEN
    RAISE EXCEPTION 'credit_set_mode: unknown mode %', p_mode USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.credit_accounts (user_id, billing_mode) VALUES (p_user, p_mode)
    ON CONFLICT (user_id) DO UPDATE SET billing_mode = EXCLUDED.billing_mode;
  RETURN p_mode;
END;
$$;
REVOKE ALL ON FUNCTION public.credit_set_mode(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── lock the dormant subscriptions table (users could UPDATE their own plan) ─
DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_delete_own" ON public.subscriptions;
