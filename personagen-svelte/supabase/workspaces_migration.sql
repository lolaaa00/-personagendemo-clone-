-- ============================================================
-- Workspaces & Seats migration
--
-- Introduces three tiers on top of the existing single-owner model:
--   1. Developer/agency accounts — own personas directly (unchanged).
--   2. Brand workspaces          — a named container an account can file
--                                  its personas into (agents.workspace_id).
--   3. Seats                     — teammates invited into a workspace with
--                                  a role: manager | creator | viewer.
--                                  ('owner' is implicit — the workspace's
--                                  owner_id, or the persona's own user_id —
--                                  never a workspace_members row.)
--
-- Nothing about the existing personal-account model changes: a persona
-- with workspace_id = NULL behaves exactly as it does today, visible and
-- editable only by agents.user_id. Filing a persona into a workspace is an
-- explicit, owner-only act (see the enforce_agent_update_scope trigger
-- below) — it never happens implicitly.
--
-- Role semantics (enforced by RLS + the two triggers below, not by the app
-- alone — a seat cannot escalate itself by calling the API differently):
--   viewer   — read everything about the persona and its content.
--   creator  — + generate/draft: write agent_configs, create/edit posts,
--              chat, memories. Cannot move a post to a publish-adjacent
--              status (scheduled/publishing/published/partial) and cannot
--              touch connections — that is exactly "generate & draft,
--              cannot publish".
--   manager  — + approve/publish: connections, deleting posts, seeing the
--              spend ledger and review-decision log.
--   owner    — + persona identity (rename/pause/delete), moving the
--              persona in or out of a workspace. Never delegated — only
--              the account whose user_id the persona actually belongs to.
--
-- Written idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR
-- REPLACE) so it can be replayed directly and concatenated by
-- build-bootstrap.mjs.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. workspaces
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON public.workspaces(owner_id);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- workspace_members' TABLE (not its policies — those come later, after
-- workspaces' own policies) has to exist before workspaces_select below,
-- which references it in an EXISTS clause.
CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('manager', 'creator', 'viewer')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members(user_id);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- workspaces' and workspace_members' SELECT/INSERT/UPDATE/DELETE policies
-- each need to check the OTHER table (is this user the workspace's owner? /
-- is this user a member of that workspace?). Doing that with a raw EXISTS
-- subquery directly in the policy is circular under RLS: evaluating
-- workspaces_select requires evaluating workspace_members' policies (to run
-- that subquery under RLS), which in turn requires evaluating workspaces'
-- policies again — Postgres detects the cycle and raises "infinite
-- recursion detected in policy for relation". SECURITY DEFINER functions
-- sidestep this exactly the way agent_access_role() already does below:
-- their internal query runs as the function owner, bypassing RLS on the
-- table it reads, so the cycle never forms.
CREATE OR REPLACE FUNCTION public.is_workspace_owner(p_workspace_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace_id AND w.owner_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_owner(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID, UUID) TO authenticated;

-- An invited-but-not-yet-accepted user needs to read the workspace's NAME
-- (e.g. to embed workspaces(name) off their workspace_invites row for the
-- dashboard banner) before they have a workspace_members row at all.
CREATE OR REPLACE FUNCTION public.has_pending_invite(p_workspace_id UUID, p_email TEXT)
RETURNS BOOLEAN
-- PL/pgSQL defers resolving workspace_invites until first execution. The
-- generated clean-database bootstrap creates this helper before that table;
-- LANGUAGE sql validates the body immediately and made a fresh bootstrap fail.
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.workspace_invites wi
    WHERE wi.workspace_id = p_workspace_id
      AND wi.status = 'pending'
      AND lower(wi.email) = lower(p_email)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_pending_invite(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "workspaces_select" ON public.workspaces;
CREATE POLICY "workspaces_select" ON public.workspaces
  FOR SELECT USING (
    auth.uid() = owner_id
    OR public.is_workspace_member(id, auth.uid())
    OR public.has_pending_invite(id, coalesce(auth.jwt() ->> 'email', ''))
  );

DROP POLICY IF EXISTS "workspaces_insert_own" ON public.workspaces;
CREATE POLICY "workspaces_insert_own" ON public.workspaces
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "workspaces_update_own" ON public.workspaces;
CREATE POLICY "workspaces_update_own" ON public.workspaces
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "workspaces_delete_own" ON public.workspaces;
CREATE POLICY "workspaces_delete_own" ON public.workspaces
  FOR DELETE USING (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS workspaces_updated_at ON public.workspaces;
CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 2. workspace_members (seats) — table created above; policies here.
-- ─────────────────────────────────────────────
-- Membership management (add/remove/re-role a seat) is owner-only — "delegated
-- directly from the workspace admin", singular, per the product ask. A member
-- can always see their OWN row (so the app can show them their role); seeing
-- the full roster is an owner-only view for now.
DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;
CREATE POLICY "workspace_members_select" ON public.workspace_members
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.is_workspace_owner(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "workspace_members_insert_owner" ON public.workspace_members;
CREATE POLICY "workspace_members_insert_owner" ON public.workspace_members
  FOR INSERT WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "workspace_members_update_owner" ON public.workspace_members;
CREATE POLICY "workspace_members_update_owner" ON public.workspace_members
  FOR UPDATE USING (
    public.is_workspace_owner(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "workspace_members_delete" ON public.workspace_members;
CREATE POLICY "workspace_members_delete" ON public.workspace_members
  FOR DELETE USING (
    auth.uid() = user_id -- a member can always leave
    OR public.is_workspace_owner(workspace_id, auth.uid())
  );

-- NOTE: membership rows are actually inserted by the invite-accept API route
-- using the service-role client (the accepting user cannot satisfy the
-- owner-only INSERT policy above for someone else's workspace) — this policy
-- exists so an owner can also add/adjust seats directly from the client.

-- ─────────────────────────────────────────────
-- 3. workspace_invites
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'creator', 'viewer')),
  token TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id ON public.workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON public.workspace_invites(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_token ON public.workspace_invites(token);
-- One live invite per (workspace, email) — re-inviting revokes/replaces
-- rather than accumulating duplicates. Partial: revoked/accepted rows don't
-- collide with a fresh invite to the same address later.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_pending_unique
  ON public.workspace_invites(workspace_id, lower(email)) WHERE status = 'pending';

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- An invited user finds "their" invite by matching their VERIFIED JWT email
-- (auth.jwt() ->> 'email' — the email Supabase auth actually authenticated,
-- not anything client-supplied) — this is what surfaces "you've been
-- invited" the moment a brand-new account with a blank workspace logs in.
DROP POLICY IF EXISTS "workspace_invites_select" ON public.workspace_invites;
CREATE POLICY "workspace_invites_select" ON public.workspace_invites
  FOR SELECT USING (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR public.is_workspace_owner(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "workspace_invites_insert_owner" ON public.workspace_invites;
CREATE POLICY "workspace_invites_insert_owner" ON public.workspace_invites
  FOR INSERT WITH CHECK (
    invited_by = auth.uid()
    AND public.is_workspace_owner(workspace_id, auth.uid())
  );

-- Revoking is owner-only via the client. Accepting is a privileged
-- server-side operation (service-role) — see /api/workspaces/invites/[token]/accept
-- — because it also has to insert the workspace_members row, which the
-- invited user cannot do directly.
DROP POLICY IF EXISTS "workspace_invites_update_owner" ON public.workspace_invites;
CREATE POLICY "workspace_invites_update_owner" ON public.workspace_invites
  FOR UPDATE USING (
    public.is_workspace_owner(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "workspace_invites_delete_owner" ON public.workspace_invites;
CREATE POLICY "workspace_invites_delete_owner" ON public.workspace_invites
  FOR DELETE USING (
    public.is_workspace_owner(workspace_id, auth.uid())
  );

-- ─────────────────────────────────────────────
-- 4. agents.workspace_id
-- ─────────────────────────────────────────────
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON public.agents(workspace_id);

COMMENT ON COLUMN public.agents.workspace_id IS
  'Brand workspace this persona is filed under, if any. NULL = personal persona, visible only to agents.user_id (unchanged legacy behaviour). Settable only by the persona''s own user_id — see enforce_agent_update_scope().';

-- ─────────────────────────────────────────────
-- 5. agent_access_role() — the single source of truth for "what can this
--    user do with this persona", used by every RLS policy below AND by the
--    app server (src/lib/server/workspaces.ts calls this via RPC) so the two
--    can never drift apart.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agent_access_role(p_agent_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_agent RECORD;
  v_role TEXT;
BEGIN
  IF p_agent_id IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_id, workspace_id INTO v_agent FROM public.agents WHERE id = p_agent_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_agent.user_id = p_user_id THEN
    RETURN 'owner';
  END IF;

  IF v_agent.workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_agent.workspace_id AND w.owner_id = p_user_id) THEN
    RETURN 'owner';
  END IF;

  SELECT role INTO v_role
    FROM public.workspace_members
   WHERE workspace_id = v_agent.workspace_id AND user_id = p_user_id;

  RETURN v_role; -- NULL if no membership row exists
END;
$$;

GRANT EXECUTE ON FUNCTION public.agent_access_role(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────
-- 6. agents — SELECT/UPDATE widened to workspace access; column-level
--    enforcement (identity/status/workspace/publishing-key fields stay
--    owner-only) lives in the trigger below since RLS itself can't
--    distinguish which columns an UPDATE touches. INSERT/DELETE unchanged
--    (creating and deleting a persona both stay strictly owner-only).
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "agents_select_own" ON public.agents;
CREATE POLICY "agents_select_own" ON public.agents
  FOR SELECT USING (
    auth.uid() = user_id OR public.agent_access_role(id, auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS "agents_update_own" ON public.agents;
CREATE POLICY "agents_update_own" ON public.agents
  FOR UPDATE
  USING (auth.uid() = user_id OR public.agent_access_role(id, auth.uid()) IN ('manager', 'creator'))
  WITH CHECK (auth.uid() = user_id OR public.agent_access_role(id, auth.uid()) IN ('manager', 'creator'));

CREATE OR REPLACE FUNCTION public.enforce_agent_update_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ownership never transfers via UPDATE — that is a deliberate, separate
  -- service-role operation (cross-org persona transfer), never a client PATCH.
  NEW.user_id := OLD.user_id;

  IF auth.uid() = OLD.user_id THEN
    RETURN NEW; -- the true owner: unrestricted (besides user_id above)
  END IF;

  -- A workspace 'manager' may also touch these (e.g. pausing/renaming a
  -- workspace persona is a manager action); 'creator'/'viewer' may not.
  IF public.agent_access_role(NEW.id, auth.uid()) IS DISTINCT FROM 'manager' THEN
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

DROP TRIGGER IF EXISTS trg_agents_enforce_scope ON public.agents;
CREATE TRIGGER trg_agents_enforce_scope
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_update_scope();

-- ─────────────────────────────────────────────
-- 7. agent_configs — a SHARED row per persona (not per actor): the app
--    always upserts with user_id = the persona's OWNER id (see
--    src/lib/server/db.ts mergeUpsert / the agents/config route), so every
--    workspace member converges on the same settings row instead of forking
--    one per seat. creator+ can write it (voice/schedule/reference-kit are
--    exactly what "generate & draft" needs to touch).
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "agent_configs_select_own" ON public.agent_configs;
CREATE POLICY "agent_configs_select_own" ON public.agent_configs
  FOR SELECT USING (
    auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS "agent_configs_insert_own" ON public.agent_configs;
CREATE POLICY "agent_configs_insert_own" ON public.agent_configs
  FOR INSERT WITH CHECK (
    public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator')
  );

DROP POLICY IF EXISTS "agent_configs_update_own" ON public.agent_configs;
CREATE POLICY "agent_configs_update_own" ON public.agent_configs
  FOR UPDATE
  USING (public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'))
  WITH CHECK (public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));

-- DELETE stays owner-only (unchanged) — config rows are practically only
-- ever removed via the agent's own cascade delete, not directly.

-- ─────────────────────────────────────────────
-- 8. posts — any workspace role can read; creator+ can create/edit drafts;
--    manager+ required to delete OR to move a post into a publish-adjacent
--    status (scheduled/publishing/published/partial) — enforced by the
--    trigger below, which is the actual "creator cannot publish" boundary,
--    not just a hidden button in the UI.
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "posts_select_own" ON public.posts;
CREATE POLICY "posts_select_own" ON public.posts
  FOR SELECT USING (
    auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS "posts_insert_own" ON public.posts;
CREATE POLICY "posts_insert_own" ON public.posts
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator')
  );

DROP POLICY IF EXISTS "posts_update_own" ON public.posts;
CREATE POLICY "posts_update_own" ON public.posts
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator')
  )
  WITH CHECK (
    public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator')
  );

DROP POLICY IF EXISTS "posts_delete_own" ON public.posts;
CREATE POLICY "posts_delete_own" ON public.posts
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager')
  );

CREATE OR REPLACE FUNCTION public.enforce_post_status_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_old_status TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id; -- creator attribution is immutable
    v_old_status := OLD.status;
  ELSE
    v_old_status := NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM v_old_status
     AND NEW.status IN ('scheduled', 'publishing', 'published', 'partial')
  THEN
    -- auth.uid() is NULL for service-role callers (the scheduler, autopilot)
    -- -> agent_access_role returns NULL there, never 'creator', so the
    -- background publishing pipeline is entirely unaffected by this guard.
    v_role := public.agent_access_role(NEW.agent_id, auth.uid());
    IF v_role = 'creator' THEN
      RAISE EXCEPTION 'Approving or publishing a post requires manager access on this persona.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_enforce_scope ON public.posts;
CREATE TRIGGER trg_posts_enforce_scope
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_status_scope();

-- ─────────────────────────────────────────────
-- 9. connections — visible to any workspace role (the composer needs to
--    show what's connected), but connecting/disconnecting a real social
--    account is manager+ only, same tier as approving a publish.
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "connections_select_own" ON public.connections;
CREATE POLICY "connections_select_own" ON public.connections
  FOR SELECT USING (
    auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS "connections_insert_own" ON public.connections;
CREATE POLICY "connections_insert_own" ON public.connections
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "connections_update_own" ON public.connections;
CREATE POLICY "connections_update_own" ON public.connections
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager')
  )
  WITH CHECK (public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager'));

DROP POLICY IF EXISTS "connections_delete_own" ON public.connections;
CREATE POLICY "connections_delete_own" ON public.connections
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager')
  );

-- ─────────────────────────────────────────────
-- 10. chat_sessions / chat_messages / agent_memories — creator+ read-write,
--     matching "generate & draft" (talking to a persona, leaving it notes).
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "chat_sessions_select_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_select_own" ON public.chat_sessions
  FOR SELECT USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "chat_sessions_insert_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_insert_own" ON public.chat_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));
DROP POLICY IF EXISTS "chat_sessions_update_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_update_own" ON public.chat_sessions
  FOR UPDATE
  USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'))
  WITH CHECK (public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));
DROP POLICY IF EXISTS "chat_sessions_delete_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_delete_own" ON public.chat_sessions
  FOR DELETE USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));

DROP POLICY IF EXISTS "chat_messages_select_own" ON public.chat_messages;
CREATE POLICY "chat_messages_select_own" ON public.chat_messages
  FOR SELECT USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "chat_messages_insert_own" ON public.chat_messages;
CREATE POLICY "chat_messages_insert_own" ON public.chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));
DROP POLICY IF EXISTS "chat_messages_delete_own" ON public.chat_messages;
CREATE POLICY "chat_messages_delete_own" ON public.chat_messages
  FOR DELETE USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));

DROP POLICY IF EXISTS "agent_memories_select_own" ON public.agent_memories;
CREATE POLICY "agent_memories_select_own" ON public.agent_memories
  FOR SELECT USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "agent_memories_insert_own" ON public.agent_memories;
CREATE POLICY "agent_memories_insert_own" ON public.agent_memories
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));
DROP POLICY IF EXISTS "agent_memories_update_own" ON public.agent_memories;
CREATE POLICY "agent_memories_update_own" ON public.agent_memories
  FOR UPDATE
  USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'))
  WITH CHECK (public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));
