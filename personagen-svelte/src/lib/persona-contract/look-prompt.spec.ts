/**
 * Persona Model v2 — look → prompt clause invariants.
 *
 * These assertions guard the two properties the image pipeline depends on:
 * a stored verbatim value is NEVER snapped to a token label (an existing
 * persona's face must not change on its next generation), and the wording of
 * the clause only ever changes as a reviewed snapshot diff.
 */
import { describe, it, expect } from 'vitest';
import { lookToPromptClause, lookPreservationClause } from './look-prompt';
import type { PersonaLook } from './schema';

/** A look with every field populated — the snapshot subject. */
const FULL_LOOK: PersonaLook = {
	skinTone: 'olive',
	bodyType: 'athletic',
	heightCm: 165,
	faceShape: 'oval',
	browShape: 'soft_arch',
	hair: {
		color: 'dark_brown',
		grayCoverage: 'salt_and_pepper',
		length: 'shoulder_length',
		texture: 'thick',
		style: 'wavy'
	},
	facialHair: 'short_beard',
	eyes: { color: 'hazel' },
	eyewear: 'glasses',
	distinctiveFeatures: 'freckles across the nose',
	wardrobe: 'linen shirts and denim',
	outfitColors: 'sand and navy',
	headwear: 'flat cap',
	styling: 'relaxed coastal',
	clothingSizes: { top: 'M', bottom: '32', shoe: '10' }
};

describe('lookToPromptClause', () => {
	it('returns an empty string for an empty, null or undefined look', () => {
		expect(lookToPromptClause({})).toBe('');
		expect(lookToPromptClause(null)).toBe('');
		expect(lookToPromptClause(undefined)).toBe('');
		expect(lookToPromptClause({ hair: {} })).toBe('');
	});

	it('renders a fully populated look (snapshot — wording changes must be reviewed)', () => {
		expect(lookToPromptClause(FULL_LOOK, { age: 34 })).toMatchSnapshot();
	});

	it('prefers the stored verbatim text over the token label', () => {
		const clause = lookToPromptClause({ hair: { color: 'blonde', colorText: 'honey blonde' } });
		expect(clause).toContain('honey blonde');
		expect(clause).not.toContain('Blonde');
	});

	it('prefers verbatim text for skin tone, body type and eye colour too', () => {
		const clause = lookToPromptClause({
			skinTone: 'olive',
			skinToneText: 'warm olive',
			bodyType: 'athletic',
			bodyTypeText: 'runner-lean',
			eyes: { color: 'hazel', colorText: 'green-hazel' }
		});
		expect(clause).toContain('warm olive skin tone');
		expect(clause).toContain('runner-lean build');
		expect(clause).toContain('green-hazel eyes');
	});

	it('does not repeat the length when the style text already contains it', () => {
		const clause = lookToPromptClause({ hair: { length: 'long', styleText: 'long loose waves' } });
		expect(clause.toLowerCase()).not.toContain('long long');
		expect(clause).toContain('long loose waves hair');
	});

	it('still emits the length when the style does not contain it', () => {
		const clause = lookToPromptClause({ hair: { length: 'long', style: 'braided' } });
		expect(clause).toContain('Long Braided hair');
	});

	it('skips "none" values for facial hair, eyewear, gray coverage and headwear', () => {
		const clause = lookToPromptClause({
			facialHair: 'none',
			eyewear: 'none',
			headwear: 'none',
			hair: { grayCoverage: 'none' }
		});
		expect(clause).toBe('');
	});

	it('renders an exact age when given and nothing when not', () => {
		expect(lookToPromptClause({}, { age: 34 })).toContain('34 years old');
		expect(lookToPromptClause({ skinTone: 'olive' })).not.toContain('years old');
	});

	it('renders height only when set', () => {
		expect(lookToPromptClause({ heightCm: 165 })).toContain('about 165 cm tall');
		expect(lookToPromptClause({ skinTone: 'olive' })).not.toContain('cm tall');
	});

	it('renders face shape only when set', () => {
		expect(lookToPromptClause({ faceShape: 'oval' })).toContain('oval face');
		expect(lookToPromptClause({ skinTone: 'olive' })).not.toContain('face');
	});

	it('renders brow shape only when set', () => {
		expect(lookToPromptClause({ browShape: 'soft_arch' })).toContain('soft arch brows');
		expect(lookToPromptClause({ skinTone: 'olive' })).not.toContain('brows');
	});

	it('renders hair texture only when set', () => {
		expect(lookToPromptClause({ hair: { texture: 'thick', style: 'wavy' } })).toContain(
			'thick Wavy hair'
		);
		expect(lookToPromptClause({ hair: { style: 'wavy' } })).not.toContain('thick');
	});

	it('renders gray coverage only when set', () => {
		expect(lookToPromptClause({ hair: { grayCoverage: 'salt_and_pepper' } })).toContain(
			'salt-and-pepper hair'
		);
		expect(lookToPromptClause({ hair: { style: 'wavy' } })).not.toContain('salt-and-pepper');
	});

	it('renders facial hair only when set', () => {
		expect(lookToPromptClause({ facialHair: 'short_beard' })).toContain('short beard');
		expect(lookToPromptClause({ skinTone: 'olive' })).not.toContain('beard');
	});

	it('renders eyewear only when set', () => {
		expect(lookToPromptClause({ eyewear: 'glasses' })).toContain('wearing glasses');
		expect(lookToPromptClause({ eyewear: 'sunglasses_often' })).toContain(
			'often wearing sunglasses'
		);
		expect(lookToPromptClause({ skinTone: 'olive' })).not.toContain('glasses');
	});

	it('is deterministic for the same input', () => {
		const first = lookToPromptClause(FULL_LOOK, { age: 34 });
		const second = lookToPromptClause(FULL_LOOK, { age: 34 });
		expect(first).toBe(second);
	});

	it('does not mutate the look it is given', () => {
		const before = JSON.parse(JSON.stringify(FULL_LOOK)) as PersonaLook;
		lookToPromptClause(FULL_LOOK, { age: 34 });
		lookPreservationClause(FULL_LOOK);
		expect(FULL_LOOK).toEqual(before);
	});
});

describe('lookPreservationClause', () => {
	it('returns an empty string for an empty, null or undefined look', () => {
		expect(lookPreservationClause({})).toBe('');
		expect(lookPreservationClause(null)).toBe('');
		expect(lookPreservationClause(undefined)).toBe('');
		expect(lookPreservationClause({ skinTone: 'olive' })).toBe('');
	});

	it('names the facial hair when it is set', () => {
		const clause = lookPreservationClause({ facialHair: 'short_beard' });
		expect(clause).toContain('Keep their facial hair exactly as in the reference: short beard.');
	});

	it('names the glasses when eyewear is glasses', () => {
		expect(lookPreservationClause({ eyewear: 'glasses' })).toContain('Keep their glasses.');
		expect(lookPreservationClause({ eyewear: 'sunglasses_often' })).toContain(
			'Keep their sunglasses.'
		);
	});

	it('names both when both are set', () => {
		expect(lookPreservationClause({ facialHair: 'full_beard', eyewear: 'glasses' })).toBe(
			' Keep their facial hair exactly as in the reference: full beard. Keep their glasses.'
		);
	});

	it('returns an empty string when both are "none"', () => {
		expect(lookPreservationClause({ facialHair: 'none', eyewear: 'none' })).toBe('');
	});

	it('is deterministic for the same input', () => {
		expect(lookPreservationClause(FULL_LOOK)).toBe(lookPreservationClause(FULL_LOOK));
	});
});
