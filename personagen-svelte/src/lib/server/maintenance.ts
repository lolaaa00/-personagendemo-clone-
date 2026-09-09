/**
 * Unattended operation — rides the scheduler tick under the leader lease, so
 * exactly one instance runs it and nothing new is installed (no pg_cron).
 *
 *   hourly   billing reconciliation: every platform-paid generation event of
 *            the last 24 h must have exactly one debit of ceil(est × markup × 100)
 *            (credit_reconcile_mismatches(), SECURITY DEFINER, service-only)
 *   nightly  activity roll-up for yesterday, next month's partition, retention
 *            prune — all idempotent (verify-activity-db.mjs proves it)
 *
 * State is in-process and exposed to /api/health as checks.reconciliation; a
 * result is also written to the activity log as a system event, so the admin
 * timeline shows the last run and its mismatch count without SSH.
 */

import { logSystemActivity } from './activity';
import { activityRetentionDays } from './flags';
import { getServiceSupabase } from './service-supabase';

const HOUR_MS = 60 * 60 * 1000;

const state = {
	lastReconcileAt: null as string | null,
	lastMismatches: null as number | null,
	/**
	 * How many platform-paid events the last run actually looked at.
	 *
	 * A reconciliation over an empty window reports 0 mismatches, which reads
	 * exactly like a healthy one — and "0 mismatches" was cited as evidence the
	 * wallet was sound when deciding to enforce credits, during a week in which
	 * no generation happened at all. A check must say what it examined, and a run
	 * that examined nothing must not be able to pass as a clean bill of health.
	 */
	lastExamined: null as number | null,
	lastRollupDay: null as string | null,
	lastError: null as string | null,
	running: false
};

export function maintenanceStatus() {
	return { ...state };
}

export function _resetMaintenanceForTests() {
	state.lastReconcileAt = null;
	state.lastMismatches = null;
	state.lastExamined = null;
	state.lastRollupDay = null;
	state.lastError = null;
	state.running = false;
	evidence.result = { kind: 'unknown', why: 'not read yet' };
	evidence.checkedAt = 0;
	evidence.inFlight = null;
	clientFactory = () => getServiceSupabase();
}

// ── durable evidence: what the ACTIVITY LOG remembers ───────────────────────
/**
 * Everything above is MODULE state — it dies with the container. Every deploy
 * restarts the process, so /api/health answered
 * "pending (runs on the next scheduler tick)" after a dozen deploys in a row on
 * 2026-09-09 while the activity log held 66 successful runs. Worse, maintenance
 * is leader-only (scheduler.ts returns early without the lease), so a
 * non-leader instance never runs one at all and its health route would say
 * "pending" for the entire life of the container. A field that can only ever
 * say "pending" is a check that cannot report the truth — the defect class this
 * codebase already has a name for.
 *
 * So when THIS container has not run one, fall back to what is durable: the
 * newest `system.reconciliation` row in `public.user_activity_events`.
 *
 * Only that action counts as evidence of a run. `system.maintenance` is written
 * by the NIGHTLY roll-up branch and by the catch-all failure handler, so its
 * presence does not mean a reconciliation happened — but a FAILED one that is
 * newer than the last reconciliation means the last thing maintenance did was
 * fail, and that must not hide behind an older "ok". One query covers both.
 *
 * Row shape measured in production on 2026-09-09: 66 reconciliation rows, all
 * outcome 'ok', meta = { mismatches, window_hours, sample } plus `examined` on
 * the 15 rows written since the denominator landed. **51 rows have no
 * `examined` at all.** A missing denominator is reported as missing: defaulting
 * it to 0 would print "idle: no billable events", which is exactly the false
 * clean bill of health the denominator was added to prevent.
 */

/** What a durable reconciliation row says. `null` means the row did not record it. */
export interface ReconciliationEvidence {
	/** occurred_at of the newest recorded run; null when only a failure was found. */
	at: string | null;
	outcome: string | null;
	mismatches: number | null;
	examined: number | null;
	/** A failed maintenance run NEWER than `at`, when the recent window shows one. */
	failedAt: string | null;
}

export type EvidenceLookup =
	/** The log was read and holds a reconciliation (or a newer failure). */
	| { kind: 'found'; evidence: ReconciliationEvidence }
	/** The log was read and holds nothing — genuinely never run anywhere. */
	| { kind: 'none' }
	/** The log could not be read. Unknown, never "healthy". */
	| { kind: 'unknown'; why: string };

