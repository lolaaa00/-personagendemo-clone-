import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Cross-persona review queue backend.
 *
 *   GET  /api/review                 -> all pending drafts across the user's
 *                                       personas, oldest slot first
 *   POST /api/review { action: 'approve'|'reject', post_ids: string[], reason? }
 *
 * Approve flips drafts to 'scheduled' (their slot stands; the scheduler
 * publishes when it's due). Reject flips to 'rejected'. Every decision is
 * appended to post_reviews with an optional reason + a content snapshot —
 * that log is the training data for the future automated QC agent.
 */

function snapshotOf(content: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(content);
		return {
			text: parsed?.text ?? null,
			media_url: parsed?.media_url ?? null,
			media_type: parsed?.media_type ?? null,
			hookScore: parsed?.hookScore ?? null
		};
	} catch {
		return { text: String(content).slice(0, 500) };
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const { data: drafts, error } = await locals.supabase
		.from('posts')
		.select('id, agent_id, content, platforms, status, scheduled_date, scheduled_time, created_at')
		.eq('user_id', user.id)
		.eq('status', 'draft')
		.order('scheduled_date', { ascending: true })
		.order('scheduled_time', { ascending: true });

	if (error) return json({ success: false, error: error.message }, { status: 500 });

	const agentIds = [...new Set((drafts || []).map((d: any) => d.agent_id))];
	const { data: agents } = agentIds.length
		? await locals.supabase.from('agents').select('id, name, niche, status').in('id', agentIds)
		: { data: [] as any[] };
	const { data: cfgs } = agentIds.length
		? await locals.supabase
				.from('agent_configs')
				.select('agent_id, ugc_character_ref')
				.in('agent_id', agentIds)
		: { data: [] as any[] };
	const agentById = new Map<string, any>((agents || []).map((a: any) => [a.id, a]));
	const refByAgent = new Map<string, any>(
		(cfgs || []).map((c: any) => [c.agent_id, c.ugc_character_ref])
	);

	const items = (drafts || []).map((d: any) => {
		let parsed: any = {};
		try {
			parsed = JSON.parse(d.content);
		} catch {
			parsed = { text: d.content };
		}
		const agent = agentById.get(d.agent_id);
		return {
			id: d.id,
			agent_id: d.agent_id,
			agent_name: agent?.name ?? 'Unknown',
			agent_avatar: refByAgent.get(d.agent_id) ?? null,
			text: parsed?.text ?? '',
			media_url: parsed?.media_url ?? null,
			poster_url: parsed?.poster_url ?? null,
			media_type: parsed?.media_type ?? 'image',
			quality_score: parsed?.qualityGrade?.overall ?? null,
			quality_issue: parsed?.qualityGrade?.topIssue ?? null,
			platforms: d.platforms ?? [],
			scheduled_date: d.scheduled_date,
			scheduled_time: d.scheduled_time,
			created_at: d.created_at
		};
	});

	return json({ success: true, items, total: items.length });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as any;
	const action = body.action;
	const postIds: string[] = Array.isArray(body.post_ids) ? body.post_ids.filter(Boolean) : [];
	const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

	if (!['approve', 'reject'].includes(action)) {
		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	}
	if (postIds.length === 0 || postIds.length > 200) {
		return json({ success: false, error: 'Provide 1-200 post_ids' }, { status: 400 });
	}

	// Ownership + draft-state check in one fetch; only rows that are still
	// drafts get flipped (a post approved elsewhere mid-flight is left alone).
	const { data: posts, error: fetchErr } = await locals.supabase
		.from('posts')
		.select('id, agent_id, content, status')
		.eq('user_id', user.id)
		.eq('status', 'draft')
		.in('id', postIds);
	if (fetchErr) return json({ success: false, error: fetchErr.message }, { status: 500 });

	const eligible = posts || [];
	if (eligible.length === 0) {
		return json({ success: false, error: 'No matching drafts (already reviewed?)' }, { status: 404 });
	}

	const newStatus = action === 'approve' ? 'scheduled' : 'rejected';
	const { error: updErr } = await locals.supabase
		.from('posts')
		.update({ status: newStatus })
		.eq('user_id', user.id)
		.eq('status', 'draft')
		.in(
			'id',
			eligible.map((p: any) => p.id)
		);
	if (updErr) return json({ success: false, error: updErr.message }, { status: 500 });

	// Append-only decision log. Non-fatal: a logging hiccup must not undo review.
	const { error: logErr } = await locals.supabase.from('post_reviews').insert(
		eligible.map((p: any) => ({
			user_id: user.id,
			post_id: p.id,
			agent_id: p.agent_id,
			decision: action,
			reason,
			content_snapshot: snapshotOf(p.content)
		}))
	);
	if (logErr) console.warn('[Review] Failed to log decisions (post_reviews):', logErr.message);

	return json({ success: true, updated: eligible.length, status: newStatus });
};
