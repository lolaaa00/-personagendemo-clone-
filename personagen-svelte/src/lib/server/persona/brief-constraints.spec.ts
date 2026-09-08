/**
 * Brand brief → sampler constraints.
 *
 * Two properties are load-bearing and everything here exists to pin them:
 *
 *  1. The mapper NEVER INVENTS. A constraint is a hard filter on the sampler's
 *     tables, so a wrong value is worse than no value. Junk in, `{}` out.
 *  2. Every value it emits is a REAL TOKEN. A near-miss string ('beauty', 'AU')
 *     would gate out an entire table downstream with no error anywhere, so the
 *     walk test below re-checks the whole result against `isToken`.
 *
 * The en-dash cases are a regression, not a nicety: '25–34' with U+2013 is what
 * this app's own UI renders, and an ASCII-only parser reads no age from it.
 */
import { describe, it, expect } from 'vitest';
import { isToken, TOKEN_GROUPS, type TokenGroup } from '$lib/persona-contract/tokens';
import {
	briefToConstraints,
	constraintsExtractionPrompt,
	mergeExtractedConstraints,
	type BriefConstraints
} from './brief-constraints';

/** Which token group each single-token constraint must belong to. */
const GROUP_OF = {
	market: 'market',
	genderMix: 'genderMix',
	gender: 'gender',
	incomeBand: 'incomeBand',
	niche: 'niche'
} as const satisfies Record<string, TokenGroup>;

/** Re-checks every field of a result against the contract. Used as the safety net, not as the only assertion. */
function assertAllTokens(result: BriefConstraints): void {
	for (const [key, group] of Object.entries(GROUP_OF)) {
		const value = result[key as keyof typeof GROUP_OF];
		if (value === undefined) continue;
		expect(isToken(group, value), `${key}=${String(value)} is not a ${group} token`).toBe(true);
	}
	if (result.lifeStage !== undefined) {
		expect(Array.isArray(result.lifeStage)).toBe(true);
		for (const stage of result.lifeStage) {
			expect(isToken('lifeStage', stage), `lifeStage=${stage} is not a lifeStage token`).toBe(true);
		}
	}
	if (result.ageRange !== undefined) {
		const [min, max] = result.ageRange;
		expect(Number.isInteger(min) && Number.isInteger(max)).toBe(true);
		expect(min).toBeGreaterThanOrEqual(13);
		expect(max).toBeLessThanOrEqual(99);
		expect(min).toBeLessThanOrEqual(max);
	}
}

describe('briefToConstraints — the worked example', () => {
	const brief = { demographics: 'Australian women 25–40 who read every skincare label' };

	it('reads market, age, gender skew and niche out of one sentence', () => {
		expect(briefToConstraints(brief)).toEqual({
			market: 'au',
			ageRange: [25, 40],
			genderMix: 'female_skew',
			niche: 'beauty_wellness'
		});
	});

	it('leaves the CREATOR gender undefined — the sentence describes the audience', () => {
		// The most tempting wrong inference in this file: "women" is who watches,
		// not who is on camera. Forcing gender here would halve the sampler's
		// tables on evidence the brief never gave.
		expect(briefToConstraints(brief).gender).toBeUndefined();
	});

	it('does set gender when the brief literally describes the creator', () => {
		const result = briefToConstraints({
			demographics: 'Australian women 25-40',
			mission: 'A female creator who reviews every ingredient list'
		});
		expect(result.gender).toBe('female');
	});
});

