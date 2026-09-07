/**
 * REGISTRATION — the Admin PIN is the only admission control on this deployment.
 *
 * On 2026-09-05 the PIN gate was found to be bypassable: the Supabase project
 * accepted public signups, and the anon key ships inside the browser bundle, so
 * an attacker could POST to <supabase>/auth/v1/signup and never touch this
 * route. The fix has two halves — the project setting (checked on the deploy
 * path by scripts/preflight-auth.mjs) and this route creating users with the
 * SERVICE ROLE so registration still works once public signups are off.
 *
 * These specs pin the second half: that the route does not reach the auth
 * server at all until the PIN has been accepted, and that it uses the admin
 * client rather than the anon signUp() whenever a service key exists.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv, createUser, signInWithPassword, anonSignUp, serviceClientThrows } = vi.hoisted(
	() => ({
		mockEnv: {} as Record<string, string>,
		createUser: vi.fn(),
		signInWithPassword: vi.fn(),
		anonSignUp: vi.fn(),
		serviceClientThrows: { value: false }
	})
);

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServiceClient: () => {
		if (serviceClientThrows.value) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
		return { auth: { admin: { createUser } } };
	}
}));

const { POST } = await import('./+server');

const CORRECT_PIN = 'let-me-in-1234';

function makeEvent(body: Record<string, unknown>, ip = '203.0.113.9') {
	return {
		request: { json: async () => body },
		getClientAddress: () => ip,
		locals: { supabase: { auth: { signUp: anonSignUp, signInWithPassword } } }
	} as never;
}

/** Each test gets a fresh IP so the shared module-level limiter cannot leak across them. */
let ipCounter = 0;
const freshIp = () => `198.51.100.${++ipCounter % 250}-${Math.random()}`;

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	createUser.mockReset();
	signInWithPassword.mockReset();
	anonSignUp.mockReset();
	serviceClientThrows.value = false;
	delete process.env.ADMIN_PIN;

	createUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
	signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
});

describe('input validation', () => {
	it('requires an email and a password', async () => {
		const res = await POST(makeEvent({ email: '', password: '' }));
		expect(res.status).toBe(400);
		expect(createUser).not.toHaveBeenCalled();
	});

	it('enforces the minimum password length', async () => {
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'short' }));
		expect(res.status).toBe(400);
		expect(createUser).not.toHaveBeenCalled();
	});
});

describe('Admin PIN gate', () => {
	beforeEach(() => {
		mockEnv.ADMIN_PIN = CORRECT_PIN;
	});

	it('refuses a missing PIN WITHOUT creating anything', async () => {
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: expect.stringContaining('PIN') });
		expect(createUser).not.toHaveBeenCalled();
		expect(anonSignUp).not.toHaveBeenCalled();
	});

	it('refuses a wrong PIN WITHOUT creating anything', async () => {
		const res = await POST(
			makeEvent({ email: 'a@b.co', password: 'longenough', pin: 'nope' }, freshIp())
		);
		expect(res.status).toBe(400);
		expect(createUser).not.toHaveBeenCalled();
		expect(anonSignUp).not.toHaveBeenCalled();
	});

	it('refuses a non-string PIN instead of coercing it', async () => {
		const res = await POST(
			makeEvent({ email: 'a@b.co', password: 'longenough', pin: { toString: () => CORRECT_PIN } }, freshIp())
		);
		expect(res.status).toBe(400);
		expect(createUser).not.toHaveBeenCalled();
	});

	it('accepts the correct PIN', async () => {
		const res = await POST(
			makeEvent({ email: 'a@b.co', password: 'longenough', pin: CORRECT_PIN }, freshIp())
		);
		expect(res.status).toBe(200);
		// hooks.server.ts reads `user.id` off this body to run the welcome-credit
		// abuse guard; any other shape silently disables that guard.
		expect(await res.json()).toMatchObject({ user: { id: 'u1' } });
		expect(createUser).toHaveBeenCalledTimes(1);
	});

	it('is skipped entirely when no PIN is configured', async () => {
		delete mockEnv.ADMIN_PIN;
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(res.status).toBe(200);
		expect(createUser).toHaveBeenCalledTimes(1);
	});

	it('throttles repeated wrong PINs from one address', async () => {
		const ip = freshIp();
		const attempt = () =>
			POST(makeEvent({ email: 'a@b.co', password: 'longenough', pin: 'wrong' }, ip));

		for (let i = 0; i < 10; i++) {
			expect((await attempt()).status, `attempt ${i + 1}`).toBe(400);
		}
		const throttled = await attempt();
		expect(throttled.status).toBe(429);
		expect(throttled.headers.get('Retry-After')).toBeTruthy();
		expect(createUser).not.toHaveBeenCalled();
	});

	it('does not throttle a different address', async () => {
		const ip = freshIp();
		for (let i = 0; i < 11; i++) {
			await POST(makeEvent({ email: 'a@b.co', password: 'longenough', pin: 'wrong' }, ip));
		}
		const other = await POST(
			makeEvent({ email: 'a@b.co', password: 'longenough', pin: CORRECT_PIN }, freshIp())
		);
		expect(other.status).toBe(200);
	});

	it('clears the throttle after a successful PIN', async () => {
		const ip = freshIp();
		for (let i = 0; i < 9; i++) {
			await POST(makeEvent({ email: 'a@b.co', password: 'longenough', pin: 'wrong' }, ip));
		}
		// Succeeding resets the bucket, so the next 10 attempts are available again.
		expect(
			(await POST(makeEvent({ email: 'a@b.co', password: 'longenough', pin: CORRECT_PIN }, ip)))
				.status
		).toBe(200);
		expect(
			(await POST(makeEvent({ email: 'a@b.co', password: 'longenough', pin: 'wrong' }, ip))).status
		).toBe(400);
	});
});

