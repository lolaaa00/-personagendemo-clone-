/**
 * The flip's guarantee: the model contributes prose and nothing else.
 *
 * The prompt asks it not to change the facts. This spec proves the code does not
 * depend on it complying — a request is not a guarantee, a filter is.
 */
import { describe, it, expect } from 'vitest';
import { applyProseOnly, proseOnlyPrompt, skeletonFor, toV1Response } from './generate-v2';
import { NICHE_OPTIONS, PERSONA_ARCHETYPES, CONTENT_FOCUS_OPTIONS } from '$lib/persona-profile';

const BRIEF = {
	brandName: 'Honeyx',
	tagline: 'label-first skincare',
	mission: 'no mystery ingredients',
	demographics: 'Australian women 25–40 who read every skincare label',
	painPoints: 'burned by viral serums'
};

const skeleton = () =>
	skeletonFor({ seed: 'agent-1', brief: BRIEF, now: '2026-09-08T00:00:00.000Z' });

describe('skeletonFor — facts before prose', () => {
	it('is deterministic for a seed, so a re-generate reproduces the same person', () => {
		expect(
			JSON.stringify(skeletonFor({ seed: 'a', brief: BRIEF, now: '2026-01-01T00:00:00.000Z' }))
		).toBe(
			JSON.stringify(skeletonFor({ seed: 'a', brief: BRIEF, now: '2026-01-01T00:00:00.000Z' }))
		);
	});

	it('takes market and niche from the brief for the creator', () => {
		const s = skeleton();
		expect(s.creator?.market).toBe('au');
		expect(s.strategy?.niche).toBe('beauty_wellness');
	});

	it("routes the brief's age band and gender skew to the AUDIENCE, not the creator", () => {
		const s = skeleton();
		expect(s.audience?.ageRanges).toEqual(['25_34', '35_44']);
		expect(s.audience?.genderMix).toBe('female_skew');
		// From the customer's own brief, so never overwritable by automation.
		expect(s.meta.fieldSources?.['audience.ageRanges']).toBe('extracted');
		expect(s.meta.fieldSources?.['audience.genderMix']).toBe('extracted');
	});

	/**
	 * THE REGRESSION. "Australian women 25–40" describes who watches, not who
	 * posts. Feeding it in as the creator's age produced a roster where every
	 * creator happened to be the age of the target customer — and the test that
	 * used to live here asserted exactly that, which is why it survived review.
	 * Sampling across many seeds is the only way to show the constraint is gone:
	 * a single seed landing outside 25–40 could be luck.
	 */
	it('does not confine the creator to the audience age band', () => {
		const ages = Array.from(
			{ length: 120 },
			(_, i) =>
				skeletonFor({ seed: `creator-${i}`, brief: BRIEF, now: '2026-09-08T00:00:00.000Z' }).creator
					?.age ?? 0
		);
		expect(ages.some((a) => a < 25)).toBe(true);
		expect(ages.some((a) => a > 40)).toBe(true);
		expect(ages.every((a) => a >= 18 && a <= 80)).toBe(true);
	});

	/**
	 * An explicit creator age range from the UI is a different thing entirely and
	 * must still pin, or "I asked for someone in their forties" stops working.
	 */
	it('still honours an explicit creator age range passed as a constraint', () => {
		for (let i = 0; i < 40; i++) {
			const s = skeletonFor({
				seed: `pin-${i}`,
				brief: BRIEF,
				constraints: { ageRange: [42, 48] }
			});
			expect(s.creator?.age).toBeGreaterThanOrEqual(42);
			expect(s.creator?.age).toBeLessThanOrEqual(48);
		}
	});

	/**
	 * A caller that builds its constraints object field by field hands us keys
	 * whose value is `undefined`. Spreading those over the brief-derived values
	 * would erase them silently, and nothing in the visible output would say so.
	 */
	it('an explicitly-undefined constraint does not erase the brief-derived one', () => {
		const s = skeletonFor({
			seed: 'agent-1',
			brief: BRIEF,
			constraints: { market: undefined, niche: undefined }
		});
		expect(s.creator?.market).toBe('au');
		expect(s.strategy?.niche).toBe('beauty_wellness');
	});

	/**
	 * The no-provider path. A persona created with every API key removed must be
	 * complete, not half-blank: archetype and content focus come from the
	 * registry's tables so there is always something to overwrite later.
	 */
	it('samples a positioning even though no model has run', () => {
		const s = skeleton();
		expect(s.strategy?.archetype).toBeTruthy();
		expect(s.strategy?.contentFocus).toBeTruthy();
		expect(s.meta.fieldSources?.['strategy.archetype']).toBe('sampled');
		expect(s.meta.fieldSources?.['strategy.contentFocus']).toBe('sampled');
		const v1 = toV1Response(s);
		expect(PERSONA_ARCHETYPES).toContain(v1.archetype as string);
		expect(CONTENT_FOCUS_OPTIONS).toContain(v1.contentFocus as string);
		expect(v1.ageRanges).toEqual(['25–34', '35–44']);
	});

	it('conditions gender on a supplied name rather than overwriting the name', () => {
		const s = skeletonFor({ seed: 'x', name: 'Jenny Tran', brief: BRIEF });
		expect(s.creator?.firstName).toBe('Jenny');
		expect(s.creator?.lastName).toBe('Tran');
		expect(s.creator?.gender).toBe('female');
	});

	it('an explicit gender wins over the name inference', () => {
		const s = skeletonFor({ seed: 'x', name: 'Jenny Tran', gender: 'male', brief: BRIEF });
		expect(s.creator?.gender).toBe('male');
	});

	it('works with no brief at all', () => {
		expect(skeletonFor({ seed: 'bare' }).creator?.age).toBeGreaterThan(0);
	});
});

