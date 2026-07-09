-- Multi-brand support: one user runs several brands (e.g. "Just Kids Honey"
-- and "HoneyX Manly Plus"), each with its own brand brief, and each persona
-- selects which brief it generates content for.
--
-- 1. brand_briefs loses UNIQUE(user_id) — multiple briefs per user now.
--    (This reverses brand_briefs_unique_migration.sql, which enforced the
--    old one-brief-per-user model.)
-- 2. brand_briefs gains a `name` column for listing/picking briefs.
-- 3. agent_configs gains `brand_brief_id` — the persona's selected brief.
--    ON DELETE SET NULL: deleting a brief reverts its personas to the
--    newest-brief fallback instead of breaking them.

ALTER TABLE public.brand_briefs DROP CONSTRAINT IF EXISTS brand_briefs_user_id_key;

ALTER TABLE public.brand_briefs
	ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Untitled Brand';

-- Backfill names from the brief JSON's brandName where present.
UPDATE public.brand_briefs
	SET name = COALESCE(NULLIF(data->>'brandName', ''), name)
	WHERE name = 'Untitled Brand';

ALTER TABLE public.agent_configs
	ADD COLUMN IF NOT EXISTS brand_brief_id UUID REFERENCES public.brand_briefs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_configs_brand_brief_id
	ON public.agent_configs(brand_brief_id);
