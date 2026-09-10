/**
 * Persona Model v2 — store bridge, serialise gate, merge rule, provenance.
 */
import { describe, it, expect } from 'vitest';
import { readPersonaProfileV2, serializePersonaProfileV2, mergePersonaProfileV2 } from './store';
import { readPersonaProfile } from '../persona-profile-store';
import type { PersonaProfileV2 } from './schema';
import { upgradeV1toV2 } from './upgrade';

const V1_BLOB = {
	ageRanges: ['25–34'],
	gender: 'female',
	archetype: 'The Educator',
	appearance: { hairColor: 'honey blonde', eyeColor: 'Hazel' },
	displayName: 'Jenny Tran'
};

const V2_BLOB: PersonaProfileV2 = {
	meta: { schemaVersion: 2, generator: 'manual', fieldSources: { 'strategy.archetype': 'user' } },
	creator: { gender: 'female', displayName: 'Jenny Tran' },
	look: { hair: { colorText: 'honey blonde' }, eyes: { color: 'hazel', colorText: 'Hazel' } },
	audience: { ageRanges: ['25_34'] },
	strategy: { archetype: 'educator' }
};

describe('dual-shape bridge', () => {
	it('v2 reader upgrades a v1 blob in memory', () => {
		const out = readPersonaProfileV2({ personas_profile: V1_BLOB });
		expect(out.meta.schemaVersion).toBe(2);
		expect(out.strategy?.archetype).toBe('educator');
		expect(out.look?.hair?.colorText).toBe('honey blonde');
		expect(out.audience?.ageRanges).toEqual(['25_34']);
	});

	it('v2 reader returns a v2 blob as-is', () => {
		expect(readPersonaProfileV2({ personas_profile: V2_BLOB })).toBe(V2_BLOB);
	});

	it('v1 reader DOWNGRADES a v2 blob losslessly (legacy consumers keep working)', () => {
		const v1 = readPersonaProfile({ personas_profile: V2_BLOB });
		expect(v1).toEqual({
			ageRanges: ['25–34'],
			ageMin: 25,
			ageMax: 34,
			gender: 'female',
			archetype: 'The Educator',
			appearance: { hairColor: 'honey blonde', eyeColor: 'Hazel' },
			displayName: 'Jenny Tran'
		});
	});

	it('v1 reader returns a v1 blob exactly as stored (no normalisation round trip)', () => {
		const stored = { archetype: '  the educator ', appearance: { hairColor: 'honey blonde' }, junk: 1 };
		expect(readPersonaProfile({ personas_profile: stored })).toEqual(stored);
	});

	it('both readers honour the personas_profile-then-market precedence and never throw', () => {
		expect(readPersonaProfileV2({ market: JSON.stringify(V1_BLOB) }).strategy?.archetype).toBe('educator');
		expect(readPersonaProfileV2({ market: 'Australia' }).meta.schemaVersion).toBe(2);
		expect(readPersonaProfileV2(null).meta.schemaVersion).toBe(2);
	});
});

