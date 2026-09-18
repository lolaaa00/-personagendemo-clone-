import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPostDisplay } from '$lib/components/feed/postDisplay';
import { checkAgentAccess, getAgentRole, type AgentRole } from '$lib/server/workspaces';

/**
 * Cross-persona review queue backend.
 *
 *   GET  /api/review                 -> all pending drafts across the user's
 *                                       personas, oldest slot first
 *   POST /api/review { action: 'approve'|'reject'|'restore', post_ids: string[], reason? }
 *
 * Approve flips drafts to 'scheduled' (their slot stands; the scheduler
 * publishes when it's due). Reject flips to 'rejected'. Every decision is
 * appended to post_reviews with an optional reason + a content snapshot —
 * that log is the training data for the future automated QC agent.
 *
 * Restore returns a rejected post to 'draft'. Before it existed, Reject was the
 * only action on the page with no way back: a mis-click could be undone only by
 * deleting the post and regenerating it, which costs real money. It deliberately
 * writes NO post_reviews row — the rejection genuinely happened and stays in the
 * training log; restoring is a status change, not a verdict, and recording it as
 * one would put an approval in the log that no reviewer ever gave. (It could not
 * be logged honestly in any case: `decision` is CHECK-constrained to
 * approve/reject, and widening that is a migration this does not need.)
 */

