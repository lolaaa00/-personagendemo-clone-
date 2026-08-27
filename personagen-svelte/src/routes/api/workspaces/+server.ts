import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET  — everything the current account needs to render the Team settings
 *        section: workspaces they own, workspaces they're a seat in, and
 *        any pending invites addressed to their (verified) email.
 * POST — create a new brand workspace, owned by the caller.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const [ownedRes, membershipsRes, invitesRes] = await Promise.all([
		locals.supabase.from('workspaces').select('*').eq('owner_id', user.id).order('created_at'),
		locals.supabase
			.from('workspace_members')
			.select('workspace_id, role, created_at, workspaces(id, name, owner_id)')
			.eq('user_id', user.id),
		// RLS scopes this to invites matching the caller's verified JWT email.
		locals.supabase
			.from('workspace_invites')
			.select('id, workspace_id, role, status, expires_at, created_at, workspaces(name)')
			.eq('status', 'pending')
			.order('created_at', { ascending: false })
	]);

	if (ownedRes.error) {
		return json({ success: false, error: ownedRes.error.message }, { status: 500 });
	}

	const pendingInvites = (invitesRes.data ?? []).filter(
		(i: any) => !i.expires_at || new Date(i.expires_at).getTime() > Date.now()
	);

	return json({
		success: true,
		owned: ownedRes.data ?? [],
		memberships: membershipsRes.data ?? [],
		pendingInvites
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { name?: string };
	const name = (body.name || '').trim();
	if (!name || name.length > 120) {
		return json({ success: false, error: 'Workspace name must be 1-120 characters' }, { status: 400 });
	}

	const { data, error } = await locals.supabase
		.from('workspaces')
		.insert({ owner_id: user.id, name })
		.select()
		.single();

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true, workspace: data });
};
