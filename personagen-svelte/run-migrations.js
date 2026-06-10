import fs from 'fs';
import path from 'path';

// Load .env manually
const envPath = path.resolve('.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[match[1]] = val;
  }
});

const supabaseUrl = env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

const migrationSql = `
-- 1. Update existing tables with missing columns
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS analytics JSONB DEFAULT '{"views": 0, "likes": 0, "comments": 0, "shares": 0}'::jsonb;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS token_usage INT DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS token_cost NUMERIC(10, 6) DEFAULT 0.000000;

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_overseer BOOLEAN DEFAULT false;

ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rss_url TEXT DEFAULT '';
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rss_active BOOLEAN DEFAULT false;
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS rss_last_polled_at TIMESTAMPTZ;


-- 2. Create chat_messages table and indexes/RLS/policies
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model', 'system')),
  content TEXT NOT NULL,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_id ON public.chat_messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at ASC);

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


-- 3. Create agent_memories table and indexes/RLS/policies/triggers
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


-- 4. Create processed_rss_items table and indexes/RLS/policies
CREATE TABLE IF NOT EXISTS public.processed_rss_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  item_guid TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, item_guid)
);

CREATE INDEX IF NOT EXISTS idx_processed_rss_items_agent_id ON public.processed_rss_items(agent_id);

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
`;

async function run() {
  console.log('🚀 Running database migrations on production Supabase...');
  try {
    const url = `${supabaseUrl}/pg/query`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: migrationSql
      })
    });

    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response:', text);
  } catch (err) {
    console.error('Error during migration:', err);
  }
}

run();
