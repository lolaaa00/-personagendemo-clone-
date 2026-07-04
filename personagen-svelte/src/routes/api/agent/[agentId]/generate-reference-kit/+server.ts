import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import {
	generateSideProfileComposite,
	generateFacialCloseup,
	generateFeatureGrid,
	resolveImageKeys
} from '$lib/server/content/generate';
import { getServiceSupabase } from '$lib/server/service-supabase';

const VALID_STAGES = ['side_profiles', 'face_closeup', 'feature_grid'] as const;

/**
 * Drives stages 3 (side-profile composite), 4 (facial close-up), and 5
 * (feature grid) of the character reference pipeline — all explicit,
 * user-approved follow-ups to the stage-1/2 sheet + full-body shot generated
 * by /api/agent/[agentId]/generate-avatar. Each stage reads whatever it needs
 * from the agent's existing `ugc_reference_kit` (populated by earlier
 * stages) rather than requiring the client to resend image URLs.
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

	try {
		if (stage === 'side_profiles') {
			// A full-body shot is the minimum. The sheet sharpens fidelity but
			// isn't required — fall back to the full-body shot as the reference so
			// from-scratch personas (which may not have a separate sheet) still work.
			const frontal = kit.full_body || kit.sheet || characterRef;
			if (!frontal) {
				return json(
					{ success: false, error: 'Generate a profile picture first.' },
					{ status: 400 }
				);
			}
			const url = await generateSideProfileComposite(
				locals.supabase,
				svc,
				user.id,
				agentId,
				falKey,
				frontal,
				kit.sheet || frontal
			);
			return json({ success: true, side_profiles: url });
		}

		if (stage === 'face_closeup') {
			const reference = kit.side_profiles || kit.full_body;
			if (!reference) {
				return json(
					{ success: false, error: 'Generate the side-profile composite first.' },
					{ status: 400 }
				);
			}
			const url = await generateFacialCloseup(locals.supabase, svc, user.id, agentId, falKey, reference);
			return json({ success: true, face_closeup: url });
		}

		// stage === 'feature_grid'
		if (!kit.face_closeup) {
			return json(
				{ success: false, error: 'Generate the facial close-up first.' },
				{ status: 400 }
			);
		}
		const url = await generateFeatureGrid(
			locals.supabase,
			svc,
			user.id,
			agentId,
			falKey,
			kit.face_closeup,
			kit.sheet || kit.full_body || kit.face_closeup
		);
		return json({ success: true, feature_grid: url });
	} catch (err) {
		return json(
			{ success: false, error: `Failed to generate ${stage}: ${(err as Error).message}` },
			{ status: 502 }
		);
	}
};
