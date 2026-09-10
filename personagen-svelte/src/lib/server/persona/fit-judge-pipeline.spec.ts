/**
 * THE FIT JUDGE, WIRED INTO THE PIPELINE — the part that can cost a post.
 *
 * `fit-judge.spec.ts` proves the pure half: every malformed answer resolves to
 * "no verdict". This file proves the half that spends money and writes to the
 * database, which is where a post actually gets lost.
 *
 * `judgeDraftFit` is the LAST thing generate.ts does before it returns the pack.
 * The caption, the script and the media are already final; nothing downstream
 * reads its result except two advisory columns. So the whole safety argument
 * reduces to one property, asserted here under every failure the world can
 * produce: **judgeDraftFit never rejects**. If it always resolves, the `return`
 * that follows it always runs, and the post is always created.
 *
 * The other half of the proof lives in `content/prompt-regression.spec.ts`: with
 * the switch off nothing here is reached and those byte-level snapshots are
 * untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiClient } from '$lib/server/ai-client';

// Everything with side effects, mocked in the same spirit as prompt-regression.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/user-api-keys', () => ({ getUserApiKey: vi.fn() }));
vi.mock('$lib/server/ai-client', () => ({ resolveAiClient: vi.fn() }));
vi.mock('$lib/server/db', () => ({ createDbService: vi.fn() }));
vi.mock('$lib/server/service-supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/storage', () => ({
	persistToStorage: vi.fn(),
	persistBufferToStorage: vi.fn()
}));
vi.mock('$lib/server/video', () => ({ burnCaptions: vi.fn(), optimizeForWeb: vi.fn() }));
vi.mock('../content/card-renderer', () => ({
	renderTypographicCard: vi.fn(),
	CARD_RENDERER_LABEL: 'mock'
}));
vi.mock('$lib/server/social/http', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('$lib/server/voices', () => ({
	DEFAULT_VOICE: 'Aria',
	VOICE_CATALOG: [{ name: 'Aria', gender: 'female', accent: 'American' }]
}));

// The two things under test are the flag and the money gate, so both are handles.
const { runsAutomatically, assertWithinBudget } = vi.hoisted(() => ({
	runsAutomatically: vi.fn(() => true),
	assertWithinBudget: vi.fn(async () => {})
}));
vi.mock('$lib/server/flags', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/flags')>()),
	// Credits OFF keeps the ledger write to a single insert; the judge's gate is
	// asserted through assertWithinBudget, not through the debit path.
	creditsMode: () => 'off',
	personaFitJudgeRunsAutomatically: runsAutomatically
}));
vi.mock('$lib/server/budget', () => ({ assertWithinBudget }));

const { judgeDraftFit } = await import('../content/generate');

// ── Fixtures ────────────────────────────────────────────────────────────────

const NO_VERDICT = { fit_score: null, fit_notes: null };

/** A persona whose audience is actually STATED — the gate the judge runs behind. */
const AGENT = {
	id: 'agent-fit-1',
	personas_profile: {
		meta: { schemaVersion: 2, seed: 'agent-fit-1' },
		creator: { market: 'AU' },
		description: { short: 'A night-shift nurse in Ballarat' },
		audience: { ageRanges: ['45_54'], genderMix: 'mostly_female', incomeBand: 'mid' }
	}
};

/** Same persona with the audience never filled in. */
const AGENT_NO_AUDIENCE = {
	id: 'agent-fit-2',
	personas_profile: { meta: { schemaVersion: 2 }, creator: { market: 'AU' }, audience: {} }
};

const CONTENT = {
	text: 'Three things I wish someone had told me before my first night shift.',
	script: 'You will not sleep. Here is what actually helped.'
};

