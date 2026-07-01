-- Adds a distinct 'partial' status for posts where SOME platforms published
-- successfully and others failed. Previously any success silently marked the
-- whole post 'published', hiding per-platform failures already recorded in
-- publication_results.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'partial'));
