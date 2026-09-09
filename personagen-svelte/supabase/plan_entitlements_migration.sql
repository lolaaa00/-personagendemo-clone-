-- ═══════════════════════════════════════════════════════════════════════════
-- Plan features get somewhere to be true.
--
-- The catalog sells nine feature lines that nothing in the code consults:
-- brand-brief limits, the autonomy ceiling ("Advisor + Semi-autonomous" on
-- Studio against "All three autonomy levels" on Brand), cinematic video and
-- talking head, the priority generation queue, teams, bring-your-own-keys and
-- API access. Only the persona limit had a gate. Copy that nothing enforces is
-- the same defect as a check that cannot fail.
--
-- One JSONB column rather than eight boolean ones: the next feature line is a
-- data edit, not another migration. An ABSENT key means NO RESTRICTION, so an
-- empty object is exactly today's behaviour.
--
--   { "max_autonomy": "advisor" | "semi_autonomous" | "fully_autonomous",
--     "cinematic": bool, "teams": bool, "api": bool, "byok": bool,
--     "priority": bool }
--
-- Free is seeded EMPTY on purpose. Every one of the nine live accounts is on
-- free today and has all of this; seeding it restrictively would take working
-- features away from real users in the name of a plan nobody can buy yet
-- (plans_enabled is false and no paid row exists). The resolver also never
-- lets a paid plan be less permissive than free, so while free is open the
-- gates are inert everywhere — a paying Studio customer can never end up with
-- less than a free one.
--
-- LAUNCH-DAY EDIT — the one row that turns all of this on:
--   UPDATE public.plan_catalog SET entitlements =
--     '{"max_autonomy":"advisor","cinematic":false,"teams":false,
--       "api":false,"byok":false,"priority":false}'::jsonb
--   WHERE plan = 'free';
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plan_catalog
	ADD COLUMN IF NOT EXISTS entitlements JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.plan_catalog.entitlements IS
	'Feature gates for this plan. An absent key means no restriction. Read by lib/server/entitlements.ts; a paid plan is never resolved below free.';

-- Seed the paid tiers to say exactly what their `features` text already sells.
UPDATE public.plan_catalog SET entitlements =
	'{"max_autonomy":"semi_autonomous","cinematic":false,"teams":false,"api":false,"byok":false,"priority":false}'::jsonb
WHERE plan = 'studio' AND entitlements = '{}'::jsonb;

UPDATE public.plan_catalog SET entitlements =
	'{"max_autonomy":"fully_autonomous","cinematic":true,"teams":false,"api":false,"byok":false,"priority":false}'::jsonb
WHERE plan = 'brand' AND entitlements = '{}'::jsonb;

UPDATE public.plan_catalog SET entitlements =
	'{"max_autonomy":"fully_autonomous","cinematic":true,"teams":true,"api":true,"byok":true,"priority":true}'::jsonb
WHERE plan = 'agency' AND entitlements = '{}'::jsonb;
