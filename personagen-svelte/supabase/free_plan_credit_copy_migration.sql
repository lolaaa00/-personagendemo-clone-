-- ═══════════════════════════════════════════════════════════════════════════
-- The Free plan stops promising a credit it can withhold.
--
-- The catalog's free row advertised "Welcome credit to start", unconditionally.
-- Two abuse controls can withhold it, both legitimate and neither disclosed:
--
--   · grantWelcomeCredit() refuses when signup_credits_hourly_cap (default 20)
--     welcome grants have already landed platform-wide in the trailing hour;
--   · maybeWithholdWelcome() claws a granted credit back when a second account
--     is created from the same daily-salted IP hash inside 24 hours.
--
-- A genuine first signup always gets it. What is refused is the second account
-- from the same place — so the honest word is "per person", which is the
-- qualifier the landing page now carries too.
--
-- The code-side PLAN_FALLBACK was updated with it, but that only applies when
-- the database read FAILS; the live catalog is what /billing renders, so the
-- row itself has to say it.
--
-- Guarded on the old text and idempotent: re-running changes nothing, and an
-- operator who has already reworded the row is not overwritten.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.plan_catalog
   SET features = jsonb_set(features, '{0}', '"One free credit per person to start"'::jsonb),
       updated_at = now()
 WHERE plan = 'free'
   AND features->>0 = 'Welcome credit to start';
