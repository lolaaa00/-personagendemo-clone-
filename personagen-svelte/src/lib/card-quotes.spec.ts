import { describe, it, expect } from 'vitest';
import { parseQuotes, quoteProblem, MAX_QUOTE_CHARS, MAX_CARD_QUOTES, CARD_LOOKS } from './card-quotes';

describe('parseQuotes', () => {
	it('one line = one quote when there are no blank lines', () => {
		expect(parseQuotes('Slow is a strategy.\nRest is work.\nDone is better.')).toEqual([
			'Slow is a strategy.',
			'Rest is work.',
			'Done is better.'
		]);
	});

	it('a whitespace-only line is a blank line', () => {
		expect(parseQuotes('Slow is a strategy.\nRest is work.\n  \nDone is better.')).toEqual([
			'Slow is a strategy.\nRest is work.',
			'Done is better.'
		]);
	});

	it('a stray blank line in a long one-per-line list does not merge the list into two cards', () => {
		const many = Array.from({ length: 30 }, (_, i) => `Quote ${i}`);
		const raw = [...many.slice(0, 12), '', ...many.slice(12)].join('\n');
		expect(parseQuotes(raw)).toEqual(many);
	});

	it('blank lines separate quotes and a quote keeps its own line breaks', () => {
		const raw = 'Myth: more hours.\nFact: more focus.\n\nOne thing at a time.\n\n\n1. Wake\n2. Write\n3. Walk';
		expect(parseQuotes(raw)).toEqual([
			'Myth: more hours.\nFact: more focus.',
			'One thing at a time.',
			'1. Wake\n2. Write\n3. Walk'
		]);
	});

	it('trims, collapses inner whitespace, drops empties, keeps order and duplicates', () => {
		expect(parseQuotes('  a   b  \r\n\r\n a   b \r\n')).toEqual(['a b', 'a b']);
		expect(parseQuotes('')).toEqual([]);
		expect(parseQuotes('   \n \n')).toEqual([]);
	});

	it('never truncates — the count the user sees is the count they typed', () => {
		const many = Array.from({ length: MAX_CARD_QUOTES + 5 }, (_, i) => `Quote ${i}`).join('\n');
		expect(parseQuotes(many)).toHaveLength(MAX_CARD_QUOTES + 5);
	});
});

describe('quoteProblem', () => {
	it('accepts an ordinary quote with typographic punctuation', () => {
		expect(quoteProblem('“Don’t wait” — start… ×3')).toBeNull();
	});
	it('flags a quote over the renderer’s length cap', () => {
		expect(quoteProblem('x'.repeat(MAX_QUOTE_CHARS + 1))).toMatch(/characters/);
	});
	it('flags a quote the card font cannot draw', () => {
		expect(quoteProblem('🔥🔥🔥🔥🔥🔥 go')).toMatch(/cannot draw/);
	});
});

describe('CARD_LOOKS', () => {
	it('offers exactly the three looks the server plans', () => {
		expect(CARD_LOOKS.map((l) => l.id)).toEqual(['set', 'same', 'unique']);
	});
});
