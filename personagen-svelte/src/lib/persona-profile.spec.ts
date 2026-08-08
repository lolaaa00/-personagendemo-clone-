/**
 * Appearance trait helpers — pure-logic tests.
 *
 * The load-bearing contract here is the STORAGE CONTRACT documented in
 * persona-profile.ts: every appearance value is a plain string, and the curated
 * chip option sets are a UI affordance, NOT an enum. The #1 regression risk when
 * chips were added is a legacy free-text value ('honey blonde') being blanked or
 * snapped to a nearest curated option — that silently changes an existing
 * persona's FACE on its next generation. Most of this file guards that.
 *
 * The second risk is prompt duplication: `hairLength` was split out of
 * `hairstyle`, and personas created before the split store a combined value
 * ('long loose waves'), which must not render as "long long loose waves".
 */
import { describe, it, expect } from 'vitest';
import {
	APPEARANCE_FIELDS,
	ADVANCED_APPEARANCE_FIELDS,
	BEST_FIT,
	BODY_TYPE_OPTIONS,
	CURATED_APPEARANCE_FIELDS,
	HAIR_COLOR_OPTIONS,
	HAIR_LENGTH_OPTIONS,
	PERSONA_AGE_OPTIONS,
	SKIN_TONE_OPTIONS,
	appearanceToPromptClause,
	coerceAppearance,
	isCuratedTrait,
	traitOptionsFor
} from './persona-profile';

describe('coerceAppearance — legacy free-text values survive untouched', () => {
	it('preserves off-list values VERBATIM instead of snapping to a curated option', () => {
		// These are real pre-chip stored values. 'honey blonde' partially matches
		// 'Blonde' and 'long loose waves' partially matches 'Long'/'Wavy' — if
		// anything ever coerced them onto the option sets, every existing
		// persona's face would change on the next generation.
		const legacy = {
			hairColor: 'honey blonde',
			hairstyle: 'long loose waves',
			ethnicity: 'Vietnamese-Australian',
			eyeColor: 'warm hazel-green',
			skinTone: 'sun-kissed',
			bodyType: 'lean dancer build',
			personaAge: 'late twenties',
			hairLength: 'past the shoulders'
		};
		expect(coerceAppearance(legacy)).toEqual(legacy);
	});

	it('trims whitespace but changes nothing else — no casing, no normalisation', () => {
		expect(coerceAppearance({ hairColor: '  honey blonde  ', wardrobe: '\tcream linen sets\n' })).toEqual({
			hairColor: 'honey blonde',
			wardrobe: 'cream linen sets'
		});
	});

	it('keeps only known appearance keys, and only string values', () => {
		expect(
			coerceAppearance({
				hairColor: 'Blonde',
				bogusTrait: 'x',
				eyeColor: 42,
				wardrobe: null,
				styling: ['summer'],
				distinctiveFeatures: ''
			})
		).toEqual({ hairColor: 'Blonde' });
	});

	it('returns {} for junk input', () => {
		expect(coerceAppearance(null)).toEqual({});
		expect(coerceAppearance(undefined)).toEqual({});
		expect(coerceAppearance('honey blonde')).toEqual({});
		expect(coerceAppearance(42)).toEqual({});
		expect(coerceAppearance({})).toEqual({});
	});
});

describe("the 'Best Fit' sentinel means unset", () => {
	it('is dropped by coerceAppearance, case-insensitively', () => {
		expect(BEST_FIT).toBe('Best Fit');
		expect(
			coerceAppearance({
				hairColor: BEST_FIT,
				hairstyle: 'best fit',
				eyeColor: 'BEST FIT',
				skinTone: '  Best Fit  ',
				bodyType: 'Athletic'
			})
		).toEqual({ bodyType: 'Athletic' });
	});

	it('produces no prompt fragment', () => {
		expect(appearanceToPromptClause({ hairColor: BEST_FIT, hairstyle: 'best fit' })).toBe('');
		// …and it doesn't suppress the traits that ARE set.
		expect(appearanceToPromptClause({ hairColor: 'Best Fit', eyeColor: 'Blue' })).toBe(
			' Appearance: Blue eyes.'
		);
	});
});

