import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { publishPostById } from '$lib/server/scheduler';
import { VIDEO_ONLY_PLATFORMS } from '$lib/server/social/platforms';

/**
 * Manual "publish this already-generated post to a connected platform".
 *
 * A post that generated fine but couldn't publish (its target platform wasn't
 * connected) keeps its media. This lets the user send that media to a platform
 * that IS connected — the user picks when and where. Nothing auto-retries.
 *
 * GET  ?postId=…  → the persona's connected platforms compatible with this post's
 *                   media (an image can't go to a video-only platform).
 * POST { postId, platforms } → re-target the post to the chosen connected
 *                   platforms and publish now.
 */

type OwnedCtx =
	| { err: Response; user?: undefined; db?: undefined; agent?: undefined; post?: undefined }
	| { err?: undefined; user: any; db: any; agent: any; post: any };

async function ownedAgentAndPost(
	locals: any,
	agentId: string | undefined,
	postId: string
): Promise<OwnedCtx> {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return { err: json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
	if (!agentId) return { err: json({ success: false, error: 'Missing agentId' }, { status: 400 }) };
	if (!postId) return { err: json({ success: false, error: 'Missing postId' }, { status: 400 }) };
	const db = createDbService(locals.supabase);
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent || agent.user_id !== user.id)
		return { err: json({ success: false, error: 'Agent not found or ownership mismatch' }, { status: 404 }) };
	const { data: post, error: postErr } = await db.posts.get(postId);
	if (postErr || !post || post.agent_id !== agentId)
		return { err: json({ success: false, error: 'Post not found for this persona' }, { status: 404 }) };
	return { user, db, agent, post };
}

/** The post's media type ('video' | 'image' | …) read from its content JSON. */
function mediaTypeOf(post: any): string {
	try {
		const c = typeof post.content === 'string' ? JSON.parse(post.content) : post.content;
		return c?.media_type || (c?.media_url ? 'image' : '');
	} catch {
		return '';
	}
}

/** Connected, active platforms for this persona that can accept this media. */
async function connectedCompatible(locals: any, agentId: string, post: any): Promise<string[]> {
	const { data: connections } = await locals.supabase
		.from('connections')
		.select('platform')
		.eq('agent_id', agentId)
		.eq('status', 'active');
	let platforms = (connections || []).map((c: any) => String(c.platform).toLowerCase());
	// A non-video post can't publish to a video-only platform (YouTube/TikTok).
	if (mediaTypeOf(post) !== 'video') {
		platforms = platforms.filter((p: string) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p));
	}
	return [...new Set<string>(platforms)];
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const postId = url.searchParams.get('postId') ?? '';
	const ctx = await ownedAgentAndPost(locals, params.agentId, postId);
	if (ctx.err) return ctx.err;
	const connectedPlatforms = await connectedCompatible(locals, params.agentId!, ctx.post);
	return json({ success: true, connectedPlatforms, mediaType: mediaTypeOf(ctx.post) });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => ({}))) as any;
	const postId = typeof body.postId === 'string' ? body.postId : '';
	const ctx = await ownedAgentAndPost(locals, params.agentId, postId);
	if (ctx.err) return ctx.err;

	const requested = Array.isArray(body.platforms)
		? body.platforms.map((p: string) => String(p).toLowerCase())
		: [];
	if (requested.length === 0)
		return json({ success: false, error: 'Pick at least one platform to publish to.' }, { status: 400 });

	// Only allow platforms that are actually connected AND media-compatible — the
	// user can't route an image to YouTube or send to an unconnected account.
	const allowed = await connectedCompatible(locals, params.agentId!, ctx.post);
	const platforms = requested.filter((p: string) => allowed.includes(p));
	if (platforms.length === 0) {
		return json(
			{
				success: false,
				error:
					allowed.length === 0
						? 'No connected account can accept this post yet. Connect a platform first.'
						: `None of the chosen platforms are connected. Available: ${allowed.join(', ')}.`
			},
			{ status: 400 }
		);
	}

	// Re-target and re-arm the post, then publish now. Clear the stale
	// publication_results so the old failure (e.g. youtube) doesn't linger.
	const now = new Date();
	const { error: updErr } = await ctx.db.posts.update(postId, {
		platforms,
		status: 'scheduled',
		publication_results: null,
		scheduled_date: now.toISOString().split('T')[0],
		scheduled_time: now.toTimeString().split(' ')[0]
	} as any);
	if (updErr) return json({ success: false, error: updErr.message }, { status: 500 });

	try {
		await publishPostById(postId);
	} catch (e) {
		return json({ success: false, error: `Publish failed: ${(e as Error).message}` }, { status: 502 });
	}

	// Report the fresh outcome.
	const { data: fresh } = await ctx.db.posts.get(postId);
	return json({
		success: true,
		status: fresh?.status ?? 'scheduled',
		platforms,
		publication_results: fresh?.publication_results ?? null
	});
};
