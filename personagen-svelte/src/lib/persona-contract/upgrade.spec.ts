/**
 * Persona Model v2 — upgrade/downgrade golden fixtures and invariants.
 *
 * The three fixtures are the three real stored shapes in production (the same
 * ones prompt-regression.spec.ts pins). Their expected v2 output is written
 * out in full: a change to the mapping is a reviewed diff here, never a
 * surprise on a live persona.
 */
import { describe, it, expect } from 'vitest';
import { upgradeV1toV2, downgradeV2toV1 } from './upgrade';
import { isPersonaProfileV2 } from './schema';
import { AGE_RANGE_KEYS, PERSONA_ARCHETYPES, CONTENT_FOCUS_OPTIONS, ETHNICITY_OPTIONS, SKIN_TONE_OPTIONS, HAIR_COLOR_OPTIONS, HAIRSTYLE_OPTIONS, HAIR_LENGTH_OPTIONS, EYE_COLOR_OPTIONS, BODY_TYPE_OPTIONS, PERSONA_AGE_OPTIONS } from '../persona-profile';
import { deriveAgeRanges, serializePersonaProfile, type PersonaProfile } from '../persona-profile-store';

// ── Fixtures (production shapes) ─────────────────────────────────────────────

/** 1. Pre-bucket: only ageMin/ageMax, no appearance. */
const PRE_BUCKET: PersonaProfile = {
	ageMin: 25,
	ageMax: 44,
	gender: 'female',
	archetype: 'The Activist / Advocate',
	targetAvatar: 'A renter who composts and feels guilty about parcels'
};

/** 2. Full v1 with curated appearance and identity kit. */
const FULL_V1: PersonaProfile = {
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
	handleCandidates: [{ handle: 'jenny_tran', status: 'confirmed' }],
	confirmedHandles: { tiktok: 'jenny_tran' },
	displayName: 'Jenny Tran'
};

/** 3. Legacy look: combined hairstyle + off-list hair colour + an off-list archetype, plus a stray key. */
const LEGACY_LOOK = {
	ageRanges: ['25–34'],
	gender: 'female',
	archetype: 'Mentor',
	contentFocus: 'Entertainment & Humor',
	appearance: {
		hairstyle: 'long loose waves',
		hairLength: 'Long',
		hairColor: 'honey blonde',
		eyeColor: 'Hazel',
		tattoo: 'small fern on wrist'
	},
	someOldKey: { kept: true }
} as unknown as PersonaProfile;

// ── Golden outputs ───────────────────────────────────────────────────────────

describe('upgradeV1toV2 — golden fixtures', () => {
	it('pre-bucket: recovers the audience buckets from the bounds', () => {
		expect(upgradeV1toV2(PRE_BUCKET)).toEqual({
			meta: {
				schemaVersion: 2,
				generator: 'manual',
				upgradedFrom: 1,
				fieldSources: {
					'creator.gender': 'user',
					'audience.ageRanges': 'user',
					'audience.targetAvatar': 'user',
					'strategy.archetype': 'user'
				}
			},
			creator: { gender: 'female' },
			audience: {
				ageRanges: ['25_34', '35_44'],
				targetAvatar: 'A renter who composts and feels guilty about parcels'
			},
			strategy: { archetype: 'activist_advocate' }
		});
	});

	it('full v1: every field lands in its sub-object, tokens plus verbatim text', () => {
		const out = upgradeV1toV2(FULL_V1);
		expect(out.meta.schemaVersion).toBe(2);
		expect(out.creator).toEqual({
			gender: 'female',
			displayName: 'Jenny Tran',
			heritageText: 'Vietnamese', // no token: "Vietnamese" is finer than the heritage list; kept verbatim
			age: 32,
			ageSource: 'bucket'
		});
		expect(out.look).toEqual({
			skinTone: 'medium',
			skinToneText: 'Medium',
			bodyType: 'slim',
			bodyTypeText: 'Slim',
			hair: {
				color: 'black',
				colorText: 'Black',
				length: 'shoulder_length',
				lengthText: 'Shoulder-Length',
				style: 'straight',
				styleText: 'Straight'
			},
			eyes: { color: 'dark_brown', colorText: 'Dark Brown' },
			wardrobe: 'cream linen sets, minimal gold jewelry',
			outfitColors: 'cream, tan, olive',
			headwear: 'none',
			distinctiveFeatures: 'small beauty mark below left eye',
			styling: 'quiet luxury, summer'
		});
		expect(out.voice).toEqual({ gender: 'female', nationality: 'Vietnamese-Australian', accent: 'Australian' });
		expect(out.audience).toEqual({
			ageRanges: ['25_34', '35_44'],
			targetAvatar: 'A 32-year-old who has been burned by a viral serum',
			psychProfile: 'Wants proof, distrusts hype, shares wins with her group chat.'
		});
		expect(out.strategy).toEqual({
			archetype: 'expert_authority',
			contentFocus: 'education_how_tos',
			contentAngle: 'I read the label so you do not have to.'
		});
		expect(out.identityKit).toEqual({
			bios: { tiktok: 'Chemist. Reads the label.' },
			handleCandidates: [{ handle: 'jenny_tran', status: 'confirmed' }],
			confirmedHandles: { tiktok: 'jenny_tran' }
		});
		expect(out._legacy).toBeUndefined();
		// Every produced leaf is the user's.
		expect(new Set(Object.values(out.meta.fieldSources ?? {}))).toEqual(new Set(['user']));
		expect(out.meta.fieldSources?.['look.hair.colorText']).toBe('user');
	});

	it('legacy look: off-list values are kept VERBATIM, unknown keys go to _legacy', () => {
		const out = upgradeV1toV2(LEGACY_LOOK);
		expect(out.look).toEqual({
			hair: {
				length: 'long',
				lengthText: 'Long',
				styleText: 'long loose waves', // no token — combined legacy value survives untouched
				colorText: 'honey blonde' // no token — never snapped to "Blonde"
			},
			eyes: { color: 'hazel', colorText: 'Hazel' }
		});
		expect(out.strategy).toEqual({ archetypeText: 'Mentor', contentFocus: 'entertainment_humor' });
		expect(out._legacy).toEqual({ someOldKey: { kept: true }, appearance: { tattoo: 'small fern on wrist' } });
	});
});

