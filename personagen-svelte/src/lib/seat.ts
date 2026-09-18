/**
 * What the signed-in seat may do — the presentation half of workspace roles.
 *
 * The database is the authority: every route re-checks per persona with
 * `checkAgentAccess`, and RLS enforces it underneath. This module exists so the
 * UI can stop *offering* actions the server is going to refuse.
 *
 * Before it, the portal rendered one full-privilege shell for every seat. A
 * viewer got the Approve button, the Publish button and the spend panel, and
 * found out they could not use them by watching a request fail: `/api/analytics`
 * and `/api/agent/[id]/spend` are manager-and-above, so a creator or viewer
 * opening the dashboard or a persona page fired a 403 into the console on every
 * visit and got an error state that blamed the network rather than naming the
 * seat. The mission's rule is the opposite — hide it, or disable it and say why,
 * but never present an action that will 403.
 *
 * The rank mirrors `ROLE_RANK` in `src/lib/server/workspaces.ts`, which itself
 * mirrors `public.role_rank()` in `supabase/workspace_admin_role_migration.sql`.
 * All three must agree.
 */
export type SeatRole = 'owner' | 'admin' | 'manager' | 'creator' | 'viewer';

export const SEAT_RANK: Record<SeatRole, number> = {
	viewer: 0,
	creator: 1,
	manager: 2,
	admin: 3,
	owner: 4
};

export const SEAT_LABEL: Record<SeatRole, string> = {
	owner: 'Owner',
	admin: 'Admin',
	manager: 'Manager',
	creator: 'Creator',
	viewer: 'Viewer'
};

/** What each seat is for, in one line — used by the "why is this disabled" copy. */
export const SEAT_SUMMARY: Record<SeatRole, string> = {
	owner: 'Full control, including deleting personas and the workspace itself.',
	admin: 'Everything a manager can do, plus managing who else has a seat.',
	manager: 'Approve, publish, manage connections and see what things cost.',
	creator: 'Generate and draft. Someone with a manager seat approves and publishes.',
	viewer: 'Read-only. You can see the work but not change it.'
};

export interface SeatCapabilities {
	role: SeatRole;
	label: string;
	summary: string;
	/** Generate content and save drafts. */
	canCreate: boolean;
	/** Approve, reject, schedule, publish, delete posts. */
	canPublish: boolean;
	/** See spend, analytics and the rate card. Manager and above. */
	canSeeSpend: boolean;
	/** Manage platform connections on a persona. */
	canManageConnections: boolean;
	/** Invite, re-role and remove other seats. */
	canManageSeats: boolean;
	/** Rename or delete the workspace; delete a persona outright. */
	canDeletePersona: boolean;
	/** Nothing in the portal is editable for this seat. */
	readOnly: boolean;
}

export function capabilities(role: SeatRole): SeatCapabilities {
	const rank = SEAT_RANK[role] ?? SEAT_RANK.viewer;
	const atLeast = (min: SeatRole) => rank >= SEAT_RANK[min];
	return {
		role,
		label: SEAT_LABEL[role] ?? SEAT_LABEL.viewer,
		summary: SEAT_SUMMARY[role] ?? SEAT_SUMMARY.viewer,
		canCreate: atLeast('creator'),
		canPublish: atLeast('manager'),
		canSeeSpend: atLeast('manager'),
		canManageConnections: atLeast('manager'),
		canManageSeats: atLeast('admin'),
		canDeletePersona: atLeast('owner'),
		readOnly: rank <= SEAT_RANK.viewer
	};
}

/**
 * The sentence shown next to a control this seat cannot use. Always names the
 * seat and what would be needed, because "Forbidden" tells the user nothing
 * they can act on.
 */
export function seatBlockedReason(seat: SeatCapabilities | undefined, needs: SeatRole): string | null {
	if (!seat) return null;
	if (SEAT_RANK[seat.role] >= SEAT_RANK[needs]) return null;
	return `Your ${seat.label} seat cannot do this. It needs ${SEAT_LABEL[needs]} or above — ask a workspace admin to change your seat.`;
}

/** Never-brick default for any surface that has no seat data yet. */
export const FULL_ACCESS: SeatCapabilities = capabilities('owner');
