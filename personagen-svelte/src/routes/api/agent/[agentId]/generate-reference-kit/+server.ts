import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { checkAgentAccess } from '$lib/server/workspaces';
import {
	executeKitStage,
	resolveKitStagePlan,
	resolvePersonaGender,
	resolveImageKeys,
	updateReferenceKit
} from '$lib/server/content/generate';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { priceOf } from '$lib/pricing';
import {
	loadRegistry,
	effectiveOptions,
	effectiveResolve,
	type RegistryRow
} from '$lib/server/model-registry';

const VALID_STAGES = ['full_body', 'side_profiles', 'face_closeup', 'feature_grid'] as const;

// A 'generating' marker younger than this is trusted (the request is refused as
// a duplicate); older ones mean the detached task died without clearing its
// marker (deploy/restart mid-generation), so a retry self-heals by overwriting.
const IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

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
			{
				success: false,
				error: `Invalid stage: ${stage}. Expected one of: ${VALID_STAGES.join(', ')}.`
			},
			{ status: 400 }
		);
	}

	const db = createDbService(locals.supabase);
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent) {
		return json(
			{ success: false, error: 'Persona not found or ownership mismatch' },
			{ status: 404 }
		);
	}
	const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'creator');
	if (!access.ok) {
		return json({ success: false, error: access.message }, { status: access.status });
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

	// Model Manager: honor registry enable/disable + defaults; static fallback.
	let registryRows: RegistryRow[] = [];
	try {
		registryRows = await loadRegistry(locals.supabase, user.id);
	} catch (e) {
		console.error('[Reference Kit] Registry unavailable, using static catalog:', e);
	}

	const { data: cfg } = await locals.supabase
		.from('agent_configs')
		.select('ugc_reference_kit, ugc_character_ref, ugc_voice')
		.eq('agent_id', agentId)
		.maybeSingle();
	const kit = cfg?.ugc_reference_kit || {};
	const characterRef = cfg?.ugc_character_ref || null;

	// Resolve the EXACT request this stage will send (prompt, model, reference
	// images, aspect ratio). Prerequisite failures surface here as a fast-fail
	// 400 — never as a detached failure. The pinned voice is the gender
	// tiebreaker when the profile/soul give no signal.
	const gender = resolvePersonaGender(agent, cfg?.ugc_voice);
	const resolved = resolveKitStagePlan(stage, kit, characterRef, gender);
	if ('error' in resolved) {
		return json({ success: false, error: resolved.error }, { status: 400 });
	}

	// `preview: true` costs nothing and generates nothing — it just hands back
	// the resolved payload so the composer can show the user exactly what is
	// about to be sent, and let them edit it before approving.
	if (body.preview === true) {
		const selected = effectiveResolve(registryRows, 'image_edit', body.model);
		return json({
			success: true,
			stage,
			preview: {
				...resolved,
				modelKind: 'image_edit',
				model: selected.id,
				modelOptions: effectiveOptions(registryRows, 'image_edit'),
				// This stage feeds TWO references (the shot + the character sheet). A
				// single-reference model would quietly drop the sheet, so say so instead
				// of letting facial consistency degrade without explanation.
				multiRefNeeded: resolved.image_urls.length > 1,
				editable: ['prompt', 'model'],
				estimatedCostUsd: selected.usd
			}
		});
	}

	// The user may have edited the prompt in the composer. Everything else is
	// server-resolved, so what runs is what they approved.
	const plan = {
		...resolved,
		model: effectiveResolve(registryRows, 'image_edit', body.model).id,
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

	// A second click (or second tab) while the detached task is still running is
	// a duplicate PAID generation — refuse it while the marker is fresh; a stale
	// marker (or one without a started_at) is a dead task, so proceed over it.
	const statusKey = `${stage}_status`;
	const startedKey = `${stage}_started_at`;
	if (kit[statusKey] === 'generating') {
		const startedAt = Date.parse(String(kit[startedKey] ?? ''));
		const ageMs = Date.now() - startedAt;
		if (Number.isFinite(startedAt) && ageMs < IN_FLIGHT_STALE_MS) {
			return json(
				{
					success: false,
					error: `This generation is already running — it started ${Math.max(1, Math.round(ageMs / 60000))} min ago. Wait for it to finish (or retry in 15 minutes if it never does).`
				},
				{ status: 409 }
			);
		}
	}

	// Mark the stage in-flight BEFORE responding so the GET poller (and a page
	// reload) immediately sees a generation running. `_started_at` is what lets
	// the guard above (and the scheduler reaper) age the marker.
	await updateReferenceKit(svc, agentId, (k) => {
		k[statusKey] = 'generating';
		k[startedKey] = new Date().toISOString();
		return k;
	});

	void (async () => {
		try {
			// The stage function itself merges the finished URL into the kit —
			// we only clear the in-flight marker afterwards.
			await runStage();
			await updateReferenceKit(svc, agentId, (k) => {
				delete k[statusKey];
				delete k[startedKey];
				return k;
			});
		} catch (err) {
			console.error(`[generate-reference-kit] Detached ${stage} generation failed:`, err);
			try {
				await updateReferenceKit(svc, agentId, (k) => {
					k[statusKey] = `failed: ${(err as Error).message}`.slice(0, 200);
					delete k[startedKey];
					return k;
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
	if (agentErr || !agent) {
		return json(
			{ success: false, error: 'Persona not found or ownership mismatch' },
			{ status: 404 }
		);
	}
	const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'creator');
	if (!access.ok) {
		return json({ success: false, error: access.message }, { status: access.status });
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
