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
 *   VIDEO_INGEST    / video_ingest   off (default) | on
 *   ACTIVITY_PEPPER / activity_pepper  hashing secret (generated in the DB on first migration)
 *   CREDIT_MARKUP   / credit_markup    retail multiplier on estimated cost (1 = at cost)
 *   PLATFORM_ADMIN_EMAILS   env-only bootstrap list (in addition to platform_admins rows)
 *   ACTIVITY_RETENTION_DAYS env-only, default 180
 */

import { env } from '$env/dynamic/private';
import { getSettings, type PersonaBackboneSetting, type PersonaGeneratorSetting } from './settings';

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

/** Retail multiplier applied when debiting credits: 1 credit = 1 retail cent. */
export function creditMarkup(): number {
	const e = Number(env.CREDIT_MARKUP);
	if (Number.isFinite(e) && e >= 1 && e <= 20) return e;
	const s = Number(getSettings().credit_markup);
	return Number.isFinite(s) && s >= 1 && s <= 20 ? s : 1;
}

export function creditMarkupSource(): SwitchSource {
	const e = Number(env.CREDIT_MARKUP);
	if (Number.isFinite(e) && e >= 1 && e <= 20) return 'env';
	return getSettings().credit_markup ? 'database' : 'default';
}

/** Plans on /billing (subscriptions). Console-only; off until the database row says otherwise. */
export function plansEnabled(): boolean {
	return getSettings().plans_enabled === true;
}

/** Platform-wide ceiling on estimated provider spend per UTC day (0 = off). Console-only, no env; off until the database row says otherwise. */
export function platformDailySpendUsd(): number {
	const n = Number(getSettings().daily_platform_spend_usd);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ── Persona Model v2 ────────────────────────────────────────────────────────
// Same precedence as everything above: env var (if set) → platform_settings row
// flipped from the Admin Console → default. The console is the normal control
// surface; the env var is the host-level emergency override.
//
// Two switches, deliberately separate, because they answer different questions:
//   PERSONA_GENERATOR — how a NEW persona is built.
//   PERSONA_BACKBONE  — how far the sampled life data is switched on for
//                       EXISTING personas (computed → persisted → emitted).
// Keeping them apart means a persona's stored data and what the model is told
// can never change in the same move, which is what makes each step reversible.

function envPersonaGenerator(): PersonaGeneratorSetting | null {
	const raw = (env.PERSONA_GENERATOR ?? '').trim().toLowerCase();
	if (raw === '') return null;
	return raw === 'v2' ? 'v2' : 'v1';
}

/** Which generator builds a new persona. Default 'v1' — today's behaviour. */
export function personaGenerator(): PersonaGeneratorSetting {
	return envPersonaGenerator() ?? getSettings().persona_generator ?? 'v1';
}

export function personaGeneratorSource(): SwitchSource {
	if (envPersonaGenerator() !== null) return 'env';
	return getSettings().persona_generator ? 'database' : 'default';
}

function envPersonaBackbone(): PersonaBackboneSetting | null {
	const raw = (env.PERSONA_BACKBONE ?? '').trim().toLowerCase();
	if (raw === '') return null;
	return raw === 'shadow' || raw === 'fill' || raw === 'on' ? raw : 'off';
}

/** How far the sampled life backbone is switched on. Default 'off'. */
export function personaBackbone(): PersonaBackboneSetting {
	return envPersonaBackbone() ?? getSettings().persona_backbone ?? 'off';
}

export function personaBackboneSource(): SwitchSource {
	if (envPersonaBackbone() !== null) return 'env';
	return getSettings().persona_backbone ? 'database' : 'default';
}

/** True once the backbone is persisted (fill or on). Readers use this to decide whether to show it. */
export function personaBackbonePersists(): boolean {
	const m = personaBackbone();
	return m === 'fill' || m === 'on';
}

/** True ONLY at 'on' — the single gate on backbone facts reaching a prompt. */
export function personaBackboneEmits(): boolean {
	return personaBackbone() === 'on';
}

// ── Video-to-video (source-clip ingest) ─────────────────────────────────────
// Same precedence as everything above: env var (if set) → platform_settings row
// flipped from the Admin Console → default.
//
// Deliberately NOT the same thing as the `videoIngest` HOST capability that the
// composer probes (ffprobe on the box). That one answers "can this deployment
// measure a clip", this one answers "may it accept one" — a decision about the
// account, not the machine. Collapsed into one signal, an operator's refusal
// would read as a broken host, and repairing the host would silently switch the
// capability back on.
//
// Defaults OFF: this path re-performs footage the account did not shoot, so it
// is a decision somebody has to take per deployment, and a deployment that has
// never taken it has not taken it in the affirmative.

function envVideoIngest(): boolean | null {
	const raw = (env.VIDEO_INGEST ?? '').trim().toLowerCase();
	if (raw === '') return null;
	return raw === 'on' || raw === 'true' || raw === '1';
}

/**
 * Whether source clips may be uploaded / re-performed at all. Default false.
 *
 * This deliberately depends on NOTHING but the switch. An earlier version also
 * required the activity log, because the rights attestation was recorded through
 * it and that store is a no-op while ACTIVITY_LOG is off — an attestation that
 * silently is not kept is worse than none. The attestation now has its own
 * table (`source_clip_attestations`) and ingest fails closed when the row cannot
 * be written, so the guarantee lives where the write happens rather than in a
 * flag that could disable the feature for an unrelated reason.
 */
export function videoIngestEnabled(): boolean {
	const e = envVideoIngest();
	if (e !== null) return e;
	return getSettings().video_ingest === true;
}

export function videoIngestSource(): SwitchSource {
	if (envVideoIngest() !== null) return 'env';
	return getSettings().video_ingest ? 'database' : 'default';
}
