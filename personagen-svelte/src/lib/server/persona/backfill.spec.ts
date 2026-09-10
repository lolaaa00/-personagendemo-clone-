/**
 * Persona Model v2 — Tier 1 backfill (P1.7).
 *
 * The rung this file owns on the verification ladder is "Tier-1 purity": over a
 * large batch of synthetic profiles, Tier 1 changes ZERO visible fields and adds
 * only leaves marked `derived`. The batch is generated, not hand-written — 150
 * fixtures typed by hand would all share one author's blind spot, which is the
 * opposite of what the rung is for.
 */
import { describe, expect, it } from 'vitest';
import { getPath, leafPaths, type Obj } from '$lib/persona-contract/paths';
import { samplePersonaSkeleton } from '$lib/persona-contract/sampler';
import {
	PERSONA_SCHEMA_VERSION,
	type FieldSource,
	type PersonaProfileV2
} from '$lib/persona-contract/schema';
import {
	ACTIVITY_LEVEL_TOKENS,
	ARCHETYPE_TOKENS,
	BODY_TYPE_TOKENS,
	CONTENT_FOCUS_TOKENS,
	EDUCATION_TOKENS,
	EYE_COLOR_TOKENS,
	GENDER_TOKENS,
	HAIR_COLOR_TOKENS,
	HAIR_LENGTH_TOKENS,
	HAIRSTYLE_TOKENS,
	HERITAGE_TOKENS,
	HOUSING_TYPE_TOKENS,
	INCOME_BAND_TOKENS,
	MARKET_TOKENS,
	NICHE_TOKENS,
	RELATIONSHIP_STATUS_TOKENS,
	SKIN_TONE_TOKENS,
	WORK_DOMAIN_TOKENS
} from '$lib/persona-contract/tokens';
import { readPersonaProfileV2, serializePersonaProfileV2 } from '$lib/persona-contract/store';
import { backfillTier1, TIER_1_DERIVED_LEAVES } from './backfill';

const NOW = '2026-09-08T00:00:00.000Z';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sourcesOf = (p: PersonaProfileV2): Record<string, FieldSource> => p.meta?.fieldSources ?? {};

/** Every leaf except the bookkeeping this pass is expected to write. */
const visibleLeaves = (p: unknown): string[] =>
	leafPaths(p as Obj).filter(
		(path) =>
			path !== 'meta.backfill' &&
			!path.startsWith('meta.backfill.') &&
			!path.startsWith('meta.fieldSources')
	);

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length];

/**
 * A batch of profiles built by walking every token list at a different stride,
 * so no two look alike, and by switching whole sub-objects on and off so the
 * "input absent → derived leaf absent" rule is exercised in every combination.
 */
