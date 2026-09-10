import { describe, it, expect } from 'vitest';
import { buildFitPanel, fitBand, MIXED_FIT, STRONG_FIT, type FitVerdictNote } from './fit-verdict';

const note = (over: Partial<FitVerdictNote> = {}): FitVerdictNote => ({
	viewerIndex: 0,
	fit: 55,
	objection: 'Reads like an ad.',
	viewer: 'Nurse, 47, two kids at home, Ballarat',
	...over
});

describe('buildFitPanel — no verdict is the normal case, and it renders nothing', () => {
	it('returns null when the score is null or absent', () => {
		expect(buildFitPanel(null, [note()])).toBeNull();
		expect(buildFitPanel(undefined, [note()])).toBeNull();
	});

	it('returns null when the notes are null, absent or empty', () => {
		expect(buildFitPanel(70, null)).toBeNull();
		expect(buildFitPanel(70, undefined)).toBeNull();
		expect(buildFitPanel(70, [])).toBeNull();
	});

	it('returns null for both halves missing — the overwhelmingly common row', () => {
		expect(buildFitPanel(null, null)).toBeNull();
	});

	it('returns null for a score that is not a number in range', () => {
		for (const bad of ['', 'high', NaN, Infinity, -1, 101, {}, [], true]) {
			expect(buildFitPanel(bad, [note()]), JSON.stringify(bad)).toBeNull();
		}
	});

	it('returns null when the notes are not an array of usable rows', () => {
		for (const bad of ['[]', 42, {}, [null], [undefined], ['nope'], [[]], [{ fit: 'x' }]]) {
			expect(buildFitPanel(70, bad), JSON.stringify(bad)).toBeNull();
		}
	});

	it('never throws on hostile input', () => {
		for (const bad of [Symbol('x'), () => 1, new Date(), { fit: 1 }]) {
			expect(() => buildFitPanel(bad, bad)).not.toThrow();
		}
	});

	it('keeps a legitimate score of zero — silence is not the same as scoring 0', () => {
		const panel = buildFitPanel(0, [note({ fit: 0 })]);
		expect(panel?.score).toBe(0);
	});
});

describe('buildFitPanel — what is shown', () => {
	it('carries the overall score and one reaction per note', () => {
		const panel = buildFitPanel(62, [
			note({ viewerIndex: 0, fit: 80 }),
			note({ viewerIndex: 1, fit: 44, viewer: 'Tradie, 31, Geelong' })
		]);
		expect(panel?.score).toBe(62);
		expect(panel?.reactions).toHaveLength(2);
		expect(panel?.reactions[1].viewer).toBe('Tradie, 31, Geelong');
	});

	it('rounds and coerces numeric strings the way the judge does', () => {
		const panel = buildFitPanel('61.6', [note({ fit: '44.4' } as unknown as FitVerdictNote)]);
		expect(panel?.score).toBe(62);
		expect(panel?.reactions[0].fit).toBe(44);
	});

	it('drops individual rows that are unusable but keeps the rest', () => {
		const panel = buildFitPanel(70, [
			note({ viewerIndex: 0, fit: 70 }),
			{ viewerIndex: 1, fit: 900 } as FitVerdictNote,
			{ viewerIndex: -3, fit: 50 } as FitVerdictNote,
			note({ viewerIndex: 2, fit: 20 })
		]);
		expect(panel?.reactions.map((r) => r.fit)).toEqual([70, 20]);
	});

	it('shows one row per panel slot — a repeated index is dropped, not duplicated', () => {
		const panel = buildFitPanel(70, [
			note({ viewerIndex: 1, fit: 70 }),
			note({ viewerIndex: 1, fit: 10 })
		]);
		expect(panel?.reactions).toHaveLength(1);
		expect(panel?.reactions[0].fit).toBe(70);
	});

	it('gives every reaction a unique, stable key', () => {
		const keys = buildFitPanel(50, [
			note({ viewerIndex: 3 }),
			note({ viewerIndex: 0 }),
			note({ viewerIndex: 2 })
		])!.reactions.map((r) => r.key);
		expect(new Set(keys).size).toBe(3);
		expect(keys).toEqual(['viewer-0', 'viewer-2', 'viewer-3']);
	});
});

