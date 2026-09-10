/**
 * PERSONA_BACKBONE — the flag's only consumer, under test.
 *
 * The staged rollout is `off → shadow → fill → on`, and the promise made to
 * whoever flips it is precise: nothing reaches a prompt until `on`. Three of the
 * four positions must leave `buildRichAgentContext` byte-identical to what it
 * returned before the backbone existed — including `fill`, which persists the
 * facts and still says nothing. Storing a fact and speaking it are separate
 * decisions; that separation is the reason the flag has four positions.
 *
 * `prompt-regression.spec.ts` proves the DEFAULT is silent, against real stored
 * shapes. This file proves each position individually, and proves that `on`
 * actually emits — a gate nobody has watched open is not a gate.
 *
 * Same mock set as the regression spec, except the env object is mutable so a
 * test can move the switch; `flags.ts` reads env at CALL time, and env outranks
 * the database, so setting it here settles the value without a settings cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/user-api-keys', () => ({ getUserApiKey: vi.fn() }));
vi.mock('$lib/server/ai-client', () => ({ resolveAiClient: vi.fn() }));
vi.mock('$lib/server/db', () => ({ createDbService: vi.fn() }));
vi.mock('$lib/server/service-supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/storage', () => ({
	persistToStorage: vi.fn(),
	persistBufferToStorage: vi.fn()
}));
vi.mock('$lib/server/video', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/video')>();
	return { ...actual, burnCaptions: vi.fn(), optimizeForWeb: vi.fn() };
});
vi.mock('./card-renderer', () => ({
	renderTypographicCard: vi.fn(),
	CARD_RENDERER_LABEL: 'mock'
}));
vi.mock('$lib/server/social/http', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('$lib/server/budget', () => ({ assertWithinBudget: vi.fn() }));
vi.mock('$lib/server/voices', () => ({
	DEFAULT_VOICE: 'Aria',
	VOICE_CATALOG: [{ name: 'Aria', gender: 'female', accent: 'American' }]
}));

const { buildRichAgentContext } = await import('./generate');
const { samplePersonaSkeleton } = await import('$lib/persona-contract/sampler');

const NOW = '2026-01-01T00:00:00.000Z';

/**
 * Every row the backbone can emit, in builder order. Shared by the leak test
 * and the reachability sweep so a row added to one is never forgotten by the
 * other — the failure mode that produces a line nothing can reach.
 */
const ROWS = [
	'Age',
	'Home',
	'Local',
	'Work',
	'Credibility',
	'Household',
	'Lifestyle',
	'Character',
	'Manner'
] as const;

/** An agent row carrying a fully sampled v2 backbone. */
const v2Agent = (seed = 'backbone-1') => ({
	id: 'agent-v2',
	name: 'Sampled Creator',
	handle: 'sampled.creator',
	niche: 'Beauty & Wellness',
	soul: 'Dry, practical, allergic to hype.',
	skills: '',
	personas_profile: samplePersonaSkeleton(seed, {}, { now: NOW })
});

/** A v1 persona that has never been through the sampler. */
const V1_AGENT = {
	id: 'agent-v1',
	name: 'Chloe Miles',
	handle: 'chloe.miles',
	niche: 'Sustainability & Eco',
	soul: 'Warm, dry humour, allergic to greenwashing.',
	skills: '',
	personas_profile: {
		ageMin: 25,
		ageMax: 44,
		gender: 'female',
		archetype: 'The Activist / Advocate',
		targetAvatar: 'A renter who composts and feels guilty about parcels'
	}
};

/**
 * A v2 agent holding exactly the leaves a test names. Sparse on purpose: every
 * row is meant to be independently reachable, so a directive test must not have
 * to sample a whole person to reach one trait.
 */
const v2With = (creator: Record<string, unknown>, rest: Record<string, unknown> = {}) => ({
	id: 'agent-partial',
	name: 'Partial',
	handle: 'partial',
	niche: 'Tech & AI',
	soul: '',
	skills: '',
	personas_profile: { meta: { schemaVersion: 2 }, creator, ...rest }
});

/** The backbone block alone, with the pre-existing context stripped off. */
const backbone = (agent: unknown): string => at('on', agent).split('Life backbone')[1] ?? '';

/** One `- Key: …` row from the backbone block, or '' when the row is absent. */
const row = (agent: unknown, key: string): string =>
	backbone(agent)
		.split('\n')
		.find((l) => l.startsWith(`- ${key}: `)) ?? '';

