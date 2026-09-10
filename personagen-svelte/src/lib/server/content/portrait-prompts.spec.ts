/**
 * PORTRAIT PROMPTS — the attributes that drift between the hero image and the edit.
 *
 * The failure this pins down: a persona is generated with a beard and glasses,
 * and the second image comes back clean-shaven with bare eyes. It happens
 * because the v1 `appearance` record has no key for facial hair or eyewear, so
 * the prompt never mentioned them, and "preserve their facial identity" is not
 * a strong enough instruction to hold an attribute the sentence never named.
 *
 * Two guarantees are tested here, and they pull against each other:
 *   1. A v2 look STATES those attributes, in the subject line for the hero and
 *      as an explicit keep-instruction for the edit.
 *   2. A persona still stored as v1 gets a BYTE-IDENTICAL prompt to the one it
 *      gets today. `prompt-regression.spec.ts` pins that against real stored
 *      shapes; this file pins the boundary — the exact condition under which the
 *      v2 clause takes over.
 *
 * Same mock set as the regression spec: everything with side effects is stubbed
 * and the builders under test are pure string functions.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
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

const { buildHeroPortraitPrompt, buildPortraitEditPrompt } = await import('./generate');

const BRIEF = {
	brandName: 'Honeyx',
	demographics: 'Australian women 25-40 who read every skincare label'
};

/** A persona stored the old way: no v2 look anywhere. */
const V1_AGENT = {
	id: 'agent-v1',
	name: 'Chloe Miles',
	niche: 'Sustainability & Eco',
	soul: 'Warm, dry humour.',
	personas_profile: {
		gender: 'female',
		archetype: 'The Activist / Advocate',
		targetAvatar: 'A renter who composts',
		appearance: {
			ethnicity: 'Caucasian',
			skinTone: 'Fair',
			hairColor: 'Warm copper red',
			eyeColor: 'Forest green'
		}
	}
};

/** The same persona with a v2 look carrying the drift-prone attributes. */
const v2Agent = (look: Record<string, unknown>) => ({
	id: 'agent-v2',
	name: 'Marcus Webb',
	niche: 'Tech & AI',
	soul: 'Blunt, precise.',
	personas_profile: {
		meta: { schemaVersion: 2 },
		creator: { age: 41, gender: 'male', heritage: 'white' },
		look
	}
});

const FULL_LOOK = {
	skinTone: 'medium',
	bodyType: 'average',
	heightCm: 183,
	faceShape: 'square',
	browShape: 'straight',
	facialHair: 'short_beard',
	eyewear: 'glasses',
	hair: {
		color: 'brown',
		length: 'short',
		style: 'crop',
		texture: 'straight',
		grayCoverage: 'light'
	},
	eyes: { color: 'brown' }
};

describe('buildHeroPortraitPrompt — the subject states what drifts', () => {
	it('names facial hair and eyewear in the subject for a v2 look', () => {
		const prompt = buildHeroPortraitPrompt(BRIEF, v2Agent(FULL_LOOK), 'male');
		expect(prompt).toMatch(/beard/i);
		expect(prompt).toMatch(/glasses/i);
	});

	it('is byte-identical for a v1 persona — nothing about this change reaches them', () => {
		const before = buildHeroPortraitPrompt(BRIEF, V1_AGENT, 'female');
		expect(before).toContain('Photorealistic vertical portrait of one');
		// The v2 clause must not have leaked in: no attribute the v1 record cannot express.
		expect(before).not.toMatch(/beard|glasses|clean-shaven/i);
		// Stable across calls, so a snapshot of it means something.
		expect(buildHeroPortraitPrompt(BRIEF, V1_AGENT, 'female')).toBe(before);
	});

	it('leaves no dangling separator when the look is empty', () => {
		const prompt = buildHeroPortraitPrompt(BRIEF, v2Agent({}), 'male');
		expect(prompt).not.toMatch(/\s,|,\s*\./);
		expect(prompt).not.toMatch(/\s{2,}/);
		expect(prompt).not.toMatch(/undefined|null|NaN/);
	});

	it('never leaks a storage token into the prompt', () => {
		const prompt = buildHeroPortraitPrompt(BRIEF, v2Agent(FULL_LOOK), 'male');
		expect(prompt).not.toMatch(/short_beard|apartment_rented|[a-z]+_[a-z_]+/);
	});

	/**
	 * `look.promptCues` is a CACHE that a field re-roll clears and nothing
	 * recomputes. If the builders read it as the source, a re-rolled look would
	 * render the old face — or no face at all.
	 */
	it('reads the look live, ignoring a stale or absent promptCues cache', () => {
		const stale = buildHeroPortraitPrompt(
			BRIEF,
			v2Agent({ ...FULL_LOOK, promptCues: ' Appearance: a completely different person.' }),
			'male'
		);
		const fresh = buildHeroPortraitPrompt(BRIEF, v2Agent(FULL_LOOK), 'male');
		expect(stale).not.toContain('a completely different person');
		expect(stale).toBe(fresh);
	});
});

