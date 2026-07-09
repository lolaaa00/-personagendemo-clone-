import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService, type AgentConfigInsert } from '$lib/server/db';

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
			runtimeOwner,
			// Extended persona profile (stored as JSON in market field)
			personaProfile
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
		// Extended persona profile stored as JSON string in the market field.
		if (personaProfile !== undefined) {
			agentUpdatePayload.market = typeof personaProfile === 'string'
				? personaProfile
				: JSON.stringify(personaProfile);
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
			ugcVoice,
			body.brandBriefId
		].some((val) => val !== undefined);

		if (hasConfigFields) {
			// Only include fields this request actually provided. mergeUpsert
			// preserves whatever's already in the DB for any omitted key — but
			// only if we don't hand it a hardcoded default as a literal value
			// (that would silently overwrite real settings, e.g. resetting
			// autonomy_level to 'advisor' just because this save only touched
			// soulText, quietly disabling autopilot the user had turned on).
			const configPatch: AgentConfigInsert = { user_id: user.id, agent_id: agentId };
			if (soulText !== undefined) configPatch.soul = soulText;
			if (skillsText !== undefined) configPatch.skills = skillsText;
			if (toolsText !== undefined) configPatch.tools = toolsText;
			if (timezone !== undefined) configPatch.timezone = timezone;
			if (postsPerDay !== undefined) configPatch.posts_per_day = postsPerDay;
			if (activeHoursStart !== undefined) configPatch.active_hours_start = activeHoursStart;
			if (activeHoursEnd !== undefined) configPatch.active_hours_end = activeHoursEnd;
			if (autonomyLevel !== undefined) configPatch.autonomy_level = autonomyLevel;
			if (rssUrl !== undefined) configPatch.rss_url = rssUrl;
			if (rssActive !== undefined) configPatch.rss_active = rssActive;
			if (ugcVoice !== undefined) configPatch.ugc_voice = ugcVoice;
		if (body.brandBriefId !== undefined) configPatch.brand_brief_id = body.brandBriefId || null;

			const { error: configErr } = await db.agentConfigs.upsert(configPatch);

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
