import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase } from '../tests/mock-supabase';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
// Force the module to fall back to the caller's client (no service key in tests).
vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		throw new Error('no service key in tests');
	}
}));

const credits = await import('./credits');
const userKeys = await import('./user-api-keys');

/** A row that really decrypts, built with the same code the resolvers use. */
function storedKey(secret = 'sk-user-key') {
	mockEnv.USER_SECRETS_ENCRYPTION_KEY = 'x'.repeat(32);
	return { provider: 'fal_ai', ...userKeys.encryptSecret(secret) };
}

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('creditsFor — 1 credit = 1 cent of estimate, rounded UP per event', () => {
	it.each([
		[0, 0],
		[-1, 0],
		[NaN, 0],
		[0.001, 1],
		[0.002, 1],
		[0.08, 8],
		[0.077, 8],
		[0.42, 42],
		[1.6, 160],
		[0.1 + 0.2, 30] // float noise must not add a credit
	])('%s USD → %s credits', (usd, want) => {
		expect(credits.creditsFor(usd)).toBe(want);
	});

	it('applies the retail markup: 1 credit = 1 retail cent', () => {
		expect(credits.creditsFor(0.08, 3)).toBe(24);
		expect(credits.creditsFor(0.42, 3)).toBe(126);
		expect(credits.creditsFor(0.002, 3)).toBe(1);
		expect(credits.creditsFor(0.1 + 0.2, 2)).toBe(60);
		expect(credits.retailUsdFor(0.42, 3)).toBe(1.26);
		// a markup below 1 or non-finite is treated as at-cost, never a discount
		expect(credits.creditsFor(0.42, 0.5)).toBe(42);
		expect(credits.creditsFor(0.42, NaN)).toBe(42);
	});

	it('reads the live markup from flags when none is passed', () => {
		mockEnv.CREDIT_MARKUP = '3';
		expect(credits.creditsFor(0.08)).toBe(24);
		delete mockEnv.CREDIT_MARKUP;
		expect(credits.creditsFor(0.08)).toBe(8);
	});
});

describe('keySourceFor', () => {
	it('local/storage providers never bill a key', async () => {
		const sb = createMockSupabase(() => ({ data: null }));
		expect(await credits.keySourceFor(sb, 'u1', 'local')).toBe('none');
		expect(await credits.keySourceFor(sb, 'u1', 'storage')).toBe('none');
		expect(sb.queries).toHaveLength(0);
	});

	it('a USABLE stored key → byo; none → platform; maps fal → fal_ai', async () => {
		const row = storedKey();
		const sb = createMockSupabase((q) =>
			q.table === 'user_api_keys' && q.eqOf('provider') === 'fal_ai' ? { data: row } : { data: null }
		);
		expect(await credits.keySourceFor(sb, 'u1', 'fal')).toBe('byo');
		expect(await credits.keySourceFor(sb, 'u1', 'openrouter')).toBe('platform');
	});

	it('a stored key that will NOT decrypt is platform, because the platform key is what runs', async () => {
		// The leak this closes: the resolvers do `getUserApiKey(...).catch(() => null)`
		// and fall back to env, so a rotated encryption key or a corrupt auth tag
		// means WE pay. Stamping that event 'byo' made it both unbilled (charge()
		// skips non-platform rows) and invisible to every reconciliation view.
		mockEnv.USER_SECRETS_ENCRYPTION_KEY = 'x'.repeat(32);
		const corrupt = { provider: 'fal_ai', encrypted_value: 'not-real', iv: 'nope', auth_tag: 'nope' };
		const sb = createMockSupabase((q) => (q.table === 'user_api_keys' ? { data: corrupt } : { data: null }));
		expect(await credits.keySourceFor(sb, 'u1', 'fal')).toBe('platform');
	});

	it('an unreadable key store is platform, not byo', async () => {
		const sb = createMockSupabase(() => {
			throw new Error('database down');
		});
		expect(await credits.keySourceFor(sb, 'u1', 'fal')).toBe('platform');
	});

	it('uses the cache and only hits the DB once per user+provider', async () => {
		const sb = createMockSupabase(() => ({ data: null }));
		const cache = new Map();
		await credits.keySourceFor(sb, 'u1', 'fal', cache);
		await credits.keySourceFor(sb, 'u1', 'fal', cache);
		expect(sb.of('user_api_keys')).toHaveLength(1);
	});
});

describe('resolveBillingAccount — owner pays', () => {
	const sb = (agent: any, ws?: any) =>
		createMockSupabase((q) => {
			if (q.table === 'agents') return { data: agent };
			if (q.table === 'workspaces') return { data: ws ?? null };
			return { data: null };
		});

	it('no persona → the actor', async () => {
		expect(await credits.resolveBillingAccount(sb(null), null, 'actor')).toBe('actor');
	});

	it('personal persona → its owner, not the acting seat', async () => {
		expect(await credits.resolveBillingAccount(sb({ user_id: 'owner', workspace_id: null }), 'a1', 'seat')).toBe('owner');
	});

	it('workspace persona → the WORKSPACE owner', async () => {
		expect(
			await credits.resolveBillingAccount(sb({ user_id: 'seat-who-created', workspace_id: 'ws' }, { owner_id: 'ws-owner' }), 'a1', 'seat')
		).toBe('ws-owner');
	});

	it('lookup failure → the actor (never nobody)', async () => {
		const bad = createMockSupabase(() => {
			throw new Error('down');
		});
		expect(await credits.resolveBillingAccount(bad, 'a1', 'actor')).toBe('actor');
	});
});

