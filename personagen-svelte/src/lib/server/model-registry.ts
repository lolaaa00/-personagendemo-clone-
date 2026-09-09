import type { SupabaseClient } from '@supabase/supabase-js';
import {
	MODEL_CATALOG,
	DEFAULT_MODEL,
	modelsFor,
	resolveModel,
	type ModelKind,
	type ModelOption
} from '$lib/models';

/**
 * Model Registry — DB-backed model catalog behind the Model Manager.
 *
 * Two populations share the table:
 *   wired=true   — models with a code adapter (seeded from MODEL_CATALOG).
 *                  Enable/disable, price, quality, and per-kind default here
 *                  genuinely steer the composer picker and the resolve
 *                  endpoints.
 *   wired=false  — discovered via the fal catalog sync. Fully visible
 *                  (date, lab, price, schema probe) but STAGED: they cannot
 *                  generate until an adapter ships.
 *
 * Failure posture: every read path falls back to the static catalog, so an
 * empty or unreachable registry means today's exact behavior — the registry
 * can only ever refine generation, never brick it.
 */

/**
 * The kinds a REGISTRY ROW can carry — the vocabulary of the `kind` column,
 * pinned by a CHECK constraint in model_registry_migration.sql (and repeated in
 * client_bootstrap.sql). Written out rather than derived from ModelKind, which
 * it used to be (`ModelKind | 'tts'`).
 *
 * That derivation was only ever right by accident: the two sets answer
 * different questions and now overlap without either containing the other.
 * ModelKind is what the composer can select and resolve (talking_head and llm
 * joined it; neither is in the DB's CHECK, so no row can name them until a
 * migration widens it). RegistryKind is what a row may say (tts is registry-
 * only — there is no ModelOption for a voice, and effectiveResolve cannot serve
 * it). Deriving one from the other made adding a kind on either side silently
 * claim the other side supported it — for the DB that means an INSERT that
 * fails the CHECK, which is exactly what the seed below must never do.
 */
const REGISTRY_KINDS = ['image_t2i', 'image_edit', 'video_i2v', 'tts'] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

/**
 * Can a row of this kind exist at all? False for the catalog-only modes, which
 * is what tells the seed and the resolvers to leave the database out of it.
 */
export function isRegistryKind(kind: string): kind is RegistryKind {
	return (REGISTRY_KINDS as readonly string[]).includes(kind);
}

export type RegistryProvider = 'fal' | 'openrouter';
/** Where a row came from. Travels with the row; the page never infers it. */
export type RegistryOrigin = 'seed' | 'fal_catalog' | 'openrouter_catalog' | 'manual';

export interface RegistryRow {
	id: string;
	/** NULL on a platform-owned row (shared catalog); a user id on a legacy per-user row. */
	user_id: string | null;
	/** Which API serves this model — decides the call adapter and the sync that owns it. */
	provider: RegistryProvider;

	origin: RegistryOrigin;
	model_id: string;
	/** Primary mode — display, grouping and default selection. */
	kind: RegistryKind;
	/** Every mode this model serves. Superset of `kind`; what resolution matches on. */
	kinds: RegistryKind[] | null;
	/** Provider-declared capabilities, verbatim — lets an unmapped mode be recognised later. */
	input_modalities: string[] | null;
	output_modalities: string[] | null;
	label: string;
	lab: string | null;
	released_at: string | null;
	price_usd: number | null;
	pricing_text: string | null;
	/** How price_usd was derived — audit trail for token-billed providers. */
	price_basis: string | null;
	price_source: 'seed' | 'parsed' | 'manual';
	quality: number | null;
	tier: 'budget' | 'balanced' | 'premium' | null;
	latency_s: number | null;
	status: 'active' | 'disabled' | 'available' | 'quarantined';
	wired: boolean;
	is_default: boolean;
	deprecated: boolean;
	multi_ref: boolean | null;
	supports_audio: boolean | null;
	supports_duration: boolean | null;
	size_param: string | null;
	probe: Record<string, unknown> | null;
	note: string | null;
	discovered_at: string | null;
	created_at: string;
	updated_at: string;
}

// ── Seed metadata for the wired catalog ─────────────────────────────────────
// Release dates and labs come from fal's catalog where verified; quality (1-10)
// and latency are curated starting estimates the client edits in the manager.
const WIRED_SEED: Record<
	string,
	{ lab: string; released: string | null; quality: number; latency: number }
> = {
	'fal-ai/flux/schnell': {
		lab: 'Black Forest Labs',
		released: '2024-08-01',
		quality: 4,
		latency: 2
	},
	'fal-ai/qwen-image': { lab: 'Alibaba', released: '2025-08-04', quality: 5, latency: 4 },
	'fal-ai/flux/dev': { lab: 'Black Forest Labs', released: '2024-08-01', quality: 6, latency: 8 },
	'fal-ai/flux-pro/v1.1': {
		lab: 'Black Forest Labs',
		released: '2024-10-02',
		quality: 7,
		latency: 8
	},
	'fal-ai/nano-banana-2': { lab: 'Google', released: '2026-02-26', quality: 9, latency: 15 },
	'fal-ai/nano-banana-2/edit': { lab: 'Google', released: '2026-02-26', quality: 9, latency: 18 },
	'fal-ai/flux-pro/kontext': {
		lab: 'Black Forest Labs',
		released: '2025-05-29',
		quality: 7,
		latency: 10
	},
	'fal-ai/qwen-image-edit': { lab: 'Alibaba', released: '2025-08-18', quality: 5, latency: 8 },
	'fal-ai/wan-i2v': { lab: 'Alibaba', released: '2025-02-26', quality: 4, latency: 90 },
	'fal-ai/minimax/hailuo-02/standard/image-to-video': {
		lab: 'MiniMax',
		released: '2025-06-18',
		quality: 6,
		latency: 150
	},
	'fal-ai/kling-video/o3/standard/image-to-video': {
		lab: 'Kling',
		released: '2026-02-04',
		quality: 7,
		latency: 180
	},
	'fal-ai/kling-video/o3/pro/image-to-video': {
		lab: 'Kling',
		released: '2026-02-04',
		quality: 8,
		latency: 240
	},
	'fal-ai/veo3.1/image-to-video': {
		lab: 'Google',
		released: '2025-10-15',
		quality: 9,
		latency: 240
	}
};

