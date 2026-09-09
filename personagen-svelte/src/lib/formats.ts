/**
 * Format catalog — the one axis a user actually picks.
 *
 * The composer used to ask people to compose an output out of four overlapping
 * fields: `media` (video | image | cinematic), `format` (auto | spokesperson |
 * broll), `still` (photo | graphic) and `refs` ({character, product}). Those
 * only mean anything in combination — a text card is media:'image' +
 * still:'graphic' + no refs — so nothing in the UI could group them, and a text
 * card ended up listed among the video formats.
 *
 * Two other surfaces had already solved this and disagreed with the composer
 * and with each other: the Studio shelves sort by `surface` (typographic /
 * photo / motion / cinematic) and the campaign planner by `FormatClass` (Text &
 * Type / Photo / Video / Cinematic). This module is the shared answer:
 *
 *   kind    what comes out — Image, Video, Series (what a user browses by)
 *   format  the specific thing inside that kind (what a user picks)
 *
 * Everything else is DERIVED. `requestFor()` turns a format id back into the
 * media/format/still/refs the API already understands, so no server contract
 * changed; `formatFromRequest()` reads a legacy body (a Studio template's
 * `baseBody`, an autopilot slot) back into a format id, so every existing
 * caller keeps working untouched.
 *
 * `needs` is the cascade. A format declares which controls its run actually
 * reads, and the composer's Look step renders exactly those — no pane logic
 * knows what a "spokesperson" is. Adding a format is one entry here, not a
 * change in nine files.
 *
 * Client-safe (no $env, no server imports) so the composer and the server
 * preview build the pipeline from ONE function and cannot disagree about what
 * will run or what it costs.
 */

import type { QualityTier } from '$lib/models';

/** What comes out. The axis a user browses by. */
export type FormatKind = 'image' | 'video' | 'series';

/** A control the Look step renders because the run actually reads it. */
export type FormatNeed =
	| 'scene'
	| 'framing'
	| 'product'
	| 'face'
	| 'cardText'
	| 'cardLayout'
	| 'cardPalette'
	| 'script'
	| 'voice'
	| 'shots'
	| 'captions'
	| 'planner';

/** One paid or free stage of a run. */
export type StepKind =
	| 'director'
	| 'still'
	| 'card'
	| 'tts'
	| 'talkinghead'
	| 'video'
	| 'cine_stills'
	| 'cine_video'
	| 'motion'
	| 'mux';

export interface FormatEntry {
	id: string;
	kind: FormatKind;
	label: string;
	/** One line, in the user's language, about what comes out. */
	note: string;
	/** The controls this run reads. Drives the Look step, nothing else. */
	needs: FormatNeed[];
	/** The stages that will run, in order. Drives the Craft step and the quote. */
	steps: StepKind[];
	/** The request fields this format maps to — the API contract is unchanged. */
	request: {
		media?: 'image' | 'video' | 'cinematic';
		format?: 'auto' | 'spokesperson' | 'broll' | 'vo_broll' | 'motion_card';
		still?: 'photo' | 'graphic';
		refs?: { character: boolean; product: boolean };
	};
	/** True when the output is a video file — drives the video-only platform rule. */
	video: boolean;
	/** Needs a face on camera; a persona-free composition cannot run this. */
	needsFace?: boolean;
	/**
	 * Assembled locally with ffmpeg, which is a SOFT dependency — the host may
	 * not have it. A format flagged here is hidden where it cannot be built,
	 * rather than offered and failed after the money is spent. Same gate the $0
	 * card renderer already uses.
	 */
	needsFfmpeg?: boolean;
}

/**
 * Every format the pipeline can actually run today. Nothing aspirational lives
 * here: a format in this list is one the server will produce, because offering
 * something the run cannot deliver is exactly the promise this dialog exists to
 * prevent.
 */