describe('buildFitPanel — panel order, never a leaderboard', () => {
	it('orders by viewerIndex even when the scores say otherwise', () => {
		const panel = buildFitPanel(50, [
			note({ viewerIndex: 2, fit: 90 }),
			note({ viewerIndex: 0, fit: 10 }),
			note({ viewerIndex: 1, fit: 50 })
		]);
		expect(panel?.reactions.map((r) => r.fit)).toEqual([10, 50, 90]);
	});
});

describe('objections are optional, trimmed and capped', () => {
	it('is null when absent, blank or not a string', () => {
		for (const bad of [undefined, '', '   ', 42, null, {}]) {
			const panel = buildFitPanel(50, [note({ objection: bad as unknown as string })]);
			expect(panel?.reactions[0].objection, JSON.stringify(bad)).toBeNull();
		}
	});

	it('trims and preserves ordinary text verbatim', () => {
		const panel = buildFitPanel(50, [note({ objection: '  Sounds like every other ad.  ' })]);
		expect(panel?.reactions[0].objection).toBe('Sounds like every other ad.');
	});

	it('caps a model that starts narrating', () => {
		const panel = buildFitPanel(50, [note({ objection: 'x'.repeat(400) })]);
		expect(panel!.reactions[0].objection!.length).toBe(240);
		expect(panel!.reactions[0].objection!.endsWith('…')).toBe(true);
	});

	it('passes markup through as text — the renderer escapes, nothing is stripped here', () => {
		const raw = '<img src=x onerror=alert(1)> too salesy';
		const panel = buildFitPanel(50, [note({ objection: raw })]);
		expect(panel?.reactions[0].objection).toBe(raw);
	});
});

describe('viewers', () => {
	it('uses the stored summary line', () => {
		const panel = buildFitPanel(50, [note({ viewer: 'Nurse, 47, Ballarat' })]);
		expect(panel?.reactions[0].viewer).toBe('Nurse, 47, Ballarat');
	});

	it('falls back to a numbered reader rather than a blank when none was stored', () => {
		for (const bad of [undefined, '  ', 42, null]) {
			const panel = buildFitPanel(50, [note({ viewerIndex: 2, viewer: bad as unknown as string })]);
			expect(panel?.reactions[0].viewer, JSON.stringify(bad)).toBe('Reader 3');
		}
	});
});

describe('banding is calm — three bands, no failure band', () => {
	it('bands on the documented thresholds', () => {
		expect(fitBand(100)).toBe('strong');
		expect(fitBand(STRONG_FIT)).toBe('strong');
		expect(fitBand(STRONG_FIT - 1)).toBe('mixed');
		expect(fitBand(MIXED_FIT)).toBe('mixed');
		expect(fitBand(MIXED_FIT - 1)).toBe('cool');
		expect(fitBand(0)).toBe('cool');
	});

	it('only ever emits the three known bands', () => {
		const bands = new Set<string>();
		for (let s = 0; s <= 100; s++) bands.add(fitBand(s));
		expect([...bands].sort()).toEqual(['cool', 'mixed', 'strong']);
	});

	it('bands the panel by the overall score and each reaction by its own', () => {
		const panel = buildFitPanel(30, [
			note({ viewerIndex: 0, fit: 85 }),
			note({ viewerIndex: 1, fit: 5 })
		]);
		expect(panel?.band).toBe('cool');
		expect(panel?.reactions.map((r) => r.band)).toEqual(['strong', 'cool']);
	});
});

describe('the headline reports the readers, never grades the writer', () => {
	const headline = (score: number, count = 4) =>
		buildFitPanel(
			score,
			Array.from({ length: count }, (_, i) => note({ viewerIndex: i }))
		)!.headline;

	it('says what the readers would do at each band', () => {
		expect(headline(90)).toBe('Most of these readers would stop on this.');
		expect(headline(55)).toBe('The panel is split.');
		expect(headline(10)).toBe('Most of these readers would keep scrolling.');
	});

	it('speaks in the singular when only one reader answered', () => {
		expect(headline(90, 1)).toBe('This reader would stop on this.');
		expect(headline(55, 1)).toBe('This reader is on the fence.');
		expect(headline(10, 1)).toBe('This reader would keep scrolling.');
	});

	it('never uses failure or grading language', () => {
		const banned = /\b(fail|failed|bad|poor|weak|reject|score of|grade|worst)\b/i;
		for (let s = 0; s <= 100; s += 5) {
			for (const count of [1, 4]) {
				expect(headline(s, count), `${s}/${count}`).not.toMatch(banned);
			}
		}
	});
});
