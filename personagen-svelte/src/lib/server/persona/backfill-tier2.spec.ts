/**
 * TIER 2 — the guarantee is that a model can only ever tell us LESS than we hoped.
 *
 * This is the one place in the system where a language model's output becomes a
 * permanent fact about a customer's persona, marked `extracted` and therefore
 * never overwritable by automation again. So the tests here are adversarial by
 * default: they feed hallucinations, contradictions, wrong types, prose where a
 * token belongs, and ages that no creator has, and assert that the record comes
 * back either correct or unchanged.
 *
 * The prompt asks the model not to guess. This spec proves the code does not
 * depend on it obeying.
 */
import { describe, it, expect } from 'vitest';
import { getPath, type Obj } from '$lib/persona-contract/paths';
import { REGISTRY_VERSION } from '$lib/persona-contract/registry';
import { samplePersonaSkeleton } from '$lib/persona-contract/sampler';
import { PERSONA_SCHEMA_VERSION, type PersonaProfileV2 } from '$lib/persona-contract/schema';
import {
	applyReconciliation,
	backfillTier2,
	completeBySampling,
	constraintsFromProfile,
	hasReconcilableProse,
	reconciliationPrompt,
	reconciliationSource,
	tier2AlreadyDone
} from './backfill-tier2';

const NOW = '2026-01-01T00:00:00.000Z';

/** A persona of the kind Tier 2 exists for: prose, and almost no structure. */
const proseOnly = (): PersonaProfileV2 =>
	({
		meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
		strategy: {
			contentAngle: 'A Melbourne physio who trains before work and hates gym marketing.'
		},
		audience: { targetAvatar: 'Desk workers in their thirties with a sore back' }
	}) as PersonaProfileV2;

const at = (p: PersonaProfileV2, path: string) => getPath(p as unknown as Obj, path);
const sourceAt = (p: PersonaProfileV2, path: string) => p.meta.fieldSources?.[path];

describe('reconciliationSource — only the prose is sent', () => {
	it('collects the free text and nothing else', () => {
		const text = reconciliationSource(proseOnly());
		expect(text).toContain('Melbourne physio');
		expect(text).toContain('sore back');
	});

	/**
	 * A model shown the structured record starts "confirming" fields it can
	 * already see, which promotes a sampled guess to an extracted fact and makes
	 * it permanent. Only prose goes in the prompt.
	 */
	it('never includes structured facts the record already holds', () => {
		const profile = proseOnly();
		profile.creator = { age: 41, heritage: 'white', market: 'au', gender: 'male' };
		const text = reconciliationSource(profile);
		for (const leak of ['41', 'white', 'male']) expect(text).not.toContain(leak);
	});

	it('reports honestly when there is nothing to read, so no call is made', () => {
		expect(hasReconcilableProse({ meta: { schemaVersion: 2 } } as PersonaProfileV2)).toBe(false);
		expect(hasReconcilableProse(proseOnly())).toBe(true);
	});
});

describe('reconciliationPrompt — the instructions that matter', () => {
	it('tells the model that "unknown" is a correct answer', () => {
		expect(reconciliationPrompt(proseOnly())).toMatch(/unknown/i);
	});

	it('forbids inferring the creator from the audience', () => {
		const prompt = reconciliationPrompt(proseOnly());
		expect(prompt).toMatch(/never infer the creator from their audience/i);
	});

	it('carries the persona prose', () => {
		expect(reconciliationPrompt(proseOnly())).toContain('Melbourne physio');
	});
});

