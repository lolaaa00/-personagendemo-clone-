import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CostEvent } from '$lib/pricing';

const { budget, record } = vi.hoisted(() => ({
	budget: { assertWithinBudget: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}) },
	record: { recordCostEvents: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}) }
}));
vi.mock('./budget', () => budget);
vi.mock('./content/generate', () => record);
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { meteredAiClient, meteredCall, meteringRefusal, BATCH_MAX } = await import('./metering');
const { InsufficientCreditsError } = await import('./credits');

const scope = { supabase: {}, userId: 'u1' };

beforeEach(() => {
	budget.assertWithinBudget.mockClear();
	record.recordCostEvents.mockClear();
	budget.assertWithinBudget.mockImplementation(async () => {});
});

describe('meteredAiClient', () => {
	it('gates once per request and records + debits every successful call', async () => {
		const raw = { provider: 'openrouter' as const, model: 'gemini-3.5-flash', generate: vi.fn(async () => 'ok') };
		const ai = meteredAiClient(raw, scope)!;
		expect(ai.provider).toBe('openrouter');
		await ai.generate('a');
		await ai.generate('b');
		await ai.generate('c');
		expect(budget.assertWithinBudget).toHaveBeenCalledTimes(1);
		expect(budget.assertWithinBudget.mock.calls[0]).toEqual([scope.supabase, 'u1', undefined, 1]); // ceil(0.002 × 100) at markup 1
		expect(record.recordCostEvents).toHaveBeenCalledTimes(3);
		// usd is the BILLING basis and stays the table rate. The three usage fields
		// ride alongside it and are null here because this stub reports no usage —
		// null, not 0, so "the provider said nothing" stays distinguishable from
		// "the provider said it was free".
		expect(record.recordCostEvents.mock.calls[0][3]).toEqual([
			{
				provider: 'openrouter',
				operation: 'llm',
				model: 'gemini-3.5-flash',
				usd: 0.002,
				tokensIn: null,
				tokensOut: null,
				measuredUsd: null
			}
		]);
	});

	it('records what the provider reported, without billing it', async () => {
		// OpenRouter returns a real cost on every response. It is recorded and the
		// charge stays the table rate: the quote the user approved before the run
		// came from that same table, and the quote is an upper bound on the bill.
		const raw = {
			provider: 'openrouter' as const,
			model: 'gemini-3.5-flash',
			generate: vi.fn(async (_p: string, opts?: { onUsage?: (u: unknown) => void }) => {
				opts?.onUsage?.({ tokensIn: 1200, tokensOut: 340, costUsd: 0.00731 });
				return 'ok';
			})
		};
		const ai = meteredAiClient(raw, scope)!;
		await ai.generate('a');
		const [, , , events] = record.recordCostEvents.mock.calls[0] as [unknown, unknown, unknown, CostEvent[]];
		const event = events[0];
		expect(event.tokensIn).toBe(1200);
		expect(event.tokensOut).toBe(340);
		expect(event.measuredUsd).toBe(0.00731);
		// 3.6x the table rate, and still billed at the table rate.
		expect(event.usd).toBe(0.002);
	});

	it('refuses every call when the gate refuses, and records nothing', async () => {
		budget.assertWithinBudget.mockImplementation(async () => {
			throw new InsufficientCreditsError(0, 1);
		});
		const raw = { provider: 'openrouter' as const, model: 'm', generate: vi.fn(async () => 'ok') };
		const ai = meteredAiClient(raw, scope)!;
		await expect(ai.generate('a')).rejects.toThrow(/credits/i);
		await expect(ai.generate('b')).rejects.toThrow(/credits/i);
		expect(raw.generate).not.toHaveBeenCalled();
		expect(record.recordCostEvents).not.toHaveBeenCalled();
	});

	it('does not record a call the provider failed', async () => {
		const raw = { provider: 'gemini' as const, model: 'm', generate: vi.fn(async () => { throw new Error('503'); }) };
		const ai = meteredAiClient(raw, scope)!;
		await expect(ai.generate('a')).rejects.toThrow('503');
		expect(record.recordCostEvents).not.toHaveBeenCalled();
	});

	it('passes null through', () => {
		expect(meteredAiClient(null, scope)).toBeNull();
	});
});

describe('meteredCall', () => {
	it('gates with the estimate, then records the event derived from the result', async () => {
		const out = await meteredCall(scope, async () => ({ url: 'u', provider: 'fal', model: 'nano-banana-2' }), {
			estimateUsd: 0.08,
			event: (r) => ({ provider: r.provider, operation: 'image', model: r.model, usd: 0.08 })
		});
		expect(out.url).toBe('u');
		expect(budget.assertWithinBudget).toHaveBeenCalledWith(scope.supabase, 'u1', undefined, 8);
		expect(record.recordCostEvents.mock.calls[0][3]).toEqual([{ provider: 'fal', operation: 'image', model: 'nano-banana-2', usd: 0.08 }]);
	});

	it('does not run the call when the gate refuses', async () => {
		budget.assertWithinBudget.mockImplementation(async () => {
			throw new Error('Daily generation budget reached');
		});
		const fn = vi.fn(async () => 1);
		await expect(meteredCall(scope, fn, { estimateUsd: 1, event: () => ({ provider: 'fal', operation: 'image', model: 'm', usd: 1 }) })).rejects.toThrow(/budget/);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('meteringRefusal + batch cap', () => {
	it('maps an empty wallet to 402 with a billing link and a cap to 400', () => {
		const r = meteringRefusal(new InsufficientCreditsError(5, 24));
		expect(r.status).toBe(402);
		expect(r.body.code).toBe('INSUFFICIENT_CREDITS');
		expect(r.body.billingUrl).toBe('/billing');
		const c = meteringRefusal(new Error('Monthly generation budget reached'));
		expect(c.status).toBe(400);
		expect(c.body.code).toBe('BUDGET');
	});

	it('caps a batch at 12 (≈ $1.00 raw at Nano Banana prices), not 100', () => {
		expect(BATCH_MAX).toBe(12);
	});
});
