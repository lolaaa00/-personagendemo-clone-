/**
 * Provider pricing matrix — single source of truth for generation cost
 * ESTIMATES (providers don't return uniform per-call costs, so we account
 * with a rate table; tune via env UGC_PRICING_JSON without a code change).
 *
 * Client-safe (no $env/server imports) so both the UI matrix and the server
 * cost tracker read the same numbers. All values are USD per call.
 */

export interface PriceEntry {
	provider: 'fal' | 'openrouter' | 'gemini' | 'zernio';
	operation: string;
	model: string;
	/** Estimated USD per call. */
	usd: number;
	note?: string;
}

export const PRICING_MATRIX: PriceEntry[] = [
	// ── fal.ai (primary media) ──────────────────────────────────────────────
	{ provider: 'fal', operation: 'image', model: 'nano-banana-2 (product still / avatar)', usd: 0.08 },
	{ provider: 'fal', operation: 'image', model: 'flux-schnell (scene fallback)', usd: 0.003 },
	{ provider: 'fal', operation: 'video', model: 'kling-o3-standard i2v ~5s (b-roll)', usd: 0.5 },
	{ provider: 'fal', operation: 'video', model: 'kling-o3-pro reference (cinematic, per shot-set)', usd: 1.6 },
	{ provider: 'fal', operation: 'tts', model: 'elevenlabs turbo-v2.5', usd: 0.03 },
	{ provider: 'fal', operation: 'talking_head', model: 'veed/fabric-1.0 720p', usd: 0.4 },
	// ── OpenRouter (text primary + media failover) ─────────────────────────
	{ provider: 'openrouter', operation: 'llm', model: 'gemini-3.5-flash (director/grader/captions)', usd: 0.002 },
	{ provider: 'openrouter', operation: 'image', model: 'flux-schnell', usd: 0.02 },
	{ provider: 'openrouter', operation: 'video', model: 'kling-v3.0-std i2v ~5s (failover)', usd: 0.35 },
	// ── Gemini direct (env-key text fallback) ──────────────────────────────
	{ provider: 'gemini', operation: 'llm', model: 'gemini-3.5-flash', usd: 0.002 },
	// ── Zernio (posting; pay-per-connected-account, not per-call) ──────────
	{ provider: 'zernio', operation: 'publish', model: 'pay-per-account: 2 free, then $6/$3/$1 per account/mo', usd: 0, note: 'per connected account/mo, not per-call' }
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
	usd: number;
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
		byProvider[e.provider] = +(((byProvider[e.provider] ?? 0) + e.usd).toFixed(6));
		total = +((total + e.usd).toFixed(6));
	}
	return { total, byProvider };
}

/** Human labels for cost/provenance operations, for the observability panel. */
export const OPERATION_LABELS: Record<string, string> = {
	llm: 'Script & caption (LLM)',
	image: 'Product still (image)',
	video: 'Motion clip (video)',
	tts: 'Voiceover (TTS)',
	talking_head: 'Talking head',
	persist: 'Media storage'
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
	/** The prompts sent to the models. */
	prompts?: { scene?: string; script?: string };
	/** What was selected during generation. */
	selections?: {
		platforms?: string[];
		brand?: string | null;
		videoModel?: string | null;
		provider?: string | null;
		mediaType?: string | null;
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
