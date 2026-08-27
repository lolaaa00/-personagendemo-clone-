import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ROLES = new Set(['admin', 'manager', 'creator', 'viewer']);

/** List this workspace's seats. RLS scopes this to the owner and admin-tier seats (any other member only sees their own row via this same policy, which would return just themselves — fine, this endpoint is for the Team management page). */
export const GET: RequestHandler = async ({ locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const { data, error } = await locals.supabase
		.from('workspace_members')
		.select('workspace_id, user_id, role, invited_by, created_at, spend_limit_usd')
		.eq('workspace_id', params.id)
		.order('created_at');

	if (error) return json({ success: false, error: error.message }, { status: 500 });

	// workspace_members has no email column (only auth.users does, and that's
	// not client-readable) — the invite each member accepted is the one durable
	// record of "which email is this". Every member got here via exactly one
	// accepted invite, so this join is always resolvable.
	const members = data ?? [];
	if (members.length > 0) {
		const { data: invites } = await locals.supabase
			.from('workspace_invites')
			.select('accepted_by, email')
			.eq('workspace_id', params.id)
			.eq('status', 'accepted');
		const emailByUserId = new Map((invites ?? []).map((i: any) => [i.accepted_by, i.email]));
		for (const m of members as any[]) {
			m.email = emailByUserId.get(m.user_id) ?? null;
		}
	}

	return json({ success: true, members });
};

/** Change a seat's role and/or monthly spend cap. Owner or admin-tier seat (RLS). */
export const PATCH: RequestHandler = async ({ request, locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as {
		userId?: string;
		role?: string;
		spendLimitUsd?: number | null;
	};
	if (!body.userId) {
		return json({ success: false, error: 'Missing userId' }, { status: 400 });
	}

	const patch: Record<string, unknown> = {};
	if (body.role !== undefined) {
		if (!ROLES.has(body.role)) {
			return json({ success: false, error: 'Invalid role' }, { status: 400 });
		}
		patch.role = body.role;
	}
	// null clears the cap (back to unlimited); a number sets a calendar-month
	// USD ceiling enforced by assertWithinBudget() on every paid generation.
	if ('spendLimitUsd' in body) {
		if (body.spendLimitUsd === null) {
			patch.spend_limit_usd = null;
		} else {
			const cap = Number(body.spendLimitUsd);
			if (!Number.isFinite(cap) || cap < 0 || cap > 100000) {
				return json({ success: false, error: 'Spend limit must be a non-negative dollar amount' }, { status: 400 });
			}
			patch.spend_limit_usd = cap;
		}
	}
	if (Object.keys(patch).length === 0) {
		return json({ success: false, error: 'Nothing to update' }, { status: 400 });
	}

	const { data, error } = await locals.supabase
		.from('workspace_members')
		.update(patch)
		.eq('workspace_id', params.id)
		.eq('user_id', body.userId)
		.select()
		.maybeSingle();

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	if (!data) return json({ success: false, error: 'Member not found, or you lack permission to manage this workspace\'s seats' }, { status: 404 });
	return json({ success: true, member: data });
};

/** Remove a seat. Owner or an admin-tier seat removes anyone; a member can remove themselves (leave). */
export const DELETE: RequestHandler = async ({ request, locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { userId?: string };
	const targetUserId = body.userId || user.id;

	const { error, count } = await locals.supabase
		.from('workspace_members')
		.delete({ count: 'exact' })
		.eq('workspace_id', params.id)
		.eq('user_id', targetUserId);

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	if (!count) return json({ success: false, error: 'Member not found or you lack permission' }, { status: 404 });
	return json({ success: true });
};
