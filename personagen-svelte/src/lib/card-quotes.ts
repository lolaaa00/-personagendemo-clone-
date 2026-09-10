/**
 * "My own words" cards — the client-safe half.
 *
 * A text card is typeset on our own servers for $0; the only paid stage in
 * that format is the Director that writes the line. When the user brings the
 * lines themselves there is nothing left to pay for, so a whole batch of them
 * — one per quote, up to MAX_CARD_QUOTES — runs with no provider call at all.
 *
 * This module is the parser the composer counts with and the vocabulary the
 * server validates against. No `$env`, no server imports: the composer needs
 * the count before anything is sent.
 */

/** Hard cap per batch. The server rejects more; the composer refuses to send more. */
export const MAX_CARD_QUOTES = 100;
/** Same ceiling the renderer applies to a Director line. */
export const MAX_QUOTE_CHARS = 220;

/** How the batch should hang together visually. */
export type CardLook = 'set' | 'same' | 'unique';

export const CARD_LOOKS: Array<{ id: CardLook; label: string; blurb: string }> = [
	{
		id: 'set',
		label: 'Matching set',
		blurb: 'One palette across every card; each line takes the layout that fits it. Reads as a series.'
	},
	{
		id: 'same',
		label: 'Same look',
		blurb: 'One palette and one layout for all of them — a uniform grid.'
	},
	{
		id: 'unique',
		label: 'Every card different',
		blurb: 'The palette changes from card to card; each line takes its own layout.'
	}
];

/** A card holds at most this many lines (the renderer's stack/list ceiling). */
export const MAX_LINES_PER_QUOTE = 6;

/**
 * Split what the user typed into one quote per card.
 *
 * Two shapes are accepted, decided by the text itself:
 *   - blank lines between quotes → each block is one quote, and a block may
 *     keep its own line breaks (the renderer reads those as a stack or a list);
 *   - no blank lines → every line is a quote.
 * A "blank" block-separator only counts when every block it produces could be
 * a card (≤ MAX_LINES_PER_QUOTE lines): a stray empty line in a 50-line list
 * must not turn the list into two 25-line cards, so that case reads per line.
 * Quotes are trimmed, empty ones dropped, order kept — nothing is truncated or
 * de-duplicated here, so the count the user sees is the count they typed.
 */
export function parseQuotes(raw: string): string[] {
	const text = (raw ?? '').replace(/\r/g, '');
	if (!text.trim()) return [];
	const lines = (chunk: string) =>
		chunk
			.split('\n')
			.map((l) => l.replace(/\s+/g, ' ').trim())
			.filter(Boolean);
	if (/\n[ \t]*\n/.test(text)) {
		const blocks = text
			.split(/\n[ \t]*\n+/)
			.map((b) => lines(b))
			.filter((b) => b.length > 0);
		if (blocks.every((b) => b.length <= MAX_LINES_PER_QUOTE)) {
			return blocks.map((b) => b.join('\n'));
		}
	}
	return lines(text);
}

// The same glyph range sanitizeCardText() keeps, so the composer can warn
// before the server skips. Latin + Latin Extended, plus the typographic
// punctuation a quote is likely to carry.
const EXTRA = new Set(
	['‘', '’', '“', '”', '–', '—', '…', '×', '•', '·', '€', '£', '™', '©', '®', '°'].map(
		(c) => c.codePointAt(0)!
	)
);
function typesettableRatio(q: string): number {
	const chars = [...q];
	if (chars.length === 0) return 0;
	const kept = chars.filter((ch) => {
		const c = ch.codePointAt(0)!;
		return c === 0x0a || (c >= 0x20 && c <= 0x024f) || EXTRA.has(c);
	}).length;
	return kept / chars.length;
}

/**
 * Why a quote would be skipped, or null when it will render. Mirrors the
 * server's rules (length cap, glyph gate) so the composer can say so up front
 * instead of the run reporting it afterwards.
 */
export function quoteProblem(q: string): string | null {
	if (q.length > MAX_QUOTE_CHARS) return `Over ${MAX_QUOTE_CHARS} characters — it will not fit the card.`;
	if (typesettableRatio(q) < 0.85)
		return 'Mostly characters the card font cannot draw (emoji, non-Latin script).';
	return null;
}
