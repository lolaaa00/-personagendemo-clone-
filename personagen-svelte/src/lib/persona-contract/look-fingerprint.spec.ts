/**
 * The fingerprint decides whether a customer is told their portrait is stale.
 *
 * Both failure directions cost something, and they are not symmetric. Failing to
 * warn leaves a face that quietly stopped matching its persona. Warning wrongly
 * is worse: it pushes someone to spend money regenerating a portrait that was
 * already correct, and a notice that cries wolf gets ignored — after which the
 * true warning is invisible too.
 *
 * So the tests here are mostly about SILENCE: the fingerprint must not move for
 * anything that is not the face.
 */
import { describe, it, expect } from 'vitest';
import { hasDescribableLook, lookCanonicalForm, lookFingerprint } from './look-fingerprint';
import { samplePersonaSkeleton } from './sampler';
import { upgradeV1toV2 } from './upgrade';
import { readPersonaProfileV2 } from './store';

const NOW = '2026-01-01T00:00:00.000Z';
const sampled = (seed = 'fp-1') => samplePersonaSkeleton(seed, {}, { now: NOW });

/** Deep clone, so a test that edits its fixture cannot leak into the next. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('lookFingerprint — stable for the same face', () => {
	it('is identical for two reads of the same profile', () => {
		const profile = sampled();
		expect(lookFingerprint(profile)).toBe(lookFingerprint(copy(profile)));
	});

	it('does not depend on the order keys happen to sit in', () => {
		const profile = sampled();
		const shuffled = copy(profile);
		// Rebuild `look` with its keys in reverse insertion order — the same face,
		// a different object. A key walk would fingerprint these differently and
		// declare every portrait stale after any save that rebuilt the record.
		const look = shuffled.look as Record<string, unknown>;
		shuffled.look = Object.fromEntries(Object.entries(look).reverse()) as typeof shuffled.look;
		expect(lookFingerprint(shuffled)).toBe(lookFingerprint(profile));
	});

	it('is a short hex string, so it can sit in a JSON column', () => {
		expect(lookFingerprint(sampled())).toMatch(/^[0-9a-f]{8}$/);
	});

	it('never throws, whatever it is handed', () => {
		for (const junk of [null, undefined, 42, 'nope', [], {}, { look: 'not an object' }]) {
			expect(() => lookFingerprint(junk), JSON.stringify(junk)).not.toThrow();
		}
	});
});

describe('lookFingerprint — moves when the face moves', () => {
	const cases: [string, (p: ReturnType<typeof sampled>) => void][] = [
		['skin tone', (p) => ((p.look ??= {}).skinTone = 'deep')],
		['body type', (p) => ((p.look ??= {}).bodyType = 'athletic')],
		['height', (p) => ((p.look ??= {}).heightCm = 201)],
		['face shape', (p) => ((p.look ??= {}).faceShape = 'square')],
		['brow shape', (p) => ((p.look ??= {}).browShape = 'high_arch')],
		['facial hair', (p) => ((p.look ??= {}).facialHair = 'full_beard')],
		['eyewear', (p) => ((p.look ??= {}).eyewear = 'glasses')],
		['hair colour', (p) => (((p.look ??= {}).hair ??= {}).color = 'red')],
		['hair length', (p) => (((p.look ??= {}).hair ??= {}).length = 'long')],
		['hair texture', (p) => (((p.look ??= {}).hair ??= {}).texture = 'coarse')],
		['gray coverage', (p) => (((p.look ??= {}).hair ??= {}).grayCoverage = 'mostly_gray')],
		['eye colour', (p) => (((p.look ??= {}).eyes ??= {}).color = 'green')],
		['age', (p) => ((p.creator ??= {}).age = 71)],
		[
			'gender',
			(p) => {
				const c = (p.creator ??= {});
				c.gender = c.gender === 'male' ? 'female' : 'male';
			}
		],
		['heritage', (p) => ((p.creator ??= {}).heritage = 'south_asian')]
	];

	it.each(cases)('changes when %s changes', (_name, mutate) => {
		const before = sampled();
		const after = copy(before);
		mutate(after);
		// Guard the FIXTURE, not the code: if the sampled persona already held the
		// value being set, the mutation is a no-op and the test would be asserting
		// nothing. That is how this suite first "passed" on gender.
		expect(lookCanonicalForm(after), 'the fixture already had this value').not.toBe(
			lookCanonicalForm(before)
		);
		expect(lookFingerprint(after)).not.toBe(lookFingerprint(before));
	});
});

describe('lookFingerprint — silent for everything that is not the face', () => {
	/**
	 * The false-alarm guard. Each of these is a normal edit a customer makes all
	 * the time; any one of them moving the fingerprint would tell them to
	 * regenerate a portrait that is still perfectly correct.
	 */
	const quiet: [string, (p: ReturnType<typeof sampled>) => void][] = [
		['the content angle', (p) => ((p.strategy ??= {}).contentAngle = 'something entirely new')],
		['the niche', (p) => ((p.strategy ??= {}).niche = 'gaming_esports')],
		['the target viewer', (p) => ((p.audience ??= {}).targetAvatar = 'a different audience')],
		['the job', (p) => (((p.creator ??= {}).work ??= {}).title = 'Astronaut')],
		['the city', (p) => (((p.creator ??= {}).location ??= {}).city = 'Reykjavik')],
		['the household', (p) => (((p.creator ??= {}).household ??= {}).housingType = 'house_owned')],
		['the wardrobe', (p) => ((p.look ??= {}).wardrobe = 'a completely different outfit')],
		['the outfit colours', (p) => ((p.look ??= {}).outfitColors = 'neon everything')],
		['the styling notes', (p) => ((p.look ??= {}).styling = 'restyled from scratch')],
		['the description', (p) => ((p.description ??= {}).short = 'rewritten')],
		['meta.generatedAt', (p) => (p.meta.generatedAt = '2030-01-01T00:00:00.000Z')],
		['the cached prompt cues', (p) => ((p.look ??= {}).promptCues = 'a stale cached clause')]
	];

	it.each(quiet)('does not change when %s changes', (_name, mutate) => {
		const before = sampled();
		const after = copy(before);
		mutate(after);
		expect(lookFingerprint(after)).toBe(lookFingerprint(before));
	});
});

