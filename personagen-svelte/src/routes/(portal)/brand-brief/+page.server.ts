import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');
	if (isPlaceholder || !locals.supabase) return { brief: null };

	const { user } = await locals.safeGetSession();
	if (!user) return { brief: null };

	const db = createDbService(locals.supabase);
	const { data } = await db.brandBriefs.get(user.id);
	return { brief: (data?.data as Record<string, unknown>) ?? null };
};
