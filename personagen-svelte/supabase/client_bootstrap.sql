-- ══════════════════════════════════════════════════════════════════════════
-- PersonaGen — client_bootstrap.sql
--
-- GENERATED FILE — do not hand-edit. Regenerate with:
--     node supabase/build-bootstrap.mjs
--
-- Takes an EMPTY Postgres 15+ database (with Supabase auth.users present)
-- to the schema HEAD expects. Every statement is guarded, so the file is
-- safe to re-run against a partially-migrated database.
--
-- Run it in ONE transaction (the Supabase SQL editor does this for you):
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f client_bootstrap.sql
-- ══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 01. migration.sql
--     Base schema — 12 tables, RLS, signup trigger
-- ──────────────────────────────────────────────────────────────────────────

-- ============================================================
-- PersonaGen — Full Database Migration
-- Run against a Supabase project (or any PostgreSQL 15+ with auth.users)
-- ============================================================

-- ─────────────────────────────────────────────
-- 0. Utility: updated_at trigger function
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 1. profiles (extends auth.users)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  company TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
CREATE POLICY "profiles_delete_own" ON public.profiles
  FOR DELETE USING (auth.uid() = id);

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 2. agents
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  niche TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('active', 'paused', 'pending')),
  soul TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  tools TEXT DEFAULT '',
  heartbeat TEXT DEFAULT '',
  market TEXT DEFAULT 'Australia',
  gradient TEXT DEFAULT 'linear-gradient(135deg, #7c6aed, #e84393)',
  initial TEXT DEFAULT 'A',
  engagement_rate NUMERIC DEFAULT 0,
  followers TEXT DEFAULT '0',
  connection_count INT DEFAULT 0,
  supervisor_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  managed_by_overseer BOOLEAN DEFAULT false,
  runtime_owner TEXT DEFAULT 'svelte-gemini'
    CHECK (runtime_owner IN ('svelte-gemini', 'hermes-daemon', 'hermes-orchestrated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON public.agents(user_id);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_select_own" ON public.agents;
CREATE POLICY "agents_select_own" ON public.agents
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agents_insert_own" ON public.agents;
CREATE POLICY "agents_insert_own" ON public.agents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agents_update_own" ON public.agents;
CREATE POLICY "agents_update_own" ON public.agents
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agents_delete_own" ON public.agents;
CREATE POLICY "agents_delete_own" ON public.agents
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS agents_updated_at ON public.agents;
CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 3. agent_configs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  soul TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  tools TEXT DEFAULT '',
  timezone TEXT DEFAULT 'Australia/Sydney',
  posts_per_day INT DEFAULT 3,
  active_hours_start INT DEFAULT 8,
  active_hours_end INT DEFAULT 22,
  autonomy_level TEXT DEFAULT 'advisor'
    CHECK (autonomy_level IN ('advisor', 'semi_autonomous', 'fully_autonomous')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_user_id ON public.agent_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_agent_id ON public.agent_configs(agent_id);

ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_configs_select_own" ON public.agent_configs;
CREATE POLICY "agent_configs_select_own" ON public.agent_configs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_configs_insert_own" ON public.agent_configs;
CREATE POLICY "agent_configs_insert_own" ON public.agent_configs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_configs_update_own" ON public.agent_configs;
CREATE POLICY "agent_configs_update_own" ON public.agent_configs
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_configs_delete_own" ON public.agent_configs;
CREATE POLICY "agent_configs_delete_own" ON public.agent_configs
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS agent_configs_updated_at ON public.agent_configs;
CREATE TRIGGER agent_configs_updated_at
  BEFORE UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 4. posts (content calendar)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  platforms TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  scheduled_date DATE,
  scheduled_time TIME,
  published_at TIMESTAMPTZ,
  external_id TEXT,
  analytics JSONB DEFAULT '{"views": 0, "likes": 0, "comments": 0, "shares": 0}'::jsonb,
  publication_results JSONB DEFAULT '{}'::jsonb,
  token_usage INT DEFAULT 0,
  token_cost NUMERIC(10, 6) DEFAULT 0.000000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON public.posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_agent_id ON public.posts(agent_id);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_date ON public.posts(scheduled_date);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "posts_select_own" ON public.posts;
CREATE POLICY "posts_select_own" ON public.posts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "posts_insert_own" ON public.posts;
CREATE POLICY "posts_insert_own" ON public.posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "posts_update_own" ON public.posts;
CREATE POLICY "posts_update_own" ON public.posts
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "posts_delete_own" ON public.posts;
CREATE POLICY "posts_delete_own" ON public.posts
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS posts_updated_at ON public.posts;
CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 5. connections (social platform links)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  platform TEXT NOT NULL
    CHECK (platform IN ('tiktok', 'instagram', 'youtube', 'x', 'facebook', 'threads')),
  handle TEXT,
  verified BOOLEAN DEFAULT false,
  followers INT DEFAULT 0,
  engagement_rate NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'reauth_required', 'revoked', 'error')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync TIMESTAMPTZ,
  last_error TEXT,
  last_checked_at TIMESTAMPTZ,
  UNIQUE(agent_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_connections_user_id ON public.connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_agent_id ON public.connections(agent_id);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connections_select_own" ON public.connections;
CREATE POLICY "connections_select_own" ON public.connections
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "connections_insert_own" ON public.connections;
CREATE POLICY "connections_insert_own" ON public.connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "connections_update_own" ON public.connections;
CREATE POLICY "connections_update_own" ON public.connections
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "connections_delete_own" ON public.connections;
CREATE POLICY "connections_delete_own" ON public.connections
  FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 6. blueprints (decoded channels)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_name TEXT,
  channel_url TEXT,
  platform TEXT,
  score INT DEFAULT 0,
  layers JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blueprints_user_id ON public.blueprints(user_id);

ALTER TABLE public.blueprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blueprints_select_own" ON public.blueprints;
CREATE POLICY "blueprints_select_own" ON public.blueprints
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "blueprints_insert_own" ON public.blueprints;
CREATE POLICY "blueprints_insert_own" ON public.blueprints
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "blueprints_update_own" ON public.blueprints;
CREATE POLICY "blueprints_update_own" ON public.blueprints
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "blueprints_delete_own" ON public.blueprints;
CREATE POLICY "blueprints_delete_own" ON public.blueprints
  FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 7. brand_briefs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB DEFAULT '{}',
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_briefs_user_id ON public.brand_briefs(user_id);

ALTER TABLE public.brand_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_briefs_select_own" ON public.brand_briefs;
CREATE POLICY "brand_briefs_select_own" ON public.brand_briefs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "brand_briefs_insert_own" ON public.brand_briefs;
CREATE POLICY "brand_briefs_insert_own" ON public.brand_briefs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "brand_briefs_update_own" ON public.brand_briefs;
CREATE POLICY "brand_briefs_update_own" ON public.brand_briefs
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "brand_briefs_delete_own" ON public.brand_briefs;
CREATE POLICY "brand_briefs_delete_own" ON public.brand_briefs
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS brand_briefs_updated_at ON public.brand_briefs;
CREATE TRIGGER brand_briefs_updated_at
  BEFORE UPDATE ON public.brand_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 8. tickets (PM kanban)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'in_progress', 'review', 'done')),
  priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  due_date DATE,
  position INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON public.tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_agent_id ON public.tickets(assignee_agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tickets_select_own" ON public.tickets;
CREATE POLICY "tickets_select_own" ON public.tickets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tickets_insert_own" ON public.tickets;
CREATE POLICY "tickets_insert_own" ON public.tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "tickets_update_own" ON public.tickets;
CREATE POLICY "tickets_update_own" ON public.tickets
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tickets_delete_own" ON public.tickets;
CREATE POLICY "tickets_delete_own" ON public.tickets
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS tickets_updated_at ON public.tickets;
CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 9. subscriptions (Stripe billing)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free'
    CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
CREATE POLICY "subscriptions_insert_own" ON public.subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "subscriptions_update_own" ON public.subscriptions;
CREATE POLICY "subscriptions_update_own" ON public.subscriptions
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "subscriptions_delete_own" ON public.subscriptions;
CREATE POLICY "subscriptions_delete_own" ON public.subscriptions
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 10. Auto-create profile + free subscription on signup
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────
-- 11. Alter agents table to support Hermes Overseer
-- ─────────────────────────────────────────────
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_overseer BOOLEAN DEFAULT false;

-- ─────────────────────────────────────────────
-- 12. chat_sessions (Multiple Conversation Sessions)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_agent_updated ON public.chat_sessions(user_id, agent_id, updated_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_sessions_select_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_select_own" ON public.chat_sessions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "chat_sessions_insert_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_insert_own" ON public.chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "chat_sessions_update_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_update_own" ON public.chat_sessions FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "chat_sessions_delete_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_delete_own" ON public.chat_sessions FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS chat_sessions_updated_at ON public.chat_sessions;
CREATE TRIGGER chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 12.5. chat_messages (Persistent Sync Chat History)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model', 'system')),
  content TEXT NOT NULL,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_id ON public.chat_messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON public.chat_messages(session_id, created_at ASC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_messages_select_own" ON public.chat_messages;
CREATE POLICY "chat_messages_select_own" ON public.chat_messages
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_messages_insert_own" ON public.chat_messages;
CREATE POLICY "chat_messages_insert_own" ON public.chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_messages_delete_own" ON public.chat_messages;
CREATE POLICY "chat_messages_delete_own" ON public.chat_messages
  FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 13. agent_memories (Long-Term Episodic Memory Fact Database)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'fact' CHECK (memory_type IN ('fact', 'event', 'instruction', 'task')),
  content TEXT NOT NULL,
  summary TEXT,
  importance INT DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_id ON public.agent_memories(agent_id);

ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_memories_select_own" ON public.agent_memories;
CREATE POLICY "agent_memories_select_own" ON public.agent_memories
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_memories_insert_own" ON public.agent_memories;
CREATE POLICY "agent_memories_insert_own" ON public.agent_memories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_memories_update_own" ON public.agent_memories;
CREATE POLICY "agent_memories_update_own" ON public.agent_memories
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_memories_delete_own" ON public.agent_memories;
CREATE POLICY "agent_memories_delete_own" ON public.agent_memories
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS agent_memories_updated_at ON public.agent_memories;
CREATE TRIGGER agent_memories_updated_at
  BEFORE UPDATE ON public.agent_memories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 14. Supervision Indexes & Integrity Constraints
-- ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_one_overseer_per_user
ON public.agents(user_id)
WHERE is_overseer = true;

CREATE INDEX IF NOT EXISTS idx_agents_supervisor_agent_id ON public.agents(supervisor_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_managed_by_overseer ON public.agents(managed_by_overseer);
CREATE INDEX IF NOT EXISTS idx_agents_runtime_owner ON public.agents(runtime_owner);


-- ──────────────────────────────────────────────────────────────────────────
-- 02. composio_hardening_migration.sql
--     connections state cols + posts.publication_results
-- ──────────────────────────────────────────────────────────────────────────

-- MVP Composio hardening: connection state and per-platform publication outcomes.

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS followers INT DEFAULT 0;

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS engagement_rate NUMERIC DEFAULT 0;

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'reauth_required', 'revoked', 'error'));

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS publication_results JSONB DEFAULT '{}'::jsonb;


-- ──────────────────────────────────────────────────────────────────────────
-- 03. connections_provider_metadata_migration.sql
--     connections.provider + metadata
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.connections
	ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'composio'
		CHECK (provider IN ('composio', 'zernio')),
	ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
	ADD COLUMN IF NOT EXISTS provider_metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_connections_provider
	ON public.connections(provider);

CREATE INDEX IF NOT EXISTS idx_connections_provider_account_id
	ON public.connections(provider_account_id)
	WHERE provider_account_id IS NOT NULL;


-- ──────────────────────────────────────────────────────────────────────────
-- 04. social_analytics_migration.sql
--     posts analytics / token cost cols
-- ──────────────────────────────────────────────────────────────────────────

-- Migration to add social posting analytics, external platform IDs, and generation token cost fields to posts table.

-- Add external_id column to track publication reference IDs from Composio (message ID, tweet ID, etc.)
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Add analytics column to hold real-time views, likes, comments, shares, etc.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS analytics JSONB DEFAULT '{"views": 0, "likes": 0, "comments": 0, "shares": 0}'::jsonb;

-- Add token_usage column to track Gemini token costs during the post generation
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS token_usage INT DEFAULT 0;

-- Add token_cost column to track exact dollar costs calculated based on token counts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS token_cost NUMERIC(10, 6) DEFAULT 0.000000;


-- ──────────────────────────────────────────────────────────────────────────
-- 05. generation_events_migration.sql
--     generation_events ledger table
-- ──────────────────────────────────────────────────────────────────────────

-- Per-call generation cost ledger: which provider/model was used, for which
-- agent/post, at what estimated cost. Powers per-persona and per-provider
-- spend analytics. Estimates come from the code's pricing matrix.

CREATE TABLE IF NOT EXISTS public.generation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  model TEXT,
  est_cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_events_agent ON public.generation_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_generation_events_user ON public.generation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_events_provider ON public.generation_events(provider);

ALTER TABLE public.generation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generation_events_select_own" ON public.generation_events;
CREATE POLICY "generation_events_select_own" ON public.generation_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "generation_events_insert_own" ON public.generation_events;
CREATE POLICY "generation_events_insert_own" ON public.generation_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────────────────
-- 06. generation_events_asset_url_migration.sql
--     generation_events.asset_url
-- ──────────────────────────────────────────────────────────────────────────

-- Add a durable asset URL to the generation ledger so every spent generation is
-- recoverable from the DB — even a video, which (unlike an image) can't be
-- re-fetched from the provider after its ephemeral URL expires. The app persists
-- media to the ugc-media bucket and now records that bucket URL here alongside
-- the post_id, closing the "tokens spent but output lost" gap.

ALTER TABLE public.generation_events
  ADD COLUMN IF NOT EXISTS asset_url TEXT;

-- Fast lookup of "every asset ever produced for this post" when restoring media.
CREATE INDEX IF NOT EXISTS idx_generation_events_post ON public.generation_events(post_id);


-- ──────────────────────────────────────────────────────────────────────────
-- 07. user_api_keys_migration.sql
--     user_api_keys BYOK table
-- ──────────────────────────────────────────────────────────────────────────

-- Secure per-user API key storage for BYOK provider credentials.

CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('zernio', 'gemini', 'openrouter', 'firecrawl', 'kie_ai', 'fal_ai')),
  encrypted_value TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  last_four TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'valid', 'invalid', 'error')),
  last_error TEXT,
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_provider
  ON public.user_api_keys(user_id, provider);

ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_api_keys_select_own" ON public.user_api_keys;
CREATE POLICY "user_api_keys_select_own" ON public.user_api_keys
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_api_keys_insert_own" ON public.user_api_keys;
CREATE POLICY "user_api_keys_insert_own" ON public.user_api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_api_keys_update_own" ON public.user_api_keys;
CREATE POLICY "user_api_keys_update_own" ON public.user_api_keys
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_api_keys_delete_own" ON public.user_api_keys;
CREATE POLICY "user_api_keys_delete_own" ON public.user_api_keys
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS user_api_keys_updated_at ON public.user_api_keys;
CREATE TRIGGER user_api_keys_updated_at
  BEFORE UPDATE ON public.user_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- ──────────────────────────────────────────────────────────────────────────
