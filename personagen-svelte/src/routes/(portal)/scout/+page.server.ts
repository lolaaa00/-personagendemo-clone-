import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

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
		const agentsRes = await fetch('/data/agents.json');
		const rawAgents: any[] = await agentsRes.json();
		agents = rawAgents.map((a) => ({
			...a,
			niche: (a.niche || '').split(' & ')[0] || a.niche,
			engagement_rate: a.engagementRate || parseFloat(a.engagement) || 0,
			active: a.status === 'active',
			connection_count: a.connectionCount ?? 0,
			autonomy_level: a.autonomy_level ?? 'advisor'
		}));
	}

	// Fetch initial trends for the first agent
	let initialTrends: any[] = [];
	if (agents.length > 0) {
		try {
			const res = await fetch('/api/engine?path=personagen-trends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'load', agentId: agents[0].id })
			});
			if (res.ok) {
				const result = await res.json();
				if (result.success && result.data?.trends) {
					initialTrends = result.data.trends;
				}
			}
		} catch (err) {
			console.error('[Scout Server Load] Failed to fetch initial trends:', err);
		}
	}

	return { agents, initialTrends };
};
