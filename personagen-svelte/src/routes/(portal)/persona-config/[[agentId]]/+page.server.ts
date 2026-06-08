import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		if (dbAgents && dbAgents.length > 0) {
			const agentsWithConfig = [];
			for (const agent of dbAgents) {
				const { data: config } = await db.agentConfigs.get(agent.id);
				agentsWithConfig.push({
					...agent,
					// Attach config properties directly or as config object
					timezone: config?.timezone ?? 'Australia/Sydney',
					posts_per_day: config?.posts_per_day ?? 3,
					active_hours_start: config?.active_hours_start ?? 8,
					active_hours_end: config?.active_hours_end ?? 22,
					autonomy_level: config?.autonomy_level ?? 'advisor',
					rss_url: config?.rss_url ?? '',
					rss_active: config?.rss_active ?? false,
					rss_last_polled_at: config?.rss_last_polled_at ?? null
				});
			}
			return { agents: agentsWithConfig };
		}
	}

	// Fallback to static JSON
	const res = await fetch('/data/agents.json');
	const agents = await res.json();
	return { agents };
};
