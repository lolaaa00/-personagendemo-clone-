/**
 * Static catalog invariants.
 *
 * The catalog is the only thing standing between a picker selection and a model
 * id posted to a provider, so the things that can break silently are pinned
 * here: a default that names nothing (a runtime `undefined` model id is a 404
 * the user pays latency for), a default that names the wrong kind's model, and
 * an unknown id reaching a provider instead of falling back.
 *
 * Written against the catalog itself rather than a hand-kept list of kinds, so
 * adding a kind without a default fails here instead of at generation time.
 */
import { describe, it, expect } from 'vitest';
import {
	MODEL_CATALOG,
	DEFAULT_MODEL,
	getModel,
	modelsFor,
	resolveModel,
	type ModelKind
} from './models';

const CATALOG_KINDS = [...new Set(MODEL_CATALOG.map((m) => m.kind))];

describe('DEFAULT_MODEL is exhaustive and points at real entries', () => {
	it('every kind in the catalog has a default that exists and is of that kind', () => {
		for (const kind of CATALOG_KINDS) {
			const id = DEFAULT_MODEL[kind];
			expect(id, `${kind} has no default model`).toBeTruthy();
			expect(getModel(id)?.kind, `${kind}'s default ${id} is missing or filed elsewhere`).toBe(
				kind
			);
		}
	});

	it('has no entry for a kind the catalog dropped', () => {
		// The Record<ModelKind, string> type catches a MISSING key at compile
		// time; this catches the other direction — a stale key naming a kind that
		// no longer ships any model, whose default would resolve to undefined.
		expect(Object.keys(DEFAULT_MODEL).sort()).toEqual([...CATALOG_KINDS].sort());
	});

	it('keeps the two new stages on the models they run on today', () => {
		// TALKINGHEAD_MODEL (content/generate.ts) and OPENROUTER_GEMINI_MODEL
		// (server/ai-client.ts). Selecting nothing must change nothing.
		expect(DEFAULT_MODEL.talking_head).toBe('fal-ai/bytedance/omnihuman');
		expect(DEFAULT_MODEL.llm).toBe('google/gemini-3.5-flash');
	});
});

describe('resolveModel — an unknown id must never reach a provider', () => {
	for (const kind of ['talking_head', 'llm'] as ModelKind[]) {
		it(`${kind}: honors a real request`, () => {
			const wanted = modelsFor(kind).find((m) => m.id !== DEFAULT_MODEL[kind])!;
			expect(resolveModel(kind, wanted.id).id).toBe(wanted.id);
		});

		it(`${kind}: falls back to the default for an unknown id`, () => {
			expect(resolveModel(kind, 'fal-ai/not-a-real-model').id).toBe(DEFAULT_MODEL[kind]);
			expect(resolveModel(kind, null).id).toBe(DEFAULT_MODEL[kind]);
		});

		it(`${kind}: refuses an id belonging to another stage`, () => {
			// A composer that mixes up two per-stage pickers would otherwise post a
			// video model to the talking-head endpoint.
			expect(resolveModel(kind, DEFAULT_MODEL.video_i2v).id).toBe(DEFAULT_MODEL[kind]);
		});
	}
});

describe('modelsFor', () => {
	it('returns every talking-head option, cheapest first', () => {
		const ids = modelsFor('talking_head').map((m) => m.id);
		expect(ids).toEqual([
			'fal-ai/kling-video/ai-avatar/v2/standard',
			'fal-ai/bytedance/omnihuman',
			'veed/fabric-1.0'
		]);
	});

	it('offers the director LLM on the providers resolveAiClient can actually build', () => {
		const providers = new Set(modelsFor('llm').map((m) => m.provider));
		expect([...providers].sort()).toEqual(['gemini', 'openrouter']);
	});

	it('never returns an entry filed under a different kind', () => {
		for (const kind of CATALOG_KINDS) {
			expect(modelsFor(kind).every((m) => m.kind === kind)).toBe(true);
		}
	});
});
