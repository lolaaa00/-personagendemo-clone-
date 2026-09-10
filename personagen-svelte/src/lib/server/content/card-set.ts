/**
 * Plans a BATCH of typographic cards from the user's own quotes — which
 * palette and which layout each one gets — so the cards hang together the way
 * the user asked ("same", "matching set", "every card different") without a
 * model deciding anything. Pure: no ffmpeg, no I/O, fully testable.
 *
 * Palette and layout stay DERIVED, never random, exactly as the renderer
 * promises: the same quotes with the same look plan the same cards.
 */

import type { CardLook } from '$lib/card-quotes';
import { CURATED_PALETTES, pickCardLayout, sanitizeCardText, type CardLayout } from './card-renderer';

export interface CardSetInput {
	quotes: string[];
	look: CardLook;
	/** A pinned layout applies to every card; null/'auto' lets each line decide (or the first line, for 'same'). */
	layout?: CardLayout | 'auto' | null;
	/** A pinned ground (#hex) applies to every card, whatever the look. */
	ground?: string | null;
	/** Brand-brief colors — the default ground when nothing is pinned. */
	brand?: { primary?: string | null; secondary?: string | null } | null;
}

export interface PlannedCard {
	index: number;
	text: string;
	layout: CardLayout | null;
	brand: { primary: string | null; secondary: string | null };
}

export interface CardSetPlan {
	cards: PlannedCard[];
	skipped: Array<{ index: number; text: string; reason: string }>;
}

function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

const isHex = (v: unknown): v is string =>
	typeof v === 'string' && /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v.trim());

export function planCardSet(input: CardSetInput): CardSetPlan {
	const skipped: CardSetPlan['skipped'] = [];
	const texts: Array<{ index: number; text: string }> = [];
	input.quotes.forEach((raw, index) => {
		const text = sanitizeCardText(String(raw ?? ''));
		if (text) texts.push({ index, text });
		else
			skipped.push({
				index,
				text: String(raw ?? ''),
				reason: 'Uses characters the card font cannot draw, or is empty.'
			});
	});
	if (texts.length === 0) return { cards: [], skipped };

	const pinnedLayout: CardLayout | null =
		input.layout && input.layout !== 'auto' ? input.layout : null;
	const pinnedGround = isHex(input.ground) ? input.ground : null;
	const brandPrimary = isHex(input.brand?.primary) ? input.brand!.primary! : null;
	const brandSecondary = isHex(input.brand?.secondary) ? input.brand!.secondary! : null;

	// The ground every card shares when the look asks for one: the pin, else
	// the brand, else a curated trio chosen by the FIRST quote so the whole
	// batch agrees on it (per-card hashing is what makes single cards vary).
	const sharedBrand = (): PlannedCard['brand'] => {
		if (pinnedGround) return { primary: pinnedGround, secondary: null };
		if (brandPrimary) return { primary: brandPrimary, secondary: brandSecondary };
		const p = CURATED_PALETTES[hash(texts[0].text) % CURATED_PALETTES.length];
		return { primary: p.bg, secondary: p.accent };
	};

	// 'same' pins one layout for all — the user's, else the shape of the first line.
	const sameLayout = pinnedLayout ?? pickCardLayout(texts[0].text);
	// 'unique' walks the curated trios from an offset the batch itself decides,
	// so two different batches don't all open on the same ground.
	const offset = hash(texts.map((t) => t.text).join('\n'));

	const cards = texts.map(({ index, text }, i): PlannedCard => {
		switch (input.look) {
			case 'same':
				return { index, text, layout: sameLayout, brand: sharedBrand() };
			case 'unique': {
				// A pinned ground is respected even here — "different" then means the
				// layout, not a color the user explicitly chose.
				const brand = pinnedGround
					? { primary: pinnedGround, secondary: null }
					: (() => {
							const p = CURATED_PALETTES[(offset + i) % CURATED_PALETTES.length];
							return { primary: p.bg, secondary: p.accent };
						})();
				return { index, text, layout: pinnedLayout, brand };
			}
			case 'set':
			default:
				return { index, text, layout: pinnedLayout, brand: sharedBrand() };
		}
	});
	return { cards, skipped };
}
