/**
 * Deterministic typographic-card renderer — the $0 generation path.
 *
 * Ten of the Studio channel templates are `still: 'graphic'`: their artwork IS
 * a line of text on a designed ground. Paying an image model $0.08 (and ~30s,
 * and a fal dependency) to typeset text it occasionally misspells is the most
 * expensive possible way to do deterministic work — so this module renders
 * those cards locally with ffmpeg (already a soft dependency via
 * `burnCaptions`) and the same font-discovery rules video.ts uses.
 *
 * Contract with the pipeline (never-brick, mirrors burnCaptions):
 *   - `renderTypographicCard` NEVER throws. It returns null whenever it can't
 *     produce a card it stands behind — no ffmpeg on the host, no usable font,
 *     text dominated by glyphs the system font can't draw (emoji, CJK) — and
 *     the caller falls through to the existing Nano Banana / OpenRouter path
 *     unchanged. The model path is the fallback, not the other way round.
 *   - Layout and palette are DERIVED (from the card text's shape and the brand
 *     brief's colors), never random: the same text + brand renders the same
 *     card, so a refine that only edits art direction doesn't reshuffle the look.
 *   - Env: UGC_CARD_RENDERER=model|off disables the local renderer entirely
 *     (every graphic card pays the model path again, exactly pre-renderer
 *     behavior).
 *
 * Cost/provenance: callers record a $0 'local' cost event with
 * CARD_RENDERER_LABEL so the ledger, the post drawer, and the composer preview
 * all tell the client these posts are free.
 */

import { mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { hasFfmpeg, findFont, runFfmpeg } from '$lib/server/video';

/** Ledger/provenance label — names the renderer that actually ran, like model labels do. */
export const CARD_RENDERER_LABEL = 'server typographic renderer (no AI, $0)';

const CANVAS_W = 1080;
const CANVAS_H = 1920;

export type CardLayout = 'statement' | 'quote' | 'stack' | 'list' | 'split';

export interface CardPalette {
	bg: string;
	fg: string;
	accent: string;
}

export interface CardRenderInput {
	/** The Director's line — the artwork. */
	cardText: string;
	/** Art-direction string (template scene / composer edit). Reserved for future
	 *  tone hints; the palette is derived from brand + text. */
	artDirection?: string | null;
	/**
	 * Pin the layout instead of deriving it from the text. The composer offers
	 * this so a user who wants a list can have one even when their line reads
	 * like a statement; absent (the normal case) keeps pickCardLayout()'s
	 * heuristic, which is what every existing caller relies on.
	 */
	layout?: CardLayout | null;
	/** Brand-brief colors; invalid/absent values fall back to curated palettes. */
	brand?: { primary?: string | null; secondary?: string | null } | null;
	/** Small "@handle" credit at the bottom of the card. */
	handle?: string | null;
}

export interface RenderedCard {
	buffer: Buffer;
	layout: CardLayout;
	palette: CardPalette;
}

/** True when the local renderer is switched off via env (model path only). */
export function cardRendererDisabled(): boolean {
	const v = (env.UGC_CARD_RENDERER || '').trim().toLowerCase();
	return v === 'model' || v === 'off' || v === 'false';
}

/**
 * Whether a local render can happen on THIS host right now — the composer
 * preview uses it so a "$0" quote is only shown when the run will actually be
 * free, instead of promising free and billing the model fallback.
 */
export async function isCardRendererAvailable(): Promise<boolean> {
	if (cardRendererDisabled()) return false;
	if (!(await hasFfmpeg())) return false;
	return findFont() != null;
}

// ── Text sanitation ──────────────────────────────────────────────────────────

// Glyph coverage guard: DejaVu/Arial cover Latin + Latin Extended + common
// typographic punctuation, but NOT emoji or CJK — ffmpeg would draw tofu boxes.
// Characters outside this set are stripped; if that loses a meaningful share of
// the text, the card belongs on the model path (which rasterizes anything).
const EXTRA_ALLOWED = new Set([
	0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x00d7, 0x2022
]);

/**
 * Normalizes whitespace per line and strips glyphs the system font can't draw.
 * Returns null when the surviving text is too small a fraction of the original
 * (the card visibly ISN'T the Director's line anymore) or empty.
 */
export function sanitizeCardText(raw: string): string | null {
	const cleaned = raw
		.replace(/\r/g, '')
		.split('\n')
		.map((l) => l.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n')
		.trim();
	if (!cleaned) return null;
	const kept = [...cleaned]
		.filter((ch) => {
			const c = ch.codePointAt(0)!;
			return c === 0x0a || (c >= 0x20 && c <= 0x024f) || EXTRA_ALLOWED.has(c);
		})
		.join('')
		.replace(/[ \t]+/g, ' ')
		.trim();
	if (!kept) return null;
	if (kept.length < cleaned.length * 0.85) return null;
	return kept;
}

// ── Palette ──────────────────────────────────────────────────────────────────

/** Editorial ground/type/accent trios for brand-less personas — rotated by text
 *  hash so a feed of cards varies while any single card stays reproducible. */
export const CURATED_PALETTES: CardPalette[] = [
	{ bg: '#101418', fg: '#F5F1E8', accent: '#E8C468' }, // ink / cream / gold
	{ bg: '#F4EFE6', fg: '#1B1B1F', accent: '#C4552A' }, // paper / ink / rust
	{ bg: '#14281D', fg: '#EDE9DC', accent: '#8FB98B' }, // forest / bone / sage
	{ bg: '#1D1A2F', fg: '#EFEAF7', accent: '#9A86E8' } // midnight / lilac
];

function parseHex(color: string | null | undefined): string | null {
	if (typeof color !== 'string') return null;
	const m = color.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
	if (!m) return null;
	const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
	return `#${h.toUpperCase()}`;
}

function relativeLuminance(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const chan = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * chan((n >> 16) & 0xff) + 0.7152 * chan((n >> 8) & 0xff) + 0.0722 * chan(n & 0xff);
}

function textHash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

/**
 * Brand primary becomes the ground with a legibility-derived ink; brand
 * secondary becomes the accent only when it reads against that ground.
 * No brand → curated palette picked by text hash (stable per card).
 */
export function resolveCardPalette(
	cardText: string,
	brand?: { primary?: string | null; secondary?: string | null } | null
): CardPalette {
	const primary = parseHex(brand?.primary);
	if (!primary) return CURATED_PALETTES[textHash(cardText) % CURATED_PALETTES.length];
	const bgLum = relativeLuminance(primary);
	const fg = bgLum > 0.45 ? '#141414' : '#FAFAF7';
	const secondary = parseHex(brand?.secondary);
	const accent = secondary && Math.abs(relativeLuminance(secondary) - bgLum) > 0.2 ? secondary : fg;
	return { bg: primary, fg, accent };
}

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * Derives the layout from the SHAPE of the Director's line — the same signals
 * the typographic templates encode ("numbered list", "myth vs fact", "3-5
 * short poetic lines") without needing the template id threaded through.
 */
export function pickCardLayout(cardText: string): CardLayout {
	const lines = cardText.split('\n').filter(Boolean);
	if (/\bmyth\b/i.test(cardText) && /\bfact\b/i.test(cardText)) return 'split';
	if (lines.filter((l) => /^\s*\d+[.)]\s+/.test(l)).length >= 2) return 'list';
	if (lines.length >= 3) return 'stack';
	if (cardText.length <= 90) return 'statement';
	return 'quote';
}

interface TextLine {
	text: string;
	fontsize: number;
	/** '#RRGGBB' */
	color: string;
	alpha?: number;
	/** centered when x is omitted */
	x?: number;
	y: number;
}

interface AccentBox {
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	alpha?: number;
}

interface CardComposition {
	lines: TextLine[];
	boxes: AccentBox[];
}

// DejaVu Sans Bold's average advance width ≈ 0.58em — good enough for greedy
// wrapping (centered layouts hide small estimate errors; left-aligned layouts
// only risk a slightly early break, never an overflow, at this ratio).
const CHAR_W = 0.58;

/** Greedy wrap at an estimated glyph width; a single over-long word is hard-sliced. */
export function wrapCardLines(text: string, fontsize: number, maxWidth: number): string[] {
	const perLine = Math.max(4, Math.floor(maxWidth / (fontsize * CHAR_W)));
	const out: string[] = [];
	for (const word of text.split(' ')) {
		const last = out[out.length - 1];
		if (last != null && (last + ' ' + word).length <= perLine) {
			out[out.length - 1] = `${last} ${word}`;
		} else if (word.length <= perLine) {
			out.push(word);
		} else {
			for (let i = 0; i < word.length; i += perLine) out.push(word.slice(i, i + perLine));
		}
	}
	return out.length ? out : [''];
}

/** Shrinks the font until the wrapped block fits its height budget. */
function fitBlock(
	text: string,
	opts: { start: number; min: number; maxWidth: number; lineHeight: number; maxHeight: number }
): { lines: string[]; fontsize: number } {
	let fontsize = opts.start;
	let lines = wrapCardLines(text, fontsize, opts.maxWidth);
	while (fontsize > opts.min && lines.length * fontsize * opts.lineHeight > opts.maxHeight) {
		fontsize -= 4;
		lines = wrapCardLines(text, fontsize, opts.maxWidth);
	}
	return { lines, fontsize };
}

function stripOuterQuotes(s: string): string {
	return s.replace(/^["“”']+\s*/, '').replace(/\s*["“”']+$/, '');
}

function composeStatement(text: string, p: CardPalette): CardComposition {
	const { lines, fontsize } = fitBlock(stripOuterQuotes(text.replace(/\n/g, ' ')), {
		start: 96,
		min: 44,
		maxWidth: 860,
		lineHeight: 1.28,
		maxHeight: 900
	});
	const lh = Math.round(fontsize * 1.28);
	const blockH = lines.length * lh;
	const startY = Math.round((CANVAS_H - blockH) * 0.47);
	return {
		boxes: [{ x: (CANVAS_W - 140) / 2, y: startY - 96, w: 140, h: 10, color: p.accent }],
		lines: lines.map((t, i) => ({ text: t, fontsize, color: p.fg, y: startY + i * lh }))
	};
}

function composeQuote(text: string, p: CardPalette): CardComposition {
	const { lines, fontsize } = fitBlock(stripOuterQuotes(text.replace(/\n/g, ' ')), {
		start: 76,
		min: 40,
		maxWidth: 840,
		lineHeight: 1.38,
		maxHeight: 860
	});
	const lh = Math.round(fontsize * 1.38);
	const blockH = lines.length * lh;
	const startY = Math.round((CANVAS_H - blockH) * 0.5);
	return {
		boxes: [{ x: (CANVAS_W - 120) / 2, y: startY + blockH + 80, w: 120, h: 8, color: p.accent }],
		lines: [
			{ text: '“', fontsize: 170, color: p.accent, y: startY - 220 },
			...lines.map((t, i) => ({ text: t, fontsize, color: p.fg, y: startY + i * lh }))
		]
	};
}

function composeStack(text: string, p: CardPalette): CardComposition {
	const sourceLines = text.split('\n').filter(Boolean);
	let fontsize = 62;
	const wrap = () => sourceLines.flatMap((l) => wrapCardLines(l, fontsize, 780));
	let lines = wrap();
	while (fontsize > 36 && lines.length * fontsize * 1.55 > 1000) {
		fontsize -= 4;
		lines = wrap();
	}
	const lh = Math.round(fontsize * 1.55);
	const blockH = lines.length * lh;
	const startY = Math.round((CANVAS_H - blockH) * 0.48);
	return {
		boxes: [{ x: 120, y: startY - 8, w: 8, h: blockH + Math.round(lh * 0.3), color: p.accent }],
		lines: lines.map((t, i) => ({ text: t, fontsize, color: p.fg, x: 176, y: startY + i * lh }))
	};
}

function composeList(text: string, p: CardPalette): CardComposition {
	const src = text.split('\n').filter(Boolean);
	const headline = stripOuterQuotes(src[0] ?? '');
	const items = src.slice(1);
	const head = fitBlock(headline, {
		start: 66,
		min: 40,
		maxWidth: 800,
		lineHeight: 1.25,
		maxHeight: 320
	});
	const headLh = Math.round(head.fontsize * 1.25);
	const headH = head.lines.length * headLh;

	// Wrapped continuation lines hang-indent under the item's text, not its
	// number — "3. Doomscrolling before / bed" flush with the digits reads broken.
	let itemSize = 50;
	const wrapItems = () =>
		items.flatMap((l) =>
			wrapCardLines(l, itemSize, 780).map((t, idx) => ({ text: t, cont: idx > 0 }))
		);
	let itemLines = wrapItems();
	while (itemSize > 32 && itemLines.length * itemSize * 1.5 > 900) {
		itemSize -= 4;
		itemLines = wrapItems();
	}
	const itemLh = Math.round(itemSize * 1.5);
	const gap = 96;
	const blockH = headH + gap + itemLines.length * itemLh;
	const startY = Math.round((CANVAS_H - blockH) * 0.45);
	return {
		boxes: [{ x: 140, y: startY + headH + Math.round(gap / 2) - 4, w: 120, h: 8, color: p.accent }],
		lines: [
			...head.lines.map((t, i) => ({
				text: t,
				fontsize: head.fontsize,
				color: p.fg,
				x: 140,
				y: startY + i * headLh
			})),
			...itemLines.map((l, i) => ({
				text: l.text,
				fontsize: itemSize,
				color: p.fg,
				alpha: 0.92,
				x: l.cont ? 140 + Math.round(itemSize * 1.1) : 140,
				y: startY + headH + gap + i * itemLh
			}))
		]
	};
}

function composeSplit(text: string, p: CardPalette): CardComposition {
	// "MYTH: … FACT: …" (any separators). Parse defensively; anything that
	// doesn't split cleanly renders as a statement instead of a broken diptych.
	const m = text.match(/myth\s*[:\-–—]?\s*([\s\S]+?)(?:\n|\.\s|(?=fact\b))/i);
	const f = text.match(/fact\s*[:\-–—]?\s*([\s\S]+)/i);
	const myth = m?.[1]?.trim();
	const fact = f?.[1]?.trim();
	if (!myth || !fact) return composeStatement(text, p);

	const mythBlock = fitBlock(stripOuterQuotes(myth.replace(/\n/g, ' ')), {
		start: 62,
		min: 38,
		maxWidth: 820,
		lineHeight: 1.3,
		maxHeight: 420
	});
	const factBlock = fitBlock(stripOuterQuotes(fact.replace(/\n/g, ' ')), {
		start: 62,
		min: 38,
		maxWidth: 820,
		lineHeight: 1.3,
		maxHeight: 420
	});
	const mLh = Math.round(mythBlock.fontsize * 1.3);
	const fLh = Math.round(factBlock.fontsize * 1.3);
	// Geometry flows from the content: the whole diptych (label + myth + rule +
	// label + fact) is measured first, then centered — a fixed mid-canvas rule
	// left a dead gap under short myth text.
	const labelGap = 96;
	const ruleGap = 110;
	const mythH = mythBlock.lines.length * mLh;
	const factH = factBlock.lines.length * fLh;
	const totalH = 42 + labelGap + mythH + ruleGap + 6 + ruleGap + 42 + labelGap + factH;
	const top = Math.round((CANVAS_H - totalH) * 0.44);
	const mythY = top + 42 + labelGap;
	const ruleY = mythY + mythH + ruleGap;
	const factLabelY = ruleY + 6 + ruleGap;
	return {
		boxes: [{ x: 140, y: ruleY, w: CANVAS_W - 280, h: 6, color: p.accent, alpha: 0.85 }],
		lines: [
			{ text: 'MYTH', fontsize: 42, color: p.fg, alpha: 0.55, y: top },
			...mythBlock.lines.map((t, i) => ({
				text: t,
				fontsize: mythBlock.fontsize,
				color: p.fg,
				alpha: 0.55,
				y: mythY + i * mLh
			})),
			{ text: 'FACT', fontsize: 42, color: p.accent, y: factLabelY },
			...factBlock.lines.map((t, i) => ({
				text: t,
				fontsize: factBlock.fontsize,
				color: p.fg,
				y: factLabelY + 42 + labelGap + i * fLh
			}))
		]
	};
}

function compose(layout: CardLayout, text: string, p: CardPalette): CardComposition {
	switch (layout) {
		case 'split':
			return composeSplit(text, p);
		case 'list':
			return composeList(text, p);
		case 'stack':
			return composeStack(text, p);
		case 'quote':
			return composeQuote(text, p);
		default:
			return composeStatement(text, p);
	}
}

// ── ffmpeg assembly ──────────────────────────────────────────────────────────

const hexToFf = (hex: string) => `0x${hex.slice(1)}`;

/**
 * Renders the card to a PNG buffer, or null when this host can't (no ffmpeg /
 * no font), the text needs glyphs the font lacks, or ffmpeg fails. Never throws.
 */
export async function renderTypographicCard(input: CardRenderInput): Promise<RenderedCard | null> {
	try {
		if (cardRendererDisabled()) return null;
		const text = sanitizeCardText(input.cardText || '');
		if (!text) return null;
		if (!(await hasFfmpeg())) return null;
		const font = findFont();
		if (!font) return null;

		const palette = resolveCardPalette(text, input.brand);
		const layout = input.layout ?? pickCardLayout(text);
		const { lines, boxes } = compose(layout, text, palette);

		const handle = sanitizeCardText(input.handle || '');
		if (handle) {
			lines.push({
				text: handle.slice(0, 40),
				fontsize: 30,
				color: palette.fg,
				alpha: 0.55,
				y: 1790
			});
		}

		// Same temp-dir pattern as burnCaptions: every path ffmpeg touches is
		// relative to the temp cwd, so no cross-platform filter-path escaping. Text
		// goes through textfile= (with expansion=none) so NO card content is ever
		// interpolated into the filter string.
		const dir = await mkdtemp(join(tmpdir(), 'ugc-card-'));
		try {
			await copyFile(font, join(dir, 'font.ttf'));
			const filters: string[] = boxes.map(
				(b) =>
					`drawbox=x=${Math.round(b.x)}:y=${Math.round(b.y)}:w=${Math.round(b.w)}:h=${Math.round(b.h)}:color=${hexToFf(b.color)}@${b.alpha ?? 1}:t=fill`
			);
			for (let i = 0; i < lines.length; i++) {
				const l = lines[i];
				await writeFile(join(dir, `t${i}.txt`), l.text, 'utf8');
				const x = l.x != null ? String(Math.round(l.x)) : '(w-text_w)/2';
				filters.push(
					`drawtext=fontfile=font.ttf:textfile=t${i}.txt:expansion=none:fontsize=${l.fontsize}:fontcolor=${hexToFf(l.color)}@${l.alpha ?? 1}:x=${x}:y=${Math.round(l.y)}`
				);
			}
			await runFfmpeg(
				[
					'-y',
					'-f',
					'lavfi',
					'-i',
					`color=c=${hexToFf(palette.bg)}:s=${CANVAS_W}x${CANVAS_H}`,
					'-vf',
					filters.join(','),
					'-frames:v',
					'1',
					'out.png'
				],
				dir
			);
			const buffer = await readFile(join(dir, 'out.png'));
			if (buffer.length === 0) return null;
			return { buffer, layout, palette };
		} finally {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	} catch (e) {
		console.warn('[CardRenderer] Local render failed — model path will run:', (e as Error).message);
		return null;
	}
}
