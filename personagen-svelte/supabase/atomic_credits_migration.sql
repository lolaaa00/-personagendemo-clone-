-- Atomic credit buckets, subscription renewal, and signup-credit admission.
-- Existing positive wallets stay NULL because historical bucket allocation
-- cannot be inferred honestly. Classify them explicitly before renewal.

ALTER TABLE public.credit_accounts ADD COLUMN IF NOT EXISTS included_balance_credits BIGINT;
ALTER TABLE public.credit_accounts ALTER COLUMN included_balance_credits SET DEFAULT 0;
UPDATE public.credit_accounts SET included_balance_credits=0
 WHERE included_balance_credits IS NULL AND balance_credits=0;
ALTER TABLE public.credit_accounts DROP CONSTRAINT IF EXISTS credit_accounts_included_balance_check;
ALTER TABLE public.credit_accounts ADD CONSTRAINT credit_accounts_included_balance_check
 CHECK (included_balance_credits IS NULL OR
   (included_balance_credits>=0 AND included_balance_credits<=GREATEST(balance_credits,0)));
COMMENT ON COLUMN public.credit_accounts.included_balance_credits IS
 'Unspent expiring subscription credit within balance_credits. NULL means a legacy positive wallet awaits explicit operator classification.';

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
 event_key TEXT PRIMARY KEY, user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), result TEXT NOT NULL CHECK(result IN ('applied','stale'))
);
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_webhook_events FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.signup_credit_claims (
 user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 address_hash TEXT NOT NULL CHECK(length(address_hash)>=32), claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signup_credit_claims_address_time ON public.signup_credit_claims(address_hash,claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_credit_claims_time ON public.signup_credit_claims(claimed_at DESC);
ALTER TABLE public.signup_credit_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signup_credit_claims FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.credit_classify_included(p_user UUID,p_remaining BIGINT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_balance BIGINT;
BEGIN
 IF p_remaining<0 THEN RAISE EXCEPTION 'remaining included credit cannot be negative'; END IF;
 SELECT balance_credits INTO v_balance FROM public.credit_accounts WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found'; END IF;
 IF p_remaining>GREATEST(v_balance,0) THEN RAISE EXCEPTION 'included credit % exceeds wallet balance %',p_remaining,v_balance; END IF;
 UPDATE public.credit_accounts SET included_balance_credits=p_remaining WHERE user_id=p_user;
 RETURN p_remaining;
END $$;
REVOKE ALL ON FUNCTION public.credit_classify_included(UUID,BIGINT) FROM PUBLIC,anon,authenticated;

-- The sole general mutator now consumes expiring included credit first.
CREATE OR REPLACE FUNCTION public.credit_apply(
 p_user UUID,p_delta BIGINT,p_kind TEXT,p_note TEXT DEFAULT NULL,p_actor UUID DEFAULT NULL,
 p_event UUID DEFAULT NULL,p_post UUID DEFAULT NULL,p_agent UUID DEFAULT NULL,
 p_stripe_event TEXT DEFAULT NULL,p_waived BIGINT DEFAULT 0,p_allow_negative BOOLEAN DEFAULT false
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bal BIGINT;v_mode TEXT;v_included BIGINT;
BEGIN
 IF p_user IS NULL THEN RAISE EXCEPTION 'credit_apply: p_user is required' USING ERRCODE='22004'; END IF;
 IF p_kind NOT IN ('grant','purchase','debit','refund','adjustment','set') THEN RAISE EXCEPTION 'credit_apply: unknown kind %',p_kind USING ERRCODE='22023'; END IF;
 INSERT INTO public.credit_accounts(user_id) VALUES(p_user) ON CONFLICT(user_id) DO NOTHING;
 SELECT balance_credits,billing_mode,included_balance_credits INTO v_bal,v_mode,v_included FROM public.credit_accounts WHERE user_id=p_user FOR UPDATE;
 IF p_kind='set' THEN p_delta:=p_delta-v_bal; END IF;
 IF p_delta<0 AND v_mode='unmetered' THEN p_waived:=COALESCE(p_waived,0)+(-p_delta);p_delta:=0; END IF;
 IF p_delta<0 AND NOT p_allow_negative AND v_bal+p_delta<0 THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS: balance % < required %',v_bal,-p_delta USING ERRCODE='P0001'; END IF;
 IF p_kind='debit' AND p_delta<0 AND v_included IS NOT NULL THEN
  -- Usage consumes expiring included credit before purchased credit.
  v_included:=GREATEST(0,v_included-(-p_delta));
 ELSIF p_delta<0 AND v_included IS NOT NULL THEN
  -- Refunds/adjustments remove non-expiring credit first. If the requested
  -- reduction is larger, the included bucket cannot exceed the new balance.
  v_included:=LEAST(v_included,GREATEST(v_bal+p_delta,0));
 END IF;
 v_bal:=v_bal+p_delta;
 UPDATE public.credit_accounts SET balance_credits=v_bal,included_balance_credits=v_included WHERE user_id=p_user;
 INSERT INTO public.credit_ledger(user_id,delta,kind,balance_after,waived_credits,generation_event_id,post_id,agent_id,stripe_event_id,actor_user_id,note)
 VALUES(p_user,p_delta,p_kind,v_bal,COALESCE(p_waived,0),p_event,p_post,p_agent,p_stripe_event,p_actor,p_note);
 RETURN v_bal;
END $$;
REVOKE ALL ON FUNCTION public.credit_apply(UUID,BIGINT,TEXT,TEXT,UUID,UUID,UUID,UUID,TEXT,BIGINT,BOOLEAN) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.subscription_renewal_atomic(
 p_subscription TEXT,p_invoice TEXT,p_period_start TIMESTAMPTZ,p_period_end TIMESTAMPTZ,p_included BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sub public.subscriptions%ROWTYPE;v_balance BIGINT;v_remaining BIGINT;v_new BIGINT;
BEGIN
 IF p_subscription IS NULL OR p_invoice IS NULL OR p_period_start IS NULL OR p_included<0 THEN RAISE EXCEPTION 'subscription_renewal_atomic: invalid arguments' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_sub FROM public.subscriptions WHERE stripe_subscription_id=p_subscription FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown subscription %',p_subscription USING ERRCODE='P0002'; END IF;
 INSERT INTO public.billing_webhook_events(event_key,user_id,result) VALUES('invoice:'||p_invoice,v_sub.user_id,'applied') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN jsonb_build_object('result','duplicate','user_id',v_sub.user_id); END IF;
 IF v_sub.current_period_start IS NOT NULL AND p_period_start<=v_sub.current_period_start THEN
  UPDATE public.billing_webhook_events SET result='stale' WHERE event_key='invoice:'||p_invoice;
  RETURN jsonb_build_object('result','stale','user_id',v_sub.user_id);
 END IF;
 INSERT INTO public.credit_accounts(user_id) VALUES(v_sub.user_id) ON CONFLICT DO NOTHING;
 SELECT balance_credits,included_balance_credits INTO v_balance,v_remaining FROM public.credit_accounts WHERE user_id=v_sub.user_id FOR UPDATE;
 IF v_remaining IS NULL THEN RAISE EXCEPTION 'INCLUDED_CREDIT_CLASSIFICATION_REQUIRED for user %',v_sub.user_id USING ERRCODE='P0001'; END IF;
 v_remaining:=LEAST(v_remaining,GREATEST(v_balance,0));v_new:=v_balance-v_remaining+p_included;
 UPDATE public.credit_accounts SET balance_credits=v_new,included_balance_credits=p_included WHERE user_id=v_sub.user_id;
 INSERT INTO public.credit_ledger(user_id,delta,kind,balance_after,stripe_event_id,note)
  VALUES(v_sub.user_id,-v_remaining,'adjustment',v_balance-v_remaining,'inv:'||p_invoice||':expire',v_sub.plan||' plan: expire remaining included credit');
 INSERT INTO public.credit_ledger(user_id,delta,kind,balance_after,stripe_event_id,note)
  VALUES(v_sub.user_id,p_included,'grant',v_new,'inv:'||p_invoice||':grant',v_sub.plan||' plan: included credit renewal');
 UPDATE public.subscriptions SET status='active',last_included_grant_credits=p_included,included_credits=p_included,current_period_start=p_period_start,current_period_end=p_period_end,updated_at=now() WHERE user_id=v_sub.user_id;
 RETURN jsonb_build_object('result','applied','user_id',v_sub.user_id,'expired',v_remaining,'granted',p_included,'balance',v_new);
END $$;
REVOKE ALL ON FUNCTION public.subscription_renewal_atomic(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.signup_credit_grant_atomic(p_user UUID,p_credits BIGINT,p_hourly_cap BIGINT,p_address_hash TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_recent BIGINT;v_prior BIGINT;
BEGIN
 IF p_user IS NULL OR p_credits<=0 OR length(COALESCE(p_address_hash,''))<32 THEN RAISE EXCEPTION 'signup_credit_grant_atomic: invalid arguments' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('personagen:signup-credit-admission'));
 IF EXISTS(SELECT 1 FROM public.signup_credit_claims WHERE user_id=p_user) THEN RETURN 'duplicate'; END IF;
 SELECT count(*) INTO v_prior FROM public.signup_credit_claims WHERE address_hash=p_address_hash AND claimed_at>=now()-interval '24 hours';
 IF v_prior>0 THEN RETURN 'address_ineligible'; END IF;
 IF p_hourly_cap>0 THEN
  SELECT count(*) INTO v_recent FROM public.signup_credit_claims WHERE claimed_at>=now()-interval '1 hour';
  IF v_recent>=p_hourly_cap THEN RETURN 'capped'; END IF;
 END IF;
 INSERT INTO public.signup_credit_claims(user_id,address_hash) VALUES(p_user,p_address_hash);
 PERFORM public.credit_apply(p_user,p_credits,'grant','welcome credits (signup)',NULL,NULL,NULL,NULL,'welcome:'||p_user,0,false);
 RETURN 'granted';
END $$;
REVOKE ALL ON FUNCTION public.signup_credit_grant_atomic(UUID,BIGINT,BIGINT,TEXT) FROM PUBLIC,anon,authenticated;

-- Account creation remains structural. No trigger can obtain a trusted client
-- address, so every monetary welcome grant must pass through the server route
-- and signup_credit_grant_atomic().
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.profiles(id,full_name) VALUES(NEW.id,NEW.raw_user_meta_data->>'full_name') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.subscriptions(user_id,plan,status) VALUES(NEW.id,'free','active') ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO public.credit_accounts(user_id) VALUES(NEW.id) ON CONFLICT(user_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;