// ── Invariants ───────────────────────────────────────────────────────────────

describe('upgradeV1toV2 — invariants', () => {
	it('is pure: the input object is not mutated', () => {
		const frozen = JSON.parse(JSON.stringify(FULL_V1));
		upgradeV1toV2(frozen);
		expect(frozen).toEqual(FULL_V1);
	});

	it('is idempotent: a v2 input is returned unchanged, and upgrade∘upgrade = upgrade', () => {
		const once = upgradeV1toV2(FULL_V1);
		const twice = upgradeV1toV2(once);
		expect(twice).toBe(once);
		expect(isPersonaProfileV2(once)).toBe(true);
	});

	it('never throws on junk and yields a minimal v2 shell', () => {
		for (const junk of [null, undefined, 42, 'x', [], {}, { gender: 'nonbinary', ageRanges: 'nope' }]) {
			const out = upgradeV1toV2(junk);
			expect(out.meta.schemaVersion).toBe(2);
		}
		expect(upgradeV1toV2({ gender: 'nonbinary' }).creator).toBeUndefined();
	});

	it("passes v1's explicit clears through as empty values (the merge turns them into deletions)", () => {
		const v1 = {
			gender: '',
			ageRanges: [],
			archetype: '',
			targetAvatar: '',
			appearance: {},
			voiceProfile: {},
			bios: {},
			handleCandidates: [],
			confirmedHandles: {}
		} as unknown as PersonaProfile;
		// Stored mode: a record at rest carries no clear markers at all.
		expect(upgradeV1toV2(v1)).toEqual({ meta: { schemaVersion: 2, generator: 'manual', upgradedFrom: 1 } });
		// Patch mode: the clears pass through.
		const out = upgradeV1toV2(v1, 'patch');
		expect(out.creator).toEqual({ gender: '' });
		expect(out.audience).toEqual({ ageRanges: [], targetAvatar: '' });
		expect(out.strategy).toEqual({ archetype: '', archetypeText: '' });
		expect(out.look).toEqual({});
		expect(out.voice).toEqual({});
		expect(out.identityKit).toEqual({ bios: {}, handleCandidates: [], confirmedHandles: {} });
	});

	it('an empty v1 profile produces no sub-objects and no sources', () => {
		expect(upgradeV1toV2({})).toEqual({ meta: { schemaVersion: 2, generator: 'manual', upgradedFrom: 1 } });
	});
});

describe('downgradeV2toV1 — round trip', () => {
	it('full v1 round-trips exactly (modulo the store\'s own normalisation)', () => {
		const back = downgradeV2toV1(upgradeV1toV2(FULL_V1));
		expect(serializePersonaProfile(back)).toEqual(serializePersonaProfile(FULL_V1));
	});

	it('legacy look round-trips: verbatim text and stray keys come back', () => {
		const back = downgradeV2toV1(upgradeV1toV2(LEGACY_LOOK)) as unknown as Record<string, unknown>;
		expect(back.appearance).toEqual({
			hairstyle: 'long loose waves',
			hairLength: 'Long',
			hairColor: 'honey blonde',
			eyeColor: 'Hazel',
			tattoo: 'small fern on wrist'
		});
		expect(back.archetype).toBe('Mentor');
		expect(back.someOldKey).toEqual({ kept: true });
	});

	it('pre-bucket: bounds come back and buckets agree with the v1 derivation', () => {
		const back = downgradeV2toV1(upgradeV1toV2(PRE_BUCKET));
		expect(back.ageRanges).toEqual(deriveAgeRanges(PRE_BUCKET));
		expect(back.ageMin).toBe(25);
		expect(back.ageMax).toBe(44);
	});

	it('200 synthetic curated profiles round-trip losslessly', () => {
		// Deterministic LCG so a failure is reproducible.
		let s = 12345;
		const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
		const pick = <T>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
		for (let i = 0; i < 200; i++) {
			const v1: PersonaProfile = {
				ageRanges: [pick(AGE_RANGE_KEYS)],
				gender: pick(['female', 'male'] as const),
				archetype: pick(PERSONA_ARCHETYPES),
				contentFocus: pick(CONTENT_FOCUS_OPTIONS),
				appearance: {
					ethnicity: pick(ETHNICITY_OPTIONS),
					personaAge: pick(PERSONA_AGE_OPTIONS),
					skinTone: pick(SKIN_TONE_OPTIONS),
					bodyType: pick(BODY_TYPE_OPTIONS),
					hairLength: pick(HAIR_LENGTH_OPTIONS),
					hairstyle: pick(HAIRSTYLE_OPTIONS),
					hairColor: pick(HAIR_COLOR_OPTIONS),
					eyeColor: pick(EYE_COLOR_OPTIONS)
				}
			};
			const back = downgradeV2toV1(upgradeV1toV2(v1));
			expect(serializePersonaProfile(back), `profile #${i}`).toEqual(serializePersonaProfile(v1));
		}
	});
});
