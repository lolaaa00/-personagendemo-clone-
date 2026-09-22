import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { checkAgentAccess } from '$lib/server/workspaces';
import {
	generateCharacterPortrait,
	generateCharacterSheetFromReference,
	resolvePersonaGender,
	resolveImageKeys,
	updateReferenceKit,
	buildHeroPortraitPrompt,
	buildPortraitEditPrompt,
	buildUgcImagePrompt
} from '$lib/server/content/generate';
import {
	loadRegistry,
	effectiveOptions,
	effectiveResolve,
	type RegistryRow
} from '$lib/server/model-registry';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { readPersonaProfileV2 } from '$lib/persona-contract/store';
import { hasDescribableLook, lookFingerprint } from '$lib/persona-contract/look-fingerprint';
import { persistBufferToStorage } from '$lib/server/storage';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024; // 10MB

// A 'generating' marker younger than this is trusted (the request is refused as
// a duplicate); older ones mean the detached task died without clearing its
// marker (deploy/restart mid-generation), so a retry self-heals by overwriting.
const IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

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
			{ success: false, error: 'Images and video are unavailable on our side right now — the platform\'s media provider is not configured. This isn\'t your account; tell us and we\'ll fix it.' },
			{ status: 400 }
		);
	}

	// Model Manager: honor registry enable/disable + defaults; static fallback.
	let registryRows: RegistryRow[] = [];
	try {
		registryRows = await loadRegistry(locals.supabase, user.id);
	} catch (e) {
		console.error('[Generate Avatar] Registry unavailable, using static catalog:', e);
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
			.select('ugc_voice, brand_brief_id, ugc_character_ref')
			.eq('agent_id', agentId)
			.maybeSingle();
		// The current pinned face. When present, a regenerate EDITS it (identity
		// preserved) instead of generating a brand-new person from text.
		const identityRef: string | null = cfg?.ugc_character_ref || null;
		const editing = Boolean(identityRef);
		// Persona gender is authoritative: the explicit Profile field first, else
		// inferred from the soul/name (shared with the content-generation path, so
		// the hero face and the videos can't disagree on gender). The resolver
		// itself falls back to a deliberately PINNED voice's gender when the
		// persona gives no signal — the 'Adam' column default carries none, so an
		// unpinned persona no longer silently defaults to a male face.
		const gender = resolvePersonaGender(agent, cfg?.ugc_voice);

		// Pinned-only: use the persona's explicitly selected brand brief, or no
		// brand context at all — never a silent fall-back to the newest brief.
		const { data: selectedBrief } = cfg?.brand_brief_id
			? await db.brandBriefs.getById(cfg.brand_brief_id, user.id)
			: { data: null };
		const briefData = selectedBrief?.data || null;

		// The REAL prompt this generation will send — built by the same function the
		// generator uses, so the preview can never drift from what actually runs.
		// Regeneration (a face already exists) EDITS that face to keep the same
		// person; the first generation builds one from scratch. The prompt + model
		// kind differ accordingly, so the composer shows exactly what will run.
		const resolvedPrompt = editing
			? buildPortraitEditPrompt(agent)
			: buildHeroPortraitPrompt(briefData, agent, gender);
		const modelKind = editing ? 'image_edit' : 'image_t2i';

		// `preview: true` costs nothing and generates nothing — it hands back the
		// resolved payload so the composer can show exactly what is about to be
		// sent and let the user edit it before approving.
		if (body.preview === true) {
			const selected = effectiveResolve(registryRows, modelKind, body.model);
			return json({
				success: true,
				preview: {
					mode: editing ? 'edit' : 'from_scratch',
					prompt: resolvedPrompt,
					// Edit mode sends the prompt as-is; from-scratch prepends a UGC style
					// prefix — show the literal string the provider actually receives.
					finalPrompt: editing ? resolvedPrompt : buildUgcImagePrompt(resolvedPrompt),
					provider: 'fal',
					gender: gender ?? null,
					// The existing face fed back in as the identity reference (regen only).
					image_urls: editing && identityRef ? [identityRef] : [],
					// Budget-vs-quality is the user's call, so hand them the menu rather
					// than a fixed model they can only accept.
					modelKind,
					model: selected.id,
					modelOptions: effectiveOptions(registryRows, modelKind),
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

		const chosenModel = effectiveResolve(registryRows, modelKind, body.model).id;

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
				chosenModel,
				identityRef
			);
	}

	// A second click while the detached avatar chain is still running is a
	// duplicate PAID generation — refuse it while the marker is fresh; a stale
	// marker (or one without a started_at) is a dead task, so proceed over it.
	const { data: kitRow } = await svc
		.from('agent_configs')
		.select('ugc_reference_kit')
		.eq('agent_id', agentId)
		.maybeSingle();
	const kit = kitRow?.ugc_reference_kit || {};
	if (kit.profile_status === 'generating') {
		const startedAt = Date.parse(String(kit.profile_started_at ?? ''));
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

	// Mark the avatar in-flight BEFORE responding so the reference-kit GET
	// poller (and a page reload) immediately sees a generation running.
	// `profile_started_at` is what lets the guard above (and the scheduler
	// reaper) age the marker.
	// The appearance this run is about to render, captured BEFORE it starts.
	// Taken here rather than on completion because the record can move while a
	// detached generation is in flight, and the honest thing to record is what
	// the portrait was actually made from — not what the persona looked like by
	// the time it finished.
	const renderedFrom = hasDescribableLook(readPersonaProfileV2(agent))
		? lookFingerprint(readPersonaProfileV2(agent))
		: null;

	await updateReferenceKit(svc, agentId, (k) => {
		k.profile_status = 'generating';
		k.profile_started_at = new Date().toISOString();
		return k;
	});

	void (async () => {
		try {
			// Both generators pin the finished shot as ugc_character_ref and
			// rebuild the kit foundation themselves — we only clear the marker.
			await runGeneration();
			await updateReferenceKit(svc, agentId, (k) => {
				delete k.profile_status;
				delete k.profile_started_at;
				// What this portrait was rendered from, so the page can later say
				// "your portrait predates your appearance edits" instead of showing a
				// face that quietly stopped matching the person it belongs to. Written
				// only on SUCCESS: a failed run pinned nothing, and recording a
				// fingerprint for it would mark a stale portrait as current.
				k.profile_generated_at = new Date().toISOString();
				if (renderedFrom) k.profile_look_fingerprint = renderedFrom;
				else delete k.profile_look_fingerprint;
				return k;
			});
		} catch (err) {
			console.error('[generate-avatar] Detached avatar generation failed:', err);
			try {
				await updateReferenceKit(svc, agentId, (k) => {
					k.profile_status = `failed: ${(err as Error).message}`.slice(0, 200);
					delete k.profile_started_at;
					return k;
				});
			} catch (patchErr) {
				console.error('[generate-avatar] Failed to record avatar failure:', patchErr);
			}
		}
	})();

	return json({ success: true, status: 'generating' }, { status: 202 });
};
