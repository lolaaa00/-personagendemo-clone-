/**
 * THE FIT JUDGE MUST NEVER COST SOMEONE A POST.
 *
 * It is an advisory opinion bolted onto a publishing pipeline. Every failure
 * here — a malformed answer, a score out of range, a viewer index that does not
 * exist, an empty panel — has to resolve to "no verdict" and let the post
 * through. A quality feature that can take down publishing is worse than no
 * quality feature, so most of this spec is about the ways a model can be wrong.
 */
import { describe, it, expect } from 'vitest';
import type { ViewerSkeleton } from '$lib/persona-contract/schema';
import {
	FIT_PANEL_SIZE,
	fitColumnsFor,
	fitJudgePrompt,
	judgeablePanel,
	parseFitVerdict
} from './fit-judge';

const viewer = (n: number): ViewerSkeleton => ({
	seed: `v${n}`,
	age: 30 + n,
	summary: `Viewer ${n} · a specific person with a life`
});

const PANEL = [viewer(0), viewer(1), viewer(2), viewer(3)];
const DRAFT = 'Three things I wish someone had told me before my first shift.';

const ok = (entries: unknown[]) => ({ verdicts: entries });

describe('judgeablePanel — only viewers that can be described', () => {
	it('keeps viewers with a summary and caps the panel', () => {
		expect(judgeablePanel([...PANEL, viewer(4), viewer(5)])).toHaveLength(FIT_PANEL_SIZE);
	});

	it('drops viewers with nothing to show the model', () => {
		const partial = [
			viewer(0),
			{ seed: 'x' } as ViewerSkeleton,
			{ seed: 'y', summary: '  ' } as ViewerSkeleton
		];
		expect(judgeablePanel(partial)).toHaveLength(1);
	});

	it('never throws on junk', () => {
		for (const junk of [null, undefined, 42, 'nope', {}, [null, 1, 'x']]) {
			expect(() => judgeablePanel(junk as never), JSON.stringify(junk)).not.toThrow();
			expect(judgeablePanel(junk as never)).toEqual([]);
		}
	});
});

describe('fitJudgePrompt — asks in the order that produces a usable answer', () => {
	it('asks for the objection before the score', () => {
		const prompt = fitJudgePrompt(DRAFT, PANEL);
		expect(prompt.indexOf('would most likely stop them')).toBeLessThan(prompt.indexOf('0-100'));
	});

	it('says a high score has to be earned', () => {
		expect(fitJudgePrompt(DRAFT, PANEL)).toMatch(/most posts do not land|earned/i);
	});

	it('carries the draft and every viewer', () => {
		const prompt = fitJudgePrompt(DRAFT, PANEL);
		expect(prompt).toContain(DRAFT);
		for (const v of PANEL) expect(prompt).toContain(v.summary as string);
	});

	it('mentions the creator only when there is one to mention', () => {
		expect(fitJudgePrompt(DRAFT, PANEL)).not.toContain('The creator posting it');
		const withPersona = fitJudgePrompt(DRAFT, PANEL, {
			meta: { schemaVersion: 2 },
			description: { short: 'Jenny Tran is a 34-year-old nurse in Brisbane, Queensland.' }
		} as never);
		expect(withPersona).toContain('Jenny Tran is a 34-year-old nurse');
	});
});

