-- ═══════════════════════════════════════════════════════════════════════════
-- Workspace 'admin' role tier
--
-- Adds a fourth seat rank between manager and owner:
--   owner > admin > manager > creator > viewer
--
-- Manager already covers every PERSONA-level action (approve/publish,
-- connections, delete posts, spend visibility, and — since the original
-- migration — renaming/pausing/moving a persona). What manager cannot do is
-- touch the WORKSPACE itself: invite/re-role/remove other seats. That gap is
-- exactly what 'admin' closes — it's for a developer/agency collaborator
-- (e.g. Monarch Stack operating inside a client's workspace) who needs de
-- facto full operational control without holding account-level identity
-- ownership. Two things stay reserved for the true owner, never delegable
-- even to admin: renaming/deleting the workspace container itself, and
-- deleting a persona outright (DELETE on agents was never touched by any of
-- this — it was always strictly owner-only and still is).
--
-- Introduces role_rank(): every "X-or-above" check across the workspace
-- feature was a hand-maintained IN (...) list, which meant adding this one
-- tier required touching a dozen policies (see below) just to keep them from
-- silently excluding it. A rank comparison means the next tier only needs a
-- line in role_rank() and CHECK constraints — not an audit of every policy
-- in workspaces_migration.sql.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.role_rank(p_role TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'manager' THEN 2
    WHEN 'creator' THEN 1
    WHEN 'viewer' THEN 0
    ELSE -1 -- NULL or unrecognized never satisfies any "X-or-above" check
  END;
$$;

GRANT EXECUTE ON FUNCTION public.role_rank(TEXT) TO authenticated;

-- ── Allow 'admin' as a stored role value ────────────────────────────────
ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('admin', 'manager', 'creator', 'viewer'));

ALTER TABLE public.workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_role_check;
ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_role_check
  CHECK (role IN ('admin', 'manager', 'creator', 'viewer'));

-- ── Workspace-level role lookup ──────────────────────────────────────────
-- agent_access_role() answers "what can this user do with THIS PERSONA" —
-- membership/invite management isn't about a persona, it's about the
-- workspace itself, so it needs its own SECURITY DEFINER lookup (same
-- recursion-avoidance reason as is_workspace_owner/is_workspace_member).
CREATE OR REPLACE FUNCTION public.workspace_role(p_workspace_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_owner_id UUID;
  v_role TEXT;
BEGIN
  IF p_workspace_id IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.workspaces WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_owner_id = p_user_id THEN
    RETURN 'owner';
  END IF;

  SELECT role INTO v_role FROM public.workspace_members
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  RETURN v_role; -- NULL if no membership row exists
END;
$$;

GRANT EXECUTE ON FUNCTION public.workspace_role(UUID, UUID) TO authenticated;

-- ── workspace_members: admin+ can see the full roster and manage seats;
--    a member can always see/remove their own row (unchanged). Owner is
--    still implicit (workspaces.owner_id) — never a row here, so an admin
--    managing this table can never touch or demote the true owner.
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;
CREATE POLICY "workspace_members_select" ON public.workspace_members
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

DROP POLICY IF EXISTS "workspace_members_insert_owner" ON public.workspace_members;
CREATE POLICY "workspace_members_insert_owner" ON public.workspace_members
  FOR INSERT WITH CHECK (
    public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

DROP POLICY IF EXISTS "workspace_members_update_owner" ON public.workspace_members;
CREATE POLICY "workspace_members_update_owner" ON public.workspace_members
  FOR UPDATE USING (
    public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

DROP POLICY IF EXISTS "workspace_members_delete" ON public.workspace_members;
CREATE POLICY "workspace_members_delete" ON public.workspace_members
  FOR DELETE USING (
    auth.uid() = user_id -- a member can always leave
    OR public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

-- ── workspace_invites: same admin+ widening ──────────────────────────────
DROP POLICY IF EXISTS "workspace_invites_select" ON public.workspace_invites;
CREATE POLICY "workspace_invites_select" ON public.workspace_invites
  FOR SELECT USING (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

DROP POLICY IF EXISTS "workspace_invites_insert_owner" ON public.workspace_invites;
CREATE POLICY "workspace_invites_insert_owner" ON public.workspace_invites
  FOR INSERT WITH CHECK (
    invited_by = auth.uid()
    AND public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

DROP POLICY IF EXISTS "workspace_invites_update_owner" ON public.workspace_invites;
CREATE POLICY "workspace_invites_update_owner" ON public.workspace_invites
  FOR UPDATE USING (
    public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

DROP POLICY IF EXISTS "workspace_invites_delete_owner" ON public.workspace_invites;
CREATE POLICY "workspace_invites_delete_owner" ON public.workspace_invites
  FOR DELETE USING (
    public.role_rank(public.workspace_role(workspace_id, auth.uid())) >= public.role_rank('admin')
  );

-- workspaces_select/update_own/delete_own are untouched: an admin is still a
-- workspace_members row, so is_workspace_member() already covers admin for
-- reading the workspace; renaming/deleting the workspace container itself
-- stays owner-only, on purpose (see header).

-- ── Every agent-scoped "creator-or-above" / "manager-or-above" check:
--    switch from a hand-maintained IN (...) list to role_rank(), so 'admin'
--    (rank 3) is included everywhere 'manager' (rank 2) already was, and any
--    future tier only needs a role_rank() edit, not a policy audit.
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "agents_update_own" ON public.agents;
CREATE POLICY "agents_update_own" ON public.agents
  FOR UPDATE
  USING (auth.uid() = user_id OR public.role_rank(public.agent_access_role(id, auth.uid())) >= public.role_rank('creator'))
  WITH CHECK (auth.uid() = user_id OR public.role_rank(public.agent_access_role(id, auth.uid())) >= public.role_rank('creator'));

CREATE OR REPLACE FUNCTION public.enforce_agent_update_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := OLD.user_id;

  IF auth.uid() = OLD.user_id THEN
    RETURN NEW; -- the true owner: unrestricted (besides user_id above)
  END IF;

  -- manager-or-above (i.e. manager or admin) may touch identity/status/
  -- workspace/publishing-key fields; creator/viewer may not.
  IF public.role_rank(public.agent_access_role(NEW.id, auth.uid())) < public.role_rank('manager') THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.handle IS DISTINCT FROM OLD.handle
      OR NEW.niche IS DISTINCT FROM OLD.niche
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.gradient IS DISTINCT FROM OLD.gradient
      OR NEW.initial IS DISTINCT FROM OLD.initial
      OR NEW.supervisor_agent_id IS DISTINCT FROM OLD.supervisor_agent_id
      OR NEW.managed_by_overseer IS DISTINCT FROM OLD.managed_by_overseer
      OR NEW.runtime_owner IS DISTINCT FROM OLD.runtime_owner
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.zernio_key_id IS DISTINCT FROM OLD.zernio_key_id
      OR NEW.zernio_profile_id IS DISTINCT FROM OLD.zernio_profile_id
      OR NEW.group_id IS DISTINCT FROM OLD.group_id
    THEN
      RAISE EXCEPTION 'Only the persona owner or a workspace manager can change identity, status, group, or publishing settings.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "agent_configs_insert_own" ON public.agent_configs;
CREATE POLICY "agent_configs_insert_own" ON public.agent_configs
  FOR INSERT WITH CHECK (
    public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator')
  );

DROP POLICY IF EXISTS "agent_configs_update_own" ON public.agent_configs;
CREATE POLICY "agent_configs_update_own" ON public.agent_configs
  FOR UPDATE
  USING (public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'))
  WITH CHECK (public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));

DROP POLICY IF EXISTS "posts_insert_own" ON public.posts;
CREATE POLICY "posts_insert_own" ON public.posts
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator')
  );

DROP POLICY IF EXISTS "posts_update_own" ON public.posts;
CREATE POLICY "posts_update_own" ON public.posts
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator')
  )
  WITH CHECK (
    public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator')
  );

DROP POLICY IF EXISTS "posts_delete_own" ON public.posts;
CREATE POLICY "posts_delete_own" ON public.posts
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager')
  );

DROP POLICY IF EXISTS "connections_insert_own" ON public.connections;
CREATE POLICY "connections_insert_own" ON public.connections
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager')
  );

DROP POLICY IF EXISTS "connections_update_own" ON public.connections;
CREATE POLICY "connections_update_own" ON public.connections
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager')
  )
  WITH CHECK (public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager'));

DROP POLICY IF EXISTS "connections_delete_own" ON public.connections;
CREATE POLICY "connections_delete_own" ON public.connections
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager')
  );

DROP POLICY IF EXISTS "chat_sessions_insert_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_insert_own" ON public.chat_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));
DROP POLICY IF EXISTS "chat_sessions_update_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_update_own" ON public.chat_sessions
  FOR UPDATE
  USING (auth.uid() = user_id OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'))
  WITH CHECK (public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));
DROP POLICY IF EXISTS "chat_sessions_delete_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_delete_own" ON public.chat_sessions
  FOR DELETE USING (auth.uid() = user_id OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));

