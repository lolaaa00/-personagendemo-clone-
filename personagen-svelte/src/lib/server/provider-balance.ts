/**
 * Provider balance — how much money is left in the account that pays for
 * generation, measured rather than assumed.
 *
 * Nothing in this codebase watched this until now. The OpenRouter account was
 * measured at $2.78 on 2026-09-10 (total_credits 643.6161932, total_usage
 * 640.836680376) and it had already cost a real customer a generation that
 * morning. The operator's first signal was a failed customer post — the balance
 * is knowable in one unauthenticated-to-us GET, so it should be a banner in the
 * Admin Console hours earlier instead.
 *
 * It is a MEASURED FACT about an external account, not an operator switch, so
 * it lives here with a cached probe and a synchronous status getter — the shape
 * `admission.ts` uses, for the same reason.
 *
 * Fail-safe direction, and it is the opposite of the obvious one:
 *
 *   - unknown must NOT read as healthy. A balance we could not read is not a
 *     funded account; "ok" here is a claim we have no evidence for, and the
 *     whole point of the file is to stop a silent zero.
 *   - unknown must NOT read as empty either. Crying wolf every time OpenRouter's
 *     credits endpoint hiccups trains an operator to ignore the banner, which
 *     costs exactly as much as never showing it.
 *
 * So there are three states — `ok`, `low`, `unknown` — and a failed, timed-out,
 * unparseable or unconfigured probe lands in `unknown` **with a reason**, never
 * in `ok`. A stale successful reading is discarded on a failed re-probe rather
 * than kept: "it was fine five minutes ago" is not a measurement.
 */

import { env } from '$env/dynamic/private';

export type BalanceState = 'ok' | 'low' | 'unknown';

export interface ProviderBalance {
	provider: 'openrouter';
	state: BalanceState;
	/** Dollars left in the account. Always null when state is 'unknown'. */
	remainingUsd: number | null;
	/** Lifetime credits purchased / lifetime spend, as the provider reports them. */
	totalCreditsUsd: number | null;
	totalUsageUsd: number | null;
	/** Pessimistic post count: how many more VIDEO posts this funds. */
	postsRemaining: number | null;
	/** Optimistic post count: how many more IMAGE posts this funds. */
	imagePostsRemaining: number | null;
	/** The balance at which state flips to 'low'. */
	lowThresholdUsd: number;
	/** Below this the most expensive single call on this account cannot run at all. */
	emptyThresholdUsd: number;
	checkedAt: string | null;
	/** Why the state is 'unknown', when it is. */
	note: string | null;
}

/**
 * Per-call provider costs measured in production on 2026-09-10. Only the
 * OpenRouter rows draw on the balance this file probes; the fal rows are here
 * so nobody re-derives the post economics from memory.
 */
export const CALL_COST_USD = {
	llm: 0.002,
	openrouterImage: 0.02,
	falImage: 0.078,
	openrouterVideo: 0.35,
	falTalkingHead: 0.667
} as const;

/**
 * THE THRESHOLD, and why it is not a round dollar number.
 *
 * A dollar figure means nothing to an operator; "how many more posts before a
 * customer sees a failure" does. So both thresholds are derived from what a
 * post actually draws on THIS account:
 *
 *   worst case — a video post: LLM caption $0.002 + OpenRouter video $0.35 = $0.352
 *   typical    — an image post: LLM caption $0.002 + OpenRouter image $0.02  = $0.022
 *
 * `low` fires at 70 worst-case posts (~$24.64). That number is chosen for the
 * time it buys, not for its roundness: autopilot's default is 3 posts/day per
 * persona, so 70 worst-case posts is more than a full day of scheduled output
 * for ~20 personas even if every single one took the most expensive route — and
 * far more in practice, since most posts are images at a sixteenth the cost. A
 * day is the unit that matters because an operator who reads the console once a
 * day, or who crosses the line at 3am, still wakes up with room to top up. A
 * threshold that fires at $5 would be technically true and operationally
 * useless: by then the next cinematic post (~$2.30 all-in) empties it.
 *
 * `empty` is one worst-case call. Below it the next video generation cannot
 * complete no matter what, so a caller may refuse cleanly instead of burning a
 * customer's attempt on a provider 402.
 */
const WORST_POST_USD = CALL_COST_USD.llm + CALL_COST_USD.openrouterVideo;
const TYPICAL_POST_USD = CALL_COST_USD.llm + CALL_COST_USD.openrouterImage;
const LOW_POSTS = 70;
export const LOW_BALANCE_USD = +(WORST_POST_USD * LOW_POSTS).toFixed(2);
export const EMPTY_BALANCE_USD = +WORST_POST_USD.toFixed(3);

/** How long a probe result is trusted before another is allowed. */
const TTL_MS = 5 * 60 * 1000;

/** A hung provider must never become our latency. */
const PROBE_TIMEOUT_MS = 8000;

const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

const state: {
	remainingUsd: number | null;
	totalCreditsUsd: number | null;
	totalUsageUsd: number | null;
	checkedAt: number;
	note: string | null;
	inFlight: Promise<void> | null;
} = {
	remainingUsd: null,
	totalCreditsUsd: null,
	totalUsageUsd: null,
	checkedAt: 0,
	note: 'not checked yet',
	inFlight: null
};

function apiKey(): string {
	return (env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '').trim();
}

