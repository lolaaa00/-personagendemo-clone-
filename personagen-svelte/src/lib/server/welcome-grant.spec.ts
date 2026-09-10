/** The granter itself. signup-guard.spec mocks this module; nothing here does. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		throw new Error('no service key in tests');
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { grantWelcomeCredit } = await import('./welcome-guard');
const settings = await import('./settings');

function client(recentGrants: number) {
	const calls: Array<Record<string, unknown>> = [];
	return {
		calls,
		rpc: async (_fn: string, args: Record<string, unknown>) => {
			calls.push(args);
			return { data: null, error: null };
		},
		from: () => ({
			select: () => ({
				eq: function () {
					return this;
				},
				like: function () {
					return this;
				},
				gte: async () => ({ count: recentGrants, error: null })
			})
		})
	};
}

async function prime(rows: Array<{ key: string; value: unknown }>) {
	settings._resetSettingsForTests();
	settings._setSettingsClientFactory(
		() =>
			({
				rpc: async () => ({ data: null, error: null }),
				from: () => ({ select: async () => ({ data: rows.map((r) => ({ ...r, updated_at: 't' })), error: null }) })
			}) as never
	);
	await settings.refreshSettings();
}

beforeEach(() => settings._resetSettingsForTests());

describe('welcome grant', () => {
	it('grants the configured amount with the shared idempotency key', async () => {
		await prime([{ key: 'signup_credits', value: 1000 }, { key: 'signup_credits_hourly_cap', value: 20 }]);
		const c = client(3);
		expect(await grantWelcomeCredit('u1', c as never)).toBe('granted');
		expect(c.calls[0]).toMatchObject({
			p_user: 'u1',
			p_delta: 1000,
			p_kind: 'grant',
			p_stripe_event: 'welcome:u1',
			p_allow_negative: false
		});
		// maybeWithholdWelcome finds the grant by this prefix; changing it would
		// silently disable the per-address clawback.
		expect(String(c.calls[0].p_note)).toMatch(/^welcome/);
	});

	it('withholds at the hourly cap instead of granting', async () => {
		await prime([{ key: 'signup_credits', value: 1000 }, { key: 'signup_credits_hourly_cap', value: 20 }]);
		const c = client(20);
		expect(await grantWelcomeCredit('u1', c as never)).toBe('capped');
		expect(c.calls).toHaveLength(0);
	});

	it('an unlimited cap never withholds', async () => {
		await prime([{ key: 'signup_credits', value: 1000 }, { key: 'signup_credits_hourly_cap', value: 0 }]);
		const c = client(9999);
		expect(await grantWelcomeCredit('u1', c as never)).toBe('granted');
	});

	it('grants nothing when signup credit is switched off', async () => {
		await prime([{ key: 'signup_credits', value: 0 }]);
		const c = client(0);
		expect(await grantWelcomeCredit('u1', c as never)).toBe('off');
		expect(c.calls).toHaveLength(0);
	});

	it('a duplicate is success, not failure — the trigger may have won the race', async () => {
		await prime([{ key: 'signup_credits', value: 1000 }, { key: 'signup_credits_hourly_cap', value: 0 }]);
		const c = {
			rpc: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value' } }),
			from: () => ({ select: () => ({ eq() { return this; }, like() { return this; }, gte: async () => ({ count: 0 }) }) })
		};
		expect(await grantWelcomeCredit('u1', c as never)).toBe('granted');
	});

	it('never throws into the signup path', async () => {
		await prime([{ key: 'signup_credits', value: 1000 }]);
		const c = {
			rpc: async () => {
				throw new Error('database on fire');
			},
			from: () => ({ select: () => ({ eq() { return this; }, like() { return this; }, gte: async () => ({ count: 0 }) }) })
		};
		expect(await grantWelcomeCredit('u1', c as never)).toBe('failed');
	});

	it('does nothing without a user id', async () => {
		await prime([{ key: 'signup_credits', value: 1000 }]);
		expect(await grantWelcomeCredit('', client(0) as never)).toBe('off');
	});
});