-- 08. user_api_keys_providers_migration.sql
--     widen BYOK provider CHECK
-- ──────────────────────────────────────────────────────────────────────────

-- Extend secure BYOK provider support.

ALTER TABLE public.user_api_keys
  DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;

ALTER TABLE public.user_api_keys
  ADD CONSTRAINT user_api_keys_provider_check
  CHECK (provider IN ('zernio', 'gemini', 'openrouter', 'firecrawl', 'kie_ai', 'fal_ai'));


-- ──────────────────────────────────────────────────────────────────────────
-- 09. blotato_provider_migration.sql
--     allow blotato on connections + BYOK
-- ──────────────────────────────────────────────────────────────────────────

-- Blotato as a posting provider: allow it on connections and in BYOK keys.

ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_provider_check;
ALTER TABLE public.connections
	ADD CONSTRAINT connections_provider_check
	CHECK (provider IN ('composio', 'zernio', 'blotato'));

ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE public.user_api_keys
	ADD CONSTRAINT user_api_keys_provider_check
	CHECK (provider IN ('zernio', 'blotato', 'gemini', 'openrouter', 'firecrawl', 'kie_ai', 'fal_ai'));


-- ──────────────────────────────────────────────────────────────────────────
-- 10. rss_migration.sql
--     agent_configs RSS cols + processed_rss_items
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Extend agent_configs with RSS configuration
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rss_url TEXT DEFAULT '';
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rss_active BOOLEAN DEFAULT false;
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rss_last_polled_at TIMESTAMPTZ;