describe('debitForEvents', () => {
	const rows = [
		{ id: 'e1', credits: 8, provider: 'fal', operation: 'image', model: 'nb2', key_source: 'platform' as const },
		{ id: 'e2', credits: 42, provider: 'fal', operation: 'video', model: 'kling', key_source: 'byo' as const },
		{ id: 'e3', credits: 0, provider: 'local', operation: 'image', model: 'card', key_source: 'none' as const }
	];

	it('off → touches nothing', async () => {
		const rpc = vi.fn();
		const out = await credits.debitForEvents({ rpc }, { billedUserId: 'b', actorId: 'a', rows });
		expect(out).toMatchObject({ mode: 'off', attempted: 0, debited: 0 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('shadow → one credit_apply per PLATFORM-paid event, allow-negative, keyed to the event', async () => {
		mockEnv.CREDITS_ENFORCE = 'shadow';
		const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>>(
			async () => ({ data: 92, error: null })
		);
		const out = await credits.debitForEvents({ rpc }, { billedUserId: 'b', actorId: 'a', agentId: 'ag', postId: 'p', rows });
		expect(rpc).toHaveBeenCalledTimes(1);
		const [fnName, fnArgs] = rpc.mock.calls[0];
		expect(fnName).toBe('credit_apply');
		expect(fnArgs).toMatchObject({
			p_user: 'b',
			p_delta: -8,
			p_kind: 'debit',
			p_event: 'e1',
			p_actor: 'a',
			p_agent: 'ag',
			p_post: 'p',
			p_allow_negative: true
		});
		expect(out).toMatchObject({ attempted: 1, debited: 8, failed: [] });
	});

	it('duplicate-event debit counts as already applied (idempotent retry)', async () => {
		mockEnv.CREDITS_ENFORCE = 'enforce';
		const rpc = vi.fn(async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_credit_ledger_debit_per_event"' } }));
		const out = await credits.debitForEvents({ rpc }, { billedUserId: 'b', actorId: 'a', rows });
		expect(out.skippedDuplicate).toBe(1);
		expect(out.failed).toEqual([]);
	});

	it('shadow logs a failed debit; enforce THROWS so the job is marked failed', async () => {
		const rpc = vi.fn(async () => ({ data: null, error: { code: '08006', message: 'connection lost' } }));
		mockEnv.CREDITS_ENFORCE = 'shadow';
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const out = await credits.debitForEvents({ rpc }, { billedUserId: 'b', actorId: 'a', rows });
		expect(out.failed).toHaveLength(1);
		spy.mockRestore();
		mockEnv.CREDITS_ENFORCE = 'enforce';
		await expect(credits.debitForEvents({ rpc }, { billedUserId: 'b', actorId: 'a', rows })).rejects.toThrow(/CREDIT_DEBIT_FAILED/);
	});
});

describe('assertCreditsAvailable — the gate', () => {
	const wallet = (balance: number | null, mode = 'credits', error: any = null) =>
		createMockSupabase(() => (error ? { data: null, error } : { data: balance === null ? null : { balance_credits: balance, billing_mode: mode } }));

	it('off → never reads', async () => {
		const sb = wallet(0);
		const r = await credits.assertCreditsAvailable(sb, 'b', 500);
		expect(r).toEqual({ balance: null, mode: 'off', wouldBlock: false });
		expect(sb.queries).toHaveLength(0);
	});

	it('shadow → reports wouldBlock but never throws', async () => {
		mockEnv.CREDITS_ENFORCE = 'shadow';
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = await credits.assertCreditsAvailable(wallet(10), 'b', 50);
		expect(r).toMatchObject({ balance: 10, wouldBlock: true });
		spy.mockRestore();
	});

	it('enforce → throws INSUFFICIENT_CREDITS below the quote, passes at or above it', async () => {
		mockEnv.CREDITS_ENFORCE = 'enforce';
		await expect(credits.assertCreditsAvailable(wallet(10), 'b', 50)).rejects.toThrow(/Not enough credits/);
		await expect(credits.assertCreditsAvailable(wallet(50), 'b', 50)).resolves.toMatchObject({ wouldBlock: false });
	});

	it('enforce → no wallet row means balance 0 → blocked when a cost is quoted', async () => {
		mockEnv.CREDITS_ENFORCE = 'enforce';
		await expect(credits.assertCreditsAvailable(wallet(null), 'b', 1)).rejects.toThrow(/INSUFFICIENT|Not enough/);
	});

	it('enforce → unmetered accounts always pass', async () => {
		mockEnv.CREDITS_ENFORCE = 'enforce';
		await expect(credits.assertCreditsAvailable(wallet(0, 'unmetered'), 'b', 999)).resolves.toMatchObject({ wouldBlock: false });
	});

	it('enforce → a DB error is a BLOCK, never a pass (fail closed)', async () => {
		mockEnv.CREDITS_ENFORCE = 'enforce';
		await expect(credits.assertCreditsAvailable(wallet(0, 'credits', { message: 'down' }), 'b', 1)).rejects.toThrow(/CREDITS_UNAVAILABLE/);
	});

	it('isCreditsError recognises the gate message for the autopilot hard stop', () => {
		expect(credits.isCreditsError(new credits.InsufficientCreditsError(0, 5))).toBe(true);
		expect(credits.isCreditsError(new Error('Daily generation budget reached'))).toBe(false);
	});
});
