/**
 * The $0 typographic-card renderer — the pure-logic layers (sanitation, layout
 * pick, wrapping, palette) plus the never-brick contract of the render entry
 * point. The actual ffmpeg raster pass is exercised only when ffmpeg exists on
 * the host (CI without it must still pass — that IS the fallback contract).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

const {
	sanitizeCardText,
	pickCardLayout,
	wrapCardLines,
	resolveCardPalette,
	renderTypographicCard,
	isCardRendererAvailable
} = await import('./card-renderer');

describe('sanitizeCardText', () => {
	it('normalizes whitespace but keeps line structure', () => {
		expect(sanitizeCardText('  Slow   is a strategy,  \n\n  not a setback.  ')).toBe(
			'Slow is a strategy,\nnot a setback.'
		);
	});

	it('keeps typographic punctuation (curly quotes, em-dash, ellipsis)', () => {
		const s = '“Don’t” — wait… 3× more';
		expect(sanitizeCardText(s)).toBe(s);
	});

	it('rejects text dominated by glyphs the system font cannot draw', () => {
		// Mostly emoji → the rendered card would not be the Director's line.
		expect(sanitizeCardText('🔥🔥🔥🚀🚀🚀💯💯💯 ok')).toBeNull();
	});

	it('strips a stray emoji without rejecting mostly-Latin text', () => {
		expect(sanitizeCardText('You don’t need a bigger feed. You need a sharper one. 🔥')).toBe(
			'You don’t need a bigger feed. You need a sharper one.'
		);
	});

	it('rejects empty/blank input', () => {
		expect(sanitizeCardText('')).toBeNull();
		expect(sanitizeCardText('   \n  ')).toBeNull();
	});
});

describe('pickCardLayout', () => {
	it('short single line → statement', () => {
		expect(pickCardLayout('Consistency is overrated.')).toBe('statement');
	});

	it('long single line → quote', () => {
		expect(
			pickCardLayout(
				'Most morning routines are procrastination in a nice mug, and the sooner you admit that the sooner your actual work starts.'
			)
		).toBe('quote');
	});

	it('myth + fact → split', () => {
		expect(pickCardLayout('MYTH: more posting equals more reach.\nFACT: retention does.')).toBe(
			'split'
		);
	});

	it('numbered lines → list', () => {
		expect(pickCardLayout('4 things I stopped doing\n1. Doomscrolling\n2. Multitasking')).toBe(
			'list'
		);
	});

	it('three-plus short lines → stack (mantra)', () => {
		expect(pickCardLayout('Slow is a strategy.\nNot a setback.\nBreathe.')).toBe('stack');
	});
});

describe('wrapCardLines', () => {
	it('never exceeds the estimated line budget', () => {
		const lines = wrapCardLines(
			'a sentence that should wrap across several lines at this size',
			80,
			860
		);
		const perLine = Math.floor(860 / (80 * 0.58));
		expect(lines.length).toBeGreaterThan(1);
		for (const l of lines) expect(l.length).toBeLessThanOrEqual(perLine);
	});

	it('hard-slices a single over-long word instead of overflowing', () => {
		const lines = wrapCardLines('Antidisestablishmentarianismandthensome', 90, 400);
		expect(lines.length).toBeGreaterThan(1);
	});
});

describe('resolveCardPalette', () => {
	it('brand primary becomes the ground with a legibility-picked ink', () => {
		const dark = resolveCardPalette('x', { primary: '#101418', secondary: null });
		expect(dark.bg).toBe('#101418');
		expect(dark.fg).toBe('#FAFAF7'); // light ink on a dark ground
		const light = resolveCardPalette('x', { primary: '#F4EFE6', secondary: null });
		expect(light.fg).toBe('#141414'); // dark ink on a light ground
	});

	it('secondary is used as accent only when it reads against the ground', () => {
		const readable = resolveCardPalette('x', { primary: '#101418', secondary: '#E8C468' });
		expect(readable.accent).toBe('#E8C468');
		const unreadable = resolveCardPalette('x', { primary: '#101418', secondary: '#15171B' });
		expect(unreadable.accent).toBe(unreadable.fg); // fell back to the ink
	});

	it('no/invalid brand → deterministic curated palette (same text, same card)', () => {
		const a = resolveCardPalette('Slow is a strategy.', null);
		const b = resolveCardPalette('Slow is a strategy.', { primary: 'not-a-color' });
		expect(a).toEqual(b);
	});
});

describe('renderTypographicCard (never-brick contract)', () => {
	it('returns null (never throws) on unrenderable text', async () => {
		await expect(renderTypographicCard({ cardText: '🔥🚀💯🔥🚀💯' })).resolves.toBeNull();
	});

	/**
	 * Explicit timeout because this test SPAWNS FFMPEG twice — a capability probe
	 * and a render — and an external process's runtime is not ours to control.
	 * Under vitest's 5s default it passed alone and failed on a loaded full-suite
	 * run, which is the worst kind of red: it looks like a regression, it is not
	 * reproducible, and the reflex it trains is to stop trusting the suite. A
	 * test whose result depends on machine load is not a test.
	 */
	it('renders a PNG when this host has ffmpeg + a font, else stays null', async () => {
		const available = await isCardRendererAvailable();
		const card = await renderTypographicCard({
			cardText: 'You don’t need a bigger feed. You need a sharper one.',
			brand: { primary: '#101418', secondary: '#E8C468' },
			handle: '@testpersona'
		});
		if (available) {
			expect(card).not.toBeNull();
			// PNG magic bytes — proves a real raster came back, not an empty file.
			expect(card!.buffer.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
			expect(card!.layout).toBe('statement');
		} else {
			expect(card).toBeNull();
		}
	}, 30_000);
});