/**
 * The OpenRouter video failover, as a catalog row.
 *
 * It is the model the ledger showed running that the Model Manager could not
 * name: OpenRouter's video API is separate from /api/v1/models, so no catalog
 * sync can ever discover it. Seeded UNWIRED on purpose — listing it makes it
 * visible, priceable and reconcilable against generation_events, while the
 * route keeps resolving to the compiled-in constant until an admin wires it.
 * Wiring it deliberately is what hands the registry authority over the id.
 */
const OR_VIDEO_SEED: Omit<RegistryRow, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
	provider: 'openrouter',
	origin: 'seed',
	model_id: 'kwaivgi/kling-v3.0-std',
	kind: 'video_i2v',
	kinds: ['video_i2v'],
	input_modalities: ['image', 'text'],
	output_modalities: ['video'],
	label: 'Kling v3.0 Standard (OpenRouter failover)',
	lab: 'Kling',
	released_at: null,
	price_usd: 0.35,
	pricing_text: null,
	price_basis: 'OpenRouter video API, ~5s clip',
	price_source: 'seed',
	quality: 7,
	tier: 'balanced',
	latency_s: 180,
	status: 'available',
	wired: false,
	is_default: false,
	deprecated: false,
	multi_ref: null,
	supports_audio: null,
	supports_duration: null,
	size_param: null,
	probe: null,
	note: 'Runs only when fal is down. OpenRouter serves video from a separate API, so no catalog sync lists it — this row is how it stays visible and priced.',
	discovered_at: null
};

const TTS_SEED: Omit<RegistryRow, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
	provider: 'fal',
	origin: 'seed',
	model_id: 'fal-ai/elevenlabs/tts/turbo-v2.5',
	kind: 'tts',
	kinds: ['tts'],
	input_modalities: ['text'],
	output_modalities: ['audio'],
	label: 'ElevenLabs Turbo v2.5',
	lab: 'ElevenLabs',
	released_at: '2024-07-01',
	price_usd: 0.03,
	pricing_text: null,
	price_basis: null,
	price_source: 'seed',
	quality: 8,
	tier: 'balanced',
	latency_s: 3,
	status: 'active',
	wired: true,
	is_default: true,
	deprecated: false,
	multi_ref: null,
	supports_audio: null,
	supports_duration: null,
	size_param: null,
	probe: null,
	note: 'Kept deliberately: pinned persona voices depend on this voice catalog. Newer TTS models change voice ids.',
	discovered_at: null
};

/**
 * Which copy of the catalog a request reads and writes.
 *
 * A row with user_id NULL is PLATFORM-owned: every authenticated user reads it,
 * only a platform admin writes it (RLS). Per-user rows predate that and stay
 * live for their owner, so the rollout breaks nothing. Once ANY platform row
 * exists it IS the catalog — reading both would let a stale personal copy win
 * over the shared one, which is the drift this replaces.
 *
 * Queries filter on owner_key, a stored generated column that maps NULL to
 * PLATFORM_OWNER_KEY, so one .eq() covers both scopes and no call site has to
 * branch. The sentinel is duplicated in model_registry_platform_migration.sql —
 * change it in both or uniqueness and filtering disagree.
 */
export const PLATFORM_OWNER_KEY = '00000000-0000-0000-0000-000000000000';

export interface RegistryScope {
	platform: boolean;
	userId: string;
}

export async function resolveScope(
	supabase: SupabaseClient,
	userId: string
): Promise<RegistryScope> {
	const { count, error } = await supabase
		.from('model_registry')
		.select('id', { count: 'exact', head: true })
		.is('user_id', null);
	if (error) throw error;
	return { platform: (count ?? 0) > 0, userId };
}

/** The owner_key every read/write in this scope filters on. */
export function scopeKey(scope: RegistryScope): string {
	return scope.platform ? PLATFORM_OWNER_KEY : scope.userId;
}

/** The user_id an INSERT in this scope must carry (owner_key is generated). */
export function scopeOwner(scope: RegistryScope): string | null {
	return scope.platform ? null : scope.userId;
}

/** Loads the catalog for this user: the platform one when it exists, else the
 *  user's own rows, seeding them from the static catalog on first use. */