describe('age ranges', () => {
	it('reads the en-dash and the hyphen identically (U+2013 regression)', () => {
		const enDash = briefToConstraints({ demographics: 'Australian women 25–40 who read every skincare label' });
		const hyphen = briefToConstraints({ demographics: 'Australian women 25-40 who read every skincare label' });
		expect(enDash).toEqual(hyphen);
		expect(enDash.ageRange).toEqual([25, 40]);
	});

	it('reads "25 to 40" and "aged 25 to 40"', () => {
		expect(briefToConstraints({ demographics: 'shoppers 25 to 40' }).ageRange).toEqual([25, 40]);
		expect(briefToConstraints({ demographics: 'shoppers aged 25 to 40' }).ageRange).toEqual([25, 40]);
	});

	it('reads a decade: "in their 30s" is [30, 39]', () => {
		expect(briefToConstraints({ demographics: 'busy people in their 30s' }).ageRange).toEqual([30, 39]);
	});

	it('reads an open range: "18+" is [18, 99]', () => {
		expect(briefToConstraints({ demographics: 'anyone 18+' }).ageRange).toEqual([18, 99]);
	});

	it('swaps a backwards range: "aged 40 to 25" is [25, 40]', () => {
		expect(briefToConstraints({ demographics: 'aged 40 to 25' }).ageRange).toEqual([25, 40]);
	});

	it('clamps into 13..99 rather than emitting an impossible band', () => {
		expect(briefToConstraints({ demographics: 'aged 5 to 90' }).ageRange).toEqual([13, 90]);
	});

	it('ignores numbers that are plainly not ages', () => {
		// "9-5" is a working day. A range whose top is under 13 is not people.
		expect(briefToConstraints({ demographics: 'people working 9-5' }).ageRange).toBeUndefined();
	});
});

describe('market', () => {
	it('reads nationality and country words', () => {
		expect(briefToConstraints({ demographics: 'Australian shoppers' }).market).toBe('au');
		expect(briefToConstraints({ demographics: 'American shoppers' }).market).toBe('us');
		expect(briefToConstraints({ demographics: 'shoppers in the United Kingdom' }).market).toBe('uk');
		expect(briefToConstraints({ demographics: 'British shoppers' }).market).toBe('uk');
	});

	it('reads uppercase country codes only', () => {
		expect(briefToConstraints({ demographics: 'shoppers in the US' }).market).toBe('us');
		// Lowercase 'us' is the pronoun. Matching it would be a silent mis-market.
		expect(briefToConstraints({ demographics: 'a brand that feels like us' }).market).toBeUndefined();
	});

	it('returns undefined when the brief names two markets — ambiguity is not a default', () => {
		expect(briefToConstraints({ demographics: 'Australian and British women' }).market).toBeUndefined();
	});

	it('returns undefined when no market is named — the caller owns the default', () => {
		expect(briefToConstraints({ demographics: 'women who read every label' }).market).toBeUndefined();
	});
});

describe('gender mix', () => {
	it('skews female on women / mums / moms', () => {
		expect(briefToConstraints({ demographics: 'women' }).genderMix).toBe('female_skew');
		expect(briefToConstraints({ demographics: 'busy mums' }).genderMix).toBe('female_skew');
		expect(briefToConstraints({ demographics: 'moms of two' }).genderMix).toBe('female_skew');
	});

	it('skews male on men / dads, and "women" never matches "men"', () => {
		expect(briefToConstraints({ demographics: 'men who lift' }).genderMix).toBe('male_skew');
		expect(briefToConstraints({ demographics: 'dads at home' }).genderMix).toBe('male_skew');
		expect(briefToConstraints({ demographics: 'women who lift' }).genderMix).toBe('female_skew');
	});

	it('is mixed when both or neither are named, and absent when there is no audience prose', () => {
		expect(briefToConstraints({ demographics: 'men and women' }).genderMix).toBe('mixed');
		expect(briefToConstraints({ demographics: 'people who cycle' }).genderMix).toBe('mixed');
		// No audience sentence at all: 'mixed' would be conjured, not read.
		expect(briefToConstraints({ brandName: 'Acme' }).genderMix).toBeUndefined();
	});
});

describe('income band', () => {
	it('maps budget wording down and premium wording up', () => {
		expect(briefToConstraints({ mission: 'affordable everyday basics' }).incomeBand).toBe('lower_middle');
		expect(briefToConstraints({ mission: 'a premium ritual' }).incomeBand).toBe('upper_middle');
		expect(briefToConstraints({ mission: 'high-end formulations' }).incomeBand).toBe('upper_middle');
	});

	it('maps luxury on its own to high', () => {
		expect(briefToConstraints({ mission: 'a luxury house' }).incomeBand).toBe('high');
	});

	it('drops conflicting price signals instead of picking one', () => {
		expect(briefToConstraints({ mission: 'affordable luxury' }).incomeBand).toBeUndefined();
	});

	it('is undefined when price is never mentioned', () => {
		expect(briefToConstraints({ mission: 'skincare that works' }).incomeBand).toBeUndefined();
	});
});

