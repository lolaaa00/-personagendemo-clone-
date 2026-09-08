/**
 * The determinism contract. If any of this breaks, every stored persona's
 * re-roll changes meaning, so these are pinned rather than sampled.
 */
import { describe, it, expect } from 'vitest';
import { rng, seedHash } from './rng';

describe('determinism', () => {
	it('the same seed produces the same sequence', () => {
		const a = rng('jenny-tran');
		const b = rng('jenny-tran');
		const seqA = Array.from({ length: 20 }, () => a.next());
		const seqB = Array.from({ length: 20 }, () => b.next());
		expect(seqA).toEqual(seqB);
	});

	it('different seeds diverge', () => {
		const a = Array.from({ length: 10 }, (_, i) => rng(`seed-${i}`).next());
		expect(new Set(a).size).toBe(a.length);
	});

	it('is stable across runtimes — pinned values, not just self-consistency', () => {
		// A change here means every existing persona re-rolls differently.
		expect(seedHash('')).toBe(2166136261);
		expect(rng('persona').next().toFixed(12)).toBe(rng('persona').next().toFixed(12));
		const r = rng('pinned');
		expect([r.next(), r.next(), r.next()].map((n) => n.toFixed(6))).toMatchSnapshot();
	});

	it('never returns 0 state for an empty or falsy-hashing seed', () => {
		expect(() => rng('').next()).not.toThrow();
		expect(rng('').next()).toBeGreaterThanOrEqual(0);
	});
});

describe('fork — insulation between fields', () => {
	it('a fork is deterministic and differs from its parent and from other labels', () => {
		const parent = rng('p');
		expect(parent.fork('age').next()).toBe(rng('p').fork('age').next());
		expect(parent.fork('age').next()).not.toBe(parent.fork('work').next());
	});

	it('draws taken from one fork do not shift another fork', () => {
		// This is the property that lets the sampler grow: adding a draw to the
		// work step must not re-roll everyone's hair colour.
		const before = rng('p').fork('hair').next();
		const work = rng('p').fork('work');
		work.next();
		work.next();
		work.next();
		expect(rng('p').fork('hair').next()).toBe(before);
	});
});

describe('helpers', () => {
	it('int is inclusive on both ends and never leaves the range', () => {
		const r = rng('ints');
		const seen = new Set<number>();
		for (let i = 0; i < 500; i++) {
			const n = r.int(1, 5);
			expect(n).toBeGreaterThanOrEqual(1);
			expect(n).toBeLessThanOrEqual(5);
			seen.add(n);
		}
		expect(seen).toEqual(new Set([1, 2, 3, 4, 5]));
		expect(r.int(7, 7)).toBe(7);
		expect(r.int(9, 3)).toBe(9); // inverted range degrades to lo, never NaN
	});

	it('pick throws on an empty list rather than returning undefined', () => {
		expect(() => rng('x').pick([])).toThrow(/empty list/);
	});

	it('weighted respects weights within tolerance over 10k draws', () => {
		const r = rng('w');
		const items = [
			{ k: 'a', w: 70 },
			{ k: 'b', w: 20 },
			{ k: 'c', w: 10 }
		];
		const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
		for (let i = 0; i < 10000; i++) counts[r.weighted(items, (i2) => i2.w).k]++;
		expect(counts.a / 10000).toBeCloseTo(0.7, 1);
		expect(counts.b / 10000).toBeCloseTo(0.2, 1);
		expect(counts.c / 10000).toBeCloseTo(0.1, 1);
	});

	it('weighted skips non-positive weights and survives an all-zero table', () => {
		const r = rng('w2');
		const items = [
			{ k: 'gated-out', w: 0 },
			{ k: 'live', w: 5 }
		];
		for (let i = 0; i < 200; i++) expect(r.weighted(items, (i2) => i2.w).k).toBe('live');
		expect(r.weighted([{ k: 'only', w: 0 }], (i2) => i2.w).k).toBe('only');
	});

	it('gauss centres on the mean and honours clamps', () => {
		const r = rng('g');
		const xs = Array.from({ length: 2000 }, () => r.gauss(50, 15, 0, 100));
		const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
		expect(mean).toBeGreaterThan(44);
		expect(mean).toBeLessThan(56);
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...xs)).toBeLessThanOrEqual(100);
		expect(xs.every(Number.isInteger)).toBe(true);
	});

	it('chance is bounded and roughly calibrated', () => {
		const r = rng('c');
		expect(r.chance(0)).toBe(false);
		expect(r.chance(1)).toBe(true);
		let hits = 0;
		for (let i = 0; i < 2000; i++) if (r.chance(0.25)) hits++;
		expect(hits / 2000).toBeCloseTo(0.25, 1);
	});
});
