/**
 * Fixed-window per-key throttle for paid or abusable endpoints (checkout
 * session creation, voice previews). In-process by design: one container runs
 * the app, and the goal is to stop a held-down button or a script from running
 * up a bill — not to be a distributed rate limiter. Bounded key count so a
 * flood of distinct keys cannot grow memory without limit.
 */
export interface ThrottleResult {
	allowed: boolean;
	remaining: number;
	/** Seconds until the window resets — suitable for a Retry-After header. */
	retryAfterSeconds: number;
}

export class Throttle {
	readonly #limit: number;
	readonly #windowMs: number;
	readonly #maxKeys: number;
	readonly #windows = new Map<string, { count: number; resetAt: number }>();

	constructor(limit: number, windowMs: number, maxKeys = 10_000) {
		this.#limit = limit;
		this.#windowMs = windowMs;
		this.#maxKeys = maxKeys;
	}

	check(key: string, now: number = Date.now()): ThrottleResult {
		if (this.#windows.size > this.#maxKeys) {
			for (const [k, w] of this.#windows) if (w.resetAt <= now) this.#windows.delete(k);
			if (this.#windows.size > this.#maxKeys) this.#windows.clear();
		}
		const w = this.#windows.get(key);
		if (!w || w.resetAt <= now) {
			this.#windows.set(key, { count: 1, resetAt: now + this.#windowMs });
			return { allowed: true, remaining: this.#limit - 1, retryAfterSeconds: 0 };
		}
		w.count += 1;
		if (w.count > this.#limit) {
			return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
		}
		return { allowed: true, remaining: this.#limit - w.count, retryAfterSeconds: 0 };
	}

	reset(key: string): void {
		this.#windows.delete(key);
	}
}
