-- Blotato as a posting provider: allow it on connections and in BYOK keys.

ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_provider_check;
ALTER TABLE public.connections
	ADD CONSTRAINT connections_provider_check
	CHECK (provider IN ('composio', 'zernio', 'blotato'));

ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE public.user_api_keys
	ADD CONSTRAINT user_api_keys_provider_check
	CHECK (provider IN ('zernio', 'blotato', 'gemini', 'openrouter', 'firecrawl', 'kie_ai', 'fal_ai'));
