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

import type { Billing, QualityTier } from '$lib/models';

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
	| 'planner'
	/** A source clip the user supplies; the run transforms it instead of a still. */
	| 'sourceVideo'
	/** The numbered beats of a listicle. Each becomes an on-screen label that
	 *  appears on the beat it is spoken and stays. */
	| 'listItems';

/**
 * Something the HOST must be able to do before a format can be offered — as
 * opposed to something the persona or the brief must supply (`FormatNeed`).
 *
 * The distinction matters because the two fail at different times. A missing
 * need is a control the user can fill in. A missing capability cannot be filled
 * in at all, so the format is hidden rather than offered and failed after the
 * money is spent — the rule the $0 card renderer already follows.
 *
 *   - `ffmpeg`      — a local assembly stage (card motion, voiceover mux). Soft
 *                     dependency: our Docker runtime has it, a bare host may not.
 *   - `videoIngest` — the host can accept, probe and store a source clip.
 *                     Required by the video-to-video formats, which cannot run
 *                     without a clip to transform.
 */
export type HostCapability = 'ffmpeg' | 'videoIngest';

/** One paid or free stage of a run. */
export type StepKind =
	| 'director'
	| 'grader'
	| 'still'
	| 'card'
	| 'tts'
	| 'talkinghead'
	| 'video'
	| 'cine_stills'
	| 'cine_video'
	| 'motion'
	| 'mux'
	| 'v2v';

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
		format?:
			| 'auto'
			| 'spokesperson'
			| 'broll'
			| 'vo_broll'
			| 'motion_card'
			| 'v2v_replace'
			| 'v2v_move'
			| 'v2v_narrated'
			| 'listicle';
		still?: 'photo' | 'graphic';
		refs?: { character: boolean; product: boolean };
	};
	/** True when the output is a video file — drives the video-only platform rule. */
	video: boolean;
	/** Needs a face on camera; a persona-free composition cannot run this. */
	needsFace?: boolean;
	/**
	 * What the HOST must be able to do to build this format. Absent or empty
	 * means the format runs anywhere. A format whose capabilities aren't all
	 * present is hidden, not offered and failed after the money is spent.
	 *
	 * A list rather than one flag per capability: the set grows (ingest is next),
	 * and `buildableWith` should never need editing when it does.
	 */
	requires?: HostCapability[];
	/**
	 * A stage whose cost basis this FORMAT changes.
	 *
	 * Billing is normally a fact about the provider (`ModelOption.billing`) or the
	 * pipeline position (`STEP_BILLING`). A listicle is neither: it calls the very
	 * same TTS model as a Spokesperson, at the same price, just once per beat —
	 * because that is the only way to MEASURE where each on-screen reveal lands
	 * instead of guessing. Only the format knows that, so only the format can say.
	 *
	 * Without this the quote shows one voiceover and the ledger charges four.
	 */
	stepBilling?: Partial<Record<StepKind, Billing>>;
}

/**
 * Can this host build this format? The single place format visibility is
 * decided, so a new capability is a member of `HostCapability` and nothing else.
 *
 * Fails CLOSED on an unknown capability: a format naming something this host
 * hasn't been told about is hidden, because the alternative is selling a run
 * that cannot complete.
 */
