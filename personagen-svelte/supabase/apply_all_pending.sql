-- ═══════════════════════════════════════════════════════════════════════════
-- PersonaGen — apply_all_pending.sql
--
-- One-shot consolidation of every migration the CURRENT code paths require.
-- Contains (in dependency-safe order):
--   1. zernio_profile_routing_migration.sql      — agents.zernio_profile_id
--   2. post_status_partial_migration.sql          ┐ posts_status_check — applied
--   3. post_status_publishing_migration.sql       │ once below as the final
--   4. post_status_generating_migration.sql       ├ superset + post_reviews
--   5. review_queue_migration.sql                 ┘ table
--   6. connections_platforms_expand_migration.sql — wide platform CHECK
--   7. scheduler_leases_migration.sql             — multi-host scheduler lease
--
-- SAFE TO RE-RUN: every statement is idempotent (IF NOT EXISTS / DROP IF
-- EXISTS / CREATE OR REPLACE). The four posts_status_check migrations are
-- collapsed into a single DROP+ADD of the final constraint (their union),
-- because replaying them sequentially would transiently narrow the constraint.
-- The original per-feature migration files are unchanged; this file only
-- concatenates their effects.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. Zernio profile routing (zernio_profile_routing_migration.sql) ───────
-- ONE Zernio account, ONE Zernio *profile* per persona. Null = "provision on
-- first connect". connections.provider CHECK intentionally left permissive
-- (legacy composio/blotato rows must not fail the migration).

ALTER TABLE public.agents
	ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT;

COMMENT ON COLUMN public.agents.zernio_profile_id IS
	'Zernio profile _id that isolates this persona''s connected social accounts under the single shared Zernio key. Provisioned on first connect (list-or-create by persona name).';


-- ─── 2–5a. posts.status constraint (partial + publishing + generating +
--           review_queue) ─────────────────────────────────────────────────────
-- Final superset: 'generating' is the async generate-post up-front state (a
-- detached task finishes the row), 'publishing' is the scheduler's atomic-claim
-- state, 'partial' = some platforms published/some failed, 'rejected' = review
-- queue.

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
	CHECK (status IN ('draft', 'scheduled', 'generating', 'publishing', 'published', 'failed', 'partial', 'rejected'));


-- ─── 5b. Review queue log (review_queue_migration.sql) ──────────────────────
-- Append-only approve/reject decisions with a content snapshot — future
-- training data for an automated QC agent.

CREATE TABLE IF NOT EXISTS public.post_reviews (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
	agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
	decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
	reason TEXT,
	content_snapshot JSONB DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_reviews_user_id ON public.post_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_post_reviews_agent_id ON public.post_reviews(agent_id);
CREATE INDEX IF NOT EXISTS idx_post_reviews_decision ON public.post_reviews(decision);

ALTER TABLE public.post_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_reviews_select_own" ON public.post_reviews;
CREATE POLICY "post_reviews_select_own" ON public.post_reviews
	FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "post_reviews_insert_own" ON public.post_reviews;
CREATE POLICY "post_reviews_insert_own" ON public.post_reviews
	FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ─── 6. Wide platform CHECK (connections_platforms_expand_migration.sql) ────
-- Every platform PersonaGen can connect + publish through Zernio.

ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_platform_check;

ALTER TABLE public.connections
	ADD CONSTRAINT connections_platform_check
	CHECK (platform IN (
		'instagram', 'tiktok', 'youtube', 'facebook', 'x', 'threads',
		'linkedin', 'bluesky', 'pinterest', 'reddit', 'googlebusiness', 'telegram', 'snapchat'
	));


-- ─── 7. Scheduler leader lease (scheduler_leases_migration.sql) ─────────────
-- Multi-host-safe replacement for the tmpdir file lock. One atomic upsert per
-- tick decides the leader; without this the scheduler falls back to the
-- single-host file lock (logged warning).

CREATE TABLE IF NOT EXISTS public.scheduler_leases (
	name TEXT PRIMARY KEY,
	holder_id TEXT NOT NULL,
	expires_at TIMESTAMPTZ NOT NULL
);

-- Service-role only (background jobs). RLS with no policies blocks anon/authed
-- clients entirely; the service key bypasses RLS.
ALTER TABLE public.scheduler_leases ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.acquire_scheduler_lease(
	p_name TEXT,
	p_holder TEXT,
	p_ttl_ms BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	INSERT INTO public.scheduler_leases AS l (name, holder_id, expires_at)
	VALUES (p_name, p_holder, now() + make_interval(secs => p_ttl_ms / 1000.0))
	ON CONFLICT (name) DO UPDATE
		SET holder_id = EXCLUDED.holder_id,
		    expires_at = EXCLUDED.expires_at
		WHERE l.holder_id = EXCLUDED.holder_id OR l.expires_at < now();
	RETURN FOUND;
END;
$$;