const at = (mode: string | undefined, agent: unknown): string => {
	if (mode === undefined) delete mockEnv.PERSONA_BACKBONE;
	else mockEnv.PERSONA_BACKBONE = mode;
	return buildRichAgentContext(agent);
};

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

describe('PERSONA_BACKBONE — silent below `on`', () => {
	/**
	 * The load-bearing test. If this ever fails, the rollout has stopped being
	 * staged: someone flipping to `shadow` or `fill` to observe the backbone
	 * would silently change what every persona says in production.
	 */
	it('emits byte-identical context at off, shadow and fill — including for a fully sampled persona', () => {
		const agent = v2Agent();
		const baseline = at('off', agent);
		for (const mode of [undefined, 'off', 'shadow', 'fill']) {
			expect(at(mode, agent), `mode ${mode ?? '(unset)'}`).toBe(baseline);
		}
	});

	it('contributes nothing recognisable as a backbone below `on`', () => {
		expect(at('off', v2Agent())).not.toContain('Life backbone');
		expect(at('fill', v2Agent())).not.toContain('Life backbone');
	});

	/**
	 * The byte-identical test above already covers every row by construction,
	 * but it fails as one opaque string diff. This names the rows, so a future
	 * addition that leaks below `on` says WHICH row leaked.
	 */
	it('leaks no individual row below `on` — including the P4.1 additions', () => {
		for (const mode of ['off', 'shadow', 'fill']) {
			const context = at(mode, v2Agent());
			for (const key of ROWS) {
				expect(context, `${key} at ${mode}`).not.toContain(`- ${key}: `);
			}
			// The directive rows are prose, not `- Key:` shaped in the estate.
			expect(context, `day job at ${mode}`).not.toContain('your day job (');
			expect(context, `seasons at ${mode}`).not.toMatch(/hemisphere seasons/);
		}
	});

	it('treats an unrecognised flag value as off rather than as on', () => {
		const agent = v2Agent();
		expect(at('__invalid__', agent)).toBe(at('off', agent));
	});
});

describe('PERSONA_BACKBONE=on — the facts actually arrive', () => {
	it('adds the backbone block, and adds it only at the end', () => {
		const agent = v2Agent();
		const off = at('off', agent);
		const on = at('on', agent);
		expect(on).not.toBe(off);
		expect(on).toContain('Life backbone');
		// Additive: everything that was there is still there, unchanged, in front.
		expect(on.startsWith(off)).toBe(true);
	});

	it('renders labels, never storage tokens', () => {
		const block = at('on', v2Agent()).split('Life backbone')[1] ?? '';
		expect(block.length).toBeGreaterThan(0);
		// Storage tokens are snake_case; a label never is.
		expect(block).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
	});

	/**
	 * Every fact in the list must be REACHABLE. Character is the one that can
	 * legitimately be absent from any given persona — trait labels only exist
	 * where a Big Five score is extreme, so a creator whose every trait sits
	 * mid-range correctly contributes no Character row. Sweeping seeds is what
	 * separates "correctly omitted" from "wired to a field nothing ever writes",
	 * which is a dead line with a live-looking test.
	 */
	it('reaches every fact in the list across a sweep of seeds', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 40; i++) {
			const block = at('on', v2Agent(`sweep-${i}`)).split('Life backbone')[1] ?? '';
			for (const key of ROWS) {
				if (block.includes(`- ${key}: `)) seen.add(key);
			}
		}
		expect([...seen].sort()).toEqual([...ROWS].sort());
	});

	/**
	 * The Manner row is the Big Five spoken as behaviour. A score reaching the
	 * prompt is the exact failure P4.1 exists to prevent, and it would arrive
	 * looking harmless — "Manner: neuroticism 71". No digit belongs in that row.
	 */
	it('never puts a digit in the Manner row, across a sweep of seeds', () => {
		let sampled = 0;
		for (let i = 0; i < 40; i++) {
			const manner = row(v2Agent(`sweep-${i}`), 'Manner');
			if (!manner) continue;
			sampled++;
			expect(manner, `seed sweep-${i}`).not.toMatch(/\d/);
		}
		expect(sampled).toBeGreaterThan(0);
	});

	it('is stable — the same profile produces the same string every time', () => {
		const agent = v2Agent();
		expect(at('on', agent)).toBe(at('on', agent));
	});

	it('emits only facts the profile holds, never a placeholder row', () => {
		const sparse = {
			id: 'agent-sparse',
			name: 'Sparse',
			handle: 'sparse',
			niche: 'Tech & AI',
			soul: '',
			skills: '',
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { age: 41, ageSource: 'exact' }
			}
		};
		const block = at('on', sparse).split('Life backbone')[1] ?? '';
		expect(block).toContain('Age: 41');
		for (const absent of ['Home', 'Work', 'Household', 'Lifestyle', 'Character']) {
			expect(block, absent).not.toContain(`- ${absent}:`);
		}
	});

	/**
	 * `upgradeV1toV2` turns a v1 apparent-age bucket into a midpoint so the
	 * number has something to sort by. Asserting "you are 32" to a model on the
	 * strength of a bucket invents precision the customer never gave us.
	 */
	it('never states an age derived from a bucket', () => {
		const bucketed = {
			id: 'agent-bucket',
			name: 'Bucketed',
			handle: 'bucketed',
			niche: 'Tech & AI',
			soul: '',
			skills: '',
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { age: 32, ageSource: 'bucket', location: { city: 'Perth' } }
			}
		};
		const block = at('on', bucketed).split('Life backbone')[1] ?? '';
		expect(block).not.toContain('Age:');
		expect(block).toContain('Perth'); // the rest of the backbone still arrives
	});
});

