import type { RequestHandler } from './$types';
import { STUDIO_TEMPLATES } from '$lib/studio-templates';
import { renderTypographicCard } from '$lib/server/content/card-renderer';

/**
 * Studio tile previews for typographic templates — a PNG of the template's
 * sample line rendered by the REAL $0 card renderer, so the placeholder a user
 * browses is literally what a generation produces (layout heuristics, curated
 * palette and all), not an artist's impression.
 *
 * Serves only static catalog sample text (no user data, no auth needed) and
 * only for templates whose runs are graphic cards. 404 = "no preview" — the
 * tile falls back to the styled text sample, so a host without ffmpeg/fonts
 * degrades to exactly the pre-preview UI.
 */

// Renders are deterministic per (template, idx), so cache the PNG for the
// process lifetime — the shelf shows ~10 of these and each is ~200ms to make.
const cache = new Map<string, Buffer>();
// A render that failed once (no ffmpeg/font) will fail every time on this
// host — remember it so the shelf doesn't re-spawn ffmpeg per tile per view.
const failed = new Set<string>();

export const GET: RequestHandler = async ({ params }) => {
	const template = STUDIO_TEMPLATES.find((t) => t.id === params.templateId);
	// Only graphic-card templates have renderer previews — everything else 404s.
	if (!template || template.baseBody.still !== 'graphic') {
		return new Response('Not found', { status: 404 });
	}
	const pool = [template.sample, ...(template.samples ?? [])];
	const idx = Math.min(Math.max(parseInt(params.idx, 10) || 0, 0), pool.length - 1);

	const key = `${template.id}:${idx}`;
	if (failed.has(key)) return new Response('Renderer unavailable', { status: 404 });
	let png = cache.get(key);
	if (!png) {
		const card = await renderTypographicCard({ cardText: pool[idx] });
		if (!card) {
			failed.add(key);
			return new Response('Renderer unavailable', { status: 404 });
		}
		png = card.buffer;
		cache.set(key, png);
	}

	return new Response(new Uint8Array(png), {
		headers: {
			'Content-Type': 'image/png',
			// Catalog samples only change with a deploy — let browsers keep them.
			'Cache-Control': 'public, max-age=86400'
		}
	});
};
