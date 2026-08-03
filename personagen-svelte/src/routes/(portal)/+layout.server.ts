import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { checkConfigStatus } from '$lib/server/config-check';

export const load: LayoutServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (isPlaceholder) {
		return {
			session: null,
			user: null,
			configStatus: checkConfigStatus(),
			sidebarAgents: [],
			personaGroups: []
		};
	}

	try {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) throw redirect(303, '/login');

		let sidebarAgents: any[] = [];
		let personaGroups: any[] = [];
		if (locals.supabase) {
			// Lean projection: the sidebar roster only renders these fields (see
			// +layout.svelte) — never the large soul/skills/tools/market text, so
			// don't ship every agent's full row on every navigation. Pages that
			// need full agent rows load them in their own server loads.
			// `is_overseer IS NOT TRUE` matches the old `!a.is_overseer` filter
			// (keeps rows where the column is false OR null).
			const [{ data: agents }, { data: groups }] = await Promise.all([
				locals.supabase
					.from('agents')
					.select('id, name, handle, initial, gradient, status, is_overseer, group_id, is_favorite')
					.not('is_overseer', 'is', true)
					.order('created_at', { ascending: false }),
				locals.supabase
					.from('persona_groups')
					.select('id, name')
					.eq('user_id', user.id)
					.order('name', { ascending: true })
			]);
			personaGroups = groups ?? [];
			const creatorAgents = (agents ?? []).filter((a: any) => !a.is_overseer);

			const agentIds = creatorAgents.map((a: any) => a.id);
			const { data: configs } = agentIds.length
				? await locals.supabase
						.from('agent_configs')
						.select('agent_id, ugc_character_ref')
						.in('agent_id', agentIds)
				: { data: [] };
			const characterRefById = new Map(
				(configs ?? []).map((c: any) => [c.agent_id, c.ugc_character_ref])
			);

			sidebarAgents = creatorAgents.map((a: any) => ({
				id: a.id,
				name: a.name,
				handle: a.handle,
				initial: a.initial,
				gradient: a.gradient,
				status: a.status,
				group_id: a.group_id ?? null,
				is_favorite: a.is_favorite ?? false,
				ugc_character_ref: characterRefById.get(a.id) ?? null
			}));
		}

		return {
			session,
			user,
			configStatus: checkConfigStatus(),
			sidebarAgents,
			personaGroups
		};
	} catch (e) {
		if ((e as any)?.status === 303) throw e;
		console.error('Portal layout auth error:', e);
		return {
			session: null,
			user: null,
			configStatus: checkConfigStatus(),
			sidebarAgents: [],
			personaGroups: []
		};
	}
};
