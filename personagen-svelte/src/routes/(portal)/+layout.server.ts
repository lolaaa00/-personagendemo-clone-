import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { createDbService } from '$lib/server/db';

export const load: LayoutServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (isPlaceholder) {
		return { session: null, user: null };
	}

	try {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) throw redirect(303, '/login');

		const db = createDbService(locals.supabase);

		// Check if user has agents, if not, auto-seed them
		const { data: existingAgents } = await db.agents.list();

		if (!existingAgents || existingAgents.length === 0) {
			console.log(`[Layout Server] Seeding default agents for user ${user.id}...`);
			try {
				const agentsRes = await fetch('/data/agents.json');
				if (agentsRes.ok) {
					const rawAgents: any[] = await agentsRes.json();
					for (const agent of rawAgents) {
						const { data: createdAgent, error: agentError } = await db.agents.create({
							user_id: user.id,
							name: agent.name,
							handle: agent.handle,
							niche: agent.niche,
							status: 'pending',
							soul: agent.soul || '',
							skills: agent.skills || '',
							tools: agent.tools || '',
							heartbeat: agent.heartbeat || '',
							market: agent.market || 'Australia',
							gradient: agent.gradient || 'linear-gradient(135deg, #7c6aed, #e84393)',
							initial: agent.initial || agent.name.charAt(0),
							engagement_rate: agent.engagementRate || parseFloat(agent.engagement) || 0,
							followers: agent.followers || '0',
							connection_count: 0
						});

						if (agentError) {
							console.error(`[Layout Server] Failed to seed agent ${agent.name}:`, agentError);
						} else if (createdAgent) {
							const { error: configError } = await db.agentConfigs.upsert({
								user_id: user.id,
								agent_id: createdAgent.id,
								soul: agent.soul || '',
								skills: agent.skills || '',
								tools: agent.tools || '',
								timezone: 'Australia/Sydney',
								posts_per_day: 3,
								active_hours_start: 8,
								active_hours_end: 22,
								autonomy_level: 'advisor'
							});
							if (configError) {
								console.error(`[Layout Server] Failed to seed config for agent ${agent.name}:`, configError);
							}
						}
					}
					console.log(`[Layout Server] Completed seeding for user ${user.id}.`);
				} else {
					console.error('[Layout Server] Failed to fetch agents.json for seeding');
				}
			} catch (err) {
				console.error('[Layout Server] Error seeding agents:', err);
			}
		}

		return { session, user };
	} catch (e) {
		// Re-throw SvelteKit redirects
		if ((e as any)?.status === 303) throw e;
		console.error('Portal layout auth error:', e);
		return { session: null, user: null };
	}
};