/** How long one lookup is trusted. /api/health is polled by load balancers. */
const EVIDENCE_TTL_MS = 60_000;
/** Hard cap on how long /api/health waits for it (measured: ~70–290 ms). */
const EVIDENCE_TIMEOUT_MS = 2_000;
/** Enough rows to see a failure sitting on top of the last good run. */
const EVIDENCE_WINDOW = 5;

const evidence = {
	result: { kind: 'unknown', why: 'not read yet' } as EvidenceLookup,
	checkedAt: 0,
	inFlight: null as Promise<void> | null
};

/** Injectable for tests, as in activity.ts / settings.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase client, as above
let clientFactory: () => any = () => getServiceSupabase();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ditto
export function _setMaintenanceClientFactory(f: () => any) {
	clientFactory = f;
}

/** Number, or null when absent/unparseable — never a silent 0. */
function num(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** One indexed read (idx_uae_action_time). Never throws: a failure is 'unknown'. */
async function readEvidence(): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped rows off the REST client
	let rows: any[];
	try {
		const { data, error } = await clientFactory()
			.from('user_activity_events')
			.select('occurred_at, action, outcome, meta')
			.or('action.eq.system.reconciliation,and(action.eq.system.maintenance,outcome.eq.error)')
			.order('occurred_at', { ascending: false })
			.limit(EVIDENCE_WINDOW);
		if (error) throw new Error(error.message ?? String(error));
		rows = Array.isArray(data) ? data : [];
	} catch (e) {
		evidence.result = { kind: 'unknown', why: (e as Error).message || 'activity log read failed' };
		evidence.checkedAt = Date.now();
		return;
	}
	if (rows.length === 0) {
		evidence.result = { kind: 'none' };
	} else {
		// Every row matches one of the two arms, so a missing reconciliation row
		// means the window is nothing but failures.
		const last = rows.find((r) => r?.action === 'system.reconciliation') ?? null;
		const newestIsFailure = rows[0]?.action === 'system.maintenance';
		const meta = (last?.meta ?? {}) as Record<string, unknown>;
		evidence.result = {
			kind: 'found',
			evidence: {
				at: last?.occurred_at ?? null,
				outcome: last?.outcome ?? null,
				mismatches: num(meta.mismatches),
				examined: num(meta.examined),
				failedAt: newestIsFailure ? (rows[0]?.occurred_at ?? null) : null
			}
		};
	}
	evidence.checkedAt = Date.now();
}

/**
 * Cached, timeout-bounded durable evidence. Never throws and never holds the
 * response past EVIDENCE_TIMEOUT_MS: a slow or broken database resolves to
 * 'unknown' while the read carries on filling the cache for the next request.
 */
export async function reconciliationEvidence(now: number = Date.now()): Promise<EvidenceLookup> {
	if (evidence.checkedAt !== 0 && now - evidence.checkedAt < EVIDENCE_TTL_MS) return evidence.result;
	if (!evidence.inFlight) {
		evidence.inFlight = readEvidence()
			.catch(() => {})
			.finally(() => {
				evidence.inFlight = null;
			});
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = await Promise.race([
		evidence.inFlight.then(() => false),
		new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), EVIDENCE_TIMEOUT_MS);
			timer.unref?.();
		})
	]);
	if (timer) clearTimeout(timer);
	if (timedOut) return { kind: 'unknown', why: `activity log did not answer within ${EVIDENCE_TIMEOUT_MS}ms` };
	return evidence.result;
}

/**
 * What a single run found — the deliberate "idle" vs "ok" distinction.
 *
 * A reconciliation over an empty window reports 0 mismatches, which reads
 * exactly like a healthy one; "idle" is the honest word for "there was nothing
 * to check". A run whose denominator was never recorded gets neither word.
 */
function runSummary(mismatches: number | null, examined: number | null): string {
	if (mismatches === null) return 'mismatch count not recorded';
	if (mismatches > 0) return `mismatches:${mismatches} of ${examined ?? '?'} examined`;
	if (examined === null) return '0 mismatches, examined count not recorded';
	if (examined === 0) return 'idle: no billable events in the last 24h';
	return `ok: ${examined} events examined`;
}

