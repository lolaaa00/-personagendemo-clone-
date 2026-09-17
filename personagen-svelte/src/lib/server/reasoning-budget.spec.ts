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
		expect(generate).toContain("reasoningFromEnv(env.UGC_GRADER_REASONING, 'minimal')");
		const at = generate.indexOf('function reasoningFromEnv');
		const body = generate.slice(at, generate.indexOf('\n}', at));
		expect(body).toContain("if (raw === 'provider') return undefined;");
		expect(body).toContain("REASONING_EFFORTS as readonly string[]).includes(raw)");
		// junk falls to the CALLER's fallback — a typo can never pick a level
		expect(body).toMatch(/: fallback;\s*$/);
	});
});

describe('the director has the same knob, and it is off', () => {
	// Production, 2026-09-17, once tokens_reasoning was live: the director spent
	// 1,655 of 1,922 output tokens thinking (86%, $0.015 of $0.019); the profile
	// generator 85%. The script is the product — this stays the provider default
	// until measured on real traffic; the knob is what makes that measurable.
	it('the numbers: most of the director call is thinking', () => {
		expect(1655 / 1922).toBeGreaterThan(0.85);
	});

	it('defaults to the provider — unchanged behaviour — and reads its own variable', () => {
		expect(generate).toContain('reasoningFromEnv(env.UGC_DIRECTOR_REASONING, undefined)');
	});

	it('every director-stage call carries it, in both packs', () => {
		const tags = generate.match(/stage: 'director(?:_[a-z_]+)?'/g) ?? [];
		const knobs = generate.match(/reasoning: directorReasoning\(\)/g) ?? [];
		expect(tags.length, 'expected the seven director-stage sites').toBe(7);
		expect(knobs.length).toBe(tags.length);
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

describe('the gate is confirmed where it is a coin flip', () => {
	// 8 real drafts, 2026-09-17: the provider default graded the SAME draft
	// twice and disagreed on the floor-5 gate 2/8 times (score sd 1.04);
	// 'low' vs default 6/8 (+0.81), 'minimal' vs default 5/8 (+1.10). The level
	// is not the lever; a single call at the boundary is.
	const measured = {
		default_retest: { agree: 6, of: 8, sd: 1.04 },
		low_vs_default: { agree: 6, of: 8, shift: 0.81, usd: 0.0057 },
		minimal_vs_default: { agree: 5, of: 8, shift: 1.1, usd: 0.0017 }
	};

	it("the numbers that decided it: 'low' buys no agreement the default does not already lack", () => {
		expect(measured.low_vs_default.agree).toBe(measured.default_retest.agree);
		expect(measured.low_vs_default.usd / measured.minimal_vs_default.usd).toBeGreaterThan(3);
	});

	it('the band is the measured noise, and the wrapper takes the floor it confirms against', () => {
		expect(generate).toMatch(/const GRADE_CONFIRM_BAND = 1;/);
		expect(generate).toMatch(/async function gradeDraftWithRetry\([\s\S]{0,300}floor: number\s*\)/);
		expect(generate).toContain('Math.abs(grade.overall - floor) < GRADE_CONFIRM_BAND');
		expect(generate).toContain('grade = confirmed;');
	});

	it('floor 0 disables the confirmation along with the gate', () => {
		expect(generate).toContain('if (floor > 0 && Math.abs(grade.overall - floor) < GRADE_CONFIRM_BAND)');
	});

	it('every gate decision in both packs goes through the confirming wrapper', () => {
		// First grade and post-rewrite regrade, standard and cinematic: four sites.
		const calls = generate.match(/await gradeDraftWithRetry\(/g) ?? [];
		expect(calls.length, 'expected the four gate sites').toBe(4);
		// and nothing decides a gate on a bare, unconfirmed grade any more
		expect(generate).not.toMatch(/const regrade = await gradeDraft\(/);
		// each site passes its own floor
		expect(generate).toMatch(/platform,\s*cinematicFloor\s*\)/);
		expect(generate).toMatch(/platform,\s*floor\s*\)/);
	});

	it('the critique travels with the lower grade, so a rewrite fixes the worse reading', () => {
		expect(generate).toContain('const lower = a.overall <= b.overall ? a : b;');
		expect(generate).toContain('topIssue: lower.topIssue');
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
