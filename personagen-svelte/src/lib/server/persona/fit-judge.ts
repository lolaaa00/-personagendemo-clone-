/**
 * Persona Model v2 — the fit judge (P3.3).
 *
 * A draft is judged against the PANEL, not against a demographic bracket. "Women
 * 45-54, mid income" cannot object to anything; a 47-year-old nurse in Ballarat
 * with two kids at home can, and her objection is something a person can read
 * and act on. That is the whole reason the viewer panel exists — this is what
 * consumes it.
 *
 * PURE, like Tier 2 and for the same reasons. The provider call belongs to the
 * caller: it keeps the prompt and the parsing testable without a key, and it
 * keeps the money gates in the route where the service client already lives. It
 * also means a `shadow`-style dry run is possible without a second code path.
 *
 * THE OUTPUT IS ADVISORY AND MUST NEVER BLOCK A POST. Every failure mode here —
 * no flag, no provider, no panel, malformed JSON, a score out of range, a
 * hallucinated viewer index — resolves to "no verdict", never to an exception
 * and never to a post that does not get created. A quality opinion that can take
 * down publishing is a worse feature than no opinion at all.
 */
import type { PersonaProfileV2, ViewerSkeleton } from '$lib/persona-contract/schema';

/** How many viewers are judged. Four is the plan's number and the prompt's cost. */
export const FIT_PANEL_SIZE = 4;

/** Scores outside this range are not opinions, they are parse errors. */
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/** An objection longer than this is the model narrating, not objecting. */
const MAX_OBJECTION = 240;

export interface FitVerdictEntry {
	/** Index into the panel that was judged. Always in range. */
	viewerIndex: number;
	/** 0-100. How likely this viewer is to stop and take it seriously. */
	fit: number;
	/** The one thing that would stop them, in their own terms. May be absent. */
	objection?: string;
	/** The viewer's own summary line, carried so a card can render without the panel. */
	viewer?: string;
}

export interface FitVerdict {
	/** Mean fit across the viewers that returned a usable score, rounded. */
	score: number;
	entries: FitVerdictEntry[];
}

/** The viewers a draft is judged against, and the line each is described by. */
export function judgeablePanel(panel: readonly ViewerSkeleton[] | undefined): ViewerSkeleton[] {
	if (!Array.isArray(panel)) return [];
	return panel
		.filter(
			(v) => v && typeof v === 'object' && typeof v.summary === 'string' && !!v.summary.trim()
		)
		.slice(0, FIT_PANEL_SIZE);
}

/**
 * The prompt.
 *
 * Asks for an objection FIRST and a score second, because a model asked to score
 * first invents a justification for the number it already picked. It is told to
 * answer as the viewer rather than as a marketer, and that a high score needs a
 * reason to stop scrolling — otherwise everything scores in the seventies and
 * the feature tells you nothing.
 */
export function fitJudgePrompt(
	draft: string,
	panel: readonly ViewerSkeleton[],
	persona?: PersonaProfileV2
): string {
	const viewers = judgeablePanel(panel);
	const who = persona?.description?.short
		? `\nThe creator posting it: ${persona.description.short}`
		: '';
	const roster = viewers.map((v, i) => `${i}. ${v.summary}`).join('\n');

	return `You are reading one social post as four specific people and reporting, for each of them, whether it would actually land.

You are NOT a marketer scoring copy. You are each of these people in turn, mid-scroll, with your own life and your own reasons to keep scrolling.

THE POST:
${draft}
${who}

THE PEOPLE:
${roster}

For each person, in this order:
1. The one thing that would most likely stop them taking this seriously — in their terms, not marketing terms. If nothing would, say so.
2. Only then, how likely they are to stop and take it seriously, 0-100.

A high score has to be earned by a reason to stop scrolling. Most posts do not land with most people; scoring everyone in the seventies tells the writer nothing they can use.

Answer with JSON only, no prose, no code fence:
{"verdicts":[{"viewerIndex":0,"objection":"...","fit":42}]}`;
}

function clampScore(value: unknown): number | undefined {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(n)) return undefined;
	const rounded = Math.round(n);
	if (rounded < MIN_SCORE || rounded > MAX_SCORE) return undefined;
	return rounded;
}

function objectionOf(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const text = value.trim();
	if (!text) return undefined;
	return text.length > MAX_OBJECTION ? `${text.slice(0, MAX_OBJECTION - 1).trimEnd()}…` : text;
}

/**
 * Parses a judge answer against the panel it was asked about.
 *
 * Everything is validated against the PANEL, not taken on trust: a viewer index
 * the panel does not have is discarded rather than clamped, because clamping
 * would silently attribute one person's objection to another. An answer with no
 * usable entry returns `null` — "no verdict" is a real and common outcome, and
 * it must be distinguishable from "scored zero".
 */
export function parseFitVerdict(
	answer: unknown,
	panel: readonly ViewerSkeleton[]
): FitVerdict | null {
	const viewers = judgeablePanel(panel);
	if (!viewers.length) return null;

	const raw =
		answer && typeof answer === 'object' && !Array.isArray(answer)
			? (answer as Record<string, unknown>)
			: null;
	const list =
		raw && Array.isArray(raw.verdicts) ? raw.verdicts : Array.isArray(answer) ? answer : null;
	if (!list) return null;

	const entries: FitVerdictEntry[] = [];
	const seen = new Set<number>();
	for (const item of list) {
		if (!item || typeof item !== 'object') continue;
		const row = item as Record<string, unknown>;
		const index = typeof row.viewerIndex === 'number' ? row.viewerIndex : Number(row.viewerIndex);
		if (!Number.isInteger(index) || index < 0 || index >= viewers.length) continue;
		// One verdict per viewer. A repeated index is the model losing track, and
		// averaging the duplicate would weight that viewer twice.
		if (seen.has(index)) continue;
		const fit = clampScore(row.fit);
		if (fit === undefined) continue;
		seen.add(index);
		const objection = objectionOf(row.objection);
		entries.push({
			viewerIndex: index,
			fit,
			...(objection ? { objection } : {}),
			...(viewers[index].summary ? { viewer: viewers[index].summary } : {})
		});
	}

	if (!entries.length) return null;
	entries.sort((a, b) => a.viewerIndex - b.viewerIndex);
	const score = Math.round(entries.reduce((sum, e) => sum + e.fit, 0) / entries.length);
	return { score, entries };
}

/**
 * The row a post stores. Separated from the verdict so the storage shape is
 * visible in one place, and so `fit_score: null` is an explicit, expected state
 * rather than an accident.
 */
export function fitColumnsFor(verdict: FitVerdict | null): {
	fit_score: number | null;
	fit_notes: FitVerdictEntry[] | null;
} {
	if (!verdict) return { fit_score: null, fit_notes: null };
	return { fit_score: verdict.score, fit_notes: verdict.entries };
}
