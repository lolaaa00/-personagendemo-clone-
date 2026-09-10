/**
 * THE PROVIDER BALANCE — a check that must be able to report "I don't know".
 *
 * The OpenRouter account was measured at $2.78 on 2026-09-10 and nothing in the
 * codebase was watching it; an operator learned about it from a failed customer
 * post. A balance watcher only earns its place if it cannot lie, and there are
 * exactly two ways this one could:
 *
 *   1. reporting `ok` when the probe failed, timed out, returned junk, or had no
 *      key to use — "we could not read it" is not "it is funded";
 *   2. leaking the dollar figure through the UNAUTHENTICATED health route, which
 *      would publish both the burn rate and the fact that we are one post away
 *      from failing.
 *
 * Plus a third, structural: the health check must not be able to answer 503. An
 * empty provider account is an operator action, not a reason to drop out of a
 * load balancer while everything unpaid still works.
 *
 * The source-text cases below assert the file was actually read before asserting
 * anything about its contents — an empty read passes every "does not contain"
 * case vacuously, which is the exact failure mode these tests exist to catch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const pb = await import('./provider-balance');

// ── stubs ────────────────────────────────────────────────────────────────────

/** A stub fetch that answers with a body, and counts how often it was called. */
function stubJson(body: unknown, status = 200) {
	const calls: string[] = [];
	const impl = (async (url: string) => {
		calls.push(String(url));
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	}) as unknown as typeof fetch;
	return { calls, impl };
}

/** A stub fetch that fails the way a real failure fails. */
function stubThrows(err: Error) {
	const calls: string[] = [];
	const impl = (async (url: string) => {
		calls.push(String(url));
		throw err;
	}) as unknown as typeof fetch;
	return { calls, impl };
}

/** A stub fetch that returns a 200 whose body is not JSON at all. */
function stubGarbage() {
	const calls: string[] = [];
	const impl = (async (url: string) => {
		calls.push(String(url));
		return new Response('<html>upstream proxy error</html>', { status: 200 });
	}) as unknown as typeof fetch;
	return { calls, impl };
}

/** A funded account, comfortably above the low threshold. */
const FUNDED = { data: { total_credits: 800, total_usage: 100 } };
/** Production on 2026-09-10, to the digit. */
const PRODUCTION_TODAY = { data: { total_credits: 643.6161932, total_usage: 640.836680376 } };

let savedKey: string | undefined;

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	savedKey = process.env.OPENROUTER_API_KEY;
	delete process.env.OPENROUTER_API_KEY;
	mockEnv.OPENROUTER_API_KEY = 'sk-test-key';
	pb._resetProviderBalanceForTests();
});

afterEach(() => {
	if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
	else process.env.OPENROUTER_API_KEY = savedKey;
});

// ── the three states ─────────────────────────────────────────────────────────

describe('three states: ok, low, unknown', () => {
	it('before any probe it is unknown, with a reason and no number', () => {
		const b = pb.providerBalanceStatus();
		expect(b.state).toBe('unknown');
		expect(b.remainingUsd).toBeNull();
		expect(b.note).toBeTruthy();
		expect(b.checkedAt).toBeNull();
	});

	it('a funded account reads ok and reports the arithmetic', async () => {
		const b = await pb.refreshProviderBalance(true, stubJson(FUNDED).impl);
		expect(b.state).toBe('ok');
		expect(b.remainingUsd).toBe(700);
		expect(b.totalCreditsUsd).toBe(800);
		expect(b.totalUsageUsd).toBe(100);
		expect(b.note).toBeNull();
		expect(b.checkedAt).not.toBeNull();
	});

	it("production's own numbers read low, and count posts not dollars", async () => {
		const b = await pb.refreshProviderBalance(true, stubJson(PRODUCTION_TODAY).impl);
		expect(b.state).toBe('low');
		expect(b.remainingUsd).toBeCloseTo(2.7795, 4);
		// $2.78 / $0.352 per video post, $2.78 / $0.022 per image post.
		expect(b.postsRemaining).toBe(7);
		expect(b.imagePostsRemaining).toBe(126);
	});

	it('the threshold is derived from post cost, not from a round dollar number', () => {
		// 70 worst-case posts at $0.352 — a day of autopilot for ~20 personas even
		// if every post took the most expensive route.
		expect(pb.LOW_BALANCE_USD).toBeCloseTo(24.64, 2);
		expect(pb.EMPTY_BALANCE_USD).toBeCloseTo(0.352, 3);
		expect(pb.CALL_COST_USD.openrouterVideo).toBe(0.35);
	});

	it('the boundary is exclusive: exactly the threshold is still ok', async () => {
		const at = await pb.refreshProviderBalance(
			true,
			stubJson({ data: { total_credits: pb.LOW_BALANCE_USD, total_usage: 0 } }).impl
		);
		expect(at.state).toBe('ok');
		pb._resetProviderBalanceForTests();
		const below = await pb.refreshProviderBalance(
			true,
			stubJson({ data: { total_credits: pb.LOW_BALANCE_USD - 0.01, total_usage: 0 } }).impl
		);
		expect(below.state).toBe('low');
	});
});

