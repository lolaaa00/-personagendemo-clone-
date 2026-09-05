import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { creditsMode } from '$lib/server/flags';
import { logActivity } from '$lib/server/activity';

/**
 * Platform-admin credits API.
 *
 *   GET  /api/admin/credits                → every account: identity, sign-in, wallet, month spend
 *   GET  /api/admin/credits?userId=…       → one wallet + its last 200 ledger rows
 *   POST /api/admin/credits                { userId, op: 'grant'|'set'|'adjust'|'mode', credits?, mode?, note }
 *
 * Every mutation goes through credit_apply()/credit_set_mode() with the admin
 * as actor, so grants are auditable and reversible (an 'adjustment' with a
 * note undoes a mistake; nothing is ever edited or deleted).
 *
 * Emails are resolved here, at render time, through the service role — the
 * wallet and ledger tables never hold them.
 */

const MAX_CREDITS = 10_000_000; // $100k of estimate — a fat-finger guard, not a business limit

export const GET: RequestHandler = async ({ url, locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	const svc = getServiceSupabase();
	const userId = url.searchParams.get('userId');

	if (userId) {
		const [{ data: account }, { data: ledger, error }] = await Promise.all([
			svc.from('credit_accounts').select('*').eq('user_id', userId).maybeSingle(),
			svc
				.from('credit_ledger')
				.select('id, seq, delta, kind, balance_after, waived_credits, generation_event_id, post_id, agent_id, stripe_event_id, actor_user_id, note, created_at')
				.eq('user_id', userId)
				// seq is the strict total order; created_at is a transaction timestamp
				// shared by every row written in one transaction.
				.order('seq', { ascending: false })
				.limit(200)
		]);
		if (error) return json({ success: false, error: error.message }, { status: 500 });
		return json({
			success: true,
			mode: creditsMode(),
			account: account ?? { user_id: userId, balance_credits: 0, billing_mode: 'credits', missing: true },
			ledger: ledger ?? []
		});
	}

	// Whole platform. auth.admin.listUsers pages at 1000; fine for a long while.
	const monthStart = new Date();
	monthStart.setUTCDate(1);
	monthStart.setUTCHours(0, 0, 0, 0);
	const [usersRes, { data: accounts }, { data: debits }, { data: spend }] = await Promise.all([
		svc.auth.admin.listUsers({ perPage: 1000 }),
		svc.from('credit_accounts').select('user_id, balance_credits, billing_mode, updated_at'),
		svc
			.from('credit_ledger')
			.select('user_id, delta, waived_credits, kind, created_at')
			.gte('created_at', monthStart.toISOString())
			.limit(100000),
		svc
			.from('generation_events')
			.select('billed_user_id, user_id, est_cost, credits, key_source, created_at')
			.gte('created_at', monthStart.toISOString())
			.limit(100000)
	]);
	if (usersRes.error) return json({ success: false, error: usersRes.error.message }, { status: 500 });

	const acct = new Map((accounts ?? []).map((a: any) => [a.user_id, a]));
	const monthDebit: Record<string, number> = {};
	const monthWaived: Record<string, number> = {};
	for (const r of debits ?? []) {
		if (!r.user_id) continue;
		if (r.kind === 'debit') monthDebit[r.user_id] = (monthDebit[r.user_id] ?? 0) + Math.max(0, -Number(r.delta || 0));
		monthWaived[r.user_id] = (monthWaived[r.user_id] ?? 0) + Number(r.waived_credits || 0);
	}
	const monthUsd: Record<string, number> = {};
	const monthEvents: Record<string, number> = {};
	for (const g of spend ?? []) {
		const k = g.billed_user_id || g.user_id;
		if (!k) continue;
		monthUsd[k] = (monthUsd[k] ?? 0) + (Number(g.est_cost) || 0);
		monthEvents[k] = (monthEvents[k] ?? 0) + 1;
	}

	const users = (usersRes.data?.users ?? []).map((u: any) => {
		const a = acct.get(u.id);
		return {
			id: u.id,
			email: u.email ?? null,
			created_at: u.created_at,
			last_sign_in_at: u.last_sign_in_at ?? null,
			never_signed_in: !u.last_sign_in_at,
			balance_credits: Number(a?.balance_credits ?? 0),
			billing_mode: a?.billing_mode ?? 'credits',
			has_wallet: Boolean(a),
			month_debited_credits: monthDebit[u.id] ?? 0,
			month_waived_credits: monthWaived[u.id] ?? 0,
			month_est_usd: +(monthUsd[u.id] ?? 0).toFixed(4),
			month_events: monthEvents[u.id] ?? 0
		};
	});
	users.sort((x: any, y: any) => (y.last_sign_in_at ?? '').localeCompare(x.last_sign_in_at ?? ''));

	return json({ success: true, mode: creditsMode(), users });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}
	const { userId, op } = body ?? {};
	const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
	if (!userId || typeof userId !== 'string') return json({ success: false, error: 'Missing userId' }, { status: 400 });
	if (!['grant', 'set', 'adjust', 'mode'].includes(op)) {
		return json({ success: false, error: "op must be one of grant | set | adjust | mode" }, { status: 400 });
	}
	if (!note) return json({ success: false, error: 'A note is required (it is the audit trail)' }, { status: 400 });

	const svc = getServiceSupabase();

	if (op === 'mode') {
		const mode = body.mode;
		if (mode !== 'credits' && mode !== 'unmetered') {
			return json({ success: false, error: 'mode must be credits | unmetered' }, { status: 400 });
		}
		const { data, error } = await svc.rpc('credit_set_mode', { p_user: userId, p_mode: mode });
		if (error) return json({ success: false, error: error.message }, { status: 500 });
		// Mode changes are worth a ledger line too (delta 0) so the timeline shows them.
		await svc.rpc('credit_apply', {
			p_user: userId,
			p_delta: 0,
			p_kind: 'adjustment',
			p_note: `[mode → ${mode}] ${note}`,
			p_actor: gate.user.id
		});
		logActivity(locals, gate.user.id, {
			action: 'admin.mode.changed',
			actorKind: 'admin',
			targetUserId: userId,
			meta: { mode, note }
		});
		return json({ success: true, mode: data });
	}

	const credits = Number(body.credits);
	if (!Number.isFinite(credits) || Math.abs(credits) > MAX_CREDITS || !Number.isInteger(credits)) {
		return json({ success: false, error: `credits must be an integer within ±${MAX_CREDITS}` }, { status: 400 });
	}
	if (op === 'grant' && credits <= 0) return json({ success: false, error: 'grant must be positive' }, { status: 400 });
	if (op === 'set' && credits < 0) return json({ success: false, error: 'set cannot target a negative balance' }, { status: 400 });

	const kind = op === 'grant' ? 'grant' : op === 'set' ? 'set' : 'adjustment';
	const { data: balance, error } = await svc.rpc('credit_apply', {
		p_user: userId,
		p_delta: credits,
		p_kind: kind,
		p_note: note,
		p_actor: gate.user.id,
		// An adjustment may legitimately take a balance below zero (reversing a
		// mistaken grant that was already partly spent).
		p_allow_negative: op === 'adjust'
	});
	if (error) {
		const status = /INSUFFICIENT_CREDITS/.test(error.message) ? 409 : 500;
		logActivity(locals, gate.user.id, {
			action: op === 'grant' ? 'admin.credits.granted' : op === 'set' ? 'admin.credits.set' : 'admin.credits.adjusted',
			actorKind: 'admin',
			targetUserId: userId,
			outcome: 'error',
			errorCode: status === 409 ? 'INSUFFICIENT_CREDITS' : 'DB_ERROR',
			creditsDelta: credits,
			meta: { note }
		});
		return json({ success: false, error: error.message }, { status });
	}
	logActivity(locals, gate.user.id, {
		action: op === 'grant' ? 'admin.credits.granted' : op === 'set' ? 'admin.credits.set' : 'admin.credits.adjusted',
		actorKind: 'admin',
		targetUserId: userId,
		creditsDelta: op === 'set' ? null : credits,
		meta: { note, target_balance: op === 'set' ? credits : undefined, balance_after: Number(balance) }
	});
	return json({ success: true, balance_credits: Number(balance) });
};
