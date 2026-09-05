/**
 * Runtime switches for the monetization + observability rails.
 *
 * Every value is read at CALL time from $env/dynamic/private (never cached at
 * import), exactly like the spend caps in budget.ts, so an EasyPanel env change
 * plus container restart flips behaviour without a code deploy (durable plan, D5).
 *
 *   CREDITS_ENFORCE   off     (default) no balance reads or writes — today's behaviour
 *                     shadow  debits are written, nothing is ever blocked
 *                     enforce fail-closed: insufficient credits block paid generation
 *   ACTIVITY_LOG      off (default) | on
 *   PLATFORM_ADMIN_EMAILS   comma-separated bootstrap list (in addition to platform_admins rows)
 *   ACTIVITY_PEPPER   secret used to hash IPs / subjects in the activity log
 *   ACTIVITY_RETENTION_DAYS  raw event retention (default 180)
 */

import { env } from '$env/dynamic/private';

export type CreditsMode = 'off' | 'shadow' | 'enforce';

export function creditsMode(): CreditsMode {
	const raw = (env.CREDITS_ENFORCE ?? '').trim().toLowerCase();
	if (raw === 'shadow' || raw === 'enforce') return raw;
	return 'off';
}

export function activityLogEnabled(): boolean {
	const raw = (env.ACTIVITY_LOG ?? '').trim().toLowerCase();
	return raw === 'on' || raw === 'true' || raw === '1';
}

export function platformAdminEmails(): string[] {
	return (env.PLATFORM_ADMIN_EMAILS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export function activityPepper(): string {
	return (env.ACTIVITY_PEPPER ?? '').trim();
}

export function activityRetentionDays(): number {
	const n = Number(env.ACTIVITY_RETENTION_DAYS);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 180;
}