// ── fail-safe direction ──────────────────────────────────────────────────────

describe('a probe that cannot answer reads unknown — never ok', () => {
	const failures: Array<[string, () => typeof fetch]> = [
		['a network error', () => stubThrows(new Error('ECONNREFUSED')).impl],
		[
			'a timeout',
			() => stubThrows(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })).impl
		],
		['HTTP 401 (a revoked key)', () => stubJson({ error: 'no auth' }, 401).impl],
		['HTTP 500', () => stubJson({}, 500).impl],
		['a body that is not JSON', () => stubGarbage().impl],
		['a JSON body with no data envelope', () => stubJson({ ok: true }).impl],
		[
			'a data envelope with non-numeric fields',
			() => stubJson({ data: { total_credits: 'lots', total_usage: null } }).impl
		]
	];

	it.each(failures)('%s → unknown, with a reason', async (_label, make) => {
		const b = await pb.refreshProviderBalance(true, make());
		expect(b.state).toBe('unknown');
		expect(b.state).not.toBe('ok');
		expect(b.remainingUsd).toBeNull();
		expect(b.note).toBeTruthy();
	});

	it('no key configured → unknown that names the missing key, never ok', async () => {
		delete mockEnv.OPENROUTER_API_KEY;
		const s = stubJson(FUNDED);
		const b = await pb.refreshProviderBalance(true, s.impl);
		expect(b.state).toBe('unknown');
		expect(b.note).toMatch(/OPENROUTER_API_KEY/);
		// and it did not go to the network to find that out
		expect(s.calls).toEqual([]);
	});

	it('a stale ok is DISCARDED when the re-probe fails — "it was fine before" is not a measurement', async () => {
		const good = await pb.refreshProviderBalance(true, stubJson(FUNDED).impl);
		expect(good.state).toBe('ok');
		const after = await pb.refreshProviderBalance(true, stubThrows(new Error('provider down')).impl);
		expect(after.state).toBe('unknown');
		expect(after.remainingUsd).toBeNull();
		expect(after.totalCreditsUsd).toBeNull();
	});

	it('unknown is not folded into low either — it is its own state', async () => {
		const b = await pb.refreshProviderBalance(true, stubThrows(new Error('nope')).impl);
		expect(b.state).toBe('unknown');
		expect(b.state).not.toBe('low');
		expect(b.postsRemaining).toBeNull();
	});
});

// ── caching, single-flight, timeout ──────────────────────────────────────────

describe('the probe is cached, single-flight and time-bounded', () => {
	it('a second read inside the TTL does not hit the provider again', async () => {
		const s = stubJson(FUNDED);
		await pb.refreshProviderBalance(true, s.impl);
		await pb.refreshProviderBalance(false, s.impl);
		await pb.refreshProviderBalance(false, s.impl);
		expect(s.calls).toHaveLength(1);
	});

	it('force bypasses the TTL', async () => {
		const s = stubJson(FUNDED);
		await pb.refreshProviderBalance(true, s.impl);
		await pb.refreshProviderBalance(true, s.impl);
		expect(s.calls).toHaveLength(2);
	});

	it('concurrent refreshes share one in-flight probe', async () => {
		const s = stubJson(FUNDED);
		const [a, b] = await Promise.all([
			pb.refreshProviderBalance(true, s.impl),
			pb.refreshProviderBalance(true, s.impl)
		]);
		expect(s.calls).toHaveLength(1);
		expect(a.state).toBe('ok');
		expect(b.state).toBe('ok');
	});

	it('the probe carries an abort signal, so a hung provider cannot become our latency', async () => {
		let init: RequestInit | undefined;
		const impl = (async (_url: string, i: RequestInit) => {
			init = i;
			return new Response(JSON.stringify(FUNDED), { status: 200 });
		}) as unknown as typeof fetch;
		await pb.refreshProviderBalance(true, impl);
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(init?.method).toBe('GET');
	});

	it('it never throws, whatever the provider does', async () => {
		await expect(
			pb.refreshProviderBalance(true, stubThrows(new Error('boom')).impl)
		).resolves.toMatchObject({ state: 'unknown' });
	});
});

// ── the public summary must never carry a number ─────────────────────────────

