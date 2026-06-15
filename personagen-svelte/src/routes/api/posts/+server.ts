import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';

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

			// Format platforms as PostgreSQL array
			const platforms = Array.isArray(post.platforms)
				? post.platforms.map((p: string) => p.toLowerCase())
				: [];

			const { data, error } = await db.posts.create({
				user_id: user.id,
				agent_id: post.agent_id || post.agentId,
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

		if (action === 'delete') {
			const { id } = body;
			if (!id) return json({ success: false, error: 'Missing post id' }, { status: 400 });

			const { error } = await db.posts.delete(id);
			if (error) throw error;
			return json({ success: true });
		}

		if (action === 'get') {
			const { id } = body;
			if (!id) return json({ success: false, error: 'Missing post id' }, { status: 400 });

			const { data, error } = await db.posts.get(id);
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'list') {
			const { agent_id } = body;
			const { data, error } = await db.posts.list({ agent_id });
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'calendar') {
			const { month, year, persona_id } = body;
			if (!month || !year) {
				return json({ success: false, error: 'Missing month or year' }, { status: 400 });
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
