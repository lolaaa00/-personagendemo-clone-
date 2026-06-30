-- Per-agent UGC video generation settings.
-- Read defensively by src/lib/server/content/generate.ts (loadUgcConfig); the
-- pipeline falls back to sensible defaults when these are absent, so this
-- migration is safe to apply at any time and only unlocks per-agent control.

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS ugc_voice TEXT;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS ugc_format TEXT DEFAULT 'auto'
    CHECK (ugc_format IN ('auto', 'spokesperson', 'broll'));

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS ugc_video_quality TEXT DEFAULT 'mvp'
    CHECK (ugc_video_quality IN ('mvp', 'premium'));

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS ugc_character_ref TEXT;
