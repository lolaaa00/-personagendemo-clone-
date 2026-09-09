/**
 * The doors themselves, not the resolver. entitlements.spec proves the rules;
 * this proves each route actually asks them and refuses with a 403 the UI can
 * read — and, just as importantly, that the gates do NOT catch what they must
 * never catch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ent = vi.hoisted(() => ({
	current: {
		plan: 'studio',
		personaLimit: 3,
		brandBriefLimit: 1,
		maxAutonomy: 'semi_autonomous',
		cinematic: false,
		teams: false,
		apiAccess: false,
		byok: false,
		priority: false
	} as Record<string, unknown>
}));

vi.mock('$lib/server/entitlements', async (orig) => {
	const real = (await orig()) as Record<string, unknown>;
	return { ...real, entitlementsFor: vi.fn(async () => ent.current) };
});


// The persona lookup and the workspace seat are not what these tests are about:
// both answer "your own persona, allowed" so the only thing that can produce a
// 403 is the plan gate itself.
vi.mock('$lib/server/db', async (orig) => {
	const real = (await orig()) as Record<string, unknown>;
	const ok = async () => ({ data: null, error: null });
	return {
		...real,
		createDbService: () => ({
			agents: { get: async () => ({ data: { id: 'a1', user_id: 'u1', name: 'A' }, error: null }), update: ok },
			agentConfigs: { get: async () => ({ data: { agent_id: 'a1', autonomy_level: 'advisor' }, error: null }), upsert: ok },
			brandBriefs: { list: async () => ({ data: [{ id: 'b1' }], error: null }), create: ok, getById: ok }
		})
	};
});

vi.mock('$lib/server/workspaces', async (orig) => {
	const real = (await orig()) as Record<string, unknown>;
	return { ...real, checkAgentAccess: vi.fn(async () => ({ ok: true })) };
});

const workspaces = await import('../../routes/api/workspaces/+server');
const devKeys = await import('../../routes/api/developer/keys/+server');
const userKeys = await import('../../routes/api/settings/api-keys/+server');
const agentConfig = await import('../../routes/api/agents/config/+server');
const generatePost = await import('../../routes/api/agent/[agentId]/generate-post/+server');
const engine = await import('../../routes/api/engine/+server');

/** Minimal chainable stand-in: every terminal await resolves to `result`. */
function fakeDb(result: unknown = { data: null, error: null }) {
	const chain: Record<string, unknown> = {};
	const proxy: unknown = new Proxy(chain, {
		get: (_t, prop) => {
			if (prop === 'then') return undefined;
			return () => proxy;
		}
	});
	// terminal calls used by these routes
	return new Proxy(
		{},
		{
			get: (_t, prop) => {
				if (prop === 'from') return () => terminal(result);
				return () => proxy;
			}
		}
	);
}
function terminal(result: unknown): unknown {
	const p: unknown = new Proxy(
		{},
		{
			get: (_t, prop) => {
				if (prop === 'then') return (res: (v: unknown) => void) => res(result);
				return () => p;
			}
		}
	);
	return p;
}

const locals = (userId = 'u1') =>
	({
		safeGetSession: async () => ({ session: { id: 's', user: { id: userId } }, user: { id: userId } }),
		supabase: fakeDb()
	}) as never;
const post = (body: unknown) => new Request('http://t/', { method: 'POST', body: JSON.stringify(body) });
const call = async (h: unknown, body: unknown) =>
	(await (h as (e: unknown) => Promise<Response>)({ request: post(body), locals: locals() })) as Response;

beforeEach(() => {
	ent.current = { plan: 'studio', personaLimit: 3, brandBriefLimit: 1, maxAutonomy: 'semi_autonomous', cinematic: false, teams: false, apiAccess: false, byok: false, priority: false };
});

describe('teams — /api/workspaces', () => {
	it('refuses a plan without shared workspaces, and says which plan', async () => {
		const res = await call(workspaces.POST, { name: 'Acme' });
		expect(res.status).toBe(403);
		const b = await res.json();
		expect(b.code).toBe('PLAN_FEATURE');
		expect(b.error).toContain('studio');
		expect(b.billingUrl).toBe('/billing');
	});

	it('lets a plan that includes them through the gate', async () => {
		ent.current = { ...ent.current, teams: true };
		const res = await call(workspaces.POST, { name: 'Acme' });
		expect(res.status).not.toBe(403);
	});

	it('still validates the name before the plan — a bad request is a 400, not an upsell', async () => {
		ent.current = { ...ent.current, teams: true };
		const res = await call(workspaces.POST, { name: '' });
		expect(res.status).toBe(400);
	});
});

describe('API access — /api/developer/keys', () => {
	it('refuses minting on a plan without it', async () => {
		const res = await call(devKeys.POST, { label: 'ci' });
		expect(res.status).toBe(403);
		expect((await res.json()).code).toBe('PLAN_FEATURE');
	});

	it('allows minting when the plan includes it', async () => {
		ent.current = { ...ent.current, apiAccess: true };
		const res = await call(devKeys.POST, { label: 'ci' });
		expect(res.status).not.toBe(403);
	});

	it('never gates listing — a downgrade must not hide keys the user still has to revoke', async () => {
		const res = (await (devKeys.GET as unknown as (e: unknown) => Promise<Response>)({ locals: locals() })) as Response;
		expect(res.status).not.toBe(403);
	});
});

