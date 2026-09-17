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
 *
 * Two of the five paid stages in a post used to be invisible here — the talking
 * head (a module constant in content/generate.ts, and the single most expensive
 * call in a spokesperson post at ~$0.70) and the director LLM (picked by key
 * precedence in resolveAiClient). A stage with no kind cannot be offered in the
 * picker and cannot be reached by a tier lock, so both are now kinds like any
 * other. That is why `provider` is no longer fal-only: the LLM stage genuinely
 * runs on OpenRouter or on Gemini direct, and pretending otherwise would put a
 * wrong provider on the ledger.
 */

export type ModelKind =
	| 'image_t2i'
	| 'image_edit'
	| 'video_i2v'
	| 'video_v2v'
	| 'talking_head'
	| 'llm';
export type QualityTier = 'budget' | 'balanced' | 'premium';

/**
 * What a model's `usd` buys ONE of.
 *
 * Lives here, not in $lib/formats, because it is a fact about the PROVIDER's
 * price list rather than about a pipeline position: wan-animate bills per second
 * of output wherever you call it from. formats.ts imports it to type a step's
 * basis (and adds `per_shot`, which genuinely IS a pipeline fact — a stage that
 * calls a per-call model once per storyboard shot).
 *
 * `per_item` is the odd one: it belongs to neither the model nor the pipeline
 * position, but to the FORMAT. The same `tts` stage calls the same model once
 * for a Spokesperson and once per beat for a Listicle, so only the format knows
 * the count — which is why FormatEntry can override a step's basis.
 *
 * Omitted means `per_call`, so every model that existed before this did keeps
 * quoting exactly as it did.
 */
export type Billing = 'per_call' | 'per_shot' | 'per_second' | 'per_item';

