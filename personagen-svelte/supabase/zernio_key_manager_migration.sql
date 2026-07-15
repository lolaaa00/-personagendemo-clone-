-- Zernio Key Manager: MULTIPLE Zernio API keys per user, assignable per persona.
--
-- Why: Zernio's free tier is per ACCOUNT (first 2 connected accounts free, then
-- paid, metered globally across the key). Users who run one Zernio account per
-- agent email get 2 free slots PER KEY. This table stores those extra keys
-- (encrypted like user_api_keys) and agents.zernio_key_id assigns one to a
-- persona. Null zernio_key_id = the existing default key
-- (user_api_keys provider='zernio', else env ZERNIO_API_KEY) — so this
-- migration changes nothing for existing setups until a key is assigned.
--
-- IMPORTANT INVARIANT: agents.zernio_profile_id is only meaningful WITHIN the
-- Zernio account of the key that created it. Application code clears
-- zernio_profile_id (and flags the persona's zernio connections for reconnect)
-- whenever the key assignment changes.
--
-- Safe / idempotent.

CREATE TABLE IF NOT EXISTS public.zernio_keys (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	-- Human label so the user can tell keys apart ("mia@…", "Agent 2 Zernio").
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

-- Per-persona key assignment. ON DELETE SET NULL: deleting a key reverts its
-- personas to the default key (application code also clears zernio_profile_id
-- at delete time, since a profile id from another Zernio account is garbage).
ALTER TABLE public.agents
	ADD COLUMN IF NOT EXISTS zernio_key_id UUID REFERENCES public.zernio_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.agents.zernio_key_id IS
	'Optional zernio_keys row this persona publishes/connects through. Null = the user''s default Zernio key (user_api_keys provider=zernio, else env). Changing this invalidates zernio_profile_id (profiles are per Zernio account).';
