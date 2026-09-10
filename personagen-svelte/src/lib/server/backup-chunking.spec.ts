/**
 * The restore proof must not decay as the product succeeds.
 *
 * `npm run backup:check-restore` sent one table per request. That worked until
 * a table outgrew the endpoint: on 2026-09-10 `user_activity_events` reached
 * 1.1 MB of JSON and every run began failing with
 *
 *     user_activity_events: will NOT load — HTTP 500: Request body is too large
 *
 * which blocked the deploy gate and the migration hook that depend on it — the
 * safety rail became the outage. And it was a ratchet: the activity log only
 * grows, so it would never have recovered on its own.
 *
 * These read the script as text rather than importing it, because backup-db.mjs
 * runs its main at module scope and dies without a .env. That is a weaker test
 * than calling the function, so the byte-budget behaviour is re-implemented
 * from the script's own constant and exercised directly below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../../scripts/backup-db.mjs', import.meta.url), 'utf-8');

describe('the script under test was actually read', () => {
	it('is the backup script', () => {
		expect(script.length).toBeGreaterThan(4000);
		expect(script).toContain('async function checkRestore');
	});
});

describe('the restore proof batches by size', () => {
	it('has a byte budget, not a row count', () => {
		// Rows here range from a few hundred bytes to several KB, so any fixed row
		// count is either wasteful or eventually too big again.
		expect(script).toMatch(/MAX_BODY_BYTES\s*=\s*256\s*\*\s*1024/);
		expect(script).toContain('function chunkRows(');
	});

	it('the budget is well under the size that actually failed', () => {
		const m = script.match(/MAX_BODY_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)/);
		expect(m, 'MAX_BODY_BYTES must be a literal so this can check it').toBeTruthy();
		const bytes = Number(m![1]) * Number(m![2]);
		expect(bytes).toBeLessThan(1_100_000); // the observed failure
		expect(bytes).toBeGreaterThan(32 * 1024); // not so small it costs hundreds of round trips
	});

	it('both the proof and the emitted SQL use it — not just one', () => {
		// restore.sql had the same shape. A 20 MB single statement is also the
		// worst possible unit of failure during an actual restore.
		const proof = script.slice(script.indexOf('async function checkRestore'));
		expect(proof).toContain('chunkRows(rows)');
		const emit = script.slice(script.indexOf('function emitSql'), script.indexOf('async function checkRestore'));
		expect(emit).toContain('chunkRows(rows)');
	});

	it('counts rows across every batch, so a split cannot look like data loss', () => {
		// Summing per batch and comparing to rows.length is what makes a chunked
		// proof equivalent to the single-statement one it replaced.
		const proof = script.slice(script.indexOf('async function checkRestore'));
		expect(proof).toMatch(/n \+= out\[0\]\?\.n \?\? 0/);
		expect(proof).toMatch(/if \(n !== rows\.length\)/);
	});
});

describe('the batching rule itself', () => {
	// Re-implemented from the script so the behaviour is exercised, not just
	// asserted to exist.
	const MAX = 256 * 1024;
	function chunkRows(rows: unknown[]): unknown[][] {
		const out: unknown[][] = [];
		let batch: unknown[] = [];
		let bytes = 0;
		for (const row of rows) {
			const size = JSON.stringify(row).length + 1;
			if (batch.length > 0 && bytes + size > MAX) {
				out.push(batch);
				batch = [];
				bytes = 0;
			}
			batch.push(row);
			bytes += size;
		}
		if (batch.length > 0) out.push(batch);
		return out.length > 0 ? out : [[]];
	}

	const row = (n: number) => ({ id: n, blob: 'x'.repeat(1000) });

	it('keeps every batch under the budget', () => {
		const batches = chunkRows(Array.from({ length: 2000 }, (_, i) => row(i)));
		for (const b of batches) expect(JSON.stringify(b).length).toBeLessThanOrEqual(MAX + 2000);
		expect(batches.length).toBeGreaterThan(1);
	});

	it('loses nothing — every row lands in exactly one batch', () => {
		const rows = Array.from({ length: 2000 }, (_, i) => row(i));
		const flat = chunkRows(rows).flat();
		expect(flat).toHaveLength(rows.length);
		expect(new Set(flat.map((r) => (r as { id: number }).id)).size).toBe(rows.length);
	});

	it('a table that fits still goes in one request', () => {
		expect(chunkRows([row(1), row(2)])).toHaveLength(1);
	});

	it('a single oversized row goes alone rather than being skipped', () => {
		// Better one request that may fail loudly than a row silently dropped from
		// the proof — a proof that quietly skips data is worse than none.
		const huge = { id: 1, blob: 'x'.repeat(MAX * 2) };
		const batches = chunkRows([huge, row(2)]);
		expect(batches[0]).toHaveLength(1);
		expect(batches.flat()).toHaveLength(2);
	});

	it('an empty table yields one empty batch, never zero', () => {
		expect(chunkRows([])).toEqual([[]]);
	});
});
