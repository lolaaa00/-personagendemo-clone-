import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { checkAgentAccess } from '$lib/server/workspaces';

/**
 * Per-persona spend analytics from the generation_events ledger:
 *   GET /api/agent/[agentId]/spend
 *   -> { total, byProvider: { fal: n, openrouter: n, ... },
 *        byOperation: { image: n, video: n, llm: n, ... }, events }
 *
 * All figures are ESTIMATES from the pricing matrix, not provider invoices.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const agentId = params.agentId;
	if (!agentId) return json({ success: false, error: 'Missing agentId' }, { status: 400 });

	const db = createDbService(locals.supabase);
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent) {
		return json({ success: false, error: 'Persona not found' }, { status: 404 });
	}
	// Spend is sensitive — manager+ only (viewer/creator seats don't see the bill).
	const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'manager');
	if (!access.ok) {
		return json({ success: false, error: access.message }, { status: access.status });
	}

	const { data: events, error } = await locals.supabase
		.from('generation_events')
		.select('provider, operation, est_cost, created_at')
		.eq('agent_id', agentId)
		.order('created_at', { ascending: false })
		.limit(2000);
	if (error) return json({ success: false, error: error.message }, { status: 500 });

	const byProvider: Record<string, number> = {};
	const byOperation: Record<string, number> = {};
	let total = 0;
	for (const e of events || []) {
		const c = Number(e.est_cost) || 0;
		byProvider[e.provider] = +(((byProvider[e.provider] ?? 0) + c).toFixed(6));
		byOperation[e.operation] = +(((byOperation[e.operation] ?? 0) + c).toFixed(6));
		total = +((total + c).toFixed(6));
	}

	return json({
		success: true,
		total,
		byProvider,
		byOperation,
		events: (events || []).length,
		estimated: true
	});
};
