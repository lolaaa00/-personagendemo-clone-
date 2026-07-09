import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');
	const empty = { brief: null, briefId: null, briefName: null, briefs: [] as any[] };
	if (isPlaceholder || !locals.supabase) return empty;

	const { user } = await locals.safeGetSession();
	if (!user) return empty;

	const db = createDbService(locals.supabase);
	const [{ data, error }, listResult] = await Promise.all([
		db.brandBriefs.get(user.id),
		db.brandBriefs.list(user.id)
	]);
	// A real query failure (RLS misconfig, connection issue) must not look
	// identical to "no brief saved yet" — the page has a localStorage fallback
	// for the common case, but a genuine error is worth a server-side trace.
	if (error) console.error('[Brand Brief] Failed to load brief:', error);
	return {
		brief: (data?.data as Record<string, unknown>) ?? null,
		briefId: data?.id ?? null,
		briefName: data?.name ?? null,
		briefs: listResult.data ?? []
	};
};