/** Records an unreadable balance. Clears the number: stale is not measured. */
function markUnknown(note: string): void {
	state.remainingUsd = null;
	state.totalCreditsUsd = null;
	state.totalUsageUsd = null;
	state.note = note;
}

/** Synchronous read. Never probes; call refreshProviderBalance() to update it. */
export function providerBalanceStatus(): ProviderBalance {
	const remaining = state.remainingUsd;
	// Three states, and 'unknown' is a real one. It is not folded into 'ok'
	// (an unread balance is not a funded one) and not into 'low' either.
	const balanceState: BalanceState =
		remaining === null ? 'unknown' : remaining < LOW_BALANCE_USD ? 'low' : 'ok';
	return {
		provider: 'openrouter',
		state: balanceState,
		remainingUsd: remaining,
		totalCreditsUsd: state.totalCreditsUsd,
		totalUsageUsd: state.totalUsageUsd,
		postsRemaining: remaining === null ? null : Math.max(0, Math.floor(remaining / WORST_POST_USD)),
		imagePostsRemaining:
			remaining === null ? null : Math.max(0, Math.floor(remaining / TYPICAL_POST_USD)),
		lowThresholdUsd: LOW_BALANCE_USD,
		emptyThresholdUsd: EMPTY_BALANCE_USD,
		checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
		note: balanceState === 'unknown' ? (state.note ?? 'no reason recorded') : null
	};
}

/**
 * Ask OpenRouter what is left. One authenticated GET (never a POST — this file
 * must not be able to spend); at most one in flight; at most one per TTL; hard
 * timeout so a hung provider cannot become a caller's latency. Never throws —
 * every failure downgrades to 'unknown' and says why.
 */
export async function refreshProviderBalance(
	force = false,
	fetchImpl: typeof fetch = fetch
): Promise<ProviderBalance> {
	if (!force && Date.now() - state.checkedAt < TTL_MS) return providerBalanceStatus();
	if (state.inFlight) {
		await state.inFlight;
		return providerBalanceStatus();
	}
	state.inFlight = (async () => {
		const key = apiKey();
		if (!key) {
			markUnknown('OPENROUTER_API_KEY is not set here — balance cannot be read');
			state.checkedAt = Date.now();
			return;
		}
		try {
			const res = await fetchImpl(CREDITS_URL, {
				method: 'GET',
				headers: { Authorization: `Bearer ${key}`, accept: 'application/json' },
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as {
				data?: { total_credits?: unknown; total_usage?: unknown };
			};
			const credits = Number(body?.data?.total_credits);
			const usage = Number(body?.data?.total_usage);
			if (!Number.isFinite(credits) || !Number.isFinite(usage)) {
				markUnknown('credits endpoint did not report total_credits / total_usage');
			} else {
				state.totalCreditsUsd = credits;
				state.totalUsageUsd = usage;
				state.remainingUsd = +(credits - usage).toFixed(4);
				state.note = null;
			}
		} catch (e) {
			markUnknown(`could not read the OpenRouter balance (${(e as Error).message})`);
		} finally {
			state.checkedAt = Date.now();
		}
	})();
	try {
		await state.inFlight;
	} finally {
		state.inFlight = null;
	}
	return providerBalanceStatus();
}

/**
 * One coarse word for the PUBLIC health endpoint.
 *
 * /api/health is unauthenticated, so it must not publish the dollar figure —
 * that hands a passer-by both our burn rate and the knowledge that we are one
 * post from failing. The word says an operator has something to act on; the
 * Admin Console says how much.
 */
export function providerBalanceSummary(): BalanceState {
	return providerBalanceStatus().state;
}

/**
 * The clean refusal. Returns a reason a caller should decline to spend on this
 * provider right now, or null when spending is fine.
 *
 * NOT WIRED ANYWHERE ON PURPOSE — the generation path is owned by another
 * change in flight. This exists so that wiring it later is one line at the top
 * of the paid path, rather than a redesign, and so the refusal message is
 * written once, here, next to the numbers it quotes.
 *
 * Default policy refuses only on a MEASURED shortfall. `unknown` does not block
 * by default: taking generation down every time OpenRouter's credits endpoint
 * hiccups would be a bigger outage than the one this file prevents. A caller
 * that would rather stop than guess can pass `blockOnUnknown: true`.
 */
export function providerSpendBlock(opts: { blockOnUnknown?: boolean } = {}): string | null {
	const b = providerBalanceStatus();
	if (b.state === 'unknown') {
		return opts.blockOnUnknown
			? `The OpenRouter balance could not be read (${b.note ?? 'no reason recorded'}), and this caller refuses to spend against an unknown balance.`
			: null;
	}
	if (b.remainingUsd !== null && b.remainingUsd < EMPTY_BALANCE_USD) {
		return `The OpenRouter account has $${b.remainingUsd.toFixed(2)} left — less than the $${EMPTY_BALANCE_USD.toFixed(2)} the most expensive call on it costs. Top up the OpenRouter account; this is not a bug in the app.`;
	}
	return null;
}

/** Reset for tests. */
export function _resetProviderBalanceForTests(): void {
	state.remainingUsd = null;
	state.totalCreditsUsd = null;
	state.totalUsageUsd = null;
	state.checkedAt = 0;
	state.note = 'not checked yet';
	state.inFlight = null;
}
