/**
 * Which stage of a run made each LLM call.
 *
 * Every text call recorded `model: gemini-3.5-flash`, so the token capture could
 * say a call emitted 1,500 output tokens and nothing could say which stage did
 * it. Reasoning from token shapes alone guessed the wrong stage (the grader; it
 * was the director and its retries). A retry or rewrite regenerates the entire
 * script — a post paying for its script twice — and nothing recorded the rate.
 *
 * These bind the attribution: a closed set of stage names, every pack call
 * tagged, both wrappers copying the tag, the ledger persisting it, and the view
 * that turns it into a per-stage answer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./budget', () => ({ assertWithinBudget: vi.fn(async () => {}) }));
vi.mock('./content/generate', () => ({ recordCostEvents: vi.fn(async () => {}) }));
const record = await import('./content/generate');
const { meteredAiClient } = await import('./metering');

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8');
const generate = read('./content/generate.ts');
const metering = read('./metering.ts');
const client = read('./ai-client.ts');
const engine = read('../../routes/api/engine/+server.ts');
const migration = read('../../../supabase/generation_events_stage_migration.sql');

/** The closed set. Adding a stage means adding it here, on purpose. */
const STAGES = [
	'director',
	'director_retry_hook',
	'director_rewrite_qc',
	'director_retry_shots',
	'qc_grade',
	'fit_judge'
];

describe('the files under test were actually read', () => {
	it.each([
		['generate.ts', generate, 'function trackAi'],
		['metering.ts', metering, 'meteredAiClient'],
		['ai-client.ts', client, 'export interface AiGenerateOptions'],
		['engine route', engine, 'meteredAiClient('],
		['the migration', migration, 'llm_stage_usage']
	])('%s', (_n, src, fp) => {
		expect(src.length).toBeGreaterThan(300);
		expect(src).toContain(fp);
	});
});

describe('the option exists and both wrappers honour it', () => {
	it('is a per-call option, because one tracked client serves every stage of a pack', () => {
		expect(client).toMatch(/stage\?: string;/);
	});
	it('trackAi copies the call stage onto the event', () => {
		const at = generate.indexOf('function trackAi');
		expect(at).toBeGreaterThan(0);
		expect(generate.slice(at, at + 1200)).toContain('stage: opts?.stage ?? null');
	});
	it('meteredAiClient prefers the call stage and falls back to the scope default', () => {
		expect(metering).toContain('stage: opts?.stage ?? scope.stage ?? null');
	});
});

describe('every stage name in the code is from the closed set', () => {
	it('generate.ts uses only known stages', () => {
		const used = [...generate.matchAll(/stage: '([a-z_]+)'/g)].map((m) => m[1]);
		expect(used.length, 'no tags found — the scan is vacuous').toBeGreaterThanOrEqual(9);
		for (const s of used) expect(STAGES, `unknown stage '${s}'`).toContain(s);
	});
	it('the migration comment documents the same set', () => {
		for (const s of STAGES) expect(migration).toContain(s);
	});
});

describe('every LLM call in the pack path is attributed', () => {
	// In each pack function the number of ai.generate( calls must equal the number
	// of stage tags. A new untagged call in either pack fails here.
	const fn = (name: string) => {
		const i = generate.indexOf(`export async function ${name}(`);
		expect(i, `${name} not found`).toBeGreaterThan(0);
		const next = generate.indexOf('\nexport ', i + 10);
		return generate.slice(i, next > 0 ? next : undefined);
	};
	it.each(['generateUgcPack', 'generateCinematicUgcPack'])('%s: calls == tags', (name) => {
		const body = fn(name);
		const calls = (body.match(/ai\.generate\(/g) ?? []).length;
		const tags = (body.match(/stage: '/g) ?? []).length;
		expect(calls, `${name} has no generate calls — vacuous`).toBeGreaterThan(0);
		expect(tags).toBe(calls);
	});
	it('the quality grader tags itself, covering both packs at once', () => {
		expect(generate).toMatch(
			/\{ systemInstruction: GRADER_SYSTEM, json: true, stage: 'qc_grade'[^}]*\}/
		);
	});
	it('the fit judge tags its wrapper', () => {
		expect(generate).toMatch(/meteredAiClient\(run\.ai, \{\s*stage: 'fit_judge'/);
	});
	it('the engine tags every action with its name', () => {
		expect(engine).toContain('stage: `engine:${String(action');
	});
});

describe('the ledger persists it', () => {
	it('recordCostEvents writes the column and can drop it on an unmigrated database', () => {
		expect(generate).toContain('stage: e.stage ?? null,');
		const optional = generate.match(/const OPTIONAL = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
		expect(optional).toContain("'stage'");
		expect(optional, 'the money columns must still be in the same set').toContain("'credits'");
	});
	it('the migration adds the column, the view, and hides the view from customers', () => {
		expect(migration).toContain('ADD COLUMN IF NOT EXISTS stage TEXT');
		expect(migration).toContain('CREATE OR REPLACE VIEW public.llm_stage_usage');
		expect(migration).toContain("WHERE operation = 'llm' AND stage IS NOT NULL");
		expect(migration).toMatch(
			/REVOKE ALL ON public\.llm_stage_usage FROM PUBLIC, anon, authenticated/
		);
	});
});

describe('at runtime the wrapper records the stage it was told', () => {
	const scope = { supabase: {}, userId: 'u1', agentId: null, postId: null };
	beforeEach(() => vi.mocked(record.recordCostEvents).mockClear());
	const raw = () => ({
		provider: 'openrouter' as const,
		model: 'm',
		generate: vi.fn(async () => 'ok')
	});
	const stageOf = () => {
		const [, , , events] = vi.mocked(record.recordCostEvents).mock.calls[0] as unknown as [
			unknown,
			unknown,
			unknown,
			Array<{ stage?: string | null }>
		];
		return events[0].stage;
	};
	it('per-call stage wins', async () => {
		await meteredAiClient(raw(), { ...scope, stage: 'engine:x' })!.generate('p', {
			stage: 'fit_judge'
		});
		expect(stageOf()).toBe('fit_judge');
	});
	it('falls back to the scope default', async () => {
		await meteredAiClient(raw(), { ...scope, stage: 'engine:save_brief' })!.generate('p');
		expect(stageOf()).toBe('engine:save_brief');
	});
	it('is null, not undefined or a guess, when neither is given', async () => {
		await meteredAiClient(raw(), scope)!.generate('p');
		expect(stageOf()).toBeNull();
	});
});