describe('buildPortraitEditPrompt — the beard does not disappear', () => {
	it('explicitly instructs the model to keep facial hair and eyewear', () => {
		const prompt = buildPortraitEditPrompt(v2Agent(FULL_LOOK));
		expect(prompt).toMatch(/keep their facial hair/i);
		expect(prompt).toMatch(/beard/i);
		expect(prompt).toMatch(/glasses/i);
	});

	it('says nothing about facial hair for a persona who has none', () => {
		const prompt = buildPortraitEditPrompt(
			v2Agent({ ...FULL_LOOK, facialHair: 'none', eyewear: 'none' })
		);
		expect(prompt).not.toMatch(/keep their facial hair/i);
		// A "keep the glasses" instruction for someone with no glasses invents a prop.
		expect(prompt).not.toMatch(/keep their eyewear|keep their glasses/i);
	});

	it('is unchanged for a v1 persona', () => {
		const prompt = buildPortraitEditPrompt(V1_AGENT);
		expect(prompt).toContain('Preserve their facial identity from the reference image');
		expect(prompt).not.toMatch(/keep their facial hair|keep their eyewear/i);
		expect(buildPortraitEditPrompt(V1_AGENT)).toBe(prompt);
	});

	it('survives a missing, empty and malformed profile without throwing', () => {
		for (const profile of [null, undefined, 42, 'nope', [], {}, { look: 'not an object' }]) {
			const agent = { id: 'x', name: 'X', niche: '', soul: '', personas_profile: profile };
			expect(() => buildPortraitEditPrompt(agent), JSON.stringify(profile)).not.toThrow();
			expect(
				() => buildHeroPortraitPrompt(BRIEF, agent, undefined),
				JSON.stringify(profile)
			).not.toThrow();
		}
	});
});

describe('the v1/v2 boundary — the condition under which the new clause takes over', () => {
	/**
	 * The switch is "does this look hold an attribute v1 has no key for", NOT
	 * "is this profile v2". Every v1 persona is upgraded in memory on read, so a
	 * test that keyed on schemaVersion would flip the whole estate at once.
	 */
	it('a v2 profile whose look holds only v1-expressible fields keeps the v1 clause', () => {
		const v1Only = v2Agent({ skinTone: 'fair', hair: { color: 'blonde', length: 'long' } });
		const prompt = buildHeroPortraitPrompt(BRIEF, v1Only, 'female');
		expect(prompt).not.toMatch(/beard|glasses|clean-shaven|cm tall/i);
	});

	it('one v2-only attribute is enough to switch the clause on', () => {
		const oneAttribute = v2Agent({ skinTone: 'fair', eyewear: 'glasses' });
		expect(buildHeroPortraitPrompt(BRIEF, oneAttribute, 'female')).toMatch(/glasses/i);
	});
});
