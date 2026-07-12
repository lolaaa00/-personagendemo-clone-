/**
 * ATOMIC PUBLISH CLAIM — the guard that stops two workers publishing the same
 * post to a LIVE social account. Every external dependency (the publisher, the
 * Zernio client, the service supabase client) is mocked: no network, no keys.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, type Handler, type RecordedQuery } from '../tests/mock-supabase';

const { publishToPlatform } = vi.hoisted(() => ({ publishToPlatform: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('./social/publisher', () => ({ publishToPlatform }));
vi.mock('./social/zernio', () => ({
	getZernioApiKey: vi.fn(async () => null),
	ZernioClient: class {}
}));
vi.mock('./service-supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('./scheduler-lock', () => ({ acquireSchedulerLease: vi.fn(async () => true) }));
vi.mock('./autopilot', () => ({
	getLocalParts: vi.fn(() => ({ hour: 12 })),
	zonedWallTimeToEpoch: vi.fn(() => 0),
	runAutopilotDraftGeneration: vi.fn()
}));

const { publishSinglePost } = await import('./scheduler');

const POST_ID = 'post-123';

function basePost(overrides: Record<string, any> = {}) {
	return {
		id: POST_ID,
		agent_id: 'agent-1',
		user_id: 'user-1',
		status: 'scheduled',
		platforms: ['instagram'],
		publication_results: null,
		published_at: null,
		content: '{}',
		...overrides
	};
}

/** Is this query the atomic claim (posts UPDATE guarded on status='scheduled')? */
function isClaim(q: RecordedQuery) {
	return q.table === 'posts' && q.op === 'update' && q.has('eq', 'status', 'scheduled');
}

/** Handler that answers the claim with `claimResult` and everything else sanely. */
function schedulerDb(claimResult: { data?: any; error?: any }, connections: any[] = []) {
	const handler: Handler = (q) => {
		if (isClaim(q)) return claimResult;
		if (q.table === 'connections' && q.op === 'select') return { data: connections, error: null };
		if (q.table === 'posts' && q.op === 'update') return { data: null, error: null }; // final update
		if (q.table === 'connections' && q.op === 'update') return { data: null, error: null };
		return { data: [], error: null };
	};
	return createMockSupabase(handler);
}

const activeConn = (platform: string) => ({
	id: `conn-${platform}`,
	agent_id: 'agent-1',
	platform,
	status: 'active'
});