DROP POLICY IF EXISTS "agent_memories_delete_own" ON public.agent_memories;
CREATE POLICY "agent_memories_delete_own" ON public.agent_memories
  FOR DELETE USING (auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator'));

-- ─────────────────────────────────────────────
-- 11. generation_events — spend is sensitive: a seat sees their OWN
--     generation costs, but the full per-persona ledger is manager+ only.
--     Also closes the sharpest edge of the client-forgeable-ledger gap
--     found in the liability review: a negative est_cost could zero out
--     the budget cap entirely. INSERT policy is intentionally left as-is
--     this pass (still authenticated-own-row) — tightening that further is
--     separate, dedicated work, not bundled into the workspace rollout.
-- ─────────────────────────────────────────────
ALTER TABLE public.generation_events
  DROP CONSTRAINT IF EXISTS generation_events_est_cost_nonnegative;
ALTER TABLE public.generation_events
  ADD CONSTRAINT generation_events_est_cost_nonnegative CHECK (est_cost >= 0);

DROP POLICY IF EXISTS "generation_events_select_own" ON public.generation_events;
CREATE POLICY "generation_events_select_own" ON public.generation_events
  FOR SELECT USING (
    auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager')
  );

-- ─────────────────────────────────────────────
-- 12. post_reviews — the approve/reject audit trail is manager+ visibility;
--     creator+ can still write to it (logging their own attempt is
--     harmless — the posts-table trigger above is the real enforcement
--     point for what a creator's "approve" can actually achieve).
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "post_reviews_select_own" ON public.post_reviews;
CREATE POLICY "post_reviews_select_own" ON public.post_reviews
  FOR SELECT USING (
    auth.uid() = user_id OR public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "post_reviews_insert_own" ON public.post_reviews;
CREATE POLICY "post_reviews_insert_own" ON public.post_reviews
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.agent_access_role(agent_id, auth.uid()) IN ('owner', 'manager', 'creator')
  );

-- ─────────────────────────────────────────────
-- 13. brand_briefs — read-only extension: a workspace member generating for
--     a persona pinned to brief X can read brief X (so brand voice doesn't
--     silently degrade to the newest-brief fallback for a seat). Writing a
--     brief stays owner-only, unchanged.
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "brand_briefs_select_own" ON public.brand_briefs;
CREATE POLICY "brand_briefs_select_own" ON public.brand_briefs
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
        FROM public.agent_configs ac
       WHERE ac.brand_brief_id = brand_briefs.id
         AND public.agent_access_role(ac.agent_id, auth.uid()) IS NOT NULL
    )
  );