describe('life stage', () => {
	it('maps the phrases the briefs actually use', () => {
		expect(briefToConstraints({ demographics: 'uni students' }).lifeStage).toEqual(['student']);
		expect(briefToConstraints({ demographics: 'young professionals' }).lifeStage).toEqual(['early_career']);
		expect(briefToConstraints({ demographics: 'retirees and seniors' }).lifeStage).toEqual(['retired']);
		expect(briefToConstraints({ demographics: 'parents of teenagers' }).lifeStage).toEqual(['established_family']);
	});

	it('reads "new parents" as young_family only — never both family stages at once', () => {
		// "new parents" contains "parents"; emitting both would be two
		// contradictory hard filters on the same persona.
		expect(briefToConstraints({ demographics: 'new parents' }).lifeStage).toEqual(['young_family']);
		expect(briefToConstraints({ demographics: 'new mums' }).lifeStage).toEqual(['young_family']);
	});

	it('emits multiple stages in token order, not mention order', () => {
		const result = briefToConstraints({ demographics: 'retirees and students' });
		expect(result.lifeStage).toEqual(['student', 'retired']);
	});
});

describe('niche', () => {
	it('prefers the brief own structured label via tokenForLabel', () => {
		expect(briefToConstraints({ industry: 'Beauty & Wellness' }).niche).toBe('beauty_wellness');
		expect(briefToConstraints({ niche: 'Food & Cooking' }).niche).toBe('food_cooking');
	});

	it('falls back to keywords in the prose', () => {
		expect(briefToConstraints({ mission: 'gym programming and workouts' }).niche).toBe('fitness_health');
		expect(briefToConstraints({ mission: 'weeknight recipes for a small kitchen' }).niche).toBe('food_cooking');
	});

	it('is undefined when nothing in the brief names a niche', () => {
		expect(briefToConstraints({ mission: 'we help people' }).niche).toBeUndefined();
	});
});

describe('junk input never throws and never invents', () => {
	const junk: Array<[string, unknown]> = [
		['null', null],
		['undefined', undefined],
		['a number', 42],
		['a string', 'x'],
		['an array', []],
		['an empty object', {}]
	];

	for (const [name, value] of junk) {
		it(`${name} yields {}`, () => {
			expect(() => briefToConstraints(value)).not.toThrow();
			expect(briefToConstraints(value)).toEqual({});
		});
	}

	it('a deeply nested object of unrelated keys yields {}', () => {
		const nested = { a: { b: { c: { d: 'Australian women 25-40' } } } };
		expect(briefToConstraints(nested)).toEqual({});
	});
});

describe('every emitted value is a real token', () => {
	const briefs: unknown[] = [
		{ demographics: 'Australian women 25–40 who read every skincare label' },
		{
			demographics: 'Australian new mums 25–40 on a budget',
			industry: 'Beauty & Wellness'
		},
		{
			demographics: 'British men in their 30s, early career',
			mission: 'a premium male creator talking about running',
			interests: ['gym', 'protein']
		},
		{ demographics: 'US retirees 55+', niche: 'Travel & Adventure' },
		{ demographics: 'students and parents' },
		{},
		null
	];

	for (const [index, brief] of briefs.entries()) {
		it(`brief #${index} emits only contract tokens`, () => {
			const result = briefToConstraints(brief);
			assertAllTokens(result);
			// Nothing outside the declared shape leaks through. Asserted as one
			// expectation so an all-empty result (`{}`, which is a legitimate
			// answer) still counts as a checked case rather than a silent pass.
			const allowed = new Set([...Object.keys(GROUP_OF), 'ageRange', 'lifeStage']);
			expect(Object.keys(result).filter((key) => !allowed.has(key))).toEqual([]);
		});
	}

	it('the composite brief really does emit most of the shape (so the walk is not vacuous)', () => {
		const result = briefToConstraints({
			demographics: 'Australian new mums 25–40 on a budget',
			industry: 'Beauty & Wellness'
		});
		expect(result).toEqual({
			market: 'au',
			ageRange: [25, 40],
			genderMix: 'female_skew',
			incomeBand: 'lower_middle',
			lifeStage: ['young_family'],
			niche: 'beauty_wellness'
		});
	});
});

