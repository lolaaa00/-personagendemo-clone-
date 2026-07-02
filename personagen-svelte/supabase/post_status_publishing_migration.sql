-- Adds 'publishing' as a valid posts.status value. The scheduler uses it as an
-- atomic claim state: UPDATE ... SET status='publishing' WHERE id=? AND
-- status='scheduled' — whichever worker wins the row is the only one that
-- publishes, closing the double-post window between "provider accepted the
-- post" and "we recorded the result". The UI (calendar, PostModal, PostCard)
-- already styles this status; only the DB constraint was missing it.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'partial'));
