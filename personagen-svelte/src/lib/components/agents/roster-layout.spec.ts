/**
 * The persona roster's layout and switch rules, held against the source.
 *
 * Round-2 re-audit: the roster's card layout never switched on for a workspace
 * with no generation spend. The card rule lives in `@container roster`, and a
 * container query adds no specificity — so the one-class `.dash-row` card rule
 * lost to the two-class `.dash-row.no-spend` desktop rule, and persona names
 * rendered 0px wide at 320–390px. The same audit found the Active switch
 * dropping keyboard focus to <body> on every press, because it set `disabled`
 * on itself while the request was in flight.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'AgentRoster.svelte'), 'utf8');
const css = (source.match(/<style>([^]*)<\/style>/)?.[1] ?? '').replace(/[/][*][^]*?[*][/]/g, '');

/** The body of the first `@container roster (…) {` block, by brace matching. */
function containerBlock(text: string): { body: string; start: number; end: number } {
	const start = text.search(/@container\s+roster\s*\([^)]*\)\s*\{/);
	if (start < 0) return { body: '', start: -1, end: -1 };
	const open = text.indexOf('{', start);
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}' && --depth === 0) return { body: text.slice(open + 1, i), start, end: i + 1 };
	}
	return { body: '', start: -1, end: -1 };
}

/** Selectors of every rule in `text` whose declarations set grid-template-columns. */
function gridSelectors(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (!/grid-template-columns\s*:/.test(m[2])) continue;
		for (const sel of m[1].split(',')) out.push(sel.trim().replace(/\s+/g, ' '));
	}
	return out;
}

describe('roster card layout (container query)', () => {
	const block = containerBlock(css);
	const outside = css.slice(0, block.start) + css.slice(block.end);

	it('has a card layout at all', () => {
		expect(block.body.length).toBeGreaterThan(0);
	});

	it('names every desktop grid selector, so none out-ranks it', () => {
		const desktop = gridSelectors(outside);
		const card = gridSelectors(block.body);
		// The sample must be real: the desktop grid and its no-spend variant.
		expect(desktop.length).toBeGreaterThanOrEqual(2);
		expect(desktop).toContain('.dash-row.no-spend');
		const missing = desktop.filter((sel) => !card.includes(sel));
		expect(missing).toEqual([]);
	});

	it('takes the clipped header select-all out of the tab order', () => {
		expect(block.body).toMatch(/\.pick-all\s*\{[^}]*visibility\s*:\s*hidden/);
	});
});

describe('Active switch keeps keyboard focus', () => {
	const switches = [...source.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);

	it('exists', () => {
		expect(switches.length).toBeGreaterThan(0);
	});

	it('is never `disabled` (that drops focus to <body>) — aria-disabled instead', () => {
		for (const tag of switches) {
			expect(tag).not.toMatch(/\sdisabled=/);
			expect(tag).toMatch(/aria-disabled=/);
		}
	});
});
