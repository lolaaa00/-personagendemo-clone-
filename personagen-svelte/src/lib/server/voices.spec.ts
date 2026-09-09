/**
 * Voice catalog invariants — the cheap half of the anti-drift gate.
 *
 * The expensive half is `voices-truth.test.ts`, which renders every catalog
 * voice against the live endpoint. That one costs money and credentials, so it
 * cannot run on every commit. Everything checkable WITHOUT the provider lives
 * here and runs always.
 *
 * What went wrong, and what these lock:
 *
 * On 2026-09-09 an audit of the live endpoint found 8 of 30 catalog voices
 * returned `feature_not_supported` ("Voice not found"). They had been offered in
 * the picker, pinned by personas, and silently degraded to the gender fallback
 * on every single post. Nothing in the codebase could have noticed, because
 * nothing compared the catalog to the provider.
 *
 * The subtle part, and the reason a cheap probe is not enough: the endpoint
 * ACCEPTS an unknown voice at submit and only fails at RENDER. A validation-only
 * check reports every voice healthy — this was tried, and it passed 30/30 for a
 * catalog with 8 dead entries.
 */
import { describe, it, expect } from 'vitest';
import { VOICE_CATALOG, RETIRED_VOICES, DEFAULT_VOICE, liveVoice, isValidVoice } from './voices';

/** The gender each retired voice had before it was removed from the catalog. */
const RETIRED_GENDER: Record<string, 'male' | 'female'> = {
	Antoni: 'male',
	Josh: 'male',
	James: 'male',
	Fin: 'male',
	Giovanni: 'male',
	Domi: 'female',
	Grace: 'female',
	Dorothy: 'female'
};

const genderOf = (name: string) => VOICE_CATALOG.find((v) => v.name === name)?.gender;

describe('retired voices resolve to something that actually exists', () => {
	it('every replacement is a live catalog voice', () => {
		// A retirement map pointing at another dead voice would move the failure
		// rather than fix it, and would do so invisibly.
		for (const [dead, live] of Object.entries(RETIRED_VOICES)) {
			expect(isValidVoice(live), `${dead} → ${live} is not in the catalog`).toBe(true);
		}
	});

	it('no retired voice is still offered in the picker', () => {
		// The point of retiring is that nobody can newly pick it. If an entry came
		// back, the map would silently shadow a working voice.
		for (const dead of Object.keys(RETIRED_VOICES)) {
			expect(isValidVoice(dead), `${dead} is retired but still listed`).toBe(false);
		}
	});

	it('keeps the persona the same gender it was', () => {
		// Gender drives the FACE as well as the voice. A cross-gender replacement
		// would silently re-roll a persona's whole look on its next post.
		for (const [dead, live] of Object.entries(RETIRED_VOICES)) {
			expect(genderOf(live), `${dead} → ${live} changed gender`).toBe(RETIRED_GENDER[dead]);
		}
	});
});

describe('liveVoice', () => {
	it('redirects a retired pick', () => {
		expect(liveVoice('Domi')).toBe(RETIRED_VOICES.Domi);
		expect(liveVoice('Josh')).toBe(RETIRED_VOICES.Josh);
	});

	it('passes a live pick through untouched', () => {
		expect(liveVoice('Rachel')).toBe('Rachel');
		expect(liveVoice('Adam')).toBe('Adam');
	});

	it('leaves an unknown name alone rather than guessing', () => {
		// Env-injected custom voices (UGC_EXTRA_VOICES) are real voice IDs this
		// module has never heard of. Rewriting them would break the one feature
		// that exists so a client can use a voice we do not ship.
		expect(liveVoice('VZyYADHcMi33m0wO9zD1')).toBe('VZyYADHcMi33m0wO9zD1');
		expect(liveVoice('not-a-voice')).toBe('not-a-voice');
	});

	it('treats empty as the default rather than as a voice named ""', () => {
		expect(liveVoice('')).toBe(DEFAULT_VOICE);
		expect(liveVoice(null)).toBe(DEFAULT_VOICE);
		expect(liveVoice(undefined)).toBe(DEFAULT_VOICE);
	});
});

describe('the voices the engine falls back to must themselves be real', () => {
	// generate.ts hardcodes these two as the "universally supported" degradation
	// target when a voice is rejected mid-run. If a fallback were ever retired,
	// the failure path would fail — the worst possible thing for a safety net,
	// and invisible until a post died.
	it('the gender fallbacks are live catalog voices', () => {
		expect(isValidVoice('Rachel')).toBe(true);
		expect(genderOf('Rachel')).toBe('female');
		expect(isValidVoice('Adam')).toBe(true);
		expect(genderOf('Adam')).toBe('male');
	});

	it('the column default is a live catalog voice', () => {
		expect(isValidVoice(DEFAULT_VOICE)).toBe(true);
	});

	it('there is at least one live voice of each gender to fall back to', () => {
		// resolveVoiceForPersona hashes into a gender-matched slice; an empty
		// slice would send every persona of that gender to the raw config value.
		expect(VOICE_CATALOG.some((v) => v.gender === 'male')).toBe(true);
		expect(VOICE_CATALOG.some((v) => v.gender === 'female')).toBe(true);
	});
});

describe('catalog hygiene', () => {
	it('has no duplicate voice names', () => {
		const names = VOICE_CATALOG.map((v) => v.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('every entry is addressable and labelled', () => {
		for (const v of VOICE_CATALOG) {
			expect(v.name.trim()).not.toBe('');
			expect(v.label.trim()).not.toBe('');
			expect(['male', 'female']).toContain(v.gender);
		}
	});
});
