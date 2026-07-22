/**
 * Platform Identity Kit helpers — pure-logic tests. These guard the contract
 * between LLM output / stored market JSON and what the UI renders: sanitized
 * handles, deduped candidates with preserved manual statuses, and bios keyed
 * only by real platform keys.
 */
import { describe, it, expect } from 'vitest';
import {
	PLATFORM_BIO_SPECS,
	BIO_PLATFORM_KEYS,
	bioLimit,
	coerceBios,
	sanitizeHandle,
	handleCompatNote,
	coerceHandleCandidates,
	mergeHandleCandidates,
	coerceConfirmedHandles,
	UNIVERSAL_HANDLE_RE
} from './persona-identity';
import { PLATFORMS } from './platforms';

describe('PLATFORM_BIO_SPECS', () => {
	it('covers every platform in the registry', () => {
		// A platform added to the registry without a bio spec would silently get
		// no bio slot in the kit — keep the two in lockstep.
		for (const key of Object.keys(PLATFORMS)) {
			expect(PLATFORM_BIO_SPECS[key], `missing bio spec for ${key}`).toBeDefined();
		}
		expect(BIO_PLATFORM_KEYS.length).toBe(Object.keys(PLATFORMS).length);
	});

	it('bioLimit returns the platform cap, null for unknown', () => {
		expect(bioLimit('tiktok')).toBe(80);
		expect(bioLimit('instagram')).toBe(150);
		expect(bioLimit('youtube')).toBe(1000);
		expect(bioLimit('myspace')).toBeNull();
		expect(bioLimit(null)).toBeNull();
	});
});

describe('coerceBios', () => {
	it('keeps only known platform keys with non-empty strings', () => {
		const out = coerceBios({
			tiktok: '  Honey-first skincare 🍯  ',
			instagram: '',
			myspace: 'nope',
			youtube: 42
		});
		expect(out).toEqual({ tiktok: 'Honey-first skincare 🍯' });
	});

	it('does not truncate to the platform limit (UI flags over-limit instead)', () => {
		const long = 'x'.repeat(200);
		expect(coerceBios({ tiktok: long }).tiktok).toHaveLength(200);
	});

	it('handles junk input', () => {
		expect(coerceBios(null)).toEqual({});
		expect(coerceBios('a string')).toEqual({});
		expect(coerceBios([1, 2])).toEqual({});
	});
});

describe('sanitizeHandle', () => {
	it('lowercases, strips @ and illegal characters', () => {
		expect(sanitizeHandle('@Jenny Tran!')).toBe('jennytran');
		expect(sanitizeHandle('Jenny.Tran_88')).toBe('jenny.tran_88');
	});

	it('trims leading/trailing periods (no platform allows them)', () => {
		expect(sanitizeHandle('.jenny.')).toBe('jenny');
	});

	it('caps at the longest platform limit (30)', () => {
		expect(sanitizeHandle('a'.repeat(50))).toHaveLength(30);
	});

	it('returns empty for non-strings', () => {
		expect(sanitizeHandle(null)).toBe('');
		expect(sanitizeHandle(42)).toBe('');
	});
});

describe('handleCompatNote', () => {
	it('is null for universal handles (≤15, a-z 0-9 _)', () => {
		expect(UNIVERSAL_HANDLE_RE.test('jennytran_glow')).toBe(true);
		expect(handleCompatNote('jennytran_glow')).toBeNull();
	});

	it('flags X for periods and >15 chars', () => {
		expect(handleCompatNote('jenny.tran')).toMatch(/X/);
		expect(handleCompatNote('a'.repeat(16))).toMatch(/X \(max 15\)/);
	});

	it('flags TikTok past 24 chars', () => {
		const note = handleCompatNote('a'.repeat(25));
		expect(note).toMatch(/TikTok/);
	});
});

describe('coerceHandleCandidates', () => {
	it('accepts bare strings (LLM output) and objects (storage), dedupes', () => {
		const out = coerceHandleCandidates([
			'@JennyTran',
			{ handle: 'jennytran', status: 'taken' },
			{ handle: 'jennytranglow', status: 'confirmed' },
			{ handle: 'jennytranglow', status: 'untried' },
			''
		]);
		// First occurrence wins: the bare string arrived before the 'taken' object.
		expect(out).toEqual([
			{ handle: 'jennytran', status: 'untried' },
			{ handle: 'jennytranglow', status: 'confirmed' }
		]);
	});

	it('coerces unknown statuses to untried and respects the cap', () => {
		const out = coerceHandleCandidates(
			Array.from({ length: 30 }, (_, i) => ({ handle: `h${i}`, status: 'available' })),
			5
		);
		expect(out).toHaveLength(5);
		expect(out.every((c) => c.status === 'untried')).toBe(true);
	});

	it('returns [] for non-arrays', () => {
		expect(coerceHandleCandidates({ handle: 'x' })).toEqual([]);
		expect(coerceHandleCandidates(null)).toEqual([]);
	});
});

describe('mergeHandleCandidates', () => {
	it('preserves existing statuses and appends only new handles as untried', () => {
		const existing = [
			{ handle: 'jennytran', status: 'taken' as const },
			{ handle: 'jennyglow', status: 'confirmed' as const }
		];
		const fresh = [
			{ handle: 'jennytran', status: 'untried' as const },
			{ handle: 'thejennytran', status: 'confirmed' as const }
		];
		expect(mergeHandleCandidates(existing, fresh)).toEqual([
			{ handle: 'jennytran', status: 'taken' },
			{ handle: 'jennyglow', status: 'confirmed' },
			// New handles always arrive untried — a fresh generation can't claim
			// a handle was confirmed when the user never tried it.
			{ handle: 'thejennytran', status: 'untried' }
		]);
	});
});

describe('coerceConfirmedHandles', () => {
	it('keeps only registry platforms with sanitized non-empty handles', () => {
		const out = coerceConfirmedHandles({
			tiktok: '@Jenny_Tran',
			instagram: '',
			myspace: 'jenny'
		});
		expect(out).toEqual({ tiktok: 'jenny_tran' });
	});
});
