-- Adds 'generating' as a valid posts.status value. The async generate-post
-- endpoint creates the post row UP FRONT in this status, responds 202, and
-- finishes the fal image/video generation (30s–5min) in a detached task —
-- keeping the HTTP request well under the reverse proxy's timeout. The task
-- flips the row to 'draft'/'scheduled' on success or 'failed' (with
-- content.error) on failure; the scheduler's orphan sweep fails rows stranded
-- in 'generating' by a server restart. Until this migration is applied the
-- endpoint detects the CHECK rejection and falls back to fully-synchronous
-- generation.
-- Constraint is the full current superset (incl. review queue's 'rejected')
-- so re-running this file never narrows what earlier migrations allowed.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'generating', 'publishing', 'published', 'failed', 'partial', 'rejected'));