describe('serializePersonaProfileV2 — the normalising gate', () => {
	it('strips unknown top-level keys, stamps the version, trims strings', () => {
		const out = serializePersonaProfileV2({
			meta: { schemaVersion: 2 },
			creator: { displayName: '  Jenny  ' },
			bogus: { x: 1 }
		} as unknown as PersonaProfileV2);
		expect(out).toEqual({ meta: { schemaVersion: 2 }, creator: { displayName: 'Jenny' } });
	});

	it('moves an off-list value into its verbatim companion and drops off-list values without one', () => {
		const out = serializePersonaProfileV2({
			meta: { schemaVersion: 2 },
			strategy: { archetype: 'Mentor' },
			look: { hair: { color: 'honey blonde' }, eyewear: 'monocle' },
			creator: { gender: 'nonbinary' }
		} as unknown as PersonaProfileV2);
		expect(out.strategy).toEqual({ archetypeText: 'Mentor' });
		expect(out.look).toEqual({ hair: { colorText: 'honey blonde' } });
		expect(out.creator).toBeUndefined();
	});

	it('a token and its verbatim companion are one field: setting either clears the other on merge', () => {
		const stored: PersonaProfileV2 = {
			meta: { schemaVersion: 2 },
			strategy: { archetype: 'educator' },
			look: { hair: { colorText: 'honey blonde' } }
		};
		// Off-list archetype → text set, token cleared (patch mode).
		const a = mergePersonaProfileV2(stored, serializePersonaProfileV2({ meta: { schemaVersion: 2 }, strategy: { archetype: 'Mentor' } } as unknown as PersonaProfileV2, 'patch'));
		expect(a.strategy).toEqual({ archetypeText: 'Mentor' });
		// Valid token → token set, stale text cleared (patch mode).
		const b = mergePersonaProfileV2(stored, serializePersonaProfileV2({ meta: { schemaVersion: 2 }, look: { hair: { color: 'blonde' } } } as PersonaProfileV2, 'patch'));
		expect(b.look).toEqual({ hair: { color: 'blonde' } });
		// Stored mode never writes clear markers: an off-list value simply lands in the companion.
		const s = serializePersonaProfileV2({ meta: { schemaVersion: 2 }, strategy: { archetype: 'Mentor' } } as unknown as PersonaProfileV2);
		expect(s.strategy).toEqual({ archetypeText: 'Mentor' });
	});

	it('keeps valid tokens, de-duplicates and filters token arrays; clears survive only in patch mode', () => {
		const input = {
			meta: { schemaVersion: 2 },
			audience: { ageRanges: ['25_34', '25_34', 'nope', '35_44'] },
			strategy: { archetype: '' },
			creator: { neverDiscusses: ['politics', 'x'] }
		} as unknown as PersonaProfileV2;
		const patch = serializePersonaProfileV2(input, 'patch');
		expect(patch.audience?.ageRanges).toEqual(['25_34', '35_44']);
		expect(patch.strategy).toEqual({ archetype: '', archetypeText: '' }); // clear marker + its companion
		expect(patch.creator?.neverDiscusses).toEqual(['politics']);
		const stored = serializePersonaProfileV2(input);
		expect(stored.strategy).toBeUndefined(); // a record at rest carries no clear markers
		expect(stored.audience?.ageRanges).toEqual(['25_34', '35_44']);
	});

	it('clamps numbers and accepts numeric strings', () => {
		const out = serializePersonaProfileV2({
			meta: { schemaVersion: 2 },
			creator: {
				age: '134',
				bigFive: { openness: 120, conscientiousness: -5, extraversion: 'x', agreeableness: 50.6, neuroticism: 10 },
				household: { children: { count: 99, ageBands: ['toddler'] } }
			},
			look: { heightCm: 300 }
		} as unknown as PersonaProfileV2);
		expect(out.creator?.age).toBe(99);
		expect(out.creator?.bigFive).toEqual({ openness: 100, conscientiousness: 0, agreeableness: 51, neuroticism: 10 });
		expect(out.creator?.household?.children).toEqual({ count: 12, ageBands: ['toddler'] });
		expect(out.look?.heightCm).toBe(230);
	});

	it('accepts a v1 patch (upgrades first) and is idempotent on its own output', () => {
		const once = serializePersonaProfileV2(V1_BLOB);
		expect(once.strategy?.archetype).toBe('educator');
		expect(serializePersonaProfileV2(once)).toEqual(once);
	});
});

