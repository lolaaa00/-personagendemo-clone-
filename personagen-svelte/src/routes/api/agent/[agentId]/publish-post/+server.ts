import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { publishPostById } from '$lib/server/scheduler';
import { VIDEO_ONLY_PLATFORMS } from '$lib/server/social/platforms';
import { checkAgentAccess } from '$lib/server/workspaces';

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
	if (agentErr || !agent)
		return { err: json({ success: false, error: 'Persona not found or ownership mismatch' }, { status: 404 }) };
	// Publishing is manager+ — same tier as approving in the review queue.
	const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'manager');
	if (!access.ok) return { err: json({ success: false, error: access.message }, { status: access.status }) };
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

/**
 * Platforms this post is ALREADY LIVE on (publication_results[platform].status
 * === 'published', the marker the scheduler itself writes and honours). A
 * partly-published post must never be sent to these again: Instagram cannot
 * be deleted through the API, so a double post is permanent (round-5 re-audit
 * caught the picker preselecting exactly that).
 */
function livePlatforms(post: any): string[] {
	const results = post?.publication_results;
	if (!results || typeof results !== 'object') return [];
	return Object.entries(results as Record<string, any>)
		.filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object' && v.status === 'published')
		.map(([k]) => k.toLowerCase());
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const postId = url.searchParams.get('postId') ?? '';
	const ctx = await ownedAgentAndPost(locals, params.agentId, postId);
	if (ctx.err) return ctx.err;
	const connectedPlatforms = await connectedCompatible(locals, params.agentId!, ctx.post);
	return json({
		success: true,
		connectedPlatforms,
		alreadyLive: livePlatforms(ctx.post),
		mediaType: mediaTypeOf(ctx.post)
	});
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => ({}))) as any;
	const postId = typeof body.postId === 'string' ? body.postId : '';
	const ctx = await ownedAgentAndPost(locals, params.agentId, postId);
	if (ctx.err) return ctx.err;

	// A 'generating' row is mid-generation or mid-refine: its media is about to
	// be replaced by the detached task. Publishing NOW would push the stale clip
	// live and then race the task's completion write. Fail loudly instead.
	if (ctx.post.status === 'generating') {
		return json(
			{ success: false, error: 'This post is still generating — wait for it to finish before publishing.' },
			{ status: 409 }
		);
	}

	// Only allow platforms that are actually connected AND media-compatible — the
	// user can't route an image to YouTube or send to an unconnected account.
	const allowed = await connectedCompatible(locals, params.agentId!, ctx.post);

	const requested = Array.isArray(body.platforms)
		? body.platforms.map((p: string) => String(p).toLowerCase())
		: [];

	let platforms: string[];
	if (requested.length) {
		// Explicit pick (the "publish to a connected platform" picker).
		platforms = requested.filter((p: string) => allowed.includes(p));
	} else {
		// "Post Now" (no picker): target the post's own platforms when they're
		// connected + compatible, otherwise fall back to every connected platform.
		const own = (Array.isArray(ctx.post.platforms) ? ctx.post.platforms : [])
			.map((p: string) => String(p).toLowerCase())
			.filter((p: string) => allowed.includes(p));
		platforms = own.length ? own : allowed;
	}

	// Never to a platform it is already live on — whatever the client asked.
	const live = livePlatforms(ctx.post);
	platforms = platforms.filter((p: string) => !live.includes(p));
	if (platforms.length === 0 && live.length > 0) {
		return json(
			{
				success: false,
				error: `This post is already live on ${live.join(', ')} — there is nothing left to send it to.`
			},
			{ status: 400 }
		);
	}

	if (platforms.length === 0) {
		return json(
			{
				success: false,
				error:
					allowed.length === 0
						? 'No connected account can accept this post yet. Connect a platform first.'
						: requested.length
							? `None of the chosen platforms are connected. Available: ${allowed.join(', ')}.`
							: 'No connected account can accept this post yet. Connect a platform first.'
			},
			{ status: 400 }
		);
	}

	// Re-target and re-arm the post, then publish now. Stale FAILURES are
	// dropped so the old error doesn't linger; records of platforms it is live
	// on are KEPT (the scheduler skips those, and the "View live post" link
	// comes from them). Nulling everything lost the first post's record
	// (round-5 re-audit).
	const prevResults = (ctx.post.publication_results ?? {}) as Record<string, any>;
	const keptResults: Record<string, any> = {};
	for (const [k, v] of Object.entries(prevResults)) {
		if (k.startsWith('_')) continue;
		if (v && typeof v === 'object' && v.status === 'published') keptResults[k] = v;
	}
	const now = new Date();
	const { error: updErr } = await ctx.db.posts.update(postId, {
		platforms: [...new Set([...live, ...platforms])],
		status: 'scheduled',
		publication_results: keptResults,
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
