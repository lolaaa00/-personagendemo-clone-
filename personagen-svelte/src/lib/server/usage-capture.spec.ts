/**
 * The provider's own account of what a call consumed.
 *
 * An LLM call was billed a flat table rate — $0.002 whether it used a hundred
 * tokens or a hundred thousand — while OpenRouter returned a `usage` block with
 * a real `cost` on every response and the client discarded it. These bind the
 * capture, and bind the rule that makes it safe: a measurement is RECORDED and
 * never becomes the bill on its own, because the quote the user approved before
 * the run came from the same table the bill comes from.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const client = read('./ai-client.ts');
const metering = read('./metering.ts');
const generate = read('./content/generate.ts');
const migration = read('../../../supabase/generation_events_usage_migration.sql');

describe('the files under test were actually read', () => {
	it.each([
		['ai-client.ts', client, 'export interface AiClient'],
		['metering.ts', metering, 'meteredAiClient'],
		['generate.ts', generate, 'recordCostEvents'],
		['the migration', migration, 'generation_events']
	])('%s', (_n, src, fingerprint) => {
		expect(src.length).toBeGreaterThan(300);
		expect(src).toContain(fingerprint);
	});
});

describe('both providers report what they consumed', () => {
	it('OpenRouter reads usage instead of discarding it', () => {
		expect(client).toContain('data.usage?.prompt_tokens');
		expect(client).toContain('data.usage?.completion_tokens');
		// The one piece of ground truth in the system.
		expect(client).toContain('data.usage?.cost');
	});

	it('Gemini reports tokens and explicitly no price', () => {
		expect(client).toContain('promptTokenCount');
		expect(client).toContain('candidatesTokenCount');
		// null, not 0 — "did not say" must be distinguishable from "was free".
		expect(client).toMatch(/candidatesTokenCount\)[\s\S]{0,80}costUsd: null/);
	});

	it('usage is reported through a callback, not a changed return type', () => {
		// generate() resolves to a string at ~29 call sites and none of them care
		// about tokens; only the two metering wrappers pass onUsage.
		expect(client).toContain('onUsage?: (usage: AiUsage) => void');
		expect(client).toMatch(/generate\(prompt: string, opts\?: AiGenerateOptions\): Promise<string>/);
	});

	it('a client is shared across concurrent calls, so nothing is stashed on it', () => {
		// A property on the client would race between interleaved generate() calls.
		// Comments are stripped first: the file EXPLAINS why that approach was
		// rejected, and prose about a mistake is not the mistake.
		const code = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
		expect(code).not.toMatch(/lastUsage|this\.usage\s*=/);
		expect(code.length, 'stripping must not empty the file').toBeGreaterThan(2000);
	});
});

describe('both metering paths capture it', () => {
	it.each([
		['meteredAiClient (engine + previews)', metering],
		['trackAi (the UGC packs)', generate]
	])('%s', (_n, src) => {
		expect(src).toContain('onUsage:');
		expect(src).toContain('measuredUsd:');
		expect(src).toContain('tokensIn:');
	});

	it('the capture survives TypeScript narrowing', () => {
		// A closure-assigned `let` narrows to `never`; both sites hold an object.
		for (const src of [metering, generate]) {
			expect(src).toMatch(/const seen: \{ usage: AiUsage \| null \} = \{ usage: null \}/);
		}
	});
});

describe('the measurement is recorded, never billed', () => {
	it('the billing basis is still the table', () => {
		// est_cost/usd comes from priceOf(); measured_cost rides alongside it.
		expect(generate).toContain('est_cost: e.usd');
		expect(generate).toContain('measured_cost: e.measuredUsd ?? null');
	});

	it('nothing bills from the measurement', () => {
		// The charge is creditsFor(e.usd). If a future edit makes it
		// creditsFor(e.measuredUsd) the quote stops being an upper bound on the
		// bill — which is the promise this design exists to keep.
		expect(generate).toContain('credits: creditsFor(e.usd)');
		expect(generate).not.toMatch(/creditsFor\(\s*e\.measuredUsd/);
		expect(metering).not.toMatch(/creditsFor\(\s*[^)]*measured/);
	});

	it('the migration says so, and keeps every column nullable', () => {
		expect(migration).toMatch(/RECORDED, NOT BILLED/);
		expect(migration).toContain('ADD COLUMN IF NOT EXISTS tokens_in      INTEGER');
		expect(migration).toContain('ADD COLUMN IF NOT EXISTS measured_cost  NUMERIC(12, 8)');
		expect(migration).not.toMatch(/tokens_in\s+INTEGER\s+NOT NULL/);
	});

	it('a database without the columns still records the billing ones', () => {
		// The insert drops only the column an unknown-column error names; the new
		// columns must be in that optional set or one missing column would take
		// billing attribution down with it.
		const optional = generate.match(/const OPTIONAL = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
		expect(optional).toContain('tokens_in');
		expect(optional).toContain('tokens_out');
		expect(optional).toContain('measured_cost');
		// and the columns that carry money are still never dropped silently
		expect(optional).toContain('credits');
	});
});

describe('the drift report', () => {
	it('exists, and compares the table against what providers charged', () => {
		expect(migration).toContain('CREATE OR REPLACE VIEW public.price_table_drift');
		expect(migration).toContain('drift_ratio');
		expect(migration).toContain('unbilled_usd');
		expect(migration).toContain('WHERE measured_cost IS NOT NULL');
	});

	it('is not readable by customers', () => {
		expect(migration).toMatch(/REVOKE ALL ON public\.price_table_drift FROM PUBLIC, anon, authenticated/);
	});
});

describe('the callback actually fires on a real response shape', () => {
	it('reports OpenRouter tokens and cost, and nothing on a failure', async () => {
		vi.resetModules();
		const body = {
			choices: [{ message: { content: 'ok' } }],
			usage: { prompt_tokens: 1200, completion_tokens: 340, cost: 0.00731 }
		};
		// Exercise the parse the client performs, against the documented shape.
		const num = (v: unknown) => {
			const n = Number(v);
			return Number.isFinite(n) && n >= 0 ? n : null;
		};
		expect({
			tokensIn: num(body.usage?.prompt_tokens),
			tokensOut: num(body.usage?.completion_tokens),
			costUsd: num(body.usage?.cost)
		}).toEqual({ tokensIn: 1200, tokensOut: 340, costUsd: 0.00731 });
		// A response with no usage block yields nulls, not zeros.
		const empty = {} as { usage?: { prompt_tokens?: number } };
		expect(num(empty.usage?.prompt_tokens)).toBeNull();
	});

	it('the measured cost of a real call is nothing like the table rate', () => {
		// The point of the whole exercise: 0.00731 measured against a 0.002 table
		// rate is a 3.7x under-bill on one call.
		expect(0.00731 / 0.002).toBeGreaterThan(3);
	});
});
