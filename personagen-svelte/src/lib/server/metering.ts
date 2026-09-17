/**
 * Metering — one way to make ANY provider call gate → record → debit.
 *
 * generate.ts already does this for the UGC packs (assert before the first
 * paid call, recordCostEvents in `finally`). The engine route and the voice
 * preview called providers directly, so their spend never reached the ledger
 * or the wallet — and, because the USD caps sum the ledger, never counted
 * against anyone's cap either. These wrappers close that with the SAME record
 * path, so there is still exactly one writer of cost events.
 *
 *   meteredAiClient(ai, scope)   wraps an AiClient: gates once per request
 *                                (first call), records + debits every call
 *   meteredCall(scope, fn, …)    gates, runs fn, records the event described
 *                                by the result (image / TTS / anything)
 *   meteringRefusal(err)         maps a gate error to the HTTP shape the
 *                                composer already understands (402 + billing)
 *
 * Invariant D11: a provider call site is either metered through here (or
 * generate.ts) or listed as FREE with a reason in metering-audit.spec.ts.
 */

import type { AiClient, AiGenerateOptions, AiUsage } from './ai-client';
import { assertWithinBudget } from './budget';
import { creditsFor, isCreditsError } from './credits';
import { recordCostEvents } from './content/generate';
import { priceOf, type CostEvent } from '$lib/pricing';

/** Upper bound for one batch_generate request (was 100 = ~$7.90 raw per click). */
export const BATCH_MAX = 12;

export interface MeterScope {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase; narrowing it here alone would be a fiction
	supabase: any;
	userId: string;
	agentId?: string | null;
	postId?: string | null;
	/** Default stage for every call through this wrapper; a call's own opts.stage wins. */
	stage?: string | null;
}

/**
 * Wrap an AiClient so every text call is metered. The gate runs once per
 * wrapper (= once per request) with the price of one call; each successful
 * call then records one `llm` event, which debits the billing account. A
 * failed provider call records nothing — providers do not bill errors.
 */
export function meteredAiClient(ai: AiClient | null, scope: MeterScope): AiClient | null {
	if (!ai) return null;
	const usd = priceOf(ai.provider, 'llm');
	let gate: Promise<void> | null = null;
	return {
		provider: ai.provider,
		model: ai.model,
		async generate(prompt: string, opts?: AiGenerateOptions): Promise<string> {
			if (!gate) gate = assertWithinBudget(scope.supabase, scope.userId, scope.agentId ?? undefined, creditsFor(usd));
			await gate;
			// The provider's own account of what it consumed, captured per call so
			// the flat table rate can be checked against reality. Billing still uses
			// `usd`; see CostEvent.measuredUsd for why.
			// Held in an object, not a `let`: TypeScript narrows a closure-assigned
			// local to `never` because it cannot see that onUsage runs.
			const seen: { usage: AiUsage | null } = { usage: null };
			const out = await ai.generate(prompt, { ...opts, onUsage: (u) => { seen.usage = u; } });
			await recordCostEvents(
				scope.supabase,
				scope.userId,
				scope.agentId ?? undefined,
				[
					{
						provider: ai.provider,
						operation: 'llm',
						model: ai.model,
						usd,
						tokensIn: seen.usage?.tokensIn ?? null,
						tokensOut: seen.usage?.tokensOut ?? null,
						measuredUsd: seen.usage?.costUsd ?? null,
						stage: opts?.stage ?? scope.stage ?? null
					}
				],
				scope.postId ?? undefined
			);
			return out;
		}
	};
}

export interface MeteredCallOptions<T> {
	/** Raw USD quoted to the gate before the call. */
	estimateUsd: number;
	/** The event to record, derived from the result (provider/model may only be known after). */
	event: (result: T) => CostEvent;
}

/** Gate → run → record for a single paid call. */
export async function meteredCall<T>(scope: MeterScope, fn: () => Promise<T>, o: MeteredCallOptions<T>): Promise<T> {
	await assertWithinBudget(scope.supabase, scope.userId, scope.agentId ?? undefined, creditsFor(o.estimateUsd));
	const result = await fn();
	await recordCostEvents(scope.supabase, scope.userId, scope.agentId ?? undefined, [o.event(result)], scope.postId ?? undefined);
	return result;
}

/** HTTP shape for a refused call: 402 for an empty wallet, 400 for a cap. */
export function meteringRefusal(err: unknown): { status: number; body: Record<string, unknown> } {
	const message = (err as Error)?.message ?? String(err);
	if (isCreditsError(err)) {
		return { status: 402, body: { success: false, code: 'INSUFFICIENT_CREDITS', error: `${message} Top up at /billing to continue.`, billingUrl: '/billing' } };
	}
	return { status: 400, body: { success: false, code: 'BUDGET', error: message } };
}
