import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

/**
 * Seat roles inside a brand workspace, ranked low to high. 'owner' is never
 * a workspace_members row — it's implicit (workspaces.owner_id, or a
 * persona's own agents.user_id) — but is returned by agent_access_role() so
 * callers here have one flat scale to compare against.
 *
 * 'admin' sits between manager and owner: everything manager can do on a
 * persona (approve/publish, connections, delete posts, spend, identity
 * fields), PLUS managing the workspace's OTHER seats (invite/re-role/remove)
 * — see workspace_admin_role_migration.sql. Renaming/deleting the workspace
 * itself, and deleting a persona outright, stay owner-only regardless.
 *
 * This rank must mirror public.role_rank() in
 * supabase/workspace_admin_role_migration.sql exactly — the DB is the actual
 * enforcement, this is only for the app's own pre-checks and error messages.
 */
export type AgentRole = 'owner' | 'admin' | 'manager' | 'creator' | 'viewer';

const ROLE_RANK: Record<AgentRole, number> = { viewer: 0, creator: 1, manager: 2, admin: 3, owner: 4 };

export function roleAtLeast(role: AgentRole | null, min: AgentRole): boolean {
	return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * The single question every workspace-aware route asks: what can this user
 * do with this persona? Backed by the SQL function of the same name
 * (workspaces_migration.sql) via RPC, so the app and the RLS policies that
 * actually enforce access can never drift apart — this call tells you what
 * the database will and won't allow, it doesn't decide it independently.
 */
export async function getAgentRole(
	supabase: SupabaseClient,
	userId: string,
	agentId: string
): Promise<AgentRole | null> {
	const { data, error: rpcErr } = await supabase.rpc('agent_access_role', {
		p_agent_id: agentId,
		p_user_id: userId
	});
	if (rpcErr) {
		console.error('[Workspaces] agent_access_role RPC failed:', rpcErr);
		return null;
	}
	return (data as AgentRole | null) ?? null;
}

export type AccessResult =
	| { ok: true; role: AgentRole }
	| { ok: false; status: 404 | 403; message: string };

/**
 * Non-throwing access check matching this codebase's `json({success:false,
 * error}, {status})` route convention (rather than SvelteKit's `error()`
 * helper, which most of these handlers don't use). 404 when the caller has
 * NO access at all (never reveals whether the persona exists to someone who
 * can't see it) — 403 when they have access below `minRole`.
 */
export async function checkAgentAccess(
	supabase: SupabaseClient,
	userId: string,
	agentId: string,
	minRole: AgentRole
): Promise<AccessResult> {
	const role = await getAgentRole(supabase, userId, agentId);
	if (!role) return { ok: false, status: 404, message: 'Persona not found or ownership mismatch' };
	if (!roleAtLeast(role, minRole)) {
		return {
			ok: false,
			status: 403,
			message: `This action requires ${minRole}+ access to this persona (you have ${role}).`
		};
	}
	return { ok: true, role };
}

/** Same check, starting from a post id — resolves access via the post's agent_id. */
export async function checkPostAccess(
	supabase: SupabaseClient,
	userId: string,
	postId: string,
	minRole: AgentRole,
	/**
	 * Trashed posts are invisible by default, so every existing caller (update,
	 * publish, delete…) 404s on one without needing to know Trash exists. Only
	 * restore and purge opt in — they are the two actions whose whole job is to
	 * operate on a trashed row.
	 */
	opts: { includeTrashed?: boolean } = {}
): Promise<AccessResult & { post?: any }> {
	let q = supabase.from('posts').select('*').eq('id', postId);
	if (!opts.includeTrashed) q = q.is('deleted_at', null);
	const { data: post, error: getErr } = await q.maybeSingle();
	if (getErr || !post) {
		return { ok: false, status: 404, message: 'Post not found or ownership mismatch' };
	}
	const access = await checkAgentAccess(supabase, userId, post.agent_id, minRole);
	if (!access.ok) return access;
	return { ...access, post };
}

/** A post status change a 'creator' seat is not allowed to make (see the DB trigger of the same intent). */
const PUBLISH_ADJACENT_STATUSES = new Set(['scheduled', 'publishing', 'published', 'partial']);

/**
 * App-layer mirror of the enforce_post_status_scope() trigger: lets the API
 * return a clear 403 ("requires manager access") instead of surfacing a raw
 * Postgres RLS/trigger exception. The trigger is the actual enforcement —
 * this only makes the failure legible.
 */
export function creatorMayNotSetStatus(role: AgentRole, nextStatus: string | undefined): boolean {
	return role === 'creator' && !!nextStatus && PUBLISH_ADJACENT_STATUSES.has(nextStatus);
}

// ─────────────────────────────────────────────────────────────────────────
// Invites
// ─────────────────────────────────────────────────────────────────────────

export interface WorkspaceInvite {
	id: string;
	workspace_id: string;
	email: string;
	role: 'manager' | 'creator' | 'viewer';
	token: string;
	invited_by: string | null;
	status: 'pending' | 'accepted' | 'revoked';
	created_at: string;
	expires_at: string;
	accepted_by: string | null;
	accepted_at: string | null;
}

/** URL-safe, unguessable invite token. Not a JWT — it's a lookup key into workspace_invites, nothing is encoded in it. */
export function generateInviteToken(): string {
	return randomBytes(24).toString('base64url');
}

export function isInviteExpired(invite: Pick<WorkspaceInvite, 'expires_at'>): boolean {
	return new Date(invite.expires_at).getTime() < Date.now();
}
