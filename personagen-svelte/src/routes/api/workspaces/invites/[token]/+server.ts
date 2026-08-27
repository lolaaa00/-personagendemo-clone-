import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { isInviteExpired } from '$lib/server/workspaces';

/**
 * Public-ish invite lookup: reachable pre-auth so a freshly-clicked
 * WhatsApp/email link can render "you've been invited to X" before the
 * person has even logged in. The token itself is the secret (24 random
 * bytes) — this only ever returns the minimum needed to render that screen,
 * never the workspace's other data.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const svc = getServiceSupabase();
	const { data: invite, error: getErr } = await svc
		.from('workspace_invites')
		.select('id, email, role, status, expires_at, workspace_id, workspaces(name)')
		.eq('token', params.token)
		.maybeSingle();

	if (getErr || !invite) {
		return json({ success: false, error: 'This invite link is invalid.' }, { status: 404 });
	}

	const { user } = await locals.safeGetSession();

	return json({
		success: true,
		invite: {
			email: invite.email,
			role: invite.role,
			status: invite.status,
			expired: isInviteExpired(invite as any),
			workspaceName: (invite as any).workspaces?.name ?? 'a workspace'
		},
		// Lets the client decide: "log in as X" vs "you're logged in as the
		// wrong account" vs "log in / sign up" (no session at all).
		viewer: user ? { email: user.email ?? null } : null
	});
};
