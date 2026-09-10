/**
 * A per-second stage must never quote LESS than it bills.
 *
 * This is the one promise a duration-priced stage has to keep, and it has now
 * been broken twice, in two different ways:
 *
 *   1. The quote ROUNDED the measured duration. A 12.4s clip quoted 12 units
 *      ($0.72) and billed 12.4 ($0.744) — wrong for every clip whose fraction
 *      is under .5, i.e. about half of them. Fixed by ceiling.
 *   2. The route DROPPED an out-of-range duration instead of clamping it, so
 *      the quote fell back to the planner's 5s default while the engine clamped
 *      the same value to 30. A forged `source_seconds: 999` quoted $0.30 and
 *      billed $1.80. Found by driving the running app, not by a unit test.
 *
 * Both were arithmetic agreeing with itself inside one layer while disagreeing
 * across the boundary, which is why the sweep below is written against the
 * INVARIANT rather than against either implementation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { billedUnits, MAX_SECONDS, MIN_SECONDS, getFormat, type StepModel } from '$lib/formats';

const perSecond: StepModel = {
	id: 'fal-ai/wan/v2.2-14b/animate/replace',
	label: 'transfer',
	usd: 0.06,
	provider: 'fal',
	billing: 'per_second'
};

/** What the engine will actually charge for a duration (v2vBillableSeconds). */
const engineSeconds = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SECONDS) : 5);

/** What the composer and the server preview show (planPipeline → billedUnits). */
const quotedUnits = (n?: number) =>
	billedUnits('v2v', perSecond, { formatId: 'reel-remake', seconds: n }, getFormat('reel-remake'));

describe('the quote is an upper bound on the bill, at every duration', () => {
	it('holds across the whole accepted range, in tenths', () => {
		const bad: string[] = [];
		for (let s = 0.1; s <= MAX_SECONDS; s = +(s + 0.1).toFixed(1)) {
			if (quotedUnits(s) + 1e-9 < engineSeconds(s)) bad.push(`${s}s`);
		}
		expect(bad, `quoted less than billed at: ${bad.slice(0, 10).join(', ')}`).toEqual([]);
	});

	it('holds for durations the ingest gate would never have accepted', () => {
		// The composer cannot produce these — ingest caps a clip at MAX_SECONDS —
		// but `source_seconds` arrives on a request body, and the engine clamps
		// rather than refusing. So the quote has to clamp the same way.
		for (const s of [MAX_SECONDS + 0.1, 99, 999, 1e6]) {
			expect(quotedUnits(s), `${s}s`).toBeGreaterThanOrEqual(engineSeconds(s));
		}
	});

	it('never quotes zero for a nonsense duration', () => {
		// A free-looking stage that then charges is the same lie in the other
		// direction; the floor is what stops it.
		for (const s of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
			expect(quotedUnits(s as number), String(s)).toBeGreaterThanOrEqual(MIN_SECONDS);
		}
	});
});

describe('the route clamps the duration rather than dropping it', () => {
	const route = readFileSync(
		join(
			__dirname,
			'..',
			'..',
			'routes',
			'api',
			'agent',
			'[agentId]',
			'generate-post',
			'+server.ts'
		),
		'utf8'
	);

	it('clamps source_seconds into the ingest bounds', () => {
		const block = route.slice(
			route.indexOf('const rawSourceSeconds'),
			route.indexOf('const v2vMode')
		);
		expect(block).toMatch(
			/Math\.min\(Math\.max\(rawSourceSeconds, MIN_CLIP_SECONDS\), MAX_CLIP_SECONDS\)/
		);
		// The regression itself: a range test that yields `undefined` sends the
		// quote back to the planner's default while the engine still clamps.
		expect(block).not.toMatch(/rawSourceSeconds <= MAX_CLIP_SECONDS\s*\n?\s*\?/);
	});

	it('still drops a value that is not a duration at all', () => {
		// Absence and out-of-range are different: NaN, a string or a missing url
		// mean "no measurement", which is not the same as "too long".
		const block = route.slice(
			route.indexOf('const rawSourceSeconds'),
			route.indexOf('const v2vMode')
		);
		expect(block).toMatch(/Number\.isFinite\(rawSourceSeconds\)/);
		expect(block).toMatch(/sourceVideoUrl &&/);
	});
});
