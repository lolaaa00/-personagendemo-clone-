-- ═══════════════════════════════════════════════════════════════════════════
-- Migration ledger.
--
-- Every migration file in supabase/ (in the ORDER declared by
-- build-bootstrap.mjs) is applied through scripts/apply-migration.mjs, which
-- records the file's name and sha256 here inside the same transaction. The
-- runner refuses to re-apply a file whose checksum has changed (write a NEW
-- migration instead) and skips one whose checksum matches (idempotent).
--
-- /api/health reports how many ORDER files are not yet recorded, and
-- deploy.ps1 aborts on a pending migration, so schema and code cannot drift
-- apart silently. Service-role only: no RLS policies on purpose.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  name        TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT,
  -- 'applied' = the runner executed the file; 'recorded' = the file was already
  -- live before the ledger existed and was stamped with --record-existing.
  mode        TEXT NOT NULL DEFAULT 'applied' CHECK (mode IN ('applied', 'recorded'))
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_migrations FROM anon, authenticated;
