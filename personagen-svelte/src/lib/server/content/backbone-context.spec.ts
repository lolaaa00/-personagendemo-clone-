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
vi.mock('$lib/server/video', () => ({ burnCaptions: vi.fn(), optimizeForWeb: vi.fn() }));
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
			for (const key of ['Age', 'Home', 'Work', 'Household', 'Lifestyle', 'Character']) {
				if (block.includes(`- ${key}: `)) seen.add(key);
			}
		}
		expect([...seen].sort()).toEqual([
			'Age',
			'Character',
			'Home',
			'Household',
			'Lifestyle',
			'Work'
		]);
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
