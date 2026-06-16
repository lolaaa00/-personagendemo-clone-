import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let dbPosts: any[] = [];
	let hasDb = false;

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		if (dbAgents && dbAgents.length > 0) {
			hasDb = true;

			// Fetch active platform connections
			const { data: dbConnections } = await locals.supabase
				.from('connections')
				.select('agent_id, platform');

			const creators = dbAgents.filter((a) => !a.is_overseer && a.status === 'active');
			agents = creators.map((a) => {
				const agentConns = dbConnections?.filter(c => c.agent_id === a.id) || [];
				const connectedPlatforms = agentConns.map(c => c.platform);
				return {
					...a,
					niche: (a.niche || '').split(' & ')[0] || a.niche,
					engagementRate: parseFloat(a.engagement_rate as any) || 0,
					engagement_rate: parseFloat(a.engagement_rate as any) || 0,
					active: a.status === 'active',
					connection_count: a.connection_count ?? 0,
					autonomy_level: a.autonomy_level ?? 'advisor',
					connected_platforms: connectedPlatforms
				};
			});

			// Fetch real database posts
			const { data: postsRes, error } = await locals.supabase
				.from('posts')
				.select('*, agents(name)');

			if (!error && postsRes) {
				const activeAgentIds = new Set(agents.map(a => a.id));
				dbPosts = postsRes.filter(p => activeAgentIds.has(p.agent_id));
			}
		}
	}

	if (!hasDb) {
		// Fallback static agents
		const agentsRes = await fetch('/data/agents.json');
		const rawAgents: any[] = await agentsRes.json();
		agents = rawAgents.filter((a) => a.status === 'active').map((a) => ({
			...a,
			niche: (a.niche || '').split(' & ')[0] || a.niche,
			engagementRate: a.engagementRate || parseFloat(a.engagement) || 0,
			engagement_rate: a.engagementRate || parseFloat(a.engagement) || 0,
			active: a.status === 'active',
			connection_count: a.connectionCount ?? 0,
			autonomy_level: a.autonomy_level ?? 'advisor',
			connected_platforms: ['instagram', 'youtube']
		}));
	}

	// Map database posts to front-end expected ScheduledPost interface
	const realPosts = dbPosts.map((p) => ({
		id: p.id,
		agentId: p.agent_id,
		agentName: p.agents?.name || 'Agent',
		text: p.content,
		platforms: p.platforms || [],
		date: p.scheduled_date || '',
		time: p.scheduled_time ? p.scheduled_time.substring(0, 5) : '10:00',
		status: p.status === 'published' ? 'published' : p.status === 'failed' ? 'failed' : 'scheduled',
		external_id: p.external_id,
		analytics: p.analytics,
		token_usage: p.token_usage,
		token_cost: p.token_cost ? parseFloat(p.token_cost) : 0
	}));

	return {
		agents,
		realPosts
	};
};
