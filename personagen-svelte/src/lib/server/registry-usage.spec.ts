import { describe, it, expect, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { describeUsage, reconcileLedger, normalizeModelName } from './registry-usage';
import type { RegistryRow } from './model-registry';

function row(over: Partial<RegistryRow>): RegistryRow {
	return {
		id: over.model_id ?? 'x',
		provider: 'fal',
		origin: 'seed',
		kind: 'video_i2v',
		kinds: null,
		wired: true,
		status: 'active',
		is_default: false,
		deprecated: false,
		price_usd: 0.1,
		...over
	} as unknown as RegistryRow;
}

describe('describeUsage — where the pipeline consults a row', () => {
	it('tags the video default with both real call sites and other wired video rows as options', () => {
		const rows = [
			row({ model_id: 'fal-ai/kling-video/o3/standard/image-to-video', is_default: true }),
			row({ model_id: 'fal-ai/wan-i2v' })
		];
		const u = describeUsage(rows);
		expect(
			u.byRowId['fal-ai/kling-video/o3/standard/image-to-video'].map((t) => t.site)
		).toEqual(['b-roll video · composer default', 'autopilot video']);
		expect(u.byRowId['fal-ai/wan-i2v']).toEqual([
			{ site: 'b-roll video · composer option', role: 'option' }
		]);
		expect(u.consultedKinds).toContain('video_i2v');
	});

	it('tts is never consulted: no tags, kind not in consultedKinds, note names the env var', () => {
		const u = describeUsage([
			row({ model_id: 'fal-ai/elevenlabs/tts/turbo-v2.5', kind: 'tts', is_default: true })
		]);
		expect(u.byRowId).toEqual({});
		expect(u.consultedKinds).not.toContain('tts');
		expect(u.kindNotes.tts).toMatch(/UGC_TTS_MODEL/);
	});

	it('a wired OpenRouter multi-mode row is tagged as the route for both image modes', () => {
		const or = row({
			id: 'or-1',
			provider: 'openrouter',
			origin: 'openrouter_catalog',
			model_id: 'google/gemini-3.1-flash-image',
			kind: 'image_t2i',
			kinds: ['image_t2i', 'image_edit'],
			price_usd: 0.0774
		});
		const u = describeUsage([or]);
		expect(u.byRowId['or-1'].map((t) => t.site)).toEqual([
			'OpenRouter image route · UGC pipeline',
			'OpenRouter image-edit route · UGC pipeline'
		]);
	});
});

describe('reconcileLedger — did it actually run?', () => {
	it('matches OpenRouter exactly and fal by normalised label, and lists what ran unlisted', () => {
		const rows = [
			row({ id: 'nb', model_id: 'fal-ai/nano-banana-2', kind: 'image_t2i' }),
			row({
				id: 'or',
				provider: 'openrouter',
				model_id: 'google/gemini-3.1-flash-image',
				kind: 'image_t2i',
				wired: false
			})
		];
		const r = reconcileLedger(
			rows,
			[
				{ provider: 'openrouter', model: 'google/gemini-3.1-flash-image', operation: 'image', est_cost: 0.02 },
				{ provider: 'openrouter', model: 'google/gemini-3.1-flash-image', operation: 'image', est_cost: '0.02' },
				{ provider: 'fal', model: 'Nano Banana 2 (hero portrait)', operation: 'image', est_cost: 0.08 },
				{ provider: 'openrouter', model: 'kwaivgi/kling-v3.0-std', operation: 'video', est_cost: 0.35 },
				{ provider: 'openrouter', model: 'google/gemini-3.5-flash', operation: 'llm', est_cost: 0.002 },
				{ provider: 'storage', model: 'ugc-media', operation: 'persist', est_cost: 0 }
			],
			30
		);
		expect(r.byRowId.or).toEqual({ runs: 2, usd: 0.04, match: 'exact' });
		expect(r.byRowId.nb).toEqual({ runs: 1, usd: 0.08, match: 'name' });
		expect(r.unlisted).toEqual([
			{ provider: 'openrouter', model: 'kwaivgi/kling-v3.0-std', operation: 'video', runs: 1, usd: 0.35 }
		]);
	});

	it('normalises ids and labels to the same bare name', () => {
		expect(normalizeModelName('fal-ai/nano-banana-2')).toBe('nano-banana-2');
		expect(normalizeModelName('Nano Banana 2 (edit) (hero portrait edit)')).toBe('nano-banana-2');
		expect(normalizeModelName('elevenlabs-turbo-v2.5')).toBe('elevenlabs-turbo-v2.5');
	});
});
