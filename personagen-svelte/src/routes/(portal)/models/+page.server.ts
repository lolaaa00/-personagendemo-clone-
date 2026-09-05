import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { loadRegistry } from '$lib/server/model-registry';
import { isPlatformAdmin } from '$lib/server/platform-admin';

/** Model Manager — the registry rows (seeded from the wired catalog on first visit).
 *  Platform-admin only: the registry is a platform-level pricing surface. */
export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');
	if (!(await isPlatformAdmin(locals.supabase, user))) throw redirect(303, '/dashboard');

	try {
		const rows = await loadRegistry(locals.supabase, user.id);
		return { rows, loadError: null };
	} catch (e) {
		console.error('[Models page] Failed to load registry:', e);
		return {
			rows: [],
			loadError: 'Could not load the model registry. Generation still runs on the built-in catalog.'
		};
	}
};