export async function loadRegistry(
	supabase: SupabaseClient,
	userId: string
): Promise<RegistryRow[]> {
	// ONE round trip on a hot path: every generation resolves its model through
	// here, so both scopes are fetched together and partitioned in memory rather
	// than paying a scope probe before the read. Platform rows win outright when
	// they exist — reading both would let a stale personal copy override the
	// shared catalog.
	const { data, error } = await supabase
		.from('model_registry')
		.select('*')
		.or(`user_id.is.null,user_id.eq.${userId}`)
		.order('released_at', { ascending: false, nullsFirst: false });
	if (error) throw error;
	const rows = (data ?? []) as RegistryRow[];
	const platform = rows.filter((r) => r.user_id === null);
	if (platform.length > 0) return platform;
	const own = rows.filter((r) => r.user_id === userId);
	if (own.length > 0) return own;
	const scope: RegistryScope = { platform: false, userId };

	// First visit: seed the wired catalog so the manager opens populated and
	// the resolve endpoints have rows to honor.
	// EVERY row must carry the IDENTICAL key set: PostgREST turns a mixed-shape
	// bulk insert into one statement over the union of columns, filling absent
	// keys with NULL — which bypasses column defaults and violates NOT NULLs
	// (this exact bug shipped once: seeds omitted `deprecated`, TTS didn't).
	// Catalog-only kinds (talking_head, llm) are filtered OUT: the `kind` column's
	// CHECK constraint rejects them, and PostgREST sends this seed as ONE
	// statement — a single rejected row fails the whole insert, throws here, and
	// leaves a first-visit user with an empty Model Manager. They stay in
	// MODEL_CATALOG and resolve statically instead, which is why the new stages
	// ship with no migration.
	const seeds = MODEL_CATALOG.filter((m) => isRegistryKind(m.kind)).map((m) => {
		const extra = WIRED_SEED[m.id];
		return {
			user_id: scopeOwner(scope),
			// The wired catalog is fal-only; OpenRouter rows arrive via
			// syncFromOpenRouter, never through this seed.
			provider: 'fal' as RegistryProvider,
			model_id: m.id,
			kind: m.kind as RegistryKind,
			// The wired catalog declares one mode per adapter — an adapter IS the
			// mode-specific call. A fal model that also serves another mode gets a
			// second catalog entry, so kinds mirrors kind here rather than widening.
			kinds: [m.kind as RegistryKind],
			input_modalities: null as string[] | null,
			output_modalities: null as string[] | null,
			label: m.label,
			lab: extra?.lab ?? null,
			released_at: extra?.released ?? null,
			price_usd: m.usd,
			pricing_text: null as string | null,
			price_basis: null as string | null,
			price_source: 'seed',
			quality: extra?.quality ?? null,
			tier: m.tier,
			latency_s: extra?.latency ?? null,
			status: 'active',
			wired: true,
			is_default: DEFAULT_MODEL[m.kind] === m.id,
			deprecated: false,
			multi_ref: m.multiRef ?? null,
			supports_audio: m.supportsAudio ?? null,
			supports_duration: m.supportsDuration ?? null,
			size_param: m.sizeParam ?? null,
			probe: null as Record<string, unknown> | null,
			note: m.caveat ? `${m.note} ⚠ ${m.caveat}` : m.note,
			origin: 'seed' as RegistryOrigin,
			discovered_at: null as string | null
		};
	});
	// ignoreDuplicates makes concurrent first-visits race-safe: two requests
	// seeding at once both succeed (one inserts, one no-ops on the
	// user_id+model_id unique key) instead of one throwing and falling back to
	// the static catalog for that request.
	const { error: insertErr } = await supabase
		.from('model_registry')
		.upsert(
			[
				...seeds,
				{ user_id: scopeOwner(scope), ...TTS_SEED },
				{ user_id: scopeOwner(scope), ...OR_VIDEO_SEED }
			],
			{
				onConflict: 'owner_key,model_id',
				ignoreDuplicates: true
			}
		);
	if (insertErr) throw insertErr;
	const { data: seeded, error: reselectErr } = await supabase
		.from('model_registry')
		.select('*')
		.eq('owner_key', scopeKey(scope))
		.order('released_at', { ascending: false, nullsFirst: false });
	if (reselectErr) throw reselectErr;
	return (seeded ?? []) as RegistryRow[];
}

// ── Effective catalog: what the composer and resolvers actually honor ───────

function rowToOption(row: RegistryRow): ModelOption {
	const staticEntry = MODEL_CATALOG.find((m) => m.id === row.model_id);
	return {
		id: row.model_id,
		label: row.label,
		provider: 'fal',
		kind: row.kind as ModelKind,
		tier: row.tier ?? staticEntry?.tier ?? 'balanced',
		usd: row.price_usd ?? staticEntry?.usd ?? 0,
		// The row's own probed capabilities win over the static entry — for a
		// discovered (swapped-in) model there IS no static entry, and ignoring the
		// probe here silently stripped the flags the request builder relies on.
		// ModelOption's sizeParam is a closed union; the probe stores the raw param
		// name, so only pass it through when it IS one of the driveable values.
		sizeParam:
			row.size_param === 'image_size' || row.size_param === 'aspect_ratio'
				? row.size_param
				: staticEntry?.sizeParam,
		multiRef: row.multi_ref ?? staticEntry?.multiRef,
		note: row.note ?? staticEntry?.note ?? '',
		caveat: staticEntry?.caveat,
		supportsAudio: row.supports_audio ?? staticEntry?.supportsAudio,
		supportsDuration: row.supports_duration ?? staticEntry?.supportsDuration
	};
}

/**
 * The selectable models for a kind: ACTIVE wired registry rows, with registry
 * price/tier/note overlaid on the static adapter facts. Empty (all disabled)
 * or errored → full static list, so generation is never brickable from the
 * manager.
 */
/**
 * Does this row serve `kind`? Matches the full mode set, falling back to the
 * primary `kind` for rows written before multi-mode (and for any row whose
 * kinds[] didn't backfill) — so a legacy row keeps behaving exactly as before.
 */
