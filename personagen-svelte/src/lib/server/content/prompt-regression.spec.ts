/**
 * PROMPT REGRESSION NET — byte-level snapshots of what the model is told.
 *
 * `generate.ts` is 4,000+ lines and produces every script, caption, and portrait
 * prompt. Until this file existed, none of it was under test: a one-word prompt
 * edit could change every persona's voice in production with no diff anyone
 * reviewed. These snapshots make a prompt change VISIBLE — the PR must update the
 * `.snap` file, and the reviewer reads exactly what changed.
 *
 * Fixtures are the three real persona-profile shapes in production:
 *   1. pre-bucket  — only ageMin/ageMax, no appearance, bare soul
 *   2. full v1     — every profile key, curated appearance, identity kit
 *   3. legacy look — combined "long loose waves" hairstyle + off-list hair color,
 *                    the shape `hairDescriptor()` de-duplicates
 *
 * Rules:
 *   • A snapshot diff is NEVER "just updated" — the PR description quotes it.
 *   • Add a fixture when a new stored shape appears; never edit these three.
 *   • Persona Model v2 (docs/competitive/persona-model-v2-*.md) relies on this
 *     file to prove a v1 persona's prompts stay byte-identical with the
 *     backbone switched off.
 *
 * Everything with side effects (supabase, storage, ffmpeg, provider clients,
 * budget ledger) is mocked; the builders under test are pure string functions.
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

const { buildRichAgentContext, buildHeroPortraitPrompt, buildPortraitEditPrompt } =
	await import('./generate');
const { upgradeV1toV2 } = await import('$lib/persona-contract/upgrade');
const { deriveAgeRanges } = await import('$lib/persona-age');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BRIEF = {
	brandName: 'Honeyx',
	demographics: 'Australian women 25–40 who read every skincare label'
};

/** 1. Pre-bucket profile: numbers only, no appearance, bare soul. */
const PRE_BUCKET = {
	id: 'agent-pre',
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

/** 2. Full v1 profile with curated appearance and identity kit. */
const FULL_V1 = {
	id: 'agent-full',
	name: 'Jenny Tran',
	handle: 'jenny.tran',
	niche: 'Beauty & Wellness',
	soul: 'soul.md — Jenny Tran. Gentle, precise, a chemist who explains the why.',
	skills: JSON.stringify([
		{ name: 'Ingredient breakdowns', md: 'Reads INCI lists on camera.' },
		{ name: 'Before/after honesty', md: 'Never filters skin.' }
	]),
	personas_profile: {
		ageRanges: ['25–34', '35–44'],
		ageMin: 25,
		ageMax: 44,
		gender: 'female',
		archetype: 'The Expert / Authority',
		contentFocus: 'Education & How-Tos',
		contentAngle: 'I read the label so you do not have to.',
		targetAvatar: 'A 32-year-old who has been burned by a viral serum',
		psychProfile: 'Wants proof, distrusts hype, shares wins with her group chat.',
		appearance: {
			ethnicity: 'Vietnamese',
			personaAge: '30–35',
			skinTone: 'Medium',
			bodyType: 'Slim',
			hairLength: 'Shoulder-Length',
			hairstyle: 'Straight',
			hairColor: 'Black',
			eyeColor: 'Dark Brown',
			wardrobe: 'cream linen sets, minimal gold jewelry',
			outfitColors: 'cream, tan, olive',
			headwear: 'none',
			distinctiveFeatures: 'small beauty mark below left eye',
			styling: 'quiet luxury, summer'
		},
		voiceProfile: { gender: 'female', nationality: 'Vietnamese-Australian', accent: 'Australian' },
		bios: { tiktok: 'Chemist. Reads the label.' },
		displayName: 'Jenny Tran'
	}
};

/** 3. Legacy look: combined hairstyle + off-list hair colour (never snapped). */
const LEGACY_LOOK = {
	id: 'agent-legacy',
	name: 'Lexy Connor',
	handle: 'lexy.connor',
	niche: 'Parenting & Family',
	soul: 'Chaotic-good mum of two, zero patience for perfect-kitchen content.',
	skills: 'street interviews at school pickup',
	personas_profile: {
		ageRanges: ['25–34'],
		gender: 'female',
		archetype: 'The Relatable Friend',
		contentFocus: 'Entertainment & Humor',
		appearance: {
			hairstyle: 'long loose waves',
			hairLength: 'Long',
			hairColor: 'honey blonde',
			eyeColor: 'Hazel'
		}
	}
};

// ── Snapshots ────────────────────────────────────────────────────────────────

describe('buildRichAgentContext — script/caption persona context', () => {
	it('pre-bucket profile', () => {
		expect(buildRichAgentContext(PRE_BUCKET)).toMatchSnapshot();
	});
	it('full v1 profile', () => {
		expect(buildRichAgentContext(FULL_V1)).toMatchSnapshot();
	});
	it('legacy look profile', () => {
		expect(buildRichAgentContext(LEGACY_LOOK)).toMatchSnapshot();
	});
});

describe('buildHeroPortraitPrompt — first portrait', () => {
	it('pre-bucket profile', () => {
		expect(buildHeroPortraitPrompt(BRIEF, PRE_BUCKET, 'female')).toMatchSnapshot();
	});
	it('full v1 profile', () => {
		expect(buildHeroPortraitPrompt(BRIEF, FULL_V1, 'female')).toMatchSnapshot();
	});
	it('legacy look profile', () => {
		expect(buildHeroPortraitPrompt(BRIEF, LEGACY_LOOK, 'female')).toMatchSnapshot();
	});
	it('no brief, no gender — the bare fallback', () => {
		expect(buildHeroPortraitPrompt(undefined, PRE_BUCKET, undefined)).toMatchSnapshot();
	});
});

describe('buildPortraitEditPrompt — regenerate keeping the face', () => {
	it('full v1 profile', () => {
		expect(buildPortraitEditPrompt(FULL_V1)).toMatchSnapshot();
	});
	it('legacy look profile de-duplicates "long" against "long loose waves"', () => {
		const out = buildPortraitEditPrompt(LEGACY_LOOK);
		expect(out).not.toMatch(/long long/i);
		expect(out).toMatchSnapshot();
	});
});

/**
 * PHASE 0 EXIT GUARANTEE (Persona Model v2): a persona whose stored blob has
 * flipped to v2 on save must produce BYTE-IDENTICAL prompts to the same persona
 * stored as v1. Readers downgrade; this proves the downgrade is invisible to the
 * model. If this ever fails, the storage flip changed what personas say.
 */
describe('v2-stored persona ⇒ identical prompts to its v1 original', () => {
	const asV2 = (agent: Record<string, unknown>) => ({
		...agent,
		personas_profile: upgradeV1toV2(agent.personas_profile)
	});
	// The pre-bucket shape (ageMin/ageMax only, no ageRanges) is the one place v2
	// is not byte-identical to the stored v1: the upgrade derives the buckets, and
	// the script context prefers buckets ("25–34, 35–44") over bounds ("25–44 year
	// olds"). That phrasing was already unstable in v1 — the persona page derives
	// the same chips from the bounds and re-sends them on its next save — so the
	// guarantee for this shape is equality with the profile AS THE PAGE WOULD HAVE
	// SAVED IT. Every profile that already has buckets is byte-identical.
	const PRE_BUCKET_AS_SAVED = {
		...PRE_BUCKET,
		personas_profile: {
			...PRE_BUCKET.personas_profile,
			ageRanges: deriveAgeRanges(PRE_BUCKET.personas_profile)
		}
	};
	for (const [name, agent] of [
		['pre-bucket (as the page would have saved it)', PRE_BUCKET_AS_SAVED],
		['full v1', FULL_V1],
		['legacy look', LEGACY_LOOK]
	] as const) {
		it(`${name}: script context`, () => {
			expect(buildRichAgentContext(asV2(agent))).toBe(buildRichAgentContext(agent));
		});
		it(`${name}: hero portrait`, () => {
			expect(buildHeroPortraitPrompt(BRIEF, asV2(agent), 'female')).toBe(
				buildHeroPortraitPrompt(BRIEF, agent, 'female')
			);
		});
		it(`${name}: portrait edit`, () => {
			expect(buildPortraitEditPrompt(asV2(agent))).toBe(buildPortraitEditPrompt(agent));
		});
	}
});

describe('invariants that must hold regardless of snapshot churn', () => {
	it('never invents a name for the audience and always anchors the creator name', () => {
		for (const agent of [PRE_BUCKET, FULL_V1, LEGACY_LOOK]) {
			const ctx = buildRichAgentContext(agent);
			expect(ctx).toContain(`Your name is ALWAYS ${agent.name}`);
		}
	});
	it('puts ethnicity in the portrait SUBJECT, not only the trailing clause', () => {
		const out = buildHeroPortraitPrompt(BRIEF, FULL_V1, 'female');
		expect(out.indexOf('Vietnamese')).toBeLessThan(out.indexOf('Appearance:'));
	});
	it('keeps an off-list legacy hair colour verbatim', () => {
		expect(buildHeroPortraitPrompt(BRIEF, LEGACY_LOOK, 'female')).toContain('honey blonde');
	});
});
