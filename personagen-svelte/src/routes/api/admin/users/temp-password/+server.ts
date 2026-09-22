import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'node:crypto';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { logActivity } from '$lib/server/activity';

/**
 * Issue a one-time temporary password for an account — platform admin only.
 *
 * Password recovery depends on email, and a deployment whose auth server has
 * no mail transport configured cannot send the reset link at all: the UI said
 * "a reset link is on its way" while the server logged "Error sending recovery
 * email", and nothing anywhere could get the user back in (round-2 re-audit).
 * This is the operator's way out, independent of email.
 *
 * The password is generated here, returned ONCE in this response for the
 * admin to hand over privately, and never stored or logged. The account is
 * flagged `must_change_password`, so the portal's first-password gate makes
 * the user replace it before they can do anything else.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	const body = (await request.json().catch(() => ({}))) as { userId?: unknown };
	const userId =
		typeof body.userId === 'string' && /^[0-9a-f-]{36}$/i.test(body.userId) ? body.userId : null;
	if (!userId) return json({ success: false, error: 'Which account?' }, { status: 400 });

	const svc = getServiceSupabase();
	const { data: found, error: getErr } = await svc.auth.admin.getUserById(userId);
	if (getErr || !found?.user) return json({ success: false, error: 'No such account.' }, { status: 404 });

	// 18 url-safe characters (~108 bits): long enough that no policy rejects it,
	// short enough to read out once.
	const password = randomBytes(14).toString('base64url').slice(0, 18);
	const { error } = await svc.auth.admin.updateUserById(userId, {
		password,
		user_metadata: { ...(found.user.user_metadata ?? {}), must_change_password: true }
	});
	if (error) {
		console.error('[admin/temp-password] update failed:', error.message);
		return json({ success: false, error: 'The password could not be set. Try again.' }, { status: 500 });
	}

	logActivity(locals, gate.user.id, {
		action: 'admin.user.password_reset',
		actorKind: 'admin',
		targetUserId: userId,
		meta: { method: 'temporary_password' }
	});
	return json({ success: true, email: found.user.email ?? null, password });
};
