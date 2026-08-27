import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * All Generations — the user's whole library in one place, split into two
 * different kinds of output:
 *   - content:  posts (the actual generation outputs that get published)
 *   - profile:  the assets that BUILD each persona (profile picture +
 *               identity/reference kit) — never published as content
 */
export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');

	const supabase = locals.supabase;
	// No .eq('user_id', ...) on any of these three — RLS (agent_access_role /
	// posts_select_own / agent_configs_select_own) already scopes each table to
	// exactly "own it, or have workspace access to it". Filtering by user_id
	// here on top of that would hide a teammate's content on a shared
	// workspace persona (e.g. HoneyX's own personas, from Monarch's view) even
	// though the whole point of a workspace is that every seat can see it.
	const [postsRes, agentsRes, configsRes] = await Promise.all([
		supabase
			.from('posts')
			.select('*, agents(name, handle, gradient, initial)')
			.is('deleted_at', null)
			.order('created_at', { ascending: false })
			.limit(500),
		supabase
			.from('agents')
			.select('id, name, handle, gradient, initial, status, is_favorite, is_overseer, workspace_id')
			.not('is_overseer', 'is', true)
			.order('created_at', { ascending: false }),
		supabase.from('agent_configs').select('agent_id, ugc_character_ref, ugc_reference_kit')
	]);

	return {
		posts: postsRes.data ?? [],
		personas: (agentsRes.data ?? []).filter((a: any) => !a.is_overseer),
		kits: configsRes.data ?? []
	};
};
