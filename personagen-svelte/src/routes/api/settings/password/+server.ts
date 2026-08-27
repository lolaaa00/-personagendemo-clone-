import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Change the signed-in account's password. Also clears the
 * must_change_password metadata flag that provisioned team accounts carry —
 * they all start on a shared throwaway password, and the portal blocks with a
 * change-password prompt (see (portal)/+layout.svelte) until this succeeds.
 * No current-password re-entry: the session itself just proved it.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as {
		newPassword?: string;
		confirmPassword?: string;
	};
	const newPassword = body.newPassword || '';
	if (newPassword.length < 8) {
		return json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
	}
	if (newPassword !== body.confirmPassword) {
		return json({ success: false, error: 'The two password fields do not match' }, { status: 400 });
	}
	if (/^password123$/i.test(newPassword)) {
		return json({ success: false, error: 'Pick something other than the starter password' }, { status: 400 });
	}

	const { error } = await locals.supabase.auth.updateUser({
		password: newPassword,
		data: { must_change_password: false }
	});
	if (error) {
		return json({ success: false, error: error.message }, { status: 500 });
	}

	return json({ success: true });
};