describe('applyReconciliation — the filter, not the request', () => {
	it('writes valid tokens and marks them extracted', () => {
		const { profile, extracted } = applyReconciliation(proseOnly(), {
			market: 'au',
			gender: 'male',
			city: 'Melbourne',
			occupationTitle: 'Physiotherapist',
			age: 34
		});
		expect(at(profile, 'creator.market')).toBe('au');
		expect(at(profile, 'creator.gender')).toBe('male');
		expect(at(profile, 'creator.location.city')).toBe('Melbourne');
		expect(at(profile, 'creator.work.title')).toBe('Physiotherapist');
		expect(at(profile, 'creator.age')).toBe(34);
		expect(sourceAt(profile, 'creator.market')).toBe('extracted');
		expect(extracted).toContain('creator.age');
	});

	/** An age somebody stated is exact; a bucket midpoint is not. */
	it('marks an extracted age as exact, so the portrait may state it', () => {
		const { profile } = applyReconciliation(proseOnly(), { age: 34 });
		expect(at(profile, 'creator.ageSource')).toBe('exact');
	});

	it('discards anything that is not a real token, whatever the model said', () => {
		const { profile, rejected } = applyReconciliation(proseOnly(), {
			heritage: 'elvish',
			market: 'atlantis',
			gender: 'yes',
			niche: 'vibes',
			education: 'the school of life'
		});
		expect(at(profile, 'creator.heritage')).toBeUndefined();
		expect(at(profile, 'creator.market')).toBeUndefined();
		expect(at(profile, 'creator.gender')).toBeUndefined();
		expect(rejected.length).toBe(5);
	});

	it('refuses an age no creator has', () => {
		for (const age of [4, 12, 17, 81, 130, -3]) {
			const { profile } = applyReconciliation(proseOnly(), { age });
			expect(at(profile, 'creator.age'), `age ${age}`).toBeUndefined();
		}
	});

	/**
	 * NEVER OVERWRITES. A fact the customer supplied, or one Tier 1 derived, is
	 * not up for revision by a model reading a paragraph.
	 */
	it('leaves an occupied leaf alone, whatever the model claims', () => {
		const profile = proseOnly();
		profile.creator = { age: 52, gender: 'female', market: 'uk' };
		profile.meta.fieldSources = { 'creator.age': 'user', 'creator.gender': 'user' };
		const { profile: out, extracted } = applyReconciliation(profile, {
			age: 24,
			gender: 'male',
			market: 'us'
		});
		expect(at(out, 'creator.age')).toBe(52);
		expect(at(out, 'creator.gender')).toBe('female');
		expect(at(out, 'creator.market')).toBe('uk');
		expect(extracted).toEqual([]);
	});

	it('rejects prose where a short value belongs', () => {
		const { profile, rejected } = applyReconciliation(proseOnly(), {
			city: 'Well, the text does not actually say which city they live in, but probably Melbourne',
			occupationTitle: 'unknown\n{"note": "not stated"}'
		});
		expect(at(profile, 'creator.location.city')).toBeUndefined();
		expect(at(profile, 'creator.work.title')).toBeUndefined();
		expect(rejected.length).toBe(2);
	});

	it('survives junk, empty and missing answers without losing the profile', () => {
		const base = proseOnly();
		for (const junk of [null, undefined, 42, 'nope', [], {}, { age: {} }]) {
			const { profile } = applyReconciliation(base, junk);
			expect(profile.strategy?.contentAngle).toBe(base.strategy?.contentAngle);
		}
	});

	it('does not mutate its input', () => {
		const base = proseOnly();
		const snapshot = JSON.stringify(base);
		applyReconciliation(base, { market: 'au', age: 30 });
		expect(JSON.stringify(base)).toBe(snapshot);
	});
});

describe('constraintsFromProfile — the known facts become absolute', () => {
	it('passes every fact the sampler can be constrained by', () => {
		const profile = proseOnly();
		profile.creator = {
			market: 'au',
			gender: 'female',
			heritage: 'east_asian',
			education: 'bachelor',
			age: 37,
			displayName: 'Mei Chen',
			economic: { incomeBand: 'upper_middle' }
		};
		profile.strategy = { ...profile.strategy, niche: 'fitness_health' };
		const c = constraintsFromProfile(profile);
		expect(c).toMatchObject({
			market: 'au',
			gender: 'female',
			heritage: 'east_asian',
			education: 'bachelor',
			incomeBand: 'upper_middle',
			niche: 'fitness_health',
			name: 'Mei Chen',
			ageRange: [37, 37]
		});
	});

	it('is empty for a profile that knows nothing', () => {
		expect(constraintsFromProfile({ meta: { schemaVersion: 2 } } as PersonaProfileV2)).toEqual({});
	});
});