describe('applyProseOnly — the guarantee', () => {
	it('accepts prose', () => {
		const out = applyProseOnly(skeleton(), {
			soul: 'Warm and exacting.',
			archetype: 'The Expert / Authority',
			contentFocus: 'Education & How-Tos',
			contentAngle: 'I read the label so you do not have to.',
			targetAvatar: 'A 32-year-old burned by a viral serum',
			psychProfile: 'Wants proof, distrusts hype.',
			wardrobe: 'cream linen sets',
			outfitColors: 'cream and olive',
			styling: 'quiet luxury',
			distinctiveFeatures: 'beauty mark below the left eye'
		});
		expect(out.strategy?.archetype).toBe('expert_authority');
		expect(out.strategy?.contentFocus).toBe('education_how_tos');
		expect(out.strategy?.contentAngle).toContain('read the label');
		expect(out.audience?.targetAvatar).toContain('viral serum');
		expect(out.look?.wardrobe).toBe('cream linen sets');
		expect(out.look?.distinctiveFeatures).toContain('beauty mark');
	});

	it('DISCARDS every sampled fact the model tries to change — the whole point', () => {
		const base = skeleton();
		const hostile = {
			// Prose it is allowed to write…
			contentAngle: 'legit angle',
			// …and every fact it is not.
			creator: {
				age: 99,
				firstName: 'Impostor',
				lastName: 'Name',
				heritage: 'white',
				gender: 'male'
			},
			look: { hair: { color: 'blonde' }, skinTone: 'porcelain' },
			age: 99,
			name: 'Impostor Name',
			heritage: 'white',
			market: 'us',
			work: { title: 'Astronaut' },
			meta: { seed: 'hijacked', schemaVersion: 99 }
		};
		const out = applyProseOnly(base, hostile);
		expect(out.creator).toEqual(base.creator);
		expect(out.look?.hair).toEqual(base.look?.hair);
		expect(out.look?.skinTone).toBe(base.look?.skinTone);
		expect(out.meta.seed).toBe(base.meta.seed);
		expect(out.meta.schemaVersion).toBe(2);
		expect(out.strategy?.contentAngle).toBe('legit angle');
	});

	it('keeps an off-list archetype verbatim, superseding the sampled token', () => {
		const base = skeleton();
		expect(base.strategy?.archetype).toBeTruthy(); // the floor the table set
		const out = applyProseOnly(base, { archetype: 'Mentor' });
		expect(out.strategy?.archetypeText).toBe('Mentor');
		// Two positions at once would let a downgrade pick either one.
		expect(out.strategy?.archetype).toBeUndefined();
		expect(out.meta.fieldSources?.['strategy.archetype']).toBeUndefined();
	});

	it('keeps an off-list content focus verbatim, superseding the sampled token', () => {
		const out = applyProseOnly(skeleton(), { contentFocus: 'Field notes from the lab' });
		expect(out.strategy?.contentFocusText).toBe('Field notes from the lab');
		expect(out.strategy?.contentFocus).toBeUndefined();
	});

	it('snaps a near-miss archetype onto the canonical option', () => {
		const out = applyProseOnly(skeleton(), { archetype: 'the educator' });
		expect(out.strategy?.archetype).toBe('educator');
		expect(out.strategy?.archetypeText).toBeUndefined();
	});

	it('survives junk, empty and missing answers without losing the skeleton', () => {
		const base = skeleton();
		for (const junk of [null, undefined, 42, 'nope', [], {}]) {
			const out = applyProseOnly(base, junk);
			expect(out.creator).toEqual(base.creator);
			expect(out.meta.schemaVersion).toBe(2);
		}
	});

	it('is pure — the skeleton passed in is not mutated', () => {
		const base = skeleton();
		const snapshot = JSON.stringify(base);
		applyProseOnly(base, { contentAngle: 'x', wardrobe: 'y' });
		expect(JSON.stringify(base)).toBe(snapshot);
	});

	/**
	 * Prose a model wrote is 'derived', never 'user'. Under the store's rule a
	 * 'user' leaf can never be overwritten by automation, so mislabelling here
	 * would freeze a model's guess against the customer's own re-generate while
	 * telling the UI a person chose it.
	 */
	it("marks model prose 'derived', leaving sampled provenance intact", () => {
		const out = applyProseOnly(skeleton(), { contentAngle: 'mine' });
		expect(out.meta.fieldSources?.['strategy.contentAngle']).toBe('derived');
		expect(out.meta.fieldSources?.['creator.age']).toBe('sampled');
	});
});