-- 2. Create tracking table for processed RSS item GUIDs
CREATE TABLE IF NOT EXISTS public.processed_rss_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  item_guid TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, item_guid)
);

CREATE INDEX IF NOT EXISTS idx_processed_rss_items_agent_id ON public.processed_rss_items(agent_id);

-- 3. Row Level Security for tracking table
ALTER TABLE public.processed_rss_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "processed_rss_items_select" ON public.processed_rss_items;
CREATE POLICY "processed_rss_items_select" ON public.processed_rss_items 
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.agents WHERE agents.id = processed_rss_items.agent_id AND agents.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "processed_rss_items_insert" ON public.processed_rss_items;
CREATE POLICY "processed_rss_items_insert" ON public.processed_rss_items 
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.agents WHERE agents.id = agent_id AND agents.user_id = auth.uid())
  );


-- ──────────────────────────────────────────────────────────────────────────
-- 11. agent_configs_ugc_migration.sql
--     per-agent UGC settings
-- ──────────────────────────────────────────────────────────────────────────

-- Per-agent UGC settings (read by the generation engine, written by the persona
-- Settings UI). Safe/idempotent. The engine reads these defensively, so it works
-- before this runs — applying it just unlocks per-agent configuration + pinned face.

ALTER TABLE public.agent_configs
	ADD COLUMN IF NOT EXISTS ugc_voice TEXT DEFAULT 'Adam',
	ADD COLUMN IF NOT EXISTS ugc_format TEXT DEFAULT 'auto'
		CHECK (ugc_format IN ('auto', 'spokesperson', 'broll')),
	ADD COLUMN IF NOT EXISTS ugc_video_quality TEXT DEFAULT 'mvp'
		CHECK (ugc_video_quality IN ('mvp', 'premium')),
	ADD COLUMN IF NOT EXISTS ugc_character_ref TEXT;