beforeEach(() => {
	publishToPlatform.mockReset();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('publishSinglePost — exactly-once claim', () => {
	it('LOST CLAIM (zero rows updated): returns false and NEVER calls the publisher', async () => {
		// Another worker already flipped scheduled -> publishing, so our guarded
		// UPDATE matched no rows. Publishing anyway = a duplicate live post.
		const supabase = schedulerDb({ data: [], error: null }, [activeConn('instagram')]);

		const result = await publishSinglePost(supabase, basePost());

		expect(result).toBe(false);
		expect(publishToPlatform).not.toHaveBeenCalled();
		// And it bailed before ever touching the row again.
		expect(supabase.of('posts', 'update')).toHaveLength(1);
	});

	it('LOST CLAIM (null rows): returns false and NEVER calls the publisher', async () => {
		const supabase = schedulerDb({ data: null, error: null }, [activeConn('instagram')]);

		const result = await publishSinglePost(supabase, basePost());

		expect(result).toBe(false);
		expect(publishToPlatform).not.toHaveBeenCalled();
	});

	it('CLAIM ERROR: FAILS CLOSED — returns false, does not publish, does not fall through', async () => {
		// e.g. posts_status_check rejects 'publishing' (migration not applied).
		// Falling through here would publish with NO claim guard, so two
		// overlapping ticks would both go live.
		const supabase = schedulerDb(
			{ data: null, error: { message: 'violates check constraint "posts_status_check"' } },
			[activeConn('instagram')]
		);

		const result = await publishSinglePost(supabase, basePost());

		expect(result).toBe(false);
		expect(publishToPlatform).not.toHaveBeenCalled();
		expect(supabase.of('connections')).toHaveLength(0); // never got as far as loading accounts
	});

	it('claims with the compare-and-set guard: eq(id) AND eq(status, scheduled)', async () => {
		const supabase = schedulerDb({ data: [{ id: POST_ID }], error: null }, [
			activeConn('instagram')
		]);
		publishToPlatform.mockResolvedValue({ success: true, provider: 'zernio', externalId: 'x1' });

		await publishSinglePost(supabase, basePost());

		const claim = supabase.of('posts', 'update').find(isClaim)!;
		expect(claim.has('eq', 'id', POST_ID)).toBe(true);
		expect(claim.has('eq', 'status', 'scheduled')).toBe(true);
		expect(claim.payload.status).toBe('publishing');
	});

	it('WON CLAIM: publishes and marks the post published (positive control)', async () => {
		const supabase = schedulerDb({ data: [{ id: POST_ID }], error: null }, [
			activeConn('instagram')
		]);
		publishToPlatform.mockResolvedValue({
			success: true,
			provider: 'zernio',
			externalId: 'IG123'
		});

		const result = await publishSinglePost(supabase, basePost());

		expect(result).toBe(true);
		expect(publishToPlatform).toHaveBeenCalledTimes(1);
		const final = supabase.of('posts', 'update').at(-1)!;
		expect(final.payload.status).toBe('published');
		expect(final.payload.publication_results.instagram.status).toBe('published');
		expect(final.payload.external_id).toBe('IG123');
	});
});

describe('publishSinglePost — no re-sending already-published platforms', () => {
	it('a platform recorded as published is NOT re-sent on a retry', async () => {
		const post = basePost({
			platforms: ['instagram', 'x'],
			publication_results: {
				instagram: { status: 'published', provider: 'zernio', external_id: 'IG-OLD' },
				x: { status: 'failed', error: 'fetch failed' },
				_post: { attempts: 1 }
			}
		});
		const supabase = schedulerDb({ data: [{ id: POST_ID }], error: null }, [
			activeConn('instagram'),
			activeConn('x')
		]);
		publishToPlatform.mockResolvedValue({ success: true, provider: 'zernio', externalId: 'X-NEW' });

		const result = await publishSinglePost(supabase, post);

		expect(result).toBe(true);
		// Only the FAILED platform is retried — Instagram is already live.
		expect(publishToPlatform).toHaveBeenCalledTimes(1);
		expect(publishToPlatform.mock.calls[0][0].platform).toBe('x');

		// The claim payload must not stomp instagram back to 'publishing'.
		const claim = supabase.of('posts', 'update').find(isClaim)!;
		expect(claim.payload.publication_results.instagram.status).toBe('published');
		expect(claim.payload.publication_results.x.status).toBe('publishing');

		// Final state keeps the original Instagram evidence.
		const final = supabase.of('posts', 'update').at(-1)!;
		expect(final.payload.publication_results.instagram.external_id).toBe('IG-OLD');
		expect(final.payload.status).toBe('published');
	});

	it('a fully-published post re-run publishes nothing at all', async () => {
		const post = basePost({
			platforms: ['instagram'],
			published_at: '2026-07-01T00:00:00.000Z',
			publication_results: {
				instagram: { status: 'published', provider: 'zernio', external_id: 'IG-OLD' }
			}
		});
		const supabase = schedulerDb({ data: [{ id: POST_ID }], error: null }, [
			activeConn('instagram')
		]);

		const result = await publishSinglePost(supabase, post);

		expect(publishToPlatform).not.toHaveBeenCalled();
		// Nothing NEW was published this run, but the post is still 'published'
		// and its original published_at is preserved.
		expect(result).toBe(false);
		const final = supabase.of('posts', 'update').at(-1)!;
		expect(final.payload.status).toBe('published');
		expect(final.payload.published_at).toBe('2026-07-01T00:00:00.000Z');
	});
});

describe('publishSinglePost — failure handling', () => {
	it('a transient failure reverts the post to scheduled with a backoff window', async () => {
		const supabase = schedulerDb({ data: [{ id: POST_ID }], error: null }, [
			activeConn('instagram')
		]);
		publishToPlatform.mockResolvedValue({
			success: false,
			provider: 'zernio',
			error: 'fetch failed (ECONNRESET)'
		});

		const result = await publishSinglePost(supabase, basePost());

		expect(result).toBe(false);
		const final = supabase.of('posts', 'update').at(-1)!;
		expect(final.payload.status).toBe('scheduled');
		expect(final.payload.publication_results._post.not_before).toBeTruthy();
	});

	it('a thrown publisher error is contained (post is not abandoned in publishing)', async () => {
		const supabase = schedulerDb({ data: [{ id: POST_ID }], error: null }, [
			activeConn('instagram')
		]);
		publishToPlatform.mockRejectedValue(new Error('boom: unexpected'));

		const result = await publishSinglePost(supabase, basePost());

		expect(result).toBe(false);
		const final = supabase.of('posts', 'update').at(-1)!;
		expect(final.payload.status).toBe('failed');
		expect(final.payload.publication_results.instagram.status).toBe('failed');
	});

	it('a platform with no connected account is skipped, not published', async () => {
		const supabase = schedulerDb({ data: [{ id: POST_ID }], error: null }, []);

		const result = await publishSinglePost(supabase, basePost());

		expect(result).toBe(false);
		expect(publishToPlatform).not.toHaveBeenCalled();
		const final = supabase.of('posts', 'update').at(-1)!;
		expect(final.payload.publication_results.instagram.status).toBe('skipped');
	});
});
