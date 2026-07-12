-- ═══════════════════════════════════════════════════════════════════════════
-- PersonaGen — scheduler_indexes_and_provider_default_migration.sql
--
-- Closes three gaps between the live schema and the code as of HEAD. Every
-- statement is idempotent and ADDITIVE-ONLY: no column/table/row is dropped,
-- no existing data is rewritten, and re-running the file is a no-op.
--
--   1. connections.provider DEFAULT is still 'composio' — a provider that no
--      longer exists in the codebase. Retarget the default to 'zernio'.
--   2. posts.status has no index. The scheduler sweeps it every 60s. Add
--      partial indexes for each hot predicate.
--   3. posts_status_check may predate the 'generating' status the async
--      generate-post endpoint writes. Re-assert the full superset.
--
-- LOCKING NOTE: the CREATE INDEX statements below are NOT `CONCURRENTLY`,
-- because CONCURRENTLY cannot run inside a transaction block (the Supabase SQL
-- editor wraps the script in one). They take a SHARE lock on public.posts —
-- reads continue, writes to posts block for the duration of the build. On a
-- posts table of this size that is sub-second. If posts has grown large, run
-- the five CREATE INDEX statements one at a time with CONCURRENTLY added,
-- outside a transaction, instead.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. connections.provider default: 'composio' → 'zernio' ─────────────────
-- connections_provider_metadata_migration.sql created the column with
-- `DEFAULT 'composio'`. Composio has since been removed from the codebase —
-- the publisher only routes provider='zernio'. Any INSERT that omits provider
-- therefore silently produces an unroutable connection row. Retargeting the
-- default fixes new writes.
--
-- The ADD COLUMN IF NOT EXISTS is a no-op guard so the SET DEFAULT below can
-- never fail on a DB where the metadata migration was never applied.
--
-- We deliberately do NOT rewrite existing rows: legacy provider='composio' /
-- 'blotato' rows keep provider-specific provider_account_ids, so relabelling
-- them 'zernio' would make them *misroute* rather than merely fail. They need
-- a reconnect. Likewise the CHECK constraint is left permissive (see the note
-- at the bottom of zernio_profile_routing_migration.sql) — narrowing it would
-- fail validation against those very rows.

ALTER TABLE public.connections
	ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE public.connections
	ALTER COLUMN provider SET DEFAULT 'zernio';

COMMENT ON COLUMN public.connections.provider IS
	'Posting provider that owns this connection. Only ''zernio'' is routable by the current publisher; ''composio''/''blotato'' rows are legacy and require a reconnect.';


-- ─── 2. posts.status indexes for the scheduler's hot sweeps ─────────────────
-- src/lib/server/scheduler.ts runs, on every 60s tick:
--   a) orphan-claim sweep   WHERE status = 'publishing'
--   b) orphan-generate sweep WHERE status = 'generating' AND created_at < cutoff
--   c) due sweep            WHERE status = 'scheduled'  AND scheduled_date <= X
--   d) analytics sweep      WHERE status = 'published'  AND external_id IS NOT NULL
--                                                       AND published_at >= X
-- migration.sql only indexes (user_id), (agent_id), (scheduled_date) — so all
-- four are sequential scans that grow linearly with the posts table.
--
-- (a)–(d) get PARTIAL indexes: each transient status is a tiny slice of the
-- table, so the index stays small (and, unlike a plain btree on status, does
-- not have to carry the huge 'draft'/'published' majority).

-- (a) Orphan-claim sweep. Claim rows are transient — this index is near-empty
--     in steady state and turns the sweep into an index-only scan.
CREATE INDEX IF NOT EXISTS idx_posts_status_publishing
	ON public.posts (id)
	WHERE status = 'publishing';

-- (b) Orphan-generation sweep. created_at leads so the `< cutoff` bound is
--     satisfied by the index, not a filter.
CREATE INDEX IF NOT EXISTS idx_posts_status_generating
	ON public.posts (created_at)
	WHERE status = 'generating';

-- (c) Due sweep. scheduled_date leads so `<= upperBound` is a range scan.
CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled_date
	ON public.posts (scheduled_date)
	WHERE status = 'scheduled';

-- (d) Analytics sweep (7-day window, externally-published rows only).
CREATE INDEX IF NOT EXISTS idx_posts_published_at_synced
	ON public.posts (published_at)
	WHERE status = 'published' AND external_id IS NOT NULL;

-- (e) Catch-all for the non-scheduler status filters (review queue, feed and
--     calendar list endpoints filter posts by status within a user's rows).
CREATE INDEX IF NOT EXISTS idx_posts_user_id_status
	ON public.posts (user_id, status);


-- ─── 3. posts_status_check — re-assert the full status superset ─────────────
-- The union of every status any migration has ever allowed:
--   'draft', 'scheduled'                       migration.sql (base)
--   'published', 'failed'                      migration.sql (base)
--   'partial'                                  post_status_partial_migration.sql
--   'publishing'                               post_status_publishing_migration.sql
--   'rejected'                                 review_queue_migration.sql
--   'generating'                               post_status_generating_migration.sql
-- Identical to the constraint in post_status_generating_migration.sql and
-- apply_all_pending.sql, restated here so this file is self-sufficient against
-- a production DB where those were never applied.
--
-- 'generating' is load-bearing: src/routes/api/agent/[agentId]/generate-post
-- creates the post row up front in status 'generating' and returns 202, and
-- scheduler.ts sweeps rows stranded in it. Without this status the endpoint
-- catches the CHECK violation and degrades to fully-synchronous generation.
--
-- NON-DESTRUCTIVE: this constraint is a strict SUPERSET of every earlier
-- version, so DROP+ADD can never reject an existing row — it only widens what
-- is permitted. The DROP is guarded with IF EXISTS; the pair is safe to re-run.

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
	CHECK (status IN (
		'draft', 'generating', 'scheduled', 'publishing',
		'published', 'partial', 'failed', 'rejected'
	));
