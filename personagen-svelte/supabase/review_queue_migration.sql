-- Review queue: 'rejected' post status + an append-only approve/reject log.
-- The log is the future training data for an automated QC agent — every
-- decision keeps its reason and a snapshot of what was reviewed.

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'partial', 'rejected'));

CREATE TABLE IF NOT EXISTS public.post_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  reason TEXT,
  -- Snapshot of what was reviewed (caption, media URL/type) so the decision
  -- stays meaningful even if the post row is later edited or deleted.
  content_snapshot JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_reviews_user_id ON public.post_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_post_reviews_agent_id ON public.post_reviews(agent_id);
CREATE INDEX IF NOT EXISTS idx_post_reviews_decision ON public.post_reviews(decision);

ALTER TABLE public.post_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_reviews_select_own" ON public.post_reviews
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "post_reviews_insert_own" ON public.post_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);