/**
 * The /api/health `reconciliation` line. Four states, each claiming only what
 * it knows:
 *
 *   this container ran one          → unchanged wording (error / mismatches / idle / ok)
 *   it has not, but the log has one → when it last ran, and that none has run since boot
 *   the log is empty                → "pending", as before — genuinely never run
 *   the log could not be read       → "unknown", never a clean bill of health
 *
 * Informational only: /api/health must not answer 503 because reconciliation is
 * quiet. See the route.
 */
export async function reconciliationCheck(now: number = Date.now()): Promise<string> {
	if (state.lastError) return `error: ${state.lastError.slice(0, 80)}`;
	if (state.lastReconcileAt) return `${runSummary(state.lastMismatches, state.lastExamined)} (${state.lastReconcileAt})`;

	const found = await reconciliationEvidence(now);
	if (found.kind === 'unknown') {
		return `unknown: not run by this container and the activity log could not be read (${found.why.slice(0, 80)})`;
	}
	if (found.kind === 'none') return 'pending (runs on the next scheduler tick)';

	const e = found.evidence;
	if (!e.at) {
		return `unknown: not run by this container; the last recorded maintenance run FAILED (${e.failedAt})`;
	}
	const failure = e.failedAt ? `; a later maintenance run FAILED (${e.failedAt})` : '';
	return `last ran ${e.at} (${runSummary(e.mismatches, e.examined)}); none since this container started${failure}`;
}

function utcDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** Called every tick by the lease holder; decides itself whether anything is due. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase; narrowing it here alone would be a fiction
export async function maybeRunMaintenance(supabase: any, now: number = Date.now()): Promise<void> {
	if (state.running) return;
	state.running = true;
	try {
		const today = utcDay(new Date(now));
		const reconcileDue = !state.lastReconcileAt || now - Date.parse(state.lastReconcileAt) >= HOUR_MS;
		const rollupDue = state.lastRollupDay !== today;

		if (reconcileDue) {
			const since = new Date(now - 24 * HOUR_MS).toISOString();
			const [{ data, error }, { count, error: countErr }] = await Promise.all([
				supabase.rpc('credit_reconcile_mismatches', { p_hours: 24 }),
				// The denominator. Without it "0 mismatches" is unfalsifiable.
				supabase
					.from('generation_events')
					.select('id', { count: 'exact', head: true })
					.eq('key_source', 'platform')
					.gt('credits', 0)
					.gte('created_at', since)
			]);
			if (error) throw new Error(`reconcile: ${error.message}`);
			if (countErr) throw new Error(`reconcile denominator: ${countErr.message}`);
			const mismatches = Array.isArray(data) ? data.length : Number(data ?? 0);
			state.lastReconcileAt = new Date(now).toISOString();
			state.lastMismatches = mismatches;
			state.lastExamined = Number(count ?? 0);
			logSystemActivity({
				userId: null,
				action: 'system.reconciliation',
				outcome: mismatches > 0 ? 'error' : 'ok',
				meta: {
					mismatches,
					examined: state.lastExamined,
					window_hours: 24,
					sample: Array.isArray(data) ? data.slice(0, 5).map((r: { event_id?: string; reason?: string }) => `${r.reason ?? '?'}:${r.event_id}`) : []
				}
			});
			if (mismatches > 0) console.error(`[maintenance] billing reconciliation: ${mismatches} mismatch(es) in the last 24 h`);
		}

		if (rollupDue) {
			const yesterday = new Date(now - 24 * HOUR_MS);
			const nextMonth = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1));
			const steps: Array<[string, Record<string, unknown>]> = [
				['rollup_activity_daily', { p_day: utcDay(yesterday) }],
				['ensure_activity_partition', { p_month: utcDay(nextMonth) }],
				['prune_activity_partitions', { p_retention_days: activityRetentionDays() }]
			];
			const done: string[] = [];
			for (const [fn, args] of steps) {
				const { error } = await supabase.rpc(fn, args);
				if (error) throw new Error(`${fn}: ${error.message}`);
				done.push(fn);
			}
			state.lastRollupDay = today;
			logSystemActivity({ userId: null, action: 'system.maintenance', outcome: 'ok', meta: { day: utcDay(yesterday), steps: done } });
		}
		state.lastError = null;
	} catch (e) {
		state.lastError = (e as Error).message;
		console.error('[maintenance] failed:', state.lastError);
		logSystemActivity({ userId: null, action: 'system.maintenance', outcome: 'error', errorCode: 'MAINTENANCE_FAILED', meta: { error: state.lastError.slice(0, 200) } });
	} finally {
		state.running = false;
	}
}
