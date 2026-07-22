import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { refineUgcMedia } from '$lib/server/content/generate';
import { getServiceSupabase } from '$lib/server/service-supabase';

/**
 * Refine an existing draft/scheduled post: regenerate ONLY its media from a
 * user-edited visual prompt (and optionally an edited spoken line), keeping
 * the caption, hashtags, schedule, platforms, pinned face, product photo,
 * voice and format exactly as they were. This is the "the video came out
 * weird — fix the prompt and re-roll it" loop, at a fraction of a full
 * regeneration (no Director/QC run, no new caption).
 *
 * Same ASYNC JOB PATTERN as generate-post: media takes 30s–5min, so the post
 * flips to status 'generating', a 202 returns immediately, and a detached
 * task restores 'draft'/'scheduled' with the new (or, on failure, original)
 * content. The client polls the post row. On DBs without the 'generating'
 * status migration, falls back to a synchronous run (200 + updated post).
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
		return json({ success: false, error: 'Agent not found or ownership mismatch' }, { status: 404 });
	}

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		/* validated below */
	}
	const postId = typeof body.post_id === 'string' ? body.post_id : null;
	const scene = typeof body.scene === 'string' ? body.scene.trim().slice(0, 1200) : '';
	const dialogue = typeof body.dialogue === 'string' ? body.dialogue.trim().slice(0, 600) : '';
	if (!postId) return json({ success: false, error: 'Missing post_id' }, { status: 400 });
	if (!scene) return json({ success: false, error: 'Missing scene (the edited visual prompt)' }, { status: 400 });

	const { data: post, error: postErr } = await db.posts.get(postId);
	if (postErr || !post || post.user_id !== user.id || post.agent_id !== agentId) {
		return json({ success: false, error: 'Post not found or ownership mismatch' }, { status: 404 });
	}
	// Published/publishing media is live — refine only applies before publish.
	if (post.status !== 'draft' && post.status !== 'scheduled') {
		return json({ success: false, error: `Cannot refine a ${post.status} post` }, { status: 400 });
	}

	let content: any = null;
	try {
		content = JSON.parse(post.content);
	} catch {
		/* legacy plain-text post */
	}
	if (!content || !content.media_url) {
		return json(
			{ success: false, error: 'This post has no generated media to refine' },
			{ status: 400 }
		);
	}
	// A stale error from an earlier failed refine must not ride along.
	delete content.refine_error;
	const originalStatus = post.status;

	// ── Mark generating (async path); constraint rejection → synchronous run ──
	const { error: markErr } = await db.posts.update(postId, { status: 'generating' as any });
	const statusCheckRejected =
		!!markErr &&
		((markErr as any).code === '23514' ||
			/posts_status_check|check constraint/i.test(markErr.message || ''));
	if (markErr && !statusCheckRejected) {
		return json({ success: false, error: markErr.message || 'Failed to start refine' }, { status: 500 });
	}

	if (!markErr) {
		// Session tokens can expire mid-task; prefer the service-role client.
		let taskSupabase: any;
		try {
			taskSupabase = getServiceSupabase();
		} catch {
			taskSupabase = locals.supabase;
		}
		const userId = user.id;

		void (async () => {
			const taskDb = createDbService(taskSupabase);
			try {
				const refined = await refineUgcMedia({
					supabase: taskSupabase,
					userId,
					agentId,
					postId,
					content,
					scene,
					dialogue: dialogue || undefined
				});
				await taskDb.posts.update(postId, {
					content: JSON.stringify(refined),
					status: originalStatus,
					token_cost: refined.costBreakdown?.total ?? post.token_cost ?? 0
				});
			} catch (refineErr) {
				console.error('[refine-post] Detached refine failed:', refineErr);
				// The original media is untouched — restore the post exactly as it
				// was, with the failure recorded for the drawer to surface.
				try {
					await taskDb.posts.update(postId, {
						content: JSON.stringify({
							...content,
							refine_error: (refineErr as Error).message || 'Refine failed'
						}),
						status: originalStatus
					});
				} catch (updateErr) {
					console.error('[refine-post] Failed to record refine failure:', updateErr);
				}
			}
		})();

		return json({ success: true, post_id: postId, status: 'generating' }, { status: 202 });
	}

	// ── Legacy synchronous fallback (no 'generating' status in the DB yet) ──
	console.warn(
		"[refine-post] posts_status_check rejected status 'generating' — apply post_status_generating_migration.sql. Falling back to synchronous refine."
	);
	try {
		const refined = await refineUgcMedia({
			supabase: locals.supabase,
			userId: user.id,
			agentId,
			postId,
			content,
			scene,
			dialogue: dialogue || undefined
		});
		const { data: updated, error: updateErr } = await db.posts.update(postId, {
			content: JSON.stringify(refined),
			token_cost: refined.costBreakdown?.total ?? post.token_cost ?? 0
		});
		if (updateErr) throw updateErr;
		return json({ success: true, post: updated });
	} catch (refineErr) {
		return json(
			{ success: false, error: (refineErr as Error).message || 'Refine failed' },
			{ status: 500 }
		);
	}
};
