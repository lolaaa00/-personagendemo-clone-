import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { isOwnedBucketUrl } from '$lib/server/storage';
import { repinKitStage, RESTORABLE_KIT_STAGES } from '$lib/server/content/generate';

/**
 * Per-stage reference-kit restore.
 *
 * POST { stage, url } → re-pin one reference-kit stage (full_body, side_profiles,
 * face_closeup, feature_grid, sheet) to a past image from THAT stage's history.
 *
 * Nothing is generated or deleted — restore only moves the pointer. The url is
 * validated to (a) live in this user's own bucket folder and (b) already be in
 * the requested stage's history, so it can't pin an arbitrary image to a stage.
 */
async function requireOwnedAgent(locals: any, agentId: string | undefined) {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user)
		return { ok: false as const, res: json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
	if (!agentId)
		return { ok: false as const, res: json({ success: false, error: 'Missing agentId' }, { status: 400 }) };
	const db = createDbService(locals.supabase);
	const { data: agent, error } = await db.agents.get(agentId);
	if (error || !agent || agent.user_id !== user.id) {
		return {
			ok: false as const,
			res: json({ success: false, error: 'Persona not found or ownership mismatch' }, { status: 404 })
		};
	}
	return { ok: true as const, user, agent };
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const ctx = await requireOwnedAgent(locals, params.agentId);
	if (!ctx.ok) return ctx.res;

	const body = (await request.json().catch(() => ({}))) as any;
	const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
	const url = typeof body.url === 'string' ? body.url.trim() : '';
	if (!stage || !RESTORABLE_KIT_STAGES.includes(stage))
		return json({ success: false, error: 'Unknown reference-kit stage' }, { status: 400 });
	if (!url) return json({ success: false, error: 'Missing image url' }, { status: 400 });
	if (!isOwnedBucketUrl(url, ctx.user.id))
		return json({ success: false, error: 'That image is not in your library.' }, { status: 400 });

	// Use the service client so the RMW of ugc_reference_kit isn't gated by RLS
	// mid-session (mirrors the rest of the kit pipeline).
	let svc: any;
	try {
		svc = getServiceSupabase();
	} catch {
		svc = locals.supabase;
	}

	try {
		const kit = await repinKitStage(svc, params.agentId!, stage, url);
		return json({ success: true, stage, url, kit });
	} catch (err) {
		return json({ success: false, error: (err as Error).message }, { status: 400 });
	}
};
