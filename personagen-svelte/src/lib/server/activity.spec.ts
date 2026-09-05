import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		throw new Error('no service key in tests');
	}
}));

const act = await import('./activity');

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	mockEnv.ACTIVITY_LOG = 'on';
	mockEnv.ACTIVITY_PEPPER = 'test-pepper';
	act._resetActivityForTests();
});

/** A fake service client that records inserts/upserts and can fail N times. */
function fakeClient(opts: { failInserts?: number } = {}) {
	let failsLeft = opts.failInserts ?? 0;
	const inserted: any[][] = [];
	const upserted: any[][] = [];
	return {
		inserted,
		upserted,
		from(table: string) {
			return {
				insert: async (rows: any[]) => {
					if (table !== 'user_activity_events') throw new Error('wrong table');
					if (failsLeft > 0) {
						failsLeft--;
						return { error: { message: 'db down' } };
					}
					inserted.push(rows);
					return { error: null };
				},
				upsert: async (rows: any[]) => {
					upserted.push(rows);
					return { error: null };
				}
			};
		}
	};
}

describe('sanitizeMeta — nothing personal gets through', () => {
	it('keeps scalars and short strings, drops emails, secrets, long strings, nested objects, sensitive keys', () => {
		const out = act.sanitizeMeta({
			page: '/calendar',
			count: 3,
			ok: true,
			who: 'someone@example.com',
			key: 'pg_live_abcdef',
			jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc',
			long: 'x'.repeat(201),
			nested: { a: 1 },
			prompt: 'never',
			password: 'never',
			tags: ['a', 'b', 'me@x.io', 7]
		});
		expect(out).toEqual({ page: '/calendar', count: 3, ok: true, tags: ['a', 'b', 7] });
	});

	it('never throws on junk', () => {
		expect(act.sanitizeMeta(null)).toEqual({});
		expect(act.sanitizeMeta('str')).toEqual({});
		expect(act.sanitizeMeta([1, 2])).toEqual({});
	});

	it('caps the number of keys', () => {
		const big: Record<string, number> = {};
		for (let i = 0; i < 40; i++) big[`k${i}`] = i;
		expect(Object.keys(act.sanitizeMeta(big))).toHaveLength(24);
	});
});

