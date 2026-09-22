/**
 * The landing page quotes prices in three places — a RECEIPT table, the queue
 * mock and the media-wallet FAQ.
 *
 * History: they were string literals, kept in step with billing-packs' static
 * table by this spec. Two failure modes shipped anyway (2026-09-17: the table
 * and the FAQ disagreed 4×, then $1.58 against "roughly $2.40"), and then a
 * third that no literal-matching test could catch: the STATIC TABLE ITSELF
 * drifted from the live model registry the composer prices from, so the page,
 * the table and this spec all agreed on "$1.58 for a video post" that no
 * format in the product costs (round-2 re-audit: the composer's video formats
 * ran $2.51–$5.84).
 *
 * So the rule is now structural: every price on that page is SERVER DATA from
 * server/outcome-prices.ts — the registry defaults, planned with the
 * composer's own planPipeline() — and never a literal in the markup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planPipeline } from '$lib/formats';

const landing = readFileSync(join(__dirname, '..', '..', 'routes', '+page.svelte'), 'utf8');
const loader = readFileSync(join(__dirname, '..', '..', 'routes', '+page.server.ts'), 'utf8');

/** The source of one `let NAME = $derived(…)` block, up to the next top-level `let`/`const`. */
function block(name: string): string {
	const start = landing.search(new RegExp(`\\b(?:let|const) ${name}\\b`));
	expect(start, `no ${name} block on the landing page`).toBeGreaterThan(-1);
	const rest = landing.slice(start + 1);
	const end = rest.search(/\n\t(?:let|const|function) /);
	return landing.slice(start, start + 1 + (end < 0 ? rest.length : end));
}

describe('landing prices are server data, never literals', () => {
	for (const name of ['RECEIPT', 'QUEUE', 'FAQS']) {
		it(`${name} carries no hard-coded dollar figure`, () => {
			const src = block(name);
			expect(src).toMatch(/data\.receipt\./);
			expect(src, `${name} has a literal price`).not.toMatch(/\$\d/);
		});
	}

	it('the queue mock chip is server data too', () => {
		expect(landing).toMatch(/quoted <span class="lp-num">\{data\.receipt\.video\}<\/span>/);
	});

	it('the loader prices from the registry, per stage, at the platform markup', () => {
		expect(loader).toMatch(/outcomeStepsUsd\(/);
		expect(loader).toMatch(/retailCreditsForStep\(/);
		expect(loader).toMatch(/creditMarkup\(\)/);
	});

	it('the receipt is ordered cheapest first by what it will debit', () => {
		expect(block('RECEIPT')).toMatch(/\.sort\(\(a, b\) => a\.credits - b\.credits\)/);
	});
});

describe('the text-post note is true of the pipeline it names', () => {
	it('"two LLM passes, no image charge" — the text card format is exactly that', () => {
		expect(block('RECEIPT')).toMatch(/two LLM passes, no image charge/);
		const free = { id: 'card', label: 'card', usd: 0, provider: 'local', tier: 'free' as const };
		const llm = { id: 'llm', label: 'llm', usd: 0.012, provider: 'openrouter' };
		const steps = planPipeline({
			formatId: 'text-card',
			options: {},
			fixed: { director: llm, grader: llm, card: free }
		});
		const paid = steps.filter((s) => s.usd > 0).map((s) => s.kind);
		expect(paid).toEqual(['director', 'grader']);
	});
});
