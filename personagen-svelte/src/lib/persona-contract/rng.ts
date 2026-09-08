/**
 * Persona Model v2 — the seeded random source.
 *
 * Everything the sampler draws comes from here, so a persona is a pure function
 * of (seed, constraints, registry version). Same seed, same person, forever —
 * which is what makes a persona reproducible, a per-field re-roll explainable,
 * and the sampler testable with golden snapshots instead of statistics.
 *
 * mulberry32 over a 32-bit string hash: tiny, dependency-free, and deterministic
 * across platforms and Node versions (no Math.random, no crypto, no locale). It
 * is NOT cryptographic and must never be used where unpredictability matters.
 *
 * Client-safe.
 */

/** FNV-1a-ish 32-bit hash of a string. Stable across runtimes. */
export function seedHash(seed: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

export interface Rng {
	/** Uniform float in [0, 1). */
	next(): number;
	/** Integer in [lo, hi] inclusive. */
	int(lo: number, hi: number): number;
	/** Uniform pick. Throws on an empty list — an empty table is a registry bug, not a runtime case. */
	pick<T>(items: readonly T[]): T;
	/** Weighted pick; non-positive weights are skipped. Falls back to the first item if all weights are 0. */
	weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
	/** Normal-ish draw (sum of 3 uniforms), clamped, rounded. */
	gauss(mean: number, sd: number, lo?: number, hi?: number): number;
	/** True with probability p. */
	chance(p: number): boolean;
	/** A derived generator for a sub-decision, so adding a draw in one place cannot shift every later draw. */
	fork(label: string): Rng;
}

/**
 * Deterministic generator for `seed`.
 *
 * `fork(label)` is the important part: the sampler forks a child per field
 * rather than pulling from one stream. Without it, inserting a single draw in
 * the middle of the sampler would change every field after it, so any registry
 * or ordering change would silently re-roll unrelated attributes of every
 * existing persona.
 */
export function rng(seed: string): Rng {
	let state = seedHash(seed) || 1;
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const api: Rng = {
		next,
		int: (lo, hi) => (hi <= lo ? lo : lo + Math.floor(next() * (hi - lo + 1))),
		pick: (items) => {
			if (!items.length) throw new Error('rng.pick called with an empty list');
			return items[Math.floor(next() * items.length)];
		},
		weighted: (items, weightOf) => {
			if (!items.length) throw new Error('rng.weighted called with an empty list');
			let total = 0;
			for (const it of items) {
				const w = weightOf(it);
				if (w > 0) total += w;
			}
			if (total <= 0) return items[0];
			let roll = next() * total;
			for (const it of items) {
				const w = weightOf(it);
				if (w <= 0) continue;
				roll -= w;
				if (roll <= 0) return it;
			}
			return items[items.length - 1];
		},
		gauss: (mean, sd, lo = -Infinity, hi = Infinity) => {
			const u = (next() + next() + next()) / 3; // mean 0.5, sd ≈ 0.1667
			const v = mean + (u - 0.5) * 6 * sd * 0.577;
			return Math.round(Math.min(hi, Math.max(lo, v)));
		},
		chance: (p) => next() < p,
		fork: (label) => rng(`${seed}::${label}`)
	};
	return api;
}
