import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';

/**
 * Per-agent analytics for the persona Analytics tab.
 * POST { agent_id } -> totals, per-platform breakdown, and a time series for charts.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as any;
	const agentId = body.agent_id || body.agentId;
	if (!agentId) return json({ success: false, error: 'Missing agent_id' }, { status: 400 });

	const db = createDbService(locals.supabase);
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent || agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Agent not found or ownership mismatch' },
			{ status: 404 }
		);
	}

	const { data: posts, error } = await locals.supabase
		.from('posts')
		.select(
			'id, status, platforms, analytics, publication_results, published_at, content, scheduled_date'
		)
		.eq('agent_id', agentId)
		.eq('status', 'published')
		.order('published_at', { ascending: false });
	if (error) return json({ success: false, error: error.message }, { status: 500 });

	const totals = { views: 0, likes: 0, comments: 0, shares: 0, posts: 0 };
	const byPlatform: Record<string, { posts: number; views: number; likes: number }> = {};
	const series: Array<{ id: string; published_at: string | null; views: number; likes: number }> =
		[];

	for (const p of posts || []) {
		const a = (p.analytics || {}) as any;
		const views = Number(a.views) || 0;
		const likes = Number(a.likes) || 0;
		totals.views += views;
		totals.likes += likes;
		totals.comments += Number(a.comments) || 0;
		totals.shares += Number(a.shares) || 0;
		totals.posts += 1;

		for (const plat of p.platforms || []) {
			const key = String(plat).toLowerCase();
			byPlatform[key] ??= { posts: 0, views: 0, likes: 0 };
			byPlatform[key].posts += 1;
			byPlatform[key].views += views;
			byPlatform[key].likes += likes;
		}
		series.push({ id: p.id, published_at: p.published_at, views, likes });
	}

	const engagementRate =
		totals.views > 0
			? Number((((totals.likes + totals.comments + totals.shares) / totals.views) * 100).toFixed(2))
			: 0;

	return json({
		success: true,
		data: { totals, engagementRate, byPlatform, series: series.slice(0, 60) }
	});
};
