/**
 * The description is now written in ONE place, which removes the drift risk but
 * also removes the test that guarded it: a spec asserting that the backfill's
 * rendering equals the sampler's is, once both call the same function, an
 * assertion that cannot fail. So the sentences are pinned HERE, against literal
 * expected strings, which is the only form of this test that can still catch a
 * change nobody meant to make.
 */
import { describe, it, expect } from 'vitest';
import { ageArticle, describeFrame, describeProfile, describeShort, inSentence } from './describe';
import { samplePersonaSkeleton } from './sampler';

const CREATOR = {
	displayName: 'Jenny Tran',
	age: 34,
	location: { city: 'Brisbane', region: 'Queensland' },
	work: { title: 'Customer Support Lead', domain: 'services' },
	household: {
		relationshipStatus: 'partnered',
		children: { count: 2 },
		housingType: 'apartment_rented'
	}
};

describe('inSentence — a stored title as it reads mid-sentence', () => {
	it('lower-cases a title-cased job so it can follow an article', () => {
		expect(inSentence('Customer Support Lead')).toBe('customer support lead');
	});

	it('keeps initialisms that are capitals even in running text', () => {
		expect(inSentence('AI Engineer')).toBe('AI engineer');
		expect(inSentence('Head of HR')).toBe('head of HR');
		expect(inSentence('SEO Specialist')).toBe('SEO specialist');
	});

	it('leaves an already-lowercase title alone', () => {
		expect(inSentence('barista')).toBe('barista');
	});
});

describe('ageArticle — pronunciation, not spelling', () => {
	it("says 'an' for the ages that open with a vowel SOUND", () => {
		for (const age of [11, 18, 19, 80, 85, 89]) expect(ageArticle(age), `${age}`).toBe('an');
	});

	it("says 'a' everywhere else, including the digits that merely look like vowels", () => {
		for (const age of [8, 17, 20, 34, 79, 90]) expect(ageArticle(age), `${age}`).toBe('a');
	});
});

describe('describeShort — the one-line description', () => {
	it('renders the full sentence when every fact is present', () => {
		expect(describeShort(CREATOR)).toBe(
			'Jenny Tran is a 34-year-old customer support lead in Brisbane, Queensland.'
		);
	});

	it('uses the age article rather than the digit', () => {
		expect(describeShort({ ...CREATOR, age: 18 })).toBe(
			'Jenny Tran is an 18-year-old customer support lead in Brisbane, Queensland.'
		);
	});

	/**
	 * The degradation ladder. Each rung states a fact the profile actually has
	 * and never one it does not — an upgraded v1 blob has almost none of these,
	 * and inventing the missing half is exactly what Tier 1 must not do.
	 */
	it('degrades to the facts present, one rung at a time', () => {
		const name = { displayName: 'Jenny Tran' };
		expect(describeShort({ ...name, age: 34, work: { title: 'Barista' } })).toBe(
			'Jenny Tran is a 34-year-old barista.'
		);
		expect(describeShort({ ...name, work: { title: 'Barista' } })).toBe('Jenny Tran is a barista.');
		expect(describeShort({ ...name, work: { title: 'Editor' } })).toBe('Jenny Tran is an editor.');
		expect(describeShort({ ...name, age: 34, location: { city: 'Perth' } })).toBe(
			'Jenny Tran is 34 years old and lives in Perth.'
		);
		expect(describeShort({ ...name, age: 34 })).toBe('Jenny Tran is 34 years old.');
		expect(describeShort({ ...name, location: { region: 'Victoria' } })).toBe(
			'Jenny Tran lives in Victoria.'
		);
	});

	it('says nothing about a name it has nothing to say about', () => {
		expect(describeShort({ displayName: 'Jenny Tran' })).toBeUndefined();
	});

	it('falls back to first + last when there is no display name', () => {
		expect(describeShort({ firstName: 'Jenny', lastName: 'Tran', age: 34 })).toBe(
			'Jenny Tran is 34 years old.'
		);
	});

	it('describes nothing without a name, and never throws on junk', () => {
		for (const junk of [null, undefined, 42, 'nope', [], {}]) {
			expect(describeShort(junk)).toBeUndefined();
		}
	});
});

describe('describeFrame — the fact strip', () => {
	it('renders every fact in canonical order, tokens resolved to labels', () => {
		const frame = describeFrame(CREATOR);
		expect(frame?.map((f) => f.key)).toEqual(['age', 'location', 'work', 'household']);
		expect(frame?.[0].value).toBe('34');
		expect(frame?.[1].value).toBe('Brisbane, Queensland');
		expect(frame?.[2].value).toContain('Customer Support Lead · ');
		expect(frame?.[3].value).toContain('2 children');
		// A raw token in a UI string is the en-dash incident waiting to happen.
		for (const fact of frame ?? []) expect(fact.value).not.toMatch(/_/);
	});

	it('omits a fact whose inputs are absent rather than rendering an empty one', () => {
		const frame = describeFrame({ age: 40 });
		expect(frame?.map((f) => f.key)).toEqual(['age']);
	});

	it('says "1 child" and not "1 children"', () => {
		const frame = describeFrame({
			household: { relationshipStatus: 'partnered', children: { count: 1 } }
		});
		expect(frame?.[0].value).toContain('1 child');
		expect(frame?.[0].value).not.toContain('children');
	});

	it('omits children entirely at a count of zero', () => {
		const frame = describeFrame({
			household: { relationshipStatus: 'single', children: { count: 0 } }
		});
		expect(frame?.[0].value).not.toContain('0');
	});

	it('returns nothing for a creator with no facts', () => {
		expect(describeFrame({})).toBeUndefined();
		expect(describeFrame(null)).toBeUndefined();
	});
});

describe('describeProfile — what the sampler, the backfill and a re-roll all call', () => {
	/**
	 * The sampler writes the description by calling this module, so this pins the
	 * REAL output for a real sampled creator: if the wording changes, a persona
	 * page changes with it, and this is where that shows up.
	 */
	it('produces a complete description for a sampled creator, on every seed', () => {
		for (let i = 0; i < 25; i++) {
			const profile = samplePersonaSkeleton(
				`describe-${i}`,
				{},
				{ now: '2026-01-01T00:00:00.000Z' }
			);
			const described = describeProfile(profile);
			expect(described?.short, `seed ${i}`).toBe(profile.description?.short);
			expect(described?.frame, `seed ${i}`).toEqual(profile.description?.frame);
			expect(described?.short, `seed ${i}`).toMatch(/^.+ is an? \d+-year-old .+ in .+, .+\.$/);
			expect(described?.frame?.length, `seed ${i}`).toBe(4);
		}
	});

	it('returns undefined when there is nothing to say, so "none" is distinguishable from "empty"', () => {
		expect(describeProfile({ meta: { schemaVersion: 2 } })).toBeUndefined();
		expect(describeProfile(null)).toBeUndefined();
	});

	it('omits a half it cannot render rather than emitting an empty one', () => {
		const described = describeProfile({ meta: { schemaVersion: 2 }, creator: { age: 40 } });
		expect(described?.short).toBeUndefined(); // no name
		expect(described?.frame?.length).toBe(1);
	});
});
