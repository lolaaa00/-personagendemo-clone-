import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { logActivity } from '$lib/server/activity';
import { CREDIT_PACKS } from '$lib/billing-packs';
import {
	PROBLEM_REPORT_TITLE_PREFIX,
	SIGNIN_HELP_TITLE_PREFIX,
	TOPUP_TITLE_PREFIX
} from '$lib/server/topup-requests';

/**
 * Close a customer request — platform admin only.
 *
 * A TOP-UP is not closed, it is FULFILLED: the pack named in the request is
 * granted to the requester's wallet, and only then is the ticket closed. The
 * first version closed it and loaded nothing — the balance stayed put and the
 * pending line just vanished (round-3 re-audit). The grant runs through
 * credit_apply() keyed on the ticket, so a double click or a retry can never
 * load it twice.
 *
 * Problem reports and sign-in help requests are simply marked handled. Only
 * these three kinds of ticket, by title prefix, can be touched here (checked
 * in code: a PostgREST `or()` cannot carry the spaced prefixes).
 */
const usdOf = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const POST: RequestHandler = async ({ request, locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	const body = (await request.json().catch(() => ({}))) as { ticketId?: unknown };
	const ticketId =
		typeof body.ticketId === 'string' && /^[0-9a-f-]{36}$/i.test(body.ticketId) ? body.ticketId : null;
	if (!ticketId) return json({ success: false, error: 'Which request?' }, { status: 400 });

	const svc = getServiceSupabase();
	const { data: ticket } = await svc
		.from('tickets')
		.select('id, title, user_id')
		.eq('id', ticketId)
		.maybeSingle();
	const title = String(ticket?.title ?? '');
	const kinds = [TOPUP_TITLE_PREFIX, PROBLEM_REPORT_TITLE_PREFIX, SIGNIN_HELP_TITLE_PREFIX];
	if (!ticket || !kinds.some((x) => title.startsWith(x))) {
		return json({ success: false, error: 'No such open request.' }, { status: 404 });
	}

	let loaded: { credits: number; label: string } | null = null;
	if (title.startsWith(TOPUP_TITLE_PREFIX)) {
		const pack = CREDIT_PACKS.find(
			(p) => title === `${TOPUP_TITLE_PREFIX} · ${p.label} ${usdOf(p.usdCents)}`
		);
		if (!pack) {
			return json(
				{ success: false, error: 'This request names no known pack — grant it from Users & Credits instead.' },
				{ status: 409 }
			);
		}
		const { error: grantErr } = await svc.rpc('credit_apply', {
			p_user: ticket.user_id,
			p_delta: pack.credits,
			p_kind: 'grant',
			p_note: `Top-up request loaded: ${pack.label} ${usdOf(pack.usdCents)}`,
			p_actor: gate.user.id,
			p_stripe_event: `topup-request:${ticket.id}`,
			p_allow_negative: false
		});
		const duplicate =
			!!grantErr && /duplicate key|23505|unique constraint/i.test(`${grantErr.message} ${grantErr.code ?? ''}`);
		if (grantErr && !duplicate) {
			console.error('[admin/requests] top-up grant failed:', grantErr.message);
			return json(
				{ success: false, error: 'The credit could not be loaded. Nothing changed — try again.' },
				{ status: 500 }
			);
		}
		loaded = { credits: pack.credits, label: `${pack.label} ${usdOf(pack.usdCents)}` };
		logActivity(locals, gate.user.id, {
			action: 'admin.credits.granted',
			actorKind: 'admin',
			targetUserId: ticket.user_id,
			creditsDelta: duplicate ? 0 : pack.credits,
			meta: { note: `top-up request ${ticket.id}`, duplicate }
		});
	}

	const { error } = await svc.from('tickets').update({ status: 'done' }).eq('id', ticketId);
	if (error) {
		console.error('[admin/requests] close failed:', error.message);
		return json({ success: false, error: 'Could not close it. Try again.' }, { status: 500 });
	}
	return json({ success: true, loaded });
};
