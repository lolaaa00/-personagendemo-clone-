-- Per-agent UGC settings (read by the generation engine, written by the persona
-- Settings UI). Safe/idempotent. The engine reads these defensively, so it works
-- before this runs — applying it just unlocks per-agent configuration + pinned face.

ALTER TABLE public.agent_configs
	ADD COLUMN IF NOT EXISTS ugc_voice TEXT DEFAULT 'Adam',
	ADD COLUMN IF NOT EXISTS ugc_format TEXT DEFAULT 'auto'
		CHECK (ugc_format IN ('auto', 'spokesperson', 'broll')),
	ADD COLUMN IF NOT EXISTS ugc_video_quality TEXT DEFAULT 'mvp'
		CHECK (ugc_video_quality IN ('mvp', 'premium')),
	ADD COLUMN IF NOT EXISTS ugc_character_ref TEXT;

-- Notes:
--   ugc_voice          -> ElevenLabs voice name from GET /api/voices (default 'Adam')
--   ugc_format         -> 'spokesperson' (Fabric talking head) | 'broll' (Kling) | 'auto'
--   ugc_video_quality  -> 'mvp' (Fabric/Kling) | 'premium' (Veo/Sora)
--   ugc_character_ref  -> durable URL of the pinned creator face (auto-populated on
--                         first spokesperson generation; keeps the same face per agent)
