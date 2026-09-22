import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { packById } from '$lib/billing-packs';
import { TOPUP_PENDING_STATUS, TOPUP_TITLE_PREFIX } from '$lib/server/topup-requests';

/**
 * Ask for a wallet top-up while card payments are switched off.
 *
 * A client audit (UX-004) found no in-product way to add credit; the fix put
 * an "Ask us to load $X" link on each disabled pack — and the re-audit found
 * that link landed on the PUBLIC feature-voting board, dropped the amount, and
 * said nothing about top-ups. A request for money belongs to the account that
 * makes it, not on a board other customers read.
 *
 * It is written to `tickets`, which is private by row-level security (a user
 * reads, updates and deletes only their own) and is otherwise unused, through
 * the caller's OWN client — so the insert is subject to the same policy. The
 * platform admin sees open requests in the Admin Console (service role).
 *
 * Idempotent per pack for a day: a second click on the same pack returns the
 * request already open instead of filing another.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Sign in first.' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { packId?: string };
	const pack = packById(body.packId);
	if (!pack) return json({ success: false, error: 'Pick one of the packs on this page.' }, { status: 400 });

	const usd = `$${(pack.usdCents / 100).toFixed(2)}`;
	const title = `${TOPUP_TITLE_PREFIX} · ${pack.label} ${usd}`;
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

	const { data: existing } = await locals.supabase
		.from('tickets')
		.select('id, title, created_at')
		.eq('user_id', user.id)
		.eq('status', TOPUP_PENDING_STATUS)
		.eq('title', title)
		.gte('created_at', since)
		.limit(1)
		.maybeSingle();
	if (existing) {
		return json({ success: true, request: existing, duplicate: true });
	}

	const { data: created, error } = await locals.supabase
		.from('tickets')
		.insert({
			user_id: user.id,
			title,
			description: `Load the ${pack.label} pack (${usd} → ${pack.credits.toLocaleString('en-US')} credits) into the wallet of ${user.email ?? user.id}. Requested from Billing while card payments are off.`,
			status: TOPUP_PENDING_STATUS,
			priority: 'high'
		})
		.select('id, title, created_at')
		.single();

	if (error) {
		console.error('[billing/request-topup] insert failed:', error.message);
		return json(
			{ success: false, error: 'The request could not be saved. Try again in a moment.' },
			{ status: 500 }
		);
	}
	return json({ success: true, request: created, duplicate: false });
};
