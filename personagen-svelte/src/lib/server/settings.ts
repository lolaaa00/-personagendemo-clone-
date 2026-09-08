/**
 * Platform settings — operator switches stored in the database and flipped
 * from the Admin Console, with no env change and no redeploy.
 *
 * Reads are SYNCHRONOUS from an in-process cache (the request hook and the
 * generation path consult them on every call, so they cannot await a query).
 * The cache is primed at boot and refreshed every REFRESH_MS through the
 * service client; a refresh failure keeps the last known values and is
 * reported via settingsStatus() (never a silent fallback to defaults after a
 * successful prime). Before the first prime, defaults apply — all "off".
 *
 * Precedence for every switch (flags.ts): env var if set → database → default.
 * Env stays the host-level emergency override; the database is the normal
 * control surface. Writes go through platform_setting_set() (validated,
 * history row) via /api/admin/settings only.
 */

import { getServiceSupabase } from './service-supabase';
import { onShutdown } from './lifecycle';
import { FALLBACK_FX, type FxRates } from '$lib/money';

export type CreditsModeSetting = 'off' | 'shadow' | 'enforce';
export type PersonaGeneratorSetting = 'v1' | 'v2';
export type PersonaBackboneSetting = 'off' | 'shadow' | 'fill' | 'on';

export interface PlatformSettings {
	credits_mode: CreditsModeSetting;
	activity_log: boolean;
	activity_pepper: string;
	/** Credits granted to every new account at signup; 0 = off. */
	signup_credits: number;
	/** 'auto' (visitor's country/locale) or an ISO-4217 code. */
	display_currency_default: string;
	/** USD-based display rates (display only — the wallet is USD cents). */
	fx_rates: FxRates;
	/**
	 * Retail multiplier on the estimated provider cost when debiting:
	 * credits = ceil(est × markup × 100). Makes 1 credit = 1 RETAIL cent so
	 * packs sell at par and the money pill shows what was paid for. 1 = at cost.
	 */
	credit_markup: number;
	/**
	 * Ceiling on TOTAL estimated provider spend per UTC day across all users;
	 * 0 = off. Code default is OFF (today's behaviour, D5); the migration seeds
	 * the database row at 200 so production has the guard from first boot.
	 */
	daily_platform_spend_usd: number;
	/** Welcome-credit grants allowed per hour platform-wide (signup abuse guard); 0 = unlimited. */
	signup_credits_hourly_cap: number;
	/** Plans (subscriptions) offered on /billing; the webhook keeps existing subscriptions working either way. */
	plans_enabled: boolean;
	/**
	 * Persona Model v2 — which generator builds a new persona.
	 * 'v1' = today's path (the LLM invents every field, values are coerced after).
	 * 'v2' = skeleton first: facts sampled deterministically from the Trait
	 * Registry, then the LLM writes prose conditioned on them and is filtered in
	 * code from changing them. Default 'v1' until the shadow report is clean.
	 */
	persona_generator: PersonaGeneratorSetting;
	/**
	 * Persona Model v2 — how far the sampled life backbone is switched on.
	 * 'off'    nothing computed, nothing shown, nothing emitted (today).
	 * 'shadow' computed and diffed by the backfill script, never persisted.
	 * 'fill'   persisted and visible in the UI, but NOT sent to any prompt.
	 * 'on'     also emitted to prompts (set leaves only).
	 * Each step is a separate decision, so a persona's stored data and what the
	 * model is told can never change in the same move.
	 */
	persona_backbone: PersonaBackboneSetting;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
	credits_mode: 'off',
	activity_log: false,
	activity_pepper: '',
	signup_credits: 2000,
	display_currency_default: 'auto',
	fx_rates: FALLBACK_FX,
	credit_markup: 1,
	daily_platform_spend_usd: 0,
	signup_credits_hourly_cap: 20,
	plans_enabled: false,
	persona_generator: 'v1',
	persona_backbone: 'off'
};

