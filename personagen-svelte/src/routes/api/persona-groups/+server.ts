import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';

const NAME_MAX = 60;

/**
 * Projects (persona groups) CRUD + membership. Every query is scoped to the
 * session user both here and by RLS, so a stray id from another account
 * matches nothing.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as any;
	const { action } = body;
	if (!action) return json({ success: false, error: 'Missing action' }, { status: 400 });

	const db = createDbService(locals.supabase);

	try {
		if (action === 'list') {
			const { data, error } = await db.personaGroups.list(user.id);
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'create') {
			const name = String(body.name ?? '').trim();
			if (!name) return json({ success: false, error: 'Project name is required' }, { status: 400 });
			if (name.length > NAME_MAX) {
				return json({ success: false, error: `Project name must be ${NAME_MAX} characters or fewer` }, { status: 400 });
			}
			const { data, error } = await db.personaGroups.create(user.id, name);
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'rename') {
			const { id } = body;
			const name = String(body.name ?? '').trim();
			if (!id) return json({ success: false, error: 'Missing project id' }, { status: 400 });
			if (!name) return json({ success: false, error: 'Project name is required' }, { status: 400 });
			if (name.length > NAME_MAX) {
				return json({ success: false, error: `Project name must be ${NAME_MAX} characters or fewer` }, { status: 400 });
			}
			const { data, error } = await db.personaGroups.rename(id, user.id, name);
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'delete') {
			const { id } = body;
			if (!id) return json({ success: false, error: 'Missing project id' }, { status: 400 });
			// agents.group_id is ON DELETE SET NULL — personas survive, just ungrouped.
			const { error } = await db.personaGroups.delete(id, user.id);
			if (error) throw error;
			return json({ success: true });
		}

		if (action === 'assign') {
			// Move one or more personas into a project (or out of all, group_id: null).
			const agentIds: string[] = Array.isArray(body.agent_ids)
				? body.agent_ids.filter((v: unknown) => typeof v === 'string' && v)
				: body.agent_id
					? [String(body.agent_id)]
					: [];
			const groupId: string | null = body.group_id ?? null;

			if (agentIds.length === 0) {
				return json({ success: false, error: 'No personas supplied' }, { status: 400 });
			}
			if (agentIds.length > 100) {
				return json({ success: false, error: 'Too many personas (max 100 per request)' }, { status: 400 });
			}

			if (groupId) {
				const { data: group, error: groupErr } = await db.personaGroups.get(groupId, user.id);
				if (groupErr || !group) {
					return json({ success: false, error: 'Project not found' }, { status: 404 });
				}
			}

			// user_id scoping makes ownership implicit — a foreign agent id updates 0 rows.
			const { data, error } = await locals.supabase
				.from('agents')
				.update({ group_id: groupId })
				.in('id', agentIds)
				.eq('user_id', user.id)
				.select('id, group_id');
			if (error) throw error;
			return json({ success: true, updated: data?.length ?? 0 });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Persona Groups API] Error:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
