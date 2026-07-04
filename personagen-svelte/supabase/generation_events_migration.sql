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

CREATE POLICY "generation_events_select_own" ON public.generation_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "generation_events_insert_own" ON public.generation_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
