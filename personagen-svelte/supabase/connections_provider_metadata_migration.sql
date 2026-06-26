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
