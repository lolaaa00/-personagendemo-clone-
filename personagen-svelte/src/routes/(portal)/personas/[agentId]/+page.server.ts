import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { resolvePersonaGender } from '$lib/server/content/generate';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, params }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();
		if (!dbAgents) throw error(500, 'Failed to load agents');

		const agent = dbAgents.find((a: any) => a.id === params.agentId);
		if (!agent) throw error(404, 'Agent not found');

		const supervisors = dbAgents.filter((a: any) => a.is_overseer);
		const { user } = await locals.safeGetSession();
		const [{ data: config }, briefsResult] = await Promise.all([
			db.agentConfigs.get(params.agentId),
			// Multi-brand: the Profile tab's brief picker lists every brief the
			// user has saved (e.g. "Just Kids Honey", "HoneyX Manly Plus").
			user ? db.brandBriefs.list(user.id) : Promise.resolve({ data: [] as any[] })
		]);

		return {
			agent: {
				...agent,
				timezone: config?.timezone ?? 'Australia/Sydney',
				posts_per_day: config?.posts_per_day ?? 3,
				active_hours_start: config?.active_hours_start ?? 8,
				active_hours_end: config?.active_hours_end ?? 22,
				autonomy_level: config?.autonomy_level ?? 'advisor',
				rss_url: config?.rss_url ?? '',
				rss_active: config?.rss_active ?? false,
				rss_last_polled_at: config?.rss_last_polled_at ?? null,
				ugc_voice: config?.ugc_voice ?? 'Adam',
				ugc_character_ref: config?.ugc_character_ref ?? null,
				ugc_reference_kit: config?.ugc_reference_kit ?? {},
				brand_brief_id: config?.brand_brief_id ?? null
			},
			supervisors,
			brandBriefs: briefsResult.data ?? [],
			// Gender the server WILL use at generation time when the explicit
			// field is blank (inferred from the soul/name). The Profile tab uses
			// this to pre-fill the picker so what's shown matches what generates
			// — no more "why is my female persona voiced as Adam".
			inferredGender: resolvePersonaGender(agent) ?? null
		};
	}

	return { agent: null, supervisors: [], brandBriefs: [], inferredGender: null };
};
