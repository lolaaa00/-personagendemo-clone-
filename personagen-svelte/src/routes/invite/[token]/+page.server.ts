import type { PageServerLoad } from './$types';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { isInviteExpired } from '$lib/server/workspaces';

/**
 * Reachable pre-auth — this is the actual link forwarded over WhatsApp/email.
 * Server-rendered directly (rather than a client fetch to the API route) so
 * the "you've been invited to X" text is there on first paint, no spinner.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const svc = getServiceSupabase();
	const { data: invite } = await svc
		.from('workspace_invites')
		.select('email, role, status, expires_at, workspaces(name)')
		.eq('token', params.token)
		.maybeSingle();

	const { user } = await locals.safeGetSession();

	if (!invite) {
		return { token: params.token, invite: null, viewerEmail: user?.email ?? null };
	}

	return {
		token: params.token,
		invite: {
			email: invite.email,
			role: invite.role,
			status: invite.status,
			expired: isInviteExpired(invite as any),
			workspaceName: (invite as any).workspaces?.name ?? 'a workspace'
		},
		viewerEmail: user?.email ?? null
	};
};
