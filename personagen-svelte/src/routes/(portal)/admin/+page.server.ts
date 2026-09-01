import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getServiceSupabase } from '$lib/server/service-supabase';

/**
 * Admin Console — the operator's view of a workspace: who's in it, what they're
 * doing, and what it costs. Distinct from Settings → Team (which is the
 * "manage my seats" form); this is the read-heavy oversight surface.
 *
 * Access: workspace owners and admin-tier seats only. Everyone else is bounced
 * to the dashboard — the nav entry is already hidden for them, this is the
 * enforcement behind it.
 *
 * The activity log joins generation_events / post_reviews / posts against
 * auth.users for actor emails, which needs the service role (auth.users isn't
 * client-readable). Every query is scoped to the admin's own workspaces first,
 * so service-role use never widens what they can see beyond their workspace.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');

	// Which workspaces can this user administer?
	const [{ data: owned }, { data: memberships }] = await Promise.all([
		locals.supabase.from('workspaces').select('id, name, created_at').eq('owner_id', user.id),
		locals.supabase
			.from('workspace_members')
			.select('workspace_id, role, workspaces(id, name, created_at)')
			.eq('user_id', user.id)
	]);

	const adminWorkspaces = [
		...(owned ?? []).map((w: any) => ({ ...w, myRole: 'owner' as const })),
		...(memberships ?? [])
			.filter((m: any) => m.role === 'admin' && m.workspaces)
			.map((m: any) => ({ ...m.workspaces, myRole: 'admin' as const }))
	];

	if (adminWorkspaces.length === 0) {
		throw redirect(303, '/dashboard');
	}

	const wsIds = adminWorkspaces.map((w) => w.id);
	const svc = getServiceSupabase();

	// Seats across the administered workspaces, with emails resolved from the
	// accepted-invite record (workspace_members has no email column).
	const { data: seatRows } = await svc
		.from('workspace_members')
		.select('workspace_id, user_id, role, spend_limit_usd, created_at')
		.in('workspace_id', wsIds);
	const { data: inviteRows } = await svc
		.from('workspace_invites')
		.select('workspace_id, email, role, status, created_at, expires_at, accepted_by, accepted_at')
		.in('workspace_id', wsIds)
		.order('created_at', { ascending: false });

	const emailByUserId = new Map<string, string>();
	for (const i of inviteRows ?? []) {
		if (i.accepted_by && i.email) emailByUserId.set(i.accepted_by, i.email);
	}
	// Owners never have a membership row — resolve their email directly.
	const ownerIds = (owned ?? []).length > 0 ? [user.id] : [];
	for (const id of ownerIds) emailByUserId.set(id, user.email ?? '');

	const seats = (seatRows ?? []).map((s: any) => ({
		...s,
		email: emailByUserId.get(s.user_id) ?? null,
		workspaceName: adminWorkspaces.find((w) => w.id === s.workspace_id)?.name ?? '—'
	}));

	// Personas in these workspaces — the unit everything else attributes to.
	const { data: personaRows } = await svc
		.from('agents')
		.select('id, name, handle, status, workspace_id, user_id')
		.in('workspace_id', wsIds);
	const personas = personaRows ?? [];
	const personaIds = personas.map((p: any) => p.id);
	const personaById = new Map(personas.map((p: any) => [p.id, p]));

	// ── Activity + spend ────────────────────────────────────────────────────
	const monthStart = new Date();
	monthStart.setUTCDate(1);
	monthStart.setUTCHours(0, 0, 0, 0);

	let generations: any[] = [];
	let reviews: any[] = [];
	let recentPosts: any[] = [];
	if (personaIds.length > 0) {
		const [g, r, p] = await Promise.all([
			svc
				.from('generation_events')
				.select('id, user_id, agent_id, provider, operation, model, est_cost, created_at')
				.in('agent_id', personaIds)
				.order('created_at', { ascending: false })
				.limit(400),
			svc
				.from('post_reviews')
				.select('id, user_id, agent_id, post_id, decision, reason, created_at')
				.in('agent_id', personaIds)
				.order('created_at', { ascending: false })
				.limit(100),
			svc
				.from('posts')
				.select('id, user_id, agent_id, status, platforms, published_at, created_at')
				.in('agent_id', personaIds)
				.is('deleted_at', null)
				.order('created_at', { ascending: false })
				.limit(100)
		]);
		generations = g.data ?? [];
		reviews = r.data ?? [];
		recentPosts = p.data ?? [];
	}

	// Any actor id we haven't got an email for yet (e.g. the persona's own owner
	// generating in a workspace they don't hold a seat in).
	const unknownActors = new Set<string>();
	for (const row of [...generations, ...reviews, ...recentPosts]) {
		if (row.user_id && !emailByUserId.has(row.user_id)) unknownActors.add(row.user_id);
	}
	for (const id of unknownActors) {
		try {
			const { data } = await svc.auth.admin.getUserById(id);
			if (data?.user?.email) emailByUserId.set(id, data.user.email);
		} catch {
			/* leave unresolved — rendered as a short id */
		}
	}
	const actorLabel = (id: string | null) =>
		(id && emailByUserId.get(id)) || (id ? `${id.slice(0, 8)}…` : 'system');

	// Spend: this month, total and per seat / per persona.
	const monthMs = monthStart.getTime();
	let spendMonth = 0;
	const spendByActor: Record<string, number> = {};
	const spendByPersona: Record<string, number> = {};
	for (const g of generations) {
		const cost = Number(g.est_cost) || 0;
		if (new Date(g.created_at).getTime() >= monthMs) {
			spendMonth += cost;
			const a = actorLabel(g.user_id);
			spendByActor[a] = (spendByActor[a] ?? 0) + cost;
			const pname = personaById.get(g.agent_id)?.name ?? 'unknown';
			spendByPersona[pname] = (spendByPersona[pname] ?? 0) + cost;
		}
	}

	// Unified, newest-first activity feed across the three sources.
	const activity = [
		...generations.map((g: any) => ({
			kind: 'generation' as const,
			at: g.created_at,
			actor: actorLabel(g.user_id),
			persona: personaById.get(g.agent_id)?.name ?? '—',
			detail: `${g.operation} · ${g.model || g.provider}`,
			cost: Number(g.est_cost) || 0
		})),
		...reviews.map((r: any) => ({
			kind: 'review' as const,
			at: r.created_at,
			actor: actorLabel(r.user_id),
			persona: personaById.get(r.agent_id)?.name ?? '—',
			detail: `${r.decision}${r.reason ? ` — ${String(r.reason).slice(0, 80)}` : ''}`,
			cost: 0
		})),
		...recentPosts
			.filter((p: any) => p.status === 'published' && p.published_at)
			.map((p: any) => ({
				kind: 'publish' as const,
				at: p.published_at,
				actor: actorLabel(p.user_id),
				persona: personaById.get(p.agent_id)?.name ?? '—',
				detail: `published to ${(p.platforms ?? []).join(', ') || 'platform'}`,
				cost: 0
			}))
	]
		.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
		.slice(0, 150);

	// API keys issued by seats in these workspaces — machine access is part of
	// the security picture an admin needs to see.
	const seatUserIds = [...new Set([...(seatRows ?? []).map((s: any) => s.user_id), user.id])];
	const { data: keyRows } = await svc
		.from('api_keys')
		.select('id, user_id, label, key_prefix, last_used_at, revoked_at, created_at')
		.in('user_id', seatUserIds)
		.order('created_at', { ascending: false });

	return {
		workspaces: adminWorkspaces,
		seats,
		personas: personas.map((p: any) => ({
			id: p.id,
			name: p.name,
			handle: p.handle,
			status: p.status,
			workspaceName: adminWorkspaces.find((w) => w.id === p.workspace_id)?.name ?? '—'
		})),
		pendingInvites: (inviteRows ?? []).filter((i: any) => i.status === 'pending'),
		activity,
		stats: {
			spendMonth: Number(spendMonth.toFixed(4)),
			generationsMonth: generations.filter(
				(g: any) => new Date(g.created_at).getTime() >= monthMs
			).length,
			publishedTotal: recentPosts.filter((p: any) => p.status === 'published').length,
			seatCount: seats.length,
			personaCount: personas.length
		},
		spendByActor: Object.entries(spendByActor)
			.map(([actor, usd]) => ({ actor, usd: Number(usd.toFixed(4)) }))
			.sort((a, b) => b.usd - a.usd),
		spendByPersona: Object.entries(spendByPersona)
			.map(([persona, usd]) => ({ persona, usd: Number(usd.toFixed(4)) }))
			.sort((a, b) => b.usd - a.usd)
			.slice(0, 10),
		apiKeys: (keyRows ?? []).map((k: any) => ({
			...k,
			email: emailByUserId.get(k.user_id) ?? `${k.user_id.slice(0, 8)}…`
		}))
	};
};
