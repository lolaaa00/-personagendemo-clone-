import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		throw new Error('no service key in tests');
	}
}));

const settings = await import('./settings');
const flags = await import('./flags');

function client(rows: any[] | null, error: any = null, rpcResult: any = { data: null, error: null }) {
	return {
		rpc: vi.fn(async () => rpcResult),
		from: () => ({ select: async () => ({ data: rows, error }) })
	};
}

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	settings._resetSettingsForTests();
});

describe('settings cache', () => {
	it('defaults are all off before the first prime', () => {
		expect(settings.getSettings()).toMatchObject({ credits_mode: 'off', activity_log: false, activity_pepper: '', signup_credits: 2000, display_currency_default: 'auto' });
		expect(settings.getSettings().fx_rates.rates.USD).toBe(1);
		expect(settings.settingsStatus().primed).toBe(false);
	});

	it('coerces money settings defensively', async () => {
		settings._setSettingsClientFactory(() =>
			client([
				{ key: 'signup_credits', value: -5, updated_at: 't' },
				{ key: 'display_currency_default', value: 'aud', updated_at: 't' },
				{ key: 'fx_rates', value: { base: 'USD', rates: { AUD: 1.5 }, updated_at: 'x', source: 'test' }, updated_at: 't' }
			])
		);
		await settings.refreshSettings();
		const s = settings.getSettings();
		expect(s.signup_credits).toBe(0);
		expect(s.display_currency_default).toBe('auto');
		expect(s.fx_rates.rates).toEqual({ USD: 1, AUD: 1.5 });
	});

	it('refresh loads and coerces rows; unknown keys ignored', async () => {
		settings._setSettingsClientFactory(() =>
			client([
				{ key: 'credits_mode', value: 'shadow', updated_at: 't1' },
				{ key: 'activity_log', value: true, updated_at: 't2' },
				{ key: 'activity_pepper', value: 'p'.repeat(40), updated_at: 't3' },
				{ key: 'something_else', value: 1, updated_at: 't4' }
			])
		);
		await settings.refreshSettings();
		expect(settings.getSettings()).toMatchObject({ credits_mode: 'shadow', activity_log: true, activity_pepper: 'p'.repeat(40) });
		expect(settings.settingsStatus().primed).toBe(true);
		expect(settings.settingsStatus().lastError).toBeNull();
	});

	it('an invalid stored mode coerces to off (never to enforce by accident)', async () => {
		settings._setSettingsClientFactory(() => client([{ key: 'credits_mode', value: 'ENFORCE!', updated_at: 't' }]));
		await settings.refreshSettings();
		expect(settings.getSettings().credits_mode).toBe('off');
	});

	it('a failed refresh keeps the last known values and reports the error', async () => {
		settings._setSettingsClientFactory(() => client([{ key: 'credits_mode', value: 'enforce', updated_at: 't' }]));
		await settings.refreshSettings();
		settings._setSettingsClientFactory(() => client(null, { message: 'db down' }));
		await settings.refreshSettings();
		expect(settings.getSettings().credits_mode).toBe('enforce');
		expect(settings.settingsStatus().lastError).toBe('db down');
		expect(settings.settingsStatus().primed).toBe(true);
	});

	it('setSetting writes through the validated function and refreshes at once', async () => {
		const c = client([{ key: 'activity_log', value: true, updated_at: 't' }], null, { data: true, error: null });
		settings._setSettingsClientFactory(() => c);
		await settings.setSetting('activity_log', true, 'admin-1', 'pilot');
		expect(c.rpc).toHaveBeenCalledWith('platform_setting_set', { p_key: 'activity_log', p_value: true, p_actor: 'admin-1', p_note: 'pilot' });
		expect(settings.getSettings().activity_log).toBe(true);
	});

	it('setSetting surfaces a validation error from the database', async () => {
		settings._setSettingsClientFactory(() => client([], null, { data: null, error: { message: 'credits_mode must be off | shadow | enforce' } }));
		await expect(settings.setSetting('credits_mode', 'nope', null, null)).rejects.toThrow(/must be off/);
	});
});

describe('flags precedence: env → database → default', () => {
	it('database value applies when env is unset', async () => {
		settings._setSettingsClientFactory(() => client([{ key: 'credits_mode', value: 'shadow', updated_at: 't' }, { key: 'activity_log', value: true, updated_at: 't' }]));
		await settings.refreshSettings();
		expect(flags.creditsMode()).toBe('shadow');
		expect(flags.activityLogEnabled()).toBe(true);
		expect(flags.creditsSource()).toBe('database');
	});

	it('env wins over the database (host-level emergency override)', async () => {
		settings._setSettingsClientFactory(() => client([{ key: 'credits_mode', value: 'enforce', updated_at: 't' }, { key: 'activity_log', value: true, updated_at: 't' }]));
		await settings.refreshSettings();
		mockEnv.CREDITS_ENFORCE = 'off';
		mockEnv.ACTIVITY_LOG = 'off';
		expect(flags.creditsMode()).toBe('off');
		expect(flags.activityLogEnabled()).toBe(false);
		expect(flags.creditsSource()).toBe('env');
	});

	it('pepper: env, else database, else empty', async () => {
		expect(flags.activityPepper()).toBe('');
		settings._setSettingsClientFactory(() => client([{ key: 'activity_pepper', value: 'db-pepper-'.repeat(4), updated_at: 't' }]));
		await settings.refreshSettings();
		expect(flags.activityPepper()).toBe('db-pepper-'.repeat(4));
		mockEnv.ACTIVITY_PEPPER = 'env-pepper';
		expect(flags.activityPepper()).toBe('env-pepper');
	});
});