describe('PERSONA_BACKBONE=on — P4.1 rows: local flavour, credibility, manner', () => {
	// ── Local ──────────────────────────────────────────────────────────────
	it('renders the market as currency and hemisphere, not just as a country', () => {
		const au = row(v2With({ market: 'au' }), 'Local');
		expect(au).toContain('Australia');
		expect(au).toContain('Australian dollars (A$)');
		expect(au).toContain('southern-hemisphere seasons');

		const uk = row(v2With({ market: 'uk' }), 'Local');
		expect(uk).toContain('pounds (£)');
		expect(uk).toContain('northern-hemisphere seasons');
	});

	/**
	 * `generic` is the fictional registry: invented cities, no real currency and
	 * no real hemisphere. Asserting either would be telling the model something
	 * false, so the row degrades to the market label alone.
	 */
	it('gives a fictional market neither a currency nor a hemisphere', () => {
		const generic = row(v2With({ market: 'generic' }), 'Local');
		expect(generic).toBe('- Local: International.');
	});

	it('omits Local entirely when no market is stored', () => {
		expect(row(v2With({ age: 41, ageSource: 'exact' }), 'Local')).toBe('');
	});

	/**
	 * Rule 4 in the builder's header: the same profile produces the same string
	 * forever. A season computed from the clock would quietly break that in
	 * March, so the hemisphere is stated and the current season never is.
	 */
	it('states the hemisphere, never the current season', () => {
		const local = row(v2With({ market: 'au' }), 'Local');
		for (const season of ['Summer', 'Autumn', 'Winter', 'Spring']) {
			expect(local, season).not.toContain(season);
		}
	});

	// ── Credibility ────────────────────────────────────────────────────────
	it('turns the day job into an authority rule, and bounds it', () => {
		const credibility = row(v2With({ work: { title: 'Registered nurse' } }), 'Credibility');
		expect(credibility).toContain('Registered nurse');
		expect(credibility).toContain('first-hand knowledge');
		expect(credibility).toContain('claim no expertise it does not give you');
	});

	it('falls back to the work domain when there is no title', () => {
		const credibility = row(v2With({ work: { domain: 'health_care' } }), 'Credibility');
		expect(credibility).toContain('Health care'); // the label, never the token
		expect(credibility).not.toContain('health_care');
	});

	it('omits Credibility when the persona has no job at all', () => {
		expect(row(v2With({ work: { workLocationMode: 'remote' } }), 'Credibility')).toBe('');
	});

	// ── Manner ─────────────────────────────────────────────────────────────
	/**
	 * The named test from the plan. A directive is only usable if it is the
	 * RIGHT one: a low score must never pick up the high sentence, which is the
	 * failure a single `if (score)` would produce.
	 */
	it('gives a low-extraversion persona the low directive and not the high one', () => {
		const manner = row(v2With({ bigFive: { extraversion: 20 } }), 'Manner');
		expect(manner).toContain('you are measured, and you let a pause sit');
		expect(manner).not.toContain('fill the silences');
	});

	it('gives a high-extraversion persona the high directive and not the low one', () => {
		const manner = row(v2With({ bigFive: { extraversion: 80 } }), 'Manner');
		expect(manner).toContain('you talk to camera like a friend and you fill the silences');
		expect(manner).not.toContain('let a pause sit');
	});

	it('says nothing about a mid-range trait rather than hedging', () => {
		expect(row(v2With({ bigFive: { extraversion: 50 } }), 'Manner')).toBe('');
		// The thresholds are inclusive on both sides.
		expect(row(v2With({ bigFive: { extraversion: 65 } }), 'Manner')).toContain('silences');
		expect(row(v2With({ bigFive: { extraversion: 35 } }), 'Manner')).toContain('pause');
		expect(row(v2With({ bigFive: { extraversion: 64 } }), 'Manner')).toBe('');
		expect(row(v2With({ bigFive: { extraversion: 36 } }), 'Manner')).toBe('');
	});

	it('emits one directive per extreme trait, in a fixed order', () => {
		const agent = v2With({
			bigFive: {
				openness: 90,
				conscientiousness: 10,
				extraversion: 90,
				agreeableness: 10,
				neuroticism: 90
			}
		});
		expect(row(agent, 'Manner').split('; ')).toHaveLength(5);
		expect(row(agent, 'Manner')).toBe(row(agent, 'Manner'));
		// Order is the trait order, not the order the scores happen to sort in.
		const manner = row(agent, 'Manner');
		expect(manner.indexOf('unusual angle')).toBeLessThan(manner.indexOf('loose ends'));
		expect(manner.indexOf('loose ends')).toBeLessThan(manner.indexOf('fill the silences'));
		expect(manner.indexOf('fill the silences')).toBeLessThan(manner.indexOf('push back'));
		expect(manner.indexOf('push back')).toBeLessThan(manner.indexOf('say so out loud'));
	});

	/**
	 * A model handed "neuroticism: 71" writes a psychology report. The scores
	 * are prompt input, never prompt output — nowhere in the block, not only
	 * outside the Manner row.
	 */
	it('never lets a raw Big Five score reach the prompt', () => {
		const scores = { openness: 71, conscientiousness: 72, extraversion: 73, agreeableness: 74, neuroticism: 75 };
		const block = backbone(v2With({ bigFive: scores }));
		expect(block).toContain('- Manner: '); // it did read them
		for (const [trait, score] of Object.entries(scores)) {
			expect(block, trait).not.toContain(String(score));
			expect(block, trait).not.toContain(trait);
		}
		expect(block).not.toMatch(/\d/);
	});

	it('survives a bigFive holding nonsense without throwing or emitting', () => {
		for (const bigFive of [null, 'nope', [], 42, { extraversion: 'high' }, { extraversion: NaN }]) {
			const agent = v2With({ bigFive });
			expect(() => backbone(agent), JSON.stringify(bigFive)).not.toThrow();
			expect(row(agent, 'Manner'), JSON.stringify(bigFive)).toBe('');
		}
	});
});

