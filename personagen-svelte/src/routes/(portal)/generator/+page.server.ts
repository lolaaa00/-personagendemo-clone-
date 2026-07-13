import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) return { brandBriefs: [] as Array<{ id: string; name: string }> };

	const db = createDbService(locals.supabase);
	const { data: briefs } = await db.brandBriefs.list(user.id);
	// Newest-first list for the generator's brand picker (id + name is all the UI needs).
	return { brandBriefs: (briefs ?? []) as Array<{ id: string; name: string }> };
};