describe('appearanceToPromptClause — hair length composes with hairstyle', () => {
	it('does NOT duplicate the length word when the hairstyle already contains it', () => {
		// Pre-split personas store the combined value in `hairstyle`.
		const clause = appearanceToPromptClause({ hairLength: 'Long', hairstyle: 'long loose waves' });
		expect(clause).toBe(' Appearance: long loose waves hair.');
		expect(clause).not.toMatch(/long\s+long/i);
	});

	it('emits BOTH when the length is not already implied by the style', () => {
		expect(appearanceToPromptClause({ hairLength: 'Long', hairstyle: 'Curly' })).toBe(
			' Appearance: Long Curly hair.'
		);
		expect(
			appearanceToPromptClause({ hairColor: 'Blonde', hairLength: 'Long', hairstyle: 'Curly' })
		).toBe(' Appearance: Blonde Long Curly hair.');
	});

	it('matches the length as a whole word only (a substring is not redundancy)', () => {
		// 'Short' inside 'shortcut'-style words must not suppress the real length.
		expect(appearanceToPromptClause({ hairLength: 'Short', hairstyle: 'shortcut bob' })).toBe(
			' Appearance: Short shortcut bob hair.'
		);
	});

	it('emits either half on its own', () => {
		expect(appearanceToPromptClause({ hairLength: 'Waist-Length' })).toBe(
			' Appearance: Waist-Length hair.'
		);
		expect(appearanceToPromptClause({ hairstyle: 'Sleek Bun' })).toBe(' Appearance: Sleek Bun hair.');
		expect(appearanceToPromptClause({ hairColor: 'Auburn' })).toBe(' Appearance: Auburn hair.');
	});
});

describe('appearanceToPromptClause', () => {
	it('returns an empty string for an empty / null appearance', () => {
		expect(appearanceToPromptClause(null)).toBe('');
		expect(appearanceToPromptClause(undefined)).toBe('');
		expect(appearanceToPromptClause({})).toBe('');
		// Nothing but unknown keys is still nothing.
		expect(appearanceToPromptClause({ bogusTrait: 'x' })).toBe('');
	});

	it('deliberately does NOT emit ethnicity', () => {
		// The portrait builders put ethnicity in the SUBJECT of the prompt, which
		// is a stronger signal than a trailing clause; repeating it here would
		// dilute or duplicate it.
		const clause = appearanceToPromptClause({
			ethnicity: 'Vietnamese',
			hairColor: 'Black',
			eyeColor: 'Dark Brown'
		});
		expect(clause).not.toMatch(/Vietnamese/i);
		expect(clause).toBe(' Appearance: Black hair, Dark Brown eyes.');
	});

	it('emits the four subject traits (personaAge, skinTone, bodyType, hairLength) first', () => {
		expect(
			appearanceToPromptClause({
				personaAge: '25–29',
				skinTone: 'Olive',
				bodyType: 'Athletic',
				hairLength: 'Shoulder-Length'
			})
		).toBe(' Appearance: 25–29 years old, Olive skin tone, Athletic build, Shoulder-Length hair.');
	});

	it('composes the full clause in a stable order', () => {
		expect(
			appearanceToPromptClause({
				ethnicity: 'Vietnamese',
				personaAge: '25–29',
				skinTone: 'Olive',
				bodyType: 'Slim',
				hairLength: 'Long',
				hairstyle: 'Wavy',
				hairColor: 'Dark Brown',
				eyeColor: 'Brown',
				distinctiveFeatures: 'freckles',
				headwear: 'silk turban',
				wardrobe: 'cream linen sets',
				outfitColors: 'earth tones',
				styling: 'breezy minimalism'
			})
		).toBe(
			' Appearance: 25–29 years old, Olive skin tone, Slim build, Dark Brown Long Wavy hair, ' +
				'Brown eyes, freckles, wearing a silk turban, dressed in cream linen sets, ' +
				'outfit in earth tones, breezy minimalism styling.'
		);
	});

	it("never renders 'wearing a none' for an unset headwear field", () => {
		// 'none' is the placeholder's own example value, so it is very common.
		for (const value of ['none', 'None', 'NONE', 'no', 'n/a', 'N/A']) {
			const clause = appearanceToPromptClause({ headwear: value, eyeColor: 'Blue' });
			expect(clause, `headwear: ${value}`).toBe(' Appearance: Blue eyes.');
		}
		// A real headwear value still renders.
		expect(appearanceToPromptClause({ headwear: 'silk turban' })).toBe(
			' Appearance: wearing a silk turban.'
		);
	});
});

