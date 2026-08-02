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
	const [postsRes, agentsRes, configsRes] = await Promise.all([
		supabase
			.from('posts')
			.select('*, agents(name, handle, gradient, initial)')
			.eq('user_id', user.id)
			.order('created_at', { ascending: false })
			.limit(500),
		supabase
			.from('agents')
			.select('id, name, handle, gradient, initial, status, is_favorite, is_overseer')
			.eq('user_id', user.id)
			.not('is_overseer', 'is', true)
			.order('created_at', { ascending: false }),
		supabase
			.from('agent_configs')
			.select('agent_id, ugc_character_ref, ugc_reference_kit')
			.eq('user_id', user.id)
	]);

	return {
		posts: postsRes.data ?? [],
		personas: (agentsRes.data ?? []).filter((a: any) => !a.is_overseer),
		kits: configsRes.data ?? []
	};
};
