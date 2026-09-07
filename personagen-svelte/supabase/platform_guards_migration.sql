-- ═══════════════════════════════════════════════════════════════════════════
-- Platform guards + reconciliation.
--
--   platform_settings.daily_platform_spend_usd   ceiling on TOTAL estimated
--                                                 provider spend per UTC day,
--                                                 across every user (default
--                                                 200; 0 disables). Checked in
--                                                 assertWithinBudget; fails
--                                                 closed only while credits
--                                                 are enforced.
--   platform_settings.signup_credits_hourly_cap  welcome grants per hour,
--                                                 platform-wide (default 20).
--                                                 A bot creating accounts gets
--                                                 credit for the first N only.
--   credit_reconcile_mismatches(p_hours)          every platform-paid
--                                                 generation event in the
--                                                 window must carry exactly one
--                                                 debit of the credits it
--                                                 recorded; returns the rest.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('daily_platform_spend_usd', '200'::jsonb, 'Ceiling on total estimated provider spend per UTC day across all users; 0 disables. Fails closed only in enforce.'),
  ('signup_credits_hourly_cap', '20'::jsonb, 'Maximum welcome-credit grants per hour platform-wide (signup abuse guard).')
ON CONFLICT (key) DO NOTHING;

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
  IF p_key = 'credit_markup' AND (jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric < 1 OR (p_value #>> '{}')::numeric > 20) THEN
    RAISE EXCEPTION 'credit_markup must be a number between 1 and 20' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'daily_platform_spend_usd' AND (jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric < 0 OR (p_value #>> '{}')::numeric > 100000) THEN
    RAISE EXCEPTION 'daily_platform_spend_usd must be a number between 0 and 100,000' USING ERRCODE = '22023';
  END IF;
  IF p_key = 'signup_credits_hourly_cap' AND (jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric < 0 OR (p_value #>> '{}')::numeric > 10000 OR (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)) THEN
    RAISE EXCEPTION 'signup_credits_hourly_cap must be an integer between 0 and 10,000' USING ERRCODE = '22023';
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

-- Signup trigger with the hourly welcome cap. Everything else unchanged.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE v_credits BIGINT; v_cap BIGINT; v_recent BIGINT;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  BEGIN
    SELECT COALESCE((value #>> '{}')::bigint, 0) INTO v_credits FROM public.platform_settings WHERE key = 'signup_credits';
    SELECT COALESCE((value #>> '{}')::bigint, 20) INTO v_cap FROM public.platform_settings WHERE key = 'signup_credits_hourly_cap';
    IF v_credits > 0 THEN
      SELECT count(*) INTO v_recent FROM public.credit_ledger
       WHERE kind = 'grant' AND note LIKE 'welcome%' AND created_at > now() - interval '1 hour';
      IF v_cap = 0 OR v_recent < v_cap THEN
        PERFORM public.credit_apply(NEW.id, v_credits, 'grant', 'welcome credits (signup)', NULL);
      ELSE
        RAISE WARNING 'welcome credits withheld for % — hourly cap % reached (% grants in the last hour)', NEW.id, v_cap, v_recent;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'welcome credits not granted for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Reconciliation: platform-paid events in the window vs their debits.
CREATE OR REPLACE FUNCTION public.credit_reconcile_mismatches(p_hours INTEGER DEFAULT 24)
RETURNS TABLE (event_id UUID, est_cost NUMERIC, credits BIGINT, expected BIGINT, debited BIGINT, debit_rows BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH m AS (
    SELECT COALESCE((value #>> '{}')::numeric, 1) AS markup FROM public.platform_settings WHERE key = 'credit_markup'
  ), ev AS (
    SELECT e.id, e.est_cost, e.credits,
           ceil(e.est_cost * (SELECT markup FROM m) * 100)::bigint AS expected,
           COALESCE(-(SELECT sum(l.delta) FROM public.credit_ledger l WHERE l.generation_event_id = e.id AND l.kind = 'debit'), 0)::bigint AS debited,
           (SELECT count(*) FROM public.credit_ledger l WHERE l.generation_event_id = e.id AND l.kind = 'debit')::bigint AS debit_rows
      FROM public.generation_events e
     WHERE e.key_source = 'platform'
       AND e.created_at > now() - make_interval(hours => GREATEST(1, p_hours))
       AND e.credits > 0
  )
  SELECT id, est_cost, credits, expected, debited, debit_rows
    FROM ev
   WHERE debit_rows <> 1 OR debited <> credits
   ORDER BY id;
$$;
REVOKE ALL ON FUNCTION public.credit_reconcile_mismatches(INTEGER) FROM PUBLIC, anon, authenticated;
