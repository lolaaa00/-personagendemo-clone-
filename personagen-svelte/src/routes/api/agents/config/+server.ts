import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json() as any;
		const {
			agentId,
			soulText,
			skillsText,
			toolsText,
			timezone,
			postsPerDay,
			activeHoursStart,
			activeHoursEnd,
			autonomyLevel,
			rssUrl,
			rssActive,
			// Editable agent settings fields
			name,
			niche,
			gradient,
			initial,
			followers,
			engagementRate
		} = body;

		if (!agentId) {
			return json({ success: false, error: 'Missing agentId' }, { status: 400 });
		}

		const db = createDbService(locals.supabase);

		// 1. Update the agent's core texts and presentation in agents table
		const agentUpdatePayload: any = {
			soul: soulText || '',
			skills: skillsText || '',
			tools: toolsText || ''
		};

		if (name !== undefined) agentUpdatePayload.name = name;
		if (niche !== undefined) agentUpdatePayload.niche = niche;
		if (gradient !== undefined) agentUpdatePayload.gradient = gradient;
		if (initial !== undefined) agentUpdatePayload.initial = initial;
		if (followers !== undefined) agentUpdatePayload.followers = String(followers);
		if (engagementRate !== undefined) agentUpdatePayload.engagement_rate = parseFloat(engagementRate as any) || 0;

		const { error: agentErr } = await db.agents.update(agentId, agentUpdatePayload);

		if (agentErr) throw agentErr;

		// 2. Upsert the detailed config in agent_configs table
		const { error: configErr } = await db.agentConfigs.upsert({
			user_id: user.id,
			agent_id: agentId,
			soul: soulText || '',
			skills: skillsText || '',
			tools: toolsText || '',
			timezone: timezone || 'Australia/Sydney',
			posts_per_day: postsPerDay !== undefined ? postsPerDay : 3,
			active_hours_start: activeHoursStart !== undefined ? activeHoursStart : 8,
			active_hours_end: activeHoursEnd !== undefined ? activeHoursEnd : 22,
			autonomy_level: autonomyLevel || 'advisor',
			rss_url: rssUrl || '',
			rss_active: rssActive !== undefined ? rssActive : false
		});

		if (configErr) throw configErr;

		return json({ success: true });
	} catch (err) {
		console.error('[Config API] Error updating configuration:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
