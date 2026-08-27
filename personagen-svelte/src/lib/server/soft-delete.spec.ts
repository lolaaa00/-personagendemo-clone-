/**
 * TRASH SAFETY — a soft-deleted post must never behave like a live one.
 *
 * Deleting a post used to be a hard DELETE, so "is this row deleted?" was never
 * a question any query had to ask. Now that deletes only stamp `deleted_at`, the
 * row is still sitting in `posts`, and EVERY read path has to filter it out.
 *
 * The worst failure that buys us is not cosmetic: the scheduler picks up a post
 * the user deleted and publishes it to a real social account. These tests pin
 * the filter onto the paths where that can happen, so removing one fails here
 * instead of in production.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, type Handler, type RecordedQuery } from '../tests/mock-supabase';

const { publishToPlatform, runAutopilotDraftGeneration, mockEnv, supabaseRef } = vi.hoisted(() => ({
	publishToPlatform: vi.fn(),
	runAutopilotDraftGeneration: vi.fn(),
	mockEnv: {} as Record<string, string>,
	supabaseRef: { current: null as any }
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('./social/publisher', () => ({ publishToPlatform }));
vi.mock('./social/zernio', () => ({
	getZernioApiKey: vi.fn(async () => null),
	ZernioClient: class {}
}));
vi.mock('./service-supabase', () => ({ getServiceSupabase: () => supabaseRef.current }));
vi.mock('./scheduler-lock', () => ({
	acquireSchedulerLease: vi.fn(async () => true),
	renewSchedulerLease: vi.fn(async () => true)
}));
vi.mock('./autopilot', () => ({
	getLocalParts: vi.fn(() => ({ hour: 12 })),
	zonedWallTimeToEpoch: vi.fn(() => 0),
	runAutopilotDraftGeneration
}));

const { publishSinglePost, pollScheduledPosts } = await import('./scheduler');
const { createDbService } = await import('./db');

/** The soft-delete guard, in the shape PostgREST records it. */
const EXCLUDES_TRASHED = (q: RecordedQuery) => q.has('is', 'deleted_at', null);

function db(handler: Handler = () => ({ data: [], error: null })) {
	return createMockSupabase(handler);
}

beforeEach(() => {
	publishToPlatform.mockReset();
	runAutopilotDraftGeneration.mockReset();
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the scheduler cannot publish a trashed post', () => {
	it('the due-post sweep only ever selects live posts', async () => {
		const supabase = db();
		supabaseRef.current = supabase;
		mockEnv.CRON_SECRET = '';

		await pollScheduledPosts();

		const dueSweeps = supabase
			.of('posts', 'select')
			.filter((q) => q.has('eq', 'status', 'scheduled'));
		expect(dueSweeps.length).toBeGreaterThan(0);
		for (const q of dueSweeps) expect(EXCLUDES_TRASHED(q)).toBe(true);
	});

	it('the atomic claim re-checks deleted_at, closing the delete-during-tick race', async () => {
		// The window this covers: the due-post SELECT saw the post as live, the
		// user hit the trash can, and only THEN did the worker try to claim it.
		// Without the guard on the claim itself, the publish still goes out.
		const supabase = db((q) =>
			q.table === 'posts' && q.op === 'update'
				? { data: [], error: null }
				: { data: [], error: null }
		);

		await publishSinglePost(supabase, {
			id: 'post-1',
			agent_id: 'a1',
			user_id: 'u1',
			status: 'scheduled',
			platforms: ['instagram'],
			publication_results: null,
			published_at: null,
			content: '{}'
		});

		const claim = supabase.of('posts', 'update').find((q) => q.has('eq', 'status', 'scheduled'));
		expect(claim).toBeDefined();
		expect(EXCLUDES_TRASHED(claim!)).toBe(true);
		// Zero rows matched, so nothing was ever sent to a platform.
		expect(publishToPlatform).not.toHaveBeenCalled();
	});
});

describe('db.posts', () => {
	it('delete is SOFT — it stamps deleted_at instead of removing the row', async () => {
		const supabase = db();
		await createDbService(supabase as any).posts.softDelete('p1');

		const q = supabase.of('posts', 'update').at(-1)!;
		expect(q.payload).toHaveProperty('deleted_at');
		expect(q.payload.deleted_at).toEqual(expect.any(String));
		// No real DELETE was issued — that is the whole point.
		expect(supabase.of('posts', 'delete')).toHaveLength(0);
		// Already-trashed rows are excluded, so a double click can't push the
		// retention deadline forward.
		expect(EXCLUDES_TRASHED(q)).toBe(true);
	});

	it('list defaults to live posts when no scope is given', async () => {
		const supabase = db();
		await createDbService(supabase as any).posts.list({ agent_id: 'a1' });
		const q = supabase.of('posts', 'select').at(-1)!;
		expect(EXCLUDES_TRASHED(q)).toBe(true);
	});

	it("list scope 'trashed' reads the OTHER side, and only for the Trash view", async () => {
		const supabase = db();
		await createDbService(supabase as any).posts.list({ scope: 'trashed' });
		const q = supabase.of('posts', 'select').at(-1)!;
		expect(q.has('not', 'deleted_at', 'is')).toBe(true);
		expect(EXCLUDES_TRASHED(q)).toBe(false);
	});

	it('update refuses to touch a trashed row', async () => {
		const supabase = db();
		await createDbService(supabase as any).posts.update('p1', { status: 'scheduled' });
		const q = supabase.of('posts', 'update').at(-1)!;
		expect(EXCLUDES_TRASHED(q)).toBe(true);
	});

	it('restore only matches rows that are actually in the Trash', async () => {
		const supabase = db();
		await createDbService(supabase as any).posts.restoreMany(['p1']);
		const q = supabase.of('posts', 'update').at(-1)!;
		expect(q.payload).toEqual({ deleted_at: null });
		expect(q.has('not', 'deleted_at', 'is')).toBe(true);
	});

	it('purge is the ONLY real delete, and it cannot touch a live post', async () => {
		const supabase = db();
		await createDbService(supabase as any).posts.purgeMany(['p1']);
		const q = supabase.of('posts', 'delete').at(-1)!;
		expect(q.has('not', 'deleted_at', 'is')).toBe(true);
	});
});
