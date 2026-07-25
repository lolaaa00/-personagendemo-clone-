/**
 * AUTOPILOT SLOT IDEMPOTENCY — a slot that already has a post must never be
 * regenerated, because every regeneration is a real paid fal/LLM/TTS call.
 * generateUgcPack / generateCinematicUgcPack are mocked, so a passing run here
 * provably spends $0 and makes no network call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockSupabase, type Handler, type MockSupabase } from '../tests/mock-supabase';

const { mockEnv, generateUgcPack, generateCinematicUgcPack, supabaseRef } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string>,
	generateUgcPack: vi.fn(),
	generateCinematicUgcPack: vi.fn(),
	supabaseRef: { current: null as any }
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./content/generate', () => ({ generateUgcPack, generateCinematicUgcPack }));
vi.mock('./service-supabase', () => ({ getServiceSupabase: () => supabaseRef.current }));

const { getLocalParts, zonedWallTimeToEpoch, runAutopilotDraftGeneration } =
	await import('./autopilot');

const AGENT = 'agent-1';
const USER = 'user-1';
const SYDNEY = 'Australia/Sydney';

// ── pure helpers ────────────────────────────────────────────────────────────

describe('getLocalParts', () => {
	it('reads the wall clock in the target timezone, not the host timezone', () => {
		const instant = new Date('2026-07-15T22:30:00Z'); // = 08:30 next day in Sydney (UTC+10)
		expect(getLocalParts(SYDNEY, instant)).toMatchObject({
			year: 2026,
			month: 7,
			day: 16,
			hour: 8,
			minute: 30,
			dateStr: '2026-07-16'
		});
		expect(getLocalParts('UTC', instant)).toMatchObject({ hour: 22, dateStr: '2026-07-15' });
	});

	it('normalises the 24:00 midnight some runtimes emit to hour 0', () => {
		const midnightSydney = new Date('2026-07-15T14:00:00Z'); // 00:00 on the 16th in Sydney
		const p = getLocalParts(SYDNEY, midnightSydney);
		expect(p.hour).toBe(0);
		expect(p.dateStr).toBe('2026-07-16');
	});
});

describe('zonedWallTimeToEpoch', () => {
	it('maps an 8am Sydney slot to the right UTC instant (AEST, UTC+10)', () => {
		expect(zonedWallTimeToEpoch('2026-07-15', '08:00:00', SYDNEY)).toBe(
			Date.UTC(2026, 6, 14, 22, 0, 0)
		);
	});

	it('respects DST — the same 8am wall time is an hour earlier in UTC under AEDT (UTC+11)', () => {
		expect(zonedWallTimeToEpoch('2026-01-15', '08:00:00', SYDNEY)).toBe(
			Date.UTC(2026, 0, 14, 21, 0, 0)
		);
	});

	it('is the exact inverse of getLocalParts across the whole 8am–8pm window', () => {
		for (const h of [8, 11, 14, 17, 20]) {
			const timeStr = `${String(h).padStart(2, '0')}:00:00`;
			const epoch = zonedWallTimeToEpoch('2026-07-15', timeStr, SYDNEY);
			const back = getLocalParts(SYDNEY, new Date(epoch));
			expect({ hour: back.hour, dateStr: back.dateStr }).toEqual({
				hour: h,
				dateStr: '2026-07-15'
			});
		}
	});

	it('handles UTC as an identity mapping', () => {
		expect(zonedWallTimeToEpoch('2026-07-15', '14:00:00', 'UTC')).toBe(
			Date.parse('2026-07-15T14:00:00Z')
		);
	});
});

// ── slot grid + idempotency ─────────────────────────────────────────────────

const CFG = {
	agent_id: AGENT,
	user_id: USER,
	autonomy_level: 'semi_autonomous',
	active_hours_start: 8,
	active_hours_end: 20,
	timezone: 'UTC',
	posts_per_day: 3
};

/** Rows returned for the "posts already in the window" lookup. */
function db(existingPosts: Array<{ scheduled_date: string; scheduled_time: string }>): MockSupabase {
	const handler: Handler = (q) => {
		if (q.table === 'agent_configs') return { data: CFG, error: null };
		if (q.table === 'connections')
			return { data: [{ platform: 'instagram' }], error: null }; // one active image-capable account
		if (q.table === 'posts' && q.op === 'select') {
			// stale-draft lookup filters on status='draft'; the window lookup doesn't
			if (q.has('eq', 'status', 'draft')) return { data: [], error: null };
			// slot-claim VERIFY (eq on a single scheduled_date, not .in): no
			// concurrent claimant by default — our own just-inserted placeholder is
			// filtered out by id, so [] is equivalent to "only our row exists"
			if (q.has('eq', 'scheduled_date')) return { data: [], error: null };
			return { data: existingPosts, error: null };
		}
		if (q.table === 'posts' && q.op === 'insert') return { data: null, error: null };
		return { data: [], error: null };
	};
	return createMockSupabase(handler);
}

