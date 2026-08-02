import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

/**
 * The wizard seeds itself from the active brand brief, so it needs the same
 * server-side read the brief editor does. `+page.server.ts` of the parent route
 * does not cascade to children, hence the duplication.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');
	const empty = { brief: null, briefId: null, briefName: null };
	if (isPlaceholder || !locals.supabase) return empty;

	const { user } = await locals.safeGetSession();
	if (!user) return empty;

	const db = createDbService(locals.supabase);
	const { data, error } = await db.brandBriefs.get(user.id);
	if (error) console.error('[Intel Wizard] Failed to load brief:', error);
	return {
		brief: (data?.data as Record<string, unknown>) ?? null,
		briefId: data?.id ?? null,
		briefName: data?.name ?? null
	};
};
