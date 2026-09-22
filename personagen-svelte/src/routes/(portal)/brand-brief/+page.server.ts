import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

/**
 * Can the platform research a URL at all?
 *
 * This used to be answered from the USER's saved Firecrawl key. Customer BYOK
 * was withdrawn for Firecrawl on 2026-09-21, so from that moment nobody has one
 * and the client's check resolved false for everyone — which disabled Scrape &
 * Populate for every account while the platform key kept working perfectly.
 * A gate that reads a key nobody can own any more is not a gate, it is an
 * outage.
 *
 * The boolean, and only the boolean, is what the page needs: whether research
 * is available. The key itself never leaves the server.
 */
function firecrawlAvailable(): boolean {
	return ((privateEnv.FIRECRAWL_API_KEY ?? process.env.FIRECRAWL_API_KEY ?? '').trim()).length > 0;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	// The Intelligence wizard used to be `?tab=intel` on this page. Old links,
	// bookmarks and back-button entries must land on the wizard's own route
	// rather than on a tab that no longer exists.
	if (url.searchParams.get('tab') === 'intel') {
		const target = new URL(url);
		target.searchParams.delete('tab');
		redirect(307, `/brand-brief/intel${target.search}`);
	}

	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');
	const empty = {
		brief: null,
		briefId: null,
		briefName: null,
		briefs: [] as any[],
		firecrawlAvailable: firecrawlAvailable()
	};
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
		briefs: listResult.data ?? [],
		firecrawlAvailable: firecrawlAvailable()
	};
};
