/**
 * IDENTITY-KIT PROMPT — byte-identical below `on`.
 *
 * The kit prompt writes every persona's display name, handle candidates and
 * per-platform bios. P4.2 adds three backbone facts to it (city, job title,
 * household), which means the day this deploys it could quietly rewrite the bios
 * of every persona already in production. It must not: the backbone half is
 * gated on `personaBackboneEmits()`, and below `on` the bytes are exactly the
 * bytes this action has always sent.
 *
 * `legacyPrompt()` below is a VERBATIM copy of the template as it stood before
 * P4.2 (engine `+server.ts`, `generate_identity_kit`). It is the oracle: every
 * position of the switch except `on` must reproduce it character for character,
 * for a v2 persona carrying a full backbone as much as for a v1 one. Do not
 * "tidy" it — its value is that it was copied, not rewritten.
 *
 * `flags.ts` reads env at CALL time and env outranks the database, so moving
 * `PERSONA_BACKBONE` on the mock env settles the switch with no settings cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Type-only: erased at runtime, so it cannot disturb the vi.mock hoisting below.
import type { IdentityKitPromptInput } from './identity-kit-prompt';

/**
 * The builder's own parameter shapes, reused rather than re-typed as `any`.
 * A spec that types its fixtures loosely cannot catch a fixture that has
 * drifted away from what the function under test actually accepts.
 */
type Loose = Record<string, unknown>;
type KitAgent = IdentityKitPromptInput['agent'];

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { buildIdentityKitPrompt, identityKitBackboneLines } = await import('./identity-kit-prompt');
const { samplePersonaSkeleton } = await import('$lib/persona-contract/sampler');

// ── The pre-P4.2 template, copied verbatim ───────────────────────────────────

function legacyPrompt(
	agent: KitAgent,
	profile: Loose,
	b: Loose,
	wants: string[],
	contract: string[]
) {
	return `You are an elite social-media brand strategist. Create the public-facing identity kit for one UGC creator.

CREATOR: ${agent.name || 'this creator'}. Niche: ${agent.niche || profile.niche || '—'}. Archetype: ${profile.archetype || '—'}. Content focus: ${profile.contentFocus || '—'}. Unique angle: ${profile.contentAngle || '—'}. Audience: ${profile.targetAvatar || '—'}. Personality/soul: ${String(agent.soul || '').slice(0, 500)}.
BRAND they create for: ${b.brandName || b.name || '—'}${b.tagline ? ` — ${b.tagline}` : ''}. Mission: ${b.mission || '—'}. Products: ${
		Array.isArray(b.products)
			? b.products
					.map((p) => (p as Loose)?.name)
					.filter(Boolean)
					.join(', ')
			: '—'
	}.

Return:
${wants.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Return ONLY JSON: {${contract.join(',')}}`;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z';

/** An agent row carrying a fully sampled v2 backbone. */
const v2Agent = (seed = 'kit-1') => ({
	id: 'agent-v2',
	name: 'Sampled Creator',
	handle: 'sampled.creator',
	niche: 'Beauty & Wellness',
	soul: 'Dry, practical, allergic to hype.',
	personas_profile: samplePersonaSkeleton(seed, {}, { now: NOW })
});

/** A v1 persona that has never been through the sampler. */
const V1_AGENT = {
	id: 'agent-v1',
	name: 'Chloe Miles',
	handle: 'chloe.miles',
	niche: 'Sustainability & Eco',
	soul: 'Warm, dry humour, allergic to greenwashing.',
	personas_profile: {
		ageMin: 25,
		ageMax: 44,
		gender: 'female',
		archetype: 'The Activist / Advocate',
		targetAvatar: 'A renter who composts and feels guilty about parcels'
	}
};

/** Shapes nobody anticipated — none may throw, none may emit. */
const HOSTILE_AGENTS: [string, unknown][] = [
	['empty row', {}],
	['null profile', { name: 'Nul', personas_profile: null }],
	['string profile', { name: 'Str', personas_profile: 'not json at all' }],
	['array profile', { name: 'Arr', personas_profile: [1, 2, 3] }],
	[
		'creator is a string',
		{ name: 'Odd', personas_profile: { meta: { schemaVersion: 2 }, creator: 'nope' } }
	],
	[
		'blank leaves only',
		{
			name: 'Blank',
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { location: { city: '   ' }, work: { title: '' }, household: {} }
			}
		}
	]
];

