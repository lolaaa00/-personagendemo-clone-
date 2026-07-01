-- Stores the intermediate assets from the multi-stage character reference
-- pipeline (turnaround sheet -> full-body hero shot -> side-profile composite
-- -> facial close-up), keyed by stage, so each stage can be regenerated or
-- reviewed independently instead of only keeping the single latest asset in
-- ugc_character_ref. Read/written defensively by
-- src/lib/server/content/generate.ts and the generate-avatar/generate-reference-kit
-- API routes; safe to apply at any time.

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS ugc_reference_kit JSONB DEFAULT '{}'::jsonb;
