/**
 * Platform-admin authority — "may this session act across tenants?"
 *
 * Two sources, either suffices:
 *   1. a row in public.platform_admins (checked through is_platform_admin(),
 *      a SECURITY DEFINER function the session can call under RLS);
 *   2. the session email in PLATFORM_ADMIN_EMAILS (env bootstrap, so the first
 *      operator exists before the table has rows).
 *
 * Fail CLOSED: any lookup error means "not an admin". Every admin route calls
 * requirePlatformAdmin() first and returns its status verbatim.
 */

import type { User } from '@supabase/supabase-js';
import { platformAdminEmails } from './flags';

type Locals = {
	supabase: any;
	safeGetSession: () => Promise<{ session: any; user: User | null }>;
};

export async function isPlatformAdmin(supabase: any, user: User | null | undefined): Promise<boolean> {
	if (!user) return false;
	const email = (user.email ?? '').toLowerCase();
	if (email && platformAdminEmails().includes(email)) return true;
	try {
		const { data, error } = await supabase.rpc('is_platform_admin', { p_user: user.id });
		if (error) return false;
		return data === true;
	} catch {
		return false;
	}
}

export type AdminGate =
	| { ok: true; user: User }
	| { ok: false; status: 401 | 403; message: string };

export async function requirePlatformAdmin(locals: Locals): Promise<AdminGate> {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return { ok: false, status: 401, message: 'Unauthorized' };
	if (!(await isPlatformAdmin(locals.supabase, user))) {
		return { ok: false, status: 403, message: 'Platform admin access required' };
	}
	return { ok: true, user };
}
