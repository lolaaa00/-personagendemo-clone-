import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let blueprints: any[] = [];
	let agents: any[] = [];
	let dbPosts: any[] = [];
	let hasDb = false;

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		const { data: dbBlueprints } = await db.blueprints.list();
		if (dbBlueprints) {
			blueprints = dbBlueprints.map((bp) => ({
				id: bp.id,
				name: bp.channel_name || 'Competitor Channel',
				platform: bp.platform || 'youtube',
				niche: bp.channel_url || 'Competitor Analysis',
				score: bp.score || 85,
				date: new Date(bp.created_at).toLocaleDateString(),
				layers: Array.isArray(bp.layers)
					? bp.layers.length
					: bp.layers
						? Object.keys(bp.layers).length
						: 9
			}));
		}

		if (dbAgents && dbAgents.length > 0) {
			hasDb = true;

			// Fetch active platform connections
			const { data: dbConnections } = await locals.supabase
				.from('connections')
				.select('agent_id, platform');

			const creators = dbAgents.filter((a) => !a.is_overseer);
			agents = creators.map((a) => {
				const agentConns = dbConnections?.filter((c) => c.agent_id === a.id) || [];
				const connectedPlatforms = agentConns.map((c) => c.platform);
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
				const activeAgentIds = new Set(agents.map((a: any) => a.id));
				dbPosts = postsRes.filter((p: any) => activeAgentIds.has(p.agent_id));
			}
		}
	}

	if (!hasDb) {
		agents = [];
	}

	// Map database posts to front-end expected ScheduledPost interface
	const realPosts = dbPosts.map((p: any) => ({
		id: p.id,
		agentId: p.agent_id,
		agentName: p.agents?.name || 'Agent',
		text: p.content,
		platforms: p.platforms || [],
		date: p.scheduled_date || '',
		time: p.scheduled_time ? p.scheduled_time.substring(0, 5) : '10:00',
		status: p.status === 'published' ? 'published' : p.status === 'failed' ? 'failed' : 'scheduled',
		external_id: p.external_id,
		publication_results: p.publication_results,
		analytics: p.analytics,
		token_usage: p.token_usage,
		token_cost: p.token_cost ? parseFloat(p.token_cost) : 0
	}));

	return {
		agents,
		realPosts,
		blueprints,
		allowDemoMode: privateEnv.ALLOW_DEMO_MODE === 'true'
	};
};
