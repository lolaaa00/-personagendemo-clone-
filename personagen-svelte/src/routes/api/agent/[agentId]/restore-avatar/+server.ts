import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { listUserImages, isOwnedBucketUrl } from '$lib/server/storage';

/**
 * Profile-picture history / restore.
 *
 * GET  → every image ever generated for this user (newest first), so a past
 *        profile picture can be restored after a regeneration changed it.
 * POST { url } → re-pin one of those images as this persona's ugc_character_ref.
 *
 * Nothing is deleted anywhere — restore only moves the pointer. The POST url is
 * validated to live in THIS user's own bucket folder, so it can't pin an
 * arbitrary external URL as a persona's face.
 */
type OwnCtx =
	| { ok: true; user: any; agent: any; db: ReturnType<typeof createDbService> }
	| { ok: false; res: Response };

async function requireOwnedAgent(locals: any, agentId: string | undefined): Promise<OwnCtx> {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user)
		return { ok: false, res: json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
	if (!agentId)
		return { ok: false, res: json({ success: false, error: 'Missing agentId' }, { status: 400 }) };
	const db = createDbService(locals.supabase);
	const { data: agent, error } = await db.agents.get(agentId);
	if (error || !agent || agent.user_id !== user.id) {
		return {
			ok: false,
			res: json({ success: false, error: 'Persona not found or ownership mismatch' }, { status: 404 })
		};
	}
	return { ok: true, user, agent, db };
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const ctx = await requireOwnedAgent(locals, params.agentId);
	if (!ctx.ok) return ctx.res;

	let svc: any;
	try {
		svc = getServiceSupabase();
	} catch {
		return json({ success: false, error: 'Storage service is not configured on this server.' }, { status: 500 });
	}
	const images = await listUserImages(svc, ctx.user.id, 100);
	return json({ success: true, images });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const ctx = await requireOwnedAgent(locals, params.agentId);
	if (!ctx.ok) return ctx.res;

	const body = (await request.json().catch(() => ({}))) as any;
	const url = typeof body.url === 'string' ? body.url.trim() : '';
	if (!url) return json({ success: false, error: 'Missing image url' }, { status: 400 });
	if (!isOwnedBucketUrl(url, ctx.user.id)) {
		return json({ success: false, error: 'That image is not in your library.' }, { status: 400 });
	}

	const { error } = await ctx.db.agentConfigs.upsert({
		user_id: ctx.user.id,
		agent_id: params.agentId!,
		ugc_character_ref: url
	});
	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true, character_ref: url });
};
