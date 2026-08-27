import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { isInviteExpired } from '$lib/server/workspaces';

/**
 * Accepting an invite has to run privileged: the invited user can read
 * "their" invite by email (RLS), but INSERTing into workspace_members is
 * owner-only from the client — there's no policy that lets a brand-new
 * member add themselves. Service-role bridges that one step, after
 * re-verifying everything a client policy would have checked anyway.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user || !user.email) {
		return json({ success: false, error: 'Log in first to accept this invite.' }, { status: 401 });
	}

	const svc = getServiceSupabase();
	const { data: invite, error: getErr } = await svc
		.from('workspace_invites')
		.select('*')
		.eq('token', params.token)
		.maybeSingle();

	if (getErr || !invite) {
		return json({ success: false, error: 'This invite link is invalid.' }, { status: 404 });
	}
	if (invite.status !== 'pending') {
		return json({ success: false, error: `This invite has already been ${invite.status}.` }, { status: 409 });
	}
	if (isInviteExpired(invite)) {
		return json({ success: false, error: 'This invite has expired.' }, { status: 410 });
	}
	if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
		return json(
			{
				success: false,
				error: `This invite is for ${invite.email} — you're logged in as ${user.email}.`
			},
			{ status: 403 }
		);
	}

	const { error: memberErr } = await svc
		.from('workspace_members')
		.upsert(
			{ workspace_id: invite.workspace_id, user_id: user.id, role: invite.role, invited_by: invite.invited_by },
			{ onConflict: 'workspace_id,user_id' }
		);
	if (memberErr) {
		return json({ success: false, error: memberErr.message }, { status: 500 });
	}

	await svc
		.from('workspace_invites')
		.update({ status: 'accepted', accepted_by: user.id, accepted_at: new Date().toISOString() })
		.eq('id', invite.id);

	const { data: workspace } = await svc
		.from('workspaces')
		.select('id, name')
		.eq('id', invite.workspace_id)
		.maybeSingle();

	return json({ success: true, workspace, role: invite.role });
};