export const FORMAT_CATALOG: FormatEntry[] = [
	{
		id: 'photo',
		kind: 'image',
		label: 'Photo',
		note: 'A single frame from this persona’s life — the everyday post.',
		needs: ['scene', 'framing', 'product', 'face'],
		steps: ['director', 'still'],
		request: { media: 'image', still: 'photo' },
		video: false
	},
	{
		id: 'text-card',
		kind: 'image',
		label: 'Text card',
		note: 'Type on a brand field. Typeset on our own servers — no image model.',
		needs: ['cardText', 'cardLayout', 'cardPalette'],
		steps: ['director', 'card'],
		request: { media: 'image', still: 'graphic', refs: { character: false, product: false } },
		video: false
	},
	{
		id: 'motion-card',
		kind: 'video',
		label: 'Motion text card',
		note: 'The typeset card, put in motion. No image model, no video model.',
		needs: ['cardText', 'cardLayout', 'cardPalette', 'captions'],
		steps: ['director', 'card', 'motion'],
		request: {
			media: 'video',
			format: 'motion_card',
			still: 'graphic',
			refs: { character: false, product: false }
		},
		video: true,
		needsFfmpeg: true
	},
	{
		id: 'spokesperson',
		kind: 'video',
		label: 'Spokesperson',
		note: 'The persona talks to camera — voiceover and a lip-synced face.',
		needs: ['script', 'voice', 'scene', 'framing', 'face', 'product', 'captions'],
		steps: ['director', 'still', 'tts', 'talkinghead'],
		request: { media: 'video', format: 'spokesperson' },
		video: true,
		needsFace: true
	},
	{
		id: 'product-motion',
		kind: 'video',
		label: 'Product motion',
		note: 'A short lifestyle clip. Nobody on camera, no dialogue.',
		needs: ['scene', 'product', 'face', 'captions'],
		steps: ['director', 'still', 'video'],
		request: { media: 'video', format: 'broll' },
		video: true
	},
	{
		id: 'vo-broll',
		kind: 'video',
		label: 'Narrated product motion',
		note: 'The persona talks over a product clip. Their voice, no face on camera.',
		needs: ['script', 'voice', 'scene', 'product', 'face', 'captions'],
		steps: ['director', 'still', 'tts', 'video', 'mux'],
		request: { media: 'video', format: 'vo_broll' },
		video: true,
		needsFfmpeg: true
	},
	{
		id: 'cinematic',
		kind: 'video',
		label: 'Cinematic',
		note: 'A 2–5 shot sequence built in one pass. The most expensive thing here.',
		// No shot-count control: the Director decides how many shots (2-5) at run
		// time, so a picker here would be a lie. The quote prices the 4-shot
		// midpoint, which is what planPipeline's default multiplier does.
		needs: ['scene', 'face', 'product', 'captions'],
		steps: ['director', 'cine_stills', 'cine_video'],
		request: { media: 'cinematic' },
		video: true
	},
	{
		id: 'auto',
		kind: 'video',
		label: 'Let the Director choose',
		note: 'The Director picks spokesperson or product motion to suit the topic.',
		needs: ['script', 'voice', 'scene', 'framing', 'face', 'product', 'captions'],
		steps: ['director', 'still', 'tts', 'talkinghead'],
		request: { media: 'video', format: 'auto' },
		video: true
	},
	{
		id: 'campaign',
		kind: 'series',
		label: 'Campaign',
		note: 'A run of posts over days or weeks, mixing the formats above.',
		needs: ['planner'],
		steps: [],
		request: {},
		video: false
	}
];

export const FORMAT_KINDS: Array<{ id: FormatKind; label: string; sub: string }> = [
	{ id: 'image', label: 'Image', sub: 'One frame' },
	{ id: 'video', label: 'Video', sub: 'Motion' },
	{ id: 'series', label: 'Series', sub: 'Many posts' }
];

export function getFormat(id: string | null | undefined): FormatEntry | undefined {
	return FORMAT_CATALOG.find((f) => f.id === id);
}

export function formatsOfKind(kind: FormatKind): FormatEntry[] {
	return FORMAT_CATALOG.filter((f) => f.kind === kind);
}

export function formatNeeds(id: string | null | undefined, need: FormatNeed): boolean {
	return getFormat(id)?.needs.includes(need) ?? false;
}

/**
 * A format id → the request fields the generate endpoint already understands.
 * Only the fields a format actually pins are returned, so a caller's own
 * explicit values (a Studio template's refs, say) are never clobbered.
 */
