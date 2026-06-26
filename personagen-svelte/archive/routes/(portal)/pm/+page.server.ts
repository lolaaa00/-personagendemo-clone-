import type { PageServerLoad, Actions } from './$types';
import { createDbService } from '$lib/server/db';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, '/login');
	}

	const db = createDbService(locals.supabase);
	const [agentsRes, ticketsRes] = await Promise.all([db.agents.list(), db.tickets.list()]);

	return {
		agents: agentsRes.data || [],
		tickets: ticketsRes.data || []
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return { success: false, error: 'Unauthorized' };

		const formData = await request.formData();
		const title = String(formData.get('title') || '').trim();
		const description = String(formData.get('description') || '').trim();
		const priority = String(formData.get('priority') || 'medium');
		const assignee_agent_id = String(formData.get('assignee_agent_id') || '') || null;

		if (!title) return { success: false, error: 'Title is required' };

		const db = createDbService(locals.supabase);
		const { data, error } = await db.tickets.create({
			user_id: user.id,
			title,
			description,
			priority: priority as any,
			status: 'backlog',
			assignee_agent_id,
			due_date: null,
			position: 0
		});

		if (error) return { success: false, error: error.message };
		return { success: true, ticket: data };
	},

	update: async ({ request, locals }) => {
		const { session } = await locals.safeGetSession();
		if (!session) return { success: false, error: 'Unauthorized' };

		const formData = await request.formData();
		const id = String(formData.get('id') || '');
		const title = String(formData.get('title') || '').trim();
		const description = String(formData.get('description') || '').trim();
		const priority = String(formData.get('priority') || 'medium');
		const assignee_agent_id = String(formData.get('assignee_agent_id') || '') || null;

		if (!id || !title) return { success: false, error: 'Invalid data' };

		const db = createDbService(locals.supabase);
		const { data, error } = await db.tickets.update(id, {
			title,
			description,
			priority: priority as any,
			assignee_agent_id
		});

		if (error) return { success: false, error: error.message };
		return { success: true, ticket: data };
	},

	move: async ({ request, locals }) => {
		const { session } = await locals.safeGetSession();
		if (!session) return { success: false, error: 'Unauthorized' };

		const formData = await request.formData();
		const id = String(formData.get('id') || '');
		const status = String(formData.get('status') || 'backlog');

		if (!id) return { success: false, error: 'Invalid ticket ID' };

		const db = createDbService(locals.supabase);
		const { data, error } = await db.tickets.update(id, {
			status: status as any
		});

		if (error) return { success: false, error: error.message };
		return { success: true, ticket: data };
	},

	delete: async ({ request, locals }) => {
		const { session } = await locals.safeGetSession();
		if (!session) return { success: false, error: 'Unauthorized' };

		const formData = await request.formData();
		const id = String(formData.get('id') || '');

		if (!id) return { success: false, error: 'Invalid ticket ID' };

		const db = createDbService(locals.supabase);
		const { error } = await db.tickets.delete(id);

		if (error) return { success: false, error: error.message };
		return { success: true };
	}
};
