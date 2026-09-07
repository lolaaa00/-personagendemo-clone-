/**
 * Persona Profile store — pure-logic tests. These guard the two failure modes
 * the module was written to kill:
 *
 *   1. The `agents.market` column is a TEXT column whose ORIGINAL meaning was a
 *      country string ('Australia'), later reused to hold profile JSON. Reading
 *      it has to tell those apart without throwing, and `personas_profile` (the
 *      real JSONB column) has to win during the dual-write window.
 *   2. SILENT DATA LOSS on save — a patch that forgets a field must never wipe
 *      it. `mergePersonaProfile` is the regression guard and the most important
 *      thing in this file.
 */
import { describe, it, expect } from 'vitest';
import {
	AGE_RANGE_BOUNDS,
	ageBoundsFromRanges,
	deriveAgeRanges,
	mergePersonaProfile,
	profileToMarketString,
	readPersonaProfile,
	serializePersonaProfile,
	coerceVoiceProfile,
	type PersonaProfile
} from './persona-profile-store';

describe('readPersonaProfile — personas_profile column', () => {
	it('reads an already-decoded JSONB object', () => {
		// Supabase hands JSONB back decoded, so this is the normal path.
		const agent = { personas_profile: { archetype: 'The Creator', displayName: 'Jenny' } };
		expect(readPersonaProfile(agent)).toEqual({
			archetype: 'The Creator',
			displayName: 'Jenny'
		});
	});

	it('reads a JSON string (round-tripped through a TEXT path)', () => {
		const agent = { personas_profile: '{"archetype":"The Educator","ageMin":25}' };
		expect(readPersonaProfile(agent)).toEqual({ archetype: 'The Educator', ageMin: 25 });
	});

	it('tolerates surrounding whitespace on the string form', () => {
		expect(readPersonaProfile({ personas_profile: '  \n {"gender":"female"} \t ' })).toEqual({
			gender: 'female'
		});
	});

	it('does not coerce values — reading is lossless', () => {
		// Unknown keys and off-list values survive a read so a read/merge/write
		// round trip can't destroy a field written by a newer client.
		const agent = { personas_profile: { archetype: 'Not An Archetype', futureKey: [1, 2] } };
		expect(readPersonaProfile(agent)).toEqual({ archetype: 'Not An Archetype', futureKey: [1, 2] });
	});
});

describe('readPersonaProfile — market fallback', () => {
	it('falls back to parsing market when personas_profile is absent', () => {
		const agent = { market: '{"contentFocus":"Product Reviews & UGC"}' };
		expect(readPersonaProfile(agent)).toEqual({ contentFocus: 'Product Reviews & UGC' });
	});

	it('falls back when personas_profile is explicitly null (un-backfilled row)', () => {
		const agent = { personas_profile: null, market: '{"displayName":"Jenny Tran"}' };
		expect(readPersonaProfile(agent)).toEqual({ displayName: 'Jenny Tran' });
	});

	it('personas_profile WINS when both are present', () => {
		// The dual-write window writes personas_profile first, so a partially
		// migrated row must read the JSONB column, never the stale market copy.
		const agent = {
			personas_profile: { archetype: 'The Expert / Authority' },
			market: '{"archetype":"The Storyteller","psychProfile":"stale"}'
		};
		expect(readPersonaProfile(agent)).toEqual({ archetype: 'The Expert / Authority' });
	});

	it('personas_profile wins even when it is an EMPTY object', () => {
		// "Holds an object" is the precedence rule — an empty migrated profile is
		// still authoritative, otherwise a cleared profile would resurrect itself.
		const agent = { personas_profile: {}, market: '{"archetype":"The Disruptor"}' };
		expect(readPersonaProfile(agent)).toEqual({});
	});
});

