-- The OpenRouter video failover, listed in the platform catalog.
--
-- OpenRouter serves video from a separate API (POST /api/v1/videos), not from
-- /api/v1/models, so no catalog sync can ever discover kwaivgi/kling-v3.0-std.
-- Production ran it 19 times in a month while the Model Manager could not name
-- it: the one model the ledger showed running with no row anywhere.
--
-- Seeded UNWIRED on purpose. Listing it makes it visible, priced and
-- reconcilable against generation_events; the route keeps resolving to the
-- compiled-in constant until an admin deliberately wires it, so applying this
-- migration changes no generation behaviour.
--
-- Mirrors OR_VIDEO_SEED in src/lib/server/model-registry.ts, which covers fresh
-- installs. Idempotent: safe to re-run.

INSERT INTO public.model_registry (
  user_id, provider, origin, model_id, kind, kinds, input_modalities, output_modalities,
  label, lab, released_at, price_usd, pricing_text, price_basis, price_source,
  quality, tier, latency_s, status, wired, is_default, deprecated,
  multi_ref, supports_audio, supports_duration, size_param, probe, note, discovered_at
)
SELECT
  NULL, 'openrouter', 'seed', 'kwaivgi/kling-v3.0-std', 'video_i2v',
  ARRAY['video_i2v'], ARRAY['image','text'], ARRAY['video'],
  'Kling v3.0 Standard (OpenRouter failover)', 'Kling', NULL,
  0.35, NULL, 'OpenRouter video API, ~5s clip', 'seed',
  7, 'balanced', 180, 'available', false, false, false,
  NULL, NULL, NULL, NULL, NULL,
  'Runs only when fal is down. OpenRouter serves video from a separate API, so no catalog sync lists it — this row is how it stays visible and priced.',
  NULL
WHERE EXISTS (SELECT 1 FROM public.model_registry WHERE user_id IS NULL)
ON CONFLICT (owner_key, model_id) DO NOTHING;