function snapshotOf(content: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(content);
		return {
			text: parsed?.text ?? null,
			media_url: parsed?.media_url ?? null,
			media_type: parsed?.media_type ?? null,
			hookScore: parsed?.hookScore ?? null,
			// Type dimensions for the QC training log — without these a rejected
			// $1.95 cinematic and a rejected $0.08 quote card are indistinguishable.
			format: parsed?.format ?? null,
			cinematic: parsed?.cinematic === true,
			still_style: parsed?.generation?.still_style ?? null,
			studio_template: parsed?.studio?.template ?? null,
			cost_total: parsed?.costBreakdown?.total ?? null
		};
	} catch {
		return { text: String(content).slice(0, 500) };
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	// Pending content across EVERY persona: drafts awaiting approval AND scheduled
	// posts not yet published. The old draft-only filter hid content generated on a
	// CONNECTED persona (which auto-schedules, skipping the draft state) — so "I
	// generated content but it's not in review" was the auto-scheduled posts. Both
	// are now surfaced (distinguished by status), and the client filters by
	// agent / platform / status.
	// Every persona this seat can see, not only the ones this account owns.
	// RLS (posts_select_own) already scopes the query to owned rows plus the
	// workspace personas the caller holds any seat on. An extra
	// `.eq('user_id', user.id)` used to narrow that to owned-only, which hid the
	// whole workspace from every member seat: a manager opened an empty queue —
	// "Queue is clear" — over nine drafts waiting for exactly their approval.
	const { data: drafts, error } = await locals.supabase
		.from('posts')
		.select('id, agent_id, content, platforms, status, scheduled_date, scheduled_time, created_at')
		.is('deleted_at', null)
		// 'rejected' is included so a rejection is auditable. It used to be
		// excluded here, which meant a rejected post left the queue and could not
		// be reached from any filter, tab or link on the page — indistinguishable
		// from a delete, on an action with no undo, while the page's own subtitle
		// promises the reason "trains the future QC reviewer". The client defaults
		// to Draft + Scheduled, so the queue still opens on work that needs doing.
		.in('status', ['draft', 'scheduled', 'rejected'])
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
	// The reason a post was rejected, so the row can show it rather than just
	// vanishing. Latest decision per post.
	const postIds = (drafts || []).map((d: any) => d.id);
	const { data: reviewRows } = postIds.length
		? await locals.supabase
				.from('post_reviews')
				.select('post_id, decision, reason, created_at')
				.in('post_id', postIds)
				.order('created_at', { ascending: false })
		: { data: [] as any[] };
	const reasonByPost = new Map<string, string>();
	for (const r of reviewRows || []) {
		if (r.decision === 'reject' && r.reason && !reasonByPost.has(r.post_id)) {
			reasonByPost.set(r.post_id, r.reason);
		}
	}

	// The seat's role on each persona, so the page can offer only the decisions
	// this seat may make. One RPC per distinct persona (agent_access_role is
	// the function RLS itself enforces with); a row that is visible but whose
	// role cannot be resolved is treated as viewer — never over-granted.
	const roleByAgent = new Map<string, AgentRole>(
		await Promise.all(
			agentIds.map(
				async (id) => [id, (await getAgentRole(locals.supabase, user.id, id)) ?? 'viewer'] as const
			)
		)
	);
	const agentById = new Map<string, any>((agents || []).map((a: any) => [a.id, a]));
	const refByAgent = new Map<string, any>(
		(cfgs || []).map((c: any) => [c.agent_id, c.ugc_character_ref])
	);

	const items = (drafts || []).flatMap((d: any) => {
		let parsed: any = {};
		try {
			parsed = JSON.parse(d.content);
		} catch {
			parsed = { text: d.content };
		}
		// Standalone Studio assets are drafts by storage but not by intent — they
		// were generated as media, not as posts awaiting approval. Keep them out
		// of the queue; they live in the persona's Assets lens instead.
		if (parsed?.studio?.standalone === true) return [];
		const agent = agentById.get(d.agent_id);
		// ONE classifier for the whole app: the same getPostDisplay the library and
		// feed use, so a post never reads as "video" here and "Cinematic" there —
		// hand-rolled parsing was how the two vocabularies drifted apart.
		const display = getPostDisplay(d);
		return [{
			id: d.id,
			agent_id: d.agent_id,
			agent_name: agent?.name ?? 'Unknown',
			role: roleByAgent.get(d.agent_id) ?? 'viewer',
			agent_avatar: refByAgent.get(d.agent_id) ?? null,
			status: d.status,
			text: display.text,
			media_url: display.mediaUrl,
			poster_url: display.posterUrl,
			media_type: display.mediaType,
			surface: display.surface,
			template_title: display.templateTitle,
			reject_reason: reasonByPost.get(d.id) ?? null,
			quality_score: parsed?.qualityGrade?.overall ?? null,
			quality_issue: parsed?.qualityGrade?.topIssue ?? null,
			platforms: d.platforms ?? [],
			scheduled_date: d.scheduled_date,
			scheduled_time: d.scheduled_time,
			created_at: d.created_at
		}];
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

	if (!['approve', 'reject', 'restore'].includes(action)) {
		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	}
	if (postIds.length === 0 || postIds.length > 200) {
		return json({ success: false, error: 'Provide 1-200 post_ids' }, { status: 400 });
	}

	// Approve only promotes DRAFTS (→ scheduled). Reject/unschedule can also pull back
	// an already-SCHEDULED post (→ rejected) so the queue can catch content before it
	// publishes. Visibility (RLS) + eligible-status checked in one fetch; the
	// seat's right to decide is checked per persona below.
	const reviewable =
		action === 'approve' ? ['draft'] : action === 'restore' ? ['rejected'] : ['draft', 'scheduled'];
	const { data: posts, error: fetchErr } = await locals.supabase
		.from('posts')
		.select('id, agent_id, content, status')
		.is('deleted_at', null)
		.in('status', reviewable)
		.in('id', postIds);
	if (fetchErr) return json({ success: false, error: fetchErr.message }, { status: 500 });

	const eligible = posts || [];
	if (eligible.length === 0) {
		return json(
			{
				success: false,
				error:
					action === 'restore'
						? 'No matching rejected posts (already restored?)'
						: 'No matching drafts (already reviewed?)'
			},
			{ status: 404 }
		);
	}

	// Approve, reject and restore are a manager's decisions (seat.ts: canPublish),
	// checked once per persona in the batch. The whole batch is refused if any
	// post is out of reach: "3 of 5 approved" would be a decision the caller
	// never made, and the page only offers the batch when every row allows it.
	// This used to be an owner filter on the UPDATE, which answered a manager's
	// decision with 404 "already reviewed?" — the wrong verdict, in the wrong words.
	for (const agentId of [...new Set(eligible.map((p: any) => p.agent_id as string))]) {
		const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'manager');
		if (!access.ok) return json({ success: false, error: access.message }, { status: access.status });
	}

	const newStatus =
		action === 'approve' ? 'scheduled' : action === 'restore' ? 'draft' : 'rejected';
	const { error: updErr } = await locals.supabase
		.from('posts')
		.update({ status: newStatus })
		.is('deleted_at', null)
		.in('status', reviewable)
		.in(
			'id',
			eligible.map((p: any) => p.id)
		);
	if (updErr) return json({ success: false, error: updErr.message }, { status: 500 });

	// Append-only decision log. Non-fatal: a logging hiccup must not undo review.
	// Restore is excluded on purpose — see the header note.
	if (action === 'restore') {
		return json({ success: true, updated: eligible.length, status: newStatus });
	}
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
