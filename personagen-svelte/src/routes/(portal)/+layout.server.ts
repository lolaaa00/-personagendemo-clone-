import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { checkConfigStatus } from '$lib/server/config-check';
import { createDbService } from '$lib/server/db';

export const load: LayoutServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (isPlaceholder) {
		return { session: null, user: null, configStatus: checkConfigStatus(), sidebarAgents: [] };
	}

	try {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) throw redirect(303, '/login');

		let sidebarAgents: any[] = [];
		if (locals.supabase) {
			const db = createDbService(locals.supabase);
			const { data: agents } = await db.agents.list();
			const creatorAgents = (agents ?? []).filter((a: any) => !a.is_overseer);

			const agentIds = creatorAgents.map((a: any) => a.id);
			const { data: configs } = agentIds.length
				? await locals.supabase.from('agent_configs').select('agent_id, ugc_character_ref').in('agent_id', agentIds)
				: { data: [] };
			const characterRefById = new Map((configs ?? []).map((c: any) => [c.agent_id, c.ugc_character_ref]));

			sidebarAgents = creatorAgents.map((a: any) => ({
				id: a.id,
				name: a.name,
				handle: a.handle,
				initial: a.initial,
				gradient: a.gradient,
				status: a.status,
				ugc_character_ref: characterRefById.get(a.id) ?? null
			}));
		}

		return {
			session,
			user,
			configStatus: checkConfigStatus(),
			sidebarAgents
		};
	} catch (e) {
		if ((e as any)?.status === 303) throw e;
		console.error('Portal layout auth error:', e);
		return {
			session: null,
			user: null,
			configStatus: checkConfigStatus(),
			sidebarAgents: []
		};
	}
};
