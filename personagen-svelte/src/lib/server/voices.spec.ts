/**
 * VOICE PICKER — the age hint is a no-op until the catalog says otherwise.
 *
 * Persona Model v2 (P4.2) gave `pickVoiceForProfile` an optional age band. No
 * built-in voice carries an age tag, so the ONLY correct behaviour today is that
 * passing one changes nothing: every persona already generated keeps the voice
 * it was assigned, because the voice is re-derived from the profile whenever the
 * generator runs. That regression guard is the point of this file — the
 * preference logic itself is proved against an env-injected tagged catalog,
 * which is the only way a tag can exist right now.
 *
 * `voices.ts` reads `$env/dynamic/private` at module load (UGC_EXTRA_VOICES), so
 * the env object is mutable and the module is re-imported after a reset when a
 * test needs a different catalog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { pickVoiceForProfile, VOICE_CATALOG, DEFAULT_VOICE, isValidVoice } =
	await import('./voices');

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

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

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
