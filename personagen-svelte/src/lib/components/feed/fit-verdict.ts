/**
 * The read-only view model behind FitVerdict.svelte.
 *
 * The fit judge (server-side, `$lib/server/persona/fit-judge`) asks four of the
 * persona's imagined readers what would stop them taking a draft seriously, and
 * stores the answer on the post as `fit_score` + `fit_notes`. Its own contract
 * says the verdict is ADVISORY AND MUST NEVER BLOCK ANYTHING, and the display
 * inherits that word for word:
 *
 *   1. NO VERDICT IS THE NORMAL CASE. Most posts were never judged — no flag, no
 *      panel, no provider, a parse that came back empty. Every one of those ends
 *      here as `null`, which the component renders as literally nothing: no
 *      container, no placeholder, no "not scored yet" chrome. A post without a
 *      verdict must look exactly as it did before this module existed, so the
 *      absence of an opinion can never read as a defect.
 *
 *   2. IT IS AN OPINION, NOT A GRADE. Banding exists so a low number can be said
 *      quietly rather than shouted; there is deliberately no "fail" band, no
 *      pass mark and no red. The headline describes how four people reacted, and
 *      the reader is free to disagree and post anyway.
 *
 *   3. STABLE ORDER, NOT A LEADERBOARD. Reactions come out in panel order
 *      (`viewerIndex`), never sorted by score. Sorting by score would rank the
 *      persona's own audience worst-to-best on every post and turn a reading
 *      into a scoreboard; keeping the roster order also means the same person
 *      sits in the same place across posts.
 *
 * Pure and defensive: the input is a database column that a model wrote, so
 * every value is re-validated here rather than trusted. Nothing throws —
 * malformed input describes nothing, which is a correct answer, not a failure.
 */

/** One judged reader, as stored in the `fit_notes` column. */
export interface FitVerdictNote {
	viewerIndex: number;
	fit: number;
	objection?: string;
	viewer?: string;
}

/**
 * How warmly it landed. Three calm bands, no "fail": the component maps these to
 * emphasis (which of the existing text colours), never to a red/green scale.
 */
export type FitBand = 'strong' | 'mixed' | 'cool';

/** At or above this, the draft gave people a reason to stop. */
export const STRONG_FIT = 70;
/** Below this, most of the panel keeps scrolling. */
export const MIXED_FIT = 40;

/** Scores outside this range are parse errors, not opinions. Mirrors the judge. */
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/** The judge already caps objections; re-capped here because the column is data. */
const MAX_OBJECTION = 240;

export interface FitReaction {
	/** Stable key for `{#each}` — the panel slot this reaction belongs to. */
	key: string;
	/** The reader's own summary line, or a neutral stand-in if it wasn't stored. */
	viewer: string;
	fit: number;
	band: FitBand;
	/** What would stop them. Model-written text — render as TEXT, never as HTML. */
	objection: string | null;
}

export interface FitPanelView {
	/** Mean fit across the readers who answered, 0-100. */
	score: number;
	band: FitBand;
	/** One plain sentence about how it landed. Never a verdict on the writer. */
	headline: string;
	/** Readers in panel order. Always at least one — an empty panel is `null`. */
	reactions: FitReaction[];
}

export function fitBand(score: number): FitBand {
	if (score >= STRONG_FIT) return 'strong';
	if (score >= MIXED_FIT) return 'mixed';
	return 'cool';
}

/**
 * The headline. Describes the READERS' reaction, never the draft's quality —
 * "most would keep scrolling" is something to act on, "weak post" is a scolding,
 * and the difference is the whole tone of the feature.
 */
function headlineFor(band: FitBand, count: number): string {
	const who = count === 1 ? 'This reader' : 'Most of these readers';
	if (band === 'strong') return `${who} would stop on this.`;
	if (band === 'mixed') return count === 1 ? 'This reader is on the fence.' : 'The panel is split.';
	return `${who} would keep scrolling.`;
}

function scoreOf(value: unknown): number | null {
	// A blank string is an absent score, not a zero — `Number('')` is 0, and
	// letting that through would print "0/100" over a post nobody ever judged.
	const n =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim()
				? Number(value)
				: NaN;
	if (!Number.isFinite(n)) return null;
	const rounded = Math.round(n);
	if (rounded < MIN_SCORE || rounded > MAX_SCORE) return null;
	return rounded;
}

function objectionOf(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!text) return null;
	return text.length > MAX_OBJECTION ? `${text.slice(0, MAX_OBJECTION - 1).trimEnd()}…` : text;
}

function viewerOf(value: unknown, index: number): string {
	const text = typeof value === 'string' ? value.trim() : '';
	// A stored summary is the point of the panel; the numbered stand-in only
	// exists so an older row missing it still reads as a person, not a blank.
	return text || `Reader ${index + 1}`;
}

/**
 * Builds the panel view, or `null` when there is nothing honest to show.
 *
 * `null` in, `null` out — and the same for a score out of range, notes that are
 * not an array, an array of junk, or an empty array. The caller renders nothing
 * at all in that case, which is the common path.
 */
export function buildFitPanel(score: unknown, notes: unknown): FitPanelView | null {
	const overall = scoreOf(score);
	if (overall === null) return null;
	if (!Array.isArray(notes) || !notes.length) return null;

	const reactions: FitReaction[] = [];
	const seen = new Set<number>();
	for (const item of notes) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const index =
			typeof row.viewerIndex === 'number' ? row.viewerIndex : Number(row.viewerIndex ?? NaN);
		if (!Number.isInteger(index) || index < 0) continue;
		// One row per panel slot. A duplicate index is the writer losing track, and
		// showing it twice would put the same person on screen with two opinions.
		if (seen.has(index)) continue;
		const fit = scoreOf(row.fit);
		if (fit === null) continue;
		seen.add(index);
		reactions.push({
			key: `viewer-${index}`,
			viewer: viewerOf(row.viewer, index),
			fit,
			band: fitBand(fit),
			objection: objectionOf(row.objection)
		});
	}

	if (!reactions.length) return null;
	// Panel order, never score order — see rule 3 at the top of this file.
	reactions.sort(
		(a, b) => Number(a.key.slice('viewer-'.length)) - Number(b.key.slice('viewer-'.length))
	);

	const band = fitBand(overall);
	return { score: overall, band, headline: headlineFor(band, reactions.length), reactions };
}
