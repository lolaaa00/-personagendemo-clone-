import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals, params }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	const composioKey = privateEnv.COMPOSIO_API_KEY || '';
	const isComposioConfigured = Boolean(
		composioKey &&
		!composioKey.includes('placeholder') &&
		!composioKey.includes('change_me')
	);

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();
		if (!dbAgents) throw error(500, 'Failed to load agents');

		const agent = dbAgents.find((a: any) => a.id === params.agentId);
		if (!agent) throw error(404, 'Agent not found');

		const supervisors = dbAgents.filter((a: any) => a.is_overseer);
		const { data: config } = await db.agentConfigs.get(params.agentId);

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
				rss_last_polled_at: config?.rss_last_polled_at ?? null
			},
			supervisors,
			isComposioConfigured
		};
	}

	return { agent: null, supervisors: [], isComposioConfigured: false };
};
