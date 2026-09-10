-- ═══════════════════════════════════════════════════════════════════════════
-- "Cancel any time" gets a column to be true with.
--
-- The pricing page has promised cancellation since before there was a
-- subscription to cancel: no route, no portal link, and /api/billing/subscribe
-- answering "Contact us to change plans". Cancelling happens at the END of the
-- paid period — the customer paid for this month and keeps it — so the state
-- "still active, will not renew" has to be storable, and it was not.
--
-- Additive. Existing rows default to false, which is what they already meant.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
	ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscriptions.cancel_at_period_end IS
	'Set by /api/billing/cancel: the plan stays active until current_period_end and then stops. Stripe remains the source of truth; the webhook reconciles status on customer.subscription.updated/deleted.';
