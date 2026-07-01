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

	// Resolve target platforms from the agent's active connections
	const { data: connections } = await locals.supabase
		.from('connections')
		.select('platform')
		.eq('agent_id', agentId)
		.eq('status', 'active');

	const targetPlatforms = (connections || []).map((c: any) => c.platform);
	if (targetPlatforms.length === 0) {
		return json(
			{ success: false, error: 'No active social connections. Connect a platform first.' },
			{ status: 400 }
		);
	}

	// Generate a UGC pack tuned to the brand brief / product
	let content;
	try {
		const pack = await generateUgcPack({
			supabase: locals.supabase,
			userId: user.id,
			agentId,
			productId: body.product_id || body.productId,
			platform: body.platform || targetPlatforms[0],
			topic: body.topic
		});
		content = pack.content;
	} catch (genErr) {
		const msg = (genErr as Error).message;
		const status = /image generation/i.test(msg) ? 502 : 500;
		return json({ success: false, error: msg }, { status });
	}

	// Now that media_type is known, drop video-only platforms if this pack is image-only.
	let finalPlatforms = targetPlatforms;
	if (content?.media_type !== 'video') {
		finalPlatforms = targetPlatforms.filter(
			(p: string) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p.toLowerCase())
		);
	}
	if (finalPlatforms.length === 0) {
		return json(
			{
				success: false,
				error: `Generated content is image-only, and none of this agent's connected platforms (${targetPlatforms.join(', ')}) accept image posts.`
			},
			{ status: 400 }
		);
	}

	// Create the post, then publish it immediately
	const now = new Date();
	const { data: post, error: postErr } = await db.posts.create({
		user_id: user.id,
		agent_id: agentId,
		content: JSON.stringify(content),
		platforms: finalPlatforms,
		status: 'scheduled',
		scheduled_date: now.toISOString().split('T')[0],
		scheduled_time: now.toTimeString().split(' ')[0],
		published_at: null
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
	return json({ success: true, post: updatedPost || post, published });
};
