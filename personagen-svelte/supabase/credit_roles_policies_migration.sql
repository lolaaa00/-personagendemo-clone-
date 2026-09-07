-- ═══════════════════════════════════════════════════════════════════════════
-- Credit system × roles: the policy set for every role the app has.
--
-- Roles (as they exist in production, 2026-09-07):
--   anon            never logged in — must see NOTHING of the money tables
--   authenticated   personal user — own wallet, own ledger, own events
--   workspace owner pays for every persona in the workspace (owner pays);
--                   the wallet is theirs, so "own" already covers it
--   admin seat      manages the workspace; sees the workspace's generation
--                   events (agent_access_role ≥ manager) — already in place
--   creator seat    generates against workspace personas and is gated on the
--                   OWNER's wallet; must be able to see that balance (read-only,
--                   balance + mode only — never the owner's ledger or Stripe id)
--   platform admin  cross-tenant operator; app-level gate (platform_admins),
--                   acts through the service role — no direct table policy
--   service_role    the server; bypasses RLS; the only writer of money rows
--
-- What this migration changes (all idempotent):
--   1. GRANT hygiene. anon had DELETE/INSERT/UPDATE/TRUNCATE on the money
--      tables (RLS denied the DML, but TRUNCATE is not governed by RLS at all).
--      anon loses everything; authenticated keeps exactly what the app uses.
--   2. is_platform_admin() answers only for the caller (or the service role),
--      so a user cannot probe whether an arbitrary id is an admin.
--   3. workspace_wallets(): a creator/admin seat can read the balance and mode
--      of each workspace it belongs to — the wallet its generations draw on.
--   4. generation_events: owners also see rows BILLED to them; a client insert
--      may only bill itself or the owner of the persona's workspace.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. GRANT hygiene ──────────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.credit_accounts       FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.credit_ledger         FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.generation_events     FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.subscriptions         FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.user_activity_events  FROM anon, PUBLIC;

REVOKE ALL ON TABLE public.credit_accounts       FROM authenticated;
GRANT  SELECT ON TABLE public.credit_accounts    TO authenticated;

REVOKE ALL ON TABLE public.credit_ledger         FROM authenticated;
GRANT  SELECT ON TABLE public.credit_ledger      TO authenticated;

-- append-only for app roles (D3): read + insert, never update/delete/truncate
REVOKE ALL ON TABLE public.generation_events     FROM authenticated;
GRANT  SELECT, INSERT ON TABLE public.generation_events TO authenticated;

REVOKE ALL ON TABLE public.subscriptions         FROM authenticated;
GRANT  SELECT ON TABLE public.subscriptions      TO authenticated;

REVOKE ALL ON TABLE public.user_activity_events  FROM authenticated;
GRANT  SELECT ON TABLE public.user_activity_events TO authenticated;

-- 2. is_platform_admin answers only about the caller ────────────────────────
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL
     AND (auth.uid() IS NULL OR p_user = auth.uid())   -- service role has no uid; users only ask about themselves
     AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user);
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated, service_role;

-- the signup trigger function is not callable by app roles (trigger-only)
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3. workspace_wallets(): the wallets a seat draws on ────────────────────────
CREATE OR REPLACE FUNCTION public.workspace_wallets()
RETURNS TABLE (
  workspace_id    UUID,
  workspace_name  TEXT,
  owner_id        UUID,
  role            TEXT,
  balance_credits BIGINT,
  billing_mode    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.name, w.owner_id,
         CASE WHEN w.owner_id = auth.uid() THEN 'owner' ELSE m.role END AS role,
         COALESCE(a.balance_credits, 0)::BIGINT,
         COALESCE(a.billing_mode, 'credits')
    FROM public.workspaces w
    LEFT JOIN public.workspace_members m ON m.workspace_id = w.id AND m.user_id = auth.uid()
    LEFT JOIN public.credit_accounts a ON a.user_id = w.owner_id
   WHERE auth.uid() IS NOT NULL
     AND (w.owner_id = auth.uid() OR m.user_id IS NOT NULL)
   ORDER BY w.name;
$$;
REVOKE ALL ON FUNCTION public.workspace_wallets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_wallets() TO authenticated, service_role;

-- 4. generation_events: owners see what is billed to them; inserts cannot bill a stranger
DROP POLICY IF EXISTS "generation_events_select_own" ON public.generation_events;
CREATE POLICY "generation_events_select_own" ON public.generation_events
  FOR SELECT USING (
    auth.uid() = user_id
    OR auth.uid() = billed_user_id
    OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager')
  );

DROP POLICY IF EXISTS "generation_events_insert_own" ON public.generation_events;
CREATE POLICY "generation_events_insert_own" ON public.generation_events
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      billed_user_id IS NULL
      OR billed_user_id = auth.uid()
      OR billed_user_id = (
        SELECT w.owner_id FROM public.agents ag
          JOIN public.workspaces w ON w.id = ag.workspace_id
         WHERE ag.id = generation_events.agent_id
      )
    )
  );
