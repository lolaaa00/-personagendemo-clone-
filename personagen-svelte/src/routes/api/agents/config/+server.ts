import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService, type AgentConfigInsert } from '$lib/server/db';
import { buildStoredProfile } from '$lib/persona-contract/save';
import { writeWithProfileFallback } from '$lib/server/personas-profile-column';
import { checkAgentAccess } from '$lib/server/workspaces';
import type { AutonomyLevel } from '$lib/types';

/**
 * The persona page's save payload. Everything is optional: the page sends the
 * fields the user touched, and each is gated on `!== undefined` before it is
 * written, so an absent key means "leave it alone" rather than "clear it".
 */
interface ConfigRequestBody {
	agentId?: string;
	soulText?: string;
	skillsText?: string;
	toolsText?: string;
	timezone?: string;
	postsPerDay?: number;
	activeHoursStart?: number;
	activeHoursEnd?: number;
	/** Union, not string: `agent_configs.autonomy_level` is a CHECK-constrained column. */
	autonomyLevel?: AutonomyLevel;
	rssUrl?: string;
	rssActive?: boolean;
	ugcVoice?: string;
	name?: string;
	niche?: string;
	gradient?: string;
	initial?: string;
	followers?: string | number;
	engagementRate?: string | number;
	handle?: string;
	status?: string;
	supervisorAgentId?: string | null;
	runtimeOwner?: string;
	brandBriefId?: string | null;
	/** v1 form object, a v2 record, or the legacy stringified transport. */
	personaProfile?: unknown;
}

/** Columns this route may write on `agents`. Keyed loosely: the DB is the schema. */
type AgentUpdatePayload = Record<string, unknown>;

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// The persona page posts a wide, partly-optional form; every field is
		// re-checked below with `!== undefined` before it reaches a payload, so
		// `unknown` here costs nothing and stops a typo becoming a silent write.
		const body = (await request.json()) as ConfigRequestBody;
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

		// Ownership / workspace-role check. Column-level enforcement (identity
		// fields stay owner/manager-only) lives in the enforce_agent_update_scope
		// DB trigger — this gate just keeps a viewer-only seat from reaching it
		// at all, with a clean error instead of a raw trigger exception.
		const { data: agent, error: getErr } = await db.agents.get(agentId);
		if (getErr) throw getErr;
		if (!agent) {
			return json(
				{ success: false, error: 'Persona not found or ownership mismatch' },
				{ status: 404 }
			);
		}
		const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'creator');
		if (!access.ok) {
			return json({ success: false, error: access.message }, { status: access.status });
		}

		// 1. Update the agent's core texts and presentation in agents table
		const agentUpdatePayload: AgentUpdatePayload = {};

		if (soulText !== undefined) agentUpdatePayload.soul = soulText;
		if (skillsText !== undefined) agentUpdatePayload.skills = skillsText;
		if (toolsText !== undefined) agentUpdatePayload.tools = toolsText;
		if (name !== undefined) agentUpdatePayload.name = name;
		if (niche !== undefined) agentUpdatePayload.niche = niche;
		if (gradient !== undefined) agentUpdatePayload.gradient = gradient;
		if (initial !== undefined) agentUpdatePayload.initial = initial;
		if (followers !== undefined) agentUpdatePayload.followers = String(followers);
		if (engagementRate !== undefined)
			agentUpdatePayload.engagement_rate = parseFloat(String(engagementRate)) || 0;
		if (handle !== undefined) agentUpdatePayload.handle = handle;
		if (status !== undefined) agentUpdatePayload.status = status;
		if (supervisorAgentId !== undefined) {
			agentUpdatePayload.supervisor_agent_id = supervisorAgentId || null;
			agentUpdatePayload.managed_by_overseer = !!supervisorAgentId;
		}
		if (runtimeOwner !== undefined) {
			agentUpdatePayload.runtime_owner = runtimeOwner;
		}
		// Extended persona profile — written to the personas_profile JSONB column.
		//
		// Persona Model v2 (P0.5): the stored blob is v2 from this save on. The
		// client still sends its v1 form (or the legacy stringified transport);
		// buildStoredProfile runs the v1 normalising gate, upgrades, validates on
		// the v2 contract, and merges over the stored record with provenance —
		// absent keys preserve, explicit empties clear, unchanged values keep
		// their source, and a UI save can never wipe a field it doesn't mention.
		// Every reader is dual-shape (readPersonaProfile downgrades v2), so no
		// consumer changes. The profile lives ONLY in personas_profile: `market`
		// went back to being a market string in market_restore_migration.sql
		// (P0.6) and is never written here.
		if (personaProfile !== undefined) {
			agentUpdatePayload.personas_profile = buildStoredProfile(agent, personaProfile, { origin: 'ui' });
		}

		if (Object.keys(agentUpdatePayload).length > 0) {
			// Retries without personas_profile only if the column is missing, so the
			// rest of the row still saves; that case is reported at error level (see
			// personas-profile-column.ts) — the profile itself is NOT persisted then.
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
			// Keyed to the PERSONA'S owner, not the acting session — agent_configs is
			// one shared row per persona (UNIQUE(user_id, agent_id)); using the
			// actor's own id here would fork a separate config row per workspace
			// seat instead of everyone converging on the same settings.
			const configPatch: AgentConfigInsert = { user_id: agent.user_id, agent_id: agentId };
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
		const body = (await request.json()) as { agentId?: unknown; agentIds?: unknown };
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
			return json(
				{ success: false, error: 'Too many personas (max 50 per request)' },
				{ status: 400 }
			);
		}

		const db = createDbService(locals.supabase);
		const deleted: string[] = [];
		const failed: Array<{ agentId: string; error: string }> = [];

		for (const agentId of requested) {
			const { data: agent, error: getErr } = await db.agents.get(agentId);
			// Deleting is owner-only — not even a workspace manager — since it's
			// irreversible and takes the persona away from every seat at once.
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