function syntheticProfiles(count: number): PersonaProfileV2[] {
	const out: PersonaProfileV2[] = [];
	for (let i = 0; i < count; i++) {
		const creator: Obj = {
			gender: pick(GENDER_TOKENS, i),
			heritage: pick(HERITAGE_TOKENS, i * 3 + 1),
			market: pick(MARKET_TOKENS, i * 2),
			education: pick(EDUCATION_TOKENS, i * 5 + 2)
		};
		const sources: Record<string, FieldSource> = {
			'creator.gender': 'user',
			'creator.heritage': i % 2 ? 'user' : 'sampled',
			'creator.market': 'sampled',
			'creator.education': i % 3 ? 'sampled' : 'extracted'
		};

		if (i % 5 !== 0) {
			creator.displayName = `Persona ${i}`;
			sources['creator.displayName'] = 'user';
		} else if (i % 10 === 0) {
			creator.firstName = `First${i}`;
			creator.lastName = `Last${i}`;
			sources['creator.firstName'] = 'user';
			sources['creator.lastName'] = 'user';
		}
		if (i % 7 !== 0) {
			creator.age = 18 + (i % 62);
			sources['creator.age'] = 'sampled';
		}
		if (i % 3 !== 0) {
			creator.work = {
				title: pick(['Physiotherapist', 'AI Researcher', 'Customer Support Lead', 'Barista'], i),
				domain: pick(WORK_DOMAIN_TOKENS, i * 7 + 3)
			};
			sources['creator.work.title'] = 'sampled';
			sources['creator.work.domain'] = 'sampled';
		}
		if (i % 4 !== 0) {
			creator.location = { city: `City${i}`, region: `Region${i % 9}` };
			sources['creator.location.city'] = 'sampled';
			sources['creator.location.region'] = 'sampled';
		}
		if (i % 9 !== 0) {
			creator.household = {
				relationshipStatus: pick(RELATIONSHIP_STATUS_TOKENS, i * 2 + 1),
				housingType: pick(HOUSING_TYPE_TOKENS, i * 3)
			};
			if (i % 2 === 0)
				(creator.household as Obj).children = { count: 1 + (i % 3), ageBands: ['teen'] };
			sources['creator.household.relationshipStatus'] = 'sampled';
			sources['creator.household.housingType'] = 'sampled';
		}
		if (i % 8 !== 0) {
			creator.bigFive = {
				openness: (i * 7) % 101,
				conscientiousness: (i * 13 + 4) % 101,
				extraversion: (i * 29 + 11) % 101,
				agreeableness: (i * 37 + 23) % 101,
				neuroticism: (i * 41 + 47) % 101
			};
			for (const trait of Object.keys(creator.bigFive as Obj))
				sources[`creator.bigFive.${trait}`] = 'sampled';
		}
		if (i % 11 !== 0) {
			creator.economic = { incomeBand: pick(INCOME_BAND_TOKENS, i) };
			creator.lifestyle = { activityLevel: pick(ACTIVITY_LEVEL_TOKENS, i * 2) };
			sources['creator.economic.incomeBand'] = 'sampled';
			sources['creator.lifestyle.activityLevel'] = 'sampled';
		}

		const profile: PersonaProfileV2 = {
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION, fieldSources: sources },
			creator: creator as PersonaProfileV2['creator'],
			strategy: {
				niche: pick(NICHE_TOKENS, i * 5),
				archetype: pick(ARCHETYPE_TOKENS, i * 3 + 2),
				contentFocus: pick(CONTENT_FOCUS_TOKENS, i * 7)
			}
		};
		sources['strategy.niche'] = 'user';
		sources['strategy.archetype'] = 'user';
		sources['strategy.contentFocus'] = 'sampled';

		if (i % 6 !== 0) {
			profile.look = {
				skinTone: pick(SKIN_TONE_TOKENS, i * 3),
				bodyType: pick(BODY_TYPE_TOKENS, i * 5 + 1),
				hair: {
					color: pick(HAIR_COLOR_TOKENS, i * 2),
					length: pick(HAIR_LENGTH_TOKENS, i * 7 + 1),
					style: pick(HAIRSTYLE_TOKENS, i * 11)
				},
				eyes: { color: pick(EYE_COLOR_TOKENS, i * 13) }
			};
			for (const path of [
				'look.skinTone',
				'look.bodyType',
				'look.hair.color',
				'look.hair.length',
				'look.hair.style',
				'look.eyes.color'
			])
				sources[path] = i % 2 ? 'user' : 'sampled';
		}
		out.push(profile);
	}
	return out;
}

