import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { removeKitAssets, clearCharacterRef, RESTORABLE_KIT_STAGES } from '$lib/server/content/generate';

/**
 * Deletes persona reference photos — the write side of asset manageability.
 *
 * POST { items: [{ kind: 'kit' | 'avatar', stage?, url? }] }
 *
 * Supports multi-select: one call removes any mix of kit-stage images and the
 * pinned profile picture. "Delete" unpins and drops the image from this
 * persona's kit/history; the underlying bucket object is preserved because a
 * published post may reference it and the image library is append-only, which
 * also means Restore-from-history can still bring it back.
 */
async function requireOwnedAgent(locals: any, agentId: string | undefined) {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return {
			ok: false as const,
			res: json({ success: false, error: 'Unauthorized' }, { status: 401 })
		};
	}
	if (!agentId) {
		return {
			ok: false as const,
			res: json({ success: false, error: 'Missing agentId' }, { status: 400 })
		};
	}
	const db = createDbService(locals.supabase);
	const { data: agent, error } = await db.agents.get(agentId);
	if (error || !agent || agent.user_id !== user.id) {
		return {
			ok: false as const,
			res: json({ success: false, error: 'Agent not found or ownership mismatch' }, { status: 404 })
		};
	}
	return { ok: true as const, user, agent };
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const ctx = await requireOwnedAgent(locals, params.agentId);
	if (!ctx.ok) return ctx.res;

	const body = (await request.json().catch(() => ({}))) as any;
	const items: Array<{ kind?: string; stage?: string; url?: string }> = Array.isArray(body.items)
		? body.items
		: [];
	if (items.length === 0) {
		return json({ success: false, error: 'No assets supplied' }, { status: 400 });
	}
	if (items.length > 100) {
		return json({ success: false, error: 'Too many assets (max 100 per request)' }, { status: 400 });
	}

	// Service client so the read-modify-write of ugc_reference_kit isn't gated by
	// RLS mid-session (mirrors the rest of the kit pipeline).
	let svc: any;
	try {
		svc = getServiceSupabase();
	} catch {
		svc = locals.supabase;
	}

	const kitTargets: Array<{ stage: string; url: string }> = [];
	let clearAvatar = false;
	for (const item of items) {
		if (item?.kind === 'avatar') {
			clearAvatar = true;
			continue;
		}
		const url = String(item?.url || '').trim();
		if (!url) continue;
		const stage = String(item?.stage || '').trim();
		if (stage) {
			kitTargets.push({ stage, url });
		} else {
			// No stage given (e.g. deleting from the mixed Assets grid) — remove the
			// url from every stage that holds it.
			for (const s of RESTORABLE_KIT_STAGES) kitTargets.push({ stage: s, url });
		}
	}

	try {
		let kit: Record<string, any> | null = null;
		if (kitTargets.length > 0) {
			kit = await removeKitAssets(svc, params.agentId!, kitTargets);
		}
		if (clearAvatar) {
			await clearCharacterRef(svc, params.agentId!);
		}
		return json({
			success: true,
			removed: items.length,
			avatarCleared: clearAvatar,
			kit
		});
	} catch (err) {
		console.error('[delete-assets] failed:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