describe('the public summary is a word, never a figure', () => {
	it.each([
		['ok', FUNDED],
		['low', PRODUCTION_TODAY]
	])('%s: the summary carries no dollars and no digits', async (expected, body) => {
		await pb.refreshProviderBalance(true, stubJson(body).impl);
		const word = pb.providerBalanceSummary();
		expect(word).toBe(expected);
		expect(word).not.toMatch(/\$|\d/);
	});

	it('unknown: the summary carries no dollars, no digits, and no reason text', async () => {
		await pb.refreshProviderBalance(true, stubThrows(new Error('ECONNREFUSED 1.2.3.4')).impl);
		const word = pb.providerBalanceSummary();
		expect(word).toBe('unknown');
		expect(word).not.toMatch(/\$|\d/);
		expect(word).not.toMatch(/ECONNREFUSED/);
	});
});

// ── the clean refusal ────────────────────────────────────────────────────────

describe('providerSpendBlock — refuse before spending, not after', () => {
	it('a funded account does not block', async () => {
		await pb.refreshProviderBalance(true, stubJson(FUNDED).impl);
		expect(pb.providerSpendBlock()).toBeNull();
	});

	it('low but still able to fund a call does not block — low is a warning, not a stop', async () => {
		await pb.refreshProviderBalance(true, stubJson(PRODUCTION_TODAY).impl);
		expect(pb.providerBalanceStatus().state).toBe('low');
		expect(pb.providerSpendBlock()).toBeNull();
	});

	it('below the cost of one call it blocks, and says it is a top-up not a bug', async () => {
		await pb.refreshProviderBalance(
			true,
			stubJson({ data: { total_credits: 100.21, total_usage: 100 } }).impl
		);
		const reason = pb.providerSpendBlock();
		expect(reason).toMatch(/\$0\.21/);
		expect(reason).toMatch(/Top up/i);
		expect(reason).toMatch(/not a bug/i);
	});

	it('unknown does not block by default — a hiccup must not take generation down', async () => {
		await pb.refreshProviderBalance(true, stubThrows(new Error('timeout')).impl);
		expect(pb.providerSpendBlock()).toBeNull();
	});

	it('unknown blocks when the caller asks it to, and says why', async () => {
		await pb.refreshProviderBalance(true, stubThrows(new Error('timeout')).impl);
		expect(pb.providerSpendBlock({ blockOnUnknown: true })).toMatch(/could not be read/i);
	});
});

// ── structural: what the two routes are allowed to publish ───────────────────

describe('the health route: coarse, and unable to answer 503', () => {
	const src = readFileSync(new URL('../../routes/api/health/+server.ts', import.meta.url), 'utf-8');

	it('the file was actually read — an empty read would pass every case below vacuously', () => {
		expect(src.length).toBeGreaterThan(1000);
		expect(src).toContain('export const GET');
		expect(src).toContain('let healthy = true');
	});

	it('publishes a provider_balance check', () => {
		expect(src).toContain('checks.provider_balance');
	});

	it('publishes only the coarse word — no dollar figure on an unauthenticated route', () => {
		const line = src.split('\n').find((l) => l.includes('checks.provider_balance ='));
		expect(line).toBeTruthy();
		expect(line).toContain('providerBalanceSummary()');
		expect(line).not.toContain('remainingUsd');
		expect(line).not.toContain('$');
	});

	it('does not block the response on the probe', () => {
		expect(src).toContain('void refreshProviderBalance()');
	});

	it('is NOT part of `healthy` — an empty provider account is not a 503', () => {
		// Every 503 trigger lives in the config/supabase block, upstream of every
		// other check. Nothing after it may set healthy at all.
		const afterConfigBlock = src.slice(src.indexOf('checks.ai'));
		expect(src.indexOf('checks.ai')).toBeGreaterThan(0);
		expect(afterConfigBlock).not.toContain('healthy = false');
		const afterProvider = src.slice(src.indexOf('checks.provider_balance'));
		expect(afterProvider).not.toContain('healthy =');
	});
});

describe('the admin route: the number belongs here, and the switches slice is untouched', () => {
	const src = readFileSync(
		new URL('../../routes/api/admin/settings/+server.ts', import.meta.url),
		'utf-8'
	);

	it('the file was actually read — an empty read would pass every case below vacuously', () => {
		expect(src.length).toBeGreaterThan(1000);
		expect(src).toContain('export const GET');
	});

	it('returns the full balance to a platform admin', () => {
		expect(src).toContain('providerBalance: await refreshProviderBalance()');
	});

	it('sits OUTSIDE the switches slice settings.spec.ts reads as text', () => {
		// settings.spec.ts slices between these two markers and asserts every
		// SETTING_KEY appears inside. Both markers must survive, and the balance
		// must not be inside the slice (it is not a setting).
		const start = src.indexOf('switches: {');
		const end = src.indexOf('cache: settingsStatus()');
		expect(start).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(start);
		expect(src.slice(start, end)).not.toContain('providerBalance');
	});
});