export interface ModelOption {
	id: string;
	label: string;
	/** Which API serves it — decides the adapter, and which key has to exist. */
	provider: 'fal' | 'openrouter' | 'gemini';
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
	/**
	 * What `usd` buys one of. Omitted means `per_call`, which is every model in
	 * this catalog except the video-to-video family — those bill by output
	 * SECOND, so quoting them at a flat price is wrong by however long the clip
	 * is. Read by the pipeline quote (see billedUnits in $lib/formats).
	 */
	billing?: Billing;
	/**
	 * This model transforms a SOURCE clip the user supplies, rather than
	 * generating from a still. Formats that offer it must require the
	 * `videoIngest` host capability, and the run must carry a source clip.
	 */
	needsSourceVideo?: boolean;
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
		caveat:
			'Accepts only ONE reference image — the character sheet is dropped, so facial consistency can drift.'
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
		caveat:
			'Accepts only ONE reference image — the character sheet is dropped, so facial consistency can drift.'
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
	},

	// ── Video-to-video: a source clip drives the persona ────────────────────
	// Verified end-to-end against the live endpoints on 2026-09-09 (a real run,
	// not a spec read — see docs/competitive/video-to-video-implementation-plan.md
	// §7a). Both take `video_url` + `image_url` + `resolution` and return
	// {video:{url}}. Billed per VIDEO SECOND at a 16fps basis:
	// 480p $0.04 · 580p $0.06 · 720p $0.08. 580p is the default here because a
	// measured run costs ~$0.21 for 2.6s at 720p and takes ~7 minutes — the
	// latency, not the money, is what makes the cheaper rung the right default.
	//
	// BOTH REQUIRE A FULL-BODY REFERENCE. Driven from the pinned bust-crop face,
	// the model invents a lower body, a wardrobe and a room to fill the frame —
	// exactly the from-nothing invention this stage exists to avoid.
	{
		id: 'fal-ai/wan/v2.2-14b/animate/replace',
		label: 'Wan Animate · Replace',
		provider: 'fal',
		kind: 'video_v2v',
		tier: 'balanced',
		usd: 0.06,
		billing: 'per_second',
		needsSourceVideo: true,
		note: 'Keeps the source clip’s scene, framing and timing, and swaps in this persona. Output follows the source aspect, so a 9:16 clip stays 9:16.',
		caveat:
			'The hairstyle drifts toward the source performer’s silhouette under fast motion — the identity holds, the exact hair does not.'
	},
	{
		id: 'fal-ai/wan/v2.2-14b/animate/move',
		label: 'Wan Animate · Move',
		provider: 'fal',
		kind: 'video_v2v',
		tier: 'balanced',
		usd: 0.06,
		billing: 'per_second',
		needsSourceVideo: true,
		note: 'Takes only the MOTION from the source clip; the persona stays in their own scene.',
		caveat:
			'Output aspect follows the reference image, not the source clip — a 3:4 reference yields a 3:4 clip, which needs a reframe before it is a Reel.'
	},

	// ── Talking head: the spokesperson stage (still + voiceover → lip-sync) ──
	// All three take image_url + audio_url and return {video:{url}} — verified
	// against each endpoint's live OpenAPI spec on 2026-09-09, which is also how
	// content/generate.ts can swap between them with one branch. Fabric is the
	// exception that proves the rule: `resolution` is REQUIRED there and absent
	// from the other two, which reject params they don't declare (422).
	// supportsAudio / supportsDuration stay unset on purpose — audio is an INPUT
	// at this stage, and the clip's length is the voiceover's length.
	{
		id: 'fal-ai/kling-video/ai-avatar/v2/standard',
		label: 'Kling AI Avatar v2',
		provider: 'fal',
		kind: 'talking_head',
		tier: 'budget',
		usd: 0.28,
		note: 'Half the price of OmniHuman ($0.0562/s). Softer facial detail; lip-sync is good, not film-grade.'
	},
	// fal also publishes a separate `fal-ai/bytedance/omnihuman/v1.5` endpoint.
	// This is deliberately the BASE id, because that is the one TALKINGHEAD_MODEL
	// actually calls; the label matches TALKINGHEAD_LABEL so the picker and the
	// ledger don't invent two names for the same call.
	{
		id: 'fal-ai/bytedance/omnihuman',
		label: 'OmniHuman v1.5',
		provider: 'fal',
		kind: 'talking_head',
		tier: 'premium',
		usd: 0.7,
		note: 'The default ($0.14/s × ~5s). Tightest audio↔motion correlation — the reason this stage moved off Fabric.'
	},
	{
		id: 'veed/fabric-1.0',
		label: 'VEED Fabric 1.0',
		provider: 'fal',
		kind: 'talking_head',
		tier: 'balanced',
		usd: 0.75,
		note: 'The original spokesperson model, kept because the pipeline still knows its request shape.',
		caveat:
			'At the 720p this app sends it costs MORE than OmniHuman ($0.15/s vs $0.14/s) for the weaker lip-sync we upgraded away from. UGC_FABRIC_RES=480p drops it to $0.08/s (~$0.40).'
	},

	// ── Director LLM: script, captions, grading ─────────────────────────────
	// Every entry is a chat model reachable through resolveAiClient's existing
	// clients — the OpenRouter ones over the same /chat/completions call that
	// OPENROUTER_GEMINI_MODEL already parameterises, the direct one over the
	// @google/genai SDK. Nothing here needs a new adapter.
	// Prices are per-CALL ESTIMATES for a token-billed stage, DERIVED from the
	// published per-token rates below against the mean real call (732 tokens in,
	// 1,170 out, measured over 12 production generations). They carry the same
	// figures pricing.ts bills, so picker and ledger cannot disagree. Both rows
	// previously carried numbers ~6x too low — the per-token rates were written
	// in these notes and never turned into a per-call estimate.
	{
		id: 'google/gemini-3.5-flash-lite',
		label: 'Gemini 3.5 Flash Lite (OpenRouter)',
		provider: 'openrouter',
		kind: 'llm',
		tier: 'budget',
		usd: 0.0032,
		note: "Cheapest director. $0.30/$2.50 per M tokens against the mean real call = $0.0032. Thinner scripts, weaker JSON discipline."
	},
	{
		id: 'google/gemini-3.5-flash',
		label: 'Gemini 3.5 Flash (OpenRouter)',
		provider: 'openrouter',
		kind: 'llm',
		tier: 'balanced',
		usd: 0.012,
		note: 'The default. $1.50/$9.00 per M tokens against the mean real call = $0.0116, and the provider reports $0.0116. Output is 95% of it.'
	},
	{
		id: 'gemini-3.5-flash',
		label: 'Gemini 3.5 Flash (Google direct)',
		provider: 'gemini',
		kind: 'llm',
		tier: 'balanced',
		usd: 0.012,
		note: 'Same model, billed by Google instead of OpenRouter — one less hop, so it should cost less. UNMEASURED: this client never runs while an OpenRouter key exists, so it carries the OpenRouter figure rather than a guess downward.',
		caveat:
			'Only runs when no OpenRouter key is configured: resolveAiClient prefers OpenRouter over Gemini for every user.'
	}
];

/** Defaults preserve today's behaviour, so selecting nothing changes nothing. */
export const DEFAULT_MODEL: Record<ModelKind, string> = {
	image_t2i: 'fal-ai/flux/schnell',
	image_edit: 'fal-ai/nano-banana-2/edit',
	video_i2v: 'fal-ai/kling-video/o3/standard/image-to-video',
	// Mirrors the compiled-in constants these stages run on today:
	// TALKINGHEAD_MODEL in content/generate.ts and OPENROUTER_GEMINI_MODEL in
	// server/ai-client.ts. Both are env-overridable there; the default here is
	// the value that ships.
	talking_head: 'fal-ai/bytedance/omnihuman',
	llm: 'google/gemini-3.5-flash',
	// Replace, not Move: it inherits the source clip's scene AND its aspect, so
	// a 9:16 source yields a 9:16 post with no reframe stage. Move is the
	// deliberate pick, never the fallback.
	video_v2v: 'fal-ai/wan/v2.2-14b/animate/replace'
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
	const found = requested
		? MODEL_CATALOG.find((m) => m.id === requested && m.kind === kind)
		: undefined;
	return found ?? getModel(DEFAULT_MODEL[kind])!;
}

export const TIER_LABEL: Record<QualityTier, string> = {
	budget: 'Budget',
	balanced: 'Balanced',
	premium: 'Premium'
};
