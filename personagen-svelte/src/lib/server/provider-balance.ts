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
	llm: 0.012,
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
 *   worst case — a video post: LLM caption $0.012 + OpenRouter video $0.35 = $0.362
 *   typical    — an image post: LLM caption $0.012 + OpenRouter image $0.02  = $0.032
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
	// Folds every account we are actually watching, worst state wins, because a
	// funded OpenRouter account says nothing about a locked fal one — and fal is
	// where the money goes. Still one bare word: the unauthenticated route must
	// not learn which provider, or how much.
	//
	// An UNCONFIGURED fal is excluded rather than counted as 'unknown'. That is
	// the one concession to "absent reads as fine" in this file and it is made
	// deliberately: 'unknown' means we tried and failed, and degrading the public
	// health word for an account the operator has not opted into watching would
	// train them to ignore it — the exact failure the top of this file argues
	// against. It is not hidden: the Admin Console shows 'unconfigured' in its
	// own right, with the instructions for fixing it.
	const states: BalanceState[] = [providerBalanceStatus().state];
	const fal = falBalanceStatus();
	if (fal.state !== 'unconfigured') states.push(fal.state);
	if (states.includes('low')) return 'low';
	if (states.includes('unknown')) return 'unknown';
	return 'ok';
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
	falState.remainingUsd = null;
	falState.currency = null;
	falState.checkedAt = 0;
	falState.note = 'not checked yet';
	falState.inFlight = null;
}

// ─── fal ─────────────────────────────────────────────────────────────────────

/**
 * The same watch, for the account that actually costs money.
 *
 * Everything above was written for OpenRouter and shipped watching only
 * OpenRouter — which was the cheap provider. Measured over all of production:
 * fal is **$0.130 per event against OpenRouter's $0.031**, 4.2x, and 43% of
 * every dollar ever spent on 15% of the events. The expensive account was the
 * unwatched one.
 *
 * It matters more since 2026-09-21, when customer BYOK was withdrawn: every
 * generation for every customer now runs on our keys, so there is no longer a
 * customer key anywhere absorbing part of the load.
 *
 * And fal fails harder than OpenRouter does. Per fal's own documentation, when
 * the balance drops below the account's lock threshold **the account is locked
 * and API requests are rejected** — not degraded, stopped. A missed fal balance
 * is a full media outage, which is why `low` here is worth as much warning time
 * as the OpenRouter one.
 *
 * SEPARATE KEY, DELIBERATELY. This reads `FAL_ADMIN_API_KEY` and never falls
 * back to `FAL_API_KEY`. Two reasons, one measured and one structural:
 *
 *   - measured: the production FAL_API_KEY answers this endpoint with
 *     `403 authorization_error`. fal issues API-scoped and ADMIN-scoped keys and
 *     only ADMIN may read billing, so a fallback would report 'unknown' forever
 *     while looking like it was configured.
 *   - structural: the balance reader must not hold a key that can spend. A
 *     read-only watcher with spend rights is the thing that turns a compromised
 *     monitor into a bill.
 */

/** Documented shape: GET /v1/account/billing?expand=credits */
const FAL_BILLING_URL = 'https://api.fal.ai/v1/account/billing?expand=credits';

/**
 * A fal post's worst case is the talking head at $0.667; the typical one is an
 * image at $0.078. The caption LLM is not counted here — it is charged to
 * OpenRouter, which has its own balance above. Same 70-posts-of-warning rule as
 * OpenRouter, for the same reason: an operator who reads the console once a day
 * still wakes up with room to top up.
 */
const WORST_FAL_POST_USD = CALL_COST_USD.falTalkingHead;
const TYPICAL_FAL_POST_USD = CALL_COST_USD.falImage;
export const FAL_LOW_BALANCE_USD = +(WORST_FAL_POST_USD * LOW_POSTS).toFixed(2);
export const FAL_EMPTY_BALANCE_USD = +WORST_FAL_POST_USD.toFixed(3);

export interface FalBalance {
	provider: 'fal';
	/** 'unconfigured' is NOT 'ok': it means nobody is watching this account. */
	state: BalanceState | 'unconfigured';
	remainingUsd: number | null;
	currency: string | null;
	postsRemaining: number | null;
	imagePostsRemaining: number | null;
	lowThresholdUsd: number;
	emptyThresholdUsd: number;
	checkedAt: string | null;
	note: string | null;
}

