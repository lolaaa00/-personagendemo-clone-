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
	// Cinematic posts are a multi-shot Kling O3 Pro reference video — re-rolling
	// them through the single-shot refine pipeline would silently downgrade the
	// format the user paid for. Refuse honestly instead.
	if (content.cinematic === true) {
		return json(
			{
				success: false,
				error:
					'Cinematic multi-shot posts cannot be refined yet — generate a fresh cinematic post from the composer instead.'
			},
			{ status: 400 }
		);
	}
	// Stale markers from an earlier refine must not ride along.
	delete content.refine_error;
	delete content.refine_started_at;
	delete content.refine_prev_status;
	const originalStatus = post.status;

	// ── Mark generating (async path); constraint rejection → synchronous run ──
	// The refine markers written alongside the status are load-bearing:
	// refine_started_at gives the scheduler's orphan reaper the REAL job start
	// (created_at is days old for a refined post), and refine_prev_status tells
	// it to RESTORE the post (original media intact) rather than fail it if this
	// process dies mid-refine.
	const { error: markErr } = await db.posts.update(postId, {
		status: 'generating' as any,
		content: JSON.stringify({
			...content,
			refine_started_at: new Date().toISOString(),
			refine_prev_status: originalStatus
		})
	});
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
			// Every terminal write is compare-and-swapped on status='generating':
			// if anything else resolved the row meanwhile (the orphan reaper after a
			// long stall, a delete), this task must NOT stomp that outcome. The
			// refine spend is already in the ledger with durable asset URLs either way.
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
				const { data: applied, error: applyErr } = await taskSupabase
					.from('posts')
					.update({
						content: JSON.stringify(refined),
						status: originalStatus,
						token_cost: refined.costBreakdown?.total ?? post.token_cost ?? 0
					})
					.eq('id', postId)
					.eq('status', 'generating')
					.select('id');
				if (applyErr) {
					console.error('[refine-post] Failed to save refined content:', applyErr.message);
				} else if (!applied || applied.length === 0) {
					console.warn(
						`[refine-post] Post ${postId} was resolved by something else mid-refine — refined media not applied (asset preserved in the generation ledger).`
					);
				}
			} catch (refineErr) {
				console.error('[refine-post] Detached refine failed:', refineErr);
				// The original media is untouched — restore the post exactly as it
				// was, with the failure recorded for the drawer to surface.
				try {
					await taskSupabase
						.from('posts')
						.update({
							content: JSON.stringify({
								...content,
								refine_error: (refineErr as Error).message || 'Refine failed'
							}),
							status: originalStatus
						})
						.eq('id', postId)
						.eq('status', 'generating');
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
