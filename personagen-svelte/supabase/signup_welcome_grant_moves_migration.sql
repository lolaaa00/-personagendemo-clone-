-- ═══════════════════════════════════════════════════════════════════════════
-- The welcome grant moves to the signup route, because the trigger cannot see
-- the marker it was just told to check.
--
-- signup_invite_credit_guard_migration.sql made handle_new_user() require an
-- 'invited' marker in raw_app_meta_data. Correct in principle and, measured
-- against production, unreachable in practice: GoTrue INSERTs the auth.users
-- row and applies app_metadata in a second step, so the AFTER INSERT trigger
-- runs while raw_app_meta_data is still {"provider":"email",...}. An admin
-- createUser carrying app_metadata:{invited:true} ends up with the marker
-- stored and the wallet empty — proven, both halves.
--
-- Left alone that is a regression: real signups get no welcome credit. So the
-- grant moves to /api/auth/signup, which is the stronger arrangement anyway.
-- An account that never went through that route is never granted anything,
-- whatever it manages to put in its own metadata.
--
-- The trigger still grants in ONE case: signup_credits_require_invite = false,
-- meaning the operator has deliberately opened signups and wants every account
-- funded. Both paths now pass the same idempotency key, 'welcome:<user id>',
-- against the unique index on credit_ledger.stripe_event_id — so if the
-- setting is flipped mid-signup and both fire, whichever lands first is the
-- only one that does. A double grant is not possible.
--
-- Profile and free subscription are still created for ANY account. Only the
-- money is gated.
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
