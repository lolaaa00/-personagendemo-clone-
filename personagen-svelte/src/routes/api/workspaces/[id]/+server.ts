import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Rename a workspace. Owner-only — enforced by RLS (workspaces_update_own). */
export const PATCH: RequestHandler = async ({ request, locals, params }) => {
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
		.update({ name })
		.eq('id', params.id)
		.select()
		.maybeSingle();

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	if (!data) return json({ success: false, error: 'Workspace not found or ownership mismatch' }, { status: 404 });
	return json({ success: true, workspace: data });
};

/**
 * Delete a workspace. Owner-only (RLS). Every persona filed under it
 * (agents.workspace_id) reverts to a personal persona via ON DELETE SET
 * NULL — nothing about the persona itself is touched, seats simply lose
 * access to it.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const { error, count } = await locals.supabase
		.from('workspaces')
		.delete({ count: 'exact' })
		.eq('id', params.id);

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	if (!count) return json({ success: false, error: 'Workspace not found or ownership mismatch' }, { status: 404 });
	return json({ success: true });
};