export function requestFor(id: string): Record<string, unknown> {
	const f = getFormat(id);
	if (!f) return {};
	const body: Record<string, unknown> = {};
	if (f.request.media) body.media = f.request.media;
	if (f.request.format) body.format = f.request.format;
	if (f.request.still) body.still = f.request.still;
	if (f.request.refs) body.refs = { ...f.request.refs };
	return body;
}

/**
 * Read a legacy request body back into a format id.
 *
 * Every existing caller — 42 Studio templates, the calendar's generate button,
 * the autopilot, the campaign planner — still speaks media/format/still and
 * must keep working exactly as it does. This is the adapter that lets the new
 * UI understand them without any of them changing.
 */
export function formatFromRequest(body: Record<string, any> | null | undefined): string {
	if (!body) return 'auto';
	if (body.media === 'cinematic') return 'cinematic';
	if (body.media === 'image') return body.still === 'graphic' ? 'text-card' : 'photo';
	if (body.format === 'motion_card') return 'motion-card';
	if (body.format === 'vo_broll') return 'vo-broll';
	// Anything else is a video. A graphic still has no face to animate — the
	// server coerces those to b-roll — so it must not resolve to spokesperson.
	if (body.still === 'graphic') return 'product-motion';
	if (body.format === 'spokesperson') return 'spokesperson';
	if (body.format === 'broll') return 'product-motion';
	return 'auto';
}

// ── The pipeline plan ────────────────────────────────────────────────────────
// One pure function builds the step list AND its price, called by the server to
// produce the preview and by the composer to re-price every change. Before
// this, the server pre-shipped one array per possible combination
// (stepsImage / stepsBroll / stepsSpokesperson / stepsCinematic) and the client
// re-derived cost by string-matching `String(step).includes('b-roll')` — four
// combinations, four arrays, and a price that broke silently if a label
// changed. That cannot scale to formats × model choice × tier lock.

export interface StepModel {
	id: string;
	label: string;
	usd: number;
	provider: string;
	tier?: QualityTier | 'free';
	note?: string;
	caveat?: string;
	supportsAudio?: boolean;
	supportsDuration?: boolean;
	multiRef?: boolean;
}

export interface PipelineStep {
	kind: StepKind;
	/** What this stage is called on screen. */
	label: string;
	/** Why it is in the run, in one line. */
	purpose: string;
	model: StepModel;
	/** Provider USD for this stage. 0 when supplied by the user or rendered locally. */
	usd: number;
	/** Whether the pick came from the user, the tier lock, or the stage default. */
	via: 'picked' | 'tier' | 'nearest' | 'only' | 'default';
	/** More than one wired model serves this stage. */
	selectable: boolean;
	/** The user supplied this stage's output, so it will not run. */
	supplied: boolean;
}

export interface PlanInput {
	formatId: string;
	/** Selectable models per stage, registry-resolved by the server. */
	options?: Partial<Record<StepKind, StepModel[]>>;
	/** The model for stages with no choice (Director, talking head, card render). */
	fixed?: Partial<Record<StepKind, StepModel>>;
	/** Explicit per-stage picks. */
	picks?: Partial<Record<StepKind, string>>;
	/** Stages whose output the user supplied — they do not run and cost nothing. */
	supplied?: Partial<Record<StepKind, boolean>>;
	/** Quality tier lock. 'manual' = whatever is picked, else the stage default. */
	tier?: QualityTier | 'manual';
	/** Cinematic shot count — the storyboard stills line is per shot. */
	shots?: number;
}

export const STEP_LABEL: Record<StepKind, string> = {
	director: 'Director',
	still: 'Still',
	card: 'Text card',
	tts: 'Voiceover',
	talkinghead: 'Talking head',
	video: 'Motion clip',
	cine_stills: 'Storyboard stills',
	cine_video: 'Multi-shot clip',
	motion: 'Motion',
	mux: 'Voiceover mix'
};

