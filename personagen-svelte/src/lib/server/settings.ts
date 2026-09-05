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

export type CreditsModeSetting = 'off' | 'shadow' | 'enforce';

export interface PlatformSettings {
	credits_mode: CreditsModeSetting;
	activity_log: boolean;
	activity_pepper: string;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
	credits_mode: 'off',
	activity_log: false,
	activity_pepper: ''
};

export const SETTING_KEYS = ['credits_mode', 'activity_log', 'activity_pepper'] as const;
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
		case 'activity_log':
			return raw === true || raw === 'true';
		case 'activity_pepper':
			return typeof raw === 'string' ? raw : '';
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
