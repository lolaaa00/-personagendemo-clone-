import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripeEnabled, cancelSubscriptionAtPeriodEnd, resumeSubscription } from '$lib/server/stripe';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { logActivity } from '$lib/server/activity';
import { Throttle } from '$lib/server/throttle';

const cancelLimiter = new Throttle(5, 60 * 1000);

/**
 * POST /api/billing/cancel   { resume?: boolean }
 *
 * The line behind "Cancel any time", which the pricing page has promised since
 * before there was a subscription to cancel. Cancels at the END of the paid
 * period: the customer paid for this month and keeps it, along with the
 * included credit already granted — that credit was bought, and the reset only
 * ever runs on a renewal that will now not happen.
 *
 * `resume: true` undoes a pending cancellation while the period is still
 * running, so changing your mind does not require support.
 *
 * The webhook remains the source of truth for status; this route writes
 * cancel_at_period_end straight away so the page tells the truth immediately
 * rather than after the event arrives.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	if (!stripeEnabled()) return json({ success: false, error: 'Payments are not configured on this server.' }, { status: 503 });
	const limit = cancelLimiter.check(`cancel:${user.id}`);
	if (!limit.allowed) return json({ success: false, error: `Too many attempts — try again in ${limit.retryAfterSeconds}s.` }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });

	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {
		/* no body — treat as cancel */
	}
	const resume = body.resume === true;

	const svc = getServiceSupabase();
	const { data: sub } = await svc
		.from('subscriptions')
		.select('plan, status, stripe_subscription_id, current_period_end')
		.eq('user_id', user.id)
		.maybeSingle();
	if (!sub?.stripe_subscription_id) {
		return json({ success: false, error: 'You do not have a subscription to cancel.' }, { status: 404 });
	}

	try {
		const result = resume
			? await resumeSubscription(String(sub.stripe_subscription_id))
			: await cancelSubscriptionAtPeriodEnd(String(sub.stripe_subscription_id));
		const periodEnd = (result as { current_period_end?: number }).current_period_end;
		const endsAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : (sub.current_period_end ?? null);
		await svc
			.from('subscriptions')
			.update({ cancel_at_period_end: !resume, current_period_end: endsAt, updated_at: new Date().toISOString() })
			.eq('user_id', user.id);
		logActivity(locals, user.id, {
			action: resume ? 'billing.subscription.renewed' : 'billing.subscription.ended',
			meta: { plan: sub.plan, cancel_at_period_end: !resume, ends_at: endsAt }
		});
		return json({
			success: true,
			cancel_at_period_end: !resume,
			ends_at: endsAt,
			message: resume
				? 'Your plan will renew as usual.'
				: `Your plan is cancelled. You keep it${endsAt ? ` until ${endsAt.slice(0, 10)}` : ' until the end of the period you paid for'}, and the credit already in your wallet stays yours.`
		});
	} catch (e) {
		console.error('[billing] cancel failed:', (e as Error).message);
		return json({ success: false, error: 'Could not reach the payment provider. Nothing was changed — please try again.' }, { status: 502 });
	}
};
