import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService, type AgentConfigInsert } from '$lib/server/db';
import {
	mergePersonaProfile,
	profileToMarketString,
	readPersonaProfile,
	type PersonaProfile
} from '$lib/persona-profile-store';
import { writeWithProfileFallback } from '$lib/server/personas-profile-column';

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
			return json({ success: false, error: 'Persona not found or ownership mismatch' }, { status: 404 });
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
		// Extended persona profile — DUAL-WRITE to the personas_profile JSONB
		// column and the legacy agents.market JSON string (services/mcp-bridge and
		// any not-yet-migrated reader still read `market`).
		//
		// MERGED against what's already stored, never overwritten wholesale: a
		// caller that patches only bios used to wipe appearance/archetype off the
		// row, because the old path stringified whatever literal it was handed.
		// mergePersonaProfile keeps every field the patch doesn't mention.
		if (personaProfile !== undefined) {
			// A string body is the legacy transport — the client already stringified
			// the profile. Parse it back through the accessor so it merges like any
			// other patch instead of replacing the stored object as opaque text.
			const patch = readPersonaProfile(
				typeof personaProfile === 'string'
					? { market: personaProfile }
					: { personas_profile: personaProfile }
			) as PersonaProfile;
			const merged = mergePersonaProfile(readPersonaProfile(agent), patch);
			agentUpdatePayload.personas_profile = merged;
			agentUpdatePayload.market = profileToMarketString(merged);
		}

		if (Object.keys(agentUpdatePayload).length > 0) {
			// Retries without personas_profile if the migration hasn't been applied
			// yet — `market` still carries the merged profile, so nothing is lost.
			const { error: agentErr } = await writeWithProfileFallback(agentUpdatePayload, (p) =>
				db.agents.update(agentId, p)
			);
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
		const body = (await request.json()) as any;
		// Accepts a single agentId or `agentIds` for multi-select bulk deletion.
		// Each id is ownership-checked independently and the outcome is reported
		// per-agent, so one protected/foreign id can't fail the whole batch.
		const requested: string[] = Array.isArray(body?.agentIds)
			? body.agentIds.map((v: unknown) => String(v || '')).filter(Boolean)
			: body?.agentId
				? [String(body.agentId)]
				: [];

		if (requested.length === 0) {
			return json({ success: false, error: 'Missing agentId' }, { status: 400 });
		}
		if (requested.length > 50) {
			return json({ success: false, error: 'Too many personas (max 50 per request)' }, { status: 400 });
		}

		const db = createDbService(locals.supabase);
		const deleted: string[] = [];
		const failed: Array<{ agentId: string; error: string }> = [];

		for (const agentId of requested) {
			const { data: agent, error: getErr } = await db.agents.get(agentId);
			if (getErr || !agent || agent.user_id !== user.id) {
				failed.push({ agentId, error: 'Persona not found or ownership mismatch' });
				continue;
			}
			// Guard: check if the agent is an overseer
			if (agent.is_overseer) {
				failed.push({ agentId, error: 'Deleting the overseer persona is forbidden.' });
				continue;
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

			const { error: agentErr } = await db.agents.delete(agentId);
			if (agentErr) {
				failed.push({ agentId, error: agentErr.message });
				continue;
			}
			deleted.push(agentId);
		}

		if (deleted.length === 0) {
			return json(
				{ success: false, error: failed[0]?.error || 'Nothing deleted', failed },
				{ status: failed[0]?.error?.includes('forbidden') ? 403 : 404 }
			);
		}

		return json({ success: true, deleted, failed });
	} catch (err) {
		console.error('[Config API] Error deleting agent:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