describe('completeBySampling — fills the gaps and contradicts nothing', () => {
	/**
	 * THE CORE GUARANTEE. Step 2 may not disagree with step 1. Swept across many
	 * seeds because a single draw agreeing by luck proves nothing.
	 */
	it('never changes a fact that was already known, across 60 seeds', () => {
		const offenders: string[] = [];
		for (let i = 0; i < 60; i++) {
			const profile = proseOnly();
			profile.creator = { market: 'au', gender: 'male', age: 34, heritage: 'white' };
			profile.meta.fieldSources = {
				'creator.market': 'extracted',
				'creator.gender': 'extracted',
				'creator.age': 'extracted',
				'creator.heritage': 'extracted'
			};
			const { profile: out } = completeBySampling(profile, `seed-${i}`, { now: NOW });
			if (at(out, 'creator.market') !== 'au') offenders.push(`${i}: market`);
			if (at(out, 'creator.gender') !== 'male') offenders.push(`${i}: gender`);
			if (at(out, 'creator.age') !== 34) offenders.push(`${i}: age`);
			if (at(out, 'creator.heritage') !== 'white') offenders.push(`${i}: heritage`);
		}
		expect(offenders).toEqual([]);
	});

	it('fills the empty leaves and marks them sampled', () => {
		const { profile, sampled } = completeBySampling(proseOnly(), 'fill-me', { now: NOW });
		expect(sampled.length).toBeGreaterThan(10);
		expect(at(profile, 'creator.location.city')).toBeTruthy();
		expect(sourceAt(profile, 'creator.location.city')).toBe('sampled');
	});

	it('is deterministic for a seed', () => {
		const a = completeBySampling(proseOnly(), 'same', { now: NOW }).profile;
		const b = completeBySampling(proseOnly(), 'same', { now: NOW }).profile;
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	/** description is Tier 1's, derived from the result — not copied from the draw. */
	it('never copies the skeleton description over', () => {
		const { profile, sampled } = completeBySampling(proseOnly(), 'desc', { now: NOW });
		expect(sampled.some((p) => p.startsWith('description.'))).toBe(false);
		expect(profile.description).toBeUndefined();
	});

	it('does not mutate its input', () => {
		const base = proseOnly();
		const snapshot = JSON.stringify(base);
		completeBySampling(base, 'x', { now: NOW });
		expect(JSON.stringify(base)).toBe(snapshot);
	});
});

describe('backfillTier2 — reconcile, then complete', () => {
	it('extracts from the answer and fills the rest, in that order', () => {
		const { profile, extracted, sampled } = backfillTier2(proseOnly(), {
			answer: {
				market: 'au',
				city: 'Melbourne',
				occupationTitle: 'Physiotherapist',
				gender: 'male'
			},
			seed: 'agent-1',
			now: NOW
		});
		expect(extracted).toContain('creator.location.city');
		expect(at(profile, 'creator.location.city')).toBe('Melbourne');
		expect(sourceAt(profile, 'creator.location.city')).toBe('extracted');
		expect(sampled.length).toBeGreaterThan(5);
		expect(profile.meta.backfill).toEqual({ tier: 2, at: NOW });
		expect(profile.meta.registryVersion).toBe(REGISTRY_VERSION);
	});

	it('works with no model answer at all, degrading to a completion', () => {
		const { profile, extracted, sampled } = backfillTier2(proseOnly(), { seed: 'no-ai', now: NOW });
		expect(extracted).toEqual([]);
		expect(sampled.length).toBeGreaterThan(5);
		expect(profile.meta.backfill?.tier).toBe(2);
	});

	/** A second pass must not hand the same persona a different life. */
	it('is a no-op once the persona is complete on this registry version', () => {
		const once = backfillTier2(proseOnly(), { seed: 'idem', now: NOW }).profile;
		expect(tier2AlreadyDone(once)).toBe(true);
		const twice = backfillTier2(once, { seed: 'idem', now: NOW });
		expect(twice.skipped).toBe(true);
		expect(JSON.stringify(twice.profile)).toBe(JSON.stringify(once));
	});

	it('is deterministic without a supplied seed, so a re-run is the same person', () => {
		const a = backfillTier2(proseOnly(), { now: NOW }).profile;
		const b = backfillTier2(proseOnly(), { now: NOW }).profile;
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	/**
	 * A hostile answer, end to end: every field wrong, contradicting facts the
	 * customer set. The record must come back with the customer's facts intact.
	 */
	it('survives an answer that is wrong about everything', () => {
		const profile = proseOnly();
		profile.creator = { age: 52, gender: 'female', market: 'uk', heritage: 'south_asian' };
		profile.meta.fieldSources = {
			'creator.age': 'user',
			'creator.gender': 'user',
			'creator.market': 'user',
			'creator.heritage': 'user'
		};
		const { profile: out } = backfillTier2(profile, {
			answer: {
				age: 19,
				gender: 'male',
				market: 'us',
				heritage: 'elvish',
				city: 'a place the text never mentions at all, quite a long way away',
				niche: 'not a niche'
			},
			seed: 'hostile',
			now: NOW
		});
		expect(at(out, 'creator.age')).toBe(52);
		expect(at(out, 'creator.gender')).toBe('female');
		expect(at(out, 'creator.market')).toBe('uk');
		expect(at(out, 'creator.heritage')).toBe('south_asian');
	});

	it('leaves a fully sampled persona alone — it has nothing to add', () => {
		const complete = samplePersonaSkeleton('already-complete', {}, { now: NOW });
		const { sampled, extracted } = backfillTier2(complete, { now: NOW });
		expect(extracted).toEqual([]);
		expect(sampled).toEqual([]);
	});

	it('never throws on a malformed or nearly-empty profile', () => {
		for (const meta of [{ schemaVersion: 2 }, { schemaVersion: 2, fieldSources: {} }]) {
			expect(() => backfillTier2({ meta } as PersonaProfileV2, { now: NOW })).not.toThrow();
		}
	});
});
