import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		throw new Error('no service key');
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { grantWelcomeCredit } = await import('./welcome-guard');
const settings = await import('./settings');

async function prime(credits = 1000, cap = 20, logging = false) {
	settings._resetSettingsForTests();
	settings._setSettingsClientFactory(
		() =>
			({
				rpc: async () => ({ data: null, error: null }),
				from: () => ({
					select: async () => ({
						data: [
							{ key: 'signup_credits', value: credits, updated_at: 't' },
							{ key: 'signup_credits_hourly_cap', value: cap, updated_at: 't' },
							{ key: 'activity_log', value: logging, updated_at: 't' },
							{ key: 'activity_pepper', value: 'p'.repeat(40), updated_at: 't' }
						],
						error: null
					})
				})
			}) as never
	);
	await settings.refreshSettings();
}

beforeEach(() => settings._resetSettingsForTests());

describe('atomic welcome grant', () => {
	it('sends eligibility, cap, and grant through one database operation', async () => {
		await prime();
		const calls: Array<[string, Record<string, unknown>]> = [];
		const client = {
			rpc: async (fn: string, args: Record<string, unknown>) => {
				calls.push([fn, args]);
				return { data: 'granted', error: null };
			}
		};
		expect(await grantWelcomeCredit('u1', '203.0.113.7', client)).toBe('granted');
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toBe('signup_credit_grant_atomic');
		expect(calls[0][1]).toMatchObject({ p_user: 'u1', p_credits: 1000, p_hourly_cap: 20 });
		expect(String(calls[0][1].p_address_hash)).toHaveLength(64);
	});

	it('works when optional activity logging is disabled', async () => {
		await prime(1000, 20, false);
		const client = { rpc: async () => ({ data: 'granted', error: null }) };
		expect(await grantWelcomeCredit('u1', '203.0.113.7', client)).toBe('granted');
	});

	it.each([
		['capped', 'capped'],
		['address_ineligible', 'ineligible'],
		['duplicate', 'granted']
	] as const)('maps database result %s', async (dbResult, expected) => {
		await prime();
		const client = { rpc: async () => ({ data: dbResult, error: null }) };
		expect(await grantWelcomeCredit('u1', '203.0.113.7', client)).toBe(expected);
	});

	it('fails closed on a database failure', async () => {
		await prime();
		const client = {
			rpc: async () => ({ data: null, error: { message: 'database unavailable' } })
		};
		expect(await grantWelcomeCredit('u1', '203.0.113.7', client)).toBe('failed');
	});

	it('fails closed without a trusted address or hashing pepper', async () => {
		await prime();
		const client = { rpc: vi.fn() };
		expect(await grantWelcomeCredit('u1', null, client)).toBe('failed');
		expect(client.rpc).not.toHaveBeenCalled();
	});

	it('grants nothing when signup credit is off', async () => {
		await prime(0);
		expect(await grantWelcomeCredit('u1', '203.0.113.7', { rpc: vi.fn() })).toBe('off');
	});
});