describe('backfillTier1 — purity over a synthetic batch', () => {
	const batch = syntheticProfiles(150);

	/**
	 * Collects every violation and asserts ONCE, rather than calling `expect`
	 * inside a loop that runs tens of thousands of times. Two reasons, both
	 * learned the hard way: per-leaf `expect` made this test take longer than
	 * vitest's five-second default, so it passed alone and failed under a loaded
	 * full-suite run — a test whose result depends on machine load is not a test.
	 * And a single assertion reports EVERY offending path at once instead of
	 * stopping at the first, which is what you actually want from a batch.
	 */
	it('changes zero visible fields and adds only `derived` leaves, across 150 varied profiles', () => {
		const changed: string[] = [];
		const misMarked: string[] = [];
		const unexpected: string[] = [];
		let added = 0;

		for (const [index, before] of batch.entries()) {
			const snapshot = clone(before);
			const after = backfillTier1(before, { now: NOW });

			for (const path of visibleLeaves(snapshot)) {
				const a = JSON.stringify(getPath(after as unknown as Obj, path) ?? null);
				const b = JSON.stringify(getPath(snapshot as unknown as Obj, path) ?? null);
				if (a !== b) changed.push(`#${index} ${path}: ${b} -> ${a}`);
			}

			const beforePaths = new Set(visibleLeaves(snapshot));
			const afterSources = sourcesOf(after);
			for (const path of visibleLeaves(after)) {
				if (beforePaths.has(path)) continue;
				added++;
				if (afterSources[path] !== 'derived') misMarked.push(`#${index} ${path}`);
				if (!(TIER_1_DERIVED_LEAVES as readonly string[]).includes(path))
					unexpected.push(`#${index} ${path}`);
			}
		}

		expect(changed).toEqual([]);
		expect(misMarked).toEqual([]);
		expect(unexpected).toEqual([]);
		expect(added).toBeGreaterThan(150); // the batch is not vacuously unchanged
	});

	it('never restamps provenance that already existed', () => {
		for (const [index, before] of batch.entries()) {
			const previous = clone(sourcesOf(before));
			const after = sourcesOf(backfillTier1(before, { now: NOW }));
			for (const [path, source] of Object.entries(previous)) {
				expect(after[path], `#${index} ${path}`).toBe(source);
			}
		}
		expect(batch.length).toBe(150);
	});

	it('is idempotent for the whole batch', () => {
		for (const [index, profile] of batch.entries()) {
			const once = backfillTier1(profile, { now: NOW });
			const twice = backfillTier1(once, { now: NOW });
			expect(twice, `#${index}`).toEqual(once);
		}
		expect(batch.length).toBe(150);
	});

	it('does not mutate its input', () => {
		for (const [index, profile] of batch.entries()) {
			const snapshot = JSON.stringify(profile);
			backfillTier1(profile, { now: NOW });
			expect(JSON.stringify(profile), `#${index}`).toBe(snapshot);
		}
		expect(batch.length).toBe(150);
	});
});

describe('backfillTier1 — provenance', () => {
	const base = (): PersonaProfileV2 => ({
		meta: { schemaVersion: PERSONA_SCHEMA_VERSION, fieldSources: {} },
		creator: {
			displayName: 'Lexy Hart',
			age: 34,
			location: { city: 'Brisbane', region: 'Queensland' }
		}
	});

	it('leaves a `user`-sourced description.short untouched and still derives its siblings', () => {
		const profile = base();
		profile.description = { short: 'Whatever Lexy wants it to say.' };
		profile.meta.fieldSources = { 'description.short': 'user' };

		const after = backfillTier1(profile, { now: NOW });
		expect(after.description?.short).toBe('Whatever Lexy wants it to say.');
		expect(sourcesOf(after)['description.short']).toBe('user');
		expect(after.description?.frame?.map((f) => f.key)).toEqual(['age', 'location']);
		expect(sourcesOf(after)['description.frame']).toBe('derived');
	});

	it('leaves an `extracted` leaf untouched', () => {
		const profile = base();
		profile.description = { short: 'From the soul.' };
		profile.meta.fieldSources = { 'description.short': 'extracted' };
		expect(backfillTier1(profile, { now: NOW }).description?.short).toBe('From the soul.');
	});

	it('leaves a `sampled` leaf untouched even when it is stale', () => {
		const profile = base();
		profile.description = { short: 'Stale sampled sentence.' };
		profile.meta.fieldSources = { 'description.short': 'sampled' };
		expect(backfillTier1(profile, { now: NOW }).description?.short).toBe('Stale sampled sentence.');
	});

	it('leaves a value with NO recorded provenance untouched', () => {
		const profile = base();
		profile.description = { short: 'Legacy sentence, provenance unknown.' };
		expect(backfillTier1(profile, { now: NOW }).description?.short).toBe(
			'Legacy sentence, provenance unknown.'
		);
	});

	it('recomputes a leaf it owns when the facts behind it moved', () => {
		const profile = base();
		profile.description = {
			short: 'Lexy Hart is 30 years old and lives in Perth, Western Australia.'
		};
		profile.meta.fieldSources = { 'description.short': 'derived' };

		const after = backfillTier1(profile, { now: NOW });
		expect(after.description?.short).toBe(
			'Lexy Hart is 34 years old and lives in Brisbane, Queensland.'
		);
		expect(sourcesOf(after)['description.short']).toBe('derived');
	});
});

