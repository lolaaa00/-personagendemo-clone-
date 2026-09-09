-- ═══════════════════════════════════════════════════════════════════════════
-- The signup gate stops handing out money to accounts that walked around it.
--
-- /api/auth/signup asks for an Admin PIN. That gate is decorative while the
-- Supabase project allows public signups: the anon key ships in the browser
-- bundle, so anyone can POST to <supabase>/auth/v1/signup and get an account.
-- The route's own comment has said so for a while. What made it expensive is
-- that handle_new_user() then granted the welcome credit to that account —
-- 1000 credits, capped only by signup_credits_hourly_cap (20/hour), which is
-- 20,000 credits an hour of generation for anyone who noticed.
--
-- Proven against production before this migration: a direct GoTrue signup
-- returned 200 with a session, a profile row, a free subscription and a wallet
-- holding 1000 credits.
--
-- The fix is a marker only the SERVER can write. GoTrue puts client-supplied
-- fields in raw_user_meta_data and never in raw_app_meta_data; an admin
-- createUser call can write app_metadata. Also proven: a signup POST sending
-- both `app_metadata: {invited:true}` and a nested decoy inside `data` left
-- raw_app_meta_data untouched at {"provider":"email","providers":["email"]}.
--
-- So: profile and subscription are still created for ANY account (an account
-- that exists must be usable and deletable), but the welcome CREDIT now
-- requires the marker. A bypass account starts with an empty wallet, and in
-- enforce mode an empty wallet generates nothing.
--
-- signup_credits_require_invite (platform_settings, default true) turns the
-- requirement off if open signups with credit are ever wanted. Unreadable or
-- absent means ON — a guard that fails open is not a guard.
--
-- This does NOT replace disabling public signups on the Supabase project
-- (GOTRUE_DISABLE_SIGNUP=true). It removes the money from the hole; the hole
-- is still there until that flag is set.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_settings (key, value)
VALUES ('signup_credits_require_invite', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

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
  v_invited BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  BEGIN
    SELECT COALESCE((value #>> '{}')::bigint, 0) INTO v_credits
      FROM public.platform_settings WHERE key = 'signup_credits';
    SELECT COALESCE((value #>> '{}')::bigint, 20) INTO v_cap
      FROM public.platform_settings WHERE key = 'signup_credits_hourly_cap';

    -- Absent, null or unreadable → require the marker.
    SELECT COALESCE((value #>> '{}') <> 'false', true) INTO v_require
      FROM public.platform_settings WHERE key = 'signup_credits_require_invite';
    v_require := COALESCE(v_require, true);

    -- raw_app_meta_data ONLY. raw_user_meta_data is client-controlled and a
    -- forged marker there must not count.
    v_invited := COALESCE(NEW.raw_app_meta_data->>'invited', '') = 'true';

    IF v_credits > 0 AND (v_invited OR NOT v_require) THEN
      SELECT count(*) INTO v_recent FROM public.credit_ledger
       WHERE kind = 'grant' AND note LIKE 'welcome%' AND created_at > now() - interval '1 hour';
      IF v_cap = 0 OR v_recent < v_cap THEN
        PERFORM public.credit_apply(NEW.id, v_credits, 'grant', 'welcome credits (signup)', NULL);
      ELSE
        RAISE WARNING 'welcome credits withheld for % — hourly cap % reached (% grants in the last hour)', NEW.id, v_cap, v_recent;
      END IF;
    ELSIF v_credits > 0 THEN
      RAISE WARNING 'welcome credits withheld for % — account was not created through the signup route', NEW.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'welcome credits not granted for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