const pack = (mediaType = 'image') => ({
	content: { media_type: mediaType, caption: 'hi', costBreakdown: { total: 0.7 } }
});

/** Slot times inserted, in order. */
const insertedSlots = (supabase: MockSupabase) =>
	supabase
		.of('posts', 'insert')
		.map((q) => `${q.payload.scheduled_date} ${q.payload.scheduled_time}`);

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	mockEnv.AUTOPILOT_LOOKAHEAD_DAYS = '2';
	mockEnv.AUTOPILOT_MAX_PER_RUN = '10';
	generateUgcPack.mockReset().mockResolvedValue(pack());
	generateCinematicUgcPack.mockReset().mockResolvedValue(pack());
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	// Freeze time at 00:00 UTC so every 8/14/20 slot of "today" is still future.
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('autopilot slot grid', () => {
	it('spreads posts_per_day evenly across the 8am–8pm active window (3/day → 08, 14, 20)', async () => {
		supabaseRef.current = db([]);
		const res = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(res.generated).toBe(6); // 3 slots × 2 lookahead days
		expect(insertedSlots(supabaseRef.current)).toEqual([
			'2026-07-15 08:00:00',
			'2026-07-15 14:00:00',
			'2026-07-15 20:00:00',
			'2026-07-16 08:00:00',
			'2026-07-16 14:00:00',
			'2026-07-16 20:00:00'
		]);
	});

	it('books exactly ONE cinematic post per day — the first slot — and standard elsewhere', async () => {
		supabaseRef.current = db([]);
		await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(generateCinematicUgcPack).toHaveBeenCalledTimes(2); // one per day
		expect(generateUgcPack).toHaveBeenCalledTimes(4);
	});

	it('never backfills a slot whose wall time has already passed today', async () => {
		vi.setSystemTime(new Date('2026-07-15T15:00:00Z')); // past 08:00 and 14:00
		supabaseRef.current = db([]);

		await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(insertedSlots(supabaseRef.current)).toEqual([
			'2026-07-15 20:00:00',
			'2026-07-16 08:00:00',
			'2026-07-16 14:00:00',
			'2026-07-16 20:00:00'
		]);
	});

	it('caps per-run spend at AUTOPILOT_MAX_PER_RUN', async () => {
		mockEnv.AUTOPILOT_MAX_PER_RUN = '2';
		supabaseRef.current = db([]);

		const res = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(res.generated).toBe(2);
		expect(generateUgcPack.mock.calls.length + generateCinematicUgcPack.mock.calls.length).toBe(2);
	});
});