describe('traitOptionsFor / isCuratedTrait', () => {
	it('returns the curated options for a chip-backed trait', () => {
		expect(traitOptionsFor('hairColor')).toEqual([...HAIR_COLOR_OPTIONS]);
		expect(traitOptionsFor('hairLength')).toEqual([...HAIR_LENGTH_OPTIONS]);
		expect(traitOptionsFor('skinTone')).toEqual([...SKIN_TONE_OPTIONS]);
		expect(traitOptionsFor('bodyType')).toEqual([...BODY_TYPE_OPTIONS]);
		expect(traitOptionsFor('personaAge')).toEqual([...PERSONA_AGE_OPTIONS]);
	});

	it('returns [] for free-text and unknown traits', () => {
		expect(traitOptionsFor('wardrobe')).toEqual([]);
		expect(traitOptionsFor('headwear')).toEqual([]);
		expect(traitOptionsFor('distinctiveFeatures')).toEqual([]);
		expect(traitOptionsFor('notATrait')).toEqual([]);
	});

	it('isCuratedTrait agrees with traitOptionsFor for every declared field', () => {
		for (const f of APPEARANCE_FIELDS) {
			expect(isCuratedTrait(f.key), f.key).toBe(traitOptionsFor(f.key).length > 0);
		}
		expect(isCuratedTrait('hairColor')).toBe(true);
		expect(isCuratedTrait('wardrobe')).toBe(false);
		expect(isCuratedTrait('notATrait')).toBe(false);
	});

	it('splits the field list into curated and advanced with nothing lost', () => {
		expect(CURATED_APPEARANCE_FIELDS.every((f) => isCuratedTrait(f.key))).toBe(true);
		expect(ADVANCED_APPEARANCE_FIELDS.every((f) => !isCuratedTrait(f.key))).toBe(true);
		expect(CURATED_APPEARANCE_FIELDS.length + ADVANCED_APPEARANCE_FIELDS.length).toBe(
			APPEARANCE_FIELDS.length
		);
		// Free-text fields live in the collapsed "Advanced" group by convention.
		expect(ADVANCED_APPEARANCE_FIELDS.every((f) => f.group === 'advanced')).toBe(true);
	});

	it('every curated option set is usable as a stored value (plain non-empty strings)', () => {
		// Guards the STORAGE CONTRACT: options are strings, not ids/objects, so a
		// chip selection round-trips through coerceAppearance unchanged.
		for (const f of CURATED_APPEARANCE_FIELDS) {
			for (const option of f.options) {
				expect(typeof option, `${f.key} → ${String(option)}`).toBe('string');
				expect(coerceAppearance({ [f.key]: option })).toEqual({ [f.key]: option });
			}
		}
	});
});

describe('traitOptionsFor prototype safety', () => {
	it('does not leak Object.prototype members as curated traits', () => {
		expect(traitOptionsFor('constructor')).toEqual([]);
		expect(traitOptionsFor('toString')).toEqual([]);
		expect(traitOptionsFor('hasOwnProperty')).toEqual([]);
		expect(isCuratedTrait('constructor')).toBe(false);
		expect(isCuratedTrait('toString')).toBe(false);
	});
});
