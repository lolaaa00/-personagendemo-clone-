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

const HOUR_MS = 60 * 60 * 1000;

const state = {
	lastReconcileAt: null as string | null,
	lastMismatches: null as number | null,
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
	state.lastRollupDay = null;
	state.lastError = null;
	state.running = false;
}

function utcDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** Called every tick by the lease holder; decides itself whether anything is due. */
export async function maybeRunMaintenance(supabase: any, now: number = Date.now()): Promise<void> {
	if (state.running) return;
	state.running = true;
	try {
		const today = utcDay(new Date(now));
		const reconcileDue = !state.lastReconcileAt || now - Date.parse(state.lastReconcileAt) >= HOUR_MS;
		const rollupDue = state.lastRollupDay !== today;

		if (reconcileDue) {
			const { data, error } = await supabase.rpc('credit_reconcile_mismatches', { p_hours: 24 });
			if (error) throw new Error(`reconcile: ${error.message}`);
			const mismatches = Array.isArray(data) ? data.length : Number(data ?? 0);
			state.lastReconcileAt = new Date(now).toISOString();
			state.lastMismatches = mismatches;
			logSystemActivity({
				userId: null,
				action: 'system.reconciliation',
				outcome: mismatches > 0 ? 'error' : 'ok',
				meta: { mismatches, window_hours: 24, sample: Array.isArray(data) ? data.slice(0, 5).map((r: any) => r.event_id) : [] }
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
