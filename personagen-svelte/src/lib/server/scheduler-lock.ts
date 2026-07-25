import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Leader lease for the scheduler — elects ONE instance that does the
 * publishing/autopilot work each tick; the rest no-op.
 *
 * Primary: a Postgres lease (scheduler_leases table + acquire_scheduler_lease
 * RPC, see supabase/scheduler_leases_migration.sql). Works across HOSTS, not
 * just processes on one machine — the RPC is a single atomic upsert, so two
 * instances racing the same tick can never both win.
 *
 * Fallback: the original tmpdir file lease (single-host only). Used when the
 * migration hasn't been applied yet, so nothing breaks pre-migration — with a
 * logged warning, once, that multi-host deployments risk double-publishing.
 *
 * Lease is refreshed every tick; if the leader dies, another claims after TTL.
 */

const LOCK_FILE = join(tmpdir(), 'personagen-scheduler.lock');
const LEASE_MS = 70_000; // > the 60s tick, so the leader keeps refreshing in time
const LEASE_NAME = 'scheduler';
const ME = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// Set once the DB lease is confirmed missing (migration not applied) so we
// don't hit the DB with a known-failing RPC on every tick.
let dbLeaseUnavailable = false;

function isMissingLeaseInfra(error: { code?: string; message?: string }): boolean {
	// PGRST202 = function not in schema cache, 42883 = undefined function,
	// 42P01 = undefined table — all mean scheduler_leases_migration.sql is unapplied.
	if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01') return true;
	return /does not exist|schema cache|not found/i.test(error.message || '');
}

/**
 * Multi-host leader lease via Postgres. Returns true iff this instance holds
 * the lease for this tick. Falls back to the single-host file lock (with a
 * one-time warning) when the lease table/RPC is missing or the DB errors.
 */
export async function acquireSchedulerLease(supabase: any): Promise<boolean> {
	if (!dbLeaseUnavailable) {
		try {
			const { data, error } = await supabase.rpc('acquire_scheduler_lease', {
				p_name: LEASE_NAME,
				p_holder: ME,
				p_ttl_ms: LEASE_MS
			});
			if (!error) return data === true;
			if (isMissingLeaseInfra(error)) {
				dbLeaseUnavailable = true;
				console.warn(
					'[Scheduler] DB leader lease unavailable — run supabase/scheduler_leases_migration.sql. ' +
						'Falling back to the single-host file lock (multi-host deployments risk double-publishing).'
				);
			} else {
				console.warn(
					`[Scheduler] DB lease acquire failed (${error.message}) — using file lock for this tick.`
				);
			}
		} catch (e) {
			console.warn(
				`[Scheduler] DB lease acquire threw (${(e as Error).message}) — using file lock for this tick.`
			);
		}
	}
	return acquireSchedulerLock();
}

/**
 * Heartbeat for long-running work (publish batches, autopilot generation runs)
 * that can outlive LEASE_MS. The lease is only held for ~70s, so a 2–5 min
 * generation — let alone a 24-slot run — expires it mid-flight and lets a
 * second instance get elected and DOUBLE-generate/double-publish. Callers must
 * invoke this between units of work and STOP the moment it returns false.
 *
 * Implementation: the same `acquire_scheduler_lease` RPC (same table/row) — its
 * SQL compares holder_id, so the call renews only while WE still hold the row
 * (or re-takes it if it expired unclaimed, which is equally safe). The moment
 * another instance holds a fresh lease it returns false. The file-lock fallback
 * has identical holder-compare semantics via acquireSchedulerLock().
 */
export async function renewSchedulerLease(supabase: any): Promise<boolean> {
	return acquireSchedulerLease(supabase);
}

/** Single-host file lease (OS temp dir, shared by all local instances). */
export function acquireSchedulerLock(): boolean {
	const now = Date.now();
	try {
		if (existsSync(LOCK_FILE)) {
			const cur = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
			const fresh = typeof cur.ts === 'number' && now - cur.ts < LEASE_MS;
			if (fresh && cur.holder !== ME) return false; // another instance leads
		}
		writeFileSync(LOCK_FILE, JSON.stringify({ holder: ME, ts: now }));
		// Re-read to resolve a near-simultaneous claim (last writer wins on one host).
		const after = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
		return after.holder === ME;
	} catch {
		// If the filesystem lock misbehaves, don't wedge the scheduler — run.
		return true;
	}
}
