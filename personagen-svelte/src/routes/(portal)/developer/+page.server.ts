import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');

	const { data: keys } = await locals.supabase
		.from('api_keys')
		.select('id, label, key_prefix, last_used_at, revoked_at, created_at')
		.order('created_at', { ascending: false });

	return {
		keys: keys ?? [],
		viewerEmail: user.email ?? null
	};
};
