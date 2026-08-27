import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateInviteToken } from '$lib/server/workspaces';

const ROLES = new Set(['admin', 'manager', 'creator', 'viewer']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** List pending invites for this workspace. Owner or admin-tier seat (RLS). */
export const GET: RequestHandler = async ({ locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const { data, error } = await locals.supabase
		.from('workspace_invites')
		.select('id, email, role, status, created_at, expires_at, accepted_at')
		.eq('workspace_id', params.id)
		.order('created_at', { ascending: false });

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true, invites: data ?? [] });
};

/**
 * Invite a teammate by email. Owner or admin-tier seat (RLS insert policy).
 * Re-inviting an address with a still-pending invite replaces it (revoke +
 * recreate) rather than erroring — the unique partial index only blocks two
 * simultaneous pending invites, it doesn't need the caller to know that.
 */
export const POST: RequestHandler = async ({ request, locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { email?: string; role?: string };
	const email = (body.email || '').trim().toLowerCase();
	if (!email || !EMAIL_RE.test(email)) {
		return json({ success: false, error: 'Enter a valid email address' }, { status: 400 });
	}
	if (!body.role || !ROLES.has(body.role)) {
		return json({ success: false, error: 'Role must be admin, manager, creator, or viewer' }, { status: 400 });
	}

	// Revoke any still-pending invite to this address first (see doc comment).
	await locals.supabase
		.from('workspace_invites')
		.update({ status: 'revoked' })
		.eq('workspace_id', params.id)
		.eq('status', 'pending')
		.ilike('email', email);

	const { data, error } = await locals.supabase
		.from('workspace_invites')
		.insert({
			workspace_id: params.id,
			email,
			role: body.role,
			token: generateInviteToken(),
			invited_by: user.id
		})
		.select()
		.single();

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({
		success: true,
		invite: data,
		// The client renders this into a copyable link — WhatsApp/email send is
		// manual (there is no mailer wired up), matching how this rollout
		// actually gets used.
		acceptUrl: `/invite/${data.token}`
	});
};

/** Revoke a pending invite. Owner or admin-tier seat (RLS). */
export const DELETE: RequestHandler = async ({ request, locals, params }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { inviteId?: string };
	if (!body.inviteId) {
		return json({ success: false, error: 'Missing inviteId' }, { status: 400 });
	}

	const { error, count } = await locals.supabase
		.from('workspace_invites')
		.update({ status: 'revoked' }, { count: 'exact' })
		.eq('id', body.inviteId)
		.eq('workspace_id', params.id);

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	if (!count) return json({ success: false, error: 'Invite not found or you lack permission' }, { status: 404 });
	return json({ success: true });
};
