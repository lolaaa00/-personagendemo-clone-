import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { SIGNIN_HELP_TITLE_PREFIX, TOPUP_PENDING_STATUS } from '$lib/server/topup-requests';

/**
 * "Still nothing? Ask us to help you sign in" — for someone who cannot receive
 * the reset email and has nobody who "gave them access" (a self-signup).
 *
 * The reset page said "ask whoever gave you access", which is no route at all
 * for a person who signed up themselves (round-3 re-audit). This files a
 * private ticket the operator sees in Admin, owned by a platform admin (the
 * requester is signed out, so they own nothing), and the operator can then
 * verify them and issue a temporary password.
 *
 * Anonymous by necessity, so: the answer is IDENTICAL whether or not the
 * address has an account (no account enumeration), one open request per
 * address, and a small per-IP budget.
 */
const WINDOW_MS = 60 * 60 * 1000;
const PER_IP = 5;
const hits = new Map<string, number[]>();

function allow(ip: string): boolean {
	const now = Date.now();
	const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	if (recent.length >= PER_IP) return false;
	recent.push(now);
	hits.set(ip, recent);
	return true;
}

const UNIFORM = {
	success: true,
	message:
		'Request sent. If an account exists for that address, the PersonaGen team will get in touch there to help you sign in.'
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = (await request.json().catch(() => ({}))) as { email?: unknown };
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
		return json({ success: false, error: 'Enter the email address you sign in with.' }, { status: 400 });
	}
	let ip = 'unknown';
	try {
		ip = getClientAddress();
	} catch {
		/* behind a proxy without an address: shared budget */
	}
	if (!allow(ip)) {
		return json({ success: false, error: 'Too many requests from here — try again in an hour.' }, { status: 429 });
	}

	try {
		const svc = getServiceSupabase();
		const { data: admin } = await svc.from('platform_admins').select('user_id').limit(1).maybeSingle();
		if (!admin?.user_id) return json(UNIFORM); // nowhere to file it; never tell the caller
		const title = `${SIGNIN_HELP_TITLE_PREFIX} · ${email}`;
		const { data: open } = await svc
			.from('tickets')
			.select('id')
			.eq('title', title)
			.eq('status', TOPUP_PENDING_STATUS)
			.limit(1)
			.maybeSingle();
		if (!open) {
			await svc.from('tickets').insert({
				user_id: admin.user_id,
				title,
				description: `Someone asked for help signing in as ${email} — the reset email could not reach them. Verify it is really them (reply from your own mail to that address) before issuing a temporary password from Users & Credits.`,
				status: TOPUP_PENDING_STATUS,
				priority: 'high'
			});
		}
	} catch (err) {
		console.error('[support/sign-in-help] could not file:', (err as Error).message);
	}
	return json(UNIFORM);
};
