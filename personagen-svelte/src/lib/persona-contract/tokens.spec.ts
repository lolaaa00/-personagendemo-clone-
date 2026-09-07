/**
 * Persona Model v2 — contract invariants.
 *
 * These are the rules that make "tokens in storage, labels at render" safe to
 * rely on for the life of the model. A failure here is a contract break, not a
 * flaky test: fix the token or the label, never the assertion.
 */
import { describe, it, expect } from 'vitest';
import {
	TOKEN_GROUPS,
	TOKEN_RE,
	isToken,
	LABELS,
	label,
	tokenForLabel,
	PERSONA_V2_KEYS,
	PERSONA_SCHEMA_VERSION,
	isPersonaProfileV2,
	type TokenGroup
} from './index';
import {
	AGE_RANGE_KEYS,
	PERSONA_AGE_OPTIONS,
	PERSONA_ARCHETYPES,
	CONTENT_FOCUS_OPTIONS,
	NICHE_OPTIONS,
	ETHNICITY_OPTIONS,
	SKIN_TONE_OPTIONS,
	EYE_COLOR_OPTIONS,
	BODY_TYPE_OPTIONS,
	HAIR_LENGTH_OPTIONS,
	HAIRSTYLE_OPTIONS,
	HAIR_COLOR_OPTIONS
} from '../persona-profile';

const groups = Object.keys(TOKEN_GROUPS) as TokenGroup[];

describe('token shape', () => {
	it('every token in every group is lowercase snake_case', () => {
		for (const g of groups) {
			for (const t of TOKEN_GROUPS[g]) {
				expect(t, `${g}.${t}`).toMatch(TOKEN_RE);
			}
		}
	});

	it('no group contains a duplicate token', () => {
		for (const g of groups) {
			const list = TOKEN_GROUPS[g] as readonly string[];
			expect(new Set(list).size, g).toBe(list.length);
		}
	});

	it('isToken narrows correctly and never throws on junk', () => {
		expect(isToken('archetype', 'educator')).toBe(true);
		expect(isToken('archetype', 'The Educator')).toBe(false);
		expect(isToken('archetype', null)).toBe(false);
		expect(isToken('archetype', 42)).toBe(false);
		expect(isToken('archetype', { toString: () => 'educator' })).toBe(false);
	});
});

describe('label registry', () => {
	it('every token has a non-empty label and no group has a label collision', () => {
		for (const g of groups) {
			const map = LABELS[g] as Record<string, string>;
			const seen = new Set<string>();
			for (const t of TOKEN_GROUPS[g]) {
				const l = map[t];
				expect(typeof l === 'string' && l.trim().length > 0, `${g}.${t} has a label`).toBe(true);
				expect(seen.has(l), `${g}: label "${l}" used twice`).toBe(false);
				seen.add(l);
			}
			// And no label for a token that does not exist (dead entries).
			for (const k of Object.keys(map)) {
				expect((TOKEN_GROUPS[g] as readonly string[]).includes(k), `${g}: stray label key ${k}`).toBe(true);
			}
		}
	});

	it('label() falls back to the token and never returns undefined', () => {
		expect(label('archetype', 'educator')).toBe('The Educator');
		expect(label('archetype', 'not_a_token')).toBe('not_a_token');
		expect(label('archetype', '')).toBe('');
		expect(label('archetype', null)).toBe('');
	});

	it('tokenForLabel resolves exact, case-insensitive, and hyphen-for-en-dash text', () => {
		expect(tokenForLabel('archetype', 'The Educator')).toBe('educator');
		expect(tokenForLabel('archetype', 'the educator')).toBe('educator');
		expect(tokenForLabel('ageRange', '25–34')).toBe('25_34'); // en-dash, as stored by v1
		expect(tokenForLabel('ageRange', '25-34')).toBe('25_34'); // hyphen, as typed by humans
		expect(tokenForLabel('ageRange', '25_34')).toBe('25_34'); // the token itself
		expect(tokenForLabel('ageRange', 'not an age')).toBeNull();
		expect(tokenForLabel('ageRange', '')).toBeNull();
		expect(tokenForLabel('ageRange', undefined)).toBeNull();
	});
});

/**
 * THE LOSSLESS-UPGRADE GUARANTEE. Each legacy option list must map onto its
 * token group exactly: same size, every legacy label resolves to a token, and
 * that token's label is the legacy string byte-for-byte. This is what lets the
 * v1 → v2 upgrade run without a lookup table of its own, and lets the UI keep
 * rendering today's strings.
 */
describe('legacy option lists round-trip through the registry', () => {
	const pairs: Array<[TokenGroup, readonly string[]]> = [
		['ageRange', AGE_RANGE_KEYS],
		['personaAge', PERSONA_AGE_OPTIONS],
		['archetype', PERSONA_ARCHETYPES],
		['contentFocus', CONTENT_FOCUS_OPTIONS],
		['niche', NICHE_OPTIONS],
		['heritage', ETHNICITY_OPTIONS],
		['skinTone', SKIN_TONE_OPTIONS],
		['eyeColor', EYE_COLOR_OPTIONS],
		['bodyType', BODY_TYPE_OPTIONS],
		['hairLength', HAIR_LENGTH_OPTIONS],
		['hairstyle', HAIRSTYLE_OPTIONS],
		['hairColor', HAIR_COLOR_OPTIONS]
	];

	for (const [group, legacy] of pairs) {
		it(`${group} ⇄ legacy list (${legacy.length} entries)`, () => {
			expect(TOKEN_GROUPS[group].length, `${group} size`).toBe(legacy.length);
			for (const text of legacy) {
				const token = tokenForLabel(group, text);
				expect(token, `${group}: "${text}" has no token`).not.toBeNull();
				expect(label(group, token), `${group}: label(${token})`).toBe(text);
			}
		});
	}
});

describe('schema constants', () => {
	it('version is 2 and the key order is canonical', () => {
		expect(PERSONA_SCHEMA_VERSION).toBe(2);
		expect(PERSONA_V2_KEYS[0]).toBe('meta');
		expect(PERSONA_V2_KEYS[PERSONA_V2_KEYS.length - 1]).toBe('_legacy');
		expect(new Set(PERSONA_V2_KEYS).size).toBe(PERSONA_V2_KEYS.length);
	});

	it('isPersonaProfileV2 keys off the version stamp only', () => {
		expect(isPersonaProfileV2({ meta: { schemaVersion: 2 } })).toBe(true);
		expect(isPersonaProfileV2({ meta: { schemaVersion: 1 } })).toBe(false);
		expect(isPersonaProfileV2({ archetype: 'The Creator' })).toBe(false);
		expect(isPersonaProfileV2(null)).toBe(false);
		expect(isPersonaProfileV2([])).toBe(false);
		expect(isPersonaProfileV2('{"meta":{"schemaVersion":2}}')).toBe(false);
	});
});