describe('readPersonaProfile — junk and legacy input never throws', () => {
	it("returns {} for the legacy country string market: 'Australia'", () => {
		// The column's ORIGINAL meaning. Must be neither a crash nor garbage.
		expect(readPersonaProfile({ market: 'Australia' })).toEqual({});
		expect(readPersonaProfile({ market: 'United Kingdom' })).toEqual({});
		expect(readPersonaProfile({ personas_profile: null, market: 'Australia' })).toEqual({});
	});

	it('returns {} for malformed / truncated JSON without throwing', () => {
		const truncated = '{"archetype":"The Creator","appearance":{"hairColor":"honey blo';
		expect(() => readPersonaProfile({ market: truncated })).not.toThrow();
		expect(readPersonaProfile({ market: truncated })).toEqual({});
		expect(readPersonaProfile({ personas_profile: '{not json at all}' })).toEqual({});
		expect(readPersonaProfile({ market: '{' })).toEqual({});
	});

	it('returns {} for JSON that parses to a non-object', () => {
		// Only a value that opens with `{` is parsed at all, so arrays/scalars
		// never reach the caller as a "profile".
		expect(readPersonaProfile({ personas_profile: [1, 2, 3] })).toEqual({});
		expect(readPersonaProfile({ market: '[{"archetype":"The Creator"}]' })).toEqual({});
		expect(readPersonaProfile({ personas_profile: 42 })).toEqual({});
		expect(readPersonaProfile({ market: 'null' })).toEqual({});
	});

	it('returns {} for null / undefined / empty agents', () => {
		expect(readPersonaProfile(null)).toEqual({});
		expect(readPersonaProfile(undefined)).toEqual({});
		expect(readPersonaProfile({})).toEqual({});
		expect(readPersonaProfile({ personas_profile: undefined, market: undefined })).toEqual({});
	});
});

describe('mergePersonaProfile', () => {
	// A fully-populated stored profile: every one of these fields is a field a
	// narrow caller (e.g. "save bios only") must not be able to destroy.
	const existing = (): PersonaProfile => ({
		ageRanges: ['25–34'],
		ageMin: 25,
		ageMax: 34,
		gender: 'female',
		archetype: 'The Creator',
		contentFocus: 'Product Reviews & UGC',
		psychProfile: 'Values honest, unfiltered skincare talk.',
		contentAngle: 'Honey-first routines',
		targetAvatar: 'A 28-year-old with sensitive skin',
		appearance: { hairColor: 'honey blonde', ethnicity: 'Vietnamese' },
		voiceProfile: {
			gender: 'female',
			nationality: 'Vietnamese-Australian',
			accent: 'soft Australian'
		},
		bios: { tiktok: 'Honey-first skincare 🍯' },
		handleCandidates: [{ handle: 'jennytran', status: 'confirmed' }],
		confirmedHandles: { tiktok: 'jennytran' },
		displayName: 'Jenny Tran'
	});

	it('PRESERVES every key omitted from the patch (the data-loss regression guard)', () => {
		// THE test. The old save path stringified a hand-written literal, so any
		// field the literal forgot was silently wiped. A caller that only edits
		// bios must leave appearance, voice, handles and everything else intact.
		const before = existing();
		const out = mergePersonaProfile(before, { bios: { instagram: 'new bio' } });

		expect(out).toEqual({ ...before, bios: { instagram: 'new bio' } });
		// Spelled out for the fields that have actually been lost in production:
		expect(out.appearance).toEqual({ hairColor: 'honey blonde', ethnicity: 'Vietnamese' });
		expect(out.voiceProfile).toEqual(before.voiceProfile);
		expect(out.handleCandidates).toEqual(before.handleCandidates);
		expect(out.confirmedHandles).toEqual({ tiktok: 'jennytran' });
		expect(out.displayName).toBe('Jenny Tran');
	});

	it('treats an explicit undefined/null in the patch exactly like an omitted key', () => {
		// A partially-populated object literal looks like this. If undefined
		// cleared, the original bug would walk back in through another door.
		const before = existing();
		const out = mergePersonaProfile(before, {
			archetype: undefined,
			appearance: undefined,
			bios: null as never,
			displayName: 'Jenny T.'
		});
		expect(out.archetype).toBe('The Creator');
		expect(out.appearance).toEqual(before.appearance);
		expect(out.bios).toEqual(before.bios);
		expect(out.displayName).toBe('Jenny T.');
	});

	it('an explicitly EMPTY value DOES clear the field', () => {
		// '' / [] / {} are what the UI sends when the user clears a field, so they
		// are unambiguous intent — the one thing that must not be preserved.
		const out = mergePersonaProfile(existing(), {
			psychProfile: '',
			contentAngle: '',
			displayName: '',
			appearance: {},
			bios: {},
			handleCandidates: [],
			gender: ''
		});
		expect(out.psychProfile).toBe('');
		expect(out.contentAngle).toBe('');
		expect(out.displayName).toBe('');
		expect(out.appearance).toEqual({});
		expect(out.bios).toEqual({});
		expect(out.handleCandidates).toEqual([]);
		expect(out.gender).toBe('');
		// …and clearing those left everything else alone.
		expect(out.archetype).toBe('The Creator');
	});

	it('re-derives ageMin/ageMax whenever the patch restates ageRanges', () => {
		const out = mergePersonaProfile(existing(), { ageRanges: ['35–44', '45–54'] });
		expect(out).toMatchObject({ ageRanges: ['35–44', '45–54'], ageMin: 35, ageMax: 54 });

		// Clearing the buckets nulls the bounds rather than leaving stale numbers.
		const cleared = mergePersonaProfile(existing(), { ageRanges: [] });
		expect(cleared).toMatchObject({ ageRanges: [], ageMin: null, ageMax: null });
	});

	it('ignores unknown keys in the patch but carries unknown keys on existing through', () => {
		// Forward compatibility: an older client must not destroy a field a newer
		// one wrote, and must not let junk into the blob either.
		const before = { archetype: 'The Creator', futureKey: 'keep me' } as PersonaProfile;
		const out = mergePersonaProfile(before, { junk: 'drop me', displayName: 'Jenny' } as never);
		expect(out).toEqual({ archetype: 'The Creator', futureKey: 'keep me', displayName: 'Jenny' });
	});

	it('does not mutate the existing profile', () => {
		const before = existing();
		mergePersonaProfile(before, { displayName: 'Someone Else', appearance: {} });
		expect(before.displayName).toBe('Jenny Tran');
		expect(before.appearance).toEqual({ hairColor: 'honey blonde', ethnicity: 'Vietnamese' });
	});

	it('handles null/undefined existing and patch', () => {
		expect(mergePersonaProfile(null, null)).toEqual({});
		expect(mergePersonaProfile(undefined, { displayName: 'Jenny' })).toEqual({
			displayName: 'Jenny'
		});
		expect(mergePersonaProfile({ archetype: 'The Creator' }, undefined)).toEqual({
			archetype: 'The Creator'
		});
	});
});

