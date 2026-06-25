import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

export const load: any = async ({ locals, fetch }: any) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let blueprints: any[] = [];
	let agents: any[] = [];
	let hasDb = false;

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();
		const { data: dbBlueprints } = await db.blueprints.list();

		if (dbBlueprints) {
			blueprints = dbBlueprints.map((bp) => ({
				id: bp.id,
				channel_name: bp.channel_name || 'Competitor Channel',
				channel_url: bp.channel_url || '',
				platform: bp.platform || 'youtube',
				score: bp.score || 85,
				created_at: bp.created_at,
				layers: bp.layers || []
			}));
		}

		if (dbAgents && dbAgents.length > 0) {
			hasDb = true;
			const { data: dbConnections } = await locals.supabase
				.from('connections')
				.select('agent_id, platform');

			const creators = dbAgents.filter((a) => !a.is_overseer);
			agents = creators.map((a) => {
				const agentConns = dbConnections?.filter((c: any) => c.agent_id === a.id) || [];
				const connectedPlatforms = agentConns.map((c: any) => c.platform);
				return {
					...a,
					niche: (a.niche || '').split(' & ')[0] || a.niche,
					engagement_rate: parseFloat(a.engagement_rate as any) || 0,
					active: a.status === 'active',
					connected_platforms:
						connectedPlatforms.length > 0 ? connectedPlatforms : ['instagram', 'youtube']
				};
			});
		}
	}

	if (!hasDb) {
		agents = [];
	}

	return {
		agents,
		blueprints,
		allowDemoMode: privateEnv.ALLOW_DEMO_MODE === 'true'
	};
};