describe('user creation path', () => {
	it('uses the service role, auto-confirming the address', async () => {
		await POST(makeEvent({ email: 'a@b.co', password: 'longenough', full_name: 'Ada' }, freshIp()));
		expect(createUser).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'a@b.co',
				password: 'longenough',
				email_confirm: true,
				user_metadata: { full_name: 'Ada' }
			})
		);
		// The anon path must NOT be used when a service client is available: it is
		// the path that requires the project to accept public signups.
		expect(anonSignUp).not.toHaveBeenCalled();
	});

	it('signs the browser in through the cookie client after creating', async () => {
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(signInWithPassword).toHaveBeenCalledWith({
			email: 'a@b.co',
			password: 'longenough'
		});
		expect(await res.json()).toMatchObject({ session: { access_token: 't' } });
	});

	it('reports a duplicate address as 409', async () => {
		createUser.mockResolvedValue({
			data: null,
			error: { status: 422, message: 'A user with this email address has already been registered' }
		});
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(res.status).toBe(409);
	});

	it('still returns the user when creation succeeds but sign-in fails', async () => {
		signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'nope' } });
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ user: { id: 'u1' }, session: null });
	});
});

describe('fallback when no service key is configured', () => {
	beforeEach(() => {
		serviceClientThrows.value = true;
	});

	it('degrades to the anon signUp path rather than bricking registration', async () => {
		anonSignUp.mockResolvedValue({
			data: { user: { id: 'u2', identities: [{}] }, session: null },
			error: null
		});
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(res.status).toBe(200);
		// Same `user.id` contract as the service-role path (hooks.server.ts welcome guard).
		expect(await res.json()).toMatchObject({ user: { id: 'u2' } });
		expect(anonSignUp).toHaveBeenCalledTimes(1);
		expect(createUser).not.toHaveBeenCalled();
	});

	it('still enforces the PIN on the fallback path', async () => {
		mockEnv.ADMIN_PIN = CORRECT_PIN;
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(res.status).toBe(400);
		expect(anonSignUp).not.toHaveBeenCalled();
	});

	it('treats an empty identities array as a duplicate', async () => {
		anonSignUp.mockResolvedValue({
			data: { user: { id: 'u3', identities: [] }, session: null },
			error: null
		});
		const res = await POST(makeEvent({ email: 'a@b.co', password: 'longenough' }, freshIp()));
		expect(res.status).toBe(409);
	});
});