describe('serializePersonaProfile', () => {
	it('strips unknown keys and coerces the known ones', () => {
		const out = serializePersonaProfile({
			archetype: 'the creator', // case-insensitive match onto the option set
			contentFocus: 'Education', // loose contains-match
			gender: 'nonbinary', // not a supported persona gender → ''
			psychProfile: '  Loves honest reviews.  ',
			targetAvatar: 'Mia, a 29-year-old with sensitive skin',
			appearance: { hairColor: '  honey blonde  ', bogusTrait: 'x' },
			voiceProfile: { gender: 'female', junk: 'x' },
			bios: { tiktok: 'hi', myspace: 'nope' },
			confirmedHandles: { tiktok: '@Jenny_Tran' },
			displayName: ' Jenny Tran ',
			legacyKey: 'must be stripped',
			id: 'agent-1'
		} as never);

		expect(out).toEqual({
			archetype: 'The Creator',
			contentFocus: 'Education & How-Tos',
			gender: '',
			psychProfile: 'Loves honest reviews.',
			// Leading fictional proper name stripped, so the old prompt bug
			// self-heals on the next save.
			targetAvatar: 'A 29-year-old with sensitive skin',
			appearance: { hairColor: 'honey blonde' },
			voiceProfile: { gender: 'female' },
			bios: { tiktok: 'hi' },
			confirmedHandles: { tiktok: 'jenny_tran' },
			displayName: 'Jenny Tran'
		});
		expect(Object.keys(out)).not.toContain('legacyKey');
	});

	it('keeps an off-list strategy value VERBATIM (stored values are sacred); non-strings become ""', () => {
		// A legacy or wizard-typed archetype ("Mentor") must survive an ordinary
		// save — blanking it here was silent data loss. The UI renders it as an
		// extra select option; LLM output is snapped at the generator instead.
		const out = serializePersonaProfile({
			archetype: '  Mentor  ',
			contentFocus: 42
		} as never);
		expect(out).toEqual({ archetype: 'Mentor', contentFocus: '' });
	});

	it('still snaps a matching strategy value onto its canonical option', () => {
		const out = serializePersonaProfile({ archetype: 'educator', contentFocus: 'tutorials' });
		expect(out).toEqual({ archetype: 'The Educator', contentFocus: 'Tutorials & Demos' });
	});

	it('preserves key PRESENCE exactly — an absent key stays absent', () => {
		// This is what makes serialize-then-merge safe: serialising a partial
		// profile must not assert emptiness for fields it never mentioned.
		expect(serializePersonaProfile({})).toEqual({});
		expect(serializePersonaProfile(null)).toEqual({});
		expect(serializePersonaProfile(undefined)).toEqual({});
		expect(Object.keys(serializePersonaProfile({ displayName: 'Jenny' }))).toEqual(['displayName']);
	});

	it('re-derives ageMin/ageMax from ageRanges and drops unknown buckets', () => {
		const out = serializePersonaProfile({
			ageRanges: ['25–34', '45–54', 'bogus'],
			ageMin: 999, // incoming numbers are never trusted when buckets are given
			ageMax: -1
		} as never);
		expect(out).toEqual({ ageRanges: ['25–34', '45–54'], ageMin: 25, ageMax: 54 });
	});

	it('keeps standalone ageMin/ageMax when no buckets are supplied', () => {
		expect(serializePersonaProfile({ ageMin: 25, ageMax: 34 })).toEqual({ ageMin: 25, ageMax: 34 });
		expect(serializePersonaProfile({ ageMin: 'x' } as never)).toEqual({ ageMin: null });
	});

	it('survives serialize → merge without clobbering untouched fields', () => {
		const stored = { appearance: { hairColor: 'honey blonde' }, displayName: 'Jenny Tran' };
		const patch = serializePersonaProfile({ bios: { tiktok: 'Honey-first skincare' } });
		expect(mergePersonaProfile(stored, patch)).toEqual({
			appearance: { hairColor: 'honey blonde' },
			displayName: 'Jenny Tran',
			bios: { tiktok: 'Honey-first skincare' }
		});
	});
});