describe('mergePersonaProfileV2 — THE MERGE RULE', () => {
	const existing: PersonaProfileV2 = {
		meta: { schemaVersion: 2, fieldSources: { 'look.hair.color': 'user', 'creator.age': 'sampled', 'creator.work.title': 'extracted' } },
		creator: { age: 34, work: { title: 'Physiotherapist', domain: 'health_care' } },
		look: { hair: { color: 'black', style: 'straight' } },
		identityKit: { bios: { tiktok: 'hi' } }
	};

	it('absent and null/undefined preserve; one-level-deep nested records survive a sibling patch', () => {
		const out = mergePersonaProfileV2(existing, {
			meta: { schemaVersion: 2 },
			look: { hair: { color: 'blonde' } },
			identityKit: { bios: undefined as unknown as Record<string, string> }
		});
		expect(out.look).toEqual({ hair: { color: 'blonde', style: 'straight' } });
		expect(out.identityKit).toEqual({ bios: { tiktok: 'hi' } });
		expect(out.creator).toEqual(existing.creator);
		expect(out.meta.fieldSources?.['look.hair.color']).toBe('user');
	});

	it('explicit empty clears the leaf and its provenance', () => {
		const clear = { meta: { schemaVersion: 2 }, look: { hair: { color: '' } } } as unknown as PersonaProfileV2;
		const out = mergePersonaProfileV2(existing, clear);
		expect(out.look).toEqual({ hair: { style: 'straight' } });
		expect(out.meta.fieldSources?.['look.hair.color']).toBeUndefined();
	});

	it('UI patches stamp user; sampler stamps sampled; backfill stamps its declared source', () => {
		const ui = mergePersonaProfileV2(existing, { meta: { schemaVersion: 2 }, creator: { displayName: 'J' } });
		expect(ui.meta.fieldSources?.['creator.displayName']).toBe('user');
		const s = mergePersonaProfileV2(existing, { meta: { schemaVersion: 2 }, creator: { education: 'bachelor' } }, { origin: 'sampler' });
		expect(s.meta.fieldSources?.['creator.education']).toBe('sampled');
		const b = mergePersonaProfileV2(existing, { meta: { schemaVersion: 2 }, creator: { market: 'au' } }, { origin: 'backfill', source: 'extracted' });
		expect(b.meta.fieldSources?.['creator.market']).toBe('extracted');
	});

	it('automation can NEVER overwrite a user or extracted leaf, but may overwrite sampled/derived/unknown', () => {
		const out = mergePersonaProfileV2(
			existing,
			{ meta: { schemaVersion: 2 }, look: { hair: { color: 'blonde', style: 'wavy' } }, creator: { age: 40, work: { title: 'Nurse' } } },
			{ origin: 'sampler' }
		);
		expect(out.look?.hair?.color).toBe('black'); // user — protected
		expect(out.look?.hair?.style).toBe('wavy'); // unknown source — writable
		expect(out.creator?.age).toBe(40); // sampled — writable
		expect(out.creator?.work?.title).toBe('Physiotherapist'); // extracted — protected
		expect(out.meta.fieldSources?.['look.hair.style']).toBe('sampled');
	});

	it('an UNCHANGED value keeps its provenance (a full-form UI save must not re-stamp sampled leaves)', () => {
		// The page echoes creator.age = 34 (sampled) unchanged, and changes displayName.
		const out = mergePersonaProfileV2(existing, {
			meta: { schemaVersion: 2 },
			creator: { age: 34, displayName: 'Jenny' }
		});
		expect(out.meta.fieldSources?.['creator.age']).toBe('sampled'); // untouched
		expect(out.meta.fieldSources?.['creator.displayName']).toBe('user'); // changed → user
		// A leaf with no recorded provenance that is echoed unchanged gets one, so it is no longer "unknown".
		const seeded = mergePersonaProfileV2(existing, { meta: { schemaVersion: 2 }, look: { hair: { style: 'straight' } } });
		expect(seeded.meta.fieldSources?.['look.hair.style']).toBe('user');
	});

	it('a human can clear a whole section; automation cannot', () => {
		const human = mergePersonaProfileV2(existing, { meta: { schemaVersion: 2 }, look: {} });
		expect(human.look).toBeUndefined();
		expect(human.meta.fieldSources?.['look.hair.color']).toBeUndefined();
		const bot = mergePersonaProfileV2(existing, { meta: { schemaVersion: 2 }, look: {} }, { origin: 'sampler' });
		expect(bot.look).toEqual(existing.look);
	});

	it('is pure and never throws', () => {
		const snapshot = JSON.stringify(existing);
		mergePersonaProfileV2(existing, { meta: { schemaVersion: 2 }, creator: { age: 1 } });
		expect(JSON.stringify(existing)).toBe(snapshot);
		expect(mergePersonaProfileV2(null, null).meta.schemaVersion).toBe(2);
		expect(mergePersonaProfileV2(undefined, { meta: { schemaVersion: 2 } }).meta.schemaVersion).toBe(2);
	});

	it('survives serialise → merge without clobbering untouched fields (the v1 data-loss guard, on v2)', () => {
		const patch = serializePersonaProfileV2({ meta: { schemaVersion: 2 }, identityKit: { bios: { tiktok: 'new' } } } as PersonaProfileV2);
		const out = mergePersonaProfileV2(existing, patch);
		expect(out.creator).toEqual(existing.creator);
		expect(out.look).toEqual(existing.look);
		expect(out.identityKit).toEqual({ bios: { tiktok: 'new' } });
	});
});

