/**
 * How much the model may think, and how much it did.
 *
 * The stage view said the quality grader emitted ~1,100 output tokens per call
 * for a 7-field JSON grade about 90 tokens long. One probe call on 2026-09-17
 * explained it: completion_tokens 1,054, reasoning_tokens 950. Gemini 3.5
 * Flash thinks by default and the thinking is billed as output, so 90% of the
 * grader's cost was deliberation over a weighted sum whose weights are in the
 * prompt. The same call at effort=minimal: 148 tokens, 0 reasoning, a valid
 * grade, $0.0018 against $0.0099. Thinking cannot be switched off on that
 * endpoint ("Reasoning is mandatory … cannot be disabled"), only budgeted.
 *
 * These bind three things: the per-call budget reaches both providers in
 * their own spelling and only when asked; both providers' reports of the
 * split reach the ledger with one meaning; and the grader asks for the least.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const { mockEnv, generateContent } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string>,
	generateContent: vi.fn()
}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./user-api-keys', () => ({ getUserApiKey: vi.fn(async () => null) }));
vi.mock('./social/http', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('@google/genai', () => ({
	GoogleGenAI: class {
		models = { generateContent };
	}
}));
const http = await import('./social/http');
const { resolveAiClient, REASONING_EFFORTS } = await import('./ai-client');

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const client = read('./ai-client.ts');
const metering = read('./metering.ts');
const generate = read('./content/generate.ts');
const pricing = read('../pricing.ts');
const migration = read('../../../supabase/generation_events_reasoning_migration.sql');
const sdk = read('../../../node_modules/@google/genai/dist/genai.d.ts');

describe('the files under test were actually read', () => {
	it.each([
		['ai-client.ts', client, 'export interface AiGenerateOptions'],
		['metering.ts', metering, 'meteredAiClient'],
		['generate.ts', generate, 'function graderReasoning'],
		['pricing.ts', pricing, 'export interface CostEvent'],
		['the migration', migration, 'tokens_reasoning'],
		['the Gemini SDK types', sdk, 'export declare enum ThinkingLevel']
	])('%s', (_n, src, fp) => {
		expect(src.length).toBeGreaterThan(300);
		expect(src).toContain(fp);
	});
});

describe('the budget is a level both providers understand', () => {
	it('is a per-call option, because one client serves every stage of a pack', () => {
		expect(client).toMatch(/reasoning\?: ReasoningEffort;/);
	});

	it('offers exactly the four levels, ascending, and never "none"', () => {
		// 'none' is what a caller would reach for to switch thinking off, and the
		// Gemini endpoint rejects it — an option that cannot work must not exist.
		expect([...REASONING_EFFORTS]).toEqual(['minimal', 'low', 'medium', 'high']);
	});

	it('each level, upper-cased, is a member of the SDK ThinkingLevel enum', () => {
		// The direct client sends opts.reasoning.toUpperCase(); if Google renames a
		// level the SDK types change and this is where it shows.
		const at = sdk.indexOf('export declare enum ThinkingLevel');
		const block = sdk.slice(at, sdk.indexOf('}', at));
		for (const level of REASONING_EFFORTS) {
			expect(block, `ThinkingLevel.${level.toUpperCase()}`).toContain(
				`${level.toUpperCase()} = "${level.toUpperCase()}"`
			);
		}
	});

	it('both clients send it only when asked — unset is the provider default', () => {
		expect(client).toContain('if (opts?.reasoning) {');
		expect(client).toContain('body.reasoning = { effort: opts.reasoning };');
		expect(client).toContain('config.thinkingConfig = { thinkingLevel: opts.reasoning.toUpperCase() };');
	});
});

describe('both providers report the split, with one meaning', () => {
	it('OpenRouter: reasoning_tokens, which sit inside completion_tokens', () => {
		expect(client).toContain('data.usage?.completion_tokens_details?.reasoning_tokens');
	});

	it('Gemini: thoughtsTokenCount, folded INTO tokensOut because Google reports it apart', () => {
		expect(client).toContain('num(um?.thoughtsTokenCount)');
		expect(client).toContain('tokensOut: billedOutput(num(um?.candidatesTokenCount), thoughts)');
	});

	it('both metering wrappers copy it onto the event', () => {
		for (const src of [metering, generate]) {
			expect(src).toContain('tokensReasoning: seen.usage?.tokensReasoning ?? null');
		}
		expect(pricing).toMatch(/tokensReasoning\?: number \| null;/);
	});
});

describe('the ledger persists it, and never bills it', () => {
	it('recordCostEvents writes the column and can drop it on an unmigrated database', () => {
		expect(generate).toContain('tokens_reasoning: e.tokensReasoning ?? null,');
		const optional = generate.match(/const OPTIONAL = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
		expect(optional).toContain("'tokens_reasoning'");
		expect(optional, 'the money columns must still be in the same set').toContain("'credits'");
	});

	it('nothing bills from it', () => {
		expect(generate).toContain('credits: creditsFor(e.usd)');
		expect(generate).not.toMatch(/creditsFor\([^)]*tokensReasoning/);
		expect(migration).toMatch(/RECORDED, NOT BILLED/);
	});

	it('the migration adds a nullable column and rebuilds the view with the share', () => {
		expect(migration).toContain('ADD COLUMN IF NOT EXISTS tokens_reasoning INTEGER');
		expect(migration).not.toMatch(/tokens_reasoning\s+INTEGER\s+NOT NULL/);
		// dropped and recreated: CREATE OR REPLACE may only append columns
		expect(migration).toContain('DROP VIEW IF EXISTS public.llm_stage_usage;');
		expect(migration).toContain('CREATE VIEW public.llm_stage_usage AS');
		expect(migration).toContain('AS avg_tokens_reasoning');
		expect(migration).toContain('AS reasoning_share');
		// the share is over calls that reported the split, never over all rows
		expect(migration).toMatch(/FILTER \(WHERE tokens_reasoning IS NOT NULL\)/);
	});

	it('a dropped view loses its grants, so the REVOKE is restated', () => {
		const drop = migration.indexOf('DROP VIEW IF EXISTS public.llm_stage_usage');
		const revoke = migration.indexOf('REVOKE ALL ON public.llm_stage_usage FROM PUBLIC, anon, authenticated');
		expect(drop).toBeGreaterThan(0);
		expect(revoke).toBeGreaterThan(drop);
	});
});

describe('the grader asks for the least', () => {
	it('the qc_grade call carries the budget', () => {
		expect(generate).toMatch(
			/\{ systemInstruction: GRADER_SYSTEM, json: true, stage: 'qc_grade', reasoning: graderReasoning\(\) \}/
		);
	});

	it("defaults to 'minimal', can be overridden without a deploy, and cannot be set to junk", () => {
		const at = generate.indexOf('function graderReasoning');
		const body = generate.slice(at, generate.indexOf('\n}', at));
		expect(body).toContain('env.UGC_GRADER_REASONING');
		expect(body).toContain("if (raw === 'provider') return undefined;");
		expect(body).toContain("REASONING_EFFORTS as readonly string[]).includes(raw)");
		expect(body).toMatch(/: 'minimal';\s*$/);
	});

	it('the numbers that decided it', () => {
		// One grader call, three levels, same draft (2026-09-17, OpenRouter,
		// google/gemini-3.5-flash). Kept here so the decision can be re-argued
		// from what was measured rather than from memory.
		const measured = {
			provider_default: { completion: 1054, reasoning: 950, usd: 0.00993 },
			low: { completion: 584, reasoning: 451, usd: 0.0057 },
			minimal: { completion: 148, reasoning: 0, usd: 0.00178 }
		};
		expect(measured.provider_default.reasoning / measured.provider_default.completion).toBeGreaterThan(0.85);
		expect(measured.minimal.usd / measured.provider_default.usd).toBeLessThan(0.2);
	});
});

describe('at runtime, against the real response shapes', () => {
	const supabase = {};
	beforeEach(() => {
		for (const k of Object.keys(mockEnv)) delete mockEnv[k];
		vi.mocked(http.fetchWithTimeout).mockReset();
		generateContent.mockReset();
	});

	const orResponse = (usage: unknown) =>
		({ ok: true, json: async () => ({ choices: [{ message: { content: '{"overall":6}' } }], usage }) }) as unknown as Response;
	const sentBody = () => JSON.parse(vi.mocked(http.fetchWithTimeout).mock.calls[0][1]!.body as string);

	it('OpenRouter: sends reasoning.effort when asked, and reports 0 reasoning as 0, not null', async () => {
		mockEnv.OPENROUTER_API_KEY = 'k';
		vi.mocked(http.fetchWithTimeout).mockResolvedValue(
			orResponse({ prompt_tokens: 355, completion_tokens: 148, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0.00178 })
		);
		const ai = await resolveAiClient(supabase, 'u1');
		expect(ai?.provider).toBe('openrouter');
		const seen: { usage: unknown } = { usage: null };
		await ai!.generate('grade it', { reasoning: 'minimal', onUsage: (u) => (seen.usage = u) });
		expect(sentBody().reasoning).toEqual({ effort: 'minimal' });
		expect(seen.usage).toEqual({ tokensIn: 355, tokensOut: 148, costUsd: 0.00178, tokensReasoning: 0 });
	});

	it('OpenRouter: sends no reasoning key when not asked, and reports null when the provider is silent', async () => {
		mockEnv.OPENROUTER_API_KEY = 'k';
		vi.mocked(http.fetchWithTimeout).mockResolvedValue(
			orResponse({ prompt_tokens: 1364, completion_tokens: 1430, cost: 0.01492 })
		);
		const ai = await resolveAiClient(supabase, 'u1');
		const seen: { usage: unknown } = { usage: null };
		await ai!.generate('write it', { onUsage: (u) => (seen.usage = u) });
		expect('reasoning' in sentBody()).toBe(false);
		expect(seen.usage).toEqual({ tokensIn: 1364, tokensOut: 1430, costUsd: 0.01492, tokensReasoning: null });
	});

	it('Gemini: sends the SDK spelling, and folds thoughts into tokensOut', async () => {
		mockEnv.GEMINI_API_KEY = 'g';
		generateContent.mockResolvedValue({
			text: '{"overall":6}',
			usageMetadata: { promptTokenCount: 355, candidatesTokenCount: 92, thoughtsTokenCount: 950 }
		});
		const ai = await resolveAiClient(supabase, 'u1');
		expect(ai?.provider).toBe('gemini');
		const seen: { usage: unknown } = { usage: null };
		await ai!.generate('grade it', { reasoning: 'low', onUsage: (u) => (seen.usage = u) });
		expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
		// 92 answer + 950 thinking = 1042 billed as output — the OpenRouter meaning
		expect(seen.usage).toEqual({ tokensIn: 355, tokensOut: 1042, costUsd: null, tokensReasoning: 950 });
	});

	it('Gemini: without thoughts reported, tokensOut is the answer alone and reasoning is null', async () => {
		mockEnv.GEMINI_API_KEY = 'g';
		generateContent.mockResolvedValue({
			text: 'ok',
			usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 }
		});
		const ai = await resolveAiClient(supabase, 'u1');
		const seen: { usage: unknown } = { usage: null };
		await ai!.generate('p', { onUsage: (u) => (seen.usage = u) });
		expect(generateContent.mock.calls[0][0].config.thinkingConfig).toBeUndefined();
		expect(seen.usage).toEqual({ tokensIn: 10, tokensOut: 20, costUsd: null, tokensReasoning: null });
	});
});
