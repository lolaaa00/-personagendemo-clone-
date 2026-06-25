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
