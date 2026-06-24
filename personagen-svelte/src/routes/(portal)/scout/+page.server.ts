import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hasDb = false;

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		if (dbAgents && dbAgents.length > 0) {
			hasDb = true;
			const creators = dbAgents.filter((a) => !a.is_overseer);
			agents = creators.map((a) => ({
				...a,
				niche: (a.niche || '').split(' & ')[0] || a.niche,
				engagement_rate: parseFloat(a.engagement_rate as any) || 0,
				active: a.status === 'active',
				connection_count: a.connection_count ?? 0,
				autonomy_level: a.autonomy_level ?? 'advisor'
			}));
		}
	}

	if (!hasDb) {
		agents = [];
	}

	return { agents, initialTrends: [] };
};