export function buildableWith(
	format: Pick<FormatEntry, 'requires'>,
	available: Iterable<HostCapability>
): boolean {
	const have = new Set(available);
	return (format.requires ?? []).every((cap) => have.has(cap));
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
		steps: ['director', 'grader', 'still'],
		request: { media: 'image', still: 'photo' },
		video: false
	},
	{
		id: 'text-card',
		kind: 'image',
		label: 'Text card',
		note: 'Type on a brand field. Typeset on our own servers — no image model.',
		needs: ['cardText', 'cardLayout', 'cardPalette'],
		steps: ['director', 'grader', 'card'],
		request: { media: 'image', still: 'graphic', refs: { character: false, product: false } },
		video: false
	},
	{
		id: 'motion-card',
		kind: 'video',
		label: 'Motion text card',
		note: 'The typeset card, put in motion. No image model, no video model.',
		needs: ['cardText', 'cardLayout', 'cardPalette', 'captions'],
		steps: ['director', 'grader', 'card', 'motion'],
		request: {
			media: 'video',
			format: 'motion_card',
			still: 'graphic',
			refs: { character: false, product: false }
		},
		video: true,
		requires: ['ffmpeg']
	},
	{
		id: 'spokesperson',
		kind: 'video',
		label: 'Spokesperson',
		note: 'The persona talks to camera — voiceover and a lip-synced face.',
		needs: ['script', 'voice', 'scene', 'framing', 'face', 'product', 'captions'],
		steps: ['director', 'grader', 'still', 'tts', 'talkinghead'],
		request: { media: 'video', format: 'spokesperson' },
		video: true,
		needsFace: true
	},
	{
		id: 'listicle',
		kind: 'video',
		label: 'Listicle',
		note: 'A numbered countdown to camera. Each item appears on screen as she says it.',
		needs: ['script', 'voice', 'listItems', 'scene', 'framing', 'face', 'captions'],
		// Identical stages to Spokesperson — the difference is what the Director
		// writes and that the voiceover is generated PER ITEM, which is the only
		// way the on-screen reveals can be timed to speech rather than guessed.
		steps: ['director', 'grader', 'still', 'tts', 'talkinghead'],
		request: { media: 'video', format: 'listicle' },
		video: true,
		needsFace: true,
		// One TTS call per beat (hook + each item), not one for the whole script.
		stepBilling: { tts: 'per_item' },
		// ffmpeg is REQUIRED here, unlike Spokesperson, because the timed reveals
		// are burned locally. A listicle whose list cannot render is not a
		// listicle — it is a talking head reading numbers off a page nobody sees,
		// which is exactly the silent-degradation this gate exists to refuse.
		requires: ['ffmpeg']
	},
	{
		id: 'product-motion',
		kind: 'video',
		label: 'Product motion',
		note: 'A short lifestyle clip. Nobody on camera, no dialogue.',
		needs: ['scene', 'product', 'face', 'captions'],
		steps: ['director', 'grader', 'still', 'video'],
		request: { media: 'video', format: 'broll' },
		video: true
	},
	{
		id: 'vo-broll',
		kind: 'video',
		label: 'Narrated product motion',
		note: 'The persona talks over a product clip. Their voice, no face on camera.',
		needs: ['script', 'voice', 'scene', 'product', 'face', 'captions'],
		steps: ['director', 'grader', 'still', 'tts', 'video', 'mux'],
		request: { media: 'video', format: 'vo_broll' },
		video: true,
		requires: ['ffmpeg']
	},
	{
		id: 'reel-remake',
		kind: 'video',
		label: 'Reel remake',
		note: 'A clip you supply, performed by this persona — its scene, framing and timing, your face.',
		needs: ['sourceVideo', 'face', 'captions'],
		// The still is NOT decoration: the engine composites one on every v2v run —
		// it is the post's poster frame and the anchor the never-brick i2v fallback
		// re-performs from when the transfer fails. It runs, so it is quoted. A
		// stage that bills but is not quoted is the same lie as one that is quoted
		// but never runs, only harder to notice.
		steps: ['director', 'grader', 'still', 'v2v'],
		request: { media: 'video', format: 'v2v_replace' },
		video: true,
		needsFace: true,
		requires: ['videoIngest']
	},
	{
		id: 'narrated-reel',
		kind: 'video',
		label: 'Narrated reel remake',
		note: 'A clip you supply, performed by this persona and narrated in their voice.',
		needs: ['sourceVideo', 'script', 'voice', 'face', 'captions'],
		// Every one of these five stages already exists — this format is the
		// composition, not new machinery. The mux lays the voiceover under the
		// transferred clip, which is also why ffmpeg is required here and not on
		// the silent Replace format.
		steps: ['director', 'grader', 'still', 'v2v', 'tts', 'mux'],
		request: { media: 'video', format: 'v2v_narrated' },
		video: true,
		needsFace: true,
		requires: ['videoIngest', 'ffmpeg']
	},
	{
		id: 'motion-transfer',
		kind: 'video',
		label: 'Motion transfer',
		note: 'Takes only the movement from a clip you supply. The persona stays in their own scene.',
		needs: ['sourceVideo', 'scene', 'face', 'captions'],
		steps: ['director', 'grader', 'still', 'v2v'],
		request: { media: 'video', format: 'v2v_move' },
		video: true,
		needsFace: true,
		// ffmpeg as well as ingest: Move's output follows the REFERENCE aspect, not
		// the source clip's, so a 3:4 reference yields a 3:4 clip that has to be
		// reframed before it is a Reel. Replace needs no such pass.
		requires: ['videoIngest', 'ffmpeg']
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
		steps: ['director', 'grader', 'cine_stills', 'cine_video'],
		request: { media: 'cinematic' },
		video: true
	},
	{
		id: 'auto',
		kind: 'video',
		label: 'Let the Director choose',
		note: 'The Director picks spokesperson or product motion to suit the topic.',
		needs: ['script', 'voice', 'scene', 'framing', 'face', 'product', 'captions'],
		steps: ['director', 'grader', 'still', 'tts', 'talkinghead'],
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
	if (body.format === 'v2v_replace') return 'reel-remake';
	if (body.format === 'v2v_move') return 'motion-transfer';
	if (body.format === 'v2v_narrated') return 'narrated-reel';
	if (body.format === 'listicle') return 'listicle';
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

/**
 * What a stage's provider cost scales with — the quantity `StepModel.usd` buys
 * ONE of.
 *
 * `per_call` is the assumption every stage made before this existed, and it is
 * still right for almost all of them: one call, one price, regardless of how
 * long the output is. The other two are the cases where that assumption quietly
 * under-quotes:
 *
 *   - `per_shot`   — the stage runs its model once per storyboard shot, so a
 *                    5-shot sequence costs 5×. This was a hardcoded
 *                    `kind === 'cine_stills'` check inside planPipeline.
 *   - `per_second` — the PROVIDER bills by output duration rather than by job
 *                    (fal's wan-animate video-to-video family bills per video
 *                    second at 16fps). `usd` is then USD per second, not per
 *                    call, and quoting it as a flat price is wrong by however
 *                    long the clip is.
 *
 * Kept as a declared basis rather than a chain of `if (kind === …)` because the
 * second such branch is where a quote function starts to lie: every future
 * per-unit stage would add one more, and none of them would be visible to the
 * tests that check the total.
 */
export type { Billing };

export interface StepModel {
	id: string;
	label: string;
	/** USD per BILLED UNIT — per call unless the basis says otherwise. */
	usd: number;
	provider: string;
	tier?: QualityTier | 'free';
	note?: string;
	caveat?: string;
	supportsAudio?: boolean;
	supportsDuration?: boolean;
	multiRef?: boolean;
	/**
	 * Overrides the stage's default basis. Billing is a fact about the PROVIDER's
	 * price, not about the pipeline position, so a per-second model dropped into
	 * a stage whose other models bill per call must be able to say so — otherwise
	 * the stage's basis would silently misquote it.
	 */
	billing?: Billing;
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
	/**
	 * Output duration for stages billed `per_second`. MEASURED, not assumed:
	 * for a source-driven stage this is the probed length of the clip the user
	 * supplied. A per-second model quoted at an assumed duration is how a user
	 * gets a bill they were never shown.
	 */
	seconds?: number;
	/**
	 * Beats in a listicle — the hook plus each item, i.e. how many separate
	 * voiceover calls the run makes. Drives any stage the format marks
	 * `per_item`.
	 */
	items?: number;
	/**
	 * Stages that are not part of the FORMAT but will run and bill on THIS run.
	 *
	 * The case that forced it: a persona with no pinned face builds its identity
	 * set mid-run — `ensureCharacterRef` fires three paid image calls. They are
	 * not a stage of any format (every format skips them once a face exists), yet
	 * they are the majority of a first post's real cost. Left out, the first post
	 * for a persona quoted about a quarter of what it debited, and every later
	 * post quoted correctly — the shape that keeps a pricing bug hidden.
	 *
	 * They are quoted FIRST because they happen first, and they ride PlanInput so
	 * the server preview and the composer's re-price produce the same number from
	 * the same function.
	 */
	oneOffs?: PipelineStep[];
}

export const STEP_LABEL: Record<StepKind, string> = {
	director: 'Director',
	grader: 'Quality gate',
	still: 'Still',
	card: 'Text card',
	tts: 'Voiceover',
	talkinghead: 'Talking head',
	video: 'Motion clip',
	cine_stills: 'Storyboard stills',
	cine_video: 'Multi-shot clip',
	motion: 'Motion',
	mux: 'Voiceover mix',
	v2v: 'Performance transfer'
};

export const STEP_PURPOSE: Record<StepKind, string> = {
	director: 'Writes the caption, the hashtags, the spoken line and the scene brief.',
	grader:
		'Scores the draft before any media is bought. A weak draft is abandoned here, while it is still cheap.',
	still:
		'Builds the frame everything else is made from — the product and the face composited into one shot.',
	card: 'Typesets the line on our own servers. No AI model, nothing to pay.',
	tts: 'Speaks the script in the persona’s voice.',
	talkinghead: 'Lip-syncs the frame to the voiceover — this is the face on camera.',
	video: 'Puts the frame in motion. Usually the largest single cost in a run.',
	cine_stills: 'One composited still per shot in the sequence.',
	cine_video: 'Builds the whole multi-shot clip in one call, anchored on the first still.',
	motion: 'Animates the card on our own servers — a slow push, no video model, nothing to pay.',
	mux: 'Lays the voiceover under the clip on our own servers.',
	v2v: 'Re-performs your source clip as this persona. Billed per second of that clip.'
};

/**
 * The basis a stage bills on when its model doesn't override it. Absent means
 * `per_call`, which is why this map holds one entry rather than ten.
 */
const STEP_BILLING: Partial<Record<StepKind, Billing>> = {
	cine_stills: 'per_shot'
};

/** Storyboard bounds — the Director is asked for a shot list in this range. */
const MIN_SHOTS = 1;
const MAX_SHOTS = 5;
/**
 * Bounds for a per-second stage. The floor stops a zero/NaN duration quoting a
 * stage at $0; the ceiling is the ingest cap, so a quote can never promise a
 * clip longer than the pipeline will accept.
 */
/**
 * The clip-length bounds, owned here because this module is the one both the
 * client and the server already share — and because these two numbers must be
 * the SAME number in two places that would otherwise drift apart silently.
 *
 * The ingest endpoint rejects a clip outside this range; the quote clamps to it.
 * If ingest accepted 60s while the quote clamped at 30, we would bill half of a
 * clip we had already agreed to process. `$lib/server/video` imports these
 * rather than restating them, so there is one ceiling, not two.
 */
export const MIN_SECONDS = 1;
export const MAX_SECONDS = 30;
/**
 * Quoted duration when a per-second stage has no measured one. Matches the
 * pipeline's own clip default (`UGC_VIDEO_DURATION`, '5'), so an unmeasured
 * quote is at worst the length we would have produced anyway — never $0.
 */
const DEFAULT_SECONDS = 5;
/**
 * Listicle BEATS — the hook plus one per item. Exported because the ingest
 * route, the composer's chips and the engine all clamp to this range, and three
 * private copies of "2..6" is three chances to disagree: a picker offering a
 * count the engine then rejects is the offered-then-degraded promise this whole
 * module exists to prevent.
 *
 * The floor is THREE, not two, and the off-by-one is the reason to be explicit:
 * beats include the hook, so two beats is a hook plus a single item — which is
 * not a list, and which the engine would quietly serve as a plain spokesperson.
 */
export const MIN_ITEMS = 3;
export const MAX_ITEMS = 6;
export const DEFAULT_ITEMS = 4;

const clamp = (n: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

/** The basis in force for a stage: the model's own, else the stage's, else per call. */
export function billingFor(
	kind: StepKind,
	model: Pick<StepModel, 'billing'>,
	format?: Pick<FormatEntry, 'stepBilling'>
): Billing {
	// Format first: it is the only layer that knows a stage runs more than once
	// in THIS composition while the model and the stage are unchanged.
	return format?.stepBilling?.[kind] ?? model.billing ?? STEP_BILLING[kind] ?? 'per_call';
}

/**
 * How many billed units this stage will consume — the multiplier on `usd`.
 * Always ≥ 1: a stage that runs at all costs at least one unit.
 */
export function billedUnits(
	kind: StepKind,
	model: Pick<StepModel, 'billing'>,
	input: PlanInput,
	format?: Pick<FormatEntry, 'stepBilling'>
): number {
	switch (billingFor(kind, model, format)) {
		case 'per_item':
			return Math.round(clamp(input.items ?? DEFAULT_ITEMS, MIN_ITEMS, MAX_ITEMS));
		case 'per_shot':
			return Math.round(clamp(input.shots ?? 4, MIN_SHOTS, MAX_SHOTS));
		case 'per_second':
			// CEIL, not round. A clip is a real measured duration with a fraction,
			// and the provider bills that fraction: the engine charges 12.4s × rate.
			// Rounding 12.4 down to 12 quotes LESS than we then charge — which is
			// true for every clip whose fractional part is under .5, i.e. about half
			// of them. Ceiling keeps the quote an upper bound on the bill, so the
			// number the user approved is never smaller than the one they pay.
			return Math.ceil(clamp(input.seconds ?? DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS));
		default:
			return 1;
	}
}

/** The unit noun shown beside a multiplied stage, e.g. `×5 shots`. */
const UNIT_NOUN: Record<Billing, string> = {
	per_call: 'runs',
	per_shot: 'shots',
	per_second: 'seconds',
	per_item: 'beats'
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
	const oneOffs = input.oneOffs ?? [];
	return [
		...oneOffs,
		...format.steps.map((kind) => {
			const { model, via, selectable } = resolveStepModel(kind, input);
			const supplied = input.supplied?.[kind] === true;
			// Stages that bill on a quantity — the storyboard per shot, a per-second
			// video model per second of output — are multiplied here. Quoting one unit
			// for a 5-shot sequence under-quotes it by four stills, which is real money
			// at that stage's price; the same is true of every second of a per-second
			// clip. The basis is declared (see Billing), never inferred from the kind.
			const multiplier = billedUnits(kind, model, input, format);
			const usd = supplied ? 0 : +(model.usd * multiplier).toFixed(4);
			return {
				kind,
				label: STEP_LABEL[kind],
				purpose: STEP_PURPOSE[kind],
				model:
					multiplier > 1
						? {
								...model,
								label: `${model.label} · ×${multiplier} ${UNIT_NOUN[billingFor(kind, model, format)]}`
							}
						: model,
				usd,
				via,
				selectable,
				supplied
			};
		})
	];
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
