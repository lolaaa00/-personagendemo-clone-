import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

const { planCardSet } = await import('./card-set');
const { CURATED_PALETTES } = await import('./card-renderer');

const QUOTES = [
	'Slow is a strategy, not a setback.',
	'1. Wake\n2. Write\n3. Walk',
	'Myth: more hours. Fact: more focus.',
	'Rest is work.',
	'Done is better than perfect.'
];

describe('planCardSet', () => {
	it('skips what the font cannot draw and keeps the original index', () => {
		const plan = planCardSet({ quotes: ['ok', '🔥🔥🔥🔥🔥🔥🔥', '   ', 'fine'], look: 'set' });
		expect(plan.cards.map((c) => c.index)).toEqual([0, 3]);
		expect(plan.skipped.map((s) => s.index)).toEqual([1, 2]);
	});

	it("'same' gives every card one ground and one layout, from the first line when nothing is pinned", () => {
		const plan = planCardSet({ quotes: QUOTES, look: 'same' });
		const grounds = new Set(plan.cards.map((c) => c.brand.primary));
		const layouts = new Set(plan.cards.map((c) => c.layout));
		expect(grounds.size).toBe(1);
		expect(layouts.size).toBe(1);
		expect(plan.cards[0].layout).toBe('statement'); // the first quote's shape
	});

	it("'set' shares the ground but lets each line pick its own layout", () => {
		const plan = planCardSet({ quotes: QUOTES, look: 'set' });
		expect(new Set(plan.cards.map((c) => c.brand.primary)).size).toBe(1);
		expect(plan.cards.every((c) => c.layout === null)).toBe(true);
	});

	it("'unique' rotates the curated grounds card by card", () => {
		const plan = planCardSet({ quotes: QUOTES, look: 'unique' });
		const grounds = plan.cards.map((c) => c.brand.primary);
		expect(new Set(grounds).size).toBe(Math.min(QUOTES.length, CURATED_PALETTES.length));
		for (const g of grounds) expect(CURATED_PALETTES.some((p) => p.bg === g)).toBe(true);
	});

	it('a pinned ground wins over the brand and over the look — even "unique"', () => {
		for (const look of ['same', 'set', 'unique'] as const) {
			const plan = planCardSet({
				quotes: QUOTES,
				look,
				ground: '#123456',
				brand: { primary: '#ABCDEF', secondary: '#000000' }
			});
			expect(plan.cards.every((c) => c.brand.primary === '#123456')).toBe(true);
		}
	});

	it('the brand brief is the shared ground when nothing is pinned', () => {
		const plan = planCardSet({
			quotes: QUOTES,
			look: 'set',
			brand: { primary: '#ABCDEF', secondary: '#000000' }
		});
		expect(plan.cards.every((c) => c.brand.primary === '#ABCDEF')).toBe(true);
		expect(plan.cards[0].brand.secondary).toBe('#000000');
	});

	it('a pinned layout applies to every card in every look', () => {
		for (const look of ['same', 'set', 'unique'] as const) {
			const plan = planCardSet({ quotes: QUOTES, look, layout: 'quote' });
			expect(plan.cards.every((c) => c.layout === 'quote')).toBe(true);
		}
	});

	it('is deterministic — the same input plans the same cards', () => {
		const a = planCardSet({ quotes: QUOTES, look: 'unique' });
		const b = planCardSet({ quotes: QUOTES, look: 'unique' });
		expect(a).toEqual(b);
	});
});
