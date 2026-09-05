-- ═══════════════════════════════════════════════════════════════════════════
-- Platform admins — the operator identity that may act across tenants.
--
-- Distinct from workspace owners/admin seats (workspace_admin_role_migration):
-- those manage ONE workspace. A platform admin grants credits, comps accounts,
-- reads every user's activity, and manages the model registry. The table has
-- no RLS policies (service-role only); the app asks "is this user an admin?"
-- through is_platform_admin(), which is the only thing granted to authenticated.
--
-- Bootstrap: PLATFORM_ADMIN_EMAILS in the app env also confers admin, so the
-- first operator exists before any row does. Rows are the durable record.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user);
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;
