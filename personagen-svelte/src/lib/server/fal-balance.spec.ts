/**
 * The fal balance watch, and the platform key inventory.
 *
 * The OpenRouter watcher shipped on 2026-09-10 after the account ran dry during
 * a customer's post. It watched the CHEAP provider: measured across all of
 * production, fal is $0.130 per event against OpenRouter's $0.031 — 4.2x, and
 * 43% of every dollar ever spent on 15% of the events. The expensive account
 * was the unwatched one for eleven days.
 *
 * Two things make it worse than the original gap:
 *
 *   1. Customer BYOK was withdrawn on 2026-09-21, so every generation for every
 *      customer now runs on our keys. Nothing absorbs part of the load.
 *   2. fal does not degrade. Its own documentation says the account is LOCKED
 *      and requests rejected once the balance passes the lock threshold, so a
 *      missed fal balance is a total media outage, not a slow decline.
 *
 * The same rule as the OpenRouter file applies and is tested the same way: this
 * watcher may not lie, in either direction. `unknown` is never `ok`, and a
 * provider nobody has configured is neither.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const pb = await import('./provider-balance');

/** A stub fetch that answers with a body and records what it was asked. */
function stubJson(body: unknown, status = 200) {
	const calls: Array<{ url: string; headers: Record<string, string> }> = [];
	const impl = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	}) as unknown as typeof fetch;
	return { calls, impl };
}

function stubThrows(err: Error) {
	const calls: string[] = [];
	const impl = (async (url: string) => {
		calls.push(String(url));
		throw err;
	}) as unknown as typeof fetch;
	return { calls, impl };
}

/** What fal's documented response looks like. */
const funded = { username: 'acme', credits: { current_balance: 250.5, currency: 'USD' } };
const nearlyOut = { username: 'acme', credits: { current_balance: 4.2, currency: 'USD' } };

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	// The OpenRouter probe short-circuits to 'unknown' without a key, which would
	// make every cross-provider assertion below pass or fail for the wrong
	// reason. fal's key is set per-describe, because its absence is under test.
	mockEnv.OPENROUTER_API_KEY = 'sk-or-test';
	pb._resetProviderBalanceForTests();
});

describe('an unconfigured fal is not a healthy fal', () => {
	it('reports unconfigured, not ok and not unknown', () => {
		const b = pb.falBalanceStatus();
		expect(b.state).toBe('unconfigured');
		expect(b.remainingUsd).toBeNull();
	});

	it('says exactly what to do about it, including the scope that is required', () => {
		// The measured failure this note exists for: the production FAL_API_KEY
		// answers /account/billing with 403. An operator who pastes that key in
		// gets 'unknown' forever and no clue why, so the fix is spelled out.
		const note = pb.falBalanceStatus().note ?? '';
		expect(note).toMatch(/FAL_ADMIN_API_KEY/);
		expect(note).toMatch(/ADMIN/);
	});

	it('never probes without a key — an unconfigured provider costs no request', async () => {
		const s = stubJson(funded);
		await pb.refreshFalBalance(true, s.impl);
		expect(s.calls).toHaveLength(0);
	});

	it('does NOT drag the public health word down', async () => {
		// Deliberate, and the one concession to "absent reads as fine" here:
		// degrading health for an account the operator has not opted into
		// watching trains them to ignore the signal. The Admin Console shows
		// 'unconfigured' on its own.
		await pb.refreshProviderBalance(true, stubJson({ data: { total_credits: 500, total_usage: 1 } }).impl);
		expect(pb.providerBalanceSummary()).toBe('ok');
	});
});