describe('backfillTier1 — the derived leaves', () => {
	it('derives traitLabels from bigFive at the documented thresholds, in canonical order', () => {
		const after = backfillTier1({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
			creator: {
				bigFive: {
					openness: 65,
					conscientiousness: 35,
					extraversion: 64,
					agreeableness: 36,
					neuroticism: 100
				}
			}
		});
		expect(after.creator?.traitLabels).toEqual([
			'high_openness',
			'low_conscientiousness',
			'high_neuroticism'
		]);
		expect(sourcesOf(after)['creator.traitLabels']).toBe('derived');
	});

	it('writes no traitLabels when every trait sits mid-range (an empty array is a clear)', () => {
		const after = backfillTier1({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
			creator: {
				bigFive: {
					openness: 50,
					conscientiousness: 50,
					extraversion: 50,
					agreeableness: 50,
					neuroticism: 50
				}
			}
		});
		expect(after.creator?.traitLabels).toBeUndefined();
	});

	it('writes no traitLabels when bigFive is absent', () => {
		const after = backfillTier1({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
			creator: { age: 30 }
		});
		expect(after.creator?.traitLabels).toBeUndefined();
	});

	it('caches the look clause in look.promptCues, age included', () => {
		const after = backfillTier1({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
			creator: { age: 41 },
			look: { skinTone: 'olive', eyes: { color: 'green' } }
		});
		// TRIMMED. The live clause carries a leading space because it is appended
		// straight onto a prompt, but the store trims every string leaf, so caching
		// it verbatim gives a value that can never round-trip. See backfill.ts.
		expect(after.look?.promptCues).toBe('Appearance: 41 years old, Olive skin tone, Green eyes.');
		expect(sourcesOf(after)['look.promptCues']).toBe('derived');
	});

	it('does not conjure a look section out of an age alone', () => {
		const after = backfillTier1({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
			creator: { age: 41 }
		});
		expect(after.look).toBeUndefined();
	});

	it('degrades description.short to the facts present, never past them', () => {
		const short = (creator: PersonaProfileV2['creator']) =>
			backfillTier1({ meta: { schemaVersion: PERSONA_SCHEMA_VERSION }, creator }).description
				?.short;

		expect(
			short({
				displayName: 'Ada Reyes',
				age: 34,
				work: { title: 'Physiotherapist' },
				location: { city: 'Brisbane', region: 'Queensland' }
			})
		).toBe('Ada Reyes is a 34-year-old physiotherapist in Brisbane, Queensland.');
		expect(short({ displayName: 'Ada Reyes', age: 18, work: { title: 'AI Researcher' } })).toBe(
			'Ada Reyes is an 18-year-old AI researcher.'
		);
		expect(
			short({ displayName: 'Ada Reyes', work: { title: 'Editor' }, location: { city: 'Perth' } })
		).toBe('Ada Reyes is an editor in Perth.');
		expect(
			short({ firstName: 'Ada', lastName: 'Reyes', age: 34, location: { region: 'Queensland' } })
		).toBe('Ada Reyes is 34 years old and lives in Queensland.');
		expect(short({ displayName: 'Ada Reyes', age: 34 })).toBe('Ada Reyes is 34 years old.');
		expect(short({ displayName: 'Ada Reyes', location: { city: 'Perth', region: 'WA' } })).toBe(
			'Ada Reyes lives in Perth, WA.'
		);
		// A name with nothing to say about it, and facts with nobody to attach them to.
		expect(short({ displayName: 'Ada Reyes' })).toBeUndefined();
		expect(short({ age: 34, location: { city: 'Perth' } })).toBeUndefined();
	});

	it('builds the fact strip from the facts present, in canonical order', () => {
		const after = backfillTier1({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
			creator: {
				age: 34,
				location: { city: 'Brisbane', region: 'Queensland' },
				work: { title: 'Physiotherapist', domain: 'health_care' },
				household: {
					relationshipStatus: 'married',
					children: { count: 2, ageBands: ['primary'] },
					housingType: 'house_owned'
				}
			}
		});
		expect(after.description?.frame).toEqual([
			{ key: 'age', label: 'Age', value: '34' },
			{ key: 'location', label: 'Location', value: 'Brisbane, Queensland' },
			{ key: 'work', label: 'Work', value: 'Physiotherapist · Health care' },
			{ key: 'household', label: 'Household', value: 'Married · 2 children · Owned house' }
		]);
	});

	it('writes no description at all for a profile with no facts', () => {
		const after = backfillTier1({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
			creator: { gender: 'female' }
		});
		expect(after.description).toBeUndefined();
	});
});

