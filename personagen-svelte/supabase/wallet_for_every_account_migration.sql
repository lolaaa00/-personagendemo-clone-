-- ═══════════════════════════════════════════════════════════════════════════
-- Every account gets a wallet. At ZERO — a wallet is not money.
--
-- Measured in production: one account in ten had no credit_accounts row at
-- all. Not a zero balance — no row. It was created through the GoTrue admin
-- API, which is how every client account is created, and handle_new_user()
-- only ever produced a wallet as a SIDE EFFECT of credit_apply() landing the
-- welcome credit (credit_apply upserts the wallet on first touch).
-- signup_welcome_grant_moves_migration.sql moved that grant out to
-- /api/auth/signup — correctly, because GoTrue applies app_metadata after the
-- INSERT and the trigger can therefore never see the invited marker — and the
-- wallet went with it. Nobody checked, because nothing failed: an account with
-- no wallet reads as $0.00, which is also what an empty wallet reads as.
--
-- What the next account an operator creates lands on: a red $0.00 in the
-- portal, a billing page whose only button says "Coming soon" (Stripe is not
-- configured), and the copy "Nothing more can be generated… top up to
-- continue." Under credits_mode = enforce that is a dead end on first login.
--
-- So the wallet stops being a side effect of money and becomes a structural
-- row: created next to the profile and the free subscription, for ANY account,
-- however it was made.
--
-- ZERO, AND ONLY ZERO. This must not reopen the hole the grant was moved to
-- close. Anyone holding the browser's anon key can POST the public
-- /auth/v1/signup endpoint and make this trigger fire, so anything the trigger
-- funds is money a stranger minted for themselves — which is exactly what
-- signup_invite_credit_guard and then signup_welcome_grant_moves were written
-- to stop. Opening an EMPTY wallet gives that stranger nothing: it is a row,
-- not a balance. The welcome grant stays precisely where it was put — in
-- /api/auth/signup, plus the deliberate signup_credits_require_invite = false
-- path preserved verbatim below — and this migration adds no new way for any
-- balance to move. No ledger row is written for the opening either: opening an
-- account is not a transaction, and the invariant SUM(delta) = balance_credits
-- holds for a wallet at zero with no rows.
--
-- The INSERT is unguarded, sitting with profiles and subscriptions rather than
-- inside the money block that is allowed to fail with a WARNING. A wallet-less
-- account IS the defect being fixed; a signup that fails loudly can be found
-- and repaired, and a silent one is what produced this. (Privileges checked
-- against production: the trigger's owner has INSERT on credit_accounts and
-- BYPASSRLS, so the statement is as safe as the two beside it.)
--
-- Everything handle_new_user() did before is preserved, statement for
-- statement. The only addition is the wallet.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits BIGINT;
  v_cap BIGINT;
  v_recent BIGINT;
  v_require BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  -- The wallet, EMPTY. Every column takes its default: balance_credits 0,
  -- billing_mode 'credits'. Deliberately not credit_apply() — that is the
  -- money path and would write a ledger row for a thing that moved no money.
  INSERT INTO public.credit_accounts (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  BEGIN
    -- Absent, null or unreadable → require the route. A guard that fails open
    -- is not a guard.
    SELECT COALESCE((value #>> '{}') <> 'false', true) INTO v_require
      FROM public.platform_settings WHERE key = 'signup_credits_require_invite';
    v_require := COALESCE(v_require, true);

    IF NOT v_require THEN
      SELECT COALESCE((value #>> '{}')::bigint, 0) INTO v_credits
        FROM public.platform_settings WHERE key = 'signup_credits';
      SELECT COALESCE((value #>> '{}')::bigint, 20) INTO v_cap
        FROM public.platform_settings WHERE key = 'signup_credits_hourly_cap';
      IF v_credits > 0 THEN
        SELECT count(*) INTO v_recent FROM public.credit_ledger
         WHERE kind = 'grant' AND note LIKE 'welcome%' AND created_at > now() - interval '1 hour';
        IF v_cap = 0 OR v_recent < v_cap THEN
          PERFORM public.credit_apply(
            NEW.id, v_credits, 'grant', 'welcome credits (signup)',
            NULL, NULL, NULL, NULL, 'welcome:' || NEW.id::text, 0, false
          );
        ELSE
          RAISE WARNING 'welcome credits withheld for % — hourly cap % reached (% grants in the last hour)', NEW.id, v_cap, v_recent;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'welcome credits not granted for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ── the accounts that were created before this ──────────────────────────────
-- At zero, and no ledger row: nothing was granted, so there is nothing to
-- record. Idempotent by construction — a second run inserts nothing — and it
-- can never touch a wallet that already exists, so no balance moves.
INSERT INTO public.credit_accounts (user_id)
SELECT u.id
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.credit_accounts a WHERE a.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

COMMENT ON TABLE public.credit_accounts IS
  'One wallet per billing user, opened at ZERO by handle_new_user() for every account regardless of how it was created. The row is structural; the balance is money and moves only through credit_apply().';