DROP POLICY IF EXISTS "chat_messages_insert_own" ON public.chat_messages;
CREATE POLICY "chat_messages_insert_own" ON public.chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));
DROP POLICY IF EXISTS "chat_messages_delete_own" ON public.chat_messages;
CREATE POLICY "chat_messages_delete_own" ON public.chat_messages
  FOR DELETE USING (auth.uid() = user_id OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));

DROP POLICY IF EXISTS "agent_memories_insert_own" ON public.agent_memories;
CREATE POLICY "agent_memories_insert_own" ON public.agent_memories
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));
DROP POLICY IF EXISTS "agent_memories_update_own" ON public.agent_memories;
CREATE POLICY "agent_memories_update_own" ON public.agent_memories
  FOR UPDATE
  USING (auth.uid() = user_id OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'))
  WITH CHECK (public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));
DROP POLICY IF EXISTS "agent_memories_delete_own" ON public.agent_memories;
CREATE POLICY "agent_memories_delete_own" ON public.agent_memories
  FOR DELETE USING (auth.uid() = user_id OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator'));

DROP POLICY IF EXISTS "generation_events_select_own" ON public.generation_events;
CREATE POLICY "generation_events_select_own" ON public.generation_events
  FOR SELECT USING (
    auth.uid() = user_id OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager')
  );

DROP POLICY IF EXISTS "post_reviews_select_own" ON public.post_reviews;
CREATE POLICY "post_reviews_select_own" ON public.post_reviews
  FOR SELECT USING (
    auth.uid() = user_id OR public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('manager')
  );

DROP POLICY IF EXISTS "post_reviews_insert_own" ON public.post_reviews;
CREATE POLICY "post_reviews_insert_own" ON public.post_reviews
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.role_rank(public.agent_access_role(agent_id, auth.uid())) >= public.role_rank('creator')
  );