-- Notes:
--   ugc_voice          -> ElevenLabs voice name from GET /api/voices (default 'Adam')
--   ugc_format         -> 'spokesperson' (Fabric talking head) | 'broll' (Kling) | 'auto'
--   ugc_video_quality  -> 'mvp' (Fabric/Kling) | 'premium' (Veo/Sora)
--   ugc_character_ref  -> durable URL of the pinned creator face (auto-populated on
--                         first spokesperson generation; keeps the same face per agent)


-- ──────────────────────────────────────────────────────────────────────────
-- 12. agent_reference_kit_migration.sql
--     agent_configs.ugc_reference_kit
-- ──────────────────────────────────────────────────────────────────────────

-- Stores the intermediate assets from the multi-stage character reference
-- pipeline (turnaround sheet -> full-body hero shot -> side-profile composite
-- -> facial close-up), keyed by stage, so each stage can be regenerated or
-- reviewed independently instead of only keeping the single latest asset in
-- ugc_character_ref. Read/written defensively by
-- src/lib/server/content/generate.ts and the generate-avatar/generate-reference-kit
-- API routes; safe to apply at any time.

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS ugc_reference_kit JSONB DEFAULT '{}'::jsonb;


-- ──────────────────────────────────────────────────────────────────────────
-- 13. multi_brand_briefs_migration.sql
--     multi-brand: brand_briefs.name + link
-- ──────────────────────────────────────────────────────────────────────────