describe('briefToConstraints is deterministic', () => {
	it('the same brief always produces the same constraints', () => {
		const brief = { demographics: 'Australian women 25–40 who read every skincare label' };
		expect(briefToConstraints(brief)).toEqual(briefToConstraints({ ...brief }));
	});
});

describe('mergeExtractedConstraints', () => {
	const base: BriefConstraints = { market: 'au', ageRange: [25, 40], niche: 'beauty_wellness' };

	it('lets a valid extracted value override the base', () => {
		expect(mergeExtractedConstraints(base, { market: 'uk', gender: 'female' })).toEqual({
			market: 'uk',
			ageRange: [25, 40],
			gender: 'female',
			niche: 'beauty_wellness'
		});
	});

	it('drops invalid tokens silently and keeps the base', () => {
		expect(mergeExtractedConstraints(base, { market: 'atlantis', niche: 'vibes', gender: 'unknown' })).toEqual(base);
	});

	it('ignores unknown keys', () => {
		expect(mergeExtractedConstraints(base, { foo: 'bar', confidence: 0.9 })).toEqual(base);
	});

	it('leaves the base untouched for null, undefined and non-objects', () => {
		expect(mergeExtractedConstraints(base, null)).toEqual(base);
		expect(mergeExtractedConstraints(base, undefined)).toEqual(base);
		expect(mergeExtractedConstraints(base, 'au')).toEqual(base);
		expect(mergeExtractedConstraints(base, [])).toEqual(base);
	});

	it('keeps only the valid entries of an extracted lifeStage array', () => {
		const merged = mergeExtractedConstraints(base, { lifeStage: ['student', 'astronaut'] });
		expect(merged.lifeStage).toEqual(['student']);
	});

	it('drops an all-invalid lifeStage array rather than emitting an empty one', () => {
		const withStage: BriefConstraints = { ...base, lifeStage: ['retired'] };
		expect(mergeExtractedConstraints(withStage, { lifeStage: ['astronaut'] }).lifeStage).toEqual(['retired']);
	});

	it('normalises an extracted age range the same way the parser does', () => {
		expect(mergeExtractedConstraints(base, { ageRange: [40, 25] }).ageRange).toEqual([25, 40]);
		expect(mergeExtractedConstraints(base, { ageRange: ['25', '40'] }).ageRange).toEqual([25, 40]);
		expect(mergeExtractedConstraints(base, { ageRange: [30] }).ageRange).toEqual([25, 40]);
	});

	it('never returns a value that is not a token', () => {
		const merged = mergeExtractedConstraints(base, {
			market: 'generic',
			genderMix: 'female_skew',
			incomeBand: 'high',
			lifeStage: ['young_family'],
			niche: 'fitness_health'
		});
		assertAllTokens(merged);
	});

	it('sanitises a base that was built by hand with a bad value', () => {
		const merged = mergeExtractedConstraints({ market: 'AU', niche: 'beauty_wellness' }, {});
		expect(merged).toEqual({ niche: 'beauty_wellness' });
	});
});

describe('constraintsExtractionPrompt', () => {
	const brief = {
		demographics: 'Australian women 25–40 who read every skincare label',
		brandName: 'Lumen Skin'
	};

	it('carries the brief demographics text into the prompt', () => {
		expect(constraintsExtractionPrompt(brief)).toContain('Australian women 25–40 who read every skincare label');
	});

	it('asks for JSON only', () => {
		const prompt = constraintsExtractionPrompt(brief);
		expect(prompt).toContain('Return JSON only');
		expect(prompt).toContain('no markdown code fences');
	});

	it('enumerates the legal tokens so the model cannot invent a value', () => {
		const prompt = constraintsExtractionPrompt(brief);
		for (const token of TOKEN_GROUPS.niche) expect(prompt).toContain(token);
		for (const token of TOKEN_GROUPS.lifeStage) expect(prompt).toContain(token);
	});

	it('is a pure function of its input', () => {
		expect(constraintsExtractionPrompt(brief)).toBe(constraintsExtractionPrompt(brief));
		expect(constraintsExtractionPrompt({ ...brief })).toBe(constraintsExtractionPrompt(brief));
	});

	it('still returns a usable prompt for an unreadable brief', () => {
		expect(constraintsExtractionPrompt(null)).toContain('(none given)');
	});
});
