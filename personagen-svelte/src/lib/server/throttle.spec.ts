import { describe, it, expect } from 'vitest';
import { Throttle } from './throttle';

describe('Throttle — fixed window per key', () => {
	it('allows up to the limit, then refuses with a Retry-After, then resets', () => {
		const t = new Throttle(3, 60_000);
		const t0 = 1_000_000;
		expect(t.check('a', t0).allowed).toBe(true);
		expect(t.check('a', t0 + 1).allowed).toBe(true);
		expect(t.check('a', t0 + 2).allowed).toBe(true);
		const refused = t.check('a', t0 + 3);
		expect(refused.allowed).toBe(false);
		expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(59);
		expect(t.check('b', t0 + 3).allowed).toBe(true); // other keys unaffected
		expect(t.check('a', t0 + 60_001).allowed).toBe(true); // window rolled
	});

	it('bounds the number of tracked keys', () => {
		const t = new Throttle(1, 60_000, 5);
		for (let i = 0; i < 20; i++) t.check(`k${i}`, 1);
		expect(t.check('k0', 2).allowed).toBe(true); // map was cleared, k0 starts fresh
	});
});