-- Multi-brand support: one user runs several brands (e.g. "Just Kids Honey"
-- and "HoneyX Manly Plus"), each with its own brand brief, and each persona
-- selects which brief it generates content for.
--
-- 1. brand_briefs loses UNIQUE(user_id) — multiple briefs per user now.
--    (This reverses brand_briefs_unique_migration.sql, which enforced the
--    old one-brief-per-user model.)
-- 2. brand_briefs gains a `name` column for listing/picking briefs.
-- 3. agent_configs gains `brand_brief_id` — the persona's selected brief.
--    ON DELETE SET NULL: deleting a brief reverts its personas to the
--    newest-brief fallback instead of breaking them.

ALTER TABLE public.brand_briefs DROP CONSTRAINT IF EXISTS brand_briefs_user_id_key;

ALTER TABLE public.brand_briefs
	ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Untitled Brand';

-- Backfill names from the brief JSON's brandName where present.
UPDATE public.brand_briefs
	SET name = COALESCE(NULLIF(data->>'brandName', ''), name)
	WHERE name = 'Untitled Brand';

ALTER TABLE public.agent_configs
	ADD COLUMN IF NOT EXISTS brand_brief_id UUID REFERENCES public.brand_briefs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_configs_brand_brief_id
	ON public.agent_configs(brand_brief_id);


