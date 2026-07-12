/**
 * Selectable generation models — the budget-vs-quality control.
 *
 * Every entry here was verified against fal's live OpenAPI spec
 * (fal.ai/api/openapi/queue/openapi.json?endpoint_id=…) rather than from memory,
 * because these endpoints do NOT share a request shape and guessing is how you
 * ship a model that 500s on first use:
 *
 *   - flux / qwen text-to-image take `image_size`
 *   - nano-banana-2 text-to-image takes `aspect_ratio` (+ `resolution`)
 *   - nano-banana-2/edit takes `image_urls` (PLURAL — true multi-reference)
 *   - flux-pro/kontext and qwen-image-edit take `image_url` (SINGULAR — one ref only)
 *
 * That last one matters: the reference-kit stages pass two references (the shot
 * plus the character sheet). A single-ref editor silently drops the sheet, so it
 * is flagged `multiRef: false` and the UI warns instead of quietly degrading
 * character consistency.
 *
 * Client-safe (no $env / server imports) so the composer and the server read the
 * same catalog and can't disagree about what a model costs or accepts.
 */

export type ModelKind = 'image_t2i' | 'image_edit' | 'video_i2v';
export type QualityTier = 'budget' | 'balanced' | 'premium';

export interface ModelOption {
	id: string;
	label: string;
	provider: 'fal';
	kind: ModelKind;
	tier: QualityTier;
	/** Estimated USD per call. Providers don't return uniform per-call costs. */
	usd: number;
	/** How the model names its size/shape parameter. */
	sizeParam?: 'image_size' | 'aspect_ratio' | 'none';
	/** Edit models only: can it accept more than one reference image? */
	multiRef?: boolean;
	/** Shown in the picker so the tradeoff is explicit, not implied by price alone. */
	note: string;
	/** Surfaced as a warning when the model can't do what the step wants. */
	caveat?: string;
	/** video_i2v only — verified per endpoint; fal 422s on params a model doesn't declare. */
	supportsAudio?: boolean;
	supportsDuration?: boolean;
}