describe('parseFitVerdict — the answer is validated against the panel', () => {
	it('reads a well-formed answer', () => {
		const verdict = parseFitVerdict(
			ok([
				{ viewerIndex: 0, fit: 80, objection: 'Sounds like an ad.' },
				{ viewerIndex: 1, fit: 40, objection: 'Not for me.' }
			]),
			PANEL
		);
		expect(verdict?.score).toBe(60);
		expect(verdict?.entries).toHaveLength(2);
		expect(verdict?.entries[0].viewer).toBe(PANEL[0].summary);
	});

	it('accepts a bare array, since a model drops the wrapper about half the time', () => {
		expect(parseFitVerdict([{ viewerIndex: 0, fit: 50 }], PANEL)?.score).toBe(50);
	});

	/**
	 * Clamping an out-of-range index would attribute one person's objection to
	 * another — a quieter and worse failure than dropping it.
	 */
	it('discards a viewer index the panel does not have, rather than clamping it', () => {
		const verdict = parseFitVerdict(
			ok([
				{ viewerIndex: 9, fit: 90, objection: 'about someone who does not exist' },
				{ viewerIndex: 0, fit: 20 }
			]),
			PANEL
		);
		expect(verdict?.entries).toHaveLength(1);
		expect(verdict?.entries[0].viewerIndex).toBe(0);
		expect(verdict?.score).toBe(20);
	});

	it('keeps one verdict per viewer, so a repeat cannot weight them twice', () => {
		const verdict = parseFitVerdict(
			ok([
				{ viewerIndex: 0, fit: 100 },
				{ viewerIndex: 0, fit: 0 },
				{ viewerIndex: 1, fit: 50 }
			]),
			PANEL
		);
		expect(verdict?.entries).toHaveLength(2);
		expect(verdict?.score).toBe(75);
	});

	it('refuses a score that is not a score', () => {
		for (const fit of [-1, 101, 1000, NaN, Infinity, null, undefined, 'high', {}]) {
			const verdict = parseFitVerdict(ok([{ viewerIndex: 0, fit }]), PANEL);
			expect(verdict, JSON.stringify(fit)).toBeNull();
		}
	});

	it('accepts a numeric string, because JSON mode is not a guarantee', () => {
		expect(parseFitVerdict(ok([{ viewerIndex: '1', fit: '65' }]), PANEL)?.score).toBe(65);
	});

	it('truncates an objection that turned into an essay', () => {
		const verdict = parseFitVerdict(
			ok([{ viewerIndex: 0, fit: 50, objection: 'x'.repeat(900) }]),
			PANEL
		);
		expect(verdict?.entries[0].objection?.length).toBeLessThanOrEqual(240);
		expect(verdict?.entries[0].objection?.endsWith('…')).toBe(true);
	});

	it('keeps a score with no objection — "nothing would stop them" is an answer', () => {
		const verdict = parseFitVerdict(ok([{ viewerIndex: 0, fit: 88 }]), PANEL);
		expect(verdict?.entries[0].objection).toBeUndefined();
		expect(verdict?.score).toBe(88);
	});

	/** "No verdict" must be distinguishable from "scored zero". */
	it('returns null rather than a zero when nothing usable came back', () => {
		for (const answer of [
			null,
			undefined,
			42,
			'nope',
			[],
			{},
			{ verdicts: [] },
			{ verdicts: 'nope' },
			ok([{}]),
			ok([{ viewerIndex: 0 }])
		]) {
			expect(parseFitVerdict(answer, PANEL), JSON.stringify(answer)).toBeNull();
		}
		const zero = parseFitVerdict(ok([{ viewerIndex: 0, fit: 0 }]), PANEL);
		expect(zero?.score).toBe(0);
	});

	it('returns null when there is no panel to judge against', () => {
		expect(parseFitVerdict(ok([{ viewerIndex: 0, fit: 50 }]), [])).toBeNull();
	});

	it('never throws, whatever the model returned', () => {
		for (const answer of [
			null,
			undefined,
			0,
			'',
			[],
			{},
			{ verdicts: [null, 1, 'x'] },
			{ verdicts: [{ viewerIndex: {} }] }
		]) {
			expect(() => parseFitVerdict(answer, PANEL), JSON.stringify(answer)).not.toThrow();
		}
	});
});

describe('fitColumnsFor — no verdict is an explicit state, not an accident', () => {
	it('writes nulls when there is no verdict', () => {
		expect(fitColumnsFor(null)).toEqual({ fit_score: null, fit_notes: null });
	});

	it('writes the score and the notes when there is one', () => {
		const verdict = parseFitVerdict(
			ok([{ viewerIndex: 0, fit: 70, objection: 'Too long.' }]),
			PANEL
		);
		expect(fitColumnsFor(verdict)).toEqual({
			fit_score: 70,
			fit_notes: [{ viewerIndex: 0, fit: 70, objection: 'Too long.', viewer: PANEL[0].summary }]
		});
	});
});