-- ──────────────────────────────────────────────────────────────────────────
-- 14. apply_all_pending.sql
--     post_reviews, scheduler_leases, zernio_keys, status superset
-- ──────────────────────────────────────────────────────────────────────────

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
--   8. zernio_key_manager_migration.sql           — multi-key manager + agents.zernio_key_id
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


-- ─── 8. Zernio Key Manager (zernio_key_manager_migration.sql) ────────────────
-- Multiple Zernio API keys per user (one per agent email → 2 free account
-- slots PER KEY), assignable per persona via agents.zernio_key_id. Null
-- assignment = the default key (user_api_keys provider='zernio', else env).
-- App code clears zernio_profile_id + flags connections on reassignment,
-- since Zernio profile ids only exist within one Zernio account.

CREATE TABLE IF NOT EXISTS public.zernio_keys (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	label TEXT NOT NULL,
	encrypted_value TEXT NOT NULL,
	iv TEXT NOT NULL,
	auth_tag TEXT NOT NULL,
	masked_value TEXT NOT NULL,
	last_four TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'valid', 'invalid', 'error')),
	last_error TEXT,
	last_tested_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (user_id, label)
);

CREATE INDEX IF NOT EXISTS idx_zernio_keys_user ON public.zernio_keys(user_id);

ALTER TABLE public.zernio_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zernio_keys_select_own" ON public.zernio_keys;
CREATE POLICY "zernio_keys_select_own" ON public.zernio_keys
	FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "zernio_keys_insert_own" ON public.zernio_keys;
CREATE POLICY "zernio_keys_insert_own" ON public.zernio_keys
	FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "zernio_keys_update_own" ON public.zernio_keys;
CREATE POLICY "zernio_keys_update_own" ON public.zernio_keys
	FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "zernio_keys_delete_own" ON public.zernio_keys;
CREATE POLICY "zernio_keys_delete_own" ON public.zernio_keys
	FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS zernio_keys_updated_at ON public.zernio_keys;
CREATE TRIGGER zernio_keys_updated_at
	BEFORE UPDATE ON public.zernio_keys
	FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.agents
	ADD COLUMN IF NOT EXISTS zernio_key_id UUID REFERENCES public.zernio_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.agents.zernio_key_id IS
	'Optional zernio_keys row this persona publishes/connects through. Null = the user''s default Zernio key (user_api_keys provider=zernio, else env). Changing this invalidates zernio_profile_id (profiles are per Zernio account).';


-- ──────────────────────────────────────────────────────────────────────────
-- 15. scheduler_indexes_and_provider_default_migration.sql
--     scheduler indexes + zernio default
-- ──────────────────────────────────────────────────────────────────────────

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
-- LOCKING NOTE: the CREATE INDEX IF NOT EXISTS statements below are NOT `CONCURRENTLY`,
-- because CONCURRENTLY cannot run inside a transaction block (the Supabase SQL
-- editor wraps the script in one). They take a SHARE lock on public.posts —
-- reads continue, writes to posts block for the duration of the build. On a
-- posts table of this size that is sub-second. If posts has grown large, run
-- the five CREATE INDEX IF NOT EXISTS statements one at a time with CONCURRENTLY added,
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