export const MODEL_CATALOG: ModelOption[] = [
	// ── Text-to-image: profile portraits, scene stills ──────────────────────
	{
		id: 'fal-ai/flux/schnell',
		label: 'FLUX Schnell',
		provider: 'fal',
		kind: 'image_t2i',
		tier: 'budget',
		usd: 0.003,
		sizeParam: 'image_size',
		note: 'Fastest and ~25x cheaper. Good for drafts; weakest at photoreal faces.'
	},
	{
		id: 'fal-ai/qwen-image',
		label: 'Qwen Image',
		provider: 'fal',
		kind: 'image_t2i',
		tier: 'budget',
		usd: 0.02,
		sizeParam: 'image_size',
		note: 'Cheap with better prompt adherence than Schnell.'
	},
	{
		id: 'fal-ai/flux/dev',
		label: 'FLUX Dev',
		provider: 'fal',
		kind: 'image_t2i',
		tier: 'balanced',
		usd: 0.025,
		sizeParam: 'image_size',
		note: 'Noticeably better detail and skin texture than Schnell.'
	},
	{
		id: 'fal-ai/flux-pro/v1.1',
		label: 'FLUX Pro 1.1',
		provider: 'fal',
		kind: 'image_t2i',
		tier: 'premium',
		usd: 0.04,
		sizeParam: 'image_size',
		note: 'Strong photorealism. A good default for a face you will reuse.'
	},
	{
		id: 'fal-ai/nano-banana-2',
		label: 'Nano Banana 2',
		provider: 'fal',
		kind: 'image_t2i',
		tier: 'premium',
		usd: 0.08,
		sizeParam: 'aspect_ratio',
		note: 'Highest fidelity. Best when this image becomes the pinned character.'
	},

	// ── Image edit: reference kit, product compositing ──────────────────────
	{
		id: 'fal-ai/nano-banana-2/edit',
		label: 'Nano Banana 2 (edit)',
		provider: 'fal',
		kind: 'image_edit',
		tier: 'premium',
		usd: 0.08,
		sizeParam: 'aspect_ratio',
		multiRef: true,
		note: 'Multi-reference. Keeps the face consistent across the whole kit.'
	},
	{
		id: 'fal-ai/flux-pro/kontext',
		label: 'FLUX Kontext',
		provider: 'fal',
		kind: 'image_edit',
		tier: 'balanced',
		usd: 0.04,
		sizeParam: 'aspect_ratio',
		multiRef: false,
		note: 'Half the price of Nano Banana for edits.',
		caveat: 'Accepts only ONE reference image — the character sheet is dropped, so facial consistency can drift.'
	},
	{
		id: 'fal-ai/qwen-image-edit',
		label: 'Qwen Image Edit',
		provider: 'fal',
		kind: 'image_edit',
		tier: 'budget',
		usd: 0.02,
		sizeParam: 'image_size',
		multiRef: false,
		note: 'Cheapest edit option.',
		caveat: 'Accepts only ONE reference image — the character sheet is dropped, so facial consistency can drift.'
	},

	// ── Image-to-video: post b-roll ─────────────────────────────────────────
	{
		id: 'fal-ai/wan-i2v',
		label: 'Wan i2v',
		provider: 'fal',
		kind: 'video_i2v',
		tier: 'budget',
		usd: 0.1,
		supportsAudio: false,
		supportsDuration: false,
		note: 'Cheapest motion. Shorter, simpler clips. No audio track.'
	},
	{
		id: 'fal-ai/minimax/hailuo-02/standard/image-to-video',
		label: 'Hailuo 02',
		provider: 'fal',
		kind: 'video_i2v',
		tier: 'budget',
		usd: 0.28,
		supportsAudio: false,
		supportsDuration: true,
		note: 'Good motion for the price. No audio track.'
	},
	{
		id: 'fal-ai/kling-video/o3/standard/image-to-video',
		label: 'Kling O3 Standard',
		provider: 'fal',
		kind: 'video_i2v',
		tier: 'balanced',
		usd: 0.42,
		supportsAudio: true,
		supportsDuration: true,
		note: 'The default. Reliable 5s UGC b-roll, with audio.'
	},
	{
		id: 'fal-ai/kling-video/o3/pro/image-to-video',
		label: 'Kling O3 Pro',
		provider: 'fal',
		kind: 'video_i2v',
		tier: 'premium',
		usd: 0.56,
		supportsAudio: true,
		supportsDuration: true,
		note: 'Sharper motion and fewer artifacts than Standard.'
	},
	{
		id: 'fal-ai/veo3.1/image-to-video',
		label: 'Veo 3.1',
		provider: 'fal',
		kind: 'video_i2v',
		tier: 'premium',
		usd: 1.5,
		supportsAudio: true,
		supportsDuration: true,
		note: 'Best quality available. Expensive — reserve it for hero content.'
	}
];

/** Defaults preserve today's behaviour, so selecting nothing changes nothing. */
export const DEFAULT_MODEL: Record<ModelKind, string> = {
	image_t2i: 'fal-ai/flux/schnell',
	image_edit: 'fal-ai/nano-banana-2/edit',
	video_i2v: 'fal-ai/kling-video/o3/standard/image-to-video'
};

export function modelsFor(kind: ModelKind): ModelOption[] {
	return MODEL_CATALOG.filter((m) => m.kind === kind).sort((a, b) => a.usd - b.usd);
}

export function getModel(id: string | undefined | null): ModelOption | undefined {
	return MODEL_CATALOG.find((m) => m.id === id);
}

/**
 * Resolves a requested model id, falling back to the default for its step.
 * An unknown id must never reach fal — that's a 404 the user pays latency for.
 */
export function resolveModel(kind: ModelKind, requested?: string | null): ModelOption {
	const found = requested ? MODEL_CATALOG.find((m) => m.id === requested && m.kind === kind) : undefined;
	return found ?? getModel(DEFAULT_MODEL[kind])!;
}

export const TIER_LABEL: Record<QualityTier, string> = {
	budget: 'Budget',
	balanced: 'Balanced',
	premium: 'Premium'
};