describe('profileToMarketString', () => {
	it('round-trips through readPersonaProfile', () => {
		const profile: PersonaProfile = {
			ageRanges: ['25–34'],
			ageMin: 25,
			ageMax: 34,
			gender: 'female',
			archetype: 'The Creator',
			appearance: { hairColor: 'honey blonde', ethnicity: 'Vietnamese' },
			voiceProfile: { gender: 'female', accent: 'soft Australian' },
			handleCandidates: [{ handle: 'jennytran', status: 'untried' }],
			displayName: 'Jenny Tran'
		};
		const stored = profileToMarketString(profile);
		expect(typeof stored).toBe('string');
		expect(readPersonaProfile({ market: stored })).toEqual(profile);
		expect(readPersonaProfile({ personas_profile: stored })).toEqual(profile);
	});

	it("writes '{}' for an empty/null profile, which reads back as {}", () => {
		expect(profileToMarketString(null)).toBe('{}');
		expect(profileToMarketString(undefined)).toBe('{}');
		expect(readPersonaProfile({ market: profileToMarketString({}) })).toEqual({});
	});

	it("returns '{}' instead of throwing on a cyclic object", () => {
		const cyclic: Record<string, unknown> = { displayName: 'Jenny' };
		cyclic.self = cyclic;
		expect(profileToMarketString(cyclic as unknown as PersonaProfile)).toBe('{}');
	});
});

describe('age bucket helpers', () => {
	it('ageBoundsFromRanges spans the selected buckets and nulls when empty', () => {
		expect(ageBoundsFromRanges(['18–24', '45–54'])).toEqual({ ageMin: 18, ageMax: 54 });
		expect(ageBoundsFromRanges(['55+'])).toEqual({ ageMin: 55, ageMax: 99 });
		expect(ageBoundsFromRanges([])).toEqual({ ageMin: null, ageMax: null });
		expect(ageBoundsFromRanges(['nope'])).toEqual({ ageMin: null, ageMax: null });
		expect(ageBoundsFromRanges(null)).toEqual({ ageMin: null, ageMax: null });
	});

	it('deriveAgeRanges recovers buckets from legacy ageMin/ageMax only', () => {
		// Legacy profiles stored numbers with no buckets; the chip row must not
		// render blank for them.
		expect(deriveAgeRanges({ ageMin: 25, ageMax: 44 })).toEqual(['25–34', '35–44']);
		// Stored buckets always win over the derived ones.
		expect(deriveAgeRanges({ ageRanges: ['55+'], ageMin: 18, ageMax: 24 })).toEqual(['55+']);
		expect(deriveAgeRanges({})).toEqual([]);
		expect(deriveAgeRanges(null)).toEqual([]);
	});

	it('AGE_RANGE_BOUNDS uses the en-dash keys the UI chips are keyed by', () => {
		expect(AGE_RANGE_BOUNDS['25–34']).toEqual({ lo: 25, hi: 34 });
		// A hyphen-minus key is a different string and must NOT resolve.
		expect(AGE_RANGE_BOUNDS['25-34']).toBeUndefined();
	});
});

describe('coerceVoiceProfile', () => {
	it('keeps only the three known keys as trimmed non-empty strings', () => {
		expect(
			coerceVoiceProfile({
				gender: ' female ',
				nationality: '',
				accent: 'soft Australian',
				junk: 'x'
			})
		).toEqual({ gender: 'female', accent: 'soft Australian' });
	});

	it('returns {} for junk', () => {
		expect(coerceVoiceProfile(null)).toEqual({});
		expect(coerceVoiceProfile('female')).toEqual({});
	});
});