describe('backfillTier1 — reproduces the sampler, so the two renderings cannot drift', () => {
	it('rebuilds description.short and description.frame byte-identically for 25 sampled skeletons', () => {
		for (let i = 0; i < 25; i++) {
			const sampled = samplePersonaSkeleton(`backfill-tier1-${i}`, {}, { now: NOW });
			const expected = clone(sampled.description);

			// Strip what the sampler derived, then let Tier 1 put it back.
			const stripped = clone(sampled);
			delete stripped.description;
			delete stripped.meta.fieldSources?.['description.short'];
			delete stripped.meta.fieldSources?.['description.frame'];

			const after = backfillTier1(stripped, { now: NOW });
			expect(after.description, `seed ${i}`).toEqual(expected);
			expect(sourcesOf(after)['description.short']).toBe('derived');
		}
	});
});

describe('backfillTier1 — bookkeeping and robustness', () => {
	it('stamps meta.backfill from the injectable clock', () => {
		const after = backfillTier1({ meta: { schemaVersion: PERSONA_SCHEMA_VERSION } }, { now: NOW });
		expect(after.meta.backfill).toEqual({ tier: 1, at: NOW });
	});

	it('never lowers a tier a later pass already reached', () => {
		const after = backfillTier1(
			{
				meta: {
					schemaVersion: PERSONA_SCHEMA_VERSION,
					backfill: { tier: 2, at: '2026-01-01T00:00:00.000Z' }
				}
			},
			{ now: NOW }
		);
		expect(after.meta.backfill).toEqual({ tier: 2, at: NOW });
	});

	it('returns an empty profile plus nothing but the stamp', () => {
		const after = backfillTier1({ meta: { schemaVersion: PERSONA_SCHEMA_VERSION } }, { now: NOW });
		expect(after).toEqual({
			meta: { schemaVersion: PERSONA_SCHEMA_VERSION, backfill: { tier: 1, at: NOW } }
		});
	});

	it('does not throw on malformed or wrong-shaped input', () => {
		const junk: unknown[] = [
			{},
			{ meta: 'not an object' },
			{ meta: { schemaVersion: 2 }, creator: 'not an object' },
			{
				meta: { schemaVersion: 2 },
				creator: { age: 'thirty', displayName: 42, location: 'Brisbane' }
			},
			{
				meta: { schemaVersion: 2 },
				creator: { displayName: 'A', age: 30 },
				description: 'a string, not an object'
			},
			{ meta: { schemaVersion: 2 }, look: [1, 2, 3], creator: { bigFive: 'nope' } },
			{ meta: { schemaVersion: 2, fieldSources: 'nope' }, creator: { displayName: 'B', age: 20 } }
		];
		for (const [index, value] of junk.entries()) {
			expect(
				() => backfillTier1(value as PersonaProfileV2, { now: NOW }),
				`#${index}`
			).not.toThrow();
		}
		// A non-object `meta` means provenance cannot be recorded, so nothing is written.
		const unstampable = backfillTier1({ meta: 'not an object' } as unknown as PersonaProfileV2, {
			now: NOW
		});
		expect(unstampable).toEqual({ meta: 'not an object' });
		// A stored non-object is never clobbered to make room for a derived leaf.
		const occupied = backfillTier1(
			{
				meta: { schemaVersion: PERSONA_SCHEMA_VERSION },
				creator: { displayName: 'A', age: 30 },
				description: 'a string'
			} as unknown as PersonaProfileV2,
			{ now: NOW }
		);
		expect(occupied.description).toBe('a string');
	});

	it('tolerates an unparseable clock rather than throwing', () => {
		const after = backfillTier1(
			{ meta: { schemaVersion: PERSONA_SCHEMA_VERSION } },
			{ now: 'not a date' }
		);
		expect(typeof after.meta.backfill?.at).toBe('string');
	});
});

