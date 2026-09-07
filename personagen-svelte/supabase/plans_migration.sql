-- ═══════════════════════════════════════════════════════════════════════════
-- Plans — subscriptions with an included monthly media wallet.
--
--   plan_catalog            what each plan costs and includes (service-only;
--                           editable by an operator; PLAN_FALLBACK in code is
--                           the same table for an unmigrated database)
--   subscriptions           widened plan CHECK (old values kept — never
--                           renamed in place), included_credits,
--                           persona_limit, period start, last included grant
--                           (drives the monthly reset), stripe_price_id,
--                           unique stripe_subscription_id
--   platform_settings       plans_enabled (default false) — the /billing
--                           Plans section and /api/billing/subscribe; the
--                           webhook keeps existing subscriptions working
--                           whatever the switch says
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.plan_catalog (
  plan              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  price_usd_cents   INTEGER NOT NULL CHECK (price_usd_cents >= 0),
  included_credits  BIGINT NOT NULL DEFAULT 0 CHECK (included_credits >= 0),
  persona_limit     INTEGER CHECK (persona_limit IS NULL OR persona_limit >= 0),
  brand_brief_limit INTEGER CHECK (brand_brief_limit IS NULL OR brand_brief_limit >= 0),
  features          JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort              INTEGER NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.plan_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.plan_catalog FROM PUBLIC, anon, authenticated;

INSERT INTO public.plan_catalog (plan, name, price_usd_cents, included_credits, persona_limit, brand_brief_limit, features, sort) VALUES
  ('free',   'Free',   0,     0,     NULL, NULL, '["Welcome credit to start","Unlimited text posts","All 13 platforms"]'::jsonb, 0),
  ('studio', 'Studio', 7900,  4000,  3,    1,    '["3 personas","$40 / month of media generation included","Unlimited text posts","All 13 platforms","1 brand brief","Advisor + Semi-autonomous","Standard video + lip-sync"]'::jsonb, 1),
  ('brand',  'Brand',  29900, 18000, 10,   3,    '["10 personas","$180 / month of media generation included","Unlimited text posts","All 13 platforms","3 brand briefs","All three autonomy levels","Cinematic multi-shot + talking head","Spend ledger + verified publishing","Approval queue"]'::jsonb, 2),
  ('agency', 'Agency', 89900, 60000, NULL, NULL, '["Unlimited personas","$600 / month of media generation included","Unlimited text posts","All 13 platforms","Unlimited brand briefs","Priority generation queue","Teams + shared workspaces","Bring your own keys — generation at no charge","API access + dedicated manager"]'::jsonb, 3)
ON CONFLICT (plan) DO NOTHING;

-- subscriptions: widen the plan check (keep old values), add the wallet columns
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'enterprise', 'studio', 'brand', 'agency'));
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS included_credits BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS persona_limit INTEGER;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS last_included_grant_credits BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription
  ON public.subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('plans_enabled', 'false'::jsonb, 'Offer subscription plans on /billing and accept /api/billing/subscribe. The webhook honours existing subscriptions regardless.')
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
  IF p_key IN ('activity_log', 'plans_enabled') AND jsonb_typeof(p_value) <> 'boolean' THEN
    RAISE EXCEPTION '% must be a boolean', p_key USING ERRCODE = '22023';
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
