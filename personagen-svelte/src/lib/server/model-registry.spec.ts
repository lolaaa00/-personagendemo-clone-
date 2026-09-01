/**
 * Price parser + effective-catalog tests for the Model Manager registry.
 *
 * The pricing strings are REAL pricingInfoOverride payloads captured from
 * fal's live catalog (2026-08-02) — one per unit family the parser claims to
 * handle. If fal reshapes its prose, these fixtures document what the parser
 * was built against.
 */
import { describe, it, expect } from 'vitest';
import {
	parsePriceText,
	effectiveOptions,
	effectiveResolve,
	openRouterPerCallPrice,
	openRouterKind,
	openRouterRoute
} from './model-registry';
import type { RegistryRow } from './model-registry';
import { modelsFor, DEFAULT_MODEL } from '$lib/models';

/**
 * VERBATIM entries from OpenRouter's live /api/v1/models (2026-09-01). These
 * exist because the first cut of the derivation read `pricing.completion` —
 * the TEXT output rate — and under-priced every image ~20x ($0.0039 vs the
 * true $0.0774). Only `image_output` bills a generated image. If OpenRouter
 * reshapes pricing, these fixtures are what the parser was built against.
 */
const OR_NANO_BANANA_2 = {
	id: 'google/gemini-3.1-flash-image',
	name: 'Google: Nano Banana 2',
	architecture: {
		input_modalities: ['image', 'text'],
		output_modalities: ['image', 'text']
	},
	pricing: {
		prompt: '0.0000005',
		completion: '0.000003',
		image_output: '0.00006',
		web_search: '0.014'
	}
};
const OR_NANO_BANANA_2_LITE = {
	id: 'google/gemini-3.1-flash-lite-image',
	architecture: { input_modalities: ['image', 'text'], output_modalities: ['image', 'text'] },
	pricing: { prompt: '0.00000025', completion: '0.0000015', image_output: '0.00003' }
};
const OR_TEXT_ONLY = {
	id: 'anthropic/claude-fable-5.1',
	architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
	pricing: { prompt: '0.00001', completion: '0.00005' }
};

describe('openRouterPerCallPrice', () => {
	it('prices an image from image_output, NOT the text completion rate', () => {
		const r = openRouterPerCallPrice(OR_NANO_BANANA_2);
		// $60/M x 1290 tokens = $0.0774. Reading `completion` would give $0.0039.
		expect(r.usd).toBeCloseTo(0.0774, 4);
		expect(r.basis).toContain('image-output tokens');
	});

	it('matches the published per-image figure for the Lite tier', () => {
		expect(openRouterPerCallPrice(OR_NANO_BANANA_2_LITE).usd).toBeCloseTo(0.0387, 4);
	});

	it('returns null rather than guessing when an image model has no image_output rate', () => {
		const noRate = { ...OR_NANO_BANANA_2, pricing: { completion: '0.000003' } };
		expect(openRouterPerCallPrice(noRate).usd).toBeNull();
	});

	it('leaves token-billed text models unpriced', () => {
		expect(openRouterPerCallPrice(OR_TEXT_ONLY).usd).toBeNull();
	});
});

describe('openRouterKind', () => {
	it('files a text-capable image model as image_t2i (the still path resolves that kind)', () => {
		expect(openRouterKind(OR_NANO_BANANA_2)).toBe('image_t2i');
	});

	it('files an image-input-only model as a true editor', () => {
		const editOnly = {
			architecture: { input_modalities: ['image'], output_modalities: ['image'] }
		};
		expect(openRouterKind(editOnly)).toBe('image_edit');
	});

	it('ignores text/chat models entirely', () => {
		expect(openRouterKind(OR_TEXT_ONLY)).toBeNull();
	});
});

describe('openRouterRoute', () => {
	const base = {
		provider: 'openrouter',
		kind: 'image_t2i',
		wired: true,
		status: 'active',
		deprecated: false,
		price_usd: 0.0774,
		model_id: 'google/gemini-3.1-flash-image'
	} as unknown as RegistryRow;

	it('prefers an active wired registry row over the compiled-in default', () => {
		const r = openRouterRoute([base], 'image_t2i', 'fallback/model', 0.02);
		expect(r).toMatchObject({ id: 'google/gemini-3.1-flash-image', usd: 0.0774, fromRegistry: true });
	});

	it('falls back to today’s behaviour on an empty registry — never bricks generation', () => {
		const r = openRouterRoute([], 'image_t2i', 'fallback/model', 0.02);
		expect(r).toMatchObject({ id: 'fallback/model', usd: 0.02, fromRegistry: false });
	});

	it('ignores unwired, disabled, deprecated and wrong-provider rows', () => {
		const rows = [
			{ ...base, wired: false },
			{ ...base, status: 'disabled' },
			{ ...base, deprecated: true },
			{ ...base, provider: 'fal' }
		] as unknown as RegistryRow[];
		expect(openRouterRoute(rows, 'image_t2i', 'fallback/model', 0.02).fromRegistry).toBe(false);
	});
});

