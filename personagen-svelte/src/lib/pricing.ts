/**
 * Provider pricing matrix — single source of truth for generation cost
 * ESTIMATES (providers don't return uniform per-call costs, so we account
 * with a rate table; tune via env UGC_PRICING_JSON without a code change).
 *
 * Client-safe (no $env/server imports) so both the UI matrix and the server
 * cost tracker read the same numbers. All values are USD per call.
 */

export interface PriceEntry {
	provider: 'fal' | 'openrouter' | 'gemini' | 'zernio' | 'local' | 'firecrawl';
	operation: string;
	model: string;
	/** Estimated USD per call. */
	usd: number;
	note?: string;
}

export const PRICING_MATRIX: PriceEntry[] = [
	// ── local (server-side, no AI model) ───────────────────────────────────
	{
		provider: 'local',
		operation: 'image',
		model: 'typographic card (server-rendered)',
		usd: 0,
		note: 'deterministic ffmpeg typesetting — text cards generate for free'
	},
	// ── fal.ai (primary media) ──────────────────────────────────────────────
	{
		provider: 'fal',
		operation: 'image',
		model: 'nano-banana-2 (product still / avatar)',
		usd: 0.08
	},
	{ provider: 'fal', operation: 'image', model: 'flux-schnell (scene fallback)', usd: 0.003 },
	// 0.42 matches the models.ts catalog + registry default — the ledger bills the
	// catalog/registry rate, so a different number here would put two "truths" on
	// screen for the same clip.
	{ provider: 'fal', operation: 'video', model: 'kling-o3-standard i2v ~5s (b-roll)', usd: 0.42 },
	{
		provider: 'fal',
		operation: 'video',
		model: 'kling-o3-pro reference (cinematic, per shot-set)',
		usd: 1.6
	},
	// Video-to-video bills per VIDEO SECOND, not per call — this row is the
	// PER-SECOND rate, and the ledger must multiply it by the probed duration of
	// the source clip. Measured 2026-09-09: 2.6s at 720p billed ~$0.21, matching
	// the published 480p $0.04 / 580p $0.06 / 720p $0.08 at a 16fps basis. 580p
	// is the shipped default (see MODEL_CATALOG), so 0.06 is the number here.
	{
		provider: 'fal',
		operation: 'video',
		model: 'wan-2.2-animate replace/move (per source second)',
		usd: 0.06,
		note: 'per SECOND of the source clip at 580p — multiply by probed duration'
	},
	{ provider: 'fal', operation: 'tts', model: 'elevenlabs turbo-v2.5', usd: 0.03 },
	{
		provider: 'fal',
		operation: 'talking_head',
		model: 'bytedance omnihuman v1.5 (~5s @ $0.14/s)',
		usd: 0.7
	},
	// ── OpenRouter (text primary + media failover) ─────────────────────────
	{
		provider: 'openrouter',
		operation: 'llm',
		model: 'gemini-3.5-flash (director/grader/captions)',
		usd: 0.002
	},
	// Was recorded as 'flux-schnell' @ $0.02 — both wrong. That model id 404s on
	// OpenRouter (see UGC_IMAGE_MODEL_OPENROUTER in content/generate.ts, which
	// has called google/gemini-3.1-flash-image since the 404 fix). Nano Banana 2
	// bills image output at $60/M tokens and Google emits 1290 tokens per image
	// → $0.077. The old $0.02 under-billed every OpenRouter still by ~3.9x, which
	// also under-counted it against the per-seat spend caps.
	{
		provider: 'openrouter',
		operation: 'image',
		model: 'gemini-3.1-flash-image (nano banana 2)',
		usd: 0.077,
		note: '$60/M output tokens x 1290 tokens/image'
	},
	{
		provider: 'openrouter',
		operation: 'video',
		model: 'kling-v3.0-std i2v ~5s (failover)',
		usd: 0.35
	},
	// ── Gemini direct (env-key text fallback) ──────────────────────────────
	{ provider: 'gemini', operation: 'llm', model: 'gemini-3.5-flash', usd: 0.002 },
	// ── Firecrawl (store / product page scrapes) ───────────────────────────
	// Standard plan: $16 / 3,000 credits, 1 credit per scraped page → $0.0053.
	// Rounded to a cent-fraction that survives the retail ceil at 3× (2 credits).
	{ provider: 'firecrawl', operation: 'scrape', model: 'v1/scrape (per page)', usd: 0.0053 },
	// ── Zernio (posting; pay-per-connected-account, not per-call) ──────────
	{
		provider: 'zernio',
		operation: 'publish',
		model: 'pay-per-account: 2 free, then $6/$3/$1 per account/mo',
		usd: 0,
		note: 'per connected account/mo, not per-call'
	}
];

