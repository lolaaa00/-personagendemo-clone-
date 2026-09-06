-- ═══════════════════════════════════════════════════════════════════════════
-- Welcome credits + money display.
--
--   platform_settings.signup_credits           credits granted to every new
--                                               account at signup (default 2000
--                                               = $20.00 of generation); 0 = off
--   platform_settings.display_currency_default 'auto' (visitor's country /
--                                               locale) or an ISO code
--   platform_settings.fx_rates                 USD-based display rates, refreshed
--                                               from the console; display only —
--                                               the wallet is always USD cents
--   profiles.display_currency                  per-user override (nullable)
--
-- The grant rides the existing signup trigger (handle_new_user), so it covers
-- every signup path — including a direct GoTrue signup that bypasses the app.
-- It writes through credit_apply(): a ledger row, kind 'grant', note 'welcome'.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('signup_credits', '2000'::jsonb, 'Credits granted to every new account at signup (1 credit = 1¢ of estimated generation). 0 disables.'),
  ('display_currency_default', '"auto"'::jsonb, 'auto = visitor''s country/locale, else an ISO-4217 code'),
  ('fx_rates', '{"base":"USD","rates":{"USD":1},"updated_at":null,"source":"seed"}'::jsonb, 'USD-based display rates; refreshed from the console (display only)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_currency TEXT
  CHECK (display_currency IS NULL OR display_currency ~ '^[A-Z]{3}$');

-- Validation for the new keys (replaces the function body; same signature).
CREATE OR REPLACE FUNCTION public.platform_setting_set(p_key TEXT, p_value JSONB, p_actor UUID DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old JSONB;
BEGIN
  IF p_key = 'credits_mode' AND NOT (p_value #>> '{}' IN ('off', 'shadow', 'enforce')) THEN
    RAISE EXCEPTION 'credits_mode must be off | shadow | enforce' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'activity_log' AND jsonb_typeof(p_value) <> 'boolean' THEN
    RAISE EXCEPTION 'activity_log must be a boolean' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'activity_pepper' AND length(p_value #>> '{}') < 32 THEN
    RAISE EXCEPTION 'activity_pepper must be at least 32 characters' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'signup_credits' AND (jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric < 0 OR (p_value #>> '{}')::numeric > 1000000 OR (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)) THEN
    RAISE EXCEPTION 'signup_credits must be an integer between 0 and 1,000,000' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'display_currency_default' AND NOT ((p_value #>> '{}') = 'auto' OR (p_value #>> '{}') ~ '^[A-Z]{3}$') THEN
    RAISE EXCEPTION 'display_currency_default must be auto or an ISO-4217 code' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'fx_rates' AND (jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value->'rates') <> 'object' OR (p_value->>'base') IS DISTINCT FROM 'USD') THEN
    RAISE EXCEPTION 'fx_rates must be {base:"USD", rates:{...}}' USING ERRCODE = '22023';
  END IF;
  SELECT value INTO v_old FROM public.platform_settings WHERE key = p_key;
  INSERT INTO public.platform_settings (key, value, updated_by) VALUES (p_key, p_value, p_actor)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
  INSERT INTO public.platform_settings_history (key, old_value, new_value, changed_by, note)
    VALUES (p_key, v_old, p_value, p_actor, p_note);
  RETURN p_value;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_setting_set(TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Signup trigger: profile + free subscription row (unchanged) + welcome credits.
-- The grant is wrapped so a credits failure can never block account creation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE v_credits BIGINT;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  BEGIN
    SELECT COALESCE((value #>> '{}')::bigint, 0) INTO v_credits FROM public.platform_settings WHERE key = 'signup_credits';
    IF v_credits > 0 THEN
      PERFORM public.credit_apply(NEW.id, v_credits, 'grant', 'welcome credits (signup)', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'welcome credits not granted for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