describe('BYOK — /api/settings/api-keys', () => {
	it('refuses a generation key on a plan without BYOK', async () => {
		const res = await call(userKeys.POST, { action: 'save', provider: 'openrouter', apiKey: 'sk-or-averylongkey' });
		expect(res.status).toBe(403);
	});

	it('NEVER refuses the publishing connector — every plan publishes', async () => {
		// Zernio is how all 13 platforms work, promised on Free. Gating it here
		// would have broken publishing for everyone below Agency.
		const res = await call(userKeys.POST, { action: 'save', provider: 'zernio', apiKey: 'zk-averylongkey' });
		expect(res.status).not.toBe(403);
	});

	it('NEVER refuses the research key — briefs need it on every plan', async () => {
		const res = await call(userKeys.POST, { action: 'save', provider: 'firecrawl', apiKey: 'fc-averylongkey' });
		expect(res.status).not.toBe(403);
	});

	it('allows a generation key once the plan includes BYOK', async () => {
		ent.current = { ...ent.current, byok: true };
		const res = await call(userKeys.POST, { action: 'save', provider: 'openrouter', apiKey: 'sk-or-averylongkey' });
		expect(res.status).not.toBe(403);
	});
});

describe('autonomy ceiling — /api/agents/config', () => {
	// The route reads the persona through db.agents.get and the workspace seat
	// through checkAgentAccess; both are mocked to "owner, allowed" so what is
	// under test is the plan ceiling and nothing else.
	it('refuses raising a persona above the plan ceiling', async () => {
		const res = (await (agentConfig.POST as unknown as (e: unknown) => Promise<Response>)({
			request: post({ agentId: 'a1', autonomyLevel: 'fully_autonomous' }),
			locals: locals()
		})) as Response;
		expect(res.status).toBe(403);
		const b = await res.json();
		expect(b.code).toBe('PLAN_FEATURE');
		expect(b.error).toContain('Fully autonomous');
	});

	it('allows a level the plan includes', async () => {
		const res = (await (agentConfig.POST as unknown as (e: unknown) => Promise<Response>)({
			request: post({ agentId: 'a1', autonomyLevel: 'semi_autonomous' }),
			locals: locals()
		})) as Response;
		expect(res.status).not.toBe(403);
	});

	it('does not touch a save that never mentions autonomy', async () => {
		// Otherwise every unrelated edit on a persona already above the ceiling
		// would start failing — the gate must only catch a RAISE.
		const res = (await (agentConfig.POST as unknown as (e: unknown) => Promise<Response>)({
			request: post({ agentId: 'a1', soulText: 'hello' }),
			locals: locals()
		})) as Response;
		expect(res.status).not.toBe(403);
	});
});

describe('cinematic — /api/agent/[agentId]/generate-post', () => {
	it('answers about the plan, not about a missing key', async () => {
		const res = (await (generatePost.POST as unknown as (e: unknown) => Promise<Response>)({
			request: post({ media: 'cinematic' }),
			params: { agentId: 'a1' },
			locals: locals()
		})) as Response;
		expect(res.status).toBe(403);
		expect((await res.json()).code).toBe('PLAN_FEATURE');
	});

	it('a plan with cinematic gets past the plan gate', async () => {
		ent.current = { ...ent.current, cinematic: true };
		const res = (await (generatePost.POST as unknown as (e: unknown) => Promise<Response>)({
			request: post({ media: 'cinematic' }),
			params: { agentId: 'a1' },
			locals: locals()
		})) as Response;
		const b = await res.json().catch(() => ({}));
		expect(b.code).not.toBe('PLAN_FEATURE');
	});
});

describe('brand-brief limit — /api/engine save_brief', () => {
	it('refuses a brief past the plan count', async () => {
		// The mocked list returns one existing brief; Studio includes one.
		const res = (await (engine.POST as unknown as (e: unknown) => Promise<Response>)({
			url: new URL('http://t/api/engine?path=personagen-brand-brief'),
			request: post({ action: 'save_brief', data: { brandName: 'Acme' } }),
			locals: locals()
		})) as Response;
		expect(res.status).toBe(403);
		expect((await res.json()).error).toContain('brand brief');
	});

	it('allows it when the plan includes more', async () => {
		ent.current = { ...ent.current, brandBriefLimit: 5 };
		const res = (await (engine.POST as unknown as (e: unknown) => Promise<Response>)({
			url: new URL('http://t/api/engine?path=personagen-brand-brief'),
			request: post({ action: 'save_brief', data: { brandName: 'Acme' } }),
			locals: locals()
		})) as Response;
		expect(res.status).not.toBe(403);
	});

	it('never counts against an EDIT — a plan change must not freeze existing work', async () => {
		ent.current = { ...ent.current, brandBriefLimit: 0 };
		const res = (await (engine.POST as unknown as (e: unknown) => Promise<Response>)({
			url: new URL('http://t/api/engine?path=personagen-brand-brief'),
			request: post({ action: 'save_brief', brief_id: 'b1', data: { brandName: 'Acme' } }),
			locals: locals()
		})) as Response;
		expect(res.status).not.toBe(403);
	});
});
