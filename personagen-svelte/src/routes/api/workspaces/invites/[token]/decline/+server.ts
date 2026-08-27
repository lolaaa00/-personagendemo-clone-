import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/service-supabase';

/** Declining is symmetric with accept — same privileged path, no membership row created. */
export const POST: RequestHandler = async ({ params, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user || !user.email) {
		return json({ success: false, error: 'Log in first.' }, { status: 401 });
	}

	const svc = getServiceSupabase();
	const { data: invite, error: getErr } = await svc
		.from('workspace_invites')
		.select('id, email, status')
		.eq('token', params.token)
		.maybeSingle();

	if (getErr || !invite) {
		return json({ success: false, error: 'This invite link is invalid.' }, { status: 404 });
	}
	if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
		return json({ success: false, error: 'This invite is not addressed to you.' }, { status: 403 });
	}
	if (invite.status !== 'pending') {
		return json({ success: true }); // already resolved one way or another — treat as done
	}

	await svc.from('workspace_invites').update({ status: 'revoked' }).eq('id', invite.id);
	return json({ success: true });
};