describe('parsePriceText', () => {
	it('parses per-image pricing (Nano Banana 2)', () => {
		const r = parsePriceText(
			'Your request will cost **$0.08** per image. For **$1.00**, you can run this model **12** times.'
		);
		expect(r.usd).toBe(0.08);
		expect(r.basis).toContain('per image');
	});

	it('parses per-second pricing into a 5s-clip estimate (Kling O3)', () => {
		const r = parsePriceText(
			'For every second of video you generated, you will be charged **$0.084** (audio off) or **$0.112** (audio on).'
		);
		expect(r.usd).toBeCloseTo(0.42, 4);
		expect(r.basis).toContain('5s clip');
	});

	it('parses per-1000-characters pricing (xAI TTS)', () => {
		const r = parsePriceText('Your request will cost **$0.015** per **1000 characters**.');
		expect(r.usd).toBe(0.015);
	});

	it('parses per-megapixel pricing (Ideogram v4)', () => {
		const r = parsePriceText(
			'Your request will cost **$0.0075** per megapixel. For example, a 2048 x 2048 image will cost **$0.03**.'
		);
		expect(r.usd).toBe(0.0075);
	});

	it('refuses token-billed pricing rather than guessing (Gemini Omni Flash)', () => {
		const r = parsePriceText(
			'Billing is based on **total token consumption**. Output tokens cost **$21.875 per 1 million tokens**.'
		);
		expect(r.usd).toBeNull();
		expect(r.basis).toContain('token');
	});

	it('returns null for missing pricing text', () => {
		expect(parsePriceText(null).usd).toBeNull();
		expect(parsePriceText('').usd).toBeNull();
	});
});

function row(over: Partial<RegistryRow>): RegistryRow {
	return {
		id: over.model_id ?? 'x',
		user_id: 'u',
		model_id: 'fal-ai/test',
		kind: 'video_i2v',
		label: 'Test',
		lab: null,
		released_at: null,
		price_usd: 1,
		pricing_text: null,
		price_source: 'seed',
		quality: 5,
		tier: 'balanced',
		latency_s: null,
		status: 'active',
		wired: true,
		is_default: false,
		deprecated: false,
		multi_ref: null,
		supports_audio: null,
		supports_duration: null,
		size_param: null,
		probe: null,
		note: null,
		discovered_at: null,
		created_at: '',
		updated_at: '',
		...over
	} as RegistryRow;
}

describe('effectiveOptions / effectiveResolve', () => {
	const kling = 'fal-ai/kling-video/o3/standard/image-to-video';
	const klingPro = 'fal-ai/kling-video/o3/pro/image-to-video';

	it('falls back to the full static catalog when the registry is empty', () => {
		expect(effectiveOptions([], 'video_i2v')).toEqual(modelsFor('video_i2v'));
		expect(effectiveResolve([], 'video_i2v', null).id).toBe(DEFAULT_MODEL.video_i2v);
	});

	it('falls back to the static catalog when every wired model is disabled (never brickable)', () => {
		const rows = [row({ model_id: kling, status: 'disabled' })];
		expect(effectiveOptions(rows, 'video_i2v').length).toBe(modelsFor('video_i2v').length);
	});

	it('hides disabled models and honors the default star', () => {
		const rows = [
			row({ model_id: kling, status: 'disabled' }),
			row({ model_id: klingPro, status: 'active', is_default: true })
		];
		const opts = effectiveOptions(rows, 'video_i2v');
		expect(opts.map((o) => o.id)).toEqual([klingPro]);
		// A disabled model, even when explicitly requested, resolves to the default.
		expect(effectiveResolve(rows, 'video_i2v', kling).id).toBe(klingPro);
	});

	it('overlays registry price onto static adapter facts', () => {
		const rows = [row({ model_id: kling, price_usd: 0.99 })];
		const opt = effectiveOptions(rows, 'video_i2v')[0];
		expect(opt.usd).toBe(0.99);
		// Adapter facts (audio support) still come from the static catalog.
		expect(opt.supportsAudio).toBe(true);
	});

	it('discovered (unwired) rows never enter the effective catalog', () => {
		const rows = [
			row({ model_id: kling, status: 'active' }),
			row({ model_id: 'minimax/h3/image-to-video', wired: false, status: 'available' })
		];
		expect(effectiveOptions(rows, 'video_i2v').map((o) => o.id)).toEqual([kling]);
	});
});
