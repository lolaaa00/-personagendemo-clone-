-- ═══════════════════════════════════════════════════════════════════════════
-- Credit markup — the credit becomes a RETAIL cent.
--
--   platform_settings.credit_markup   multiplier applied to the estimated
--                                     provider cost when a generation is
--                                     debited: credits = ceil(est_cost × markup × 100)
--
-- Why: the wallet pill shows credits as money ("Credits $20.00"). If the
-- margin lived only in the Stripe pack price, a $20 pack at 2x would sell
-- 1,000 credits and the customer would see "$10.00" right after paying $20.
-- With the markup inside the credit, 1 credit = 1 retail cent, packs sell at
-- par ($20 = 2,000 credits), the balance shown is the balance paid for, and
-- the margin is one number changed from the console without a deploy.
--
-- Default 1.0 keeps today's behaviour until an admin sets it. Existing
-- balances are not migrated: they simply buy at the new rate from now on.
-- generation_events.credits stays the audited retail amount per event;
-- est_cost stays the raw provider estimate, so margin = credits/100 − est_cost.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('credit_markup', '1.0'::jsonb, 'Retail multiplier on estimated provider cost when debiting credits (1 credit = 1 retail cent). 1.0 = at cost.')
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
  SELECT value INTO v_old FROM public.platform_settings WHERE key = p_key;
  INSERT INTO public.platform_settings (key, value, updated_by) VALUES (p_key, p_value, p_actor)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
  INSERT INTO public.platform_settings_history (key, old_value, new_value, changed_by, note)
    VALUES (p_key, v_old, p_value, p_actor, p_note);
  RETURN p_value;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_setting_set(TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