/** Looks up the estimated USD for a provider+operation (first match). */
export function priceOf(provider: string, operation: string, modelHint?: string): number {
	const rows = PRICING_MATRIX.filter((p) => p.provider === provider && p.operation === operation);
	if (modelHint) {
		const hinted = rows.find((r) => r.model.toLowerCase().includes(modelHint.toLowerCase()));
		if (hinted) return hinted.usd;
	}
	return rows[0]?.usd ?? 0;
}

export interface CostEvent {
	provider: string;
	operation: string;
	model: string;
	/**
	 * What the customer is billed against, from the table above. This stays the
	 * billing basis even when `measuredUsd` is present — see the note there.
	 */
	usd: number;
	/** Tokens the provider reported, when it reported any. */
	tokensIn?: number | null;
	tokensOut?: number | null;
	/**
	 * What the PROVIDER says the call cost, when it says anything (OpenRouter
	 * returns this on every response; Gemini does not).
	 *
	 * Recorded, NOT billed. The number quoted to the user before the run comes
	 * from the same table `usd` does, and this codebase treats "the quote is an
	 * upper bound on the bill" as a promise — so a measured cost higher than the
	 * table cannot silently become the charge. The fix for a wrong price is to
	 * correct the TABLE, which moves the quote and the bill together. This column
	 * is what makes that correction measurable instead of guessed.
	 */
	measuredUsd?: number | null;
	/** Durable bucket URL of the asset this event produced, if any — recorded in
	 * the generation_events ledger so every spent generation is recoverable. */
	assetUrl?: string;
}

/** Sums events into { total, byProvider } for display/storage. */
export function summarizeCosts(events: CostEvent[]): {
	total: number;
	byProvider: Record<string, number>;
} {
	const byProvider: Record<string, number> = {};
	let total = 0;
	for (const e of events) {
		byProvider[e.provider] = +((byProvider[e.provider] ?? 0) + e.usd).toFixed(6);
		total = +(total + e.usd).toFixed(6);
	}
	return { total, byProvider };
}

/** Human labels for cost/provenance operations, for the observability panel. */
export const OPERATION_LABELS: Record<string, string> = {
	llm: 'Script & caption (LLM)',
	// Neutral on purpose: this row also covers typographic cards, face-only and
	// no-reference stills — "Product still" would claim a product that many
	// compositions deliberately exclude.
	image: 'Still (image)',
	video: 'Motion clip (video)',
	tts: 'Voiceover (TTS)',
	talking_head: 'Talking head',
	persist: 'Media storage',
	// Seeded by refine when a pre-observability post carries spend with no
	// per-aspect record — keeps the aspect table summing to its own Total.
	prior: 'Earlier run (details not recorded)'
};

/** One aspect of a generation: which model(s) ran and what it cost. */
export interface AspectProvenance {
	models: string[];
	usd: number;
}

/**
 * Full provenance for one generation — the observability record shown in the
 * post drawer. Derived from the cost ledger (`aspects`/`total`) plus the inputs
 * and selections captured at generation time.
 */
