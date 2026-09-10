/**
 * Voice catalog invariants + the age-hint regression guard.
 *
 * Two anti-drift gates live here, and they are the cheap halves of their pairs.
 *
 * ── 1. The catalog must match the provider ──────────────────────────────────
 * The expensive half is `voices-truth.test.ts`, which renders every catalog
 * voice against the live endpoint. That one costs money and credentials, so it
 * cannot run on every commit. Everything checkable WITHOUT the provider lives
 * here and runs always.
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
 *
 * ── 2. The age hint is a no-op until the catalog says otherwise ─────────────
 * Persona Model v2 (P4.2) gave `pickVoiceForProfile` an optional age band. No
 * built-in voice carries an age tag, so the ONLY correct behaviour today is that
 * passing one changes nothing: every persona already generated keeps the voice
 * it was assigned, because the voice is re-derived from the profile whenever the
 * generator runs. The preference logic itself is proved against an env-injected
 * tagged catalog, which is the only way a tag can exist right now.
 *
 * `voices.ts` reads `$env/dynamic/private` at module load (UGC_EXTRA_VOICES), so
 * the env object is mutable and the module is re-imported after a reset when a
 * test needs a different catalog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { pickVoiceForProfile, VOICE_CATALOG, RETIRED_VOICES, DEFAULT_VOICE, liveVoice, isValidVoice } =
	await import('./voices');

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});


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


/** Every accent tag in the catalog, plus the aliases and the misses. */
const ACCENTS = [
	undefined,
	null,
	'',
	'American',
	'british',
	'English',
	'uk',
	'Australian',
	'aussie',
	'Irish',
	'Italian',
	'Indian',
	'South Asian',
	'american-southern',
	'Swedish',
	'Vietnamese',
	'Klingon'
] as const;

const SEEDS = [undefined, '', 'agent-1', 'agent-2', 'Chloe Miles-0', 'ffffffff-ffff-ffff'] as const;

const AGE_HINTS = ['18-24', '25-34', '35-44', '45+', 'mature', 'young adult', '25–34', ''] as const;


describe('pickVoiceForProfile — age hint is inert against an untagged catalog', () => {
	/**
	 * The load-bearing test. If it fails, adding the age band changed voices for
	 * personas that never asked for it.
	 */
	it('returns the identical voice and match with or without an age band', () => {
		let compared = 0;
		for (const gender of ['male', 'female'] as const) {
			for (const accent of ACCENTS) {
				for (const seed of SEEDS) {
					const before = pickVoiceForProfile(gender, accent, seed);
					for (const age of AGE_HINTS) {
						const after = pickVoiceForProfile(gender, accent, seed, age);
						const where = `${gender}/${accent}/${seed}/${age}`;
						expect(after.voice, where).toBe(before.voice);
						expect(after.exact, where).toBe(before.exact);
						compared++;
					}
				}
			}
		}
		expect(compared).toBeGreaterThan(500);
	});

	it('has no age-tagged voice in the shipped catalog — the reason the hint is inert', () => {
		expect(VOICE_CATALOG.filter((v) => v.ageBand)).toEqual([]);
		expect(VOICE_CATALOG.length).toBeGreaterThan(20);
	});

	it('treats null and undefined age bands the same as omitting the argument', () => {
		const base = pickVoiceForProfile('female', 'British', 'agent-9');
		expect(pickVoiceForProfile('female', 'British', 'agent-9', null).voice).toBe(base.voice);
		expect(pickVoiceForProfile('female', 'British', 'agent-9', undefined).voice).toBe(base.voice);
	});

	it('is deterministic — the same inputs return the same voice every call', () => {
		const a = pickVoiceForProfile('male', 'Indian', 'agent-7', '25-34');
		const b = pickVoiceForProfile('male', 'Indian', 'agent-7', '25-34');
		expect(a.voice.name).toBe(b.voice.name);
		expect(isValidVoice(a.voice.name)).toBe(true);
	});

	it('still resolves accents and fallbacks exactly as before', () => {
		expect(pickVoiceForProfile('female', 'English', 'x', '25-34').exact).toBe(true);
		expect(pickVoiceForProfile('female', 'English', 'x', '25-34').voice.accent).toBe('British');
		// An accent nobody has a voice for falls back to American, flagged inexact.
		const miss = pickVoiceForProfile('male', 'Klingon', 'x', 'mature');
		expect(miss.exact).toBe(false);
		expect(miss.voice.accent).toBe('American');
		expect(isValidVoice(DEFAULT_VOICE)).toBe(true);
	});
});

describe('pickVoiceForProfile — age hint prefers tagged voices when tags exist', () => {
	/** Re-imports the module with an env-injected, age-tagged catalog. */
	const withTaggedCatalog = async () => {
		mockEnv.UGC_EXTRA_VOICES = JSON.stringify([
			{
				name: 'young-au-f',
				label: 'Kylie',
				gender: 'female',
				accent: 'Australian',
				ageBand: '18-24'
			},
			{
				name: 'mature-au-f',
				label: 'Robyn',
				gender: 'female',
				accent: 'Australian',
				ageBand: '45+'
			},
			{ name: 'plain-au-f', label: 'Sam', gender: 'female', accent: 'Australian' }
		]);
		vi.resetModules();
		return await import('./voices');
	};

	it('narrows an accent match to the voices tagged for the band', async () => {
		const voices = await withTaggedCatalog();
		expect(voices.pickVoiceForProfile('female', 'Australian', 'seed-a', '18-24').voice.name).toBe(
			'young-au-f'
		);
		expect(voices.pickVoiceForProfile('female', 'Australian', 'seed-a', '45+').voice.name).toBe(
			'mature-au-f'
		);
	});

	it('ignores case and an en dash in the band, and keeps the accent exact', async () => {
		const voices = await withTaggedCatalog();
		const picked = voices.pickVoiceForProfile('female', 'aussie', 'seed-b', ' 18‑24 ');
		expect(picked.voice.name).toBe('young-au-f');
		expect(picked.exact).toBe(true);
	});

	it('falls back to the whole accent match when no voice carries that band', async () => {
		const voices = await withTaggedCatalog();
		const hinted = voices.pickVoiceForProfile('female', 'Australian', 'seed-c', '25-34');
		const plain = voices.pickVoiceForProfile('female', 'Australian', 'seed-c');
		expect(hinted.voice.name).toBe(plain.voice.name);
	});

	it('never lets the age hint override an exact accent match', async () => {
		const voices = await withTaggedCatalog();
		// British has no tagged voice; the pick stays British rather than jumping
		// to the tagged Australian one.
		const picked = voices.pickVoiceForProfile('female', 'British', 'seed-d', '18-24');
		expect(picked.voice.accent).toBe('British');
		expect(picked.exact).toBe(true);
	});
});
