-- ============================================================
-- Favorites + Projects (persona groups) migration
--
-- Adds the three "library" primitives:
--   1. posts.is_favorite    — heart a generated post anywhere it renders
--   2. agents.is_favorite   — heart a persona
--   3. persona_groups       — named projects the user files personas into,
--      linked from agents.group_id (SET NULL on group delete, so deleting
--      a project never touches the personas inside it)
--
-- Written idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS) so it can be
-- replayed directly AND concatenated by build-bootstrap.mjs.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Favorite flags
-- ─────────────────────────────────────────────
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

-- The favorites page reads exactly this slice; partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_posts_favorite
  ON public.posts(user_id) WHERE is_favorite;

-- ─────────────────────────────────────────────
-- 2. persona_groups (user-named "projects")
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.persona_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_groups_user_id ON public.persona_groups(user_id);

ALTER TABLE public.persona_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "persona_groups_select_own" ON public.persona_groups;
CREATE POLICY "persona_groups_select_own" ON public.persona_groups
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "persona_groups_insert_own" ON public.persona_groups;
CREATE POLICY "persona_groups_insert_own" ON public.persona_groups
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "persona_groups_update_own" ON public.persona_groups;
CREATE POLICY "persona_groups_update_own" ON public.persona_groups
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "persona_groups_delete_own" ON public.persona_groups;
CREATE POLICY "persona_groups_delete_own" ON public.persona_groups
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS persona_groups_updated_at ON public.persona_groups;
CREATE TRIGGER persona_groups_updated_at
  BEFORE UPDATE ON public.persona_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 3. agents → group link
-- ─────────────────────────────────────────────
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.persona_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_group_id ON public.agents(group_id);
