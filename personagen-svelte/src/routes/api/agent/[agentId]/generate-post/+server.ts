import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { generateUgcPack } from '$lib/server/content/generate';
import { publishPostById } from '$lib/server/scheduler';
import { VIDEO_ONLY_PLATFORMS } from '$lib/server/social/platforms';

/**
 * Generate a fresh UGC post (caption + AI image tuned to the brand brief / product)
 * for an agent and publish it immediately to that agent's live connected accounts.
 *
 * Called by the calendar '✨ Generate Post Now' button and the persona feed's 'Generate Now' action.
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

	// Verify agent ownership
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent || agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Agent not found or ownership mismatch' },
			{ status: 404 }
		);
	}

	// Optional overrides (product focus, platform, topic)
	let body: any = {};
	try {
		body = await request.json();
	} catch {
		/* an empty body is fine */
	}

	// Resolve target platforms from the agent's active connections (used for
	// publishing). Generation itself does NOT require any connection — an agent
	// with no linked account still generates content, saved as a draft to
	// publish later once connected.
	const { data: connections } = await locals.supabase
		.from('connections')
		.select('platform')
		.eq('agent_id', agentId)
		.eq('status', 'active');

	const connectedPlatforms = (connections || []).map((c: any) => c.platform);

	// Composer platform selection: an explicit subset wins (validated against
	// the agent's connections so a stray value can't route to a dead platform).
	const requestedPlatforms: string[] = Array.isArray(body.platforms)
		? body.platforms
				.map((p: string) => String(p).toLowerCase())
				.filter((p: string) => connectedPlatforms.includes(p))
		: [];
	const targetPool = requestedPlatforms.length > 0 ? requestedPlatforms : connectedPlatforms;

	// Generate a UGC pack tuned to the persona / brand brief / product.
	// Shape the content for a real connected platform when we have one, else
	// default to Instagram so aspect/format still make sense.
	let content;
	try {
		const pack = await generateUgcPack({
			supabase: locals.supabase,
			userId: user.id,
			agentId,
			productId: body.product_id || body.productId,
			platform: body.platform || targetPool[0] || 'instagram',
			topic: body.topic,
			// Composer overrides — every field the confirm modal lets the user edit.
			video: body.media === 'image' ? false : undefined,
			providerPreference: ['auto', 'fal', 'openrouter'].includes(body.provider)
				? body.provider
				: undefined,
			sceneOverride: typeof body.scene === 'string' ? body.scene.slice(0, 1200) : undefined,
			productPhotoUrlOverride:
				typeof body.product_photo_url === 'string' && /^https?:\/\//i.test(body.product_photo_url)
					? body.product_photo_url
					: undefined,
			characterRefOverride:
				typeof body.character_ref_url === 'string' && /^https?:\/\//i.test(body.character_ref_url)
					? body.character_ref_url
					: undefined
		});
		content = pack.content;
	} catch (genErr) {
		const msg = (genErr as Error).message;
		const status = /image generation/i.test(msg) ? 502 : 500;
		return json({ success: false, error: msg }, { status });
	}

	// Which SELECTED platforms can actually accept this pack's media type?
	let publishablePlatforms = targetPool;
	if (content?.media_type !== 'video') {
		publishablePlatforms = targetPool.filter(
			(p: string) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p.toLowerCase())
		);
	}

	const now = new Date();

	// No publishable platform → save the generated content as a DRAFT rather
	// than erroring. This is the "generate without a connection" path.
	if (publishablePlatforms.length === 0) {
		const reason =
			connectedPlatforms.length === 0
				? 'No social account connected yet — saved as a draft.'
				: `Content is image-only and the selected platform(s) (${targetPool.join(', ')}) don't accept image posts — saved as a draft.`;
		const { data: draft, error: draftErr } = await db.posts.create({
			user_id: user.id,
			agent_id: agentId,
			content: JSON.stringify(content),
			platforms: targetPool,
			status: 'draft',
			scheduled_date: null,
			scheduled_time: null,
			published_at: null,
			token_cost: content?.costBreakdown?.total ?? 0
		});
		if (draftErr || !draft) {
			return json(
				{ success: false, error: draftErr?.message || 'Failed to save draft' },
				{ status: 500 }
			);
		}
		return json({ success: true, post: draft, published: false, draft: true, reason });
	}

	// Have a publishable platform → create a scheduled post and publish now.
	const { data: post, error: postErr } = await db.posts.create({
		user_id: user.id,
		agent_id: agentId,
		content: JSON.stringify(content),
		platforms: publishablePlatforms,
		status: 'scheduled',
		scheduled_date: now.toISOString().split('T')[0],
		scheduled_time: now.toTimeString().split(' ')[0],
		published_at: null,
		token_cost: content?.costBreakdown?.total ?? 0
	});

	if (postErr || !post) {
		return json(
			{ success: false, error: postErr?.message || 'Failed to create post' },
			{ status: 500 }
		);
	}

	let published = false;
	try {
		published = await publishPostById(post.id);
	} catch (pubErr) {
		console.error('[generate-post] Immediate publish failed:', pubErr);
	}

	const { data: updatedPost } = await db.posts.get(post.id);
	return json({ success: true, post: updatedPost || post, published, draft: false });
};
