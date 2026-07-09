-- Scheduler leader lease: multi-host-safe replacement for the tmpdir file lock.
--
-- Every app instance (any host) calls acquire_scheduler_lease() each tick; only
-- the holder whose row it wins does publishing/autopilot work. The lease is a
-- single atomic INSERT ... ON CONFLICT DO UPDATE, so two instances racing the
-- same tick can never both win — the row-level lock serializes them and the
-- conditional UPDATE (expired OR already mine) decides the winner.
--
-- Safe/idempotent: re-running this file is a no-op.

CREATE TABLE IF NOT EXISTS public.scheduler_leases (
	name TEXT PRIMARY KEY,
	holder_id TEXT NOT NULL,
	expires_at TIMESTAMPTZ NOT NULL
);

-- Service-role only (background jobs). RLS with no policies blocks anon/authed
-- clients entirely; the service key bypasses RLS.
ALTER TABLE public.scheduler_leases ENABLE ROW LEVEL SECURITY;

-- Atomic acquire-or-renew. Returns TRUE iff the caller now holds the lease:
--   - no row yet            -> insert, caller wins
--   - row expired           -> steal, caller wins
--   - row held by caller    -> renew (refresh expires_at), caller wins
--   - row held by other,
--     still fresh           -> no-op, returns FALSE
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