export function servesKind(row: RegistryRow, kind: RegistryKind): boolean {
	const modes = row.kinds && row.kinds.length > 0 ? row.kinds : [row.kind];
	return modes.includes(kind);
}

export function effectiveOptions(rows: RegistryRow[], kind: ModelKind): ModelOption[] {
	// A kind the registry cannot hold has nothing to overlay: the static catalog
	// IS the effective catalog. This is the whole no-migration story — on a
	// production database that has never heard of talking_head or llm, these
	// stages still list every model and still resolve.
	if (!isRegistryKind(kind)) return modelsFor(kind);
	// fal call sites only: rows served here are posted to fal endpoints, so
	// OpenRouter rows are excluded and routed by openRouterRoute() instead. (The
	// static llm entries name openrouter/gemini providers, but they never reach
	// this branch — llm is not a RegistryKind.)
	const active = rows.filter(
		(r) => r.provider !== 'openrouter' && servesKind(r, kind) && r.wired && r.status === 'active'
	);
	if (active.length === 0) return modelsFor(kind);
	return active.map(rowToOption).sort((a, b) => a.usd - b.usd);
}

/**
 * Registry-aware resolveModel: honors the manager's enable/disable and
 * per-kind default star. A requested model that is disabled (or unknown)
 * resolves to the default rather than running.
 */
export function effectiveResolve(
	rows: RegistryRow[],
	kind: ModelKind,
	requested?: string | null
): ModelOption {
	// Catalog-only kinds resolve exactly as they would with no registry at all —
	// a requested id that isn't in the catalog becomes that kind's default, so an
	// unknown model id never reaches a provider.
	if (!isRegistryKind(kind)) return resolveModel(kind, requested);
	const options = effectiveOptions(rows, kind);
	const found = requested ? options.find((m) => m.id === requested) : undefined;
	if (found) return found;
	const def = rows.find(
		(r) =>
			r.provider !== 'openrouter' &&
			servesKind(r, kind) &&
			r.wired &&
			r.status === 'active' &&
			r.is_default
	);
	if (def) {
		const opt = options.find((m) => m.id === def.model_id);
		if (opt) return opt;
	}
	return (
		options.find((m) => m.id === DEFAULT_MODEL[kind]) ?? options[0] ?? resolveModel(kind, requested)
	);
}

// ── Discovery sync (OpenRouter catalog — no key required for /models) ───────

/**
 * Google documents every Gemini image generation as a flat 1290 output tokens,
 * which is what turns OpenRouter's per-token rate into a per-image price. It is
 * an ASSUMPTION for any non-Gemini image model, so the derivation is written
 * into price_basis rather than buried — and a manual price always wins.
 */
const GEMINI_TOKENS_PER_IMAGE = 1290;
/** Per-call accounting convention elsewhere in this app: one clip is ~5s. */
const CLIP_SECONDS = 5;

/**
 * Turns an OpenRouter catalog entry into a per-call USD estimate.
 *
 * OpenRouter prices everything per TOKEN (strings, USD/token). Image-output
 * models bill the image through `completion`, so a per-image figure needs the
 * token count above. Returns the basis string alongside so the number can be
 * audited instead of trusted.
 */
export function openRouterPerCallPrice(model: any): { usd: number | null; basis: string | null } {
	const outputs: string[] = model?.architecture?.output_modalities ?? [];

	if (outputs.includes('image')) {
		// `image_output` is the rate that actually bills a generated image.
		// NOT `completion` — that's the TEXT output rate and is ~20x lower on
		// these models ($3/M vs $60/M on Nano Banana 2), so using it silently
		// under-prices every image. Verified against OpenRouter's live response.
		const imageOut = Number(model?.pricing?.image_output);
		if (Number.isFinite(imageOut) && imageOut > 0) {
			const perM = imageOut * 1_000_000;
			return {
				usd: +(imageOut * GEMINI_TOKENS_PER_IMAGE).toFixed(4),
				basis: `$${perM.toFixed(2)}/M image-output tokens x ${GEMINI_TOKENS_PER_IMAGE} tokens/image`
			};
		}
		// An image model with no image_output rate is unpriceable here — say so
		// rather than substituting the text rate and being confidently wrong.
		return { usd: null, basis: null };
	}
	// Video on OpenRouter is billed per second on the request price where present.
	const request = Number(model?.pricing?.request);
	if (outputs.includes('video') && Number.isFinite(request) && request > 0) {
		return {
			usd: +(request * CLIP_SECONDS).toFixed(4),
			basis: `$${request}/s x ${CLIP_SECONDS}s clip`
		};
	}
	// Text models: priced per token, genuinely variable per call — leave null so
	// the manager shows "needs a price" rather than inventing one.
	return { usd: null, basis: null };
}

/**
 * The OpenRouter route actually in force for a kind: an ACTIVE, wired registry
 * row wins; otherwise the caller's compiled-in default stands.
 *
 * This is the fix for the drift that motivated multi-provider support — the
 * image route moved to Nano Banana 2 in code while pricing.ts still billed
 * flux-schnell, because nothing tied the two together. Resolving through the
 * registry means the id AND its price come from one row, and a re-sync
 * refreshes the price from OpenRouter's own response.
 *
 * Never throws and never returns null: an empty/unreachable registry yields
 * exactly today's behaviour.
 */