describe('lookFingerprint — v1 personas are covered too', () => {
	/**
	 * Almost every stored persona is still v1. If the fingerprint only read the
	 * v2 look, the warning would apply to nobody.
	 */
	const v1Agent = (appearance: Record<string, unknown>) => ({
		personas_profile: { gender: 'female', appearance }
	});

	it('reads a v1 appearance record', () => {
		const a = upgradeV1toV2(v1Agent({ hairColor: 'Auburn', eyeColor: 'Green' }).personas_profile);
		const b = upgradeV1toV2(v1Agent({ hairColor: 'Platinum', eyeColor: 'Green' }).personas_profile);
		expect(lookFingerprint(a)).not.toBe(lookFingerprint(b));
	});

	it('is stable for an unchanged v1 appearance', () => {
		const raw = v1Agent({
			hairColor: 'Auburn',
			eyeColor: 'Green',
			skinTone: 'Fair'
		}).personas_profile;
		expect(lookFingerprint(upgradeV1toV2(raw))).toBe(lookFingerprint(upgradeV1toV2(copy(raw))));
	});
});

describe('lookFingerprint — the two sides that must agree', () => {
	/**
	 * The server fingerprints from the raw agent row (avatar route); the page
	 * fingerprints from `data.agent`, which is that row SPREAD together with a
	 * dozen `agent_configs` fields. If those two ever disagreed, every portrait
	 * in the estate would read as stale at once — the loudest possible false
	 * alarm, and one nobody would think to look for.
	 */
	it('is unchanged by the config fields the page merges onto the row', () => {
		const profile = sampled();
		const bareRow = { personas_profile: profile };
		const pageShaped = {
			personas_profile: profile,
			timezone: 'Australia/Sydney',
			posts_per_day: 3,
			autonomy_level: 'advisor',
			ugc_voice: 'Adam',
			ugc_character_ref: 'https://cdn.example/portrait.png',
			ugc_reference_kit: { profile_generated_at: '2026-01-01T00:00:00.000Z' },
			brand_brief_id: null
		};
		expect(lookFingerprint(readPersonaProfileV2(pageShaped))).toBe(
			lookFingerprint(readPersonaProfileV2(bareRow))
		);
	});

	it('is unchanged by a reference kit that records a previous run', () => {
		const profile = sampled();
		const before = readPersonaProfileV2({ personas_profile: profile });
		const after = readPersonaProfileV2({
			personas_profile: profile,
			ugc_reference_kit: { profile_look_fingerprint: 'deadbeef', sheet_status: 'failed: nope' }
		});
		expect(lookFingerprint(after)).toBe(lookFingerprint(before));
	});
});

describe('hasDescribableLook — nothing to describe is not a match', () => {
	it('is false when no appearance is recorded anywhere', () => {
		expect(hasDescribableLook({ meta: { schemaVersion: 2 } })).toBe(false);
		expect(hasDescribableLook({})).toBe(false);
		expect(hasDescribableLook(null)).toBe(false);
	});

	it('is true for a sampled persona', () => {
		expect(hasDescribableLook(sampled())).toBe(true);
	});

	/**
	 * Two blank personas fingerprint identically — which is why callers check
	 * this first. Recording that constant would make every blank persona "match"
	 * every other one, and the warning would never fire for any of them.
	 */
	it('is what stops two blank personas matching each other', () => {
		const a = { meta: { schemaVersion: 2 } };
		const b = { meta: { schemaVersion: 2 }, strategy: { niche: 'tech_ai' } };
		expect(lookFingerprint(a)).toBe(lookFingerprint(b));
		expect(hasDescribableLook(a)).toBe(false);
	});
});

describe('lookCanonicalForm — readable enough to debug a mismatch', () => {
	it('names the field that moved, so a false alarm can be diagnosed', () => {
		const before = sampled();
		const after = copy(before);
		(after.look ??= {}).eyewear = 'glasses';
		const diff = lookCanonicalForm(after)
			.split('|')
			.filter((pair, i) => pair !== lookCanonicalForm(before).split('|')[i]);
		expect(diff).toEqual(['l.eyewear=glasses']);
	});
});