/**
 * NOT a backbone row. `audience.ageRanges` is P4.1's fifth bullet, and it is
 * already satisfied several lines ABOVE the backbone: `readPersonaProfile`
 * downgrades a v2 blob, and `downgradeV2toV1` maps every ageRange token through
 * `label()`. Emitting a second row inside the backbone would tell the model the
 * same thing twice, so this pins the existing line instead — including the two
 * tokens most likely to be dropped by a bounds lookup, `13_17` and `55_plus`.
 */
describe('audience.ageRanges reaches the script as labels, not tokens', () => {
	const audienced = v2With({}, { audience: { ageRanges: ['13_17', '25_34', '55_plus'] } });

	it('renders every stored token through the label registry', () => {
		expect(at('off', audienced)).toContain('Target age demographic: 13–17, 25–34, 55+.');
	});

	it('never leaks a storage token, at any flag position', () => {
		for (const mode of ['off', 'fill', 'on']) {
			for (const token of ['13_17', '25_34', '55_plus']) {
				expect(at(mode, audienced), `${token} at ${mode}`).not.toContain(token);
			}
		}
	});
});

describe('PERSONA_BACKBONE=on — nothing is allowed to break a generation', () => {
	it('adds nothing for a v1 persona that has never been sampled', () => {
		const on = at('on', V1_AGENT);
		const off = at('off', V1_AGENT);
		expect(on).toBe(off);
	});

	it('survives malformed, empty and missing profiles without throwing', () => {
		for (const profile of [null, undefined, 42, 'nope', [], {}, { creator: 'not an object' }]) {
			const agent = {
				id: 'x',
				name: 'X',
				handle: 'x',
				niche: '',
				soul: '',
				skills: '',
				personas_profile: profile
			};
			expect(() => at('on', agent), JSON.stringify(profile)).not.toThrow();
			expect(at('on', agent)).toBe(at('off', agent));
		}
	});
});
