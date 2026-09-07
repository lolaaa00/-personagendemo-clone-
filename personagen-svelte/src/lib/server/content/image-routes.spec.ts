/**
 * OpenRouter image routes come from the Model Registry, not a constant.
 *
 * resolveImageKeys() is the single place every image path (composer pack,
 * refine, engine batch) resolves its OpenRouter model. Before this, the id
 * lived in a compiled-in constant and the price in a static table — two
 * sources that drifted ~4x apart (code moved to Nano Banana 2, the table kept
 * billing flux-schnell) with nothing to catch it. These tests pin the contract:
 *   • an active, wired registry row supplies BOTH id and price from one row;
 *   • one multi-mode row serves both text-to-image and editing;
 *   • an empty registry, a discovered-but-unwired row, or a registry read
 *     failure all fall back to exactly today's constants — route selection
 *     must never brick a generation.
 *
 * Same side-effect mocks as prompt-regression.spec.ts so `./generate` imports
 * cleanly; only loadRegistry is stubbed, openRouterRoute is the real thing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { priceOf } from '$lib/pricing';
import type { RegistryRow } from '$lib/server/model-registry';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
// Must resolve (not return undefined): resolveImageKeys chains .catch() on it,
// exactly as production does. A bare vi.fn() here throws before the registry
// logic under test is ever reached.
vi.mock('$lib/server/user-api-keys', () => ({ getUserApiKey: vi.fn(async () => null) }));
vi.mock('$lib/server/ai-client', () => ({ resolveAiClient: vi.fn() }));
vi.mock('$lib/server/db', () => ({ createDbService: vi.fn() }));
vi.mock('$lib/server/service-supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/storage', () => ({
	persistToStorage: vi.fn(),
	persistBufferToStorage: vi.fn()
}));
vi.mock('$lib/server/video', () => ({ burnCaptions: vi.fn(), optimizeForWeb: vi.fn() }));
vi.mock('./card-renderer', () => ({
	renderTypographicCard: vi.fn(),
	CARD_RENDERER_LABEL: 'mock'
}));
vi.mock('$lib/server/social/http', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('$lib/server/budget', () => ({ assertWithinBudget: vi.fn() }));
vi.mock('$lib/server/voices', () => ({
	DEFAULT_VOICE: 'Aria',
	VOICE_CATALOG: [{ name: 'Aria', gender: 'female', accent: 'American' }]
}));
vi.mock('$lib/server/model-registry', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/model-registry')>();
	return { ...actual, loadRegistry: vi.fn() };
});

const { loadRegistry } = await import('$lib/server/model-registry');
const { resolveImageKeys, UGC_IMAGE_MODEL_OPENROUTER } = await import('./generate');

// The compiled-in edit default (IMAGE_EDIT_MODEL_OPENROUTER is module-private).
// With env mocked empty this is what the constant resolves to.
const EDIT_DEFAULT = 'google/gemini-3.1-flash-image';
const STATIC_USD = priceOf('openrouter', 'image');

const supabase = {} as any;

function row(over: Partial<RegistryRow>): RegistryRow {
	return {
		provider: 'openrouter',
		model_id: 'google/gemini-3-pro-image',
		kind: 'image_t2i',
		kinds: ['image_t2i', 'image_edit'],
		wired: true,
		status: 'active',
		deprecated: false,
		price_usd: 0.1548,
		...over
	} as unknown as RegistryRow;
}

beforeEach(() => {
	vi.mocked(loadRegistry).mockReset();
});

describe('resolveImageKeys → OpenRouter image routes', () => {
	it('empty registry: both routes are the compiled-in constants at the static price (today’s behaviour)', async () => {
		vi.mocked(loadRegistry).mockResolvedValue([]);
		const { orRoutes } = await resolveImageKeys(supabase, 'user-1');

		expect(orRoutes.t2i).toEqual({ id: UGC_IMAGE_MODEL_OPENROUTER, usd: STATIC_USD, fromRegistry: false });
		expect(orRoutes.edit).toEqual({ id: EDIT_DEFAULT, usd: STATIC_USD, fromRegistry: false });
	});

	it('an active wired row supplies id AND price together — the drift this exists to prevent', async () => {
		vi.mocked(loadRegistry).mockResolvedValue([row({})]);
		const { orRoutes } = await resolveImageKeys(supabase, 'user-1');

		expect(orRoutes.t2i).toEqual({ id: 'google/gemini-3-pro-image', usd: 0.1548, fromRegistry: true });
		// id and usd came from the SAME row — they cannot disagree.
		expect(orRoutes.t2i.usd).not.toBe(STATIC_USD);
	});

	it('one multi-mode row serves both t2i and edit', async () => {
		vi.mocked(loadRegistry).mockResolvedValue([row({})]);
		const { orRoutes } = await resolveImageKeys(supabase, 'user-1');

		expect(orRoutes.edit).toEqual({ id: 'google/gemini-3-pro-image', usd: 0.1548, fromRegistry: true });
		expect(orRoutes.edit.id).toBe(orRoutes.t2i.id);
	});

	it('a discovered-but-unwired row is ignored — it cannot generate until an adapter ships', async () => {
		vi.mocked(loadRegistry).mockResolvedValue([row({ wired: false, status: 'available' })]);
		const { orRoutes } = await resolveImageKeys(supabase, 'user-1');

		expect(orRoutes.t2i.fromRegistry).toBe(false);
		expect(orRoutes.t2i.id).toBe(UGC_IMAGE_MODEL_OPENROUTER);
	});

	it('a registry read failure falls OPEN to the constants and never throws — route selection is not a money gate', async () => {
		vi.mocked(loadRegistry).mockRejectedValue(new Error('db down'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(resolveImageKeys(supabase, 'user-1')).resolves.toMatchObject({
			orRoutes: {
				t2i: { id: UGC_IMAGE_MODEL_OPENROUTER, usd: STATIC_USD, fromRegistry: false },
				edit: { id: EDIT_DEFAULT, usd: STATIC_USD, fromRegistry: false }
			}
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('Model registry unavailable'),
			'db down'
		);
		warn.mockRestore();
	});
});