/**
 * REGRESSION — a v1-shaped save must not delete v2-only fields.
 *
 * Found by a peer session's failure-point audit before either switch was
 * flipped. The persona page always sends `appearance` and `voiceProfile`;
 * coerceAppearance drops empties, so an untouched form collapses to `{}`; that
 * used to become an empty SECTION, and the merge reads an empty section from a
 * human as a deliberate whole-section clear. Everything v2-only under `look`
 * and `voice` — height, face shape, facial hair, eyewear, hair texture, gray
 * coverage, the pinned voice — was deleted on the first ordinary save, and the
 * v1 form could never send it back because downgradeV2toV1 does not emit it.
 *
 * The rule now: a shape may only clear what it can describe.
 */
describe('a v1-shaped patch can only clear what v1 can express', () => {
	const storedV2: PersonaProfileV2 = {
		meta: { schemaVersion: 2 },
		creator: { age: 34, gender: 'male' },
		look: {
			wardrobe: 'linen',
			heightCm: 178,
			faceShape: 'oval',
			browShape: 'thick',
			facialHair: 'short_beard',
			eyewear: 'glasses',
			hair: { color: 'black', texture: 'thick', grayCoverage: 'light' }
		},
		voice: { gender: 'male', accent: 'Australian', pinnedVoice: 'Bill', voiceMatch: 'exact' }
	};
	/** Exactly what the persona page posts on a save with an untouched appearance form. */
	const untouchedFormPatch = () =>
		serializePersonaProfileV2(upgradeV1toV2({ appearance: {}, voiceProfile: {} }, 'patch'), 'patch');

	it('keeps every v2-only look field the form cannot send', () => {
		const after = mergePersonaProfileV2(storedV2, untouchedFormPatch(), { origin: 'ui' });
		expect(after.look?.heightCm).toBe(178);
		expect(after.look?.faceShape).toBe('oval');
		expect(after.look?.browShape).toBe('thick');
		expect(after.look?.facialHair).toBe('short_beard');
		expect(after.look?.eyewear).toBe('glasses');
		expect(after.look?.hair?.texture).toBe('thick');
		expect(after.look?.hair?.grayCoverage).toBe('light');
	});

	it('keeps the pinned voice and its match quality', () => {
		const after = mergePersonaProfileV2(storedV2, untouchedFormPatch(), { origin: 'ui' });
		expect(after.voice?.pinnedVoice).toBe('Bill');
		expect(after.voice?.voiceMatch).toBe('exact');
	});

	it('still clears the fields v1 DOES own, so the v1 clear gesture keeps working', () => {
		const after = mergePersonaProfileV2(storedV2, untouchedFormPatch(), { origin: 'ui' });
		expect(after.look?.wardrobe).toBeUndefined();
		expect(after.look?.hair?.color).toBeUndefined();
		expect(after.voice?.accent).toBeUndefined();
		expect(after.voice?.gender).toBeUndefined();
	});

	it('never deletes the whole section', () => {
		const after = mergePersonaProfileV2(storedV2, untouchedFormPatch(), { origin: 'ui' });
		expect(after.look).toBeDefined();
		expect(after.voice).toBeDefined();
	});

	it('a STORED-mode upgrade still carries no clear markers at all', () => {
		expect(upgradeV1toV2({ appearance: {}, voiceProfile: {} })).toEqual({
			meta: { schemaVersion: 2, generator: 'manual', upgradedFrom: 1 }
		});
	});
});
