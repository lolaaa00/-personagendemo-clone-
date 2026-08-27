import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Personas already in this workspace, plus the caller's own personas that
 * are still personal (workspace_id IS NULL) and so could be added. Powers
 * the Team settings page's assignment picker.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	// group_id/persona_groups(name) lets the picker filter "available" by
	// brand (e.g. HoneyX vs Kids Honey) — like picking which repos to share.
	// persona_groups is owner-scoped RLS, which is exactly right here: the
	// caller filing a persona is always that persona's own owner, so the
	// join only ever surfaces groups they already own.
	const [inRes, availableRes] = await Promise.all([
		locals.supabase
			.from('agents')
			.select('id, name, handle, initial, gradient')
			.eq('workspace_id', params.id)
			.order('name'),
		locals.supabase
			.from('agents')
			.select('id, name, handle, initial, gradient, group_id, persona_groups(name)')
			.eq('user_id', user.id)
			.is('workspace_id', null)
			.order('name')
	]);

	return json({
		success: true,
		inWorkspace: inRes.data ?? [],
		available: availableRes.data ?? []
	});
};

/**
 * File an existing persona into this workspace, or take it back out
 * (agentId + workspaceId: null). Only the persona's OWN user_id can do this
 * — not even a workspace manager — enforced by enforce_agent_update_scope()
 * in the DB; this route just gives that a readable error instead of a raw
 * trigger exception. "Delegated directly from the workspace admin" means
 * the admin decides who's IN the workspace; deciding what's IN it is still
 * the persona owner's call (today, the same dev/agency account either way).
 */
export const POST: RequestHandler = async ({ request, locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { agentId?: string };
	if (!body.agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const { data: agent, error: getErr } = await locals.supabase
		.from('agents')
		.select('id, user_id, workspace_id')
		.eq('id', body.agentId)
		.maybeSingle();
	if (getErr || !agent) {
		return json({ success: false, error: 'Persona not found' }, { status: 404 });
	}
	if (agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Only this persona\'s own owner can move it into a workspace' },
			{ status: 403 }
		);
	}

	const { data, error } = await locals.supabase
		.from('agents')
		.update({ workspace_id: params.id })
		.eq('id', body.agentId)
		.select('id, name, workspace_id')
		.maybeSingle();

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true, agent: data });
};

/** Remove a persona from this workspace (reverts it to personal). Same owner-only rule as adding. */
export const DELETE: RequestHandler = async ({ request, locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { agentId?: string };
	if (!body.agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const { data: agent, error: getErr } = await locals.supabase
		.from('agents')
		.select('id, user_id, workspace_id')
		.eq('id', body.agentId)
		.maybeSingle();
	if (getErr || !agent) {
		return json({ success: false, error: 'Persona not found' }, { status: 404 });
	}
	if (agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Only this persona\'s own owner can remove it from a workspace' },
			{ status: 403 }
		);
	}
	if (agent.workspace_id !== params.id) {
		return json({ success: false, error: 'This persona is not in that workspace' }, { status: 400 });
	}

	const { data, error } = await locals.supabase
		.from('agents')
		.update({ workspace_id: null })
		.eq('id', body.agentId)
		.select('id, name, workspace_id')
		.maybeSingle();

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true, agent: data });
};
