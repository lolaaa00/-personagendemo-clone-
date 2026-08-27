import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Trashed posts stay restorable this long — must match the scheduler's sweep. */
const RETENTION_DAYS = 30;

/**
 * Everything currently in the Trash. This is the ONLY loader in the app that
 * reads `deleted_at IS NOT NULL`; every other posts query filters trashed rows
 * out, which is what keeps a deleted post from being published, counted in
 * analytics, or shown in a feed.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');

	const { data: postsRes, error } = await locals.supabase
		.from('posts')
		.select('*, agents(name, handle, gradient, initial)')
		.not('deleted_at', 'is', null)
		.order('deleted_at', { ascending: false })
		.limit(500);

	if (error) {
		console.error('[Trash] Failed to load trashed posts:', error.message);
	}

	return {
		trashed: postsRes ?? [],
		retentionDays: RETENTION_DAYS,
		loadError: error?.message ?? null
	};
};
