import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { activityStats, logActivity } from '$lib/server/activity';

/**
 * Platform-admin activity API — the read side of the activity log.
 *
 *   GET /api/admin/activity                 presence + per-user last login / last seen / online
 *   GET /api/admin/activity?live=1          last 100 events platform-wide (emails resolved)
 *   GET /api/admin/activity?userId=…        one user's timeline (last 300) + GoTrue auth trail
 *   GET /api/admin/activity?errors=1        last 100 non-ok events
 *
 * Rows never hold emails; they are resolved here through the service role,
 * only for platform admins, and only for the ids actually on screen.
 * Viewing a user's timeline is itself logged (admin.user.viewed).
 */

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

async function emailMap(svc: any, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
	const want = [...new Set([...ids].filter(Boolean) as string[])];
	const map = new Map<string, string>();
	if (want.length === 0) return map;
	// One list call covers everyone at today's scale; fall back per-id if paging grows.
	const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
	for (const u of data?.users ?? []) if (u.email) map.set(u.id, u.email);
	for (const id of want) {
		if (map.has(id)) continue;
		try {
			const { data: one } = await svc.auth.admin.getUserById(id);
			if (one?.user?.email) map.set(id, one.user.email);
		} catch {
			/* unresolved → short id at render */
		}
	}
	return map;
}

const label = (map: Map<string, string>, id: string | null) => (id && map.get(id)) || (id ? `${id.slice(0, 8)}…` : 'system');

function tableMissing(err: any): boolean {
	return /does not exist|schema cache|PGRST205|PGRST202/i.test(err?.message ?? '');
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });
	const svc = getServiceSupabase();
	const userId = url.searchParams.get('userId');

	// ── one user's timeline ──────────────────────────────────────────────────
	if (userId) {
		const [{ data: events, error }, authRes] = await Promise.all([
			svc
				.from('user_activity_events')
				.select('id, occurred_at, actor_kind, target_user_id, agent_id, post_id, category, action, route_id, method, outcome, status_code, error_code, duration_ms, generation_event_id, est_cost_usd, credits_delta, request_id, country, ua_family, device, meta')
				.eq('user_id', userId)
				.order('occurred_at', { ascending: false })
				.order('id', { ascending: false })
				.limit(300),
			svc.rpc('admin_auth_events', { p_user: userId, p_limit: 100 })
		]);
		if (error && !tableMissing(error)) return json({ success: false, error: error.message }, { status: 500 });
		const { data: presence } = await svc.from('user_presence').select('*').eq('user_id', userId).maybeSingle();
		logActivity(locals, gate.user.id, { action: 'admin.user.viewed', actorKind: 'admin', targetUserId: userId });
		const agentIds = new Set((events ?? []).map((e: any) => e.agent_id).filter(Boolean));
		const { data: agents } = agentIds.size
			? await svc.from('agents').select('id, name').in('id', [...agentIds])
			: { data: [] as any[] };
		const agentName = new Map((agents ?? []).map((a: any) => [a.id, a.name]));
		return json({
			success: true,
			events: (events ?? []).map((e: any) => ({ ...e, persona: e.agent_id ? (agentName.get(e.agent_id) ?? '—') : null })),
			authEvents: authRes.error ? [] : (authRes.data ?? []),
			presence: presence ?? null,
			online: presence ? Date.now() - new Date(presence.last_seen_at).getTime() < ONLINE_WINDOW_MS : false
		});
	}

	// ── live tail / errors ───────────────────────────────────────────────────
	if (url.searchParams.get('live') || url.searchParams.get('errors')) {
		let q = svc
			.from('user_activity_events')
			.select('id, occurred_at, user_id, actor_kind, target_user_id, agent_id, category, action, route_id, outcome, status_code, error_code, duration_ms, credits_delta, est_cost_usd, device, country, meta')
			.order('occurred_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(100);
		if (url.searchParams.get('errors')) q = q.neq('outcome', 'ok');
		const { data: events, error } = await q;
		if (error && !tableMissing(error)) return json({ success: false, error: error.message }, { status: 500 });
		const emails = await emailMap(svc, (events ?? []).flatMap((e: any) => [e.user_id, e.target_user_id]));
		return json({
			success: true,
			stats: activityStats(),
			events: (events ?? []).map((e: any) => ({
				...e,
				actor: label(emails, e.user_id),
				target: e.target_user_id ? label(emails, e.target_user_id) : null
			}))
		});
	}

	// ── overview: presence + last login/seen per user ────────────────────────
	const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
	const [{ data: presence, error: pErr }, { data: logins, error: lErr }] = await Promise.all([
		svc.from('user_presence').select('*'),
		svc
			.from('user_activity_events')
			.select('user_id, occurred_at, action, device, country')
			.in('action', ['auth.login.success', 'auth.oauth.callback', 'auth.signup'])
			.gte('occurred_at', since)
			.order('occurred_at', { ascending: false })
			.limit(5000)
	]);
	if ((pErr && !tableMissing(pErr)) || (lErr && !tableMissing(lErr))) {
		return json({ success: false, error: (pErr ?? lErr)!.message }, { status: 500 });
	}
	const byUser: Record<string, { last_login_at: string | null; login_count: number; last_device: string | null; last_country: string | null }> = {};
	for (const r of logins ?? []) {
		if (!r.user_id) continue;
		const u = (byUser[r.user_id] ||= { last_login_at: null, login_count: 0, last_device: null, last_country: null });
		u.login_count++;
		if (!u.last_login_at) {
			u.last_login_at = r.occurred_at;
			u.last_device = r.device;
			u.last_country = r.country;
		}
	}
	const now = Date.now();
	const presenceByUser: Record<string, any> = {};
	for (const p of presence ?? []) {
		presenceByUser[p.user_id] = { ...p, online: now - new Date(p.last_seen_at).getTime() < ONLINE_WINDOW_MS };
	}
	return json({ success: true, stats: activityStats(), logins: byUser, presence: presenceByUser });
};
