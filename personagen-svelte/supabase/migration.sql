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
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  company TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "profiles_delete_own" ON public.profiles
  FOR DELETE USING (auth.uid() = id);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 2. agents
-- ─────────────────────────────────────────────
CREATE TABLE public.agents (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_user_id ON public.agents(user_id);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_select_own" ON public.agents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "agents_insert_own" ON public.agents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agents_update_own" ON public.agents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "agents_delete_own" ON public.agents
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 3. agent_configs
-- ─────────────────────────────────────────────
CREATE TABLE public.agent_configs (
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

CREATE INDEX idx_agent_configs_user_id ON public.agent_configs(user_id);
CREATE INDEX idx_agent_configs_agent_id ON public.agent_configs(agent_id);

ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_configs_select_own" ON public.agent_configs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "agent_configs_insert_own" ON public.agent_configs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_configs_update_own" ON public.agent_configs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "agent_configs_delete_own" ON public.agent_configs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER agent_configs_updated_at
  BEFORE UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 4. posts (content calendar)
-- ─────────────────────────────────────────────
CREATE TABLE public.posts (
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

CREATE INDEX idx_posts_user_id ON public.posts(user_id);
CREATE INDEX idx_posts_agent_id ON public.posts(agent_id);
CREATE INDEX idx_posts_scheduled_date ON public.posts(scheduled_date);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select_own" ON public.posts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "posts_insert_own" ON public.posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "posts_update_own" ON public.posts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "posts_delete_own" ON public.posts
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 5. connections (social platform links)
-- ─────────────────────────────────────────────
CREATE TABLE public.connections (
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

CREATE INDEX idx_connections_user_id ON public.connections(user_id);
CREATE INDEX idx_connections_agent_id ON public.connections(agent_id);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connections_select_own" ON public.connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "connections_insert_own" ON public.connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "connections_update_own" ON public.connections
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "connections_delete_own" ON public.connections
  FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 6. blueprints (decoded channels)
-- ─────────────────────────────────────────────
CREATE TABLE public.blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_name TEXT,
  channel_url TEXT,
  platform TEXT,
  score INT DEFAULT 0,
  layers JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blueprints_user_id ON public.blueprints(user_id);

ALTER TABLE public.blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blueprints_select_own" ON public.blueprints
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "blueprints_insert_own" ON public.blueprints
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "blueprints_update_own" ON public.blueprints
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "blueprints_delete_own" ON public.blueprints
  FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 7. brand_briefs
-- ─────────────────────────────────────────────
CREATE TABLE public.brand_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB DEFAULT '{}',
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_briefs_user_id ON public.brand_briefs(user_id);

ALTER TABLE public.brand_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_briefs_select_own" ON public.brand_briefs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "brand_briefs_insert_own" ON public.brand_briefs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "brand_briefs_update_own" ON public.brand_briefs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "brand_briefs_delete_own" ON public.brand_briefs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER brand_briefs_updated_at
  BEFORE UPDATE ON public.brand_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 8. tickets (PM kanban)
-- ─────────────────────────────────────────────
CREATE TABLE public.tickets (
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

CREATE INDEX idx_tickets_user_id ON public.tickets(user_id);
CREATE INDEX idx_tickets_assignee_agent_id ON public.tickets(assignee_agent_id);
CREATE INDEX idx_tickets_status ON public.tickets(status);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_select_own" ON public.tickets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "tickets_insert_own" ON public.tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tickets_update_own" ON public.tickets
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "tickets_delete_own" ON public.tickets
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────
-- 9. subscriptions (Stripe billing)
-- ─────────────────────────────────────────────
CREATE TABLE public.subscriptions (
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

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "subscriptions_insert_own" ON public.subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "subscriptions_update_own" ON public.subscriptions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "subscriptions_delete_own" ON public.subscriptions
  FOR DELETE USING (auth.uid() = user_id);

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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────
-- 11. Alter agents table to support Hermes Overseer
-- ─────────────────────────────────────────────
ALTER TABLE public.agents ADD COLUMN is_overseer BOOLEAN DEFAULT false;

-- ─────────────────────────────────────────────
-- 12. chat_messages (Persistent Sync Chat History)
-- ─────────────────────────────────────────────
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model', 'system')),
  content TEXT NOT NULL,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_agent_id ON public.chat_messages(agent_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at ASC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_select_own" ON public.chat_messages
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "chat_messages_insert_own" ON public.chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_messages_delete_own" ON public.chat_messages
  FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 13. agent_memories (Long-Term Episodic Memory Fact Database)
-- ─────────────────────────────────────────────
CREATE TABLE public.agent_memories (
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

CREATE INDEX idx_agent_memories_agent_id ON public.agent_memories(agent_id);

ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_memories_select_own" ON public.agent_memories
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "agent_memories_insert_own" ON public.agent_memories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_memories_update_own" ON public.agent_memories
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "agent_memories_delete_own" ON public.agent_memories
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER agent_memories_updated_at
  BEFORE UPDATE ON public.agent_memories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
