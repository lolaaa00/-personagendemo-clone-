import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { runAutopilotDraftGeneration } from '$lib/server/autopilot';

const DEFAULT_TZ = 'Australia/Sydney';

/** Shapes the agent_config row into the autopilot view the UI consumes. */
function toView(cfg: any) {
	const level = cfg?.autonomy_level || 'advisor';
	return {
		enabled: level !== 'advisor',
		mode: level,
		window_start: cfg?.active_hours_start ?? 8,
		window_end: cfg?.active_hours_end ?? 20,
		timezone: cfg?.timezone || DEFAULT_TZ
	};
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as any;
	const { action } = body;
	const agentId = body.agent_id || body.agentId;

	if (!action) return json({ success: false, error: 'Missing action' }, { status: 400 });
	if (!agentId) return json({ success: false, error: 'Missing agent_id' }, { status: 400 });

	const db = createDbService(locals.supabase);

	// Verify agent ownership for every action
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent || agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Persona not found or ownership mismatch' },
			{ status: 404 }
		);
	}

	try {
		if (action === 'get_config') {
			const { data: cfg } = await locals.supabase
				.from('agent_configs')
				.select('*')
				.eq('agent_id', agentId)
				.maybeSingle();
			return json({ success: true, data: toView(cfg) });
		}

		if (action === 'set_config') {
			const { data: existing } = await locals.supabase
				.from('agent_configs')
				.select('*')
				.eq('agent_id', agentId)
				.maybeSingle();

			const enabled = body.enabled !== false;
			const mode = body.mode === 'fully_autonomous' ? 'fully_autonomous' : 'semi_autonomous';
			const level: 'advisor' | 'semi_autonomous' | 'fully_autonomous' = enabled ? mode : 'advisor';

			const cfg = {
				user_id: user.id,
				agent_id: agentId,
				soul: existing?.soul ?? '',
				skills: existing?.skills ?? '',
				tools: existing?.tools ?? '',
				timezone: body.timezone ?? existing?.timezone ?? DEFAULT_TZ,
				posts_per_day: existing?.posts_per_day ?? 7,
				active_hours_start: body.window_start ?? existing?.active_hours_start ?? 8,
				active_hours_end: body.window_end ?? existing?.active_hours_end ?? 20,
				autonomy_level: level as 'advisor' | 'semi_autonomous' | 'fully_autonomous'
			};

			const { data, error } = await db.agentConfigs.upsert(cfg);
			if (error) return json({ success: false, error: error.message }, { status: 500 });
			return json({ success: true, data: toView(data) });
		}

		if (action === 'generate_now') {
			// A run chains one fal generation per empty slot (30s–5min each) —
			// far past the reverse proxy's request timeout. Kick it off detached
			// and 202 immediately; drafts land in the review queue as each slot
			// completes. runAutopilotDraftGeneration uses its own service-role
			// client internally, so nothing session-scoped leaks into the task.
			void runAutopilotDraftGeneration({ agentId }).catch((genErr) => {
				console.error('[Autopilot API] Detached generate_now run failed:', genErr);
			});
			return json({ success: true, status: 'generating' }, { status: 202 });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Autopilot API] Error processing action:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
