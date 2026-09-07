/**
 * BUDGET CAP — the last line of defence against a runaway paid-generation loop.
 *
 * These are pure-logic tests: the supabase ledger query is mocked, nothing
 * touches the network and no API key is read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, type RecordedQuery } from '../tests/mock-supabase';

// budget.ts reads caps from $env/dynamic/private at CALL time, so a mutable
// mock env object lets each test set its own caps.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { assertWithinBudget } = await import('./budget');

const USER = 'user-1';
const AGENT = 'agent-1';

function ledger(rows: Array<{ est_cost: number }> | null, error: any = null) {
	return createMockSupabase(() => ({ data: rows, error }));
}

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('assertWithinBudget', () => {
	describe('daily per-agent cap', () => {
		beforeEach(() => {
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '0'; // isolate the daily cap
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = '15';
		});

		it('THROWS when accumulated est_cost has reached the cap (>= is a hard stop)', async () => {
			const supabase = ledger([{ est_cost: 10 }, { est_cost: 5 }]); // exactly 15
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).rejects.toThrow(/budget/i);
		});

		it('THROWS when accumulated est_cost has exceeded the cap', async () => {
			const supabase = ledger([{ est_cost: 14.5 }, { est_cost: 3 }]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).rejects.toThrow(
				/Daily generation budget reached/i
			);
		});

		it('does NOT throw when under the cap', async () => {
			const supabase = ledger([{ est_cost: 7 }, { est_cost: 2.25 }]); // 9.25 < 15
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).resolves.toBeUndefined();
		});

		it('does NOT throw on an empty ledger', async () => {
			const supabase = ledger([]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).resolves.toBeUndefined();
		});

		it('sums the agent_id ledger since midnight UTC today', async () => {
			const supabase = ledger([{ est_cost: 1 }]);
			await assertWithinBudget(supabase as any, USER, AGENT);

			const q = supabase.of('generation_events')[0] as RecordedQuery;
			expect(q.has('eq', 'agent_id', AGENT)).toBe(true);
			expect(q.has('select', 'est_cost')).toBe(true);
			// Explicit high limit guards against PostgREST's silent max-rows truncation.
			expect(q.chain.some((c) => c[0] === 'limit' && c[1] === 100000)).toBe(true);
			const since = q.chain.find((c) => c[0] === 'gte' && c[1] === 'created_at')?.[2];
			const expected = new Date();
			expected.setUTCHours(0, 0, 0, 0);
			expect(since).toBe(expected.toISOString());
		});

		it('ignores non-numeric est_cost rows rather than NaN-ing the total open', async () => {
			const supabase = ledger([{ est_cost: 20 } as any, { est_cost: null } as any]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).rejects.toThrow(/budget/i);
		});
	});

	describe('monthly per-user cap', () => {
		beforeEach(() => {
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '300';
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = '0'; // isolate the monthly cap
		});

		it('THROWS when the user has reached the monthly cap', async () => {
			const supabase = ledger([{ est_cost: 299 }, { est_cost: 1 }]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).rejects.toThrow(
				/Monthly generation budget reached/i
			);
		});

		it('does NOT throw when under the monthly cap', async () => {
			const supabase = ledger([{ est_cost: 120 }]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).resolves.toBeUndefined();
		});

		it('sums the user_id ledger since the 1st of the month (UTC)', async () => {
			const supabase = ledger([{ est_cost: 1 }]);
			await assertWithinBudget(supabase as any, USER, AGENT);

			const q = supabase.of('generation_events')[0] as RecordedQuery;
			expect(q.has('eq', 'user_id', USER)).toBe(true);
			const since = q.chain.find((c) => c[0] === 'gte' && c[1] === 'created_at')?.[2];
			const expected = new Date();
			expected.setUTCDate(1);
			expected.setUTCHours(0, 0, 0, 0);
			expect(since).toBe(expected.toISOString());
		});
	});

	describe('a cap of 0 disables the check', () => {
		it('never throws AND never queries the ledger when both caps are 0', async () => {
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '0';
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = '0';
			const supabase = ledger([{ est_cost: 99999 }]);

			await expect(assertWithinBudget(supabase as any, USER, AGENT)).resolves.toBeUndefined();
			// The env caps are off, so no LEDGER sum may run. The per-seat workspace cap
			// (Settings → Team) is independent of the env caps and still does its cheap
			// agents/workspace lookup — that is not a ledger read.
			expect(supabase.of('generation_events')).toHaveLength(0);
		});

		it('a 0 daily cap still lets the monthly cap fire', async () => {
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '10';
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = '0';
			const supabase = ledger([{ est_cost: 50 }]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).rejects.toThrow(/Monthly/i);
		});
	});

	describe('ledger read error FAILS OPEN', () => {
		it('does not throw when the generation_events read errors (analytics down != stop shipping) — but logs LOUDLY', async () => {
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '1'; // absurdly low: only a real sum could pass
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = '1';
			const supabase = ledger(null, { message: 'relation "generation_events" does not exist' });
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			try {
				await expect(assertWithinBudget(supabase as any, USER, AGENT)).resolves.toBeUndefined();
				// It did try to read (both caps) — it just didn't block on the failure.
				expect(supabase.of('generation_events')).toHaveLength(2);
				// Fail-open must not be SILENT: the operator needs to see that no
				// spend cap was enforced, and why.
				expect(errSpy).toHaveBeenCalledTimes(2);
				expect(String(errSpy.mock.calls[0][0])).toMatch(/generation_events.*does not exist/s);
			} finally {
				errSpy.mockRestore();
			}
		});
	});

	describe('row-limit truncation guard', () => {
		it('warns when the ledger returns exactly the query limit (sum may undercount)', async () => {
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '0';
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = '1000000'; // high cap: we only care about the warning
			const rows = Array.from({ length: 100000 }, () => ({ est_cost: 0.000001 }));
			const supabase = ledger(rows);
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			try {
				await expect(assertWithinBudget(supabase as any, USER, AGENT)).resolves.toBeUndefined();
				expect(warnSpy).toHaveBeenCalledTimes(1);
				expect(String(warnSpy.mock.calls[0][0])).toMatch(/undercount/i);
			} finally {
				warnSpy.mockRestore();
			}
		});
	});

	describe('cap parsing from env', () => {
		it('falls back to the built-in defaults when env is unset (15/day, 300/month)', async () => {
			const supabase = ledger([{ est_cost: 15 }]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).rejects.toThrow(/of \$15 cap/);
		});

		it('falls back to the default when the env value is garbage', async () => {
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = 'not-a-number';
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '0';
			const supabase = ledger([{ est_cost: 15 }]);
			await expect(assertWithinBudget(supabase as any, USER, AGENT)).rejects.toThrow(/of \$15 cap/);
		});

		it('skips the agent cap when no agentId is supplied', async () => {
			mockEnv.MAX_MONTHLY_SPEND_PER_USER_USD = '0';
			mockEnv.MAX_DAILY_SPEND_PER_AGENT_USD = '15';
			const supabase = ledger([{ est_cost: 99999 }]);
			await expect(assertWithinBudget(supabase as any, USER)).resolves.toBeUndefined();
			// The env caps are off, so no LEDGER sum may run. The per-seat workspace cap
			// (Settings → Team) is independent of the env caps and still does its cheap
			// agents/workspace lookup — that is not a ledger read.
			expect(supabase.of('generation_events')).toHaveLength(0);
		});
	});
});
