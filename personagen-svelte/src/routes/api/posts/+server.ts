import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { teardownPost, type TeardownResult } from '$lib/server/social/publisher';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as any;
	const { action } = body;

	if (!action) {
		return json({ success: false, error: 'Missing action' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);

	try {
		if (action === 'create') {
			const { post } = body;
			if (!post) return json({ success: false, error: 'Missing post data' }, { status: 400 });

			const agentId = post.agent_id || post.agentId;
			if (!agentId) return json({ success: false, error: 'Missing agentId' }, { status: 400 });

			// Verify agent ownership
			const { data: agent, error: agentErr } = await db.agents.get(agentId);
			if (agentErr || !agent || agent.user_id !== user.id) {
				return json(
					{ success: false, error: 'Agent not found or ownership mismatch' },
					{ status: 404 }
				);
			}

			// Format platforms as PostgreSQL array
			const platforms = Array.isArray(post.platforms)
				? post.platforms.map((p: string) => p.toLowerCase())
				: [];

			const { data, error } = await db.posts.create({
				user_id: user.id,
				agent_id: agentId,
				content:
					typeof post.content === 'object'
						? JSON.stringify(post.content)
						: String(post.content || post.text || ''),
				platforms,
				status: post.status || 'draft',
				scheduled_date: post.scheduled_date || post.scheduledDate || null,
				scheduled_time: post.scheduled_time || post.scheduledTime || null,
				published_at: post.published_at || post.publishedAt || null
			});

			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'update') {
			const { id, content, status, scheduled_date, scheduled_time, published_at, platforms } = body;
			if (!id) return json({ success: false, error: 'Missing post id' }, { status: 400 });

			// Verify post ownership
			const { data: existingPost, error: getErr } = await db.posts.get(id);
			if (getErr || !existingPost || existingPost.user_id !== user.id) {
				return json(
					{ success: false, error: 'Post not found or ownership mismatch' },
					{ status: 404 }
				);
			}

			// A 'generating' row is owned by a detached generation/refine task that
			// will overwrite content and status when it finishes — any edit accepted
			// here (approve, caption save) would be silently lost or, worse, stomp
			// the task's compare-and-swap. Fail loudly instead.
			if (existingPost.status === 'generating') {
				return json(
					{ success: false, error: 'This post is still generating — wait for it to finish.' },
					{ status: 409 }
				);
			}

			const updateData: any = {};
			if (content !== undefined)
				updateData.content =
					typeof content === 'object' ? JSON.stringify(content) : String(content);
			if (status !== undefined) updateData.status = status;
			if (scheduled_date !== undefined) updateData.scheduled_date = scheduled_date;
			if (scheduled_time !== undefined) updateData.scheduled_time = scheduled_time;
			if (published_at !== undefined) updateData.published_at = published_at;
			if (platforms !== undefined) {
				updateData.platforms = Array.isArray(platforms)
					? platforms.map((p: string) => p.toLowerCase())
					: [];
			}

			const { data, error } = await db.posts.update(id, updateData);
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'reschedule') {
			const { id, scheduled_date, scheduled_time } = body;
			if (!id) return json({ success: false, error: 'Missing post id' }, { status: 400 });
			if (!scheduled_date && !scheduled_time) {
				return json(
					{ success: false, error: 'Missing scheduled_date or scheduled_time' },
					{ status: 400 }
				);
			}
			if (scheduled_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(scheduled_date))) {
				return json(
					{ success: false, error: 'Invalid scheduled_date (YYYY-MM-DD)' },
					{ status: 400 }
				);
			}
			if (scheduled_time !== undefined && !/^\d{2}:\d{2}(:\d{2})?$/.test(String(scheduled_time))) {
				return json(
					{ success: false, error: 'Invalid scheduled_time (HH:MM[:SS])' },
					{ status: 400 }
				);
			}

			// Verify post ownership
			const { data: existingPost, error: getErr } = await db.posts.get(id);
			if (getErr || !existingPost || existingPost.user_id !== user.id) {
				return json(
					{ success: false, error: 'Post not found or ownership mismatch' },
					{ status: 404 }
				);
			}

			// Only pending posts can move — publishing/published/failed history stays put.
			if (existingPost.status !== 'draft' && existingPost.status !== 'scheduled') {
				return json(
					{ success: false, error: `Cannot reschedule a ${existingPost.status} post` },
					{ status: 400 }
				);
			}

			const updateData: any = {};
			if (scheduled_date !== undefined) updateData.scheduled_date = scheduled_date;
			if (scheduled_time !== undefined) updateData.scheduled_time = scheduled_time;

			const { data, error } = await db.posts.update(id, updateData);
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'favorite') {
			const { id, value } = body;
			if (!id) return json({ success: false, error: 'Missing post id' }, { status: 400 });

			// Verify post ownership
			const { data: existingPost, error: getErr } = await db.posts.get(id);
			if (getErr || !existingPost || existingPost.user_id !== user.id) {
				return json(
					{ success: false, error: 'Post not found or ownership mismatch' },
					{ status: 404 }
				);
			}

			const { data, error } = await db.posts.update(id, { is_favorite: Boolean(value) });
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'delete') {
			const { id } = body;
			if (!id) return json({ success: false, error: 'Missing post id' }, { status: 400 });

			// Verify post ownership
			const { data: existingPost, error: getErr } = await db.posts.get(id);
			if (getErr || !existingPost || existingPost.user_id !== user.id) {
				return json(
					{ success: false, error: 'Post not found or ownership mismatch' },
					{ status: 404 }
				);
			}

			// Best-effort live teardown (Zernio unpublish where supported); never blocks the DB delete
			let teardown: TeardownResult = { unpublished: [], manualDeletion: [], errors: [] };
			try {
				teardown = await teardownPost(locals.supabase, existingPost);
			} catch (e) {
				console.error('[Posts API] Teardown failed (continuing with DB delete):', e);
			}

			const { error } = await db.posts.delete(id);
			if (error) throw error;
			return json({ success: true, teardown });
		}

		// Bulk delete for multi-select UIs. Each post is torn down on-platform
		// first (best effort), then the whole set is removed in one query scoped
		// to this user — a stray id from another account simply matches nothing.
		if (action === 'delete_many') {
			const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((v: unknown) => !!v) : [];
			if (ids.length === 0) {
				return json({ success: false, error: 'No post ids supplied' }, { status: 400 });
			}
			if (ids.length > 200) {
				return json(
					{ success: false, error: 'Too many posts (max 200 per request)' },
					{ status: 400 }
				);
			}

			const teardown: TeardownResult = { unpublished: [], manualDeletion: [], errors: [] };
			const owned: string[] = [];
			for (const id of ids) {
				const { data: post, error: getErr } = await db.posts.get(id);
				if (getErr || !post || post.user_id !== user.id) continue;
				owned.push(id);
				try {
					const r = await teardownPost(locals.supabase, post);
					teardown.unpublished.push(...r.unpublished);
					teardown.manualDeletion.push(...r.manualDeletion);
					teardown.errors.push(...r.errors);
				} catch (e) {
					console.error('[Posts API] Bulk teardown failed for', id, e);
				}
			}
			if (owned.length === 0) {
				return json({ success: false, error: 'No matching posts found' }, { status: 404 });
			}

			const { error } = await db.posts.deleteMany(owned, user.id);
			if (error) throw error;
			return json({ success: true, deleted: owned.length, requested: ids.length, teardown });
		}

		if (action === 'get') {
			const { id } = body;
			if (!id) return json({ success: false, error: 'Missing post id' }, { status: 400 });

			// Verify post ownership
			const { data: existingPost, error: getErr } = await db.posts.get(id);
			if (getErr || !existingPost || existingPost.user_id !== user.id) {
				return json(
					{ success: false, error: 'Post not found or ownership mismatch' },
					{ status: 404 }
				);
			}

			return json({ success: true, data: existingPost });
		}

		if (action === 'list') {
			const { agent_id } = body;
			if (agent_id) {
				const { data: agent, error: agentErr } = await db.agents.get(agent_id);
				if (agentErr || !agent || agent.user_id !== user.id) {
					return json(
						{ success: false, error: 'Agent not found or ownership mismatch' },
						{ status: 404 }
					);
				}
			}
			const { data, error } = await db.posts.list({ agent_id });
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'calendar') {
			const { month, year, persona_id } = body;
			if (!month || !year) {
				return json({ success: false, error: 'Missing month or year' }, { status: 400 });
			}

			if (persona_id) {
				const { data: agent, error: agentErr } = await db.agents.get(persona_id);
				if (agentErr || !agent || agent.user_id !== user.id) {
					return json(
						{ success: false, error: 'Agent not found or ownership mismatch' },
						{ status: 404 }
					);
				}
			}

			const { data, error } = await db.posts.list({
				agent_id: persona_id,
				month: parseInt(month),
				year: parseInt(year)
			});

			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'upcoming') {
			const { limit } = body;
			// Select posts where status is scheduled
			const { data, error } = await locals.supabase
				.from('posts')
				.select('*, agents(name, handle, gradient, initial)')
				.eq('user_id', user.id)
				.eq('status', 'scheduled')
				.order('scheduled_date')
				.order('scheduled_time')
				.limit(limit || 10);

			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'recent') {
			const { limit } = body;
			// Select posts where status is published
			const { data, error } = await locals.supabase
				.from('posts')
				.select('*, agents(name, handle, gradient, initial)')
				.eq('user_id', user.id)
				.eq('status', 'published')
				.order('published_at', { ascending: false })
				.limit(limit || 10);

			if (error) throw error;
			return json({ success: true, data });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Posts API] Error processing action:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