export const SETTING_KEYS = ['credits_mode', 'activity_log', 'activity_pepper', 'signup_credits', 'display_currency_default', 'fx_rates', 'credit_markup', 'daily_platform_spend_usd', 'signup_credits_hourly_cap', 'plans_enabled', 'persona_generator', 'persona_backbone'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const REFRESH_MS = 15_000;

const state = {
	values: { ...DEFAULT_SETTINGS } as PlatformSettings,
	updatedAt: {} as Record<string, string>,
	primed: false,
	lastRefreshAt: null as string | null,
	lastError: null as string | null,
	timer: null as NodeJS.Timeout | null,
	inFlight: null as Promise<void> | null
};

let clientFactory: () => any = () => getServiceSupabase();
export function _setSettingsClientFactory(f: () => any) {
	clientFactory = f;
}
export function _resetSettingsForTests() {
	state.values = { ...DEFAULT_SETTINGS };
	state.updatedAt = {};
	state.primed = false;
	state.lastRefreshAt = null;
	state.lastError = null;
	if (state.timer) clearInterval(state.timer);
	state.timer = null;
	state.inFlight = null;
}

function coerce(key: string, raw: unknown): unknown {
	switch (key) {
		case 'credits_mode':
			return raw === 'shadow' || raw === 'enforce' ? raw : 'off';
		// Both persona switches fail SAFE: any unrecognised value reads as the
		// current behaviour, so a typo in the console can never turn on a
		// half-configured generator.
		case 'persona_generator':
			return raw === 'v2' ? 'v2' : 'v1';
		case 'persona_backbone':
			return raw === 'shadow' || raw === 'fill' || raw === 'on' ? raw : 'off';
		case 'activity_log':
			return raw === true || raw === 'true';
		case 'activity_pepper':
			return typeof raw === 'string' ? raw : '';
		case 'signup_credits': {
			const n = Number(raw);
			return Number.isInteger(n) && n >= 0 ? n : 0;
		}
		case 'display_currency_default':
			return typeof raw === 'string' && (raw === 'auto' || /^[A-Z]{3}$/.test(raw)) ? raw : 'auto';
		case 'fx_rates': {
			const r = raw as any;
			if (r && typeof r === 'object' && r.rates && typeof r.rates === 'object' && Object.keys(r.rates).length > 0) {
				return { base: 'USD', rates: { USD: 1, ...r.rates }, updated_at: r.updated_at ?? null, source: r.source ?? null } as FxRates;
			}
			return FALLBACK_FX;
		}
		case 'credit_markup': {
			const n = Number(raw);
			return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 1;
		}
		case 'daily_platform_spend_usd': {
			const n = Number(raw);
			return Number.isFinite(n) && n >= 0 ? n : 0;
		}
		case 'signup_credits_hourly_cap': {
			const n = Number(raw);
			return Number.isInteger(n) && n >= 0 ? n : 20;
		}
		case 'plans_enabled':
			return raw === true || raw === 'true';
		default:
			return raw;
	}
}

/** Pull every row; unknown keys are ignored, missing keys keep their default. */
export async function refreshSettings(): Promise<void> {
	if (state.inFlight) return state.inFlight;
	state.inFlight = (async () => {
		try {
			const client = clientFactory();
			const { data, error } = await client.from('platform_settings').select('key, value, updated_at');
			if (error) throw new Error(error.message ?? String(error));
			const next: PlatformSettings = { ...DEFAULT_SETTINGS };
			const at: Record<string, string> = {};
			for (const row of data ?? []) {
				if ((SETTING_KEYS as readonly string[]).includes(row.key)) {
					(next as any)[row.key] = coerce(row.key, row.value);
					at[row.key] = row.updated_at;
				}
			}
			state.values = next;
			state.updatedAt = at;
			state.primed = true;
			state.lastError = null;
			state.lastRefreshAt = new Date().toISOString();
		} catch (e) {
			// Table missing (migration not applied) or DB down: keep last known values.
			state.lastError = (e as Error).message;
		} finally {
			state.inFlight = null;
		}
	})();
	return state.inFlight;
}

/** Boot: prime once, then poll. Idempotent. */
export function startSettingsRefresh(): void {
	if (state.timer) return;
	void refreshSettings();
	state.timer = setInterval(() => void refreshSettings(), REFRESH_MS);
	state.timer.unref?.();
	onShutdown('settings-refresh', () => {
		if (state.timer) clearInterval(state.timer);
		state.timer = null;
	});
}

export function getSettings(): Readonly<PlatformSettings> {
	return state.values;
}

export function settingsStatus() {
	return {
		primed: state.primed,
		lastRefreshAt: state.lastRefreshAt,
		lastError: state.lastError,
		updatedAt: { ...state.updatedAt }
	};
}

/**
 * Admin write. Goes through platform_setting_set() (validation + history),
 * then refreshes the cache immediately so the change is live on this
 * instance within the same request, and on any other instance within REFRESH_MS.
 */
export async function setSetting(key: SettingKey, value: unknown, actorId: string | null, note: string | null): Promise<unknown> {
	const client = clientFactory();
	const { data, error } = await client.rpc('platform_setting_set', {
		p_key: key,
		p_value: value,
		p_actor: actorId,
		p_note: note
	});
	if (error) throw new Error(error.message ?? String(error));
	await refreshSettings();
	return data;
}
