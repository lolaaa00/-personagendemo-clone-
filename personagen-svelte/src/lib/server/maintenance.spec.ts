/**
 * THE RECONCILIATION HEALTH LINE — a check that must be able to report the truth.
 *
 * `maintenanceStatus()` is module state: it dies with the container. Every
 * deploy restarts the process and maintenance is leader-only, so /api/health
 * answered "pending (runs on the next scheduler tick)" a dozen deploys in a row
 * on 2026-09-09 while `public.user_activity_events` held 66 successful
 * `system.reconciliation` rows.
 *
 * These tests pin the four states apart and, above all, pin the two ways this
 * could lie:
 *
 *   1. claiming a run happened when the log holds none ("pending" must survive);
 *   2. printing "idle: no billable events" or "ok: N examined" for a row that
 *      never recorded `examined`. 51 of the 66 production rows predate the
 *      denominator, so this is the common case, not a corner one.
 *
 * A database that cannot be read must read as UNKNOWN, never as healthy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		throw new Error('no service key in tests');
	}
}));

const maintenance = await import('./maintenance');

// ── stubs ────────────────────────────────────────────────────────────────────
interface LogRow {
	occurred_at: string;
	action: string;
	outcome: string;
	meta?: Record<string, unknown> | null;
}

/**
 * Stands in for the activity-log read. Records the calls so a test can prove a
 * query happened — or, just as importantly, that it did NOT.
 */
function logClient(
	answer: { data?: LogRow[] | null; error?: { message: string } | null } | 'never-resolves',
	opts: { throwOnFactory?: string } = {}
) {
	const calls: string[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stand-in for the untyped Supabase builder
	const builder: any = {
		select: () => builder,
		or: (f: string) => {
			calls.push(`or:${f}`);
			return builder;
		},
		order: (c: string, o: { ascending: boolean }) => {
			calls.push(`order:${c}:${o.ascending}`);
			return builder;
		},
		limit: (n: number) => {
			calls.push(`limit:${n}`);
			if (answer === 'never-resolves') return new Promise(() => {});
			return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
		}
	};
	const factory = () => {
		if (opts.throwOnFactory) throw new Error(opts.throwOnFactory);
		calls.push('client');
		return {
			from: (t: string) => {
				calls.push(`from:${t}`);
				return builder;
			}
		};
	};
	return { calls, factory };
}

/** Stands in for the client `maybeRunMaintenance` drives, so real runs set real state. */
function runnerClient(opts: { mismatches?: number; examined?: number; rpcError?: string }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ditto
	const q: any = {
		select: () => q,
		eq: () => q,
		gt: () => q,
		gte: async () => ({ count: opts.examined ?? 0, error: null })
	};
	return {
		rpc: async (fn: string) => {
			if (fn !== 'credit_reconcile_mismatches') return { data: null, error: null };
			if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
			return {
				data: Array.from({ length: opts.mismatches ?? 0 }, (_, i) => ({ event_id: `evt-${i}`, reason: 'missing_debit' })),
				error: null
			};
		},
		from: () => q
	};
}

/** Runs a real reconciliation so `lastReconcileAt` is set the way production sets it. */
async function runOnce(opts: Parameters<typeof runnerClient>[0]) {
	await maintenance.maybeRunMaintenance(runnerClient(opts));
	return maintenance.maintenanceStatus();
}

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	maintenance._resetMaintenanceForTests();
});

afterEach(() => {
	vi.useRealTimers();
});

// ── state 1: this container has run one ─────────────────────────────────────
describe('state 1 — this container has run a reconciliation', () => {
	it('reports "ok: N events examined" and never touches the database', async () => {
		const { calls, factory } = logClient({ data: [] });
		maintenance._setMaintenanceClientFactory(factory);
		const st = await runOnce({ mismatches: 0, examined: 7 });

		expect(await maintenance.reconciliationCheck()).toBe(`ok: 7 events examined (${st.lastReconcileAt})`);
		// The fallback is not a tax on the healthy path.
		expect(calls).toEqual([]);
	});

	it('keeps "idle" separate from "ok" for an empty window', async () => {
		const st = await runOnce({ mismatches: 0, examined: 0 });
		expect(await maintenance.reconciliationCheck()).toBe(
			`idle: no billable events in the last 24h (${st.lastReconcileAt})`
		);
	});

	it('reports mismatches with their denominator', async () => {
		const st = await runOnce({ mismatches: 2, examined: 9 });
		expect(await maintenance.reconciliationCheck()).toBe(`mismatches:2 of 9 examined (${st.lastReconcileAt})`);
	});

	it('reports an in-container failure as an error, without consulting the log', async () => {
		const { calls, factory } = logClient({ data: [{ occurred_at: '2026-09-09T16:31:55Z', action: 'system.reconciliation', outcome: 'ok', meta: { mismatches: 0, examined: 5 } }] });
		maintenance._setMaintenanceClientFactory(factory);
		await runOnce({ rpcError: 'permission denied for function credit_reconcile_mismatches' });

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toMatch(/^error: reconcile: permission denied/);
		expect(calls).toEqual([]);
	});
});

