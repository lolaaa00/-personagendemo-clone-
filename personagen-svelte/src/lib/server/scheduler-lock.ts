import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Single-instance leader lock for the scheduler.
 *
 * Multiple app instances on one machine (dev servers + preview/prod) each boot a
 * scheduler. Without coordination they'd all publish the same due posts -> double
 * posting. This file lease (in the OS temp dir, shared by all local instances)
 * elects ONE leader that does the publishing/autopilot work; the rest no-op.
 *
 * For multi-host production, swap this for a DB/Redis lease — same `acquireSchedulerLock`
 * contract. Lease is refreshed every tick; if the leader dies, another claims after TTL.
 */

const LOCK_FILE = join(tmpdir(), 'personagen-scheduler.lock');
const LEASE_MS = 70_000; // > the 60s tick, so the leader keeps refreshing in time
const ME = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

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