const falState: {
	remainingUsd: number | null;
	currency: string | null;
	checkedAt: number;
	note: string | null;
	inFlight: Promise<void> | null;
} = { remainingUsd: null, currency: null, checkedAt: 0, note: 'not checked yet', inFlight: null };

function falAdminKey(): string {
	return (env.FAL_ADMIN_API_KEY ?? process.env.FAL_ADMIN_API_KEY ?? '').trim();
}

/** True when an admin-scoped fal key exists to read the balance with. */
export function falBalanceConfigured(): boolean {
	return falAdminKey().length > 0;
}

/** Synchronous read. Never probes; call refreshFalBalance() to update it. */
export function falBalanceStatus(): FalBalance {
	const remaining = falState.remainingUsd;
	const configured = falBalanceConfigured();
	const balanceState: FalBalance['state'] = !configured
		? 'unconfigured'
		: remaining === null
			? 'unknown'
			: remaining < FAL_LOW_BALANCE_USD
				? 'low'
				: 'ok';
	return {
		provider: 'fal',
		state: balanceState,
		remainingUsd: remaining,
		currency: falState.currency,
		postsRemaining:
			remaining === null ? null : Math.max(0, Math.floor(remaining / WORST_FAL_POST_USD)),
		imagePostsRemaining:
			remaining === null ? null : Math.max(0, Math.floor(remaining / TYPICAL_FAL_POST_USD)),
		lowThresholdUsd: FAL_LOW_BALANCE_USD,
		emptyThresholdUsd: FAL_EMPTY_BALANCE_USD,
		checkedAt: falState.checkedAt ? new Date(falState.checkedAt).toISOString() : null,
		note:
			balanceState === 'unconfigured'
				? 'FAL_ADMIN_API_KEY is not set. fal only lets an ADMIN-scoped key read billing — the generation key returns 403 — so mint a second key at fal.ai/dashboard/keys with scope ADMIN and set it here. Nothing is watching the fal balance until then.'
				: balanceState === 'unknown'
					? (falState.note ?? 'no reason recorded')
					: null
	};
}

/**
 * Ask fal what is left. One authenticated GET, at most one in flight, at most
 * one per TTL, hard timeout, never throws — the same discipline as the
 * OpenRouter probe above, and for the same reasons.
 */
export async function refreshFalBalance(
	force = false,
	fetchImpl: typeof fetch = fetch
): Promise<FalBalance> {
	if (!falBalanceConfigured()) return falBalanceStatus();
	if (!force && Date.now() - falState.checkedAt < TTL_MS) return falBalanceStatus();
	if (falState.inFlight) {
		await falState.inFlight;
		return falBalanceStatus();
	}
	falState.inFlight = (async () => {
		try {
			const res = await fetchImpl(FAL_BILLING_URL, {
				method: 'GET',
				// fal authenticates with `Key <token>`, not `Bearer`.
				headers: { Authorization: `Key ${falAdminKey()}`, accept: 'application/json' },
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
			});
			if (res.status === 401 || res.status === 403) {
				// The measured failure, called out by name so an operator does not
				// go looking for a network fault.
				falState.remainingUsd = null;
				falState.currency = null;
				falState.note =
					'fal refused the key for billing (HTTP ' +
					res.status +
					'). An API-scoped key cannot read this — it needs scope ADMIN.';
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as {
				credits?: { current_balance?: unknown; currency?: unknown };
			};
			const balance = Number(body?.credits?.current_balance);
			if (!Number.isFinite(balance)) {
				falState.remainingUsd = null;
				falState.currency = null;
				falState.note =
					'billing endpoint did not report credits.current_balance — expand=credits may have been dropped';
			} else {
				falState.remainingUsd = +balance.toFixed(4);
				falState.currency = typeof body?.credits?.currency === 'string' ? body.credits.currency : 'USD';
				falState.note = null;
			}
		} catch (e) {
			falState.remainingUsd = null;
			falState.currency = null;
			falState.note = `could not read the fal balance (${(e as Error).message})`;
		} finally {
			falState.checkedAt = Date.now();
		}
	})();
	try {
		await falState.inFlight;
	} finally {
		falState.inFlight = null;
	}
	return falBalanceStatus();
}

/** Both accounts, for the Admin Console. Probes in parallel; never throws. */
export async function refreshAllBalances(
	force = false
): Promise<{ openrouter: ProviderBalance; fal: FalBalance }> {
	const [openrouter, fal] = await Promise.all([
		refreshProviderBalance(force),
		refreshFalBalance(force)
	]);
	return { openrouter, fal };
}
