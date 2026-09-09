/**
 * The signup gate and the money behind it.
 *
 * The Admin PIN is decorative while the Supabase project allows public
 * signups — the anon key ships in the browser bundle, so anyone can POST to
 * GoTrue directly. Proven against production: that returned 200 with a
 * session, a profile, a free subscription AND a wallet holding 1000 credits.
 *
 * The marker below is what removes the money from that hole. It goes in
 * app_metadata, which only an admin call can write; a client POST sending its
 * own `app_metadata` has it land in user_metadata and ignored (also proven).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const created = vi.hoisted(() => ({ args: null as Record<string, unknown> | null }));
const mockEnv = vi.hoisted(() => ({} as Record<string, string>));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServiceClient: () => ({
		auth: {
			admin: {
				createUser: async (args: Record<string, unknown>) => {
					created.args = args;
					return { data: { user: { id: 'u-new' } }, error: null };
				}
			}
		}
	})
}));

const signup = await import('../../routes/api/auth/signup/+server');

const locals = {
	supabase: {
		auth: {
			signInWithPassword: async () => ({ data: { session: { access_token: 't' } }, error: null })
		}
	}
} as never;

const call = (body: unknown) =>
	(signup.POST as unknown as (e: unknown) => Promise<Response>)({
		request: new Request('http://t/', { method: 'POST', body: JSON.stringify(body) }),
		locals,
		getClientAddress: () => '203.0.113.7'
	});

beforeEach(() => {
	created.args = null;
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('signup — the invited marker', () => {
	it('marks accounts it creates, in app_metadata', async () => {
		const res = await call({ email: 'a@b.co', password: 'longenough', full_name: 'A' });
		expect(res.status).toBe(200);
		expect(created.args?.app_metadata).toEqual({ invited: true });
	});

	it('puts the marker somewhere a client cannot reach', () => {
		// user_metadata is client-writable through a plain GoTrue signup, so a
		// marker there would be forgeable and the guard would be theatre.
		expect(created.args).toBeNull();
		const src = readFileSync(new URL('../../routes/api/auth/signup/+server.ts', import.meta.url), 'utf-8');
		expect(src).toMatch(/app_metadata:\s*\{\s*invited:\s*true\s*\}/);
		expect(src).not.toMatch(/user_metadata:[^}]*invited/);
	});

	it('still refuses without the PIN when one is configured', async () => {
		mockEnv.ADMIN_PIN = 'let-me-in';
		const res = await call({ email: 'a@b.co', password: 'longenough' });
		expect(res.status).toBe(400);
		expect(created.args).toBeNull();
	});

	it('creates the account when the PIN is right', async () => {
		mockEnv.ADMIN_PIN = 'let-me-in';
		const res = await call({ email: 'a@b.co', password: 'longenough', pin: 'let-me-in' });
		expect(res.status).toBe(200);
		expect(created.args?.app_metadata).toEqual({ invited: true });
	});
});

describe('the trigger that reads the marker', () => {
	const sql = readFileSync(
		new URL('../../../supabase/signup_invite_credit_guard_migration.sql', import.meta.url),
		'utf-8'
	);

	it('reads app metadata, never the client-controlled kind', () => {
		expect(sql).toContain("NEW.raw_app_meta_data->>'invited'");
		expect(sql).not.toMatch(/raw_user_meta_data->>'invited'/);
	});

	it('still creates the profile and the free subscription for any account', () => {
		// An account that exists has to be usable and deletable. Only the CREDIT
		// is withheld.
		expect(sql).toContain('INSERT INTO public.profiles');
		expect(sql).toContain('INSERT INTO public.subscriptions');
	});

	it('keeps the hourly cap as well — the marker is not the only guard', () => {
		expect(sql).toContain('signup_credits_hourly_cap');
	});

	it('an absent or unreadable setting means the requirement is ON', () => {
		expect(sql).toMatch(/COALESCE\(\(value #>> '\{\}'\) <> 'false', true\)/);
		expect(sql).toContain('v_require := COALESCE(v_require, true)');
	});
});

describe('the setting fails safe', () => {
	it('only an explicit false turns the requirement off', async () => {
		const settings = await import('./settings');
		const client = (value: unknown) => ({
			rpc: async () => ({ data: null, error: null }),
			from: () => ({
				select: async () => ({
					data: [{ key: 'signup_credits_require_invite', value, updated_at: 't' }],
					error: null
				})
			})
		});
		for (const v of [null, '', 'yes', 0, 'FALSE', 'off']) {
			settings._resetSettingsForTests();
			settings._setSettingsClientFactory(() => client(v) as never);
			await settings.refreshSettings();
			expect(settings.getSettings().signup_credits_require_invite, String(v)).toBe(true);
		}
		for (const v of [false, 'false']) {
			settings._resetSettingsForTests();
			settings._setSettingsClientFactory(() => client(v) as never);
			await settings.refreshSettings();
			expect(settings.getSettings().signup_credits_require_invite, String(v)).toBe(false);
		}
	});

	it('defaults to on before anything is read', async () => {
		const settings = await import('./settings');
		settings._resetSettingsForTests();
		expect(settings.getSettings().signup_credits_require_invite).toBe(true);
	});
});
