import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import {
	generateCharacterPortrait,
	generateCharacterSheetFromReference,
	resolveImageKeys
} from '$lib/server/content/generate';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { persistBufferToStorage } from '$lib/server/storage';
import { VOICE_CATALOG } from '$lib/server/voices';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024; // 10MB

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

	const contentType = request.headers.get('content-type') || '';

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

		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
			const referenceUrl = await persistBufferToStorage(svc, buffer, user.id, ext, file.type);

			const characterRef = await generateCharacterSheetFromReference(
				locals.supabase,
				svc,
				user.id,
				agentId,
				falKey,
				referenceUrl
			);
			const { data: updatedCfg } = await locals.supabase
				.from('agent_configs')
				.select('ugc_reference_kit')
				.eq('agent_id', agentId)
				.maybeSingle();
			return json({
				success: true,
				character_ref: characterRef,
				reference_kit: updatedCfg?.ugc_reference_kit ?? {}
			});
		} catch (err) {
			return json(
				{ success: false, error: `Failed to generate from reference photo: ${(err as Error).message}` },
				{ status: 502 }
			);
		}
	}

	// ── From-scratch path ──────────────────────────────────────────────────
	const { data: cfg } = await locals.supabase
		.from('agent_configs')
		.select('ugc_voice, brand_brief_id')
		.eq('agent_id', agentId)
		.maybeSingle();
	const voiceGender = VOICE_CATALOG.find((v) => v.name === (cfg?.ugc_voice || 'Adam'))?.gender;

	// The persona profile's explicit gender (Identity → Gender) outranks the
	// gender implied by the pinned voice — the client requires F/M control
	// over the generated character, not an inference.
	let profileGender: 'male' | 'female' | undefined;
	try {
		if (agent.market && typeof agent.market === 'string' && agent.market.startsWith('{')) {
			const pp = JSON.parse(agent.market);
			if (pp.gender === 'male' || pp.gender === 'female') profileGender = pp.gender;
		}
	} catch {
		/* ignore malformed market */
	}

	// Persona's selected brand brief first (multi-brand users), newest as fallback.
	const { data: selectedBrief } = cfg?.brand_brief_id
		? await db.brandBriefs.getById(cfg.brand_brief_id, user.id)
		: { data: null };
	const { data: fallbackBrief } = selectedBrief ? { data: null } : await db.brandBriefs.get(user.id);
	const briefData = (selectedBrief ?? fallbackBrief)?.data || null;

	try {
		const characterRef = await generateCharacterPortrait(
			locals.supabase,
			svc,
			user.id,
			agentId,
			falKey,
			briefData,
			agent,
			profileGender || voiceGender
		);
		return json({ success: true, character_ref: characterRef });
	} catch (err) {
		return json(
			{ success: false, error: `Failed to generate profile picture: ${(err as Error).message}` },
			{ status: 502 }
		);
	}
};
