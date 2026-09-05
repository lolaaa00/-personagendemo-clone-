-- ═══════════════════════════════════════════════════════════════════════════
-- Activity log — what every user did, when, and how it went.
--
-- Pseudonymous by construction: rows carry the user's UUID and hashes, never
-- email, name, raw IP, full user agent, tokens, prompts or media. Identity is
-- resolved at render time, for platform admins, through the service role.
-- On account deletion rows survive with user_id NULL; subject_hash keeps
-- per-user aggregates stable.
--
--   user_activity_events   append-only, partitioned by month (+ a DEFAULT
--                          partition so an insert never fails for a missing
--                          month), service-role writes, users may read their own
--   user_presence          one row per user, "last seen" for the admin Live view
--   user_activity_daily    nightly roll-up for dashboards
--   admin_auth_events()    GoTrue's auth.audit_log_entries exposed to admin routes
--   anonymize_user_activity(), rollup_activity_daily(), prune_activity_partitions()
--
-- See docs/monetization/admin-activity-log-plan.md.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_activity_events (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id             UUID,                    -- no FK on purpose: rows outlive the user
  subject_hash        TEXT NOT NULL,
  actor_kind          TEXT NOT NULL DEFAULT 'user'
                        CHECK (actor_kind IN ('user', 'api_key', 'system', 'admin', 'anonymous')),
  target_user_id      UUID,
  workspace_id        UUID,
  agent_id            UUID,
  post_id             UUID,
  category            TEXT NOT NULL,
  action              TEXT NOT NULL,
  route_id            TEXT,
  method              TEXT,
  outcome             TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'error', 'denied', 'blocked')),
  status_code         SMALLINT,
  error_code          TEXT,
  duration_ms         INTEGER,
  generation_event_id UUID,
  credit_ledger_id    UUID,
  est_cost_usd        NUMERIC(10, 6),
  credits_delta       BIGINT,
  request_id          TEXT,
  session_hash        TEXT,
  ip_hash             TEXT,
  country             TEXT,
  ua_family           TEXT,
  device              TEXT,
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS idx_uae_user_time    ON public.user_activity_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_subject_time ON public.user_activity_events (subject_hash, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_time         ON public.user_activity_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_cat_time     ON public.user_activity_events (category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_action_time  ON public.user_activity_events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_bad_time     ON public.user_activity_events (occurred_at DESC) WHERE outcome <> 'ok';
CREATE INDEX IF NOT EXISTS idx_uae_agent_time   ON public.user_activity_events (agent_id, occurred_at DESC) WHERE agent_id IS NOT NULL;

ALTER TABLE public.user_activity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uae_select_own" ON public.user_activity_events;
CREATE POLICY "uae_select_own" ON public.user_activity_events
  FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.user_activity_events FROM anon, authenticated;

-- Safety net: rows for a month with no partition land here instead of failing.
CREATE TABLE IF NOT EXISTS public.user_activity_events_default
  PARTITION OF public.user_activity_events DEFAULT;

CREATE OR REPLACE FUNCTION public.ensure_activity_partition(p_month DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to   DATE := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name TEXT := 'user_activity_events_' || to_char(v_from, 'YYYY_MM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = v_name AND n.nspname = 'public') THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.user_activity_events FOR VALUES FROM (%L) TO (%L)',
      v_name, v_from, v_to
    );
  END IF;
  RETURN v_name;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_activity_partition(DATE) FROM PUBLIC, anon, authenticated;

SELECT public.ensure_activity_partition(current_date);
SELECT public.ensure_activity_partition((current_date + interval '1 month')::date);

-- ── presence ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id        UUID PRIMARY KEY,             -- no FK: cleared by anonymize, not cascaded
  last_seen_at   TIMESTAMPTZ NOT NULL,
  last_route_id  TEXT,
  last_ua_family TEXT,
  last_device    TEXT,
  last_country   TEXT,
  session_hash   TEXT,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;  -- service role only
REVOKE ALL ON public.user_presence FROM anon, authenticated;

-- ── daily roll-up ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_activity_daily (
  day             DATE NOT NULL,
  subject_hash    TEXT NOT NULL,
  user_id         UUID,
  category        TEXT NOT NULL,
  action          TEXT NOT NULL,
  events          INTEGER NOT NULL DEFAULT 0,
  errors          INTEGER NOT NULL DEFAULT 0,
  duration_ms_sum BIGINT  NOT NULL DEFAULT 0,
  est_cost_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
  credits_delta   BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject_hash, category, action)
);
ALTER TABLE public.user_activity_daily ENABLE ROW LEVEL SECURITY;  -- service role only
REVOKE ALL ON public.user_activity_daily FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.rollup_activity_daily(p_day DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INTEGER;
BEGIN
  INSERT INTO public.user_activity_daily (day, subject_hash, user_id, category, action, events, errors, duration_ms_sum, est_cost_usd, credits_delta)
  SELECT p_day, subject_hash, max(user_id::text)::uuid, category, action,
         count(*), count(*) FILTER (WHERE outcome <> 'ok'),
         COALESCE(sum(duration_ms), 0), COALESCE(sum(est_cost_usd), 0), COALESCE(sum(credits_delta), 0)
  FROM public.user_activity_events
  WHERE occurred_at >= p_day AND occurred_at < p_day + 1
  GROUP BY subject_hash, category, action
  ON CONFLICT (day, subject_hash, category, action) DO UPDATE SET
    user_id = EXCLUDED.user_id, events = EXCLUDED.events, errors = EXCLUDED.errors,
    duration_ms_sum = EXCLUDED.duration_ms_sum, est_cost_usd = EXCLUDED.est_cost_usd,
    credits_delta = EXCLUDED.credits_delta;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.rollup_activity_daily(DATE) FROM PUBLIC, anon, authenticated;

-- ── retention: drop whole partitions older than the window ──────────────────
CREATE OR REPLACE FUNCTION public.prune_activity_partitions(p_retention_days INTEGER DEFAULT 180)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD; v_dropped TEXT[] := '{}'; v_cutoff DATE := date_trunc('month', now() - (p_retention_days || ' days')::interval)::date;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'user_activity_events' AND c.relname ~ '^user_activity_events_\d{4}_\d{2}$'
  LOOP
    IF to_date(substring(r.relname from '(\d{4}_\d{2})$'), 'YYYY_MM') < v_cutoff THEN
      EXECUTE format('DROP TABLE public.%I', r.relname);
      v_dropped := v_dropped || r.relname;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_activity_partitions(INTEGER) FROM PUBLIC, anon, authenticated;

-- ── anonymise on account deletion (history survives, identity does not) ─────
CREATE OR REPLACE FUNCTION public.anonymize_user_activity(p_user UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE public.user_activity_events SET user_id = NULL WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.user_activity_events SET target_user_id = NULL WHERE target_user_id = p_user;
  UPDATE public.user_activity_daily SET user_id = NULL WHERE user_id = p_user;
  DELETE FROM public.user_presence WHERE user_id = p_user;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.anonymize_user_activity(UUID) FROM PUBLIC, anon, authenticated;

-- ── GoTrue's own audit trail, for admin routes only ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_auth_events(p_user UUID DEFAULT NULL, p_limit INTEGER DEFAULT 200)
RETURNS TABLE (occurred_at TIMESTAMPTZ, action TEXT, actor_id UUID, actor_email TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = auth, public
AS $$
  SELECT a.created_at,
         a.payload->>'action',
         NULLIF(a.payload->>'actor_id', '')::uuid,
         a.payload->>'actor_username'
  FROM auth.audit_log_entries a
  WHERE p_user IS NULL OR a.payload->>'actor_id' = p_user::text
  ORDER BY a.created_at DESC
  LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION public.admin_auth_events(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