describe('a configured fal is measured', () => {
	beforeEach(() => {
		mockEnv.FAL_ADMIN_API_KEY = 'fal-admin-key';
	});

	it('reads credits.current_balance from the documented shape', async () => {
		const b = await pb.refreshFalBalance(true, stubJson(funded).impl);
		expect(b.state).toBe('ok');
		expect(b.remainingUsd).toBe(250.5);
		expect(b.currency).toBe('USD');
	});

	it('authenticates the way fal does — Key, not Bearer', async () => {
		// A Bearer header here fails with 401 and would look like a bad key.
		const s = stubJson(funded);
		await pb.refreshFalBalance(true, s.impl);
		expect(s.calls[0].url).toContain('/v1/account/billing');
		expect(s.calls[0].url).toContain('expand=credits');
		expect(s.calls[0].headers.Authorization).toBe('Key fal-admin-key');
	});

	it('never sends the key anywhere but the balance endpoint', async () => {
		const s = stubJson(funded);
		await pb.refreshFalBalance(true, s.impl);
		expect(s.calls).toHaveLength(1);
		expect(s.calls[0].url.startsWith('https://api.fal.ai/')).toBe(true);
	});

	it('turns dollars into the unit an operator can act on', async () => {
		const b = await pb.refreshFalBalance(true, stubJson(funded).impl);
		// $250.50 at $0.667 a talking head, $0.078 an image.
		expect(b.postsRemaining).toBe(375);
		expect(b.imagePostsRemaining).toBe(3211);
	});

	it('goes low with enough warning to act — 70 worst-case posts', async () => {
		const b = await pb.refreshFalBalance(true, stubJson(nearlyOut).impl);
		expect(b.state).toBe('low');
		expect(b.lowThresholdUsd).toBeCloseTo(46.69, 2);
	});

	it('a low fal degrades the public health word, without publishing a figure', async () => {
		await pb.refreshProviderBalance(true, stubJson({ data: { total_credits: 500, total_usage: 1 } }).impl);
		await pb.refreshFalBalance(true, stubJson(nearlyOut).impl);
		const word = pb.providerBalanceSummary();
		expect(word).toBe('low');
		expect(word).not.toMatch(/\$|\d/);
	});
});

describe('a fal that cannot be read says so, and never reads as funded', () => {
	beforeEach(() => {
		mockEnv.FAL_ADMIN_API_KEY = 'fal-admin-key';
	});

	it('names the 403 as a key SCOPE problem, not a network fault', async () => {
		// This is the exact response the production key gives. Without naming it
		// an operator goes looking for an outage that is not there.
		const b = await pb.refreshFalBalance(true, stubJson({ error: { type: 'authorization_error' } }, 403).impl);
		expect(b.state).toBe('unknown');
		expect(b.note).toMatch(/ADMIN/);
		expect(b.note).toMatch(/403/);
	});

	it('a thrown probe is unknown with the reason, never ok', async () => {
		const b = await pb.refreshFalBalance(true, stubThrows(new Error('ECONNREFUSED')).impl);
		expect(b.state).toBe('unknown');
		expect(b.note).toMatch(/ECONNREFUSED/);
		expect(b.remainingUsd).toBeNull();
	});

	it('a 200 with the wrong shape is unknown, not zero', async () => {
		// Zero would read as "empty account" and send someone to top up a funded
		// one; it is a parse failure and must say so.
		const b = await pb.refreshFalBalance(true, stubJson({ username: 'acme' }).impl);
		expect(b.state).toBe('unknown');
		expect(b.remainingUsd).toBeNull();
		expect(b.note).toMatch(/current_balance/);
	});

	it('discards a previously good reading rather than keeping it', async () => {
		// "It was fine five minutes ago" is not a measurement.
		await pb.refreshFalBalance(true, stubJson(funded).impl);
		expect(pb.falBalanceStatus().remainingUsd).toBe(250.5);
		await pb.refreshFalBalance(true, stubThrows(new Error('timeout')).impl);
		expect(pb.falBalanceStatus().remainingUsd).toBeNull();
		expect(pb.falBalanceStatus().state).toBe('unknown');
	});
});

describe('the two accounts are watched independently', () => {
	it('a funded OpenRouter never speaks for fal', async () => {
		mockEnv.FAL_ADMIN_API_KEY = 'fal-admin-key';
		await pb.refreshProviderBalance(true, stubJson({ data: { total_credits: 500, total_usage: 1 } }).impl);
		await pb.refreshFalBalance(true, stubThrows(new Error('down')).impl);
		expect(pb.providerBalanceStatus().state).toBe('ok');
		expect(pb.falBalanceStatus().state).toBe('unknown');
		// Worst state wins for the coarse word.
		expect(pb.providerBalanceSummary()).toBe('unknown');
	});

	it('fal thresholds are its own, not OpenRouter’s', () => {
		// Sharing a threshold between a $0.35 call and a $0.667 one would warn
		// too late on one of them.
		expect(pb.FAL_EMPTY_BALANCE_USD).toBeGreaterThan(pb.EMPTY_BALANCE_USD);
		expect(pb.FAL_LOW_BALANCE_USD).toBeGreaterThan(pb.LOW_BALANCE_USD);
	});
});