export function openRouterRoute(
	rows: RegistryRow[],
	kind: RegistryKind,
	fallbackId: string,
	fallbackUsd: number
): { id: string; usd: number; fromRegistry: boolean } {
	const row = rows.find(
		(r) =>
			r.provider === 'openrouter' &&
			servesKind(r, kind) &&
			r.wired &&
			r.status === 'active' &&
			!r.deprecated
	);
	if (row && row.price_usd != null) {
		return { id: row.model_id, usd: Number(row.price_usd), fromRegistry: true };
	}
	return { id: fallbackId, usd: fallbackUsd, fromRegistry: false };
}

/**
 * The model a pipeline mode runs on: the registry's starred, wired, active row
 * for that mode, else the caller's compiled-in constant.
 *
 * openRouterRoute() answers the same question for OpenRouter failover routes
 * and takes the first wired row because OpenRouter rows carry no star. This one
 * honours the star, which is what makes the Model Manager's Default column mean
 * something for fal modes — including tts, which effectiveResolve cannot serve
 * (ModelKind has no 'tts'; the voice catalog is registry-only). The reverse also
 * holds: talking_head and llm never reach this function, because the `kind`
 * column's CHECK constraint means no row can claim them.
 *
 * Fails OPEN to the fallback on an empty registry or a priceless row: choosing a
 * model must never block a generation.
 */
export function registryDefault(
	rows: RegistryRow[],
	kind: RegistryKind,
	provider: RegistryProvider,
	fallbackId: string,
	fallbackUsd: number
): { id: string; usd: number; fromRegistry: boolean } {
	const row = rows.find(
		(r) =>
			r.provider === provider &&
			servesKind(r, kind) &&
			r.wired &&
			r.status === 'active' &&
			!r.deprecated &&
			r.is_default
	);
	if (row && row.price_usd != null) {
		return { id: row.model_id, usd: Number(row.price_usd), fromRegistry: true };
	}
	return { id: fallbackId, usd: fallbackUsd, fromRegistry: false };
}

/** The PRIMARY mode — index 0 of openRouterKinds(). Null for text/chat models. */
export function openRouterKind(model: any): RegistryKind | null {
	return openRouterKinds(model)[0] ?? null;
}

/**
 * EVERY mode an OpenRouter model can serve, not just its headline one.
 *
 * Modern image endpoints are genuinely multi-mode: Nano Banana 2 takes text OR
 * image in and emits images, so it serves text-to-image AND editing from one
 * id. Returning a single kind forced a pick and hid the rest — the reason
 * hybrids filed as image_edit left image_t2i with no OpenRouter row at all.
 *
 * Order matters: index 0 becomes the row's primary `kind` (display + default
 * selection), and the full array is what resolution matches against.
 */
export function openRouterKinds(model: any): RegistryKind[] {
	const outputs: string[] = model?.architecture?.output_modalities ?? [];
	const inputs: string[] = model?.architecture?.input_modalities ?? [];
	const kinds: RegistryKind[] = [];

	if (outputs.includes('video')) kinds.push('video_i2v');
	if (outputs.includes('image')) {
		// Text in → can start a still from a prompt.
		if (inputs.includes('text')) kinds.push('image_t2i');
		// Image in → can transform an existing still.
		if (inputs.includes('image')) kinds.push('image_edit');
		// Neither declared (rare/malformed): keep it visible under t2i rather
		// than dropping a real image model on a missing metadata field.
		if (kinds.length === 0) kinds.push('image_t2i');
	}
	if (outputs.includes('audio')) kinds.push('tts');

	return kinds;
}

/**
 * Pulls OpenRouter's public catalog and upserts the image/video models into the
 * registry with prices taken from OpenRouter's own response.
 *
 * Same contract as syncFromFal: discovered rows land `wired: false` (visible and
 * priced, but they cannot generate until an adapter ships), a `manual` price is
 * never overwritten, and any failure returns errors rather than throwing — a
 * dead catalog must never break the Model Manager.
 */
