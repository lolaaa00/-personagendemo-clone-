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

CREATE POLICY "processed_rss_items_select" ON public.processed_rss_items 
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.agents WHERE agents.id = processed_rss_items.agent_id AND agents.user_id = auth.uid())
  );

CREATE POLICY "processed_rss_items_insert" ON public.processed_rss_items 
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.agents WHERE agents.id = agent_id AND agents.user_id = auth.uid())
  );