describe('reduceUserAgent', () => {
	it.each([
		['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'Chrome', 'desktop'],
		['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'Safari', 'mobile'],
		['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0', 'Edge', 'desktop'],
		['Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0', 'Firefox', 'desktop'],
		['node', 'node', 'api'],
		['curl/8.4.0', 'curl', 'api'],
		['Googlebot/2.1 (+http://www.google.com/bot.html)', 'bot', 'bot'],
		['', null, null]
	])('%s → %s / %s', (ua, family, device) => {
		expect(act.reduceUserAgent(ua)).toEqual({ family, device });
	});
});

describe('hashes', () => {
	it('ip hash is stable within a day, differs across days, never contains the ip', () => {
		const d1 = new Date('2026-09-05T10:00:00Z');
		const d2 = new Date('2026-09-06T10:00:00Z');
		const a = act.hashIp('203.0.113.7', 'p', d1);
		expect(a).toBe(act.hashIp('203.0.113.7', 'p', d1));
		expect(a).not.toBe(act.hashIp('203.0.113.7', 'p', d2));
		expect(a).not.toContain('203');
		expect(act.hashIp(null, 'p')).toBeNull();
	});

	it('subject hash is stable per user and pepper', () => {
		expect(act.subjectHash('u1', 'p')).toBe(act.subjectHash('u1', 'p'));
		expect(act.subjectHash('u1', 'p')).not.toBe(act.subjectHash('u1', 'q'));
	});

	it('requestContext reads proxy headers and reduces them', () => {
		const req = new Request('http://x/', {
			headers: {
				'cf-connecting-ip': '198.51.100.9',
				'cf-ipcountry': 'au',
				'user-agent': 'curl/8.0'
			}
		});
		const ctx = act.requestContext(req);
		expect(ctx.country).toBe('AU');
		expect(ctx.uaFamily).toBe('curl');
		expect(ctx.device).toBe('api');
		expect(ctx.ipHash).toHaveLength(32);
	});
});

describe('shouldLog / routeAction', () => {
	it.each([
		['/api/agent/[agentId]/generate-post', 'POST', '/api/agent/1/generate-post', true],
		['/api/posts', 'GET', '/api/posts?x', false],
		['/api/posts', 'DELETE', '/api/posts', true],
		['/api/health', 'GET', '/api/health', false],
		['/api/auth/login', 'POST', '/api/auth/login', true],
		['/(portal)/calendar', 'GET', '/calendar', true],
		['/(portal)/calendar', 'GET', '/calendar/__data.json', true],
		['/(auth)/login', 'GET', '/login', true],
		['/media/[...path]', 'GET', '/media/a.mp4', false],
		[null, 'GET', '/whatever', false],
		['/api/agent/[agentId]/spend', 'GET', '/api/agent/1/spend', false]
	])('%s %s → %s', (routeId, method, path, want) => {
		expect(act.shouldLog(routeId as any, method, path)).toBe(want);
	});

	it('maps routes to actions', () => {
		expect(act.routeAction('/(portal)/calendar', 'GET', 200)).toEqual({ action: 'nav.page.view', meta: { page: '/calendar' } });
		expect(act.routeAction('/api/auth/login', 'POST', 200).action).toBe('auth.login.success');
		expect(act.routeAction('/api/auth/login', 'POST', 401).action).toBe('auth.login.failed');
		expect(act.routeAction('/api/review', 'POST', 200).action).toBe('review.decision');
		expect(act.routeAction('/api/unknown', 'POST', 200)).toEqual({ action: 'api.request', meta: { route: '/api/unknown' } });
	});

	it('outcome from status', () => {
		expect(act.outcomeFor(200)).toBe('ok');
		expect(act.outcomeFor(403)).toBe('denied');
		expect(act.outcomeFor(402)).toBe('blocked');
		expect(act.outcomeFor(500)).toBe('error');
	});
});

describe('queue — fail soft, count loss', () => {
	it('is a no-op when ACTIVITY_LOG is off', async () => {
		mockEnv.ACTIVITY_LOG = 'off';
		act.enqueueActivity({ action: 'nav.page.view', userId: 'u' });
		expect(act.activityStats().queued).toBe(0);
	});

	it('flushes rows through the service client with pseudonymous columns only', async () => {
		const c = fakeClient();
		act._setActivityClientFactory(() => c);
		act.enqueueActivity({
			action: 'auth.login.success',
			userId: 'u1',
			routeId: '/api/auth/login',
			method: 'POST',
			statusCode: 200,
			context: { ipHash: 'abc', country: 'AU', uaFamily: 'Chrome', device: 'desktop' },
			meta: { email: 'x@y.z', page: '/x' }
		});
		await act.flushActivity();
		expect(c.inserted).toHaveLength(1);
		const row = c.inserted[0][0];
		expect(row.user_id).toBe('u1');
		expect(row.category).toBe('auth');
		expect(row.subject_hash).toHaveLength(32);
		expect(row.meta).toEqual({ page: '/x' });
		expect(JSON.stringify(row)).not.toContain('x@y.z');
		expect(act.activityStats().flushed).toBe(1);
	});

	it('retries once, then counts the batch as dropped and keeps serving', async () => {
		const c = fakeClient({ failInserts: 2 });
		act._setActivityClientFactory(() => c);
		act.enqueueActivity({ action: 'nav.page.view', userId: 'u1' });
		await act.flushActivity();
		expect(act.activityStats().dropped).toBe(1);
		expect(act.activityStats().lastError).toBe('db down');
		// next flush works again
		act.enqueueActivity({ action: 'nav.page.view', userId: 'u1' });
		await act.flushActivity();
		expect(c.inserted).toHaveLength(1);
	});

	it('counts drops when no service client is available', async () => {
		act._setActivityClientFactory(() => {
			throw new Error('no key');
		});
		act.enqueueActivity({ action: 'nav.page.view', userId: 'u1' });
		await act.flushActivity();
		expect(act.activityStats().dropped).toBe(1);
	});

	it('presence is throttled to one write per user per minute and upserted', async () => {
		const c = fakeClient();
		act._setActivityClientFactory(() => c);
		const ctx = { ipHash: null, country: null, uaFamily: 'Chrome', device: 'desktop' };
		act.touchPresence('u1', '/(portal)/dashboard', ctx, 's1');
		act.touchPresence('u1', '/(portal)/calendar', ctx, 's1');
		act.touchPresence('u2', '/(portal)/calendar', ctx, 's2');
		await act.flushActivity();
		expect(c.upserted).toHaveLength(1);
		expect(c.upserted[0].map((r: any) => r.user_id).sort()).toEqual(['u1', 'u2']);
		expect(c.upserted[0].find((r: any) => r.user_id === 'u1').last_route_id).toBe('/(portal)/dashboard');
	});

	it('logActivity rides the request id and context from locals', async () => {
		const c = fakeClient();
		act._setActivityClientFactory(() => c);
		act.logActivity(
			{ requestId: 'req-1', activityContext: { ipHash: 'h', country: 'US', uaFamily: 'Safari', device: 'mobile' }, activitySessionHash: 'sess' },
			'u9',
			{ action: 'admin.credits.granted', targetUserId: 'u1', creditsDelta: 5000, meta: { note: 'pilot' } }
		);
		await act.flushActivity();
		const row = c.inserted[0][0];
		expect(row).toMatchObject({ request_id: 'req-1', ip_hash: 'h', country: 'US', ua_family: 'Safari', device: 'mobile', session_hash: 'sess', target_user_id: 'u1', credits_delta: 5000, category: 'admin' });
	});
});