/** A supabase stand-in: every chain resolves, and the posts UPDATE is observable. */
function fakeSupabase(updateResult: { error: unknown } = { error: null }) {
	const updates: Array<{ table: string; values: Record<string, unknown>; id?: string }> = [];
	const from = vi.fn((table: string) => {
		const row: Record<string, unknown> = {};
		const chain: Record<string, unknown> = {
			insert: () => chain,
			select: async () => ({ data: [], error: null }),
			update: (values: Record<string, unknown>) => {
				Object.assign(row, values);
				updates.push({ table, values });
				return chain;
			},
			eq: (_col: string, value: string) => {
				const last = updates[updates.length - 1];
				if (last) last.id = value;
				return chain;
			},
			is: () => chain,
			then: (resolve: (v: unknown) => unknown) => Promise.resolve(updateResult).then(resolve)
		};
		return chain;
	});
	return { client: { from } as never, updates, from };
}

/** An AiClient whose one answer (or failure) is whatever the test says it is. */
function fakeAi(answer: string | Error) {
	const generate = vi.fn(async (_prompt: string, _opts?: unknown): Promise<string> => {
		if (answer instanceof Error) throw answer;
		return answer;
	});
	const client: AiClient = { provider: 'openrouter', model: 'test/model', generate };
	return { client, generate };
}

const GOOD_ANSWER = JSON.stringify({
	verdicts: [
		{ viewerIndex: 0, objection: 'Sounds like every other nurse post.', fit: 40 },
		{ viewerIndex: 1, objection: 'No idea what she is selling.', fit: 60 }
	]
});

function run(over: Record<string, unknown> = {}) {
	const sb = fakeSupabase();
	const ai = fakeAi(GOOD_ANSWER);
	return {
		sb,
		ai,
		call: () =>
			judgeDraftFit({
				supabase: sb.client,
				userId: 'user-1',
				agentId: 'agent-fit-1',
				postId: 'post-1',
				ai: ai.client,
				agent: AGENT,
				content: CONTENT,
				...over
			})
	};
}