export interface GenerationProvenance {
	/** Per-operation: models used + summed cost (from the cost ledger). */
	aspects: Record<string, AspectProvenance>;
	total: number;
	/** The input images actually SENT to the models. */
	images?: {
		character_ref?: string | null;
		product_photo?: string | null;
		reference_kit?: string[];
	};
	/** How the still was composed: photorealistic UGC composite vs a typographic
	 *  card whose text IS the artwork (no references, no photorealism). */
	still_style?: 'photo' | 'graphic';
	/** The composition contract obeyed — a null ref under `false` here is
	 *  deliberate ("no product in this composition"), not lost provenance.
	 *  Refine reads this to avoid resurrecting refs the template excluded. */
	refs_policy?: { character: boolean; product: boolean };
	/** The exact line rendered onto a graphic card (still_style 'graphic'). */
	card_text?: string;
	/** The card layout that was pinned, when the user chose one instead of
	 *  letting the renderer read the text. A refine reuses it so re-running for a
	 *  better image cannot silently re-shape an approved card. */
	card_layout?: 'statement' | 'quote' | 'stack' | 'list' | 'split';
	/** false when a locally-assembled format (a motion card) could not be built on
	 *  this host and shipped as a still instead — the record has to explain why a
	 *  video format produced an image. */
	motion_assembled?: boolean;
	/** 'supplied' means the user handed us the still and no image model ran —
	 *  which is why this record has no image cost event and no images row. */
	still_source?: 'generated' | 'supplied';
	/**
	 * The listicle's list, when one was written.
	 *
	 * Present whenever the Director produced items — even if the on-screen
	 * reveals could not be burned. `assembled` is what separates the two, and it
	 * needs its own field because `motion_assembled` cannot carry it: that flag
	 * means "a motion card shipped as a still", i.e. a video format that produced
	 * an IMAGE. A listicle whose reveals failed still shipped a video, with the
	 * items spoken but never shown. Reusing one boolean for both would make a
	 * reader unable to tell which of two quite different degradations happened.
	 *
	 * `beats` is the billing basis: one voiceover call per beat, which is the
	 * only way the reveals can be timed to speech rather than guessed. Recording
	 * it makes "why did this post cost 4x a spokesperson?" answerable.
	 */
	listicle?: {
		/** The on-screen labels, in order. */
		items?: string[];
		/** Voiceover calls made: the framing line plus one per item. */
		beats?: number;
		/** False when the items were spoken but the reveals could not be burned. */
		assembled?: boolean;
	};
	/**
	 * The video-to-video transfer, when one ran. Present ONLY on a run that
	 * actually reached the v2v provider — a run that fell back to image-to-video
	 * must not carry it, because that is the whole point of the truth contract.
	 *
	 * `billed_seconds` is here rather than only inside a ledger model label
	 * because this stage is the first whose price scales with a user-supplied
	 * input: without a queryable number, "why did this post cost $1.80?" can only
	 * be answered by parsing prose, and a per-second charge nobody can audit is
	 * indistinguishable from a wrong one.
	 */
	v2v?: {
		/** 'replace' inherits the source scene; 'move' keeps the persona's own. */
		mode?: 'replace' | 'move';
		/** The durable source clip the transfer re-performed. */
		source_video?: string | null;
		/** The MEASURED duration billed, including its fraction. */
		billed_seconds?: number;
		/** Rate actually applied, so a later catalog change cannot rewrite history. */
		usd_per_second?: number;
		/** Pinned at generation time; it sets the per-second rate. */
		resolution?: string;
		/** The full-body reference sent — never the pinned bust crop, which makes
		 *  the model invent a lower body. Recorded so a bad output is diagnosable. */
		reference?: string | null;
	};
	/** The prompts sent to the models. */
	prompts?: { scene?: string; script?: string };
	/** What was selected during generation. */
	selections?: {
		platforms?: string[];
		brand?: string | null;
		videoModel?: string | null;
		provider?: string | null;
		mediaType?: string | null;
		/** What the caller ASKED for. What actually ran is in `aspects` — the two
		 *  differ whenever a failover kicked in, and both are worth keeping. */
		videoModelRequested?: string | null;
		stillModelRequested?: string | null;
		/** The lip-sync model requested — the dearest single call in a spokesperson
		 *  post, and now a user choice. */
		talkingHeadModel?: string | null;
		/** The Director LLM requested. Ignored at run time unless it matches the
		 *  provider the user's keys resolve to. */
		llmModel?: string | null;
		/** The realism register pinned for this run ('third' = no clause added). */
		framing?: 'front' | 'mirror' | 'third' | null;
		/** The voice actually used, after persona-gender agreement. */
		voice?: string | null;
	};
}

/**
 * Groups a generation's cost events by operation into a per-aspect provenance
 * matrix — which model(s) ran for each aspect and what each aspect cost. Storage
 * ('persist', $0) is folded out. Powers the observability panel: models-per-
 * aspect + the pricing breakdown, both derived from the same ledger the ledger
 * table records, so the panel never drifts from what was actually spent.
 */
export function summarizeAspects(events: CostEvent[]): {
	aspects: Record<string, AspectProvenance>;
	total: number;
} {
	const aspects: Record<string, AspectProvenance> = {};
	let total = 0;
	for (const e of events) {
		if (e.operation === 'persist') continue;
		const a = (aspects[e.operation] ||= { models: [], usd: 0 });
		if (e.model && !a.models.includes(e.model)) a.models.push(e.model);
		a.usd = +(a.usd + e.usd).toFixed(6);
		total = +(total + e.usd).toFixed(6);
	}
	return { aspects, total };
}