// ── state 2: this container has not, but the log has ────────────────────────
describe('state 2 — the container has not run one, the activity log has', () => {
	it('says when it last ran, what it examined, and that none has run since boot', async () => {
		const { calls, factory } = logClient({
			data: [
				{
					occurred_at: '2026-09-09T16:31:55.176383+00:00',
					action: 'system.reconciliation',
					outcome: 'ok',
					meta: { mismatches: 0, examined: 1, window_hours: 24, sample: [] }
				}
			]
		});
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toBe(
			'last ran 2026-09-09T16:31:55.176383+00:00 (ok: 1 events examined); none since this container started'
		);
		expect(msg).not.toContain('pending');
		// One indexed read, filtered to both system actions.
		expect(calls.filter((c) => c.startsWith('from:'))).toEqual(['from:user_activity_events']);
		expect(calls).toContain('order:occurred_at:false');
	});

	it('a recorded run with mismatches is reported as such, not as "ok"', async () => {
		const { factory } = logClient({
			data: [
				{
					occurred_at: '2026-09-08T04:00:00+00:00',
					action: 'system.reconciliation',
					outcome: 'error',
					meta: { mismatches: 3, examined: 12 }
				}
			]
		});
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toContain('mismatches:3 of 12 examined');
		expect(msg).not.toMatch(/\bok:/);
	});

	it('NEVER invents a denominator: a row without meta.examined says so', async () => {
		// 51 of 66 production rows look exactly like this — they predate `examined`.
		const { factory } = logClient({
			data: [
				{
					occurred_at: '2026-09-07T18:00:18.592367+00:00',
					action: 'system.reconciliation',
					outcome: 'ok',
					meta: { mismatches: 0, window_hours: 24, sample: [] }
				}
			]
		});
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toContain('0 mismatches, examined count not recorded');
		// The two phrases that would be a fabrication here.
		expect(msg).not.toContain('idle: no billable events');
		expect(msg).not.toMatch(/\bok: \d+ events examined/);
	});

	it('does not claim a mismatch count the row never recorded', async () => {
		const { factory } = logClient({
			data: [{ occurred_at: '2026-09-07T18:00:18+00:00', action: 'system.reconciliation', outcome: 'ok', meta: {} }]
		});
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toContain('mismatch count not recorded');
	});

	it('a maintenance failure newer than the last run is not hidden behind it', async () => {
		const { factory } = logClient({
			data: [
				{ occurred_at: '2026-09-09T17:00:00+00:00', action: 'system.maintenance', outcome: 'error', meta: { error: 'boom' } },
				{ occurred_at: '2026-09-09T16:31:55+00:00', action: 'system.reconciliation', outcome: 'ok', meta: { mismatches: 0, examined: 1 } }
			]
		});
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toContain('last ran 2026-09-09T16:31:55+00:00');
		expect(msg).toContain('a later maintenance run FAILED (2026-09-09T17:00:00+00:00)');
	});

	it('a window of nothing but failures is unknown, not a clean last run', async () => {
		const { factory } = logClient({
			data: [{ occurred_at: '2026-09-09T17:00:00+00:00', action: 'system.maintenance', outcome: 'error', meta: {} }]
		});
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toMatch(/^unknown:/);
		expect(msg).toContain('FAILED');
		expect(msg).not.toContain('last ran');
	});

	it('caches the lookup — repeated health polls do not re-read the log', async () => {
		const { calls, factory } = logClient({
			data: [{ occurred_at: '2026-09-09T16:31:55+00:00', action: 'system.reconciliation', outcome: 'ok', meta: { mismatches: 0, examined: 1 } }]
		});
		maintenance._setMaintenanceClientFactory(factory);

		const a = await maintenance.reconciliationCheck();
		const b = await maintenance.reconciliationCheck();
		expect(b).toBe(a);
		expect(calls.filter((c) => c === 'from:user_activity_events')).toHaveLength(1);
	});
});

// ── state 3: nothing anywhere ───────────────────────────────────────────────
describe('state 3 — no evidence anywhere', () => {
	it('still says "pending", word for word', async () => {
		const { factory } = logClient({ data: [] });
		maintenance._setMaintenanceClientFactory(factory);
		expect(await maintenance.reconciliationCheck()).toBe('pending (runs on the next scheduler tick)');
	});

	it('treats a null payload as no evidence rather than as a run', async () => {
		const { factory } = logClient({ data: null });
		maintenance._setMaintenanceClientFactory(factory);
		expect(await maintenance.reconciliationCheck()).toBe('pending (runs on the next scheduler tick)');
	});
});

// ── the failure mode that must never be reassuring ──────────────────────────
describe('an unreadable activity log', () => {
	it('does not throw and reads as unknown, never as healthy or as pending', async () => {
		const { factory } = logClient({ error: { message: 'permission denied for table user_activity_events' } });
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toMatch(/^unknown: not run by this container and the activity log could not be read/);
		expect(msg).toContain('permission denied');
		for (const reassuring of ['pending', 'ok:', 'idle:', 'last ran']) {
			expect(msg).not.toContain(reassuring);
		}
	});

	it('survives a client that cannot even be constructed', async () => {
		const { factory } = logClient({ data: [] }, { throwOnFactory: '[Service Supabase] Supabase credentials not configured.' });
		maintenance._setMaintenanceClientFactory(factory);

		const msg = await maintenance.reconciliationCheck();
		expect(msg).toMatch(/^unknown:/);
		expect(msg).toContain('credentials not configured');
	});

	it('reports unknown rather than hanging when the database never answers', async () => {
		vi.useFakeTimers();
		const { factory } = logClient('never-resolves');
		maintenance._setMaintenanceClientFactory(factory);

		const pending = maintenance.reconciliationCheck();
		await vi.advanceTimersByTimeAsync(2_500);
		const msg = await pending;

		expect(msg).toMatch(/^unknown:/);
		expect(msg).toContain('did not answer within');
	});

	it('exposes the raw lookup as unknown too, so callers cannot mistake it for "none"', async () => {
		const { factory } = logClient({ error: { message: 'relation does not exist' } });
		maintenance._setMaintenanceClientFactory(factory);

		const found = await maintenance.reconciliationEvidence();
		expect(found.kind).toBe('unknown');
	});
});
