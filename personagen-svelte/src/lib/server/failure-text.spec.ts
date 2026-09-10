/**
 * What a customer is told when a generation fails.
 *
 * The case these exist for, recorded verbatim against a real customer's post on
 * 2026-09-10: the platform's OpenRouter account ran dry, and the reason stored
 * on his post was the vendor's own 402 — "you requested up to 4096 tokens, but
 * can only afford 3709 … visit https://openrouter.ai/settings/credits and
 * upgrade to a paid account". His wallet was full. The account that could not
 * afford it was ours.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyFailure, customerFailureText, rawMessage } from './failure-text';

/** The exact string production stored, so the test is about the real case. */
const REAL_402 =
	'OpenRouter returned HTTP 402: {"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 3709. To increase, visit https://openrouter.ai/settings/credits and upgrade to a paid account","code":402}}';

describe('the leak that started this', () => {
	const out = classifyFailure(REAL_402);

	it('never hands the customer a vendor URL', () => {
		expect(out.customer).not.toMatch(/https?:\/\//);
		expect(out.customer).not.toMatch(/openrouter/i);
	});

	it('does not tell someone with a full wallet that they cannot afford it', () => {
		expect(out.customer).not.toMatch(/can only afford/i);
		expect(out.customer).not.toMatch(/upgrade to a paid/i);
	});

	it('says whose problem it is', () => {
		expect(out.kind).toBe('provider_funding');
		expect(out.onUs).toBe(true);
		expect(out.customer).toMatch(/on us/i);
		expect(out.customer).toMatch(/nothing was taken from your wallet/i);
	});

	it('keeps the original for the operator', () => {
		// The person who has to fix it still needs the vendor's exact words.
		expect(out.internal).toContain('402');
		expect(out.internal).toContain('openrouter.ai/settings/credits');
	});
});

describe('whose key ran out decides who is asked to fix it', () => {
	it("the customer's own key is theirs to fix, and may be named", () => {
		const out = classifyFailure(REAL_402, { ownKey: true });
		expect(out.onUs).toBe(false);
		expect(out.customer).toMatch(/your own generation key/i);
		expect(out.customer).toMatch(/settings/i);
	});

	it('unknown ownership resolves to OURS, never theirs', () => {
		// Misdirecting someone to fix something that was never theirs is the
		// failure mode this defaults against.
		for (const opts of [undefined, {}, { ownKey: false }]) {
			expect(classifyFailure(REAL_402, opts).onUs, JSON.stringify(opts)).toBe(true);
		}
	});
});

describe('the other provider failures', () => {
	it.each([
		['HTTP 401 invalid api key', 'provider_auth', true],
		['429 Too Many Requests', 'rate_limited', true],
		['fetch failed: operation timed out', 'timeout', false],
		['flagged by the content policy', 'content_policy', false]
	])('%s → %s', (msg, kind, onUs) => {
		const out = classifyFailure(msg);
		expect(out.kind).toBe(kind);
		expect(out.onUs).toBe(onUs);
		expect(out.customer).not.toMatch(/https?:\/\//);
	});

	it('an unrecognised provider string is never passed through', () => {
		// The unknown branch is exactly the shape that leaked a vendor URL.
		const out = classifyFailure('Weird upstream babble: see https://vendor.example/billing for details');
		expect(out.kind).toBe('unknown');
		expect(out.customer).not.toMatch(/vendor\.example/);
		expect(out.customer).not.toMatch(/https?:\/\//);
		expect(out.internal).toContain('vendor.example');
	});

	it("our own quality gate is passed through, because it is ours and it is useful", () => {
		const gate = 'Draft quality 4.8/10 below floor 5 after rewrite (the copy reads stiff) — no media generated';
		const out = classifyFailure(gate);
		expect(out.kind).toBe('quality_gate');
		expect(out.customer).toContain('4.8/10');
		expect(out.onUs).toBe(false);
	});
});

describe('rawMessage digs the message out of whatever was thrown', () => {
	it.each([
		[new Error('boom'), 'boom'],
		['plain', 'plain'],
		['{"error":{"message":"nested"}}', 'nested'],
		[{ error: { detail: 'deep' } }, 'deep']
	])('%s', (input, expected) => {
		expect(rawMessage(input)).toBe(expected);
	});

	it('survives junk without throwing', () => {
		for (const v of [null, undefined, 0, [], {}]) expect(() => rawMessage(v)).not.toThrow();
	});
});

describe('the route actually uses it', () => {
	const route = readFileSync(
		new URL('../../routes/api/agent/[agentId]/generate-post/+server.ts', import.meta.url),
		'utf-8'
	);

	it('the file under test was read', () => {
		expect(route.length).toBeGreaterThan(5000);
	});

	it('the failed-post write stores the sanitised text, not the raw error', () => {
		// This row is readable by the post's owner, so whatever is written to it
		// is published to them.
		expect(route).toContain('classifyFailure(genErr');
		expect(route).toContain('error: failure.customer');
		expect(route).not.toMatch(/error: \(genErr as Error\)\.message/);
	});

	it('the raw text still reaches the server log', () => {
		expect(route).toMatch(/PLATFORM-SIDE failure/);
		expect(route).toContain('failure.internal');
	});

	it('it asks whose key ran the call', () => {
		expect(route).toContain('keySourceFor');
		expect(route).toMatch(/ownKey: ranOnOwnKey/);
	});
});
