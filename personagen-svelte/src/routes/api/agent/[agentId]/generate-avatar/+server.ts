import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import {
	generateCharacterPortrait,
	generateCharacterSheetFromReference,
	resolvePersonaGender,
	resolveImageKeys,
	buildHeroPortraitPrompt,
	buildUgcImagePrompt,
	UGC_IMAGE_MODEL_FAL,
	UGC_IMAGE_MODEL_OPENROUTER
} from '$lib/server/content/generate';
import { priceOf } from '$lib/pricing';
import { modelsFor, resolveModel } from '$lib/models';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { persistBufferToStorage } from '$lib/server/storage';
import { VOICE_CATALOG } from '$lib/server/voices';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Read-modify-write on `agent_configs.ugc_reference_kit` for the transient
 * `profile_status` polling key ('generating' / 'failed: …'). Runs on the
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
 * Generates (or regenerates) an agent's pinned AI character reference — the
 * same image used to keep the on-camera face consistent across that agent's
 * spokesperson videos — and sets it as the agent's profile picture
 * (agent_configs.ugc_character_ref).
 *
 * Two modes, both explicit user-triggered actions (unlike the automatic
 * pipeline's lazy `ensureCharacterRef`, this always generates fresh):
 *   - JSON body (or empty): generates a from-scratch hero portrait tuned to
 *     the agent's persona/brand brief.
 *   - multipart/form-data with a `reference` file: generates a full
 *     character turnaround/reference sheet conditioned on that uploaded
 *     photo via Nano Banana's edit endpoint.
 *
 * ASYNC JOB PATTERN: either mode chains multiple fal calls (30s–minutes) —
 * past the reverse proxy's request timeout. Validations stay synchronous,
 * then `profile_status: 'generating'` is written into ugc_reference_kit, a
 * 202 is returned, and generation runs in a detached task (marker cleared on
 * success, set to 'failed: …' on failure). Poll via GET on
 * /api/agent/[agentId]/generate-reference-kit — the finished avatar lands in
 * ugc_character_ref, exposed there as `avatar_url`.
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

	const userId = user.id;
	const contentType = request.headers.get('content-type') || '';

	// Everything each mode needs is captured BEFORE responding — SvelteKit's
	// request/locals must not be touched after the response is returned — and
	// the detached task runs entirely on the service client (generation takes
	// minutes; a session token could expire mid-task).
	let runGeneration: () => Promise<string>;

	// ── Reference-photo path: upload -> Nano Banana turnaround sheet ──────────
	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		const file = form.get('reference');
		if (!(file instanceof File)) {
			return json({ success: false, error: 'Missing reference photo file.' }, { status: 400 });
		}
		if (file.size > MAX_REFERENCE_BYTES) {
			return json(
				{ success: false, error: 'Reference photo is too large (max 10MB).' },
				{ status: 400 }
			);
		}

		// Drain the upload now — the request body is gone once we respond.
		const buffer = Buffer.from(await file.arrayBuffer());
		const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
		const mimeType = file.type;

		runGeneration = async () => {
			const referenceUrl = await persistBufferToStorage(svc, buffer, userId, ext, mimeType);
			return generateCharacterSheetFromReference(svc, svc, userId, agentId, falKey, referenceUrl);
		};
	} else {
		// ── From-scratch path ──────────────────────────────────────────────────
		const body = (await request.json().catch(() => ({}))) as any;

		const { data: cfg } = await locals.supabase
			.from('agent_configs')
			.select('ugc_voice, brand_brief_id')
			.eq('agent_id', agentId)
			.maybeSingle();
		const voiceGender = VOICE_CATALOG.find((v) => v.name === (cfg?.ugc_voice || 'Adam'))?.gender;

		// Persona gender is authoritative: the explicit Profile field first, else
		// inferred from the soul/name (shared with the content-generation path, so
		// the hero face and the videos can't disagree on gender). Only falls back
		// to the voice's gender when the persona gives no signal at all.
		const profileGender = resolvePersonaGender(agent);

		// Persona's selected brand brief first (multi-brand users), newest as fallback.
		const { data: selectedBrief } = cfg?.brand_brief_id
			? await db.brandBriefs.getById(cfg.brand_brief_id, user.id)
			: { data: null };
		const { data: fallbackBrief } = selectedBrief ? { data: null } : await db.brandBriefs.get(user.id);
		const briefData = (selectedBrief ?? fallbackBrief)?.data || null;

		const gender = profileGender || voiceGender;
		// The REAL prompt this generation will send — built by the same function the
		// generator uses, so the preview can never drift from what actually runs.
		const resolvedPrompt = buildHeroPortraitPrompt(briefData, agent, gender);

		// `preview: true` costs nothing and generates nothing — it hands back the
		// resolved payload so the composer can show exactly what is about to be
		// sent and let the user edit it before approving.
		if (body.preview === true) {
			const selected = resolveModel('image_t2i', body.model);
			return json({
				success: true,
				preview: {
					mode: 'from_scratch',
					prompt: resolvedPrompt,
					// generateUgcImage silently prepends a UGC style prefix — show the
					// literal string the provider receives, not a flattering summary.
					finalPrompt: buildUgcImagePrompt(resolvedPrompt),
					provider: 'fal',
					gender: gender ?? null,
					// Budget-vs-quality is the user's call, so hand them the menu rather
					// than a fixed model they can only accept.
					modelKind: 'image_t2i',
					model: selected.id,
					modelOptions: modelsFor('image_t2i'),
					editable: ['prompt', 'model'],
					estimatedCostUsd: selected.usd
				}
			});
		}

		// Honour a prompt the user edited in the composer; otherwise use the resolved one.
		const promptOverride =
			typeof body.prompt === 'string' && body.prompt.trim()
				? String(body.prompt).slice(0, 2000)
				: undefined;

		const chosenModel = resolveModel('image_t2i', body.model).id;

		runGeneration = () =>
			generateCharacterPortrait(
				svc,
				svc,
				userId,
				agentId,
				falKey,
				briefData,
				agent,
				gender,
				promptOverride,
				chosenModel
			);
	}

	// Mark the avatar in-flight BEFORE responding so the reference-kit GET
	// poller (and a page reload) immediately sees a generation running.
	await patchReferenceKit(svc, agentId, { profile_status: 'generating' });

	void (async () => {
		try {
			// Both generators pin the finished shot as ugc_character_ref and
			// rebuild the kit foundation themselves — we only clear the marker.
			await runGeneration();
			await patchReferenceKit(svc, agentId, {}, ['profile_status']);
		} catch (err) {
			console.error('[generate-avatar] Detached avatar generation failed:', err);
			try {
				await patchReferenceKit(svc, agentId, {
					profile_status: `failed: ${(err as Error).message}`.slice(0, 200)
				});
			} catch (patchErr) {
				console.error('[generate-avatar] Failed to record avatar failure:', patchErr);
			}
		}
	})();

	return json({ success: true, status: 'generating' }, { status: 202 });
};