describe('autopilot slot idempotency (no double spend)', () => {
	it('does NOT regenerate a slot that already has a post', async () => {
		supabaseRef.current = db([
			{ scheduled_date: '2026-07-15', scheduled_time: '08:00:00' },
			{ scheduled_date: '2026-07-15', scheduled_time: '14:00:00' }
		]);

		const res = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(res.generated).toBe(4);
		expect(insertedSlots(supabaseRef.current)).not.toContain('2026-07-15 08:00:00');
		expect(insertedSlots(supabaseRef.current)).not.toContain('2026-07-15 14:00:00');
		// The taken 08:00 slot is the cinematic one — the expensive path must not fire for day 1.
		expect(generateCinematicUgcPack).toHaveBeenCalledTimes(1); // only 2026-07-16
	});

	it('a fully-booked runway spends NOTHING (zero generator calls, zero inserts)', async () => {
		supabaseRef.current = db(
			['2026-07-15', '2026-07-16'].flatMap((d) =>
				['08:00:00', '14:00:00', '20:00:00'].map((t) => ({
					scheduled_date: d,
					scheduled_time: t
				}))
			)
		);

		const res = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(res.generated).toBe(0);
		expect(generateUgcPack).not.toHaveBeenCalled();
		expect(generateCinematicUgcPack).not.toHaveBeenCalled();
		expect(supabaseRef.current.of('posts', 'insert')).toHaveLength(0);
	});

	it('matches an existing post to its slot on HH:MM (seconds/precision differences do not double-book)', async () => {
		supabaseRef.current = db([
			{ scheduled_date: '2026-07-15', scheduled_time: '08:00' }, // no seconds
			{ scheduled_date: '2026-07-15', scheduled_time: '14:00:00.000' } // extra precision
		]);

		await runAutopilotDraftGeneration({ agentId: AGENT });

		const slots = insertedSlots(supabaseRef.current);
		expect(slots).not.toContain('2026-07-15 08:00:00');
		expect(slots).not.toContain('2026-07-15 14:00:00');
	});

	it('re-running back-to-back against the posts it just created creates nothing new', async () => {
		// First run on an empty calendar.
		supabaseRef.current = db([]);
		const first = await runAutopilotDraftGeneration({ agentId: AGENT });
		const created = supabaseRef.current
			.of('posts', 'insert')
			.map((q: any) => ({
				scheduled_date: q.payload.scheduled_date,
				scheduled_time: q.payload.scheduled_time
			}));
		expect(first.generated).toBe(6);

		// Second run now sees them as existing → idempotent, no extra spend.
		generateUgcPack.mockClear();
		generateCinematicUgcPack.mockClear();
		supabaseRef.current = db(created);
		const second = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(second.generated).toBe(0);
		expect(generateUgcPack).not.toHaveBeenCalled();
		expect(generateCinematicUgcPack).not.toHaveBeenCalled();
	});

	it('aborts the agent after repeated insert failures — and pays NOTHING (claim precedes generation)', async () => {
		const handler: Handler = (q: any) => {
			if (q.table === 'agent_configs') return { data: CFG, error: null };
			if (q.table === 'connections') return { data: [{ platform: 'instagram' }], error: null };
			if (q.table === 'posts' && q.op === 'select') return { data: [], error: null };
			if (q.table === 'posts' && q.op === 'insert')
				return { data: null, error: { message: 'insert failed' } };
			return { data: [], error: null };
		};
		supabaseRef.current = createMockSupabase(handler);

		const res = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(res.generated).toBe(0);
		// The slot claim (placeholder insert) now happens BEFORE the paid call, so
		// a DB that rejects every write costs $0 — and the agent still aborts after
		// MAX_CONSECUTIVE_INSERT_FAILURES (3) instead of grinding the whole runway.
		expect(supabaseRef.current.of('posts', 'insert')).toHaveLength(3);
		expect(generateUgcPack.mock.calls.length + generateCinematicUgcPack.mock.calls.length).toBe(
			0
		);
	});
});

