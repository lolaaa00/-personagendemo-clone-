import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { PROBLEM_REPORT_TITLE_PREFIX, TOPUP_TITLE_PREFIX } from '$lib/server/topup-requests';

/**
 * Close a customer request — a top-up the operator has loaded, or a problem
 * report they have dealt with. Without it a fulfilled request sat in the
 * Admin list forever, and in the customer's "pending" list on Billing (round-2
 * re-audit: "no close path"). Platform admin only; only these two kinds of
 * ticket, by their title prefix, can be closed here.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	const body = (await request.json().catch(() => ({}))) as { ticketId?: unknown };
	const ticketId =
		typeof body.ticketId === 'string' && /^[0-9a-f-]{36}$/i.test(body.ticketId) ? body.ticketId : null;
	if (!ticketId) return json({ success: false, error: 'Which request?' }, { status: 400 });

	const svc = getServiceSupabase();
	const { data, error } = await svc
		.from('tickets')
		.update({ status: 'done' })
		.eq('id', ticketId)
		.or(`title.like.${TOPUP_TITLE_PREFIX}%,title.like.${PROBLEM_REPORT_TITLE_PREFIX}%`)
		.select('id')
		.maybeSingle();
	if (error) {
		console.error('[admin/requests] close failed:', error.message);
		return json({ success: false, error: 'Could not close it. Try again.' }, { status: 500 });
	}
	if (!data) return json({ success: false, error: 'No such open request.' }, { status: 404 });
	return json({ success: true });
};
