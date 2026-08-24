import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { loadBriefForAgent } from '$lib/server/content/generate';

/**
 * Factual observability for one post: the ACTUAL models + costs that ran for its
 * generation (from the generation_events ledger) and the real product reference
 * image (from the brand brief). Nothing here is invented — if a value can't be
 * recovered, it's simply omitted rather than guessed.
 *
 * Ledger match precedence:
 *   1. rows already linked by post_id (new posts) — exact.
 *   2. else rows whose asset_url IS this post's media/poster — exact output link.
 *   3. else rows for this agent within a tight window around the post's creation
 *      (older posts, whose ledger rows predate post_id linkage) — best-effort.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	const agentId = params.agentId;
	const postId = url.searchParams.get('postId');
	if (!agentId || !postId)
		return json({ success: false, error: 'Missing agentId or postId' }, { status: 400 });

	const db = createDbService(locals.supabase);
	const { data: agent } = await db.agents.get(agentId);
	if (!agent || agent.user_id !== user.id)
		return json({ success: false, error: 'Persona not found' }, { status: 404 });
	const { data: post } = await db.posts.get(postId);
	if (!post || post.agent_id !== agentId)
		return json({ success: false, error: 'Post not found for this persona' }, { status: 404 });

	let content: any = {};
	try {
		content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content || {};
	} catch {
		content = {};
	}
	const mediaUrl: string | null = content?.media_url ?? null;
	const posterUrl: string | null = content?.poster_url ?? null;

	// ── Actual models + cost from the ledger — DEFINITIVE links only ─────────
	// We attribute ledger rows to this post ONLY when they're linked by post_id
	// or their persisted asset_url IS this post's media/poster. A time-proximity
	// guess is deliberately NOT used: it could mis-attribute a different post's
	// models, which would be exactly the kind of fabrication we're avoiding. If
	// nothing links, per-model detail simply wasn't recorded — say so honestly.
	let rows: any[] = [];
	let matchMode: 'linked' | 'asset' | 'none' = 'none';

	const { data: linked } = await locals.supabase
		.from('generation_events')
		.select('operation, model, est_cost, asset_url')
		.eq('post_id', postId);
	if (linked && linked.length) {
		rows = linked;
		matchMode = 'linked';
	} else if (mediaUrl || posterUrl) {
		const assets = [mediaUrl, posterUrl].filter(Boolean) as string[];
		const { data: byAsset } = await locals.supabase
			.from('generation_events')
			.select('operation, model, est_cost, asset_url')
			.eq('agent_id', agentId)
			.in('asset_url', assets);
		if (byAsset && byAsset.length) {
			rows = byAsset;
			matchMode = 'asset';
		}
	}

	const aspects: Record<string, { models: string[]; usd: number }> = {};
	let total = 0;
	for (const r of rows) {
		if (r.operation === 'persist') continue;
		const a = (aspects[r.operation] ||= { models: [], usd: 0 });
		if (r.model && !a.models.includes(r.model)) a.models.push(r.model);
		a.usd = +(a.usd + Number(r.est_cost || 0)).toFixed(6);
		total = +(total + Number(r.est_cost || 0)).toFixed(6);
	}

	// ── Real product reference image (from the brief the persona uses) ───────
	let productPhoto: string | null = null;
	try {
		const productName: string | undefined = content?.product?.name;
		if (productName) {
			const { data: cfg } = await locals.supabase
				.from('agent_configs')
				.select('brand_brief_id')
				.eq('agent_id', agentId)
				.maybeSingle();
			const brief = await loadBriefForAgent(db, user.id, cfg?.brand_brief_id || null);
			const products = brief?.data?.products;
			if (Array.isArray(products)) {
				// EXACT name match only. Falling back to "any product with a photo"
				// showed an arbitrary — possibly different — product as this post's
				// reference the moment the original was renamed or removed, in the
				// same figure grid as genuinely-sent images. Omission beats invention.
				const match = products.find((p: any) => p?.name === productName);
				productPhoto = match?.photoUrl || null;
			}
		}
	} catch {
		/* best-effort */
	}

	return json({
		success: true,
		aspects,
		total,
		matchMode,
		productPhoto,
		mediaUrl,
		posterUrl
	});
};
