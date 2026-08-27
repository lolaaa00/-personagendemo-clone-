-- ═══════════════════════════════════════════════════════════════════════════
-- Per-seat monthly spend limits.
--
-- workspace_members.spend_limit_usd: NULL = unlimited (default), otherwise a
-- calendar-month USD cap on what that seat can spend generating against the
-- workspace's personas. Configured from Settings → Team by the workspace
-- owner/admin; enforced server-side in the generation routes (generate-post,
-- refine-post, generate-avatar, generate-reference-kit) via checkSpendLimit()
-- in src/lib/server/workspaces.ts, which sums the member's own
-- generation_events for the workspace's personas this month.
--
-- The check reads only rows the session can already see under existing RLS
-- (a member reads their own membership row and their own generation events),
-- so no new policies are needed here.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS spend_limit_usd NUMERIC;

ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_spend_limit_nonneg;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_spend_limit_nonneg
  CHECK (spend_limit_usd IS NULL OR spend_limit_usd >= 0);

COMMENT ON COLUMN public.workspace_members.spend_limit_usd IS
  'Calendar-month USD generation cap for this seat across the workspace''s personas. NULL = unlimited.';
