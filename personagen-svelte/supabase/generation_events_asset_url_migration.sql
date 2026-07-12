-- Add a durable asset URL to the generation ledger so every spent generation is
-- recoverable from the DB — even a video, which (unlike an image) can't be
-- re-fetched from the provider after its ephemeral URL expires. The app persists
-- media to the ugc-media bucket and now records that bucket URL here alongside
-- the post_id, closing the "tokens spent but output lost" gap.

ALTER TABLE public.generation_events
  ADD COLUMN IF NOT EXISTS asset_url TEXT;

-- Fast lookup of "every asset ever produced for this post" when restoring media.
CREATE INDEX IF NOT EXISTS idx_generation_events_post ON public.generation_events(post_id);
