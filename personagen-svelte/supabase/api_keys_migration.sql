-- ═══════════════════════════════════════════════════════════════════════════
-- Programmatic API keys (durable machine auth for an agentic controller).
--
-- A key authenticates AS the seat that created it: on a request carrying
-- `Authorization: Bearer pg_live_…`, the auth hook resolves the key to its
-- user_id, mints a short-lived Supabase user JWT (HS256, SUPABASE_JWT_SECRET),
-- and runs the request under that identity — so every existing RLS policy and
-- workspace role applies UNCHANGED. The key is just an alternate credential for
-- a real seat; it never bypasses the access model.
--
-- Only the SHA-256 hash of the key is stored — the plaintext is shown once at
-- creation and never again. key_prefix is the first chars, for display only.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  key_hash TEXT NOT NULL UNIQUE,     -- sha-256 hex of the full key
  key_prefix TEXT NOT NULL,          -- e.g. "pg_live_ab12cd" for the UI list
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- A user manages their own keys from the client. Resolution at request time
-- runs under the service role (auth hook), which bypasses RLS by design.
DROP POLICY IF EXISTS "api_keys_select_own" ON public.api_keys;
CREATE POLICY "api_keys_select_own" ON public.api_keys
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_keys_insert_own" ON public.api_keys;
CREATE POLICY "api_keys_insert_own" ON public.api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_keys_update_own" ON public.api_keys;
CREATE POLICY "api_keys_update_own" ON public.api_keys
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_keys_delete_own" ON public.api_keys;
CREATE POLICY "api_keys_delete_own" ON public.api_keys
  FOR DELETE USING (auth.uid() = user_id);
