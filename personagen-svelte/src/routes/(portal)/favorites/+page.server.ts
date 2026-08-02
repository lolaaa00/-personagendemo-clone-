import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/** My Favorites — everything the user hearted: posts and personas. */
export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');

	const supabase = locals.supabase;
	const [postsRes, agentsRes, groupsRes, configsRes] = await Promise.all([
		supabase
			.from('posts')
			.select('*, agents(name, handle, gradient, initial)')
			.eq('user_id', user.id)
			.eq('is_favorite', true)
			.order('created_at', { ascending: false })
			.limit(500),
		supabase
			.from('agents')
			.select('id, name, handle, niche, gradient, initial, status, is_favorite, group_id, is_overseer')
			.eq('user_id', user.id)
			.eq('is_favorite', true)
			.not('is_overseer', 'is', true)
			.order('name', { ascending: true }),
		supabase.from('persona_groups').select('id, name').eq('user_id', user.id),
		supabase.from('agent_configs').select('agent_id, ugc_character_ref').eq('user_id', user.id)
	]);

	return {
		favoritePosts: postsRes.data ?? [],
		favoritePersonas: (agentsRes.data ?? []).filter((a: any) => !a.is_overseer),
		groups: groupsRes.data ?? [],
		configs: configsRes.data ?? []
	};
};
