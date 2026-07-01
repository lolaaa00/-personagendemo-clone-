import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await request.json()) as any;
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
			ugcVoice,
			// Editable agent settings fields
			name,
			niche,
			gradient,
			initial,
			followers,
			engagementRate,
			handle,
			status,
			supervisorAgentId,
			runtimeOwner
		} = body;

		if (!agentId) {
			return json({ success: false, error: 'Missing agentId' }, { status: 400 });
		}

		const db = createDbService(locals.supabase);

		// Ownership Check
		const { data: agent, error: getErr } = await db.agents.get(agentId);
		if (getErr) throw getErr;
		if (!agent || agent.user_id !== user.id) {
			return json({ success: false, error: 'Agent not found or ownership mismatch' }, { status: 404 });
		}

		// 1. Update the agent's core texts and presentation in agents table
		const agentUpdatePayload: any = {};

		if (soulText !== undefined) agentUpdatePayload.soul = soulText;
		if (skillsText !== undefined) agentUpdatePayload.skills = skillsText;
		if (toolsText !== undefined) agentUpdatePayload.tools = toolsText;
		if (name !== undefined) agentUpdatePayload.name = name;
		if (niche !== undefined) agentUpdatePayload.niche = niche;
		if (gradient !== undefined) agentUpdatePayload.gradient = gradient;
		if (initial !== undefined) agentUpdatePayload.initial = initial;
		if (followers !== undefined) agentUpdatePayload.followers = String(followers);
		if (engagementRate !== undefined)
			agentUpdatePayload.engagement_rate = parseFloat(engagementRate as any) || 0;
		if (handle !== undefined) agentUpdatePayload.handle = handle;
		if (status !== undefined) agentUpdatePayload.status = status;
		if (supervisorAgentId !== undefined) {
			agentUpdatePayload.supervisor_agent_id = supervisorAgentId || null;
			agentUpdatePayload.managed_by_overseer = !!supervisorAgentId;
		}
		if (runtimeOwner !== undefined) {
			agentUpdatePayload.runtime_owner = runtimeOwner;
		}

		if (Object.keys(agentUpdatePayload).length > 0) {
			const { error: agentErr } = await db.agents.update(agentId, agentUpdatePayload);
			if (agentErr) throw agentErr;
		}

		// 2. Upsert the detailed config in agent_configs table only if config fields are provided
		const hasConfigFields = [
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
			ugcVoice
		].some((val) => val !== undefined);

		if (hasConfigFields) {
			const { error: configErr } = await db.agentConfigs.upsert({
				user_id: user.id,
				agent_id: agentId,
				soul: soulText !== undefined ? soulText : '',
				skills: skillsText !== undefined ? skillsText : '',
				tools: toolsText !== undefined ? toolsText : '',
				timezone: timezone || 'Australia/Sydney',
				posts_per_day: postsPerDay !== undefined ? postsPerDay : 3,
				active_hours_start: activeHoursStart !== undefined ? activeHoursStart : 8,
				active_hours_end: activeHoursEnd !== undefined ? activeHoursEnd : 22,
				autonomy_level: autonomyLevel || 'advisor',
				rss_url: rssUrl || '',
				rss_active: rssActive !== undefined ? rssActive : false,
				ugc_voice: ugcVoice || 'Adam'
			});

			if (configErr) throw configErr;
		}

		return json({ success: true });
	} catch (err) {
		console.error('[Config API] Error updating configuration:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const { agentId } = (await request.json()) as any;

		if (!agentId) {
			return json({ success: false, error: 'Missing agentId' }, { status: 400 });
		}

		const db = createDbService(locals.supabase);

		const { data: agent, error: getErr } = await db.agents.get(agentId);
		if (getErr) throw getErr;
		if (!agent || agent.user_id !== user.id) {
			return json({ success: false, error: 'Agent not found or ownership mismatch' }, { status: 404 });
		}

		// Guard: check if the agent is an overseer
		if (agent.is_overseer) {
			return json(
				{ success: false, error: 'Deleting the Hermes overseer agent is forbidden.' },
				{ status: 403 }
			);
		}

		// Clean up dependant rows first to avoid foreign key violations
		await locals.supabase.from('agent_configs').delete().eq('agent_id', agentId);
		await locals.supabase.from('chat_messages').delete().eq('agent_id', agentId);
		await locals.supabase.from('connections').delete().eq('agent_id', agentId);
		await locals.supabase.from('agent_memories').delete().eq('agent_id', agentId);
		await locals.supabase.from('posts').delete().eq('agent_id', agentId);

		// PM Ticket Safety: Update assigned tickets to set assignee_agent_id = NULL to preserve them
		await locals.supabase
			.from('tickets')
			.update({ assignee_agent_id: null })
			.eq('assignee_agent_id', agentId);

		// Delete agent row
		const { error: agentErr } = await db.agents.delete(agentId);
		if (agentErr) throw agentErr;

		return json({ success: true });
	} catch (err) {
		console.error('[Config API] Error deleting agent:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
