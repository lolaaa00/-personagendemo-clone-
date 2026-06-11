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
