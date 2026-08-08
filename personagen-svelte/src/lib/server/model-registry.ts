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

export type RegistryKind = ModelKind | 'tts';

export interface RegistryRow {
	id: string;
	user_id: string;
	model_id: string;
	kind: RegistryKind;
	label: string;
	lab: string | null;
	released_at: string | null;
	price_usd: number | null;
	pricing_text: string | null;
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

const TTS_SEED: Omit<RegistryRow, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
	model_id: 'fal-ai/elevenlabs/tts/turbo-v2.5',
	kind: 'tts',
	label: 'ElevenLabs Turbo v2.5',
	lab: 'ElevenLabs',
	released_at: '2024-07-01',
	price_usd: 0.03,
	pricing_text: null,
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

/** Loads the user's registry, seeding it from the static catalog on first use. */
export async function loadRegistry(
	supabase: SupabaseClient,
	userId: string
): Promise<RegistryRow[]> {
	const { data, error } = await supabase
		.from('model_registry')
		.select('*')
		.eq('user_id', userId)
		.order('released_at', { ascending: false, nullsFirst: false });
	if (error) throw error;
	if (data && data.length > 0) return data as RegistryRow[];

	// First visit: seed the wired catalog so the manager opens populated and
	// the resolve endpoints have rows to honor.
	// EVERY row must carry the IDENTICAL key set: PostgREST turns a mixed-shape
	// bulk insert into one statement over the union of columns, filling absent
	// keys with NULL — which bypasses column defaults and violates NOT NULLs
	// (this exact bug shipped once: seeds omitted `deprecated`, TTS didn't).
	const seeds = MODEL_CATALOG.map((m) => {
		const extra = WIRED_SEED[m.id];
		return {
			user_id: userId,
			model_id: m.id,
			kind: m.kind as RegistryKind,
			label: m.label,
			lab: extra?.lab ?? null,
			released_at: extra?.released ?? null,
			price_usd: m.usd,
			pricing_text: null as string | null,
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
			discovered_at: null as string | null
		};
	});
	// ignoreDuplicates makes concurrent first-visits race-safe: two requests
	// seeding at once both succeed (one inserts, one no-ops on the
	// user_id+model_id unique key) instead of one throwing and falling back to
	// the static catalog for that request.
	const { error: insertErr } = await supabase
		.from('model_registry')
		.upsert([...seeds, { user_id: userId, ...TTS_SEED }], {
			onConflict: 'user_id,model_id',
			ignoreDuplicates: true
		});
	if (insertErr) throw insertErr;
	const { data: seeded, error: reselectErr } = await supabase
		.from('model_registry')
		.select('*')
		.eq('user_id', userId)
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
		sizeParam: staticEntry?.sizeParam,
		multiRef: staticEntry?.multiRef,
		note: row.note ?? staticEntry?.note ?? '',
		caveat: staticEntry?.caveat,
		supportsAudio: staticEntry?.supportsAudio,
		supportsDuration: staticEntry?.supportsDuration
	};
}

/**
 * The selectable models for a kind: ACTIVE wired registry rows, with registry
 * price/tier/note overlaid on the static adapter facts. Empty (all disabled)
 * or errored → full static list, so generation is never brickable from the
 * manager.
 */
export function effectiveOptions(rows: RegistryRow[], kind: ModelKind): ModelOption[] {
	const active = rows.filter((r) => r.kind === kind && r.wired && r.status === 'active');
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
	const options = effectiveOptions(rows, kind);
	const found = requested ? options.find((m) => m.id === requested) : undefined;
	if (found) return found;
	const def = rows.find((r) => r.kind === kind && r.wired && r.status === 'active' && r.is_default);
	if (def) {
		const opt = options.find((m) => m.id === def.model_id);
		if (opt) return opt;
	}
	return (
		options.find((m) => m.id === DEFAULT_MODEL[kind]) ?? options[0] ?? resolveModel(kind, requested)
	);
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
	const { data: existingRows, error: readErr } = await supabase
		.from('model_registry')
		.select('id, model_id, deprecated, price_source, wired, pricing_text, released_at, lab')
		.eq('user_id', userId);
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
				const { error } = await supabase
					.from('model_registry')
					.update(patch)
					.eq('id', prior.id)
					.eq('user_id', userId);
				if (error) result.errors.push(`${modelId}: ${error.message}`);
				else {
					result.refreshed++;
					if (deprecated && !prior.deprecated) result.deprecatedFlagged++;
				}
				continue;
			}

			const parsed = parsePriceText(pricingText);
			inserts.push({
				user_id: userId,
				model_id: modelId,
				kind,
				label: item?.title || modelId,
				lab,
				released_at: releasedAt,
				price_usd: parsed.usd,
				pricing_text: pricingText,
				price_source: parsed.usd != null ? 'parsed' : 'seed',
				status: 'available',
				wired: false,
				deprecated,
				note: item?.shortDescription ? String(item.shortDescription).slice(0, 300) : null,
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
			.upsert(chunk, { onConflict: 'user_id,model_id', ignoreDuplicates: true });
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
	outputShape: string | null;
	probedAt: string;
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

	return {
		ok,
		textParam,
		imageParam,
		imageIsArray: imageParam ? props[imageParam]?.type === 'array' : false,
		sizeParam,
		durationParam,
		audioParam,
		unknownRequired,
		outputShape,
		probedAt: new Date().toISOString()
	};
}
