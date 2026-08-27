-- ═══════════════════════════════════════════════════════════════════════════
-- Trash & restore for posts.
--
-- Deleting a post used to be an unrecoverable DELETE. It now stamps
-- posts.deleted_at; the row (and every generation_events / post_reviews FK
-- that points at it) survives, so a restore is lossless. An archive table was
-- the alternative and was rejected for exactly that reason: those FKs are
-- ON DELETE SET NULL, so moving the row would sever the generation lineage
-- permanently the moment someone hit the trash can.
--
-- READ PATHS MUST FILTER. Every SELECT that feeds a list, the scheduler, or
-- analytics now carries .is('deleted_at', null). A missed filter is not
-- cosmetic — it would let the scheduler publish a post the user deleted.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index: the trash view is a tiny slice of the table, and every other
-- query is `deleted_at IS NULL`, which this also serves as a filter predicate.
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at
  ON public.posts(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- The hot path is "live posts for an agent, newest first". Partial-indexing on
-- the NULL side keeps the scheduler and feed scans off the trashed rows.
CREATE INDEX IF NOT EXISTS idx_posts_agent_live
  ON public.posts(agent_id, scheduled_date)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.posts.deleted_at IS
  'Soft delete. NULL = live. Set = in Trash, restorable, purged after 30 days.';
