-- ============================================================
-- User Voice migration — feature requests + votes
--
-- Backs the Docs page's "User Voice" tab:
--   1. feature_requests       — one row per request, with a workflow status
--                               that drives the Kanban lanes
--   2. feature_request_votes  — one row per (user, request), value ±1; the
--                               PK makes double-voting structurally impossible
--
-- RLS is deliberately DIFFERENT from the rest of the schema: requests are a
-- SHARED board — every authenticated user sees every request (that is the
-- product: users voting on each other's ideas). Writes stay owner-scoped.
-- Status changes are team-managed (SQL / Studio), not exposed to clients.
--
-- Written idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS) so it can be
-- replayed directly AND concatenated by build-bootstrap.mjs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  detail TEXT NOT NULL DEFAULT '' CHECK (char_length(detail) <= 2000),
  status TEXT NOT NULL DEFAULT 'under-review'
    CHECK (status IN ('under-review', 'planned', 'in-progress', 'shipped', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON public.feature_requests(status);
CREATE INDEX IF NOT EXISTS idx_feature_requests_user ON public.feature_requests(user_id);

ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_requests_select_all" ON public.feature_requests;
CREATE POLICY "feature_requests_select_all" ON public.feature_requests
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "feature_requests_insert_own" ON public.feature_requests;
CREATE POLICY "feature_requests_insert_own" ON public.feature_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Owners may edit/delete their own request (title/detail housekeeping only —
-- status is guarded by the trigger below, not by policy gymnastics).
DROP POLICY IF EXISTS "feature_requests_update_own" ON public.feature_requests;
CREATE POLICY "feature_requests_update_own" ON public.feature_requests
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "feature_requests_delete_own" ON public.feature_requests;
CREATE POLICY "feature_requests_delete_own" ON public.feature_requests
  FOR DELETE USING (auth.uid() = user_id);

-- Status is team-managed: a client (authenticated-role) update keeps the old
-- status; service-role / SQL editor changes pass through untouched.
CREATE OR REPLACE FUNCTION public.feature_requests_guard_status()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status := OLD.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_feature_requests_guard_status ON public.feature_requests;
CREATE TRIGGER trg_feature_requests_guard_status
  BEFORE UPDATE ON public.feature_requests
  FOR EACH ROW EXECUTE FUNCTION public.feature_requests_guard_status();

-- ─────────────────────────────────────────────
-- Votes: one row per (request, user); value is ±1. Removing a vote deletes
-- the row, so "score" is always just SUM(value).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_request_votes (
  request_id UUID NOT NULL REFERENCES public.feature_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_request_votes_request
  ON public.feature_request_votes(request_id);

ALTER TABLE public.feature_request_votes ENABLE ROW LEVEL SECURITY;

-- Votes are readable by everyone (scores are public); each user writes only
-- their own vote row.
DROP POLICY IF EXISTS "feature_request_votes_select_all" ON public.feature_request_votes;
CREATE POLICY "feature_request_votes_select_all" ON public.feature_request_votes
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "feature_request_votes_upsert_own" ON public.feature_request_votes;
CREATE POLICY "feature_request_votes_upsert_own" ON public.feature_request_votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "feature_request_votes_update_own" ON public.feature_request_votes;
CREATE POLICY "feature_request_votes_update_own" ON public.feature_request_votes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "feature_request_votes_delete_own" ON public.feature_request_votes;
CREATE POLICY "feature_request_votes_delete_own" ON public.feature_request_votes
  FOR DELETE USING (auth.uid() = user_id);