describe('backfillTier1 — converges THROUGH THE STORE, not just in memory', () => {
	const batch = syntheticProfiles(150);
	/**
	 * The idempotency test above calls the function twice on its own output. That
	 * is not the loop production runs. Production is:
	 *
	 *   read → backfill → SERIALIZE → store → read again → backfill again
	 *
	 * and the serialize step is not the identity. It trims every string leaf, so a
	 * derived value carrying meaningful leading whitespace comes back different
	 * from what was written, is re-derived, differs again, and the backfill
	 * rewrites the same rows on every run forever. That is exactly what happened
	 * to `look.promptCues`, which the live clause builder returns with a leading
	 * space because it is appended straight onto a prompt.
	 *
	 * An in-memory idempotency test cannot see this. This one can.
	 */
	const roundTrip = (profile: PersonaProfileV2) =>
		readPersonaProfileV2({ personas_profile: serializePersonaProfileV2(profile, 'stored') });

	it('adds nothing on a second pass after a store round trip', () => {
		const offenders: string[] = [];
		for (const [index, profile] of batch.entries()) {
			const once = backfillTier1(profile, { now: NOW });
			const twice = backfillTier1(roundTrip(once), { now: NOW });
			for (const leaf of TIER_1_DERIVED_LEAVES) {
				const a = JSON.stringify(getPath(once as unknown as Obj, leaf) ?? null);
				const b = JSON.stringify(getPath(twice as unknown as Obj, leaf) ?? null);
				if (a !== b) offenders.push(`#${index} ${leaf}: ${a.slice(0, 60)} -> ${b.slice(0, 60)}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('stores no derived value that the store would trim', () => {
		const untrimmed: string[] = [];
		for (const [index, profile] of batch.entries()) {
			const once = backfillTier1(profile, { now: NOW });
			for (const leaf of TIER_1_DERIVED_LEAVES) {
				const value = getPath(once as unknown as Obj, leaf);
				if (typeof value === 'string' && value !== value.trim()) {
					untrimmed.push(`#${index} ${leaf}`);
				}
			}
		}
		expect(untrimmed).toEqual([]);
	});
});