const V1_PROFILE = {
	niche: 'Sustainability & Eco',
	archetype: 'The Activist / Advocate',
	contentFocus: 'Product reviews',
	contentAngle: 'The receipts, not the vibes',
	targetAvatar: 'A renter who composts'
};

const BRIEF = {
	brandName: 'Honeyx',
	tagline: 'skincare that reads its own label',
	mission: 'Fewer, better ingredients',
	products: [{ name: 'Barrier Balm' }, { name: 'Night Oil' }, { noName: true }]
};

const WANTS = ['"displayName": the profile display name.', '"bios": one bio per platform.'];
const CONTRACT = ['"displayName":""', '"bios":{"instagram":""}'];

const build = (agent: KitAgent, profile: Loose = V1_PROFILE, brief: Loose = BRIEF) =>
	buildIdentityKitPrompt({ agent, profile, brief, wants: WANTS, contract: CONTRACT });

const legacy = (agent: KitAgent, profile: Loose = V1_PROFILE, brief: Loose = BRIEF) =>
	legacyPrompt(agent, profile, brief, WANTS, CONTRACT);

const at = (mode: string | undefined) => {
	if (mode === undefined) delete mockEnv.PERSONA_BACKBONE;
	else mockEnv.PERSONA_BACKBONE = mode;
};

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

// ── The gate ─────────────────────────────────────────────────────────────────

describe('identity kit — silent below `on`', () => {
	/**
	 * The load-bearing test. If this fails, flipping the switch to `shadow` or
	 * `fill` — or deploying with it unset, which is production today — changes
	 * every persona's bios.
	 */
	it.each([
		['unset', undefined],
		['off', 'off'],
		['shadow', 'shadow'],
		['fill', 'fill']
	])('at %s the prompt is byte-identical to the pre-P4.2 template', (_name, mode) => {
		at(mode as string | undefined);
		const agent = v2Agent();
		// Cast at the call, not in the fixture type: the point of these rows is that
		// the builder is handed shapes its own type forbids, and `unknown` is the
		// honest type for "whatever a broken row contains".
		expect(build(agent as KitAgent)).toBe(legacy(agent as KitAgent));
		expect(build(V1_AGENT)).toBe(legacy(V1_AGENT));
		expect(identityKitBackboneLines(agent)).toEqual([]);
	});

	it('is byte-identical for an unknown switch value (anything not on/shadow/fill is off)', () => {
		at('ON_MAYBE');
		const agent = v2Agent();
		// Cast at the CALL, not in the fixture type. The point of these rows is that
		// the builder is handed shapes its own type forbids, so `unknown` stays the
		// honest type for the fixture and the lie is confined to one line.
		expect(build(agent as KitAgent)).toBe(legacy(agent as KitAgent));
	});

	it('still matches the legacy template with no brief and an empty profile', () => {
		at(undefined);
		expect(build({}, {}, {})).toBe(legacy({}, {}, {}));
		expect(build(V1_AGENT, {}, { name: 'Fallback Co' })).toBe(
			legacy(V1_AGENT, {}, { name: 'Fallback Co' })
		);
	});
});

// ── What `on` adds ───────────────────────────────────────────────────────────

