/**
 * Runtime switches for the monetization + observability rails.
 *
 * Precedence for each switch: **env var (if set) → database (platform_settings,
 * flipped from the Admin Console) → default.** The database is the normal
 * control surface — no env change, no redeploy; the env var remains the
 * host-level emergency override ("turn it all off with two variables").
 * Values are read at CALL time (env) or from the settings cache (database,
 * refreshed every 15 s, primed at boot), never cached at import.
 *
 *   CREDITS_ENFORCE / credits_mode   off (default) | shadow | enforce
 *   ACTIVITY_LOG    / activity_log   off (default) | on
 *   ACTIVITY_PEPPER / activity_pepper  hashing secret (generated in the DB on first migration)
 *   PLATFORM_ADMIN_EMAILS   env-only bootstrap list (in addition to platform_admins rows)
 *   ACTIVITY_RETENTION_DAYS env-only, default 180
 */

import { env } from '$env/dynamic/private';
import { getSettings } from './settings';

export type CreditsMode = 'off' | 'shadow' | 'enforce';
export type SwitchSource = 'env' | 'database' | 'default';

function envCreditsMode(): CreditsMode | null {
	const raw = (env.CREDITS_ENFORCE ?? '').trim().toLowerCase();
	if (raw === '') return null;
	if (raw === 'shadow' || raw === 'enforce') return raw;
	return 'off';
}

export function creditsMode(): CreditsMode {
	return envCreditsMode() ?? getSettings().credits_mode ?? 'off';
}

export function creditsSource(): SwitchSource {
	if (envCreditsMode() !== null) return 'env';
	return getSettings().credits_mode ? 'database' : 'default';
}

function envActivityLog(): boolean | null {
	const raw = (env.ACTIVITY_LOG ?? '').trim().toLowerCase();
	if (raw === '') return null;
	return raw === 'on' || raw === 'true' || raw === '1';
}

export function activityLogEnabled(): boolean {
	const e = envActivityLog();
	if (e !== null) return e;
	return getSettings().activity_log === true;
}

export function activitySource(): SwitchSource {
	if (envActivityLog() !== null) return 'env';
	return 'database';
}

export function platformAdminEmails(): string[] {
	return (env.PLATFORM_ADMIN_EMAILS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export function activityPepper(): string {
	const e = (env.ACTIVITY_PEPPER ?? '').trim();
	if (e) return e;
	return getSettings().activity_pepper ?? '';
}

export function activityRetentionDays(): number {
	const n = Number(env.ACTIVITY_RETENTION_DAYS);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 180;
}