export async function syncFromOpenRouter(
	supabase: SupabaseClient,
	userId: string,
	fetchFn: typeof fetch = fetch
): Promise<SyncResult> {
	const result: SyncResult = { discovered: 0, refreshed: 0, deprecatedFlagged: 0, errors: [] };
	const scope = await resolveScope(supabase, userId);

	const { data: existingRows, error: readErr } = await supabase
		.from('model_registry')
		.select('id, model_id, deprecated, price_source, wired, pricing_text, released_at, lab')
		.eq('owner_key', scopeKey(scope))
		.eq('provider', 'openrouter');
	if (readErr) throw readErr;
	const existing = new Map((existingRows ?? []).map((r: any) => [r.model_id, r]));

	let models: any[] = [];
	try {
		const res = await fetchFn('https://openrouter.ai/api/v1/models', {
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			result.errors.push(`OpenRouter catalog HTTP ${res.status}`);
			return result;
		}
		const body = (await res.json()) as any;
		models = Array.isArray(body?.data) ? body.data : [];
	} catch (e) {
		result.errors.push(`OpenRouter catalog fetch failed: ${(e as Error).message}`);
		return result;
	}

	const inserts: any[] = [];
	for (const m of models) {
		const kinds = openRouterKinds(m);
		if (kinds.length === 0) continue; // text-only: not a generation model
		const kind = kinds[0];
		const inputModalities: string[] = m?.architecture?.input_modalities ?? [];
		const outputModalities: string[] = m?.architecture?.output_modalities ?? [];

		const { usd, basis } = openRouterPerCallPrice(m);
		const prior = existing.get(m.id);
		const released = m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null;
		const lab = typeof m.id === 'string' && m.id.includes('/') ? m.id.split('/')[0] : null;

		if (!prior) {
			inserts.push({
				user_id: scopeOwner(scope),
				provider: 'openrouter',
				model_id: m.id,
				kind,
				kinds,
				input_modalities: inputModalities,
				output_modalities: outputModalities,
				label: m.name || m.id,
				lab,
				released_at: released,
				price_usd: usd,
				pricing_text: basis,
				price_basis: basis,
				price_source: usd == null ? 'seed' : 'parsed',
				quality: null,
				tier: null,
				latency_s: null,
				status: 'available',
				wired: false,
				is_default: false,
				deprecated: false,
				multi_ref: null,
				supports_audio: (m?.architecture?.output_modalities ?? []).includes('audio'),
				supports_duration: kind === 'video_i2v',
				size_param: null,
				probe: null,
				note: null,
				origin: 'openrouter_catalog' as RegistryOrigin,
				discovered_at: new Date().toISOString()
			});
			result.discovered++;
			continue;
		}

		// Refresh price ONLY when the operator hasn't pinned one by hand.
		if (prior.price_source !== 'manual' && usd != null) {
			const { error: upErr } = await supabase
				.from('model_registry')
				.update({
					price_usd: usd,
					pricing_text: basis,
					price_basis: basis,
					price_source: 'parsed',
					label: m.name || m.id,
					released_at: released ?? prior.released_at,
					lab: lab ?? prior.lab,
					// Capabilities are re-read every sync: a model that gains a mode
					// (image editing, native audio) starts serving it without a manual edit.
					kind,
					kinds,
					input_modalities: inputModalities,
					output_modalities: outputModalities,
					deprecated: false
				})
				.eq('id', prior.id);
			if (upErr) result.errors.push(`${m.id}: ${upErr.message}`);
			else result.refreshed++;
		}
	}

	if (inserts.length > 0) {
		const { error: insErr } = await supabase.from('model_registry').insert(inserts);
		if (insErr) {
			result.errors.push(`insert failed: ${insErr.message}`);
			result.discovered -= inserts.length;
		}
	}

	// A model that vanished from the catalog is flagged, never deleted — the
	// ledger still references it historically.
	const liveIds = new Set(models.map((m: any) => m.id));
	for (const [modelId, row] of existing) {
		if (!liveIds.has(modelId) && !row.deprecated) {
			const { error } = await supabase
				.from('model_registry')
				.update({ deprecated: true })
				.eq('id', row.id);
			if (!error) result.deprecatedFlagged++;
		}
	}

	return result;
}

// ── Discovery sync (fal catalog — no key required) ──────────────────────────

const CATEGORY_TO_KIND: Record<string, RegistryKind> = {
	'text-to-image': 'image_t2i',
	'image-to-image': 'image_edit',
	'image-to-video': 'video_i2v',
	'text-to-speech': 'tts'
};

/**
 * Unit-aware price parser for fal's pricingInfoOverride prose. Converts to a
 * per-call estimate matching the app's accounting conventions (a "call" is one
 * image, one ~5s clip, or one ~1k-char script). Returns null when pricing is
 * missing or genuinely variable (token-billed) — those models require a manual
 * price before they can ever be enabled.
 */
export function parsePriceText(text: string | null | undefined): {
	usd: number | null;
	basis: string | null;
} {
	if (!text) return { usd: null, basis: null };
	const t = text.replace(/\*/g, '');
	let m = t.match(/\$([\d.]+)\s*(?:per|\/)\s*(?:image|generation|request|video\b)/i);
	if (m) return { usd: +(+m[1]).toFixed(4), basis: 'per image/call' };
	// Per-second comes in both orders: "$0.08/sec" (Grok, Seedance) and
	// "every second … you will be charged $0.084" (Kling, MiniMax H3).
	m =
		t.match(/\$([\d.]+)\s*(?:per second|\/\s*sec(?:ond)?|\/s\b)/i) ??
		t.match(/(?:every|per)\s+second[^$]{0,80}\$([\d.]+)/i);
	if (m) return { usd: +(+m[1] * 5).toFixed(4), basis: 'per second × 5s clip' };
	m = t.match(/\$([\d.]+)[^.]{0,40}?(?:per|\/)\s*(?:1,?000)\s*char/i);
	if (m) return { usd: +(+m[1]).toFixed(4), basis: 'per 1,000 characters' };
	m = t.match(/\$([\d.]+)\s*per\s*megapixel/i);
	if (m) return { usd: +(+m[1]).toFixed(4), basis: 'per megapixel (1MP)' };
	if (/per 1 ?m(illion)? tokens/i.test(t)) return { usd: null, basis: 'token-billed (variable)' };
	// Last resort: a bare "$X" with a per-something we didn't classify — surface
	// nothing rather than a wrong number.
	return { usd: null, basis: null };
}

export interface SyncResult {
	discovered: number;
	refreshed: number;
	deprecatedFlagged: number;
	errors: string[];
}

/**
 * Pulls the newest fal catalog pages for the four relevant categories and
 * upserts them as discovered (staged) rows. Additive only: it never touches
 * status, price overrides, quality, or defaults on existing rows — it only
 * refreshes catalog facts (pricing text, deprecation, release date, lab).
 */
export async function syncFromFal(
	supabase: SupabaseClient,
	userId: string,
	fetchFn: typeof fetch = fetch
): Promise<SyncResult> {
	const result: SyncResult = { discovered: 0, refreshed: 0, deprecatedFlagged: 0, errors: [] };
	const scope = await resolveScope(supabase, userId);
	const { data: existingRows, error: readErr } = await supabase
		.from('model_registry')
		.select('id, model_id, deprecated, price_source, wired, pricing_text, released_at, lab')
		.eq('owner_key', scopeKey(scope));
	if (readErr) throw readErr;
	const existing = new Map((existingRows ?? []).map((r: any) => [r.model_id, r]));

	// The four category pulls are independent — fetch them concurrently, then
	// write. A full first sync is ~640 rows; per-row writes made the button a
	// 30s+ wait, so inserts are batched and updates only fire on actual change.
	const pageJobs: Array<Promise<{ kind: RegistryKind; items: any[] }>> = [];
	for (const [category, kind] of Object.entries(CATEGORY_TO_KIND)) {
		for (const page of [1, 2]) {
			pageJobs.push(
				(async () => {
					try {
						const res = await fetchFn(
							`https://fal.ai/api/models?categories=${category}&page=${page}`,
							{ headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }
						);
						if (!res.ok) throw new Error(`HTTP ${res.status}`);
						const body = await res.json();
						return { kind, items: Array.isArray(body?.items) ? body.items : [] };
					} catch (e) {
						result.errors.push(`${category} p${page}: ${(e as Error).message}`);
						return { kind, items: [] };
					}
				})()
			);
		}
	}
	const pages = await Promise.all(pageJobs);

	const inserts: Record<string, unknown>[] = [];
	const seenThisSync = new Set<string>();
	for (const { kind, items } of pages) {
		for (const item of items) {
			const modelId = item?.id;
			if (typeof modelId !== 'string' || !modelId || seenThisSync.has(modelId)) continue;
			if (item?.kind && item.kind !== 'inference') continue;
			seenThisSync.add(modelId);
			const pricingText: string | null = item?.pricingInfoOverride || null;
			const releasedAt: string | null =
				(item?.publishedAt || item?.date || '').slice(0, 10) || null;
			const deprecated = Boolean(item?.deprecated);
			const lab: string | null = item?.modelLab || null;
			const prior = existing.get(modelId);

			if (prior) {
				// Refresh catalog facts only when something actually changed; a
				// manual price is never overwritten.
				const patch: Record<string, unknown> = {};
				if ((pricingText ?? null) !== (prior.pricing_text ?? null))
					patch.pricing_text = pricingText;
				if (deprecated !== Boolean(prior.deprecated)) patch.deprecated = deprecated;
				if (releasedAt && releasedAt !== prior.released_at) patch.released_at = releasedAt;
				if (lab && lab !== prior.lab) patch.lab = lab;
				if (!prior.wired && prior.price_source !== 'manual' && patch.pricing_text !== undefined) {
					const parsed = parsePriceText(pricingText);
					if (parsed.usd != null) {
						patch.price_usd = parsed.usd;
						patch.price_source = 'parsed';
					}
				}
				if (Object.keys(patch).length === 0) continue;
				const { error } = await supabase.from('model_registry').update(patch).eq('id', prior.id);
				if (error) result.errors.push(`${modelId}: ${error.message}`);
				else {
					result.refreshed++;
					if (deprecated && !prior.deprecated) result.deprecatedFlagged++;
				}
				continue;
			}

			const parsed = parsePriceText(pricingText);
			inserts.push({
				user_id: scopeOwner(scope),
				provider: 'fal' as RegistryProvider,
				model_id: modelId,
				kind,
				// fal's catalog categorises one model per category pull, so the
				// discovered mode is the mode. Kept explicit because PostgREST unions
				// keys across a bulk insert — an absent key here would write NULL and
				// silently opt the row out of kinds-based resolution.
				kinds: [kind],
				input_modalities: null,
				output_modalities: null,
				label: item?.title || modelId,
				lab,
				released_at: releasedAt,
				price_usd: parsed.usd,
				pricing_text: pricingText,
				price_basis: parsed.basis,
				price_source: parsed.usd != null ? 'parsed' : 'seed',
				status: 'available',
				wired: false,
				deprecated,
				note: item?.shortDescription ? String(item.shortDescription).slice(0, 300) : null,
				origin: 'fal_catalog' as RegistryOrigin,
				discovered_at: new Date().toISOString()
			});
		}
	}

	for (let i = 0; i < inserts.length; i += 100) {
		const chunk = inserts.slice(i, i + 100);
		// ignoreDuplicates: a concurrent sync inserting the same discovery is a
		// no-op, not an error.
		const { error } = await supabase
			.from('model_registry')
			.upsert(chunk, { onConflict: 'owner_key,model_id', ignoreDuplicates: true });
		if (error) result.errors.push(`batch insert: ${error.message}`);
		else result.discovered += chunk.length;
	}
	return result;
}

// ── Schema probe (OpenAPI spec — no key required) ───────────────────────────

const TEXT_SYNONYMS = ['prompt', 'multi_prompt', 'text', 'transcript', 'input', 'script'];
const IMAGE_SYNONYMS = [
	'image_url',
	'image_urls',
	'reference_image_urls',
	'image_references',
	'start_image_url',
	'first_frame_image',
	'input_image_url',
	'reference_images'
];
const SIZE_SYNONYMS = ['aspect_ratio', 'image_size', 'resolution', 'video_size', 'size'];
const DURATION_SYNONYMS = ['duration', 'num_frames', 'video_length', 'duration_seconds'];
const AUDIO_SYNONYMS = ['generate_audio', 'enable_audio', 'with_audio'];
const VOICE_SYNONYMS = ['voice', 'voice_id', 'speaker', 'voice_name'];

export interface ProbeResult {
	ok: boolean;
	textParam: string | null;
	imageParam: string | null;
	imageIsArray: boolean;
	sizeParam: string | null;
	durationParam: string | null;
	audioParam: string | null;
	unknownRequired: string[];
	/** Schema defaults for unknownRequired fields — each one found here is a gap
	 *  the adapter can close automatically by sending the model's own default. */
	requiredDefaults: Record<string, unknown>;
	outputShape: string | null;
	probedAt: string;
}

/**
 * A generated adapter: everything the request builder needs to drive a model it
 * has no hand-written integration for. Derived mechanically from the probe —
 * param names from the synonym match, constants from the schema's own defaults,
 * output from the response shape. Stored inside the row's `probe` JSON so the
 * adapter travels with the evidence it was built from.
 */
export interface ModelAdapter {
	text: string;
	image: string | null;
	imageIsArray: boolean;
	duration: string | null;
	audio: string | null;
	constants: Record<string, unknown>;
	output: 'video.url' | 'videos[].url' | null;
}

export function adapterFromProbe(probe: ProbeResult, kind: RegistryKind): ModelAdapter | null {
	if (!probe.textParam) return null;
	const needsImage = kind === 'video_i2v' || kind === 'image_edit';
	if (needsImage && !probe.imageParam) return null;
	// Every required field the synonym match didn't cover must have a schema
	// default we can pin — otherwise there is no honest adapter, only a guess.
	const constants: Record<string, unknown> = {};
	for (const f of probe.unknownRequired) {
		if (!(f in probe.requiredDefaults)) return null;
		constants[f] = probe.requiredDefaults[f];
	}
	const output =
		probe.outputShape === 'video.url' || probe.outputShape === 'videos[].url'
			? probe.outputShape
			: null;
	if (kind === 'video_i2v' && !output) return null;
	return {
		text: probe.textParam,
		image: probe.imageParam,
		imageIsArray: probe.imageIsArray,
		duration: probe.durationParam,
		audio: probe.audioParam,
		constants,
		output
	};
}

/**
 * Fetches a model's live OpenAPI spec and classifies its request shape.
 * Resolves the input schema via paths → POST → requestBody → $ref (some specs
 * bundle several *Input schemas, so name-matching alone can mis-pick).
 */
export async function probeModelSchema(
	modelId: string,
	kind: RegistryKind,
	fetchFn: typeof fetch = fetch
): Promise<ProbeResult> {
	const res = await fetchFn(
		`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(modelId)}`,
		{ headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }
	);
	if (!res.ok) throw new Error(`Spec fetch failed (HTTP ${res.status})`);
	const spec = await res.json();
	const schemas = spec?.components?.schemas ?? {};

	// Prefer the schema the submit POST actually references.
	let input: any = null;
	for (const p of Object.values(spec?.paths ?? {}) as any[]) {
		const ref: string | undefined =
			p?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
		if (ref) {
			const name = ref.split('/').pop()!;
			// The queue spec's submit path is the one whose schema name ends Input.
			if (schemas[name] && name.toLowerCase().endsWith('input')) {
				input = schemas[name];
				break;
			}
			if (schemas[name] && !input) input = schemas[name];
		}
	}
	if (!input) {
		for (const [name, s] of Object.entries(schemas)) {
			if (name.toLowerCase().endsWith('input')) {
				input = s;
				break;
			}
		}
	}
	if (!input) throw new Error('No input schema found in spec');

	const props: Record<string, any> = input.properties ?? {};
	const required: string[] = input.required ?? [];
	const find = (cands: string[]) => cands.find((c) => c in props) ?? null;

	const textParam = find(TEXT_SYNONYMS);
	const imageParam = find(IMAGE_SYNONYMS);
	const sizeParam = find(SIZE_SYNONYMS);
	const durationParam = find(DURATION_SYNONYMS);
	const audioParam = find(AUDIO_SYNONYMS);
	const voiceParam = find(VOICE_SYNONYMS);
	const known = new Set(
		[textParam, imageParam, sizeParam, durationParam, audioParam, voiceParam].filter(Boolean)
	);
	const unknownRequired = required.filter((r) => !known.has(r));

	let outputShape: string | null = null;
	for (const [name, s] of Object.entries(schemas) as [string, any][]) {
		if (!name.toLowerCase().endsWith('output')) continue;
		const op = s?.properties ?? {};
		if ('video' in op) outputShape = 'video.url';
		else if ('videos' in op) outputShape = 'videos[].url';
		else if ('images' in op) outputShape = 'images[].url';
		else if ('image' in op) outputShape = 'image.url';
		else if ('audio' in op) outputShape = 'audio.url';
		else if ('audio_url' in op) outputShape = 'audio_url';
		else outputShape = `other: ${Object.keys(op).slice(0, 4).join(', ')}`;
		break;
	}

	const needsImage = kind === 'video_i2v' || kind === 'image_edit';
	const ok =
		Boolean(textParam) &&
		(!needsImage || Boolean(imageParam)) &&
		unknownRequired.length === 0 &&
		Boolean(outputShape) &&
		!String(outputShape).startsWith('other');

	// Harvest the schema's own defaults for the fields we couldn't map — they're
	// what let a generated adapter close gaps without a human writing constants.
	const requiredDefaults: Record<string, unknown> = {};
	for (const f of unknownRequired) {
		if (props[f]?.default !== undefined) requiredDefaults[f] = props[f].default;
	}

	return {
		ok,
		textParam,
		imageParam,
		imageIsArray: imageParam ? props[imageParam]?.type === 'array' : false,
		sizeParam,
		durationParam,
		audioParam,
		unknownRequired,
		requiredDefaults,
		outputShape,
		probedAt: new Date().toISOString()
	};
}