describe('identity kit — at `on` the backbone reaches the prompt', () => {
	it('adds exactly one block, and removing it leaves the legacy prompt untouched', () => {
		at('on');
		const agent = v2Agent();
		const lines = identityKitBackboneLines(agent);
		expect(lines.length).toBeGreaterThan(1);
		const block = lines.map((l) => `\n${l}`).join('');
		const on = build(agent);
		expect(on).toContain(block);
		expect(on.replace(block, '')).toBe(legacy(agent));
	});

	it('emits the city, the job title and the household — and nothing else', () => {
		at('on');
		const agent = {
			name: 'Maya Sandoval',
			niche: 'Beauty & Wellness',
			soul: 'Blunt.',
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: {
					age: 34,
					location: { city: 'Brisbane', region: 'Queensland', geographicContext: 'urban' },
					work: { title: 'Physiotherapist', domain: 'healthcare', seniority: 'senior' },
					household: {
						relationshipStatus: 'married',
						children: { count: 2, ageBands: ['toddler', 'primary'] },
						housingType: 'house_owned',
						pets: ['dog']
					},
					lifestyle: { activityLevel: 'active' }
				}
			}
		};
		expect(identityKitBackboneLines(agent)).toEqual([
			'',
			"REAL LIFE — true facts about this creator. Let the bios sound like this person's actual life; never list these out, and never state one that is not here:",
			'- Lives in: Brisbane.',
			'- Does: Physiotherapist.',
			'- Household: Married · 2 children (Toddler, Primary school) · Owned house · Pets: Dog.'
		]);
		// The kit is a PUBLIC identity: the facts it does not need stay out of it.
		const prompt = build(agent);
		expect(prompt).not.toContain('Queensland');
		expect(prompt).not.toContain('Age: 34');
		expect(prompt).not.toContain('Lifestyle');
	});

	it('renders tokens through label() — a raw storage token never reaches the model', () => {
		at('on');
		const agent = {
			name: 'Tokens',
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: {
					household: {
						relationshipStatus: 'married',
						housingType: 'apartment_rented',
						pets: ['small_pet', 'small_pet', 'cat']
					}
				}
			}
		};
		const prompt = build(agent);
		for (const token of ['apartment_rented', 'small_pet', 'house_owned']) {
			expect(prompt).not.toContain(token);
		}
		// De-duplicated, in stored order, all labelled.
		expect(identityKitBackboneLines(agent)[2]).toBe(
			'- Household: Married · Rented apartment · Pets: Small pet, Cat.'
		);
	});

	it('sets leaves only — a partial backbone emits only the facts it holds', () => {
		at('on');
		const cityOnly = {
			name: 'Partial',
			personas_profile: { meta: { schemaVersion: 2 }, creator: { location: { city: 'Perth' } } }
		};
		expect(identityKitBackboneLines(cityOnly)).toEqual([
			'',
			"REAL LIFE — true facts about this creator. Let the bios sound like this person's actual life; never list these out, and never state one that is not here:",
			'- Lives in: Perth.'
		]);
	});

	it('names one child in the singular', () => {
		at('on');
		const one = {
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { household: { children: { count: 1, ageBands: ['baby'] } } }
			}
		};
		expect(identityKitBackboneLines(one)[2]).toBe('- Household: 1 child (Baby).');
	});

	it('is deterministic — same profile, same bytes, every time', () => {
		at('on');
		const agent = v2Agent('kit-determinism');
		expect(build(agent)).toBe(build(agent));
		expect(build(v2Agent('kit-determinism'))).toBe(build(v2Agent('kit-determinism')));
	});

	it.each(HOSTILE_AGENTS)('never throws and stays legacy-identical: %s', (_name, agent) => {
		at('on');
		expect(() => identityKitBackboneLines(agent)).not.toThrow();
		expect(identityKitBackboneLines(agent)).toEqual([]);
		expect(build(agent as KitAgent)).toBe(legacy(agent as KitAgent));
	});

	it('leaves a v1 persona untouched — nothing is invented to fill the block', () => {
		at('on');
		expect(identityKitBackboneLines(V1_AGENT)).toEqual([]);
		expect(build(V1_AGENT)).toBe(legacy(V1_AGENT));
	});
});