beforeEach(() => {
	runsAutomatically.mockReset().mockReturnValue(true);
	assertWithinBudget.mockReset().mockResolvedValue(undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ── The switch ──────────────────────────────────────────────────────────────

describe('the switch decides whether a provider is touched at all', () => {
	it("at 'off' / 'on_demand' the pipeline makes NO provider call and quotes NO budget", async () => {
		runsAutomatically.mockReturnValue(false);
		const { ai, call } = run();
		await expect(call()).resolves.toEqual(NO_VERDICT);
		expect(ai.generate).not.toHaveBeenCalled();
		expect(assertWithinBudget).not.toHaveBeenCalled();
	});

	it("at 'auto' it runs exactly ONE metered call", async () => {
		const { ai, call } = run();
		await call();
		expect(ai.generate).toHaveBeenCalledTimes(1);
		expect(assertWithinBudget).toHaveBeenCalledTimes(1);
	});

	it('a persona that never stated an audience is not judged against invented strangers', async () => {
		const { ai, call } = run({ agent: AGENT_NO_AUDIENCE });
		await expect(call()).resolves.toEqual(NO_VERDICT);
		expect(ai.generate).not.toHaveBeenCalled();
	});

	it('an empty draft is not sent anywhere', async () => {
		const { ai, call } = run({ content: { text: '   ', script: '' } });
		await expect(call()).resolves.toEqual(NO_VERDICT);
		expect(ai.generate).not.toHaveBeenCalled();
	});

	it('no provider configured is a non-event', async () => {
		const { call } = run({ ai: null });
		await expect(call()).resolves.toEqual(NO_VERDICT);
	});
});

// ── The verdict ─────────────────────────────────────────────────────────────

describe('a usable answer becomes two advisory columns', () => {
	it('scores the draft and stores it on the post that already exists', async () => {
		const { sb, call } = run();
		const out = await call();
		expect(out.fit_score).toBe(50);
		expect(out.fit_notes).toHaveLength(2);

		const write = sb.updates.find((u) => u.table === 'posts');
		expect(write).toBeDefined();
		expect(write?.id).toBe('post-1');
		// ONLY the two advisory columns — never the caption, media or status.
		expect(Object.keys(write?.values ?? {}).sort()).toEqual(['fit_notes', 'fit_score']);
	});

	it('judges the viewers the persona page already shows (first four of the panel)', async () => {
		const { ai, call } = run();
		await call();
		const prompt = ai.generate.mock.calls[0][0];
		expect(prompt).toContain(CONTENT.text);
		expect(prompt).toContain(CONTENT.script);
		// The roster is seats 0..3 — FIT_PANEL_SIZE of the five the persona page shows.
		expect(prompt).toMatch(/^0\. /m);
		expect(prompt).toMatch(/^3\. /m);
		expect(prompt).not.toMatch(/^4\. /m);
	});

	it('writes nothing when there is no post row to write to', async () => {
		const { sb, call } = run({ postId: undefined });
		const out = await call();
		expect(out.fit_score).toBe(50);
		expect(sb.updates.filter((u) => u.table === 'posts')).toEqual([]);
	});
});

// ── The whole point: no failure can cost a post ─────────────────────────────

describe('every failure resolves to no verdict — never to a rejected promise', () => {
	it('a budget refusal does not throw and the post keeps going', async () => {
		assertWithinBudget.mockRejectedValue(new Error('Daily spend cap reached for this persona.'));
		const { sb, call } = run();
		await expect(call()).resolves.toEqual(NO_VERDICT);
		expect(sb.updates.filter((u) => u.table === 'posts')).toEqual([]);
	});

	it('a credit refusal does not throw', async () => {
		const err = Object.assign(new Error('Not enough credits.'), { code: 'INSUFFICIENT_CREDITS' });
		assertWithinBudget.mockRejectedValue(err);
		await expect(run().call()).resolves.toEqual(NO_VERDICT);
	});

	it('a malformed judge answer scores nothing and creates no exception', async () => {
		for (const junk of [
			'not json at all',
			'{"verdicts": "nope"}',
			JSON.stringify({ verdicts: [{ viewerIndex: 99, fit: 50 }] }),
			JSON.stringify({ verdicts: [{ viewerIndex: 0, fit: 5000 }] }),
			JSON.stringify({ verdicts: [] }),
			''
		]) {
			const sb = fakeSupabase();
			const ai = fakeAi(junk);
			await expect(
				judgeDraftFit({
					supabase: sb.client,
					userId: 'user-1',
					agentId: 'agent-fit-1',
					postId: 'post-1',
					ai: ai.client,
					agent: AGENT,
					content: CONTENT
				}),
				junk
			).resolves.toEqual(NO_VERDICT);
			expect(sb.updates.filter((u) => u.table === 'posts')).toEqual([]);
		}
	});

	it('a provider that throws is absorbed', async () => {
		const sb = fakeSupabase();
		const ai = fakeAi(new Error('502 Bad Gateway'));
		await expect(
			judgeDraftFit({
				supabase: sb.client,
				userId: 'user-1',
				postId: 'post-1',
				ai: ai.client,
				agent: AGENT,
				content: CONTENT
			})
		).resolves.toEqual(NO_VERDICT);
	});

	it('a database that has not had the migration applied loses the verdict, not the post', async () => {
		const sb = fakeSupabase({
			error: { code: 'PGRST204', message: "Could not find the 'fit_score' column" }
		});
		const ai = fakeAi(GOOD_ANSWER);
		const out = await judgeDraftFit({
			supabase: sb.client,
			userId: 'user-1',
			postId: 'post-1',
			ai: ai.client,
			agent: AGENT,
			content: CONTENT
		});
		expect(out.fit_score).toBe(50);
	});

	it('a supabase client that throws on contact still resolves', async () => {
		const exploding = {
			from: () => {
				throw new Error('connection refused');
			}
		} as never;
		const ai = fakeAi(GOOD_ANSWER);
		await expect(
			judgeDraftFit({
				supabase: exploding,
				userId: 'user-1',
				postId: 'post-1',
				ai: ai.client,
				agent: AGENT,
				content: CONTENT
			})
		).resolves.toEqual(NO_VERDICT);
	});

	it('a profile shape nobody anticipated resolves rather than throwing', async () => {
		for (const agent of [null, undefined, 42, 'nope', { id: 'x', personas_profile: 'junk' }]) {
			await expect(run({ agent }).call(), JSON.stringify(agent)).resolves.toEqual(NO_VERDICT);
		}
	});
});
