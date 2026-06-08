import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, url, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);

		// Handle OAuth redirect success callback
		const oauthSuccess = url.searchParams.get('oauth_success') === 'true';
		const platform = url.searchParams.get('platform');
		const agentId = url.searchParams.get('agentId');

		if (oauthSuccess && platform && agentId) {
			try {
				const { session, user } = await locals.safeGetSession();
				if (session && user) {
					const { data: agent } = await db.agents.get(agentId);
					if (agent) {
						const rawHandle = agent.handle || `@${agent.name.toLowerCase().replace(/\s+/g, '')}`;
						const handle = `${rawHandle}.${platform}`;
						await db.connections.upsert({
							user_id: user.id,
							agent_id: agentId,
							platform: platform as any,
							handle,
							verified: true,
							last_sync: new Date().toISOString()
						});

						const { data: conns } = await db.connections.listForAgent(agentId);
						const count = conns?.length || 0;
						await db.agents.update(agentId, {
							connection_count: count,
							status: 'active'
						});
					}
				}
			} catch (e) {
				console.error('[Accounts Load] Failed to insert connection from OAuth callback:', e);
			}
		}

		const { data: dbAgents } = await db.agents.list();
		if (dbAgents && dbAgents.length > 0) {
			return { agents: dbAgents };
		}
	}

	// Fallback to static JSON
	const agentsRes = await fetch('/data/agents.json');
	const rawAgents: any[] = await agentsRes.json();

	const agents = rawAgents.map((a) => ({
		...a,
		niche: (a.niche || '').split(' & ')[0] || a.niche,
		engagement_rate: a.engagementRate || parseFloat(a.engagement) || 0,
		active: a.status === 'active',
		connection_count: a.connectionCount ?? 0,
		autonomy_level: a.autonomy_level ?? 'advisor'
	}));

	return { agents };
};