export const STEP_PURPOSE: Record<StepKind, string> = {
	director: 'Writes the caption, the hashtags, the spoken line and the scene brief.',
	still:
		'Builds the frame everything else is made from — the product and the face composited into one shot.',
	card: 'Typesets the line on our own servers. No AI model, nothing to pay.',
	tts: 'Speaks the script in the persona’s voice.',
	talkinghead: 'Lip-syncs the frame to the voiceover — this is the face on camera.',
	video: 'Puts the frame in motion. Usually the largest single cost in a run.',
	cine_stills: 'One composited still per shot in the sequence.',
	cine_video: 'Builds the whole multi-shot clip in one call, anchored on the first still.',
	motion: 'Animates the card on our own servers — a slow push, no video model, nothing to pay.',
	mux: 'Lays the voiceover under the clip on our own servers.'
};

const TIER_RANK: Record<string, number> = { budget: 0, balanced: 1, premium: 2, free: 1 };

/**
 * Resolve one stage's model: an explicit pick wins, then the tier lock, then
 * the stage default. A tier with no model at this stage falls back to the
 * nearest and SAYS so (`via: 'nearest'`) rather than quietly pretending the
 * lock applied — several stages have exactly one wired model, so "premium
 * everything" genuinely cannot reach them, and the UI has to be able to say
 * which ones.
 */
function resolveStepModel(
	kind: StepKind,
	input: PlanInput
): { model: StepModel; via: PipelineStep['via']; selectable: boolean } {
	const options = input.options?.[kind] ?? [];
	const fixed = input.fixed?.[kind];
	const selectable = options.length > 1;

	if (options.length === 0) {
		return {
			model: fixed ?? { id: kind, label: STEP_LABEL[kind], usd: 0, provider: 'local' },
			via: 'only',
			selectable: false
		};
	}

	const picked = input.picks?.[kind] ? options.find((m) => m.id === input.picks![kind]) : undefined;
	if (picked) return { model: picked, via: 'picked', selectable };

	const tier = input.tier;
	if (tier && tier !== 'manual') {
		const inTier = options.filter((m) => m.tier === tier);
		// Dearest inside the tier: a tier is a quality floor, not a bargain hunt.
		if (inTier.length) return { model: inTier[inTier.length - 1], via: 'tier', selectable };
		if (options.length === 1) return { model: options[0], via: 'only', selectable };
		const want = TIER_RANK[tier] ?? 1;
		const near = [...options].sort(
			(a, b) =>
				Math.abs((TIER_RANK[a.tier ?? 'balanced'] ?? 1) - want) -
				Math.abs((TIER_RANK[b.tier ?? 'balanced'] ?? 1) - want)
		)[0];
		return { model: near, via: 'nearest', selectable };
	}

	const fallback = fixed && options.some((m) => m.id === fixed.id) ? fixed : options[0];
	return { model: fallback, via: 'default', selectable };
}

/** The stages this run will go through, priced. The single source for both sides. */
export function planPipeline(input: PlanInput): PipelineStep[] {
	const format = getFormat(input.formatId);
	if (!format) return [];
	return format.steps.map((kind) => {
		const { model, via, selectable } = resolveStepModel(kind, input);
		const supplied = input.supplied?.[kind] === true;
		// The storyboard bills per shot — quoting one still under-quotes a 5-shot
		// sequence by four stills, which is real money at this stage's price.
		const multiplier = kind === 'cine_stills' ? Math.max(1, Math.min(5, input.shots ?? 4)) : 1;
		const usd = supplied ? 0 : +(model.usd * multiplier).toFixed(4);
		return {
			kind,
			label: STEP_LABEL[kind],
			purpose: STEP_PURPOSE[kind],
			model: multiplier > 1 ? { ...model, label: `${model.label} · ×${multiplier} shots` } : model,
			usd,
			via,
			selectable,
			supplied
		};
	});
}

/** Total provider USD for a plan. The retail conversion belongs to $lib/money. */
export function planTotalUsd(steps: PipelineStep[]): number {
	return +steps.reduce((sum, s) => sum + s.usd, 0).toFixed(4);
}

/**
 * Does the Craft step earn a place in the journey? A format whose whole stack
 * is one fixed, free renderer has nothing to configure, and a pane of read-only
 * zero-cost rows is ceremony. The step list is derived from what is actually
 * being composed — it was never meant to be fixed at four.
 */
export function craftMatters(steps: PipelineStep[]): boolean {
	return steps.some((s) => s.selectable || s.usd > 0);
}
