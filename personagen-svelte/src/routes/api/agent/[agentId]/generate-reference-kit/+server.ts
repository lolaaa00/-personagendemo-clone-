import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import {
	executeKitStage,
	resolveKitStagePlan,
	resolvePersonaGender,
	resolveImageKeys
} from '$lib/server/content/generate';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { priceOf } from '$lib/pricing';

const VALID_STAGES = ['side_profiles', 'face_closeup', 'feature_grid'] as const;

/**
 * Read-modify-write on `agent_configs.ugc_reference_kit` for the transient
 * `<stage>_status` polling keys ('generating' / 'failed: …'). Runs on the
 * service client so a detached task can still clear its key after the user's
 * session token would have expired.
 */
async function patchReferenceKit(
	svc: any,
	agentId: string,
	set: Record<string, string>,
	remove: string[] = []
): Promise<void> {
	const { data } = await svc
		.from('agent_configs')
		.select('ugc_reference_kit')
		.eq('agent_id', agentId)
		.maybeSingle();
	const kit = { ...(data?.ugc_reference_kit || {}) };
	for (const key of remove) delete kit[key];
	Object.assign(kit, set);
	await svc.from('agent_configs').update({ ugc_reference_kit: kit }).eq('agent_id', agentId);
}

/**
 * Drives stages 3 (side-profile composite), 4 (facial close-up), and 5
 * (feature grid) of the character reference pipeline — all explicit,
 * user-approved follow-ups to the stage-1/2 sheet + full-body shot generated
 * by /api/agent/[agentId]/generate-avatar. Each stage reads whatever it needs
 * from the agent's existing `ugc_reference_kit` (populated by earlier
 * stages) rather than requiring the client to resend image URLs.
 *
 * ASYNC JOB PATTERN: each stage is a fal Nano Banana call (30s+) — past the
 * reverse proxy's request timeout. Validations stay synchronous, then a
 * `<stage>_status: 'generating'` marker is written into the kit, a 202 is
 * returned, and the stage runs in a detached task (marker cleared on success,
 * set to 'failed: …' on failure). Poll via GET on this same route.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const body = (await request.json().catch(() => ({}))) as any;
	const stage = body.stage;
	if (!VALID_STAGES.includes(stage)) {
		return json(
			{ success: false, error: `Invalid stage: ${stage}. Expected one of: ${VALID_STAGES.join(', ')}.` },
			{ status: 400 }
		);
	}

	const db = createDbService(locals.supabase);
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent || agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Agent not found or ownership mismatch' },
			{ status: 404 }
		);
	}

	const { falKey } = await resolveImageKeys(locals.supabase, user.id);
	if (!falKey) {
		return json(
			{ success: false, error: 'No fal.ai key configured. Add one in Settings.' },
			{ status: 400 }
		);
	}

	let svc: any;
	try {
		svc = getServiceSupabase();
	} catch {
		return json(
			{ success: false, error: 'Storage service is not configured on this server.' },
			{ status: 500 }
		);
	}

	const { data: cfg } = await locals.supabase
		.from('agent_configs')
		.select('ugc_reference_kit, ugc_character_ref')
		.eq('agent_id', agentId)
		.maybeSingle();
	const kit = cfg?.ugc_reference_kit || {};
	const characterRef = cfg?.ugc_character_ref || null;

	// Resolve the EXACT request this stage will send (prompt, model, reference
	// images, aspect ratio). Prerequisite failures surface here as a fast-fail
	// 400 — never as a detached failure.
	const gender = resolvePersonaGender(agent);
	const resolved = resolveKitStagePlan(stage, kit, characterRef, gender);
	if ('error' in resolved) {
		return json({ success: false, error: resolved.error }, { status: 400 });
	}

	// `preview: true` costs nothing and generates nothing — it just hands back
	// the resolved payload so the composer can show the user exactly what is
	// about to be sent, and let them edit it before approving.
	if (body.preview === true) {
		return json({
			success: true,
			stage,
			preview: {
				...resolved,
				editable: ['prompt'],
				estimatedCostUsd: priceOf('fal', 'image', 'nano')
			}
		});
	}

	// The user may have edited the prompt in the composer. Everything else is
	// server-resolved, so what runs is what they approved.
	const plan = {
		...resolved,
		prompt:
			typeof body.prompt === 'string' && body.prompt.trim()
				? String(body.prompt).slice(0, 2000)
				: resolved.prompt
	};

	// Captured NOW — request/locals must not be touched after we respond, and the
	// detached task runs on the service client (a session token could expire
	// mid-generation).
	const userId = user.id;
	const runStage = () => executeKitStage(svc, svc, userId, agentId, falKey, stage, plan);

	// Mark the stage in-flight BEFORE responding so the GET poller (and a page
	// reload) immediately sees a generation running.
	await patchReferenceKit(svc, agentId, { [`${stage}_status`]: 'generating' });

	void (async () => {
		try {
			// The stage function itself merges the finished URL into the kit —
			// we only clear the in-flight marker afterwards.
			await runStage();
			await patchReferenceKit(svc, agentId, {}, [`${stage}_status`]);
		} catch (err) {
			console.error(`[generate-reference-kit] Detached ${stage} generation failed:`, err);
			try {
				await patchReferenceKit(svc, agentId, {
					[`${stage}_status`]: `failed: ${(err as Error).message}`.slice(0, 200)
				});
			} catch (patchErr) {
				console.error('[generate-reference-kit] Failed to record stage failure:', patchErr);
			}
		}
	})();

	return json({ success: true, stage, status: 'generating' }, { status: 202 });
};

/**
 * Polling endpoint for the async kit stages (and generate-avatar): returns the
 * current reference kit — including the transient `<stage>_status` keys — plus
 * the pinned avatar (`agent_configs.ugc_character_ref`, where both avatar
 * generation paths land). Cheap DB read only.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent || agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Agent not found or ownership mismatch' },
			{ status: 404 }
		);
	}

	const { data: cfg } = await locals.supabase
		.from('agent_configs')
		.select('ugc_reference_kit, ugc_character_ref')
		.eq('agent_id', agentId)
		.maybeSingle();

	return json({
		success: true,
		kit: cfg?.ugc_reference_kit || {},
		avatar_url: cfg?.ugc_character_ref || null
	});
};
