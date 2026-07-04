-- Expand connections.platform to every platform PersonaGen can connect +
-- publish through Zernio (was limited to the 6 Composio-era platforms).
-- Idempotent: drop the old CHECK (whatever it was named) and re-add the wide one.

ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_platform_check;

ALTER TABLE public.connections
	ADD CONSTRAINT connections_platform_check
	CHECK (platform IN (
		'instagram', 'tiktok', 'youtube', 'facebook', 'x', 'threads',
		'linkedin', 'bluesky', 'pinterest', 'reddit', 'googlebusiness', 'telegram', 'snapchat'
	));
