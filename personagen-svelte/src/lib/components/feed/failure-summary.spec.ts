/**
 * What a failed tile says. Round-2 re-audit: every tile showed a generic
 * "didn't finish" because the server's own safe sentence was re-classified
 * away, and a provider 402 was blamed on the customer's balance. These pin
 * both rules — and the word-boundary regexes, which once shipped as literal
 * backspace characters and matched nothing while every other test passed.
 */
import { describe, it, expect } from 'vitest';
import { summarizeGenError, isCustomerSafeFailureText } from './postDisplay';

const failed = (error: string) => ({ content: JSON.stringify({ error }) });

describe('summarizeGenError', () => {
	it('shows the server’s customer-safe sentence as written', () => {
		const text = 'Image provider returned 503 — the model was busy. Nothing was taken from your wallet.';
		expect(summarizeGenError(failed(text))).toBe(text);
	});

	it('never shows raw provider text (links, JSON, vendor names)', () => {
		const raw =
			'OpenRouter returned HTTP 402: {"error":{"message":"requires more credits. To increase, visit https://openrouter.ai/settings/credits"}}';
		const out = summarizeGenError(failed(raw));
		expect(out).not.toMatch(/openrouter|https?:|\{/i);
	});

	it('a provider 402 is ON US — a failed post is never the customer wallet', () => {
		expect(summarizeGenError(failed('HTTP 402 Payment Required'))).toMatch(/on our side|on us/i);
		expect(summarizeGenError(failed('HTTP 402 Payment Required'))).not.toMatch(/your balance/i);
	});

	it('classifies the word-boundary cases (429, 401/403)', () => {
		expect(summarizeGenError(failed('status 429 from upstream'))).toMatch(/rate-limiting/i);
		expect(summarizeGenError(failed('upstream said 401 unauthorized'))).toMatch(/key was rejected/i);
	});

	it('falls back to a generic line that names a real way to report it', () => {
		expect(summarizeGenError({ content: '{}' })).toMatch(/Report this problem/);
	});
});

describe('isCustomerSafeFailureText', () => {
	it('accepts a sentence and rejects vendor names on word boundaries', () => {
		expect(isCustomerSafeFailureText('The model took too long and the run was stopped. Try again.')).toBe(true);
		expect(isCustomerSafeFailureText('Fal returned an error for this request.')).toBe(false);
		expect(isCustomerSafeFailureText('Your sk-abc123 key was rejected by the provider.')).toBe(false);
	});
});