describe('proseOnlyPrompt', () => {
	it('states the fixed facts and asks only for prose', () => {
		const p = proseOnlyPrompt(skeleton(), BRIEF, ['a rival angle'], 'a no-nonsense steer');
		expect(p).toContain('THESE FACTS ARE FIXED');
		expect(p).toContain('Honeyx');
		expect(p).toContain('a no-nonsense steer');
		expect(p).toContain('a rival angle');
		expect(p).toContain('Return ONLY JSON');
		// It must not invite the model to produce the sampled fields.
		expect(p).not.toMatch(/"age"\s*:/);
		expect(p).not.toMatch(/"heritage"\s*:/);
	});

	it('names the creator once and forbids inventing another name', () => {
		const p = proseOnlyPrompt(skeletonFor({ seed: 'n', name: 'Jenny Tran' }), BRIEF);
		expect(p).toContain('Jenny Tran');
		expect(p).toContain('Never invent another');
	});

	it('is a pure function of its inputs', () => {
		const s = skeleton();
		expect(proseOnlyPrompt(s, BRIEF)).toBe(proseOnlyPrompt(s, BRIEF));
	});
});

describe('toV1Response — the wire shape the page already consumes', () => {
	it('returns v1 keys with option-list values, so no client change is needed', () => {
		const out = toV1Response(
			applyProseOnly(skeleton(), {
				archetype: 'The Expert / Authority',
				contentFocus: 'Education & How-Tos',
				targetAvatar: 'A 32-year-old',
				psychProfile: 'Wants proof.',
				contentAngle: 'label-first',
				wardrobe: 'linen'
			})
		);
		expect(Object.keys(out)).toEqual(
			expect.arrayContaining([
				'niche',
				'ageRanges',
				'gender',
				'archetype',
				'contentFocus',
				'targetAvatar',
				'psychProfile',
				'contentAngle',
				'appearance',
				'voiceProfile'
			])
		);
		expect(PERSONA_ARCHETYPES).toContain(out.archetype as string);
		expect(CONTENT_FOCUS_OPTIONS).toContain(out.contentFocus as string);
		expect(NICHE_OPTIONS).toContain(out.niche as string);
		expect(Array.isArray(out.ageRanges)).toBe(true);
		expect(typeof out.appearance).toBe('object');
	});

	it('carries the full v2 record alongside, for a caller that stores it', () => {
		const out = toV1Response(skeleton());
		expect((out._v2 as { meta?: { schemaVersion?: number } }).meta?.schemaVersion).toBe(2);
	});

	it('appearance is populated from the sampled look, so a portrait has something to use', () => {
		const appearance = toV1Response(skeleton()).appearance as Record<string, string>;
		expect(Object.keys(appearance).length).toBeGreaterThan(2);
		expect(appearance.ethnicity ?? '').not.toBe('');
	});
});