describe('autopilot draft status', () => {
	it('semi_autonomous agents get DRAFTS (user approves before anything goes live)', async () => {
		supabaseRef.current = db([]);
		await runAutopilotDraftGeneration({ agentId: AGENT });

		// Claim-first flow: every insert is a 'generating' placeholder (the slot
		// claim), and the paid content lands via an UPDATE that finalizes the row
		// as a draft — never 'scheduled', never straight to live.
		const insertStatuses = supabaseRef.current
			.of('posts', 'insert')
			.map((q: any) => q.payload.status);
		expect(new Set(insertStatuses)).toEqual(new Set(['generating']));
		const finalStatuses = supabaseRef.current
			.of('posts', 'update')
			.map((q: any) => q.payload.status)
			.filter((s: any) => s !== undefined);
		expect(finalStatuses.length).toBeGreaterThan(0);
		expect(new Set(finalStatuses)).toEqual(new Set(['draft']));
	});

	it('image-only content is not booked onto a video-only platform (claim released)', async () => {
		const handler: Handler = (q) => {
			if (q.table === 'agent_configs') return { data: CFG, error: null };
			if (q.table === 'connections') return { data: [{ platform: 'tiktok' }], error: null };
			if (q.table === 'posts' && q.op === 'select') return { data: [], error: null };
			return { data: null, error: null };
		};
		supabaseRef.current = createMockSupabase(handler);
		generateUgcPack.mockResolvedValue(pack('image'));
		generateCinematicUgcPack.mockResolvedValue(pack('image'));

		const res = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(res.generated).toBe(0);
		// Each unbookable slot's placeholder claim is deleted again — no stranded
		// 'generating' rows, and no post ever finalized to draft/scheduled.
		const inserts = supabaseRef.current.of('posts', 'insert');
		const deletes = supabaseRef.current.of('posts', 'delete');
		expect(deletes).toHaveLength(inserts.length);
		const insertedIds = inserts.map((q: any) => q.payload.id);
		for (const d of deletes) expect(insertedIds).toContain(d.eqOf('id'));
		const finalized = supabaseRef.current
			.of('posts', 'update')
			.map((q: any) => q.payload.status)
			.filter((s: any) => s === 'draft' || s === 'scheduled');
		expect(finalized).toHaveLength(0);
	});
});

// ── concurrency: lease heartbeat + atomic slot claims ───────────────────────

describe('autopilot concurrency guards', () => {
	it('stops BEFORE the next paid generation once shouldContinue (lease renewal) fails', async () => {
		supabaseRef.current = db([]);
		// Call order: 1 = outer per-agent check, then one check per slot BEFORE
		// its paid generation. Calls 1–3 succeed (2 slots generate), then the
		// lease is lost and every later renewal fails.
		let calls = 0;
		const shouldContinue = vi.fn(async () => ++calls <= 3);

		const res = await runAutopilotDraftGeneration({ agentId: AGENT, shouldContinue });

		expect(res.generated).toBe(2);
		// The money assertion: NOTHING was paid after the lease was lost.
		expect(generateUgcPack.mock.calls.length + generateCinematicUgcPack.mock.calls.length).toBe(
			2
		);
	});

	it('claims the slot with a generating placeholder BEFORE the paid generation call', async () => {
		supabaseRef.current = db([]);
		generateCinematicUgcPack.mockImplementation(async () => {
			// At paid-call time the slot claim must already be in the DB.
			const lastInsert = supabaseRef.current.of('posts', 'insert').at(-1);
			expect(lastInsert?.payload.status).toBe('generating');
			return pack();
		});

		await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(generateCinematicUgcPack).toHaveBeenCalled();
	});

	it('a slot double-claimed by a concurrent run is skipped WITHOUT paying (own row deleted)', async () => {
		const handler: Handler = (q) => {
			if (q.table === 'agent_configs') return { data: CFG, error: null };
			if (q.table === 'connections') return { data: [{ platform: 'instagram' }], error: null };
			if (q.table === 'posts' && q.op === 'select') {
				if (q.has('eq', 'status', 'draft')) return { data: [], error: null };
				// VERIFY select: another run's placeholder is also sitting on the slot.
				if (q.has('eq', 'scheduled_date'))
					return { data: [{ id: 'someone-elses-claim' }], error: null };
				return { data: [], error: null };
			}
			return { data: null, error: null };
		};
		supabaseRef.current = createMockSupabase(handler);

		const res = await runAutopilotDraftGeneration({ agentId: AGENT });

		expect(res.generated).toBe(0);
		// Backed off on every slot: zero paid calls, and every own placeholder was
		// deleted (never the other run's row).
		expect(generateUgcPack).not.toHaveBeenCalled();
		expect(generateCinematicUgcPack).not.toHaveBeenCalled();
		const inserts = supabaseRef.current.of('posts', 'insert');
		const deletes = supabaseRef.current.of('posts', 'delete');
		expect(inserts.length).toBeGreaterThan(0);
		expect(deletes).toHaveLength(inserts.length);
		const insertedIds = inserts.map((q: any) => q.payload.id);
		for (const d of deletes) expect(insertedIds).toContain(d.eqOf('id'));
	});
});
