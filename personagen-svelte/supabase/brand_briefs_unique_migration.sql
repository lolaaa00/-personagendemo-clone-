-- Ensure one brand brief per user.
--
-- The app persists the brand brief via a get-then-update/insert in the engine's
-- `save_brief` action, so this constraint is not strictly required — but it makes
-- `db.brandBriefs.upsert({ onConflict: 'user_id' })` safe and prevents duplicate
-- rows if anything ever inserts directly.
--
-- Safe to run on an empty/clean table. If duplicate user_id rows already exist,
-- de-duplicate first (keep the most recently updated row):
--
--   DELETE FROM public.brand_briefs a
--   USING public.brand_briefs b
--   WHERE a.user_id = b.user_id
--     AND a.updated_at < b.updated_at;

ALTER TABLE public.brand_briefs
	ADD CONSTRAINT brand_briefs_user_id_key UNIQUE (user_id);
