/**
 * Shared UGC content generation.
 *
 * Standard pipeline, `generateUgcPack` (all on the user's fal key + an LLM key):
 *   1. LLM "director"  -> JSON: caption, hashtags, dialogue, on-screen text, scene & motion prompts
 *   2. Nano Banana     -> product-accurate still (real product + optional pinned creator face)
 *   3a. spokesperson   -> ElevenLabs TTS (pinned voice) -> VEED Fabric talking head
 *   3b. b-roll         -> Kling O3 Pro ("Omni") single-shot motion clip
 *
 * Cinematic pipeline, `generateCinematicUgcPack` — one per day via the autopilot
 * (see autopilot.ts), the rest of the day's slots stay on the standard pipeline:
 *   1. LLM "director"  -> JSON storyboard: caption + a shot list (single-dominant-
 *      action prompt + duration per shot, product+character in every shot)
 *   2. Nano Banana     -> ALL storyboard stills generated in parallel, every one
 *      compositing the same character + product references
 *   3. Kling O3 Pro's native `multi_prompt` -> one multi-shot video in a single
 *      call, anchored on the first storyboard still (no per-shot reference
 *      parameter exists on this endpoint — verified against the live OpenAPI
 *      spec — so the composited still is the only consistency anchor)
 *
 * Veo 3.1 is intentionally not wired into either active path right now (no
 * multi-shot/reference support via fal, ~2x Kling's per-second cost) — see
 * BROLL_MODEL_VEO_DEFERRED.
 *
 * Per-agent config (agent_configs, read defensively so it works before the UI lands):
 *   ugc_voice ('Adam'), ugc_format ('auto'|'spokesperson'|'broll'),
 *   ugc_video_quality ('mvp'|'premium'), ugc_character_ref (pinned face image url)
 *
 * Reused by: content-forge engine, /api/agent/[id]/generate-post, and the autopilot.
 */

import { env } from '$env/dynamic/private';
import { getUserApiKey } from '$lib/server/user-api-keys';
import { resolveAiClient, type AiClient, type AiUsage } from '$lib/server/ai-client';
import {
	priceOf,
	summarizeCosts,
	summarizeAspects,
	type CostEvent,
	type GenerationProvenance
} from '$lib/pricing';
import { appearanceToPromptClause, stripLeadingAvatarName } from '$lib/persona-profile';
// Persona Model v2 (P2.3): the portrait builders read the v2 look (via
// `readPersonaProfileV2`, imported below) for the attributes the v1 shape has no
// key for. Used ONLY by buildHeroPortraitPrompt and buildPortraitEditPrompt.
import {
	hasV2OnlyLookAttributes,
	lookPreservationClause,
	lookSubjectAttributes
} from '$lib/persona-contract/look-prompt';
import { readPersonaProfile } from '$lib/persona-profile-store';
import { createDbService } from '$lib/server/db';
import { DEFAULT_VOICE, VOICE_CATALOG, liveVoice } from '$lib/server/voices';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { resolveModel, getModel, MODEL_CATALOG, type ModelOption } from '$lib/models';
// The clip-length ceiling the ingest gate enforces. Imported rather than
// restated so the gate, the quote and the meter cannot disagree about how long a
// source clip may be — they are the same number by construction.
// The listicle's beat bounds, imported for the same reason: the composer's
// chips, the ingest gate, the quote and this engine all clamp to ONE range, so a
// count that was offered can never be a count the run refuses.
import { MAX_SECONDS, MIN_ITEMS, MAX_ITEMS, DEFAULT_ITEMS } from '$lib/formats';
import { persistToStorage, persistBufferToStorage } from '$lib/server/storage';
import {
	burnCaptions,
	optimizeForWeb,
	stillToMotion,
	muxVoiceover,
	concatAudio,
	MAX_TIMED_CAPTIONS,
	type TimedCaption
} from '$lib/server/video';
import {
	renderTypographicCard,
	CARD_RENDERER_LABEL,
	sanitizeCardText,
	type CardLayout
} from './card-renderer';
// The two self-shot realism registers the studio templates encode. The composer
// can pin one per run, so the engine splices the SAME constant the templates use
// rather than a paraphrase that would drift from them.
import { SELFIE_LOOK, MIRROR_LOOK } from '$lib/studio-templates';
import { fetchWithTimeout } from '$lib/server/social/http';
import { assertWithinBudget } from '$lib/server/budget';
import { inferGenderFromName } from '$lib/name-gender';
import {
	creditsFor,
	keySourceFor,
	resolveBillingAccount,
	debitForEvents,
	isCreditsError,
	type KeySource
} from '$lib/server/credits';
import {
	creditsMode,
	personaBackboneEmits,
	personaFitJudgeRunsAutomatically
} from '$lib/server/flags';
import { readPersonaProfileV2 } from '$lib/persona-contract/store';
import { label } from '$lib/persona-contract/labels';
import { isObj } from '$lib/persona-contract/paths';
import { sampleViewerPanel } from '$lib/persona-contract/panel';
import {
	fitColumnsFor,
	fitJudgePrompt,
	judgeablePanel,
	parseFitVerdict,
	type FitVerdictEntry
} from '$lib/server/persona/fit-judge';
// Cycle by design: metering.ts is the single gate→record→debit wrapper and it
// records through recordCostEvents, which lives here. Both directions are used
// inside function bodies only, so neither module reads the other at load time.
import { meteredAiClient } from '$lib/server/metering';
import {
	loadRegistry,
	openRouterRoute,
	registryDefault,
	type RegistryRow
} from '$lib/server/model-registry';

// Every provider call in this file gets a hard PER-REQUEST deadline. The queue
// pollers below bound total job time, but only a per-request timeout stops a
// single hung socket from stalling a scheduler tick forever (the queue loops
// only re-check their deadline BETWEEN polls, so a stuck poll never returns).
// 120s is generous for a slow-but-alive image/submit call while still killing
// a truly dead connection.
const GEN_FETCH_TIMEOUT_MS = 120_000;
// NEVER name this `fetch`. A module-level `const fetch` shadows the global, and
// once the SSR bundle hoists modules into one scope, http.ts's own call to the
// *global* fetch can bind to this local instead: fetch -> fetchWithTimeout ->
// fetch -> … which blows the stack on the very first provider call. That took
// every generation route down with an instant 502 while still type-checking
// clean. Name it explicitly and call it explicitly, as ai-client.ts does.
const genFetch = (input: string | URL, init?: RequestInit) =>
	fetchWithTimeout(input, init, GEN_FETCH_TIMEOUT_MS);

/**
 * Persists a generated (un-captioned) clip to durable storage as a web-optimised
 * mp4: a CRF re-encode at feed resolution (~4–6× smaller than the provider
 * master — the thing that actually makes clips load fast off our un-CDN'd
 * storage host), falling back to a lossless `+faststart` remux, falling back to
 * the untouched provider clip when ffmpeg is unavailable (correctness over
 * optimisation). Captioned clips skip this because burnCaptions already encodes
 * to the same delivery settings. `extraHeaders` carries provider auth for
 * sources that need it (e.g. OpenRouter's Bearer-guarded video URLs).
 */
async function persistVideoDurable(
	svc: Parameters<typeof persistToStorage>[0],
	sourceUrl: string,
	userId: string,
	extraHeaders?: Record<string, string>
): Promise<string> {
	const optimized = await optimizeForWeb(sourceUrl, extraHeaders).catch(() => null);
	return optimized
		? persistBufferToStorage(svc, optimized, userId, 'mp4', 'video/mp4')
		: persistToStorage(svc, sourceUrl, userId, 'mp4', extraHeaders);
}

// ── Model slugs (env-overridable so quality/provider is a one-line swap) ─────
// Re-verified against fal.ai's live docs/OpenAPI specs as of 2026-07-01 —
// dated here since this landscape moves fast enough that "latest" from even
// a few months ago can be stale.
//
// Nano Banana 2 (Gemini 3.1 Flash Image) superseded the original Nano Banana
// (Gemini 2.5) in Feb 2026 — same `image_urls`/`prompt`/`aspect_ratio` request
// shape, so this is a drop-in swap, not a rewrite. Supports up to 14 reference
// images (vs. the 1-2 this pipeline currently passes) and higher fidelity, at
// roughly double the per-image cost ($0.08 vs $0.039 at 1K).
const NANO_MODEL = env.UGC_NANO_MODEL || 'fal-ai/nano-banana-2/edit';
// NOT upgraded to Eleven v3 despite it being newer (GA March 2026): voice-name
// compatibility with this app's VOICE_CATALOG is only partially confirmed
// (Adam — the DEFAULT_VOICE fallback — isn't in v3's documented voice list),
// it's ~2x the cost per character, and its higher latency has no upside for
// this app's async generation use case. Revisit once Adam's availability on
// v3 is confirmed.
export const TTS_MODEL = env.UGC_TTS_MODEL || 'fal-ai/elevenlabs/tts/turbo-v2.5';
// Talking-head (spokesperson) model. Upgraded from VEED Fabric 1.0 — whose
// lip-sync was visibly off — to ByteDance OmniHuman v1.5, the current SOTA
// image+audio avatar (film-grade realism, tight audio↔motion correlation from
// ~18.7k hrs of training). It's a DROP-IN: same image_url/audio_url inputs and
// {video:{url}} output, so nothing downstream changes. Verified on fal
// 2026-07-12. Override with UGC_TALKINGHEAD_MODEL (e.g. the cheaper Kling
// AI-Avatar 'fal-ai/kling-video/ai-avatar/v2/standard', or 'veed/fabric-1.0').
export const TALKINGHEAD_MODEL = env.UGC_TALKINGHEAD_MODEL || 'fal-ai/bytedance/omnihuman';
/** Short display label for the talking-head model — for the composer preview and
 *  post observability, so the UI names the model that actually runs. */
export const TALKINGHEAD_LABEL = TALKINGHEAD_MODEL.includes('omnihuman')
	? 'omnihuman v1.5'
	: TALKINGHEAD_MODEL.includes('veed/fabric')
		? 'veed fabric 1.0'
		: TALKINGHEAD_MODEL.includes('kling')
			? 'kling ai-avatar'
			: TALKINGHEAD_MODEL;
// Kling 3.0 is still the latest Kling generation (no Kling 4 exists as of
// this date) — but Standard and Pro are priced ~25% apart ($0.084/s vs
// $0.112/s without audio), so the two tiers now map onto separate model
// slugs instead of both paying Pro pricing:
//   - Standard: the high-frequency (6x/day) single-shot clips, plain
//     image-to-video (no reference/elements needed for a single shot).
//   - Pro ("Omni") reference-to-video: the once-a-day cinematic multi-shot
//     pipeline. This is a DISTINCT endpoint from plain image-to-video —
//     confirmed via its own OpenAPI spec to have a real `elements`/
//     `image_urls` reference mechanism (plain image-to-video does not, despite
//     marketing copy implying otherwise — verify against the specific
//     endpoint's own spec, not the family's marketing page, before trusting
//     any capability claim for these models). Same per-second price as plain
//     image-to-video Pro, so this is a strict upgrade for the cinematic path.
// Parked, not dead: kept so swapping the standard b-roll path back to Kling
// standard stays a one-line change. See the note above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BROLL_MODEL_STANDARD = env.UGC_BROLL_MODEL || 'fal-ai/kling-video/o3/standard/image-to-video';
const BROLL_MODEL_CINEMATIC =
	env.UGC_BROLL_MODEL_CINEMATIC || 'fal-ai/kling-video/o3/pro/reference-to-video';

// Ledger/preview display labels DERIVED from the env-selected slugs, so cost
// events and the composer preview keep naming the model that actually runs even
// after an env override — a hardcoded "nano-banana-2" next to an overridden
// UGC_NANO_MODEL is exactly the kind of silent misreport this app must not make.
export const NANO_STILL_LABEL = NANO_MODEL.replace(/^fal-ai\//, '').replace(/\/edit$/, '');
export const CINEMATIC_VIDEO_LABEL = BROLL_MODEL_CINEMATIC.includes('kling-video/o3/pro/reference')
	? 'kling-o3-pro reference'
	: BROLL_MODEL_CINEMATIC;
// Veo 3.1 (still Google's latest as of this date — no Veo 4 released despite
// plenty of speculation) is intentionally NOT wired into any active
// generation path right now (no multi-shot/elements support via fal, and
// ~2x Kling's cost) — kept here, unused, so it's a one-line change to bring
// back later rather than a re-integration from scratch.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately deferred, see the note above
const BROLL_MODEL_VEO_DEFERRED = env.UGC_BROLL_MODEL_PREMIUM || 'fal-ai/veo3.1/image-to-video';
const FABRIC_RES = env.UGC_FABRIC_RES || '720p';
const VIDEO_DURATION = env.UGC_VIDEO_DURATION || '5';
// Native audio on the b-roll paths (ambient/environmental sound baked into the
// clip by Kling — the cinematic path at generateCinematicVideo already does
// this). Silent clips read as broken on social feeds, and on a fal outage the
// SPOKESPERSON format degrades to the b-roll path too, so muted b-roll meant
// muted everything. Default ON; UGC_BROLL_AUDIO=false restores silent clips.
// NOTE: Kling bills a HIGHER per-second rate with audio enabled (the $0.084/s
// Standard figure above is the audio-off rate) — see the cost-event note where
// the b-roll video event is recorded in generateUgcPack.
const BROLL_AUDIO_ENABLED = env.UGC_BROLL_AUDIO !== 'false';

// ── Video-to-video (Wan Animate replace/move) ───────────────────────────────
// Verified end-to-end on 2026-09-09 against the live endpoints (a real run, not
// a spec read): both take video_url + image_url + resolution and return
// {video:{url}} — the same output shape the b-roll path already reads.
//
// 580p, not 720p: this stage bills per SECOND OF SOURCE (480p $0.04 / 580p
// $0.06 / 720p $0.08), and a measured 2.6s clip took ~7 MINUTES at 720p. The
// latency, not the money, is what makes the middle rung the right default —
// a 15s source at 720p would sit well past any reasonable job deadline.
// Deliberately NOT env-overridable: the resolution is what the per-second price
// in pricing.ts is quoted against, so a deploy that raised it would bill 580p
// rates for 720p seconds. Moving the rung is a two-line change — here and there
// — which is the point.
const V2V_RESOLUTION = '580p';
// falQueueJson's 270s default is tuned for a 5s i2v clip and would abandon a
// v2v job that is still legitimately rendering — the same reason the cinematic
// path raised it. ~7 min for 2.6s measured, so this is the ceiling for the
// short clips the composer allows, not a target.
const V2V_QUEUE_TIMEOUT_MS = 900000;
// Billing basis when the caller could not probe the source clip. NEVER 0: an
// unpriced second is a free generation the moment credits_mode=enforce, so an
// unknown duration bills the same nominal clip length the i2v path assumes
// rather than nothing at all.
const V2V_ASSUMED_SECONDS = Number(VIDEO_DURATION) || 5;

/**
 * The number of source seconds a v2v run is BILLED for.
 *
 * Rounds nothing: a measured 2.6s clip billed 2.6 × the per-second rate, so
 * ceiling it here would overcharge every short clip. The only thing it refuses
 * is a duration that would bill zero — an unprobed clip is an unpriced provider
 * call, which is a free generation path the moment credits are enforced.
 */
function v2vBillableSeconds(probed?: number | null): number {
	const n = Number(probed);
	if (!Number.isFinite(n) || n <= 0) return V2V_ASSUMED_SECONDS;
	// Clamp to the SAME ceiling the ingest gate enforces (MAX_SECONDS, owned by
	// $lib/formats so the quote and the gate cannot drift). This value arrives on
	// the request body, and a per-second rate multiplied by an unbounded number
	// is an unbounded bill: a forged `sourceSeconds: 9999` would charge ~$600 for
	// a clip the ingest endpoint would never have accepted. The route validates
	// too; this is the second lock, because the engine is what actually spends.
	return Math.min(n, MAX_SECONDS);
}

/**
 * Tolerant JSON parse for AI responses: strips markdown fences, and when the
 * model appends commentary after (or before) the JSON, extracts the first
 * balanced JSON object/array instead of failing. Observed in production:
 * Gemini returning valid JSON followed by trailing prose lost entire
 * autopilot slots ("Unexpected non-whitespace character after JSON").
 */
export function safeParseJson(text: string): any {
	const cleaned = text
		.replace(/```json/g, '')
		.replace(/```/g, '')
		.trim();
	try {
		return JSON.parse(cleaned);
	} catch {
		/* fall through to balanced-extraction */
	}

	const start = cleaned.search(/[{[]/);
	if (start !== -1) {
		const open = cleaned[start];
		const close = open === '{' ? '}' : ']';
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let i = start; i < cleaned.length; i++) {
			const ch = cleaned[i];
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = !inString;
			} else if (!inString) {
				if (ch === open) depth++;
				else if (ch === close) {
					depth--;
					if (depth === 0) {
						try {
							return JSON.parse(cleaned.slice(start, i + 1));
						} catch {
							break;
						}
					}
				}
			}
		}
	}

	console.warn('[Content] Failed to parse AI response as JSON (no balanced object found)');
	return null;
}

/** Resolves the OpenRouter + fal.ai keys available for media generation. */
/** One resolved OpenRouter image route: the model id that will RUN and the price that will be BILLED, from the same registry row. */
export interface OpenRouterImageRoute {
	id: string;
	usd: number;
	/** false = no active wired registry row; the compiled-in constant is in force (today's behaviour). */
	fromRegistry: boolean;
}
export interface OpenRouterImageRoutes {
	t2i: OpenRouterImageRoute;
	edit: OpenRouterImageRoute;
	video: OpenRouterImageRoute;
}

export async function resolveImageKeys(
	supabase: any,
	userId: string
): Promise<{
	orKey: string | null;
	falKey: string | null;
	orRoutes: OpenRouterImageRoutes;
	/** Registry-resolved fal routes. Today: the voice model the run and the quote share. */
	falRoutes: { tts: OpenRouterImageRoute };
}> {
	const userOrKey = await getUserApiKey(supabase, userId, 'openrouter').catch(() => null);
	const envOrKey = env.OPENROUTER_API_KEY?.trim();
	const orKey =
		userOrKey || (envOrKey && !envOrKey.includes('placeholder') ? envOrKey : null) || null;
	const userFalKey = await getUserApiKey(supabase, userId, 'fal_ai').catch(() => null);
	const falKey = userFalKey || env.FAL_API_KEY || process.env.FAL_API_KEY || null;

	// OpenRouter image routes come from the Model Registry so the id that runs
	// and the price that lands in the ledger are read from ONE row — this is
	// what stopped the image route drifting ~4x (code moved to Nano Banana 2,
	// the static price table kept billing flux-schnell). Fails OPEN to the
	// compiled-in constants: this selects a model, it is not a money gate, so a
	// registry read error must never block a generation. An empty registry is
	// byte-for-byte today's behaviour.
	let rows: RegistryRow[] = [];
	try {
		rows = await loadRegistry(supabase, userId);
	} catch (e) {
		console.warn(
			'[Content] Model registry unavailable — OpenRouter image routes fall back to constants:',
			(e as Error).message
		);
	}
	const fallbackUsd = priceOf('openrouter', 'image');
	const orRoutes: OpenRouterImageRoutes = {
		t2i: openRouterRoute(rows, 'image_t2i', UGC_IMAGE_MODEL_OPENROUTER, fallbackUsd),
		edit: openRouterRoute(rows, 'image_edit', IMAGE_EDIT_MODEL_OPENROUTER, fallbackUsd),
		// The OpenRouter video failover used to run a compiled-in id at a static
		// price with no row anywhere — the one model the ledger showed running
		// that the Model Manager could not name.
		video: openRouterRoute(
			rows,
			'video_i2v',
			BROLL_MODEL_OPENROUTER,
			priceOf('openrouter', 'video')
		)
	};
	// Voice is the registry's starred tts row; nothing read that star before.
	const falRoutes = {
		tts: registryDefault(rows, 'tts', 'fal', TTS_MODEL, priceOf('fal', 'tts'))
	};
	return { orKey, falKey, orRoutes, falRoutes };
}

// ── fal helpers ─────────────────────────────────────────────────────────────

async function falSyncJson(model: string, input: any, falKey: string): Promise<any> {
	const res = await genFetch(`https://fal.run/${model}`, {
		method: 'POST',
		headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) {
		throw new Error(`${model} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
	}
	return res.json();
}

/** Submits a long-running fal job to the queue and polls until completion. */
async function falQueueJson(
	model: string,
	input: any,
	falKey: string,
	timeoutMs = 270000
): Promise<any> {
	const sub = await genFetch(`https://queue.fal.run/${model}`, {
		method: 'POST',
		headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!sub.ok) {
		throw new Error(`${model} submit failed (${sub.status}): ${(await sub.text()).slice(0, 200)}`);
	}
	const { status_url, response_url } = (await sub.json()) as any;
	const deadline = Date.now() + timeoutMs;
	// Poll immediately, sleep BETWEEN attempts — fast jobs (image edits) finish in
	// well under the old unconditional 5s head-start.
	while (Date.now() < deadline) {
		const s = await genFetch(status_url, { headers: { Authorization: `Key ${falKey}` } });
		if (s.ok) {
			const st = (await s.json()) as any;
			if (st.status === 'COMPLETED') {
				const r = await genFetch(response_url, { headers: { Authorization: `Key ${falKey}` } });
				if (!r.ok) {
					throw new Error(
						`${model} result fetch failed (${r.status}): ${(await r.text()).slice(0, 200)}`
					);
				}
				return r.json();
			}
			if (['FAILED', 'ERROR', 'CANCELLED'].includes(st.status)) {
				throw new Error(`${model} job ${st.status}`);
			}
		} else if (s.status !== 429 && s.status < 500) {
			// 401/403/404 mean the key was revoked or the job is gone — polling
			// again can only burn the deadline. Only 429/5xx are transient.
			throw new Error(`${model} status poll failed (${s.status}) — key revoked or job gone`);
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw new Error(`${model} timed out`);
}

/**
 * Generates a UGC-style lifestyle image from a b-roll prompt (text-to-image fallback
 * when there is no product photo to composite). Throws on failure.
 */
export const UGC_IMAGE_PREFIX =
	'UGC lifestyle photo, candid and authentic, shot on iPhone, natural lighting, real person not staged. ';
/** Variant for compositions that exclude the persona (mood boards, POV shots,
 *  behind-the-scenes) — the default prefix's "real person" would put one in. */
export const UGC_IMAGE_PREFIX_NO_PEOPLE =
	'Authentic lifestyle photo, candid framing, shot on iPhone, natural lighting, no people in frame. ';
/** The text-to-image models this helper actually calls -- surfaced so the UI shows the truth. */
export const UGC_IMAGE_MODEL_FAL = 'fal-ai/flux/schnell';
// OpenRouter's image route runs the VERIFIED Gemini image model (same one the
// composite/edit paths use, env-overridable together). The old id here —
// 'black-forest-labs/flux-schnell' — does not exist on OpenRouter and 404'd
// ("No model found"), which killed every no-reference still for accounts that
// only have an OpenRouter key.
export const UGC_IMAGE_MODEL_OPENROUTER =
	env.UGC_IMAGE_EDIT_MODEL_OR || 'google/gemini-3.1-flash-image';

/** The full string the provider receives, prefix included, so a preview can never lie. */
export function buildUgcImagePrompt(ugcPrompt: string, people: boolean = true): string {
	return `${people ? UGC_IMAGE_PREFIX : UGC_IMAGE_PREFIX_NO_PEOPLE}${ugcPrompt}`;
}

/**
 * fal's image endpoints do NOT share a request shape -- flux/qwen want
 * `image_size` (an enum), nano-banana wants `aspect_ratio` (a ratio string).
 * Sending the wrong one is a 422 the user waits for, so the shape is derived from
 * the catalog rather than assumed at the call site.
 */
function fluxImageSize(aspect: string): string {
	switch (aspect) {
		case '1:1':
			return 'square_hd';
		case '16:9':
			return 'landscape_16_9';
		case '9:16':
			return 'portrait_16_9';
		case '4:3':
			return 'landscape_4_3';
		default:
			return 'portrait_4_3'; // 3:4 and anything unexpected
	}
}

function withSize(model: ModelOption, input: Record<string, any>, aspect: string) {
	if (model.sizeParam === 'aspect_ratio') input.aspect_ratio = aspect;
	else if (model.sizeParam === 'image_size') input.image_size = fluxImageSize(aspect);
	return input;
}

/** Text-to-image request for whichever model the user picked. */
function buildT2iInput(model: ModelOption, prompt: string, aspect: string) {
	return withSize(model, { prompt, num_images: 1 }, aspect);
}

/**
 * Image-EDIT request. Single-reference models (Kontext, Qwen Edit) take
 * `image_url`; only Nano Banana takes `image_urls`. We pass the PRIMARY reference
 * to single-ref models and drop the rest -- the catalog flags that as a caveat so
 * the user is TOLD their character sheet is being ignored, rather than silently
 * losing facial consistency.
 */
function buildEditInput(model: ModelOption, prompt: string, imageUrls: string[], aspect: string) {
	const input: Record<string, any> = { prompt, num_images: 1 };
	if (model.multiRef) input.image_urls = imageUrls;
	else input.image_url = imageUrls[0];
	return withSize(model, input, aspect);
}

/** What generateUgcImage actually ran — callers record THIS in the cost ledger
 *  and observability panel instead of guessing from which key was non-null. */
export interface UgcImageResult {
	url: string;
	provider: 'fal' | 'openrouter';
	model: string;
	/** Per-call USD from the registry route that produced this still, when one was in force. Absent → callers price from the static table as before. */
	usd?: number;
}

export async function generateUgcImage(
	ugcPrompt: string,
	orKey: string | null,
	falKey: string | null,
	modelId?: string | null,
	aspect: string = '3:4',
	people: boolean = true,
	/** Registry-resolved OpenRouter t2i route (resolveImageKeys().orRoutes.t2i). Omitted → the compiled-in constant, as before. */
	orRoute?: OpenRouterImageRoute
): Promise<UgcImageResult> {
	const imagePrompt = buildUgcImagePrompt(ugcPrompt, people);

	// An explicitly chosen model is a budget/quality decision the user made and
	// confirmed. It must win over the "OpenRouter first" default routing, which
	// would otherwise silently ignore the pick and bill a different model.
	if (modelId && falKey) {
		const model = resolveModel('image_t2i', modelId);
		const falData = await falSyncJson(model.id, buildT2iInput(model, imagePrompt, aspect), falKey);
		const url = falData.images?.[0]?.url;
		if (!url) throw new Error(`${model.label} returned no image`);
		return { url, provider: 'fal', model: model.id };
	}

	const viaFal = async (): Promise<UgcImageResult> => {
		const falData = await falSyncJson(
			UGC_IMAGE_MODEL_FAL,
			{ prompt: imagePrompt, image_size: fluxImageSize(aspect), num_images: 1 },
			falKey!
		);
		const url = falData.images?.[0]?.url;
		if (!url) throw new Error('fal image returned no URL');
		return { url, provider: 'fal', model: UGC_IMAGE_MODEL_FAL };
	};

	const viaOpenRouter = async (): Promise<UgcImageResult> => {
		// Same verified chat/completions image route the composite path uses —
		// OpenRouter's /images/generations rejected our previous model id outright.
		const content: any[] = [{ type: 'text', text: imagePrompt }];
		const res = await genFetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${orKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://personagen.app',
				'X-Title': 'PersonaGen'
			},
			body: JSON.stringify({
				model: orRoute?.id ?? UGC_IMAGE_MODEL_OPENROUTER,
				messages: [{ role: 'user', content }],
				modalities: ['image', 'text']
			})
		});
		if (!res.ok)
			throw new Error(
				`OpenRouter image failed (${res.status}): ${(await res.text()).slice(0, 200)}`
			);
		const data = (await res.json()) as any;
		const img = data.choices?.[0]?.message?.images?.[0];
		const url: string | undefined = img?.image_url?.url || img?.url;
		if (!url) throw new Error('OpenRouter image returned no URL');
		return {
			url,
			provider: 'openrouter',
			model: orRoute?.id ?? UGC_IMAGE_MODEL_OPENROUTER,
			usd: orRoute?.usd
		};
	};

	// One provider failing must not kill the slot when the other key exists —
	// a still is a still; degrade across providers instead of failing outright.
	if (orKey && falKey) {
		try {
			return await viaOpenRouter();
		} catch (e) {
			console.warn(
				`[UGC image] OpenRouter still failed (${(e as Error).message.slice(0, 120)}) — retrying on fal.`
			);
			return viaFal();
		}
	}
	if (orKey) return viaOpenRouter();
	if (falKey) return viaFal();
	throw new Error(
		'No image generation provider configured. Add an OpenRouter key or set FAL_API_KEY.'
	);
}

// ── Intent classification + prompt quality enhancement ──────────────────────

/** Minimum hookScore before the Director retries — tuned empirically. */
const HOOK_SCORE_THRESHOLD = 80;

type ContentType = 'testimonial' | 'unboxing' | 'lifestyle' | 'tutorial' | 'review';
type MotionLevel = 'gentle' | 'dynamic' | 'static';

interface ContentIntent {
	type: ContentType;
	motionLevel: MotionLevel;
	setting: 'indoor' | 'outdoor';
	platformVoice: string;
}

function classifyContentIntent(topic: string, platform: string): ContentIntent {
	const t = topic.toLowerCase();
	const type: ContentType = t.includes('unbox')
		? 'unboxing'
		: t.includes('how') || t.includes('tutorial') || t.includes('tip')
			? 'tutorial'
			: t.includes('lifestyle') || t.includes('routine') || t.includes('day in')
				? 'lifestyle'
				: t.includes('review') || t.includes('honest') || t.includes('worth it')
					? 'review'
					: 'testimonial';

	const motionLevel: MotionLevel =
		type === 'unboxing' ? 'dynamic' : type === 'lifestyle' ? 'gentle' : 'gentle';

	const setting: 'indoor' | 'outdoor' = type === 'lifestyle' ? 'outdoor' : 'indoor';

	const voiceMap: Record<string, string> = {
		tiktok:
			'Gen-Z casual energy, trending-aware, watch-till-end hook in first 1.5 seconds, fast-paced',
		instagram:
			'Aspirational yet real, lifestyle-forward, slightly polished but never stiff, community warmth',
		youtube:
			'Value-promise hook in first 3 seconds, slightly longer setup is OK, educational undertone welcome',
		threads: 'Hot-take conversational, opinion-first, like a trusted friend texting you',
		x: 'Punchy, opinionated, culturally aware, direct',
		facebook: 'Warm, community-oriented, relatable, slightly longer form OK'
	};

	return {
		type,
		motionLevel,
		setting,
		platformVoice: voiceMap[platform] ?? voiceMap.instagram
	};
}

// ── Hook framework library ───────────────────────────────────────────────────
// Proven short-form hook patterns. Variety is structural (rotated per post via
// a seed hash), not luck. Blueprint hook-patterns, when the user analyzed a
// channel, are injected separately and take precedence in the Director prompt.

interface HookFramework {
	name: string;
	pattern: string;
	bestFor: ContentType[];
}

const HOOK_FRAMEWORKS: HookFramework[] = [
	{
		name: 'Confession',
		pattern: `Admit something vulnerable/counterintuitive: "I was wrong about…", "I almost returned this…"`,
		bestFor: ['testimonial', 'review']
	},
	{
		name: 'Contrarian',
		pattern: `Attack the accepted belief: "Everyone tells you to X. That's exactly why you're stuck."`,
		bestFor: ['review', 'tutorial']
	},
	{
		name: 'Cost of inaction',
		pattern: `Name what ignoring this costs: "Every week you skip this, you're paying for it in…"`,
		bestFor: ['tutorial', 'testimonial']
	},
	{
		name: 'Specific number',
		pattern: `Oddly precise stat/result: "17 days. That's how long it took before…"`,
		bestFor: ['testimonial', 'review', 'tutorial']
	},
	{
		name: 'POV switch',
		pattern: `Speak as/to the skeptic: "To the person who scrolled past this twice already…"`,
		bestFor: ['testimonial', 'lifestyle']
	},
	{
		name: 'Before/after tease',
		pattern: `State the after, withhold the how: "My mornings look nothing like they did in March."`,
		bestFor: ['lifestyle', 'testimonial']
	},
	{
		name: 'Forbidden knowledge',
		pattern: `Insider framing: "Nobody in [industry] wants you to figure this out."`,
		bestFor: ['review', 'tutorial']
	},
	{
		name: 'Pattern break',
		pattern: `Open mid-story, no context: "So the second jar arrived and my husband hid it."`,
		bestFor: ['unboxing', 'lifestyle', 'testimonial']
	},
	{
		name: 'Stakes-first',
		pattern: `Lead with what was at risk: "I had one week before the wedding and zero plan."`,
		bestFor: ['lifestyle', 'testimonial']
	},
	{
		name: 'Anti-sell',
		pattern: `Disqualify buyers: "Honestly? Don't buy this if you only want…"`,
		bestFor: ['review', 'unboxing']
	}
];

/** Deterministic-ish rotation: same seed → same picks, different posts → different picks. */
function selectHookFrameworks(intent: ContentIntent, seed: string): HookFramework[] {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
	const matching = HOOK_FRAMEWORKS.filter((f) => f.bestFor.includes(intent.type));
	const rest = HOOK_FRAMEWORKS.filter((f) => !f.bestFor.includes(intent.type));
	const pool = [...matching, ...rest];
	const start = Math.abs(h) % Math.max(matching.length, 1);
	return [pool[start], pool[(start + 1) % pool.length], pool[(start + 2) % pool.length]];
}

/** Prompt block offering 3 rotated hook frameworks for this specific post. */
function buildHookGuidance(intent: ContentIntent, seed: string): string {
	const picks = selectHookFrameworks(intent, seed);
	return `HOOK FRAMEWORKS for this post — pick the ONE that fits the product/angle best and execute it precisely (do not blend them):
${picks.map((p, i) => `${i + 1}. ${p.name}: ${p.pattern}`).join('\n')}`;
}

// ── Independent quality grader (pre-media cost gate) ────────────────────────
// A SEPARATE adversarial pass — the Director must not grade its own homework.
// Runs on text only (≈free) BEFORE image/video generation (the expensive step),
// so weak drafts die before any media spend. Floor is deliberately lenient and
// env-tunable; 0 disables the gate entirely.

export interface QualityGrade {
	hook: number;
	authenticity: number;
	brandFit: number;
	cta: number;
	overall: number;
	topIssue: string;
	fix: string;
}

function qualityFloor(): number {
	const raw = Number(env.UGC_QUALITY_FLOOR);
	if (Number.isFinite(raw) && raw >= 0 && raw <= 10) return raw;
	return 5; // lenient default — placeholder-era models shouldn't empty the runway
}

const GRADER_SYSTEM = `You are a ruthless short-form content QC reviewer for UGC ads. You are NOT the writer — judge adversarially, as a scroller who has seen 10,000 ads.
Score each 1-10 (10 = top 1% of UGC):
- hook: does line 1 stop the scroll cold? (generic openers, questions, "elevate/discover" language = 3 or less)
- authenticity: does it read like a real person, not a brand? (banned-word smell, ad-speak = low)
- brandFit: does it plausibly sell THIS product to THIS audience?
- cta: natural, conversational close?
overall = 0.5*hook + 0.2*authenticity + 0.2*brandFit + 0.1*cta (round to 1 decimal).
Respond ONLY with JSON: {"hook":n,"authenticity":n,"brandFit":n,"cta":n,"overall":n,"topIssue":"one sentence","fix":"one concrete rewrite instruction"}`;

/** Grades a draft's text fields. Returns null on grader failure (never blocks generation on QC flakiness). */
async function gradeDraft(
	ai: AiClient,
	draft: { text?: string; dialogue?: string; on_screen_text?: string },
	productName: string | null,
	platform: string
): Promise<QualityGrade | null> {
	try {
		const raw = await ai.generate(
			`Platform: ${platform}. Product: ${productName || 'unknown'}.
CAPTION: ${draft.text || '(none)'}
SPOKEN DIALOGUE: ${draft.dialogue || '(none)'}
ON-SCREEN TEXT: ${draft.on_screen_text || '(none)'}
Grade it.`,
			{ systemInstruction: GRADER_SYSTEM, json: true, stage: 'qc_grade' }
		);
		const g = safeParseJson(raw || '');
		if (!g || typeof g.overall !== 'number') return null;
		return {
			hook: Number(g.hook) || 0,
			authenticity: Number(g.authenticity) || 0,
			brandFit: Number(g.brandFit) || 0,
			cta: Number(g.cta) || 0,
			overall: Number(g.overall) || 0,
			topIssue: String(g.topIssue || ''),
			fix: String(g.fix || '')
		};
	} catch (e) {
		console.warn('[QC] Grader pass failed (continuing ungated):', (e as Error).message);
		return null;
	}
}

/**
 * gradeDraft with one retry on grader failure. A single flaky grader call
 * shouldn't silently ungate media spend; two failures in a row means the
 * grade is genuinely unavailable — the caller proceeds ungated and tags the
 * post's content with qc_status 'ungraded' so those posts stay queryable.
 */
async function gradeDraftWithRetry(
	ai: AiClient,
	draft: { text?: string; dialogue?: string; on_screen_text?: string },
	productName: string | null,
	platform: string
): Promise<QualityGrade | null> {
	const first = await gradeDraft(ai, draft, productName, platform);
	if (first) return first;
	console.warn('[QC] Grader returned no grade — retrying once before proceeding ungated.');
	const second = await gradeDraft(ai, draft, productName, platform);
	if (!second) {
		console.warn(
			'[QC] Grader failed twice — generation proceeds ungated; post will carry qc_status "ungraded".'
		);
	}
	return second;
}

/** Best-effort append of an auto-rejection to post_reviews (the QC training log). */
async function logAutoReject(
	supabase: any,
	userId: string,
	agentId: string | undefined,
	grade: QualityGrade,
	draft: { text?: string }
): Promise<void> {
	try {
		await supabase.from('post_reviews').insert({
			user_id: userId,
			post_id: null,
			agent_id: agentId ?? null,
			decision: 'reject',
			reason: `auto-qc: ${grade.overall}/10 — ${grade.topIssue}`.slice(0, 500),
			content_snapshot: { text: draft.text ?? null, grade }
		});
	} catch (e) {
		console.warn('[QC] Failed to log auto-reject:', (e as Error).message);
	}
}

/**
 * Persona Model v2 — the life backbone, rendered as prompt facts.
 *
 * THE ONE CONSUMER of `personaBackboneEmits()`. Until this function existed the
 * staged rollout `off → shadow → fill → on` was a declaration: the switch could
 * be flipped all the way to `on` and nothing anywhere read it. This is the gate.
 *
 * Four rules, each load-bearing:
 *
 *  1. **`on` ONLY.** At `off`, `shadow` and `fill` this returns `[]` and the
 *     caller's output is byte-identical to what it emitted before this function
 *     was written. `fill` deliberately persists the backbone and still tells the
 *     model nothing — storing a fact and speaking it are two separate decisions,
 *     which is the whole reason the flag has four positions and not two.
 *  2. **Set leaves only.** No placeholders, no "unknown", no blank labels. A
 *     persona holding three facts contributes three facts. An unset leaf is
 *     absent, never an empty row — a prompt that says "Pets: none specified"
 *     has told the model something false about the person.
 *  3. **`label()`, never a raw token.** `partnered` is a storage token;
 *     "Partnered" is English. A token in a prompt is the en-dash incident
 *     waiting to happen again.
 *  4. **Fixed order, fixed shape.** The facts below are a hand-written list in
 *     a fixed sequence, not an object walk, so the same profile produces the
 *     same string on every call, in every process, forever.
 *
 * WHICH FACTS, AND WHY THESE NINE. The test is narrow: does the fact change how
 * a 30-second script reads? Six plain life facts do, and they are the six the
 * rollout doc's fact strip already shows the user, so what the model is told and
 * what the customer sees on the persona page cannot drift apart. Three further
 * rows are DIRECTIVES derived from those same stored fields rather than more
 * facts, because a fact the model has to interpret is a fact half of them will
 * interpret wrongly:
 *
 *   • **Age** — the single strongest register cue. A 24-year-old and a
 *     46-year-old do not open a video the same way.
 *   • **Home** — city, region, and urban/suburban/regional/rural. Decides what
 *     is plausible to reference: a commute, a beach, a two-hour drive to a shop.
 *   • **Local** — the market rendered as money and weather rather than as a
 *     country name: which currency a price is quoted in, and which way the
 *     seasons run. Derived from `creator.market`, deliberately NOT from
 *     `location.timezone`: every AU zone is southern and every US/UK zone is
 *     northern, so the market answers the same question, and `touchpoints.ts`
 *     reserves `timezone` for `display` alone. `generic` is a fictional market
 *     with neither currency nor hemisphere, so it contributes only its label.
 *     No CURRENT season is computed — that would make this function's output a
 *     function of the clock, which rule 4 forbids.
 *   • **Work** — title, field, seniority, employment status, and on-site /
 *     hybrid / remote. Decides what the person can plausibly be doing at 10am,
 *     what they are expert in, and how time-poor they sound.
 *   • **Credibility** — the same job again, as authority rather than as a fact.
 *     "Work: Registered nurse" tells the model what the person is; this tells it
 *     where a claim may be backed from and — the half that actually protects the
 *     brand — that expertise the job does not confer may not be claimed.
 *   • **Household** — partner, children and their ages, housing, pets. This is
 *     where most of a UGC script's incidental detail comes from: who is off
 *     camera, whose toy is on the floor, whose kitchen this is.
 *   • **Lifestyle** — activity level, transport, diet. Decides what they would
 *     actually buy, eat, and complain about.
 *   • **Character** — the derived Big Five trait labels ("Curious",
 *     "Organised", "Blunt"). The five raw 0–100 scores are NOT emitted: a model
 *     given "neuroticism: 71" writes a psychology report, a model given
 *     "Sensitive" writes a person.
 *   • **Manner** — the same Big Five as short behavioural directives ("you push
 *     back and say the blunt thing"), one per trait that is extreme, off the
 *     SAME ≥ 65 / ≤ 35 thresholds the sampler uses to derive `traitLabels`, so
 *     the two rows can never contradict each other. An adjective is a label the
 *     model must interpret; a directive is one it can perform. Still no score
 *     reaches the prompt.
 *
 * DELIBERATELY NOT EMITTED, so the section stays six lines instead of forty:
 *   • heritage / name / languages — identity, already carried by the portrait
 *     builders and `agent.name`; repeating heritage into a *script* prompt buys
 *     nothing and invites the model to write an accent.
 *   • the raw `bigFive` scores, `birthday`, `timezone`, `socialPlatformsUsed`,
 *     `clothingSizes` — operational or numeric; none of them change a sentence.
 *     `bigFive` reaches the prompt only through **Manner**, as prose: a score
 *     never appears, and a test asserts it.
 *   • `economic.incomeBand` / `priceFrame` — genuinely script-changing, but
 *     they are the *audience's* price frame in every existing prompt line above,
 *     and emitting the creator's alongside them would read as a contradiction.
 *     Revisit when the audience block is rewritten (P3.x), not before.
 *   • `neverDiscusses` — a brand-safety denylist, not a life fact. It belongs in
 *     the guardrail block of the director prompt with the other prohibitions,
 *     and nothing populates it today (the sampler never writes it), so emitting
 *     it here would be a dead line with a live-looking test. RE-AUDITED for
 *     P4.1: `store.ts` validates the field and the Life details panel renders
 *     it, but no code path anywhere WRITES it, and `touchpoints.ts` does not
 *     list it for any consumer. Still out; wire it the day something fills it.
 *   • `audience.ageRanges` — already in this prompt, as labels, a few lines
 *     above: `readPersonaProfile` runs `downgradeV2toV1`, which maps every
 *     ageRange token through `label()` before the "Target age demographic"
 *     line, and all six tokens survive that mapping. A row here would tell the
 *     model the same thing twice, so `backbone-context.spec.ts` pins the
 *     existing line instead of duplicating it.
 *
 * A BUCKET AGE IS NOT AN AGE. `upgradeV1toV2` turns a v1 apparent-age bucket
 * ("30–35") into `age: 32, ageSource: 'bucket'` so the number has *something* to
 * sort by. That midpoint is a rendering convenience, not a fact about the
 * person, and asserting "You are 32" to the model on the strength of it invents
 * precision the customer never supplied. Only an `exact` age (or one stored with
 * no `ageSource` at all, i.e. written as a real value) is emitted.
 *
 * Never throws: a malformed, empty or still-v1 profile contributes no lines,
 * which is the correct answer rather than a failed generation.
 */
function personaBackboneLines(agent: any): string[] {
	if (!personaBackboneEmits()) return [];

	let creator: Record<string, unknown>;
	try {
		const profile = readPersonaProfileV2(agent) as unknown;
		const c = isObj(profile) ? profile.creator : undefined;
		if (!isObj(c)) return [];
		creator = c;
	} catch {
		// A profile shape nobody anticipated must not take a generation down.
		return [];
	}

	/** Trimmed non-empty string, else undefined. */
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.trim() ? v.trim() : undefined;
	/** A token rendered through the registry; unset and unknown-blank both drop. */
	const lbl = (group: Parameters<typeof label>[0], v: unknown): string | undefined => {
		const token = str(v);
		return token ? str(label(group, token)) : undefined;
	};
	/** An array of tokens rendered in stored order, de-duplicated. */
	const lblList = (group: Parameters<typeof label>[0], v: unknown): string[] =>
		Array.isArray(v)
			? Array.from(new Set(v.map((x) => lbl(group, x)).filter((x): x is string => !!x)))
			: [];
	/** 'A · B · C' from the parts that exist, or undefined when none do. */
	const join = (...parts: (string | undefined)[]): string | undefined => {
		const kept = parts.filter((p): p is string => !!p);
		return kept.length ? kept.join(' · ') : undefined;
	};

	const facts: { key: string; value: string | undefined }[] = [];

	// 1. Age — exact only; a bucket midpoint is not a fact (see header).
	const age = creator.age;
	const ageSource = str(creator.ageSource);
	facts.push({
		key: 'Age',
		value:
			typeof age === 'number' && Number.isFinite(age) && ageSource !== 'bucket'
				? String(Math.round(age))
				: undefined
	});

	// 2. Home — 'Brisbane, Queensland · Urban', or whichever half exists.
	const location = isObj(creator.location) ? creator.location : {};
	const city = str(location.city);
	const region = str(location.region);
	facts.push({
		key: 'Home',
		value: join(
			city && region ? `${city}, ${region}` : (city ?? region),
			lbl('geographicContext', location.geographicContext)
		)
	});

	// 3. Local — what the place implies, not what it is called: the currency a
	//    price is quoted in and which way the seasons run. Keyed off `market`
	//    (see header); an unlisted or fictional market contributes neither.
	const CURRENCY: Record<string, string> = {
		au: 'prices are in Australian dollars (A$)',
		us: 'prices are in US dollars ($)',
		uk: 'prices are in pounds (£)'
	};
	const SEASONS: Record<string, string> = {
		au: 'southern-hemisphere seasons (December is summer)',
		us: 'northern-hemisphere seasons (December is winter)',
		uk: 'northern-hemisphere seasons (December is winter)'
	};
	const market = str(creator.market);
	facts.push({
		key: 'Local',
		value: join(
			lbl('market', creator.market),
			market ? CURRENCY[market] : undefined,
			market ? SEASONS[market] : undefined
		)
	});

	// 4. Work — reading order: what they do, in what field, how senior, employed
	//    how, from where.
	const work = isObj(creator.work) ? creator.work : {};
	facts.push({
		key: 'Work',
		value: join(
			str(work.title),
			lbl('workDomain', work.domain),
			lbl('seniority', work.seniority),
			lbl('employmentStatus', work.employmentStatus),
			lbl('workLocationMode', work.workLocationMode)
		)
	});

	// 5. Credibility — the job as authority rather than as biography. The title
	//    is repeated on purpose: this row is a rule about what may be asserted,
	//    and a rule that points at another row is a rule half of them will miss.
	const jobPhrase = str(work.title) ?? lbl('workDomain', work.domain);
	facts.push({
		key: 'Credibility',
		value: jobPhrase
			? `your day job (${jobPhrase}) is where your first-hand knowledge comes from, so reach for it when a claim needs backing, and claim no expertise it does not give you`
			: undefined
	});

	// 6. Household — partner, children (count + bands), housing, pets.
	const household = isObj(creator.household) ? creator.household : {};
	const children = isObj(household.children) ? household.children : {};
	const count = children.count;
	const bands = lblList('childAgeBand', children.ageBands);
	const childPhrase =
		typeof count === 'number' && Number.isFinite(count) && count > 0
			? `${Math.round(count)} ${Math.round(count) === 1 ? 'child' : 'children'}${bands.length ? ` (${bands.join(', ')})` : ''}`
			: bands.length
				? `children (${bands.join(', ')})`
				: undefined;
	const pets = lblList('pet', household.pets);
	facts.push({
		key: 'Household',
		value: join(
			lbl('relationshipStatus', household.relationshipStatus),
			childPhrase,
			lbl('housingType', household.housingType),
			pets.length ? `Pets: ${pets.join(', ')}` : undefined
		)
	});

	// 7. Lifestyle — how they move, how they travel, how they eat.
	const lifestyle = isObj(creator.lifestyle) ? creator.lifestyle : {};
	facts.push({
		key: 'Lifestyle',
		value: join(
			lbl('activityLevel', lifestyle.activityLevel),
			lbl('transportMode', lifestyle.transportMode),
			lbl('dietaryStyle', lifestyle.dietaryStyle)
		)
	});

	// 8. Character — derived trait labels only, never the raw scores.
	const traits = lblList('traitLabel', creator.traitLabels);
	facts.push({ key: 'Character', value: traits.length ? traits.join(' · ') : undefined });

	// 9. Manner — the same Big Five, as behaviour the model can perform. Fixed
	//    trait order (object-literal insertion order, never a key sort of stored
	//    data) so the row is byte-stable; a mid-range trait says nothing, which
	//    is the correct answer rather than a hedged sentence.
	const TRAIT_DIRECTIVES: Record<string, { high: string; low: string }> = {
		openness: {
			high: 'you reach for the unusual angle and say what a thing reminds you of',
			low: 'you stay with what you already know works'
		},
		conscientiousness: {
			high: 'you plan it, you finish it, and the details matter to you',
			low: 'you improvise, and you let the loose ends show'
		},
		extraversion: {
			high: 'you talk to camera like a friend and you fill the silences',
			low: 'you are measured, and you let a pause sit'
		},
		agreeableness: {
			high: 'you give people the benefit of the doubt',
			low: 'you push back and say the blunt thing'
		},
		neuroticism: {
			high: 'you notice what could go wrong and you say so out loud',
			low: 'very little rattles you'
		}
	};
	// The sampler's own HIGH_TRAIT / LOW_TRAIT, which are module-private there.
	// Restated rather than exported: this file must not reach into the sampler's
	// internals, and the numbers are part of the contract, not an implementation
	// detail — `schema.ts` documents traitLabels as "≥ 65 high, ≤ 35 low".
	const HIGH_TRAIT = 65;
	const LOW_TRAIT = 35;
	const bigFive: Record<string, unknown> = isObj(creator.bigFive) ? creator.bigFive : {};
	const manner: string[] = [];
	for (const [trait, pair] of Object.entries(TRAIT_DIRECTIVES)) {
		const score = bigFive[trait];
		if (typeof score !== 'number' || !Number.isFinite(score)) continue;
		if (score >= HIGH_TRAIT) manner.push(pair.high);
		else if (score <= LOW_TRAIT) manner.push(pair.low);
	}
	facts.push({ key: 'Manner', value: manner.length ? manner.join('; ') : undefined });

	const set = facts.filter((f) => f.value);
	if (!set.length) return [];

	return [
		'',
		'Life backbone — true facts about the person you are. Let them shape what you notice, reference, and could plausibly be doing; never read them out as a list, and never state one that is not here:',
		...set.map((f) => `- ${f.key}: ${f.value}.`)
	];
}

/**
 * Builds a rich agent context string from the agent row, pulling extended
 * persona profile off the agent row via the typed accessor.
 *
 * Exported for `prompt-regression.spec.ts`, which pins this and the portrait
 * builders byte-for-byte against fixed persona fixtures: any change to what the
 * model is told about a persona must show up as a reviewed snapshot diff.
 */
export function buildRichAgentContext(agent: any): string {
	const lines: string[] = [
		`You are ${agent.name} (@${agent.handle}), a ${agent.niche} creator.`,
		// Identity anchor: some older persona profiles were generated with a NAMED
		// target avatar (a since-fixed generator bug), so guard against any stray name
		// leaking into the script and breaking character.
		`Your name is ALWAYS ${agent.name} — never introduce yourself as, or invent, any other name, and never address the viewer by a personal name (the "Ideal viewer profile" below describes your audience, not a named character).`,
		`Core personality: ${agent.soul || 'authentic and relatable'}.`
	];

	const pp: Record<string, any> = readPersonaProfile(agent);

	if (pp.archetype)
		lines.push(
			`Persona archetype: "${pp.archetype}" — let this archetype's energy, tone, and style govern every creative decision.`
		);
	if (pp.contentFocus) lines.push(`Primary content focus: ${pp.contentFocus}.`);
	if (pp.contentAngle)
		lines.push(
			`Signature content angle / POV: "${pp.contentAngle}" — this is the unique lens through which all content is filtered.`
		);
	if (Array.isArray(pp.ageRanges) && pp.ageRanges.length)
		lines.push(`Target age demographic: ${pp.ageRanges.join(', ')}.`);
	else if (pp.ageMin && pp.ageMax)
		lines.push(`Target age demographic: ${pp.ageMin}–${pp.ageMax} year olds.`);
	if (pp.targetAvatar)
		lines.push(`Ideal viewer profile: ${stripLeadingAvatarName(pp.targetAvatar)}.`);
	if (pp.psychProfile)
		lines.push(
			`Audience psychology (use to tune emotional hooks and pain-point language): ${pp.psychProfile}.`
		);

	// Profile-tab Skills column — the persona editor stores a JSON array of
	// {name, md} items in the legacy text column; older personas may hold plain
	// text. Either way it describes content capabilities the director should
	// lean on ("expert in X", "always does street interviews"), so surface a
	// compact summary. Tools/integrations are operational, not creative — skipped.
	const rawSkills = typeof agent.skills === 'string' ? agent.skills.trim() : '';
	if (rawSkills) {
		let skillsSummary = '';
		try {
			const items = JSON.parse(rawSkills);
			if (Array.isArray(items)) {
				skillsSummary = items
					.filter((s: any) => s?.name && s.name !== 'Legacy notes')
					.map((s: any) => (s.md ? `${s.name} (${String(s.md).slice(0, 80)})` : s.name))
					.join('; ');
			}
		} catch {
			skillsSummary = rawSkills.slice(0, 300); // legacy plain text
		}
		if (skillsSummary) lines.push(`Creator skills & capabilities: ${skillsSummary.slice(0, 400)}.`);
	}

	// Persona Model v2 backbone. Appended LAST and in its own delimited block so
	// nothing above is reordered, reworded or removed: below PERSONA_BACKBONE=on
	// this contributes zero lines and the string is byte-identical to the one
	// this function returned before the backbone existed.
	lines.push(...personaBackboneLines(agent));

	return lines.join('\n');
}

/**
 * Extracts brand visual direction from the brand brief for threading into
 * image generation prompts (Nano Banana) and the Director's style guidance.
 */
function buildBrandVisualContext(briefData: any): string {
	if (!briefData) return '';
	const parts: string[] = [];
	// The brand brief stores primaryColor/secondaryColor/traits/commStyle (scraped
	// or manual). Read those real fields, with the aspirational names as fallbacks.
	const colors =
		[briefData.primaryColor, briefData.secondaryColor].filter(Boolean).join(', ') ||
		briefData.brandColors;
	if (colors) parts.push(`Brand color palette: ${colors}`);
	if (briefData.fontPrimary) parts.push(`Primary font: ${briefData.fontPrimary}`);
	const traits = Array.isArray(briefData.traits) ? briefData.traits.join(', ') : briefData.traits;
	const personality =
		briefData.brandPersonality || [traits, briefData.commStyle].filter(Boolean).join(' · ');
	if (personality) parts.push(`Visual personality: ${personality}`);
	if (briefData.tagline) parts.push(`Brand tagline/essence: ${briefData.tagline}`);
	if (briefData.ugcGuidelines) parts.push(`UGC visual guidelines: ${briefData.ugcGuidelines}`);
	return parts.length > 0 ? `Brand visual direction — ${parts.join('. ')}.` : '';
}

/**
 * Enriches the Director's motion_prompt with Kling-optimized camera vocabulary
 * so the video model gets precise, actionable movement instructions rather than
 * vague adjectives like "subtle" or "smooth".
 */
function enhanceMotionPrompt(
	basePrompt: string,
	intent: ContentIntent,
	// Only "is a person addressing the lens?" matters here. Narrated motion has
	// nobody on camera, so it takes the product direction like plain b-roll — and
	// so does a v2v run, which never sees this string at all (wan-animate takes no
	// prompt): it is built anyway because the never-brick i2v fallback needs one.
	format:
		| 'spokesperson'
		| 'broll'
		| 'vo_broll'
		| 'motion_card'
		| 'v2v_replace'
		| 'v2v_move'
		| 'v2v_narrated'
		| 'listicle'
): string {
	const cameraByLevel: Record<MotionLevel, string> = {
		static:
			'Locked-off shot. Zero camera movement. Subject acts naturally in front of a completely still frame. Only ambient environmental movement (steam, foliage, fabric) is permitted.',
		gentle:
			'Very slow gimbal dolly-in (2-4 cm over the full clip duration). Minimal handheld breathing. Near-imperceptible movement — cinematic stillness with life, not shakey cam.',
		dynamic:
			'Confident gimbal arc sweeping 15-20°. Motivated push-in on the product reveal moment. Brief rack-focus shift at the payoff beat. Energy without chaos.'
	};

	const subjectByFormat =
		// A listicle is spoken to the lens like any other spokesperson run — it
		// belongs on this side of the branch, not with the product-only directions.
		format === 'spokesperson' || format === 'listicle'
			? 'Character: natural direct eye contact with lens, occasional glance to product, subtle head tilt on key spoken word. Real micro-expressions — not posed or frozen.'
			: 'Product: slow rotation revealing texture, label, and material. Hand entering frame to pick up or use it. Real surface contact — not floating or artificially suspended.';

	return `${basePrompt}\n\nCamera: ${cameraByLevel[intent.motionLevel]}\n${subjectByFormat}\nTechnical: smooth motion, no compression artifacts, no overexposed highlights, no jump cuts.`;
}

/**
 * The realism register the composer pinned, as the exact template constant.
 * 'third' resolves to nothing on purpose: "someone else took this photo" is the
 * absence of a self-shot instruction, not another instruction. Returns '' when
 * nothing was pinned so the caller can splice unconditionally.
 */
function framingClause(framing: UgcPackInput['framing']): string {
	if (framing === 'front') return SELFIE_LOOK;
	if (framing === 'mirror') return MIRROR_LOOK;
	return '';
}

/**
 * Composes the framing register ONTO a scene brief rather than replacing it —
 * the user's visual brief says what is happening, framing says who is holding
 * the camera, and dropping either one would make the composer's two controls
 * fight each other.
 */
function withFraming(scenePrompt: string, framing: UgcPackInput['framing']): string {
	const clause = framingClause(framing);
	// Idempotent: the scene a refine edits is the PROMPT THAT RAN, which already
	// carries the clause. Splicing it twice would double the instruction.
	if (!clause || scenePrompt.includes(clause)) return scenePrompt;
	return `${scenePrompt}\n\n${clause}`;
}

/**
 * The only palette identifier resolveCardPalette() understands is a hex ground
 * (it derives the ink from that color's luminance). Anything else — 'auto', a
 * name, a typo — resolves to null so the brand brief's own colors survive
 * instead of being replaced by an unparseable value.
 */
function cardGroundOverride(cardPalette: string | undefined): string | null {
	const raw = (cardPalette || '').trim();
	if (!raw || raw.toLowerCase() === 'auto') return null;
	return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : null;
}

/**
 * Art direction for a pinned card layout, in the renderer's own CardLayout
 * vocabulary. Used on the MODEL card path (the fallback renderer), which takes
 * only a prompt — the $0 local renderer derives its layout from the line's shape
 * inside card-renderer.ts and has no layout parameter to pin.
 */
const CARD_LAYOUT_DIRECTION: Record<string, string> = {
	statement: 'Composition: a single huge centered statement — a few words filling the frame.',
	quote:
		'Composition: a pull-quote — the line set large with generous margins and a rule above it.',
	stack: 'Composition: a vertical stack of short left-aligned lines, one thought per line.',
	list: 'Composition: a numbered list, each item on its own line with the numeral as the accent.',
	split: 'Composition: two contrasting halves of the frame — one claim per half.'
};

/** Splices a pinned card layout into the art direction; 'auto'/absent is a no-op.
 *  Idempotent for the same reason withFraming is — a refine edits the prompt that
 *  already ran. */
function withCardLayout(artDirection: string, layout: UgcPackInput['cardLayout']): string {
	const line = layout && layout !== 'auto' ? CARD_LAYOUT_DIRECTION[layout] : '';
	if (!line || artDirection.includes(line)) return artDirection;
	return `${artDirection}\n\n${line}`;
}

/**
 * "Use my own still" gate. Only an http(s) URL is usable — the still is handed
 * straight to fal/OpenRouter and to our own storage fetcher, and a data: or
 * file: URL would fail there after the run had already spent on the Director.
 */
function suppliedStillUrl(raw: string | undefined): string | null {
	const url = (raw || '').trim();
	return /^https?:\/\//i.test(url) ? url : null;
}

/** Nano Banana: composite the references this composition actually uses into a
 *  UGC scene — product + face, face only (product-free channel content), or
 *  product only (persona-free product shots). Every instruction line is
 *  conditional on the ref it describes, so the model is never told to preserve
 *  a product that isn't attached (which conjures a generic one). */
async function generateProductStill(
	falKey: string,
	scenePrompt: string,
	productPhotoUrl: string | null,
	characterRef: string | null,
	brandVisualContext?: string,
	/** Composer's still-model pick, already resolved to a catalog entry (kind
	 *  'image_edit' — this call composites references). Omitted → the compiled-in
	 *  Nano Banana edit endpoint with its hand-written input shape, as before. */
	model?: ModelOption | null
): Promise<string> {
	const refs = [characterRef, productPhotoUrl].filter(Boolean) as string[];
	if (refs.length === 0) throw new Error('Composite still needs at least one reference image');
	const brandLine = brandVisualContext ? `\n\nBrand visual direction: ${brandVisualContext}` : '';
	const prompt = [
		scenePrompt,
		'',
		'Vertical 9:16 photorealistic UGC photo. Shoot quality: shot on iPhone 15 Pro with ProRAW, 24mm equivalent, natural light, real environment — NOT a studio ad or stock photo.',
		// Image models love adding promo captions to ad-style scenes — this produced
		// ugly baked-in text that collided with our real captions. Forbid it outright.
		`ABSOLUTELY NO text, captions, subtitles, words, letters, numbers, logos, watermarks, or graphic/UI overlays anywhere in the frame. A clean photographic image only${productPhotoUrl ? ' — the ONLY text allowed is the real product label already on the packaging' : ''}.`,
		productPhotoUrl
			? 'Product accuracy: preserve the exact label typography, packaging shape, color, and material from the reference. Never redesign, genericize, or omit the product.'
			: 'No commercial products in frame — this is organic channel content, not an ad.',
		characterRef
			? 'Character consistency: the person must be IDENTICAL to the first reference image — same facial bone structure, skin tone, hair color, and texture. Not a similar person. The exact same person.'
			: '',
		'Imperfection is quality: slight skin texture visible, natural shadows, lived-in authentic setting — not retouched or plastic-looking.',
		brandLine
	]
		.filter(Boolean)
		.join('\n');

	// A picked model goes through buildEditInput so single-reference editors get
	// `image_url` instead of the `image_urls` only Nano Banana accepts; with no
	// pick the literal below is preserved byte-for-byte so the default path is
	// unchanged.
	const data = await falSyncJson(
		model ? model.id : NANO_MODEL,
		model
			? buildEditInput(model, prompt, refs, '9:16')
			: { prompt, image_urls: refs, aspect_ratio: '9:16' },
		falKey
	);
	const url = data.images?.[0]?.url;
	if (!url) throw new Error(`${model?.label ?? 'Nano Banana'} returned no image`);
	return url;
}

/** The exact string a graphic card sends — exported so previews/tests show the truth. */
export function buildGraphicStillPrompt(
	cardText: string,
	artDirection: string,
	brandVisualContext?: string
): string {
	return [
		`Flat graphic-design social card, NOT a photograph. Render EXACTLY this text, verbatim, with flawless spelling, as the composition's message: "${cardText}"`,
		artDirection,
		'Typography is the artwork: clean kerning, deliberate hierarchy, high contrast between type and ground. No people, no products, no photographic elements, no watermarks — type and simple graphic shapes only.',
		brandVisualContext ? `Brand visual direction: ${brandVisualContext}` : ''
	]
		.filter(Boolean)
		.join('\n\n');
}

/** Text-to-image sibling of the edit endpoint — graphic cards feed no references. */
const NANO_T2I_MODEL = NANO_MODEL.replace(/\/edit$/, '');

/** Typographic card: the inverse contract of generateProductStill. The
 *  Director's line IS the artwork — no reference images, no photorealism.
 *  Nano Banana stays primary because it renders type far better than flux. */
async function generateGraphicStill(
	falKey: string,
	cardText: string,
	artDirection: string,
	brandVisualContext?: string,
	/** Composer's still-model pick, resolved as 'image_t2i' (a card feeds no
	 *  references). Omitted → Nano Banana t2i, which renders type far better than
	 *  the cheap models and so stays the default here. */
	model?: ModelOption | null
): Promise<string> {
	const prompt = buildGraphicStillPrompt(cardText, artDirection, brandVisualContext);
	const data = await falSyncJson(
		model ? model.id : NANO_T2I_MODEL,
		model ? buildT2iInput(model, prompt, '9:16') : { prompt, aspect_ratio: '9:16' },
		falKey
	);
	const url = data.images?.[0]?.url;
	if (!url) throw new Error(`${model?.label ?? 'Nano Banana'} returned no image`);
	return url;
}

async function generateVoiceAudio(
	falKey: string,
	voice: string,
	text: string,
	fallbackVoice?: string,
	/** Registry-resolved voice route. Omitted → the compiled-in constant, as before. */
	route?: OpenRouterImageRoute
): Promise<{ url: string; voiceUsed: string }> {
	const ttsModel = route?.id ?? TTS_MODEL;
	const call = (v: string) =>
		falSyncJson(ttsModel, { text, voice: v, stability: 0.5, similarity_boost: 0.75 }, falKey);
	let data: any;
	let voiceUsed = voice;
	try {
		data = await call(voice);
	} catch (e) {
		// fal returns 422 ("feature_not_supported" on body.voice) for voices its
		// ElevenLabs endpoint doesn't accept (some Voice-Library names). NEVER fail the
		// whole post over a voice pick — retry once with a classic, always-supported
		// fallback so audio still generates.
		const msg = (e as Error).message || '';
		const voiceUnsupported = /\b422\b|not.?supported|feature_not_supported|"voice"/i.test(msg);
		if (fallbackVoice && fallbackVoice !== voice && voiceUnsupported) {
			console.warn(
				`[TTS] Voice '${voice}' rejected by fal (${msg.slice(0, 100)}) — falling back to '${fallbackVoice}'.`
			);
			data = await call(fallbackVoice);
			voiceUsed = fallbackVoice;
		} else {
			throw e;
		}
	}
	const url = data.audio?.url;
	if (!url) throw new Error('TTS returned no audio');
	// The caller records voiceUsed on the post — the display must name the voice
	// that actually spoke, not the one that was merely requested.
	return { url, voiceUsed };
}

// ── Listicle: the numbered countdown, timed to speech ───────────────────────
// The format's whole value is that item N appears at the instant it is SPOKEN,
// and nothing in a single TTS blob says when that instant is. Character counts,
// words-per-minute estimates and "divide the clip into N" all drift within the
// first two items — a rephrase that adds three syllables, or the half-second
// pause the model inserts mid-phrase, and every later reveal is early. So the
// voiceover is generated one segment PER BEAT and each segment is MEASURED; the
// reveal times are then arithmetic on real durations rather than a guess.
// That per-beat call is also what `$lib/formats` bills (`stepBilling.tts:
// 'per_item'`) — the quote and the ledger both count beats, not posts.

/** One beat of the list: what is drawn, and what is said while it is drawn. */
export interface ListItem {
	/** The on-screen label, unnumbered — the burn adds "1. ", "2. ". */
	label: string;
	/** The sentence spoken for this beat. Its own TTS call, its own duration. */
	line: string;
}

/**
 * ITEMS, from the shared BEAT bounds — the off-by-one is the whole reason this
 * is written out rather than used inline. `$lib/formats` counts the framing line
 * as beat one, because that is what the voiceover stage is billed per; the list
 * is everything after it. Confusing the two either bills a call that never
 * happened or speaks one nobody quoted.
 *
 * The ceiling is capped again by `MAX_TIMED_CAPTIONS`: the burn draws at most
 * that many rows, and an item spoken with no row to land in is a beat the user
 * paid for and cannot see.
 */
const LISTICLE_MIN_ITEMS = MIN_ITEMS - 1;
const LISTICLE_MAX_ITEMS = Math.min(MAX_ITEMS - 1, MAX_TIMED_CAPTIONS);
/**
 * Items written when the request carries no count. `$lib/formats` quotes this
 * same default, so the ledger and the quote agree on the ordinary run — which
 * they would NOT if the Director were simply asked for "3-5" and handed back
 * five against a four-beat quote.
 */
const LISTICLE_DEFAULT_ITEMS = DEFAULT_ITEMS - 1;
/** Labels are read at a glance off a phone; four words is already generous. */
const LIST_LABEL_MAX_WORDS = 4;
/**
 * Silence inserted between beats. Not cosmetic: back-to-back TTS segments join
 * with no breath at all and the list runs together as one sentence, which is the
 * opposite of the beat-by-beat rhythm the format is built on. It is also the
 * only padding in the timeline, so it is counted into the reveal times below
 * rather than assumed away.
 */
const LISTICLE_BEAT_GAP_SEC = 0.35;

/**
 * Reads the Director's `list_items` defensively.
 *
 * Model output, so nothing is trusted: a non-array, a string where an object
 * belongs, a missing `line`, an empty `label` are all dropped rather than
 * shipped as a blank row that reserves screen space and says nothing. Over-long
 * labels are TRIMMED rather than dropped — a five-word label is a usable list
 * item, and discarding it would silently shorten a list the user paid to have
 * spoken.
 *
 * `maxItems` is the count the run was QUOTED for, so the cut is here rather than
 * at the burn: an extra item that survived this far would be a paid voiceover
 * call nobody priced. Coming back SHORT is the safe direction and is allowed —
 * it bills less than quoted, never more.
 *
 * `labels` are the user's own, positionally: index i belongs to item i+1, and a
 * blank at that index means "keep what the Director wrote". Blanks are kept for
 * exactly that reason — filtering them would slide every later label onto an
 * item the user never wrote it for.
 */
function parseListItems(raw: unknown, maxItems: number, labels?: string[]): ListItem[] {
	if (!Array.isArray(raw)) return [];
	const items: ListItem[] = [];
	// One clamp for both sources. A user's pinned label goes through exactly the
	// same gate as the model's: it is drawn into the same row, and a 160-character
	// "label" runs off the frame whoever typed it.
	const asLabel = (raw: unknown) =>
		String(raw ?? '')
			.replace(/\s+/g, ' ')
			.trim()
			.split(' ')
			.slice(0, LIST_LABEL_MAX_WORDS)
			.join(' ')
			.slice(0, 48);

	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const label =
			asLabel(labels?.[items.length]) || asLabel((entry as Record<string, unknown>).label);
		const line = String((entry as Record<string, unknown>).line ?? '')
			.replace(/[\r\n]+/g, ' ')
			.trim()
			.slice(0, 400);
		if (!label || !line) continue;
		items.push({ label, line });
		if (items.length >= maxItems) break;
	}
	return items;
}

/**
 * Fetches each voiceover segment, joins them into one track with `gapSec` of
 * silence between beats, and returns the durable URL plus WHERE EACH SEGMENT
 * STARTS in the joined timeline.
 *
 * The measuring and the ffmpeg are NOT here: `concatAudio` owns both, because
 * $lib/server/video is the one module in this app allowed to know about temp
 * dirs and codecs. What is left is the only part that is this module's business
 * — hosting the result somewhere the lip-sync provider can reach it.
 *
 * The offsets are the entire point. concatAudio derives them from decoded sample
 * counts, so they describe the audio that is actually handed to the lip-sync
 * model, which in turn produces a clip exactly as long as its audio — which is
 * why a caption timed here lands on the right frame there.
 *
 * Returns null on ANY failure and never throws: no ffmpeg, an unfetchable
 * segment, a decode that produced nothing, no durable bucket to host the join.
 * The caller then falls back to a single un-segmented voiceover, because a
 * talking head with no reveals still ships and a failed run does not.
 */
async function joinVoiceSegments(
	svc: any,
	userId: string,
	segmentUrls: string[],
	gapSec: number
): Promise<{ url: string; startsAt: number[] } | null> {
	if (!svc || segmentUrls.length === 0) return null;
	const joined = await concatAudio(segmentUrls, { gapSeconds: gapSec });
	if (!joined) return null;
	try {
		// The lip-sync provider FETCHES this url itself, so it has to outlive the
		// request — a temp file or a signed link that expires mid-job is a 7-minute
		// wait ending in a download failure.
		const url = await persistBufferToStorage(svc, joined.bytes, userId, 'm4a', 'audio/mp4');
		return { url, startsAt: joined.startsAt };
	} catch (e) {
		console.warn('[Listicle] segment join failed:', (e as Error).message);
		return null;
	}
}

/**
 * The caption track, from measured segment starts.
 *
 * `startsAt[0]` is the framing line, so item N is `startsAt[N]` — the reveal
 * fires exactly as its own sentence begins. No `until` on any of them: the list
 * ACCUMULATES, which is the whole reason the format holds attention (see
 * TimedCaption in $lib/server/video).
 */
function buildListicleTrack(items: ListItem[], startsAt: number[]): TimedCaption[] {
	return (
		items
			.map((item, i) => ({ text: `${i + 1}. ${item.label}`, at: startsAt[i + 1] }))
			// A segment that produced no start (a shorter join than beats) would draw at
			// NaN, which ffmpeg reads as 0 and dumps the whole list on frame one.
			.filter((c) => Number.isFinite(c.at))
	);
}

async function generateTalkingHead(
	falKey: string,
	stillUrl: string,
	audioUrl: string,
	/** The composer's pick. Absent = the env-selected default, i.e. today's run. */
	modelId: string = TALKINGHEAD_MODEL
): Promise<string> {
	// Per-model input shape: VEED Fabric takes a `resolution`; OmniHuman and Kling
	// AI-Avatar take only image+audio and reject (422) params they don't declare.
	// The ID has to drive the shape rather than the module constant: a picked
	// Fabric with no resolution 422s, and a picked OmniHuman WITH one does too.
	const input: any = { image_url: stillUrl, audio_url: audioUrl };
	if (modelId.includes('veed/fabric')) input.resolution = FABRIC_RES;
	const data = await falQueueJson(modelId, input, falKey);
	const url = data.video?.url;
	if (!url) throw new Error('Talking-head model returned no video');
	return url;
}

/**
 * Character/product consistency does NOT come from a Kling-side reference
 * parameter — verified against the live OpenAPI spec and playground UI for
 * this endpoint, there is no `elements`/reference-image field, only
 * image_url/end_image_url/prompt/duration/generate_audio/multi_prompt. The
 * only real consistency lever is `stillUrl`: it must already have the
 * character + product composited into it (via generateProductStill's
 * Nano Banana pass) before it ever reaches Kling, since Kling only continues
 * motion from whatever visual it's handed.
 */
async function generateBrollVideo(
	falKey: string,
	model: string,
	stillUrl: string,
	motionPrompt: string,
	adapter?: UgcPackInput['videoAdapter']
): Promise<string> {
	// A generated adapter (Model Manager swap-in) takes precedence: it carries the
	// model's REAL param names, schema-default constants for required fields the
	// pipeline doesn't produce, and the output path — all derived from the live
	// OpenAPI probe. This is the path that makes discovered models actually run;
	// before it, an unknown id fell through to the name-guessing below and either
	// 422'd or wasn't called at all.
	// An adapter naming a source-clip param belongs to a video-to-video model, and
	// this is the image-to-video path — there is no clip to hand it. Building the
	// request anyway would omit a REQUIRED field and 422 after the user has waited
	// through the still. Fall through to the verified-catalog path below, which is
	// the never-brick behaviour every other adapter gap already gets.
	if (adapter?.text && !adapter.video) {
		const input: any = { ...(adapter.constants ?? {}) };
		input[adapter.text] = motionPrompt;
		if (adapter.image) input[adapter.image] = adapter.imageIsArray ? [stillUrl] : stillUrl;
		// Optional knobs only when the schema declares them AND the probe didn't
		// already pin them as required constants.
		if (adapter.duration && !(adapter.duration in input)) input[adapter.duration] = VIDEO_DURATION;
		if (adapter.audio && !(adapter.audio in input)) input[adapter.audio] = BROLL_AUDIO_ENABLED;
		const data = await falQueueJson(model, input, falKey);
		const url = adapter.output === 'videos[].url' ? data.videos?.[0]?.url : data.video?.url;
		if (!url) throw new Error('B-roll model returned no video (adapter path)');
		return url;
	}

	// Every i2v model here takes `image_url` as the start frame (verified against
	// the live OpenAPI specs — the older v3/pro `start_image_url` shape is NOT in
	// them and fails validation). Beyond that they diverge, and fal rejects params a
	// model doesn't declare: wan-i2v and hailuo have no `generate_audio`, and
	// wan-i2v has no `duration` (it counts frames). Blanket-sending Kling's shape to
	// a user-selected budget model would 422 after they'd already waited. So the
	// request is built from the catalog's verified capability flags.
	const spec = getModel(model);
	const input: any = { image_url: stillUrl, prompt: motionPrompt };
	if (spec?.supportsDuration ?? model.includes('kling')) input.duration = VIDEO_DURATION;
	if (spec?.supportsAudio ?? model.includes('kling')) input.generate_audio = BROLL_AUDIO_ENABLED;
	if (!model.includes('kling')) input.resolution = '1080p';
	const data = await falQueueJson(model, input, falKey);
	const url = data.video?.url;
	if (!url) throw new Error('B-roll model returned no video');
	return url;
}

/**
 * Video-to-video: re-performs a SOURCE clip as this persona (Wan Animate
 * replace/move). The sibling of generateBrollVideo, and the inverse of it —
 * there, the still is the only consistency anchor and the prompt supplies the
 * motion; here the motion, timing and (for `replace`) the whole scene come from
 * the source clip, and the reference image supplies only the identity. Wan
 * Animate takes NO prompt at all: sending motion direction would be a param the
 * endpoint doesn't declare, which fal rejects with a 422 the user waits for.
 *
 * `referenceImageUrl` must be a FULL-BODY shot. Handed the pinned bust-crop
 * face, the model invents a lower body, a wardrobe and a room to fill frame —
 * from-nothing anatomy on a paid clip. resolveFullBodyReference is the gate
 * that guarantees this; do not call this function around it.
 */
async function generateV2vVideo(
	falKey: string,
	model: string,
	sourceVideoUrl: string,
	referenceImageUrl: string,
	/** Only reaches an adapter that declares a text param — the verified
	 *  catalog path below has nowhere to put it (see above). */
	motionPrompt: string,
	adapter?: UgcPackInput['videoAdapter']
): Promise<string> {
	// The mirror image of generateBrollVideo's adapter guard. There, an adapter
	// naming a source-clip param is REFUSED because the i2v path has no clip to
	// hand it and would 422 on a required field. Here the run HAS a clip, so
	// `adapter.video` is precisely the field this path can fill — and the guard
	// inverts: an adapter with no video slot cannot be a v2v model, so driving it
	// would send the source clip nowhere and re-run i2v at v2v prices.
	if (adapter?.video) {
		const input: any = { ...(adapter.constants ?? {}) };
		input[adapter.video] = sourceVideoUrl;
		if (adapter.image)
			input[adapter.image] = adapter.imageIsArray ? [referenceImageUrl] : referenceImageUrl;
		// Some v2v models DO take an edit instruction; wan-animate does not. Only
		// set it when the probe found one, and never as a required-constant override.
		if (adapter.text && !(adapter.text in input)) input[adapter.text] = motionPrompt;
		const data = await falQueueJson(model, input, falKey, V2V_QUEUE_TIMEOUT_MS);
		const url = adapter.output === 'videos[].url' ? data.videos?.[0]?.url : data.video?.url;
		if (!url) throw new Error('Video-to-video model returned no video (adapter path)');
		return url;
	}

	// Verified request shape (2026-09-09, live run): video_url + image_url are
	// REQUIRED, resolution is the only optional knob worth pinning — use_turbo /
	// num_inference_steps / shift / guidance_scale / seed / video_quality /
	// video_write_mode all have schema defaults that a real run confirmed are
	// sane, and sending an undeclared param to a fal endpoint is a 422.
	const data = await falQueueJson(
		model,
		{ video_url: sourceVideoUrl, image_url: referenceImageUrl, resolution: V2V_RESOLUTION },
		falKey,
		V2V_QUEUE_TIMEOUT_MS
	);
	const url = data.video?.url;
	if (!url) throw new Error('Video-to-video model returned no video');
	return url;
}

// ── OpenRouter video failover (verified 2026-07-04 against the live API) ────
// OpenRouter now ships a Video Generation API (POST /api/v1/videos, async job
// with polling_url → unsigned_urls) carrying kwaivgi/kling-v3.0-std|pro,
// google/veo-3.1(-fast|-lite), seedance, wan, etc. Used as the b-roll fallback
// when fal is down (balance lock, outage) so autopilot keeps producing video.

const BROLL_MODEL_OPENROUTER = env.UGC_BROLL_MODEL_OR || 'kwaivgi/kling-v3.0-std';
// Reference-conditioned image editing on OpenRouter — same Nano-Banana model
// family fal serves, so faces/product composites survive a fal outage.
// Verified live 2026-07-05: google/gemini-3.1-flash-image is image-in→image-out.
const IMAGE_EDIT_MODEL_OPENROUTER = env.UGC_IMAGE_EDIT_MODEL_OR || 'google/gemini-3.1-flash-image';

/**
 * Reference-conditioned image generation via OpenRouter chat completions
 * (multimodal input + image output). Returns a URL; data: URLs are persisted
 * to Supabase storage first so post JSON never carries megabytes of base64.
 */
async function openRouterImageEdit(
	orKey: string,
	userId: string,
	prompt: string,
	imageUrls: string[],
	/** Registry-resolved OpenRouter edit route (resolveImageKeys().orRoutes.edit): the id that RUNS, read from the same registry row as the price that gets BILLED. REQUIRED — a compiled-in fallback here is precisely how those two drift apart. */
	route: OpenRouterImageRoute
): Promise<string> {
	const content: any[] = [{ type: 'text', text: prompt }];
	for (const url of imageUrls.slice(0, 4)) {
		content.push({ type: 'image_url', image_url: { url } });
	}
	const res = await genFetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${orKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://personagen.app',
			'X-Title': 'PersonaGen'
		},
		body: JSON.stringify({
			model: route.id,
			messages: [{ role: 'user', content }],
			modalities: ['image', 'text']
		})
	});
	if (!res.ok) {
		const t = await res.text();
		throw new Error(`OpenRouter image edit failed (${res.status}): ${t.slice(0, 200)}`);
	}
	const data = (await res.json()) as any;
	const img = data.choices?.[0]?.message?.images?.[0];
	const url: string | undefined = img?.image_url?.url || img?.url;
	if (!url) throw new Error('OpenRouter image edit returned no image');

	if (url.startsWith('data:')) {
		// Decode and persist — a base64 data URL must never end up in post content.
		const b64 = url.split(',')[1] || '';
		const buffer = Buffer.from(b64, 'base64');
		if (buffer.length === 0) throw new Error('OpenRouter image edit returned empty data URL');
		const svc = getServiceSupabase(); // throws when unconfigured → caller falls back
		return persistBufferToStorage(svc, buffer, userId, 'png', 'image/png');
	}
	return url;
}

/** fal failures that warrant provider failover (vs. bad-input errors that would fail anywhere). */
function isFalOutage(msg: string): boolean {
	return /exhausted balance|user is locked|\b403\b|\b429\b|\b5\d\d\b|timed out|ECONNRESET|fetch failed/i.test(
		msg
	);
}

/**
 * Image-to-video via OpenRouter's async videos API.
 *
 * CRITICAL: the completed job returns an AUTHENTICATED, EPHEMERAL content URL
 * (openrouter.ai/api/v1/videos/{id}/content — needs our Bearer key to fetch and
 * expires when the job is cleaned up). We MUST download it here, with the key,
 * and persist to durable storage — returning the permanent bucket URL. Storing
 * the raw content URL is what caused videos to 404 hours later. Throws if it
 * generated but couldn't be archived, so we never persist a link that will die.
 */
async function openRouterBrollVideo(
	orKey: string,
	userId: string,
	stillUrl: string,
	motionPrompt: string,
	timeoutMs = 270000,
	/** Registry-resolved OpenRouter video route (resolveImageKeys().orRoutes.video): the id that RUNS, read from the same registry row as the price that gets BILLED. REQUIRED — this route was the one model the ledger showed running that the Model Manager could not name. */
	route: OpenRouterImageRoute
): Promise<string> {
	const submit = await genFetch('https://openrouter.ai/api/v1/videos', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${orKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://personagen.app',
			'X-Title': 'PersonaGen'
		},
		body: JSON.stringify({
			model: route.id,
			prompt: motionPrompt,
			duration: parseInt(VIDEO_DURATION, 10) || 5,
			aspect_ratio: '9:16',
			generate_audio: BROLL_AUDIO_ENABLED,
			frame_images: [{ type: 'image_url', image_url: { url: stillUrl }, frame_type: 'first_frame' }]
		})
	});
	if (!submit.ok) {
		const t = await submit.text();
		throw new Error(`OpenRouter video submit failed (${submit.status}): ${t.slice(0, 200)}`);
	}
	const job = (await submit.json()) as any;
	const pollingUrl = job.polling_url || `https://openrouter.ai/api/v1/videos/${job.id}`;
	if (!job.id && !job.polling_url) {
		throw new Error(
			`OpenRouter video submit returned no job: ${JSON.stringify(job).slice(0, 200)}`
		);
	}

	const deadline = Date.now() + timeoutMs;
	// Poll immediately, sleep BETWEEN attempts (same shape as falQueueJson).
	while (Date.now() < deadline) {
		const res = await genFetch(pollingUrl, { headers: { Authorization: `Bearer ${orKey}` } });
		if (res.ok) {
			const st = (await res.json()) as any;
			if (st.status === 'completed') {
				const url = st.unsigned_urls?.[0] || st.urls?.[0] || st.video?.url;
				if (!url) throw new Error('OpenRouter video completed but returned no URL');
				// Persist NOW, with the Bearer header only we have, to a permanent URL.
				const svc = getServiceSupabase();
				return persistVideoDurable(svc, url, userId, { Authorization: `Bearer ${orKey}` });
			}
			if (st.status === 'failed') {
				throw new Error(`OpenRouter video job failed: ${JSON.stringify(st).slice(0, 200)}`);
			}
		} else if (res.status !== 429 && res.status < 500) {
			// 401/403/404 mean the key was revoked or the job is gone — polling
			// again can only burn the deadline. Only 429/5xx are transient.
			throw new Error(
				`OpenRouter video status poll failed (${res.status}) — key revoked or job gone`
			);
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw new Error('OpenRouter video job timed out');
}

export interface CinematicShot {
	/** Concise, single-dominant-action prompt for this shot (camera + action + framing). */
	prompt: string;
	/** Seconds, "3"-"15" per Kling's DurationEnum — shots sum to the total video length. */
	duration: string;
}

const CINEMATIC_MAX_TOTAL_SECONDS = parseInt(env.UGC_CINEMATIC_DURATION || '15', 10);
// 3 matches Kling's DurationEnum minimum ("3"-"15", per CinematicShot above) —
// a clamp floor below what the endpoint accepts just moves the rejection to fal.
const CINEMATIC_MIN_SHOT_SECONDS = 3;
const CINEMATIC_MAX_SHOT_SECONDS = 10;
const CINEMATIC_MIN_SHOT_COUNT = 2;

/**
 * Defensively clamps LLM-produced shot durations to values Kling's API will
 * actually accept, and trims the list (never scales individual shots below
 * their floor) if the total still exceeds the endpoint's max — the Director
 * prompt asks for compliant output, but a prompt is a request, not a
 * validation layer.
 */
function clampCinematicShots(shots: CinematicShot[]): CinematicShot[] {
	const result: CinematicShot[] = [];
	let total = 0;
	for (const shot of shots) {
		const n = parseInt(shot.duration, 10);
		const seconds = Number.isFinite(n)
			? Math.min(CINEMATIC_MAX_SHOT_SECONDS, Math.max(CINEMATIC_MIN_SHOT_SECONDS, n))
			: CINEMATIC_MIN_SHOT_SECONDS;

		if (total + seconds > CINEMATIC_MAX_TOTAL_SECONDS) {
			if (result.length === 0) {
				// Even the first shot alone exceeds the cap — clip it down rather
				// than produce an empty shot list.
				result.push({ prompt: shot.prompt, duration: String(CINEMATIC_MAX_TOTAL_SECONDS) });
			} else {
				console.warn(
					`[Cinematic] Dropping ${shots.length - result.length} shot(s) — total duration would exceed the ${CINEMATIC_MAX_TOTAL_SECONDS}s cap.`
				);
			}
			break;
		}
		result.push({ prompt: shot.prompt, duration: String(seconds) });
		total += seconds;
	}
	return result;
}

export interface CinematicReferences {
	/** Character's main/frontal reference (reference-kit full_body, or the plain characterRef as a fallback). */
	characterFrontal: string;
	/** Up to 3 additional character angles (side_profiles/face_closeup/feature_grid), whichever exist. */
	characterAngles: string[];
	/** Product photo — kept separate from the character element via `image_urls`. */
	productPhotoUrl: string | null;
}

/**
 * Kling O3 Pro's `reference-to-video` endpoint (distinct from plain
 * `image-to-video` — verified against its own live OpenAPI spec, not the
 * image-to-video one): unlike image-to-video, this one has a REAL
 * `elements`/`image_urls` reference mechanism, so character + product
 * consistency no longer depends on pre-compositing everything into one
 * starting still. `elements[0]` carries the character (frontal + up to 3
 * angle references, addressed as @Element1 in shot prompts); `image_urls`
 * carries the product photo (addressed as @Image1). Still passes
 * `multi_prompt` for the shot list, same as before.
 */
// Multi-shot reference-to-video with audio (up to 5 shots, Pro tier) is a
// meaningfully heavier job than the standard single 5s image-to-video clip —
// falQueueJson's 270s default was tuned for the latter and was seen timing
// out on cinematic jobs that were still legitimately rendering.
const CINEMATIC_QUEUE_TIMEOUT_MS = 600000;

async function generateCinematicVideo(
	falKey: string,
	refs: CinematicReferences,
	shots: CinematicShot[]
): Promise<string> {
	const data = await falQueueJson(
		BROLL_MODEL_CINEMATIC,
		{
			elements: [
				{
					frontal_image_url: refs.characterFrontal,
					...(refs.characterAngles.length
						? { reference_image_urls: refs.characterAngles.slice(0, 3) }
						: {})
				}
			],
			...(refs.productPhotoUrl ? { image_urls: [refs.productPhotoUrl] } : {}),
			multi_prompt: shots,
			shot_type: 'customize',
			generate_audio: true,
			negative_prompt: 'blur, distort, low quality, extra limbs, missing product, wrong product'
		},
		falKey,
		CINEMATIC_QUEUE_TIMEOUT_MS
	);
	const url = data.video?.url;
	if (!url) throw new Error('Cinematic multi-shot model returned no video');
	return url;
}

const CINEMATIC_DIRECTOR_SYSTEM = `You are a world-class commercial director storyboarding a premium short-form vertical ad. You think in shots, not scenes — each prompt is a single camera instruction, nothing more.

═══ CAPTION RULES ═══
Line 1 (hook): Pattern-interrupt or confession that stops mid-scroll. No questions. No banned words.
Lines 2-3: Hyper-specific, sensory — sounds like something only a real user would say.
CTA: One casual nudge, not a command.
BANNED WORDS: elevate, premium, transform, game-changer, innovative, discover, unlock, revolutionize, seamless, curated, amazing, incredible, journey.
Zero hashtags in caption.

═══ SHOT RULES ═══
@Element1 = the character (pinned face). @Image1 = the product. BOTH must be visible together in every single shot — this is non-negotiable. No environment-only shots. No product-only shots.
One dominant action per shot. Sequencing examples:
  Shot 1: Establishing — WS or MS, set the scene, character + product together.
  Shot 2: Intimacy — MCU, character interacting with product, direct to lens.
  Shot 3: Detail — ECU of product label/texture, character's hands, or face reaction.
  Shot 4: Payoff — MS or MCU, confident final frame, product clearly held or displayed.

Each shot prompt must include: shot type (ECU/MCU/MS/WS) + lighting condition + ONE camera move + @Element1 action + @Image1 placement.
Example GOOD shot: "MCU dolly-in, warm window light, @Element1 holds @Image1 at chest height looking at lens, ends on product label close-up. Duration 4s."
Example BAD shot: "Person with product in nice setting."

3 to 5 shots total. Each "duration" between "3" and "6" (seconds as a string). Total must not exceed 15 seconds.

═══ hookScore ═══ Rate your hook line 70-99 (rigorous: 80=strong, 90+=exceptional).

Respond with ONLY valid JSON. No markdown fences:
{
  "format": "broll",
  "text": "hook\\n\\npersonal sensory detail\\n\\ncasual CTA",
  "hashtags": ["#tag1","#tag2","#tag3"],
  "hookScore": <integer 70-99>,
  "on_screen_text": "<=6 word burned-in hook, CAPS or Title Case",
  "shots": [
    { "prompt": "shot type + lighting + camera move + @Element1 action + @Image1 placement", "duration": "4" },
    { "prompt": "...", "duration": "3" }
  ]
}`;

/**
 * Cinematic UGC pack: a storyboard-driven variant of `generateUgcPack` for
 * the one high-production-value post per day, instead of the standard
 * single-shot path. Generates the storyboard stills for every shot IN
 * PARALLEL (fast preview of the whole sequence, all grounded in the same
 * character + product references), then one native Kling multi-shot call
 * from the first still to produce the actual video. Throws on unrecoverable
 * failures, same contract as `generateUgcPack`.
 */
export async function generateCinematicUgcPack(input: UgcPackInput): Promise<UgcPack> {
	const { supabase, userId } = input;
	const platform = input.platform || 'instagram';
	const topic = input.topic || 'Sharing an honest experience with this product';

	const db = createDbService(supabase);
	// Three independent lookups run concurrently; the brand brief comes after
	// because WHICH brief to load depends on the persona's config
	// (brand_brief_id — multi-brand users pin one brief per persona).
	const [rawAi, cfg, agentResult] = await Promise.all([
		// The composer's Director pick rides along with its provider so the client
		// factory can ignore a model the user's key could never call.
		resolveAiClient(supabase, userId, llmPickFor(input.llmModel)),
		loadUgcConfig(supabase, input.agentId),
		input.agentId ? db.agents.get(input.agentId) : Promise.resolve({ data: null as any })
	]);
	if (!rawAi)
		throw new Error('No AI provider configured. Add an OpenRouter or Gemini key in Settings.');
	const costEvents: CostEvent[] = [];
	const ai = trackAi(rawAi, costEvents);

	// Fail-closed spend guard: refuse to start a paid generation once this agent's
	// daily or the user's monthly estimated spend has crossed the configured cap.
	await assertWithinBudget(supabase, userId, input.agentId);

	try {
		let agentContext = '';
		let agentData: any = null;
		const agent = agentResult?.data;
		if (agent) {
			agentData = agent;
			agentContext = buildRichAgentContext(agent);
		}

		// Persona gender is authoritative: overrides a contradicting configured voice.
		const { voice: resolvedVoice, voiceGender } = resolveVoiceForPersona(cfg.voice, agentData);

		let selectedProduct: any = null;
		let briefData: any = null;
		const brandBrief = await loadBriefForAgent(db, userId, cfg.brandBriefId);
		if (brandBrief?.data) {
			briefData = brandBrief.data;
			const products = Array.isArray(briefData.products) ? briefData.products : [];
			selectedProduct = input.productId
				? products.find((p: any) => p.id === input.productId)
				: products.find((p: any) => p.photoUrl) || products[0];
		}
		// The composer's Product photo URL override wins here exactly as it does on
		// the standard pipeline — an editable field the run then ignored would make
		// the confirm dialog a lie.
		const productPhoto: string | null =
			input.productPhotoUrlOverride?.trim() || selectedProduct?.photoUrl || null;
		if (!productPhoto) {
			throw new Error('Cinematic mode needs a product photo — add one in the Brand Brief first.');
		}

		const cinematicIntent = classifyContentIntent(topic, platform);
		const cinematicBrandVisualCtx = buildBrandVisualContext(briefData);

		const buildCinematicPrompt = () =>
			[
				agentContext,
				`Product: "${selectedProduct.name}" — ${selectedProduct.description || 'no description'}. Price: ${selectedProduct.price || 'N/A'}.`,
				briefData
					? [
							`Brand: ${briefData.brandName || '(unnamed)'}.`,
							`Voice: ${briefData.commStyle || 'authentic'}.`,
							`Audience: ${briefData.demographics || 'general'}.`,
							`Pain points: ${briefData.painPoints || 'N/A'}.`,
							cinematicBrandVisualCtx
						]
							.filter(Boolean)
							.join(' ')
					: '',
				`Content type: ${cinematicIntent.type}. Platform: ${platform}. Platform voice: ${cinematicIntent.platformVoice}.`,
				buildHookGuidance(cinematicIntent, `${topic}|${platform}|cinematic`),
				voiceGender
					? `The on-camera character (@Element1) must present as ${voiceGender}, matching the pinned voice.`
					: '',
				`Angle for this post: "${topic}". Output ONLY the JSON.`
			]
				.filter(Boolean)
				.join('\n');

		const prompt = buildCinematicPrompt();

		const raw =
			(await ai.generate(prompt, { systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true, stage: 'director' })) ||
			'{}';
		let parsed = safeParseJson(raw);
		if (!parsed) throw new Error('AI returned unparseable response');

		// Hook quality gate — same threshold as the standard path
		if (typeof parsed.hookScore === 'number' && parsed.hookScore < HOOK_SCORE_THRESHOLD) {
			console.warn(
				`[Cinematic Director] hookScore ${parsed.hookScore} below threshold — retrying with stronger hook instruction.`
			);
			const retryHookRaw =
				(await ai.generate(
					`${buildCinematicPrompt()}\n\nYour previous hook scored ${parsed.hookScore}/99. The hook must stop mid-scroll cold — a real confession or bold claim, not a description. Aim for 85+. Rewrite the full JSON.`,
					{ systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true, stage: 'director_retry_hook' }
				)) || '{}';
			const hookRetryParsed = safeParseJson(retryHookRaw);
			if (hookRetryParsed && (hookRetryParsed.hookScore ?? 0) > (parsed.hookScore ?? 0)) {
				parsed = hookRetryParsed;
			}
		}

		// Pre-media quality gate — cinematic is the expensive path (~3x standard),
		// so a below-floor script must die HERE, before storyboard stills + Kling.
		// Placed BEFORE shot derivation so an accepted rewrite replaces the shots
		// too. One improvement-guided rewrite, then abandon (autopilot falls back
		// to the standard path, which runs its own gate).
		const cinematicFloor = qualityFloor();
		let cinematicGrade = await gradeDraftWithRetry(
			ai,
			parsed,
			selectedProduct?.name ?? null,
			platform
		);
		if (cinematicFloor > 0 && cinematicGrade && cinematicGrade.overall < cinematicFloor) {
			console.warn(
				`[Cinematic QC] Draft graded ${cinematicGrade.overall}/10 (< floor ${cinematicFloor}) — one rewrite: ${cinematicGrade.fix}`
			);
			const rewriteRaw =
				(await ai.generate(
					`${buildCinematicPrompt()}\n\nAn independent QC reviewer graded your draft ${cinematicGrade.overall}/10. Top issue: ${cinematicGrade.topIssue}. Required fix: ${cinematicGrade.fix}. Rewrite the ENTIRE JSON applying that fix.`,
					{ systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true, stage: 'director_rewrite_qc' }
				)) || '{}';
			const rewritten = safeParseJson(rewriteRaw);
			if (rewritten?.text && Array.isArray(rewritten.shots) && rewritten.shots.length > 0) {
				const regrade = await gradeDraft(ai, rewritten, selectedProduct?.name ?? null, platform);
				if (!regrade || regrade.overall >= (cinematicGrade?.overall ?? 0)) {
					parsed = rewritten;
					cinematicGrade = regrade ?? cinematicGrade;
				}
			}
			if (cinematicGrade && cinematicGrade.overall < cinematicFloor) {
				await logAutoReject(supabase, userId, input.agentId, cinematicGrade, parsed);
				throw new Error(
					`Cinematic draft quality ${cinematicGrade.overall}/10 below floor ${cinematicFloor} (${cinematicGrade.topIssue}) — no media generated.`
				);
			}
		}

		let directorShots: any[] = Array.isArray(parsed.shots) ? parsed.shots : [];

		if (directorShots.length > 0 && directorShots.length < CINEMATIC_MIN_SHOT_COUNT) {
			// A 1-shot "cinematic" post still pays the full Kling Pro
			// reference-to-video multi-shot price for content indistinguishable
			// from the cheap standard path — retry once with a more insistent
			// instruction before accepting the degenerate output.
			console.warn(
				`[Cinematic] Director returned ${directorShots.length} shot(s) (need >=${CINEMATIC_MIN_SHOT_COUNT}), retrying once.`
			);
			const retryRaw =
				(await ai.generate(
					`${prompt}\n\nYour previous response had too few shots. You MUST return at least ${CINEMATIC_MIN_SHOT_COUNT} shots (3-5 is ideal).`,
					{ systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true, stage: 'director_retry_shots' }
				)) || '{}';
			const retryParsed = safeParseJson(retryRaw);
			if (
				Array.isArray(retryParsed?.shots) &&
				retryParsed.shots.length >= CINEMATIC_MIN_SHOT_COUNT
			) {
				directorShots = retryParsed.shots;
			} else {
				console.warn(
					`[Cinematic] Retry still returned ${retryParsed?.shots?.length ?? 0} shot(s) — proceeding with what we have.`
				);
			}
		}

		const rawShots: CinematicShot[] =
			directorShots.length > 0
				? directorShots.slice(0, 5).map((s: any) => ({
						prompt: String(s.prompt || '').slice(0, 800),
						duration: String(s.duration || '3')
					}))
				: [{ prompt: topic, duration: '5' }];
		// The Director is only prompt-instructed to keep shots at 3-6s summing to
		// <=15s — that's a request, not a guarantee, so clamp defensively before
		// this ever reaches Kling's API (which will reject an invalid/out-of-range
		// total rather than silently truncating it for us).
		const shots = clampCinematicShots(rawShots);

		const { falKey } = await resolveImageKeys(supabase, userId);
		if (!falKey) throw new Error('No fal.ai key configured. Add one in Settings.');

		let svc: any;
		try {
			svc = getServiceSupabase();
		} catch {
			throw new Error('Storage service is not configured on this server.');
		}

		// Pinned character face — same consistency anchor as the standard spokesperson
		// path. A composer-supplied Character Reference URL wins (this path previously
		// ignored it); otherwise use the DB pin, lazily generating one if none exists.
		const characterRef =
			input.characterRefOverride?.trim() ||
			(await ensureCharacterRef(
				supabase,
				svc,
				userId,
				input.agentId,
				cfg.characterRef,
				falKey,
				briefData,
				agentData,
				voiceGender
			));

		// All storyboard stills generated simultaneously — every one composites the
		// same character + product references, just with that shot's own framing.
		// (Still valuable even though the video call below no longer depends on
		// stitching from the first one — this is the fast, cheap preview the user
		// reviews before the video generation call runs.) Isolated per-shot: these
		// are a preview, not load-bearing for the video call below, so one shot's
		// still failing shouldn't sink the whole cinematic post.
		const storyboard = (
			await Promise.all(
				shots.map((shot, i) =>
					generateProductStill(
						falKey,
						shot.prompt,
						productPhoto,
						characterRef,
						cinematicBrandVisualCtx
					).catch((err) => {
						console.warn(
							`[Cinematic] Storyboard still ${i + 1}/${shots.length} failed, skipping:`,
							err
						);
						return null;
					})
				)
			)
		).filter((url): url is string => Boolean(url));

		for (let i = 0; i < storyboard.length; i++) {
			costEvents.push({
				provider: 'fal',
				operation: 'image',
				model: `${NANO_STILL_LABEL} (storyboard)`,
				usd: priceOf('fal', 'image', 'nano')
			});
		}

		// Archive the previews too — but a still that genuinely can't be persisted is
		// dropped (null → filtered) rather than stored as an ephemeral URL that would
		// 404 later. These are non-load-bearing previews, so a missing one is harmless.
		const durableStoryboard = (
			await Promise.all(
				storyboard.map((url) => persistToStorage(svc, url, userId, 'png').catch(() => null))
			)
		).filter((url): url is string => Boolean(url));

		// Reference-kit angles (if the user has generated them from the Profile tab)
		// give the video model far richer character grounding than a single portrait —
		// falls back to just the plain characterRef when the kit isn't populated yet.
		const kit = cfg.referenceKit || {};
		const cinematicRefs: CinematicReferences = {
			characterFrontal: kit.full_body || characterRef || durableStoryboard[0],
			characterAngles: [kit.side_profiles, kit.face_closeup, kit.feature_grid].filter(
				(url): url is string => Boolean(url)
			),
			productPhotoUrl: productPhoto
		};

		const videoUrl = await generateCinematicVideo(falKey, cinematicRefs, shots);
		costEvents.push({
			provider: 'fal',
			operation: 'video',
			model: `${CINEMATIC_VIDEO_LABEL} (cinematic)`,
			usd: priceOf('fal', 'video', 'pro')
		});

		// Captions + AI badge are both opt-in and independent (default off → clean clip).
		const captioned = await burnCaptions(videoUrl, {
			badge: input.aiBadge,
			hook: input.captions ? parsed.on_screen_text : ''
		}).catch(() => null);
		const durableMedia = captioned
			? await persistBufferToStorage(svc, captioned, userId, 'mp4', 'video/mp4')
			: await persistVideoDurable(svc, videoUrl, userId);

		// Record the durable asset URLs in the ledger (flushed in finally, even on a
		// later throw) so this spend is always recoverable from the DB.
		costEvents.push({
			provider: 'storage',
			operation: 'persist',
			model: 'ugc-media',
			usd: 0,
			assetUrl: durableMedia
		});
		if (durableStoryboard[0])
			costEvents.push({
				provider: 'storage',
				operation: 'persist',
				model: 'ugc-media',
				usd: 0,
				assetUrl: durableStoryboard[0]
			});

		const content: UgcContent & { storyboard?: string[]; cinematic?: boolean } = {
			text: parsed.text || '',
			hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
			hookScore: parsed.hookScore,
			on_screen_text: parsed.on_screen_text || '',
			// Actual burn outcome — captioned is non-null only when ffmpeg really ran; the
			// caption flag also requires real hook text (a badge-only burn returns a buffer
			// too, but no caption was drawn), so we never claim an overlay that wasn't made.
			captions:
				Boolean(input.captions) &&
				captioned != null &&
				Boolean((parsed.on_screen_text || '').trim()),
			ai_badge: Boolean(input.aiBadge) && captioned != null,
			ugc_broll_prompt: shots
				.map((s, i) => `Shot ${i + 1} (${s.duration}s): ${s.prompt}`)
				.join('\n\n'),
			media_url: durableMedia,
			poster_url: durableStoryboard[0],
			media_type: 'video',
			media_generated: true,
			format: 'broll',
			voice: resolvedVoice,
			product: {
				name: selectedProduct.name,
				price: selectedProduct.price,
				description: selectedProduct.description
			},
			platform,
			storyboard: durableStoryboard,
			cinematic: true,
			qualityGrade: cinematicGrade,
			qc_status: cinematicGrade ? 'graded' : 'ungraded',
			costBreakdown: summarizeCosts(costEvents)
		};
		if (input.autopilot) content.autopilot = true;

		// Observability record (cinematic): models per aspect + cost, the reference
		// images actually SENT (character + kit angles), the shot prompts, selections.
		content.generation = {
			...summarizeAspects(costEvents),
			images: {
				character_ref: characterRef || null,
				product_photo: productPhoto,
				reference_kit: [
					kit.full_body,
					kit.side_profiles,
					kit.face_closeup,
					kit.feature_grid
				].filter(Boolean) as string[]
			},
			// Cinematic always composites both references — stated explicitly so the
			// drawer's composition note has the same contract data as standard runs.
			still_style: 'photo',
			refs_policy: { character: true, product: true },
			prompts: { scene: content.ugc_broll_prompt, script: content.script },
			selections: {
				platforms: [platform],
				brand: briefData?.name ?? briefData?.brandName ?? briefData?.data?.brandName ?? null,
				videoModel: BROLL_MODEL_CINEMATIC,
				provider: input.providerPreference ?? null,
				mediaType: 'video'
			}
		};

		// Advisory, last, and unable to change anything above it — see judgeDraftFit.
		const fit = await judgeDraftFit({
			supabase,
			userId,
			agentId: input.agentId,
			postId: input.postId,
			ai: rawAi,
			agent: agentData,
			content
		});
		if (fit.fit_score !== null) {
			content.fit_score = fit.fit_score;
			if (fit.fit_notes) content.fit_notes = fit.fit_notes;
		}

		return { content, selectedProduct, briefData, agentData };
	} finally {
		// Flush the ledger even if generation threw partway through — otherwise
		// every failed/retried generation is silent spend the cap never sees.
		await recordCostEvents(supabase, userId, input.agentId, costEvents, input.postId);
	}
}

// ── Per-agent UGC config (read defensively from agent_configs) ──────────────

interface UgcConfig {
	voice: string;
	format: 'auto' | 'spokesperson' | 'broll' | 'vo_broll' | 'motion_card';
	quality: 'mvp' | 'premium';
	characterRef: string | null;
	/** full_body/side_profiles/face_closeup/feature_grid, from the Profile tab's reference-kit flow. */
	referenceKit: Record<string, string> | null;
	/** The persona's selected brand brief (multi-brand users) — null = newest-brief fallback. */
	brandBriefId: string | null;
}

async function loadUgcConfig(supabase: any, agentId?: string): Promise<UgcConfig> {
	let row: any = null;
	if (agentId) {
		const { data } = await supabase
			.from('agent_configs')
			.select('*')
			.eq('agent_id', agentId)
			.maybeSingle();
		row = data;
	}
	return {
		voice: row?.ugc_voice || env.UGC_DEFAULT_VOICE || DEFAULT_VOICE,
		format: row?.ugc_format || 'auto',
		quality: row?.ugc_video_quality || 'mvp',
		characterRef: row?.ugc_character_ref || null,
		referenceKit: row?.ugc_reference_kit || null,
		brandBriefId: row?.brand_brief_id || null
	};
}

/**
 * Resolves the brand brief a persona should generate against: its explicitly
 * selected brief first (multi-brand users pin one per persona — e.g. "Just
 * Kids Honey" vs "HoneyX Manly Plus"), else the user's most recently updated
 * brief. A selected-but-deleted brief falls through to the fallback rather
 * than failing generation.
 */
export async function loadBriefForAgent(
	db: ReturnType<typeof createDbService>,
	userId: string,
	brandBriefId: string | null
): Promise<any | null> {
	// Pinned-only: a persona uses ONLY the brand brief explicitly selected on its
	// Profile tab. With nothing pinned (or a pinned brief that's since been
	// deleted) it generates with NO brand context — there is deliberately no
	// silent fall-back to the account's newest brief. A brand kit is opt-in per
	// persona, not applied by magic.
	if (!brandBriefId) return null;
	const { data } = await db.brandBriefs.getById(brandBriefId, userId);
	if (data) return data;
	console.warn(
		`[UGC] Persona's selected brand brief ${brandBriefId} not found — generating with no brand context.`
	);
	return null;
}

export interface UgcPackInput {
	supabase: any;
	userId: string;
	agentId?: string;
	productId?: string;
	blueprintId?: string;
	platform?: string;
	topic?: string;
	/** Generate the full video (default). Set false for a fast caption+still preview. */
	video?: boolean;
	/** Marks the resulting content as autopilot-generated (badged in the UI). */
	autopilot?: boolean;
	/** Media provider routing: 'auto' (fal → OpenRouter failover, default), or pin one. */
	providerPreference?: 'auto' | 'fal' | 'openrouter';
	/** User-edited visual brief — replaces the Director's scene_prompt verbatim. */
	sceneOverride?: string;
	/** Reference-photo overrides from the generation composer. */
	productPhotoUrlOverride?: string;
	characterRefOverride?: string;
	/** 'graphic' renders a typographic card — the Director's line IS the artwork:
	 *  no photography, no reference images, no photorealism suffix. Default 'photo'
	 *  (the UGC composite). Studio's typographic templates set this. */
	stillStyle?: 'photo' | 'graphic';
	/** false = this composition does not include the persona. Skips the face ref
	 *  AND the lazy first-run face generation it would otherwise trigger and pay
	 *  for. An explicit characterRefOverride still wins. Default true. */
	useCharacterRef?: boolean;
	/** false = no product compositing — the brand-kit photo is NOT auto-attached
	 *  (channel content is product-free by design). An explicit
	 *  productPhotoUrlOverride still wins. Default true. */
	useProductRef?: boolean;
	/** Model picks from the composer — the user's budget-vs-quality decision. */
	videoModel?: string;
	/** Registry price override for that model (Model Manager edit). The ledger
	 *  bills this when present; the static catalog rate otherwise. */
	videoModelUsd?: number;
	/** Generated adapter for a swapped-in discovered video model: param names,
	 *  required-field constants, and output shape, derived from its schema probe.
	 *  When present the b-roll builder drives the model through it instead of the
	 *  hand-written shapes — this is what makes Model Manager swaps real. */
	videoAdapter?: {
		text: string;
		image: string | null;
		imageIsArray: boolean;
		/** Set when the model transforms a SOURCE clip. This path has no clip to
		 *  give, so a non-null value means the adapter cannot be driven here. */
		video?: string | null;
		duration: string | null;
		audio: string | null;
		constants: Record<string, unknown>;
		output: 'video.url' | 'videos[].url' | null;
	} | null;
	/** The ingested source clip a v2v run re-performs, as an http(s) URL the
	 *  provider can fetch (an app-storage URL — fal downloads it itself, so a
	 *  signed-but-expiring link will fail minutes into a ~7-minute job). Absent
	 *  on a v2v format coerces the run to plain b-roll: there is nothing to
	 *  re-perform, and the alternative is failing a run the user already paid the
	 *  Director for. */
	sourceVideoUrl?: string | null;
	/** The PROBED duration of that clip, in seconds — the billing basis, not a
	 *  display value. v2v bills per second of SOURCE (models.ts `billing:
	 *  'per_second'`), so this number multiplied by the per-second rate is the
	 *  cost event; a wrong or absent value under-bills a paid provider call.
	 *  Absent falls back to V2V_ASSUMED_SECONDS rather than to zero. */
	sourceSeconds?: number | null;
	/** Which transfer this is, when the caller wants it stated independently of
	 *  `formatOverride`: 'replace' keeps the SOURCE clip's scene and aspect and
	 *  swaps the performer; 'move' keeps the REFERENCE's scene and takes only the
	 *  motion (and follows the REFERENCE's aspect, so it needs a reframe before it
	 *  is a Reel). The format override wins when both are present — it is the
	 *  field the request actually carries. */
	v2vMode?: 'replace' | 'move';
	/** Opt-in: burn the on-screen caption hook onto the video. OFF by default. */
	captions?: boolean;
	/** Opt-in: burn a small "AI GENERATED" disclosure badge (top-left). OFF by
	 *  default — independent of captions. */
	aiBadge?: boolean;
	/** Composer per-run format choice. 'spokesperson' forces TTS + talking-head,
	 *  'broll' a silent clip, 'vo_broll' a clip with our TTS mixed under it, and
	 *  'motion_card' the typeset card animated locally; 'auto' (or unset) defers
	 *  to the persona's ugc_format, which the Director then resolves.
	 *  The two local formats need ffmpeg on the host — absent it, they degrade
	 *  (see the video branch) rather than failing a paid run.
	 *  'v2v_replace'/'v2v_move' re-perform an ingested SOURCE clip as this persona
	 *  and are the only formats that need an input beyond the brief
	 *  (`sourceVideoUrl`); they are per-run only — a persona's stored ugc_format
	 *  can never be one, because no stored default can supply a clip.
	 *  'v2v_narrated' is that same transfer with the vo_broll tail bolted on: TTS
	 *  of the Director's script, muxed under the transferred clip locally. It
	 *  needs BOTH inputs (a clip and a speakable line), which is why it degrades
	 *  one stage at a time rather than all at once — see the coercions and the
	 *  video branch.
	 *  'listicle' is a spokesperson whose voiceover is generated one call PER
	 *  BEAT so the on-screen items can be revealed on the frame each is spoken
	 *  (see joinVoiceSegments). It is the only format that bills a stage more
	 *  than once, which is why `$lib/formats` gives it `stepBilling.tts`. */
	formatOverride?:
		| 'auto'
		| 'spokesperson'
		| 'broll'
		| 'vo_broll'
		| 'motion_card'
		| 'v2v_replace'
		| 'v2v_move'
		| 'v2v_narrated'
		| 'listicle';
	/** BEATS in a listicle — the framing line plus one per item, i.e. how many
	 *  separate voiceover calls this run makes. It is a BILLING quantity: the
	 *  quote multiplies the TTS stage by it, so the Director is asked for exactly
	 *  `count - 1` items rather than a range, and the parse cuts anything past it.
	 *  Absent quotes and writes the catalog default. */
	listItemCount?: number;
	/** The user's own on-screen labels, POSITIONALLY: index i is item i+1, and a
	 *  blank means "keep the Director's". Blanks are therefore significant and
	 *  must not be filtered out upstream — dropping one slides every later label
	 *  onto an item it was never written for. Only the labels are pinnable; the
	 *  spoken line stays the Director's, because it is what the beat is TIMED to
	 *  and a line nobody wrote for the label would desync the reveal from speech. */
	listItemsOverride?: string[];
	/** The spoken line for a spokesperson run, verbatim. Until now a script could
	 *  only be edited on a REFINE (RefineMediaInput.dialogue) — a first run had to
	 *  accept whatever the Director wrote, then pay a second time to change it.
	 *  Ignored on b-roll (nothing speaks), so a stale pin can't rewrite a caption. */
	dialogueOverride?: string;
	/** The exact line to typeset on a `stillStyle: 'graphic'` card. Passes the same
	 *  sanitizeCardText() glyph gate the Director's line does; a line the system
	 *  font can't draw falls back to the Director's rather than failing the run. */
	cardText?: string;
	/** Pins the card composition. 'auto'/absent keeps pickCardLayout()'s shape
	 *  heuristic — the layout vocabulary is the renderer's own CardLayout. */
	cardLayout?: 'auto' | 'statement' | 'quote' | 'stack' | 'list' | 'split';
	/** Card ground color, in the only palette vocabulary resolveCardPalette()
	 *  accepts: a '#RRGGBB'/'#RGB' hex, which becomes the ground with a
	 *  legibility-derived ink. Absent/'auto'/unparseable → the brand brief's
	 *  colors, then the curated palettes, exactly as before. */
	cardPalette?: string;
	/** Realism register for photo compositions: 'front' splices the front-camera
	 *  selfie look, 'mirror' the back-camera mirror selfie, 'third' neither (a
	 *  photo someone else took). Composes WITH sceneOverride — the user's brief
	 *  says what is happening, this says who is holding the camera. Absent leaves
	 *  whatever the template/Director produced. */
	framing?: 'front' | 'mirror' | 'third';
	/** Voice name from VOICE_CATALOG for this run only. Still goes through
	 *  resolveVoiceForPersona(), so the depicted-gender agreement holds; an
	 *  unknown name falls back to the persona's configured voice rather than
	 *  sending garbage to TTS. */
	voiceOverride?: string;
	/** Image model for the still step (the composer's budget-vs-quality pick,
	 *  mirroring videoModel). Resolved through resolveModel() — 'image_edit' when
	 *  references are being composited, 'image_t2i' when not — so an unknown id
	 *  can never reach fal. Absent keeps the compiled-in Nano Banana routing. */
	stillModel?: string;
	/** The lip-sync model — the single dearest call in a spokesperson post
	 *  ($0.28 Kling AI-Avatar → $0.70 OmniHuman), so it is a real budget choice.
	 *  Resolved through resolveModel('talking_head') so an unknown id can never
	 *  reach fal; absent keeps the env-selected default. */
	talkingHeadModel?: string;
	/** The Director's LLM. Provider-matched inside resolveAiClient — a pick that
	 *  does not match the key that resolves is ignored rather than sent to a
	 *  provider that cannot serve it. */
	llmModel?: string;
	/** "Use my own still": an http(s) image used AS the still. No image model
	 *  runs, no still cost event is recorded, and every downstream step (talking
	 *  head, i2v, caption burn) treats it exactly as a generated still. Wins over
	 *  the graphic-card path too — a supplied image IS the artwork. */
	stillUrlOverride?: string;
	/** The post row this generation belongs to — links ledger rows to the post. */
	postId?: string;
}

export interface UgcContent {
	text: string;
	hashtags: string[];
	hookScore?: number;
	dialogue?: string;
	on_screen_text?: string;
	/** Whether the on-screen caption was burned onto the video (opt-in). */
	captions?: boolean;
	/** Whether the "AI GENERATED" disclosure badge was burned on (opt-in). */
	ai_badge?: boolean;
	ugc_broll_prompt?: string;
	script?: string;
	media_url: string;
	poster_url?: string;
	media_type: 'image' | 'video';
	media_generated: boolean;
	/** What ACTUALLY ran, never what was requested — a v2v run whose provider call
	 *  failed ships the i2v fallback clip and records 'broll', because that is
	 *  what the viewer watches. The narrated remake obeys the same rule from both
	 *  ends: a lost mux records 'v2v_replace' (the transfer shipped, the voice
	 *  didn't), a lost transfer records 'vo_broll' — or 'broll' if the voice is
	 *  then lost too.
	 *  'listicle' obeys the same rule from a third direction: it is recorded ONLY
	 *  when the timed reveals were actually burned onto the clip. A run whose
	 *  segmented voiceover or caption burn was lost ships a talking head reading a
	 *  list nobody can see, which is a spokesperson — so that is what it says. */
	format:
		| 'spokesperson'
		| 'broll'
		| 'vo_broll'
		| 'motion_card'
		| 'v2v_replace'
		| 'v2v_move'
		| 'v2v_narrated'
		| 'listicle';
	/** The beats of a listicle, in spoken order. Present whenever the list was
	 *  SPOKEN — including a run that degraded to one un-segmented voiceover and
	 *  therefore shows no reveals: the words were still said, and `format` (plus
	 *  `generation.listicle.assembled`) is what says whether they were shown. */
	list_items?: ListItem[];
	voice?: string;
	product: { name: string; price?: string; description?: string } | null;
	platform: string;
	autopilot?: boolean;
	/** Independent QC grade (pre-media gate) — surfaced in the review queue. */
	qualityGrade?: QualityGrade | null;
	/** 'ungraded' = the QC grader failed (twice) and generation proceeded ungated. */
	qc_status?: 'graded' | 'ungraded';
	/** Estimated generation spend for THIS post, split by provider. */
	costBreakdown?: { total: number; byProvider: Record<string, number> };
	/** Full observability record — models per aspect, cost matrix, images sent,
	 *  prompts, and the selections made. Rendered in the post drawer. */
	generation?: GenerationProvenance;
	/** Advisory viewer-panel fit (P3.3), mirrored from posts.fit_score. Present
	 *  ONLY when the judge ran and returned a usable verdict — an absent key is
	 *  the normal case and keeps the stored content identical to before. */
	fit_score?: number;
	fit_notes?: FitVerdictEntry[];
}

/**
 * Wraps an AiClient so every text call self-records into the cost ledger.
 *
 * Records AFTER the call returns, not before. Pushing first meant a provider
 * call that threw was still billed — and /billing promises the opposite in as
 * many words: "Only what actually ran. If a generation dies partway, you pay
 * for the images it had already made and nothing for the rest." A call that
 * threw did not run. This also settles a disagreement between the two metering
 * wrappers: meteredCall in metering.ts already records only on success, on the
 * stated grounds that providers do not bill errors. Same operation, same
 * policy now, whichever path the user took.
 *
 * A call that succeeds and is then abandoned further down still records, since
 * the array is flushed in the caller's `finally` — which is the "you pay for
 * what it had already made" half of the same promise.
 */
function trackAi(ai: AiClient, costEvents: CostEvent[]): AiClient {
	return {
		provider: ai.provider,
		model: ai.model,
		async generate(prompt, opts) {
			// Held in an object, not a `let`: TypeScript narrows a closure-assigned
			// local to `never` because it cannot see that onUsage runs.
			const seen: { usage: AiUsage | null } = { usage: null };
			const out = await ai.generate(prompt, { ...opts, onUsage: (u) => { seen.usage = u; } });
			costEvents.push({
				provider: ai.provider,
				operation: 'llm',
				// The real model id, so the observability panel names what actually
				// wrote the script — not a 'text-generation' placeholder.
				model: ai.model,
				usd: priceOf(ai.provider, 'llm'),
				tokensIn: seen.usage?.tokensIn ?? null,
				tokensOut: seen.usage?.tokensOut ?? null,
				measuredUsd: seen.usage?.costUsd ?? null,
				stage: opts?.stage ?? null
			});
			return out;
		}
	};
}

/**
 * Standalone (non-pack) paid generation: the avatar + reference-kit jobs.
 *
 * These bill fal on every click but had NEITHER the fail-closed budget cap NOR a
 * ledger write. Two consequences: they could spend without limit (a user blocked
 * at their cap on the post path could still click "Regenerate avatar" forever),
 * and because the spend never reached `generation_events`, `assertWithinBudget`
 * computed the cap on partial data — someone who burned $200 on avatars still
 * read as $0 spent.
 *
 * Same discipline as the packs: assert BEFORE spending, and flush the ledger in a
 * `finally` so a job that dies partway still records what it already paid for.
 */
async function runBudgetedAssetJob<T>(
	supabase: any,
	userId: string,
	agentId: string,
	costEvents: CostEvent[],
	job: () => Promise<T>,
	/**
	 * What this job is expected to spend, in provider USD.
	 *
	 * Without it the gate defaults to ONE credit, which only rejects an empty
	 * wallet — so a wallet holding a single cent could start a multi-image
	 * portrait job and finish it overdrawn, with only the NEXT run refused.
	 * Every caller now quotes the models it is about to run. 0 keeps the old
	 * behaviour for any caller that genuinely cannot quote.
	 */
	estimatedUsd = 0
): Promise<T> {
	await assertWithinBudget(supabase, userId, agentId, estimatedUsd > 0 ? creditsFor(estimatedUsd) : 1);
	try {
		return await job();
	} finally {
		await recordCostEvents(supabase, userId, agentId, costEvents);
	}
}

/**
 * Ledger write + credit debit.
 *
 * The receipt insert (generation_events) stays best-effort: analytics must
 * never break generation. The DEBIT is different — with CREDITS_ENFORCE=enforce
 * a failed debit throws CREDIT_DEBIT_FAILED so the caller marks the job failed
 * (durable plan, D1); in shadow it is logged; off = not attempted.
 *
 * Attribution written on every row: billed_user_id (workspace owner for a
 * workspace persona, else the persona owner), key_source (whose key paid the
 * provider), credits (ceil(est_cost*100)). Debits are keyed to the event id so
 * a retried write cannot charge twice.
 */
export async function recordCostEvents(
	supabase: any,
	userId: string,
	agentId: string | undefined,
	events: CostEvent[],
	postId?: string
): Promise<void> {
	if (events.length === 0) return;

	const mode = creditsMode();
	// Attribution lookups are cheap reads; skip them entirely when credits are
	// off so today's behaviour (and query count) is unchanged.
	const keyCache = new Map<string, KeySource>();
	const billedUserId =
		mode === 'off' ? userId : await resolveBillingAccount(supabase, agentId, userId);
	const enriched = await Promise.all(
		events.map(async (e) => ({
			user_id: userId,
			agent_id: agentId ?? null,
			post_id: postId ?? null,
			provider: e.provider,
			operation: e.operation,
			model: e.model,
			est_cost: e.usd,
			// What the provider said it consumed. Recorded, never billed — the
			// quote the user approved comes from the same table est_cost does.
			tokens_in: e.tokensIn ?? null,
			tokens_out: e.tokensOut ?? null,
			measured_cost: e.measuredUsd ?? null,
			stage: e.stage ?? null,
			asset_url: e.assetUrl ?? null,
			billed_user_id: billedUserId,
			key_source: (mode === 'off'
				? 'platform'
				: await keySourceFor(supabase, userId, e.provider, keyCache)) as KeySource,
			credits: creditsFor(e.usd)
		}))
	);

	// Insert with the widest column set first; on an unknown-column error (a
	// migration not yet applied on this database, or a stale PostgREST schema
	// cache) drop ONLY the column the error names and retry, so one missing
	// optional column (asset_url) can never take the billing attribution
	// (billed_user_id / key_source / credits) down with it. Bounded: at most
	// one retry per optional column. Core columns are never dropped — if the
	// error names one of those, the insert has genuinely failed.
	const OPTIONAL = new Set(['asset_url', 'billed_user_id', 'key_source', 'credits', 'tokens_in', 'tokens_out', 'measured_cost', 'stage']);
	const dropped = new Set<string>();
	let inserted: Array<{ id: string }> | null = null;
	let lastErr: any = null;
	for (let attempt = 0; attempt <= OPTIONAL.size; attempt++) {
		try {
			const rows = enriched.map((r) => {
				const out: Record<string, unknown> = { ...r };
				for (const c of dropped) delete out[c];
				return out;
			});
			const { data, error } = await supabase.from('generation_events').insert(rows).select('id');
			if (!error) {
				inserted = data ?? [];
				if (dropped.size > 0) {
					// asset_url going missing is cosmetic. billed_user_id, key_source and
					// credits are not: the DEBIT still fires from the in-memory value, so
					// money moves while the row it is keyed to cannot be attributed —
					// invisible to every reconciliation view, which filters on
					// key_source = 'platform', and to margin reporting with it.
					const money = [...dropped].filter((c) => c === 'key_source' || c === 'credits' || c === 'billed_user_id');
					const fix = `apply the pending generation_events migration(s) or reload the PostgREST schema cache (NOTIFY pgrst, 'reload schema')`;
					if (money.length > 0 && mode !== 'off') {
						console.error(
							`[Cost] ATTRIBUTION LOST: recorded generation events without ${money.join(', ')} while credits are '${mode}'. The wallet was still debited, but these rows are invisible to reconciliation and margin. Fix now — ${fix}.`
						);
					} else {
						console.warn(`[Cost] Recorded generation events without ${[...dropped].join(', ')} — ${fix}.`);
					}
				}
				break;
			}
			lastErr = error;
			const msg = String(error.message ?? '');
			const unknownColumn =
				error.code === 'PGRST204' || error.code === '42703' || /column|schema cache/i.test(msg);
			if (!unknownColumn) break;
			// "column generation_events.asset_url does not exist" (42703) or
			// "Could not find the 'credits' column of 'generation_events' in the schema cache" (PGRST204)
			const named =
				msg.match(/column (?:\w+\.)?(\w+) does not exist/i)?.[1] ??
				msg.match(/'(\w+)' column/i)?.[1] ??
				null;
			if (!named || !OPTIONAL.has(named) || dropped.has(named)) break;
			dropped.add(named);
		} catch (err) {
			lastErr = err;
			break;
		}
	}
	if (!inserted) {
		console.warn('[Cost] Failed to record generation events:', lastErr?.message ?? lastErr);
		// No receipt rows → nothing to key a debit to. In enforce mode this is a
		// billing failure, not an analytics blip.
		if (mode === 'enforce') {
			throw new Error(
				`CREDIT_DEBIT_FAILED: generation_events insert failed (${lastErr?.message ?? 'unknown'})`
			);
		}
		return;
	}

	if (mode === 'off') return;
	// Rows come back in insert order; pair ids with the enriched rows.
	const debitRows = inserted.map((row, i) => ({
		id: row.id,
		credits: enriched[i]?.credits ?? 0,
		provider: enriched[i]?.provider ?? '',
		operation: enriched[i]?.operation ?? '',
		model: enriched[i]?.model ?? null,
		key_source: enriched[i]?.key_source ?? 'platform'
	}));
	const outcome = await debitForEvents(supabase, {
		billedUserId,
		actorId: userId,
		agentId: agentId ?? null,
		postId: postId ?? null,
		rows: debitRows
	});
	if (outcome.attempted > 0) {
		console.log(
			`[credits:${outcome.mode}] billed=${billedUserId} debited=${outcome.debited} events=${outcome.attempted}${outcome.skippedDuplicate ? ` dup=${outcome.skippedDuplicate}` : ''}`
		);
	}
}

export interface UgcPack {
	content: UgcContent;
	selectedProduct: any | null;
	briefData: any | null;
	agentData: any | null;
}

// ── Fit judge (Persona Model v2, P3.3) ──────────────────────────────────────

/**
 * How long the advisory judge may hold up a finished post. A generation that has
 * already paid for a video does not wait on an opinion: past this the verdict is
 * abandoned and the post ships without one.
 */
const FIT_JUDGE_TIMEOUT_MS = 25_000;

/**
 * True when the audience is an actual STATED bracket rather than an empty shell.
 *
 * `sampleViewerPanel` deliberately never returns an empty panel — an audience of
 * nothing still yields five strangers — so the gate has to be on the INPUT. A
 * persona that has never said who it is for would otherwise be judged against
 * five invented people and charged for the privilege. Mirrors the same gate the
 * persona page applies before it mounts the panel section.
 */
function audienceIsStated(audience: unknown): boolean {
	if (!isObj(audience)) return false;
	const a = audience as Record<string, unknown>;
	const str = (v: unknown) => typeof v === 'string' && !!v.trim();
	const list = (v: unknown) => Array.isArray(v) && v.some(str);
	if (list(a.ageRanges) || list(a.lifeStage)) return true;
	if (str(a.genderMix) || str(a.incomeBand)) return true;
	return isObj(a.decisioning) && Object.values(a.decisioning).some(str);
}

/** The text the judge reads: the caption as published, plus the spoken script. */
function fitDraftText(content: Pick<UgcContent, 'text' | 'script' | 'dialogue'>): string {
	const script = (content.script || content.dialogue || '').trim();
	return [(content.text || '').trim(), script && `Script: ${script}`].filter(Boolean).join('\n\n');
}

export interface FitJudgeRun {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase
	supabase: any;
	userId: string;
	agentId?: string;
	postId?: string;
	/** The UNWRAPPED client. Metering is applied here, so passing a tracked one double-bills. */
	ai: AiClient | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent rows are untyped throughout this file
	agent: any;
	content: Pick<UgcContent, 'text' | 'script' | 'dialogue'>;
}

/**
 * Runs the fit judge for a finished draft and records the verdict on the post.
 *
 * WHERE IT SITS: after the caption, the script and the media are final and
 * immediately before the pack is returned. It reads them; it cannot influence
 * them. Nothing downstream of this call consumes its result except the two
 * advisory columns.
 *
 * WHAT GUARDS IT:
 *   · `personaFitJudgeRunsAutomatically()` — at 'off' and 'on_demand' this
 *     returns before touching a provider, so an unflagged run is byte-identical
 *     to the one that shipped before this existed;
 *   · a stated audience and a panel with at least one judgeable viewer;
 *   * `meteredAiClient` — the same gate → record → debit path as every other
 *     paid call, so a refused wallet or a hit cap refuses HERE, not at the till;
 *   · a timeout, because a hung provider must not hold a finished post;
 *   · one catch around all of it.
 *
 * WHY IT CANNOT COST A POST: every failure mode — no provider, budget refusal,
 * credit refusal, a malformed answer, a timeout, a posts UPDATE that is rejected
 * because the column is not there yet — resolves to `{ fit_score: null,
 * fit_notes: null }` and a logged warning. The function has no throw path, and
 * the post row it writes to already exists (the composer claims it before
 * generation starts), so the write is an UPDATE of two advisory columns and can
 * never fail an insert. The status, the platforms and the content are not
 * touched by it.
 */
export async function judgeDraftFit(run: FitJudgeRun): Promise<{
	fit_score: number | null;
	fit_notes: FitVerdictEntry[] | null;
}> {
	const noVerdict = fitColumnsFor(null);
	try {
		if (!personaFitJudgeRunsAutomatically()) return noVerdict;
		if (!run.ai) return noVerdict;

		const draft = fitDraftText(run.content);
		if (!draft) return noVerdict;

		const profile = readPersonaProfileV2(run.agent);
		if (!audienceIsStated(profile?.audience)) return noVerdict;

		// Same seed and same options as the persona page, so the viewers judged are
		// the first four of the ones the user can already see — a verdict about
		// strangers nobody was shown would be unreadable.
		const panel = judgeablePanel(
			sampleViewerPanel(String(run.agent?.id ?? ''), profile?.audience, {
				market: profile?.creator?.market
			})
		);
		if (!panel.length) return noVerdict;

		const metered = meteredAiClient(run.ai, {
			stage: 'fit_judge',
			supabase: run.supabase,
			userId: run.userId,
			agentId: run.agentId ?? null,
			postId: run.postId ?? null
		});
		if (!metered) return noVerdict;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const answer = await Promise.race([
			metered.generate(fitJudgePrompt(draft, panel, profile), { json: true }),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`fit judge timed out after ${FIT_JUDGE_TIMEOUT_MS}ms`)),
					FIT_JUDGE_TIMEOUT_MS
				);
			})
		]).finally(() => clearTimeout(timer));

		const columns = fitColumnsFor(parseFitVerdict(safeParseJson(answer), panel));
		if (columns.fit_score !== null && run.postId) {
			// Best effort, and deliberately narrow: two advisory columns on a row that
			// already exists. PostgREST returns its error rather than throwing, and a
			// database that predates the migration is a warning, not a lost post.
			const { error } = await run.supabase
				.from('posts')
				.update(columns)
				.eq('id', run.postId)
				.is('deleted_at', null);
			if (error) console.warn('[FitJudge] verdict not stored:', error.message ?? error);
		}
		return columns;
	} catch (err) {
		// Advisory means advisory: this is the only exit an error takes.
		console.warn('[FitJudge] skipped:', (err as Error)?.message ?? String(err));
		return noVerdict;
	}
}

const DIRECTOR_SYSTEM = `You are a world-class short-form UGC director and conversion copywriter. You write like a real person who genuinely discovered value — never like a brand running an ad.

═══ CAPTION RULES ═══
Line 1 (hook): A pattern-interrupt, bold confession, or curiosity gap that stops the scroll in under 3 seconds. No questions as openers. Works standalone without context.
  GREAT hooks: "I almost returned this.", "Nobody tells you this part.", "Three weeks in and I can't go back.", "This ruined everything else for me."
  BAD hooks: "Check out this amazing product!", "Have you tried X?", "This is a game changer."
Lines 2-3: Hyper-specific, sensory, personal detail — something only someone who actually used this would say. A texture, smell, before/after moment, or specific time-of-day observation.
CTA: One casual, low-pressure nudge — "link in bio if you want one" not "Buy now!"
Zero hashtags in the caption body.
BANNED WORDS (instant fail if used): elevate, premium, transform, game-changer, innovative, discover, unlock, revolutionize, seamless, leverage, curated, authentic (show don't say), amazing, incredible, journey, empower.

═══ SCENE PROMPT RULES (scene_prompt) ═══
Must specify ALL of: shot type + lighting + setting + framing + depth of field.
Shot types: ECU (extreme close-up) / MCU (medium close-up) / MS (medium shot) / WS (wide) / OTS (over-the-shoulder) / POV
Lighting: source + direction + quality. e.g. "warm window light from camera-left, soft bounce fill from right, no harsh shadows, 5600K"
Setting: a real specific location with time context — NOT "a room" or "nice background". Say "marble bathroom counter at 7am" or "sunlit kitchen bench, mid-morning golden light".
Example GOOD scene_prompt: "MCU at 85mm equivalent, subject holds product at chest height on right third of frame in a warmly lit Bondi café. Window light from camera-left, background coffee shop bokeh'd to f/1.8, product label fully readable, subject looking at product then direct to lens."
Example BAD scene_prompt: "Person holding product in nice lighting."

═══ MOTION PROMPT RULES (motion_prompt) ═══
Must specify: camera move type + speed + subject action + reveal moment.
Camera moves: dolly-in / pan / tilt / arc / static / handheld-breathe / rack-focus
Example GOOD motion_prompt: "Slow gimbal dolly-in from MS to MCU as subject lifts product from counter. Rack focus from background shelf to product label at 2s mark. Subject glances at product then looks direct at lens. Ends on product hero frame. Smooth — no abrupt cuts."
Example BAD motion_prompt: "Subtle movement."

═══ DIALOGUE RULES ═══
First-person, casual — sounds like a voice note to a friend. 6-10 seconds at natural speech pace (~15-25 words). Must contain one specific sensory or functional detail (texture, smell, how it physically felt, what measurably changed).

═══ HASHTAGS ═══
3-5 hashtags. One broad category (#skincare), one mid-tail (#morningroutine), one niche/community (#sluggingmethod). No forced branded hashtag unless it's an organic community tag.

═══ hookScore ═══
Rate your own hook line only (not full caption) from 70-99. Be rigorous: 70=works, 80=strong scroll-stopper, 90+=exceptional. Under-rate rather than over-rate.

Respond with ONLY valid JSON. No markdown fences, no extra keys, no preamble:
{
  "format": "spokesperson" | "broll",
  "text": "hook line\\n\\nsensory personal detail\\n\\ncasual CTA",
  "hashtags": ["#tag1","#tag2","#tag3"],
  "hookScore": <integer 70-99>,
  "dialogue": "spoken testimonial ~6-10s, specific sensory detail included",
  "on_screen_text": "<=6 word burned-in hook, CAPS or Title Case",
  "scene_prompt": "shot type + lighting source/direction + specific real setting + framing + DOF",
  "motion_prompt": "camera move type + speed + subject action + reveal moment"
}`;

/** Persona profile (gender/archetype/target avatar/etc. from the Profile tab). */
function parsePersonaProfile(agentData: any): Record<string, any> {
	return readPersonaProfile(agentData);
}

/**
 * Best-effort gender inference from free-text persona description. Used ONLY as
 * a fallback when the explicit Gender field is unset — so a persona whose soul
 * plainly reads "a slim blond girl" is never mis-voiced as male just because
 * someone skipped the dropdown. Deterministic keyword scan (word-boundary), and
 * deliberately returns undefined on ambiguity rather than guessing.
 *
 * Two tiers, because UGC souls constantly describe the AUDIENCE alongside the
 * persona ("helps busy moms", "for women 30+") — a flat keyword scan flipped
 * every male creator with a female audience:
 *   1. Pronouns (she/her vs he/him) — in persona copy these refer to the
 *      persona itself, so they win outright.
 *   2. SINGULAR identity nouns ("a 26-year-old woman", "family man").
 * Plural nouns (women, men, girls, boys, ladies) are ignored entirely — in
 * persona copy they name an audience, not the persona. A tier that matches
 * both sides is contradictory and stops the scan (no falling through to a
 * weaker signal).
 */
const FEMALE_PRONOUNS = /\b(she|her|hers|herself)\b/;
const MALE_PRONOUNS = /\b(he|him|his|himself)\b/;
// \bman\b does NOT match "woman"/"human" — the word boundary protects the overlap.
const FEMALE_NOUNS =
	/\b(woman|girl|female|lady|mother|mom|mum|feminine|actress|businesswoman|queen|sister|daughter|wife|girlfriend)\b/;
const MALE_NOUNS =
	/\b(man|boy|male|gentleman|father|dad|masculine|actor|businessman|king|brother|son|husband|boyfriend|guy|dude|bloke)\b/;

export function inferGenderFromText(
	...texts: Array<string | undefined | null>
): 'male' | 'female' | undefined {
	const t = texts.filter(Boolean).join(' ').toLowerCase();
	if (!t) return undefined;
	const tiers: Array<[RegExp, RegExp]> = [
		[FEMALE_PRONOUNS, MALE_PRONOUNS],
		[FEMALE_NOUNS, MALE_NOUNS]
	];
	for (const [female, male] of tiers) {
		const hasF = female.test(t);
		const hasM = male.test(t);
		if (hasF && !hasM) return 'female';
		if (hasM && !hasF) return 'male';
		if (hasF && hasM) return undefined; // contradictory → don't guess
	}
	return undefined;
}

// First-name → gender lookup. A persona named "Aisha Noori" or "Marcus Chen"
// has a clear gender its soul text may never state in pronouns — without this
// a female persona silently generates a male face/voice (the exact "Aisha but
// male images" bug). Curated toward the app's own personas plus common names;
// unknown names fall through to the text scan, never a wrong guess.

/** Gender from a name's first token (e.g. "Aisha Noori" → female), else undefined. */
// inferGenderFromName + NAME_GENDER moved to $lib/name-gender (client-safe) in
// P1.1 so the persona sampler can share the table instead of duplicating it.
// Imported (this module calls it internally, below) AND re-exported, so every
// existing importer of this module is unaffected.
export { inferGenderFromName };

/** Extracts the character's name from a soul doc's "— Name" / "soul.md — Name" heading, if present. */
function characterNameFromSoul(soul: string | undefined | null): string | undefined {
	if (!soul) return undefined;
	const m = String(soul).match(
		/(?:soul(?:\.md)?\s*)?[—–-]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+){0,2})/
	);
	return m?.[1]?.trim();
}

/**
 * Resolves a persona's authoritative gender: the explicit Profile-tab field
 * first, then its NAME (agent name + the character name in the soul heading),
 * then a pronoun/keyword scan of the soul text, then — as a last resort — the
 * gender of a deliberately pinned voice. Name beats text scan because "Aisha,
 * a fashion curator" has no gendered keyword but an obvious name. This is what
 * both the voice and the on-camera character must agree with.
 *
 * `personaProfile.targetAvatar` is deliberately NOT scanned: it describes the
 * CUSTOMER ("Sarah, 32, mother of two"), so scanning it misgendered every
 * persona whose audience differs from the creator.
 */
export function resolvePersonaGender(
	agentData: any,
	pinnedVoice?: string | null
): 'male' | 'female' | undefined {
	const explicit = parsePersonaProfile(agentData).gender;
	if (explicit === 'male' || explicit === 'female') return explicit;

	const byName =
		inferGenderFromName(characterNameFromSoul(agentData?.soul)) ||
		inferGenderFromName(agentData?.name);
	if (byName) return byName;

	const byText = inferGenderFromText(agentData?.soul, agentData?.name);
	if (byText) return byText;

	// A pinned voice is an explicit user choice about how the persona sounds —
	// trust its catalog gender when nothing else gives a signal. The column
	// default ('Adam') is NOT a choice and carries no signal.
	// Resolved through liveVoice so a persona pinned to a voice that has since
	// been RETIRED keeps its gender signal. The choice was real when it was made;
	// retiring the voice must not silently un-gender the persona and re-roll its
	// whole look, which is what a bare catalog lookup would do the moment an
	// entry is removed.
	const voice = liveVoice(pinnedVoice ?? agentData?.ugc_voice);
	if (typeof voice === 'string' && voice && voice !== DEFAULT_VOICE_SENTINEL) {
		return VOICE_CATALOG.find((v) => v.name === voice)?.gender;
	}
	return undefined;
}

/** The ugc_voice column default — personas whose voice was never explicitly picked carry this. */
const DEFAULT_VOICE_SENTINEL = 'Adam';

/** Stable non-crypto string hash so a persona maps to the same catalog voice on every run. */
function stableVoiceHash(seed: string): number {
	let h = 0;
	for (let i = 0; i < seed.length; i++) {
		h = (h * 31 + seed.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

/**
 * The persona's gender (explicit Profile field, else inferred from its
 * description) is the source of truth for how the character looks AND sounds.
 * A voice that contradicts it is overridden BEFORE any content is generated,
 * so alignment is enforced up front rather than discovered in a finished video.
 *
 * Voice picks are per-persona, not first-of-gender: an unpinned voice (unset,
 * or still the column default 'Adam') hashes the agent id into the
 * gender-matched slice of VOICE_CATALOG, so two personas of the same gender get
 * different voices instead of all sharing the catalog's first entry. An
 * explicitly pinned, gender-aligned voice is always respected.
 */
export function resolveVoiceForPersona(
	cfgVoice: string,
	agentData: any
): { voice: string; voiceGender: 'male' | 'female' | undefined } {
	// A pick stored before a voice was retired still names the dead voice, and
	// deleting the catalog line does not rewrite the database. Redirect FIRST, to
	// the deliberate same-gender replacement rather than to whatever the gender
	// hash below would land on — the operator chose that voice for its character,
	// and the nearest live voice honours that better than a re-roll. Doing it
	// here also means the retired name never reaches the provider, so these
	// personas stop paying for a rejected call before every real one.
	const requestedVoice = cfgVoice;
	cfgVoice = liveVoice(cfgVoice);
	if (cfgVoice !== requestedVoice) {
		console.log(`[UGC] Voice '${requestedVoice}' is retired — using '${cfgVoice}'.`);
	}
	const personaGender = resolvePersonaGender(agentData, cfgVoice);
	const cfgGender = VOICE_CATALOG.find((v) => v.name === cfgVoice)?.gender;
	const isPinned = !!cfgVoice && cfgVoice !== DEFAULT_VOICE_SENTINEL;

	if (personaGender === 'male' || personaGender === 'female') {
		if (isPinned && cfgGender === personaGender) {
			return { voice: cfgVoice, voiceGender: personaGender };
		}
		const pool = VOICE_CATALOG.filter((v) => v.gender === personaGender);
		if (pool.length > 0) {
			const seed = String(agentData?.id ?? agentData?.name ?? '');
			const picked = pool[stableVoiceHash(seed) % pool.length];
			if (picked.name !== cfgVoice) {
				console.log(
					`[UGC] Voice '${cfgVoice}' (${cfgGender ?? 'unknown gender'}${isPinned ? '' : ', unpinned default'}) → '${picked.name}' for persona gender '${personaGender}' (per-persona pick).`
				);
			}
			return { voice: picked.name, voiceGender: personaGender };
		}
	}
	return { voice: cfgVoice, voiceGender: cfgGender ?? personaGender };
}

/**
 * Builds the exact hero-portrait prompt the provider will receive.
 *
 * Exported (and kept separate from the call that uses it) so the UI can show the
 * user the REAL prompt before spending anything — the confirm-before-generate
 * composer resolves this, lets the user edit it, and sends the edited text back
 * as `promptOverride`. Anything shown to the user must be produced here, so the
 * preview and the actual request can never drift apart.
 */
export function buildHeroPortraitPrompt(
	briefData: any,
	agentData: any,
	voiceGender: 'male' | 'female' | undefined
): string {
	const audience = briefData?.demographics || 'a general lifestyle audience';
	// The soul often carries the persona's PHYSICAL identity ("Emirati fashion
	// curator, 26, Dubai") — clamping it to 120 chars was dropping exactly the
	// details the pinned face must reflect. 600 keeps identity + vibe intact.
	const persona = agentData?.soul
		? ` Personality vibe: ${String(agentData.soul).slice(0, 600)}.`
		: '';
	const profile = parsePersonaProfile(agentData);
	// Ethnicity is the single strongest identity + uniqueness signal, so it leads the
	// SUBJECT (stronger than a trailing clause) with an explicit authenticity directive.
	// This is the fix for "the face didn't match the persona's heritage" (Jenny Tran came
	// out non-Asian) AND for personas all looking alike — with nothing to distinguish them
	// the model collapses to one generic "UGC creator" face. Gender rides in the subject
	// too (the pinned face must match the configured voice gender up front).
	const ethnicity = (profile.appearance?.ethnicity || '').trim();
	// Persona Model v2 (P2.3). The v2 look carries attributes the v1 `appearance`
	// record has no key for — facial hair, eyewear, face/brow shape, hair texture,
	// gray coverage, height — so a bearded persona described only through the v1
	// downgrade comes out clean-shaven. Read them LIVE off the look: `promptCues`
	// is a cache a field re-roll clears and nothing recomputes, so it is never the
	// source (see persona-contract/look-prompt.ts).
	//
	// The v2 clause is used only when the look actually holds one of those
	// attributes. Every persona still stored as v1 is upgraded in memory with none
	// of them, so it keeps the v1 clause and its prompt stays byte-identical —
	// which is what prompt-regression.spec.ts pins.
	const v2 = readPersonaProfileV2(agentData);
	const look = v2.look;
	const appearanceLine = hasV2OnlyLookAttributes(look)
		? appearanceToPromptClause(look, { age: v2.creator?.age })
		: appearanceToPromptClause(profile.appearance);
	// Facial hair and eyewear are restated in the SUBJECT — the strongest position
	// in the prompt — because those two are what the later edit drops. Empty for
	// every v1 persona, so the subject is unchanged for them.
	const driftProneAttributes = lookSubjectAttributes(look);
	const subject = [ethnicity, voiceGender, 'relatable UGC content creator']
		.filter(Boolean)
		.join(' ');
	const ethnicityEmphasis = ethnicity
		? ` The creator is authentically ${ethnicity} — render accurate, respectful ${ethnicity} facial features, skin tone, and hair; this is essential and must not be generic or ambiguous.`
		: '';
	const archetypeLine = profile.archetype ? ` Their creator archetype: ${profile.archetype}.` : '';
	const avatarLine = profile.targetAvatar
		? ` They make content for: ${String(profile.targetAvatar).slice(0, 120)}.`
		: '';
	// Wardrobe/hair/eyes/distinctive-features directives from the persona profile — so the
	// pinned face reflects the exact look the user configured (and "Generate for brand"
	// filled), instead of a generic person. (Resolved above, from whichever shape the
	// persona is stored in.)
	return `Photorealistic vertical portrait of one ${subject}${driftProneAttributes} who fits this audience: ${audience}.${ethnicityEmphasis}${persona}${archetypeLine}${avatarLine}${appearanceLine} Friendly, casual, natural window light, looking straight at the camera, authentic iPhone selfie style, clear visible face, upper body. Single person only — a unique, specific individual with their own distinct face, NOT a generic stock model.`;
}

/**
 * Prompt for REGENERATING the profile picture as an EDIT of the existing face —
 * it keeps the persona the same person (same facial identity) while refreshing
 * the shot and applying any configured wardrobe/styling. Used whenever a profile
 * picture already exists, so a regenerate never produces a whole new person.
 */
export function buildPortraitEditPrompt(agentData: any): string {
	const profile = parsePersonaProfile(agentData);
	const ethnicity = (profile.appearance?.ethnicity || '').trim();
	// Same v2 read as the hero builder, for the same reason and with the same
	// v1-stays-byte-identical guard. See buildHeroPortraitPrompt above.
	const v2 = readPersonaProfileV2(agentData);
	const look = v2.look;
	const appearanceLine = hasV2OnlyLookAttributes(look)
		? appearanceToPromptClause(look, { age: v2.creator?.age })
		: appearanceToPromptClause(profile.appearance);
	// THE FIX for "the beard disappears on the second image". An edit prompt that
	// only says "keep their facial identity" does not hold facial hair or eyewear —
	// across this codebase's regenerations those are the two attributes that come
	// back missing, so they are named explicitly, and only when actually set.
	const preservationLine = lookPreservationClause(look);
	// Preserve STRUCTURE (bone structure, feature placement) for consistency, but assert
	// ethnicity rather than pinning "skin tone" — locking skin tone would perpetuate a face
	// generated with the wrong heritage. When the source is already correct this is a no-op;
	// when it's off, the edit nudges it right while keeping the person recognizable.
	const ethnicityLine = ethnicity
		? ` This person is authentically ${ethnicity}; keep them recognizably the same individual while ensuring the depiction accurately reflects ${ethnicity} features and skin tone.`
		: '';
	return `Regenerate this exact person as a fresh photorealistic vertical portrait. Preserve their facial identity from the reference image — same bone structure, eye shape, nose, jaw, and hairline; do NOT turn them into a different person.${ethnicityLine}${appearanceLine}${preservationLine} Friendly, casual, natural window light, looking straight at the camera, authentic iPhone selfie style, clear visible face, upper body. Single person only.`;
}

/** Generates (and durably persists) a fresh hero portrait image. No DB pin — just the image. */
async function generateHeroPortraitImage(
	svc: any,
	userId: string,
	falKey: string,
	briefData: any,
	agentData: any,
	voiceGender: 'male' | 'female' | undefined,
	promptOverride?: string,
	modelId?: string | null
): Promise<string> {
	const heroPrompt =
		promptOverride?.trim() || buildHeroPortraitPrompt(briefData, agentData, voiceGender);

	// Portraits are 3:4. orKey stays null on purpose: routing to OpenRouter would
	// silently ignore the model the user picked (and billed for) in the composer.
	const hero = await generateUgcImage(heroPrompt, null, falKey, modelId, '3:4');
	// Loud persist: pinned reusable face fed as grounding to every future video
	// -- never return the ephemeral provider URL, which would expire and break it.
	return await persistToStorage(svc, hero.url, userId, 'png');
}

/**
 * Generates a fresh pinned hero portrait for an agent and persists it to
 * `agent_configs.ugc_character_ref`. Always generates (no "already have one"
 * check) — callers that only want a lazy one-time generation should use
 * `ensureCharacterRef` below. Throws on failure (unlike `ensureCharacterRef`,
 * which swallows errors since it runs inline in the background post-generation
 * pipeline); this one is meant to be called from a user-facing action where a
 * real error — including a failed DB pin — should surface so the user knows
 * to retry rather than believing a save that didn't happen.
 */
export async function generateCharacterPortrait(
	supabase: any,
	svc: any,
	userId: string,
	agentId: string,
	falKey: string,
	briefData: any,
	agentData: any,
	voiceGender: 'male' | 'female' | undefined,
	promptOverride?: string,
	modelId?: string | null,
	/** When set, REGENERATE by editing this existing face (identity preserved)
	 *  instead of generating a brand-new person from text. */
	identityRef?: string | null
): Promise<string> {
	const editing = Boolean(identityRef);
	const portraitModel = resolveModel(editing ? 'image_edit' : 'image_t2i', modelId);
	const costEvents: CostEvent[] = [];
	// The portrait job runs three paid images: the hero portrait on the chosen
	// model, then the character sheet and the avatar hero shot on nano.
	const portraitQuoteUsd = portraitModel.usd + 2 * priceOf('fal', 'image', 'nano');
	return await runBudgetedAssetJob(
		supabase,
		userId,
		agentId,
		costEvents,
		async () => {
		// 1. Hero portrait → pinned as the profile picture. When a face already exists
		//    we EDIT it (feed the existing image back in) so the persona stays the SAME
		//    person — only the shot and any configured styling change. This is the fix
		//    for "regenerate produced a whole new person / new facial features". With no
		//    existing face we create one from scratch (first generation).
		let durable: string;
		if (editing) {
			const editPrompt = promptOverride?.trim() || buildPortraitEditPrompt(agentData);
			const editData = await falSyncJson(
				portraitModel.id,
				buildEditInput(portraitModel, editPrompt, [identityRef!], '3:4'),
				falKey
			);
			const editUrl = editData.images?.[0]?.url;
			if (!editUrl) throw new Error(`${portraitModel.label} returned no portrait`);
			durable = await persistToStorage(svc, editUrl, userId, 'png');
		} else {
			durable = await generateHeroPortraitImage(
				svc,
				userId,
				falKey,
				briefData,
				agentData,
				voiceGender,
				promptOverride,
				portraitModel.id
			);
		}
		// Bill the model we actually ran, not a hard-coded flux-schnell rate.
		costEvents.push({
			provider: 'fal',
			operation: 'image',
			model: `${portraitModel.label} (hero portrait${editing ? ' edit' : ''})`,
			usd: portraitModel.usd
		});
		// A silently failed pin leaves ugc_character_ref empty, and ensureCharacterRef
		// then regenerates (and pays for) a brand-new face on every single slot.
		const { data: pinned, error: pinErr } = await supabase
			.from('agent_configs')
			.update({ ugc_character_ref: durable })
			.eq('agent_id', agentId)
			.select('agent_id');
		if (pinErr) throw new Error(`Failed to pin character reference: ${pinErr.message}`);
		if (!Array.isArray(pinned) || pinned.length === 0)
			throw new Error(`Failed to pin character reference: no agent_configs row for ${agentId}`);

		// 2. Build a REAL reference-kit foundation from that portrait — a character
		//    turnaround sheet plus a distinct full-body shot — so the kit stages
		//    (side profiles / facial close-up / feature grid) work WITHOUT requiring
		//    a separately uploaded reference photo. Previously `full_body` was just
		//    the portrait reused and no `sheet` existed, which left the kit unusable
		//    for from-scratch personas. Best-effort: on failure we still leave a
		//    valid pinned profile picture and fall back to the portrait as full_body.
		//    Replace (not merge): a fresh face invalidates any prior derived stages.
		try {
			const sheetData = await falSyncJson(
				NANO_MODEL,
				{ prompt: CHARACTER_SHEET_PROMPT, image_urls: [durable], aspect_ratio: '16:9' },
				falKey
			);
			costEvents.push({
				provider: 'fal',
				operation: 'image',
				model: 'nano-banana-2 (character sheet)',
				usd: priceOf('fal', 'image', 'nano')
			});
			const sheetUrl = sheetData.images?.[0]?.url;
			if (!sheetUrl) throw new Error('Nano Banana returned no character sheet');

			// The hero shot conditions on the EPHEMERAL sheet URL, not the persisted
			// copy — the two are independent, so the persist must not serialize in
			// front of the paid fal call. The cost event rides the fal promise so the
			// spend is recorded even if the persist half rejects.
			const [durableSheet, heroShotUrl] = await Promise.all([
				persistToStorage(svc, sheetUrl, userId, 'png'),
				generateAvatarHeroShot(falKey, sheetUrl).then((url) => {
					costEvents.push({
						provider: 'fal',
						operation: 'image',
						model: 'nano-banana-2 (avatar hero shot)',
						usd: priceOf('fal', 'image', 'nano')
					});
					return url;
				})
			]);
			const durableFull = await persistToStorage(svc, heroShotUrl, userId, 'png');

			await mergeReferenceKit(
				supabase,
				agentId,
				{ sheet: durableSheet, full_body: durableFull },
				true
			);
		} catch (err) {
			console.warn(
				'[Content] Character-sheet foundation generation failed; kit stages will need a reference photo:',
				(err as Error).message
			);
			await mergeReferenceKit(supabase, agentId, { full_body: durable }, true);
		}

		return durable;
		},
		portraitQuoteUsd
	);
}

/**
 * Fixed prompt for turning a user-uploaded reference photo into a neutral,
 * reusable character turnaround/reference sheet (multi-view + detail panels),
 * via Nano Banana's edit endpoint. Kept verbatim as given — this is a tuned
 * prompt, not something to paraphrase.
 */
const CHARACTER_SHEET_PROMPT = `This is for upscale 4k hyper realistic UGC generation. Create a professional character turnaround and reference sheet based on the reference image. Use the uploaded image as the primary visual reference for the character's identity, proportions, facial features, body shape, hairstyle, and overall design language, while translating it into a clean, neutral, reusable presentation board. The final image should be arranged like a polished concept art sheet on a pure white studio background. Show the same character in four full-body views: front view, side profile, back view, and three-quarter view. On the right side, include multiple clean detail panels with close-ups of the eyes, upper face, lower face lips, skin texture, hair detail, and one small clothing or material detail. Keep the styling neutral and generic so the sheet can be reused as a base template for future adaptations. Simplify anything overly specific, thematic, fantasy-based, branded, culturally tied, or heavily ornamental from the source image into a more universal version while preserving the essence of the character. The outfit should become a clean neutral base outfit with minimal detailing, soft solid tones, and a refined silhouette. No excessive accessories, no dramatic headpieces, no strong lore-specific elements, no heavy decoration unless they are essential to the base identity. The character should feel balanced, elegant, realistic, and adaptable. Expression should be calm and neutral. Makeup should be subtle and natural. Lighting should be soft, even, and studio-clean. The layout should feel like a premium design presentation board used for model sheets, character development, or production reference. Preserve the core identity from the reference, but present it in a simplified, neutral, production-ready format that can serve as a universal template for future redesigns.`;

/** Stages that keep a per-stage "restore from history" pool (a `<stage>_history`
 *  array in ugc_reference_kit). Every stage image ever generated is retained
 *  here so it can be re-pinned later; nothing is deleted from the bucket. */
const KIT_HISTORY_STAGES = ['sheet', 'full_body', 'side_profiles', 'face_closeup', 'feature_grid'];
/** Cap each stage's history so the JSONB row can't grow without bound. */
const KIT_HISTORY_CAP = 24;

// CAS bounds: 5 attempts rides out the realistic contention here (a handful of
// detached kit jobs + a user click), and the backoff stays small enough that a
// route handler waiting on a marker write never feels it.
const KIT_CAS_MAX_ATTEMPTS = 5;
const KIT_CAS_BACKOFF_MS = 120;

/**
 * The ONLY writer for `agent_configs.ugc_reference_kit`. Four code paths used
 * to read-modify-write this JSONB independently, so a finished paid kit-stage
 * image could be overwritten by whichever stale snapshot wrote last. Every
 * write now goes through a compare-and-swap on an internal `rev` counter
 * stored inside the JSONB itself: read → mutate a copy → write guarded on the
 * rev we read. 0 rows matched = someone else wrote first → re-read and re-apply
 * `mutate` against the fresh kit.
 *
 * `mutate` receives a mutable copy of the current kit and must return the kit
 * to store; it may be called several times, once per CAS attempt, so it must
 * not have side effects beyond the kit itself. `rev` is stamped AFTER mutate
 * runs, so a mutate that rebuilds the object from scratch (replace semantics)
 * can't lose the counter. Returns the kit as written.
 */
export async function updateReferenceKit(
	client: any,
	agentId: string,
	mutate: (kit: Record<string, any>) => Record<string, any>
): Promise<Record<string, any>> {
	for (let attempt = 0; attempt < KIT_CAS_MAX_ATTEMPTS; attempt++) {
		const { data, error } = await client
			.from('agent_configs')
			.select('ugc_reference_kit')
			.eq('agent_id', agentId)
			.maybeSingle();
		if (error) throw new Error(`Failed to read ugc_reference_kit: ${error.message}`);
		// No config row at all: the guarded update below would match 0 rows forever,
		// which is indistinguishable from CAS contention — fail loud instead. (Rows
		// are created with the agent, so this is a genuinely broken state.)
		if (!data) throw new Error(`No agent_configs row for agent ${agentId} — cannot update kit`);
		const prior: Record<string, any> = data.ugc_reference_kit || {};

		const priorRev = typeof prior.rev === 'number' && Number.isFinite(prior.rev) ? prior.rev : null;
		if (priorRev === null) {
			// Pre-rev kit: `->>rev` can't guard against a missing key, so seed the
			// counter first with a write that changes NOTHING else, itself guarded on
			// the key still being absent, then loop back into the CAS path proper.
			const { error: seedErr } = await client
				.from('agent_configs')
				.update({ ugc_reference_kit: { ...prior, rev: 0 } })
				.eq('agent_id', agentId)
				.is('ugc_reference_kit->rev', null);
			if (seedErr) throw new Error(`Failed to seed ugc_reference_kit rev: ${seedErr.message}`);
			continue;
		}

		const next = mutate({ ...prior });
		next.rev = priorRev + 1;
		const { data: written, error: casErr } = await client
			.from('agent_configs')
			.update({ ugc_reference_kit: next })
			.eq('agent_id', agentId)
			.eq('ugc_reference_kit->>rev', String(priorRev))
			.select('agent_id');
		if (casErr) throw new Error(`Failed to update ugc_reference_kit: ${casErr.message}`);
		if (Array.isArray(written) && written.length > 0) return next;

		// Lost the race — another writer bumped rev between our read and write.
		await new Promise((r) => setTimeout(r, KIT_CAS_BACKOFF_MS * (attempt + 1)));
	}
	throw new Error(
		`ugc_reference_kit update for agent ${agentId} kept conflicting after ${KIT_CAS_MAX_ATTEMPTS} attempts`
	);
}

/**
 * Merges one new stage's asset into `agent_configs.ugc_reference_kit` (via the
 * CAS writer above). Pass `replace: true` when `patch` establishes a new
 * identity (a fresh from-scratch portrait, or a newly uploaded reference
 * photo) — the later kit stages (side_profiles/face_closeup/feature_grid) are
 * all derived from a specific full_body+sheet pair, so keeping them around
 * after that pair changes would silently mix two different faces into one
 * "reference kit" sent to the video model as a single character.
 */
async function mergeReferenceKit(
	supabase: any,
	agentId: string,
	patch: Record<string, string>,
	replace = false
): Promise<Record<string, any>> {
	// The history/replace logic runs INSIDE the CAS mutate so a retry recomputes
	// against the fresh kit — even on replace we need the existing kit to
	// maintain the per-stage `<stage>_history` arrays behind the restore picker.
	return updateReferenceKit(supabase, agentId, (existing) => {
		// For every stage URL in this patch, prepend it to that stage's history
		// (newest first, de-duped, capped). Seed with the stage's current value the
		// first time we track it so history is never empty for an existing stage.
		const historyPatch: Record<string, string[]> = {};
		for (const stage of KIT_HISTORY_STAGES) {
			const url = patch[stage];
			if (typeof url !== 'string' || !url) continue;
			const key = `${stage}_history`;
			const prior: string[] = Array.isArray(existing[key]) ? existing[key] : [];
			const seed = typeof existing[stage] === 'string' && existing[stage] ? [existing[stage]] : [];
			const next = [url, ...prior, ...seed].filter((u, i, arr) => arr.indexOf(u) === i);
			historyPatch[key] = next.slice(0, KIT_HISTORY_CAP);
		}

		if (replace) {
			// New identity: drop the derived stages' CURRENT values (a fresh face
			// invalidates them), but PRESERVE every `<stage>_history` array — history
			// is just the pool of past images the user can re-pin, never load-bearing
			// for what's sent to the video model — AND the transient `<key>_status` /
			// `<key>_started_at` markers, which belong to concurrently running
			// detached jobs, not to the identity being replaced.
			const preserved: Record<string, any> = {};
			for (const k of Object.keys(existing)) {
				if (k.endsWith('_history') || k.endsWith('_status') || k.endsWith('_started_at')) {
					preserved[k] = existing[k];
				}
			}
			return { ...preserved, ...patch, ...historyPatch };
		}
		return { ...existing, ...patch, ...historyPatch };
	});
}

/** Kit stages a client is allowed to restore-from-history. */
export const RESTORABLE_KIT_STAGES = KIT_HISTORY_STAGES;

/**
 * Removes reference photos from a persona's kit: drops each url from its
 * stage's history and, when that url is the stage's CURRENT pin, CLEARS the
 * stage.
 *
 * Deliberately no auto-promotion of the next history image: silently pinning a
 * different photo makes "delete" look like it did nothing (the grid count is
 * unchanged) and swaps the identity reference behind the user's back. An empty
 * stage is honest and recoverable — Restore-from-history and Regenerate both
 * refill it.
 *
 * The bucket object is deliberately left in place — a published post may use
 * the same image, and storage here is append-only by design, so "delete" means
 * "no longer part of this persona's kit". Returns the fresh kit for the UI.
 */
export async function removeKitAssets(
	supabase: any,
	agentId: string,
	targets: Array<{ stage: string; url: string }>
): Promise<Record<string, any>> {
	const applyRemovals = (kit: Record<string, any>): boolean => {
		let changed = false;
		for (const target of targets) {
			const stage = String(target?.stage || '');
			const url = String(target?.url || '');
			if (!url) continue;
			// An unknown stage is not an error — the caller may be deleting the same
			// url from every stage that happens to hold it.
			if (!KIT_HISTORY_STAGES.includes(stage)) continue;

			const historyKey = `${stage}_history`;
			const prior: string[] = Array.isArray(kit[historyKey]) ? kit[historyKey] : [];
			const history = prior.filter((u) => u !== url);
			if (history.length !== prior.length) {
				kit[historyKey] = history;
				changed = true;
			}
			if (kit[stage] === url) {
				// Clear, never auto-promote another history image: substituting a
				// different photo makes "delete" look like a no-op and swaps the
				// identity reference silently. Restore/Regenerate refill the stage.
				delete kit[stage];
				changed = true;
			}
		}
		return changed;
	};

	// Probe against the current snapshot first so a no-op delete doesn't burn a
	// rev bump; a real change goes through the CAS writer (removals recompute
	// against the fresh kit on each retry).
	const { data } = await supabase
		.from('agent_configs')
		.select('ugc_reference_kit')
		.eq('agent_id', agentId)
		.maybeSingle();
	const probe: Record<string, any> = { ...(data?.ugc_reference_kit || {}) };
	if (!applyRemovals(probe)) return probe;
	return updateReferenceKit(supabase, agentId, (kit) => {
		applyRemovals(kit);
		return kit;
	});
}

/**
 * Unpins a persona's profile picture. The image remains in the user's library,
 * so "Restore from history" can bring it back.
 */
export async function clearCharacterRef(supabase: any, agentId: string): Promise<void> {
	await supabase.from('agent_configs').update({ ugc_character_ref: null }).eq('agent_id', agentId);
}

/**
 * Restore-from-history for a single kit stage: re-pin `<stage>` to `url`, which
 * must be one of that stage's past generations (in `<stage>_history`) or its
 * current value. Only moves the pointer — nothing is generated or deleted.
 * Returns the fresh `ugc_reference_kit` (including updated history) for the UI.
 */
export async function repinKitStage(
	supabase: any,
	agentId: string,
	stage: string,
	url: string
): Promise<Record<string, any>> {
	if (!RESTORABLE_KIT_STAGES.includes(stage))
		throw new Error(`Unknown reference-kit stage: ${stage}`);
	// The caller (restore-kit-stage route) already enforces that `url` is one of
	// THIS user's own bucket images, so a stage can be re-pinned either from its
	// own tagged history OR from the full image library (the fallback for personas
	// generated before per-stage history existed). No history-membership gate here.
	// The CAS writer returns the kit exactly as written — no read-back needed.
	return mergeReferenceKit(supabase, agentId, { [stage]: url });
}

/**
 * Stage 2's fixed prompt: given the stage-1 turnaround sheet (front/side/back/
 * three-quarter views + detail panels), extract one clean, isolated, full-body
 * shot with a clear face — this (not the multi-panel sheet) is what actually
 * gets shown as the avatar/profile picture everywhere.
 */
const AVATAR_HERO_SHOT_PROMPT = 'Give me a full body shot and ensure the face is clear.';

/**
 * Stage 2: takes a generated character sheet (or any character reference
 * image) and distills it into a single clean full-body shot via Nano Banana,
 * conditioned on that sheet. Does not persist — caller decides what to do
 * with the result.
 */
async function generateAvatarHeroShot(falKey: string, referenceImageUrl: string): Promise<string> {
	const data = await falSyncJson(
		NANO_MODEL,
		{ prompt: AVATAR_HERO_SHOT_PROMPT, image_urls: [referenceImageUrl], aspect_ratio: '3:4' },
		falKey
	);
	const url = data.images?.[0]?.url;
	if (!url) throw new Error('Nano Banana returned no image for the hero shot');
	return url;
}

/**
 * Generates a character turnaround/reference sheet from a user-uploaded
 * reference photo (Nano Banana edit, stage 1), then immediately chains into
 * stage 2 (`generateAvatarHeroShot`) to distill it into one clean full-body
 * shot with a clear face — THAT final shot, not the multi-panel sheet, is
 * what gets persisted and pinned as `ugc_character_ref` (the same field
 * `generateCharacterPortrait` populates for the from-scratch path, so both
 * paths feed the same downstream consistency/avatar-display usage).
 */
export async function generateCharacterSheetFromReference(
	supabase: any,
	svc: any,
	userId: string,
	agentId: string,
	falKey: string,
	referenceImageUrl: string
): Promise<string> {
	const costEvents: CostEvent[] = [];
	// Two paid nano images: the character sheet, then the hero shot cut from it.
	const sheetQuoteUsd = 2 * priceOf('fal', 'image', 'nano');
	return await runBudgetedAssetJob(
		supabase,
		userId,
		agentId,
		costEvents,
		async () => {
		const data = await falSyncJson(
			NANO_MODEL,
			{ prompt: CHARACTER_SHEET_PROMPT, image_urls: [referenceImageUrl], aspect_ratio: '16:9' },
			falKey
		);
		costEvents.push({
			provider: 'fal',
			operation: 'image',
			model: 'nano-banana-2 (character sheet)',
			usd: priceOf('fal', 'image', 'nano')
		});
		const sheetUrl = data.images?.[0]?.url;
		if (!sheetUrl) throw new Error('Nano Banana returned no image');

		// The hero shot conditions on the EPHEMERAL sheet URL, not the persisted
		// copy — the two are independent, so the persist must not serialize in front
		// of the paid fal call. The cost event rides the fal promise so the spend is
		// recorded (ledger flushes in the job's finally) even if the persist rejects.
		const [durableSheet, heroShotUrl] = await Promise.all([
			persistToStorage(svc, sheetUrl, userId, 'png'),
			generateAvatarHeroShot(falKey, sheetUrl).then((url) => {
				costEvents.push({
					provider: 'fal',
					operation: 'image',
					model: 'nano-banana-2 (avatar hero shot)',
					usd: priceOf('fal', 'image', 'nano')
				});
				return url;
			})
		]);

		const durable = await persistToStorage(svc, heroShotUrl, userId, 'png');

		// A silently failed pin leaves ugc_character_ref empty, and ensureCharacterRef
		// then regenerates (and pays for) a brand-new face on every single slot.
		const { data: pinned, error: pinErr } = await supabase
			.from('agent_configs')
			.update({ ugc_character_ref: durable })
			.eq('agent_id', agentId)
			.select('agent_id');
		if (pinErr) throw new Error(`Failed to pin character reference: ${pinErr.message}`);
		if (!Array.isArray(pinned) || pinned.length === 0)
			throw new Error(`Failed to pin character reference: no agent_configs row for ${agentId}`);
		// Replace, not merge: a newly uploaded photo is a new identity, so any
		// side_profiles/face_closeup/feature_grid derived from a previous photo
		// (or a previous from-scratch face) no longer depict the same person.
		await mergeReferenceKit(supabase, agentId, { sheet: durableSheet, full_body: durable }, true);
		return durable;
		},
		sheetQuoteUsd
	);
}

/**
 * Stage 3's fixed prompt: given the approved full-body shot + the original
 * turnaround sheet, produce one composite image of the character's left and
 * right side profiles, preserving facial detail/imperfections (facial hair,
 * skin texture, etc.) at high fidelity.
 */

/**
 * Persona-correct wording for the kit prompts.
 *
 * The originals were hard-coded male ("his side profile", "the man's features"),
 * which quietly fought the reference image on every female persona. These build
 * the same prompt with pronouns that match the persona, and they're what the
 * confirm-before-generate composer shows — so the user sees (and can edit) the
 * exact text that will be sent.
 */
function genderWords(gender: 'male' | 'female' | undefined) {
	if (gender === 'female') return { possessive: 'her', noun: "the woman's" };
	if (gender === 'male') return { possessive: 'his', noun: "the man's" };
	return { possessive: 'their', noun: "the person's" };
}

export function buildSideProfilePrompt(gender?: 'male' | 'female'): string {
	const { possessive } = genderWords(gender);
	return `Upscale this and the character sheet to 4K resolution for maximum detail. I need a close-up shot of ${possessive} side profile, left and right, to retain ${possessive} facial details and imperfections including facial hair etc. Output as one high quality composite image.`;
}

export function buildFaceCloseupPrompt(gender?: 'male' | 'female'): string {
	const { noun } = genderWords(gender);
	return `give me a close up of ${noun} face focusing on the facial features`;
}

export function buildFeatureGridPrompt(gender?: 'male' | 'female'): string {
	const { noun } = genderWords(gender);
	return `give me a grid of close up shots of ${noun} features such as eyes, lips, nose, lashes, brow, and hair.`;
}

/** The image model every reference-kit stage runs on — surfaced so the UI can show it. */
export const KIT_IMAGE_MODEL = NANO_MODEL;

export type KitStage = 'full_body' | 'side_profiles' | 'face_closeup' | 'feature_grid';

/**
 * The single source of truth for what a kit stage will actually send: the prompt,
 * the model, the reference images and the aspect ratio. The preview endpoint
 * returns exactly this, and the generators below consume the same values — so
 * what the user confirms is what gets executed, never a stale approximation.
 */
export function resolveKitStagePlan(
	stage: KitStage,
	kit: Record<string, any>,
	characterRef: string | null,
	gender?: 'male' | 'female'
):
	| { prompt: string; model: string; image_urls: string[]; aspect_ratio: string }
	| { error: string } {
	if (stage === 'full_body') {
		// The full-body shot is regenerated FROM the existing profile picture (the
		// pinned face) — so the composer shows that face as the reference and only
		// the full-body shot changes, without touching the persona's identity. The
		// character sheet, if present, is a secondary anchor for a faithful body.
		const primary = characterRef || kit.sheet || kit.full_body;
		if (!primary) return { error: 'Generate a profile picture first.' };
		const image_urls = [primary];
		if (kit.sheet && kit.sheet !== primary) image_urls.push(kit.sheet);
		return { prompt: AVATAR_HERO_SHOT_PROMPT, model: NANO_MODEL, image_urls, aspect_ratio: '3:4' };
	}
	if (stage === 'side_profiles') {
		const frontal = kit.full_body || kit.sheet || characterRef;
		if (!frontal) return { error: 'Generate a profile picture first.' };
		return {
			prompt: buildSideProfilePrompt(gender),
			model: NANO_MODEL,
			image_urls: [frontal, kit.sheet || frontal],
			aspect_ratio: '16:9'
		};
	}
	if (stage === 'face_closeup') {
		const reference = kit.side_profiles || kit.full_body;
		if (!reference) return { error: 'Generate the side-profile composite first.' };
		return {
			prompt: buildFaceCloseupPrompt(gender),
			model: NANO_MODEL,
			image_urls: [reference],
			aspect_ratio: '1:1'
		};
	}
	if (!kit.face_closeup) return { error: 'Generate the facial close-up first.' };
	return {
		prompt: buildFeatureGridPrompt(gender),
		model: NANO_MODEL,
		image_urls: [kit.face_closeup, kit.sheet || kit.full_body || kit.face_closeup],
		aspect_ratio: '1:1'
	};
}

/**
 * Runs ONE reference-kit stage from an already-resolved plan.
 *
 * The plan (prompt / model / reference images / aspect ratio) comes from
 * `resolveKitStagePlan`, which is also what the confirm-before-generate composer
 * shows the user — so the request that executes here is byte-for-byte the one
 * they approved, including any prompt they edited. Persists the result durably
 * and merges it into the matching `ugc_reference_kit` key.
 */
export async function executeKitStage(
	supabase: any,
	svc: any,
	userId: string,
	agentId: string,
	falKey: string,
	stage: KitStage,
	plan: { prompt: string; image_urls: string[]; aspect_ratio: string; model?: string }
): Promise<string> {
	// The user picks this in the composer (budget vs quality). Single-reference
	// models receive only the primary reference -- see buildEditInput.
	const model = resolveModel('image_edit', plan.model);
	const costEvents: CostEvent[] = [];
	return await runBudgetedAssetJob(
		supabase,
		userId,
		agentId,
		costEvents,
		async () => {
		const data = await falSyncJson(
			model.id,
			buildEditInput(model, plan.prompt, plan.image_urls, plan.aspect_ratio),
			falKey
		);
		// Bill what we actually ran, not a hard-coded Nano Banana rate.
		costEvents.push({
			provider: 'fal',
			operation: 'image',
			model: `${model.label} (kit: ${stage})`,
			usd: model.usd
		});
		const url = data.images?.[0]?.url;
		if (!url) throw new Error(`${model.label} returned no image for ${stage}`);

		const durable = await persistToStorage(svc, url, userId, 'png');
		await mergeReferenceKit(supabase, agentId, { [stage]: durable });
		return durable;
		},
		model.usd
	);
}

async function ensureCharacterRef(
	supabase: any,
	svc: any,
	userId: string,
	agentId: string | undefined,
	existingRef: string | null,
	falKey: string | null,
	briefData: any,
	agentData: any,
	voiceGender: 'male' | 'female' | undefined
): Promise<string | null> {
	if (existingRef) return existingRef;
	if (!falKey || !agentId) return null;

	try {
		return await generateCharacterPortrait(
			supabase,
			svc,
			userId,
			agentId,
			falKey,
			briefData,
			agentData,
			voiceGender
		);
	} catch (err) {
		// Swallowing a budget-cap rejection here would defeat the fail-closed
		// spend guard — the run must stop, not proceed face-less. Everything else
		// stays best-effort: a post without a pinned face beats no post.
		if (/budget/i.test((err as Error)?.message ?? '')) throw err;
		return null;
	}
}

/**
 * The FULL-BODY reference a video-to-video run has to be driven from.
 *
 * Measured 2026-09-09: handed the pinned `ugc_character_ref` — a bust crop —
 * wan-animate invents a lower body, a wardrobe and a room to fill the frame,
 * because the source clip's performer is full-frame and the model has to put
 * something there. The result is a paid clip of a person the persona is not. So
 * the bust crop is NEVER an acceptable substitute here, unlike everywhere else
 * in this file where it is the identity anchor.
 *
 * Unlike `ensureCharacterRef` this THROWS rather than returning null: a v2v run
 * with no reference cannot degrade into a slightly worse v2v run, only into a
 * different format entirely — which is the caller's decision, made in the
 * never-brick fallback, not a silent one made here.
 *
 * The kit stage is reused, never reimplemented: `resolveKitStagePlan` +
 * `executeKitStage` are the same pair the Profile tab's reference-kit flow runs,
 * so a full body generated here is persisted into `ugc_reference_kit.full_body`
 * and every later run — v2v, cinematic, or a manual kit visit — finds it there
 * instead of paying for it again. That stage bills and budget-checks itself
 * (runBudgetedAssetJob), which is why no cost event for it appears at the call
 * site.
 */
async function resolveFullBodyReference(
	supabase: any,
	userId: string,
	agentId: string | undefined,
	kit: Record<string, any> | null,
	characterRef: string | null,
	falKey: string | null,
	gender: 'male' | 'female' | undefined
): Promise<string> {
	const existing = typeof kit?.full_body === 'string' ? kit.full_body.trim() : '';
	if (existing) return existing;
	if (!agentId || !falKey) {
		throw new Error(
			'V2V_NO_FULL_BODY: this persona has no full-body reference and one cannot be generated without a fal key.'
		);
	}
	let svc: any;
	try {
		svc = getServiceSupabase();
	} catch {
		// The kit stage persists to our bucket before it merges the URL — with no
		// service key there is nowhere durable to put it, and a provider URL would
		// 404 out of the kit days later.
		throw new Error(
			'V2V_NO_FULL_BODY: a full-body reference must be generated first, and storage is not configured on this server.'
		);
	}
	const plan = resolveKitStagePlan('full_body', kit ?? {}, characterRef, gender);
	// The plan's own error is the honest one ("Generate a profile picture first."):
	// with no face pinned there is nothing to build a body around.
	if ('error' in plan) throw new Error(`V2V_NO_FULL_BODY: ${plan.error}`);
	return await executeKitStage(supabase, svc, userId, agentId, falKey, 'full_body', plan);
}

/**
 * Generates a single UGC post pack tuned to the agent persona, brand brief and product,
 * using the agent's pinned voice/format/quality. Throws on unrecoverable failures.
 */
/**
 * A Director pick, paired with the provider that can actually serve it.
 *
 * The composer only ever offers models for the provider this user's keys
 * resolve to, but the request is user input: an id from the wrong provider (or
 * one that is not an llm at all) must resolve to nothing rather than being
 * posted to an endpoint that will 404 after the user has approved the run.
 */
function llmPickFor(
	modelId?: string | null
): { provider: 'openrouter' | 'gemini'; model: string } | null {
	if (!modelId) return null;
	const found = MODEL_CATALOG.find((m) => m.kind === 'llm' && m.id === modelId);
	if (!found || (found.provider !== 'openrouter' && found.provider !== 'gemini')) return null;
	return { provider: found.provider, model: found.id };
}

export async function generateUgcPack(input: UgcPackInput): Promise<UgcPack> {
	const { supabase, userId } = input;
	const platform = input.platform || 'instagram';
	const topic = input.topic || 'Sharing an honest experience with this product';
	const wantVideo = input.video !== false;

	const db = createDbService(supabase);
	// Independent pre-director lookups run concurrently (same shape as
	// generateCinematicUgcPack). The fail-closed spend guard rides in the same
	// Promise.all — it's a read, so it can overlap the other reads, and awaiting
	// it here still means no PAID call (the Director LLM is the first) can start
	// before the cap check has passed.
	const [rawAi, cfg, agentResult] = await Promise.all([
		resolveAiClient(supabase, userId),
		loadUgcConfig(supabase, input.agentId),
		input.agentId ? db.agents.get(input.agentId) : Promise.resolve({ data: null as any }),
		assertWithinBudget(supabase, userId, input.agentId)
	]);
	if (!rawAi)
		throw new Error('No AI provider configured. Add an OpenRouter or Gemini key in Settings.');
	// Every text call (director, retries, grader) self-records into the ledger.
	const costEvents: CostEvent[] = [];
	const ai = trackAi(rawAi, costEvents);

	try {
		// The composer can force this run's format; 'auto' (or unset) defers to the
		// persona's ugc_format, which the Director resolves from the content. This one
		// value drives both the Director's brief and the final spokesperson/broll branch.
		const formatPref:
			| 'auto'
			| 'spokesperson'
			| 'broll'
			| 'vo_broll'
			| 'motion_card'
			| 'v2v_replace'
			| 'v2v_move'
			| 'v2v_narrated'
			| 'listicle' =
			input.formatOverride && input.formatOverride !== 'auto' ? input.formatOverride : cfg.format;

		/**
		 * How many list items this run is allowed to speak — the count the QUOTE was
		 * built on, minus the framing line that is beat one.
		 *
		 * Resolved this early because it is the Director's instruction, not just a
		 * post-hoc cut: asking for a RANGE and trimming afterwards means the model
		 * writes five items for a four-beat quote and the last one is thrown away —
		 * paid for in Director tokens, and (worse, if the cut ever slipped) in a
		 * fifth voiceover call nobody priced. Asking for exactly N is the only shape
		 * in which the ledger and the quote agree by construction.
		 */
		const listicleItemTarget = Math.max(
			LISTICLE_MIN_ITEMS,
			Math.min(
				LISTICLE_MAX_ITEMS,
				Number.isFinite(input.listItemCount as number)
					? Math.round(input.listItemCount as number) - 1
					: LISTICLE_DEFAULT_ITEMS
			)
		);

		// ── Load agent persona ──────────────────────────────────────────────
		let agentContext = '';
		let agentData: any = null;
		const agent = agentResult?.data;
		if (agent) {
			agentData = agent;
			agentContext = buildRichAgentContext(agent);
		}

		// The on-camera character's depicted gender must match the voice actually
		// used — and the persona's configured gender (Profile tab) is authoritative
		// over a contradicting voice pick (e.g. the 'Adam' column default on a
		// female persona). Threaded through explicitly so the Director/character-ref
		// prompts and the TTS call all agree.
		// A composer voice pick replaces the persona's CONFIGURED voice as the input
		// to that agreement — never its output: a per-run pick that contradicted the
		// persona's gender would put a male voice on a female character, which is
		// the exact mismatch resolveVoiceForPersona exists to prevent. An unknown
		// name is discarded here rather than handed to TTS.
		const requestedVoice = input.voiceOverride?.trim();
		const voiceIn =
			requestedVoice && VOICE_CATALOG.some((v) => v.name === requestedVoice)
				? requestedVoice
				: cfg.voice;
		const { voice: resolvedVoice, voiceGender } = resolveVoiceForPersona(voiceIn, agentData);

		// ── Brand brief + product (persona's selected brief, newest as fallback) ──
		let selectedProduct: any = null;
		let briefData: any = null;
		const brandBrief = await loadBriefForAgent(db, userId, cfg.brandBriefId);
		if (brandBrief?.data) {
			briefData = brandBrief.data;
			const products = Array.isArray(briefData.products) ? briefData.products : [];
			selectedProduct = input.productId
				? products.find((p: any) => p.id === input.productId)
				: products.find((p: any) => p.photoUrl) || products[0];
		}

		// ── Content intent classification ───────────────────────────────────
		const intent = classifyContentIntent(topic, platform);
		const brandVisualCtx = buildBrandVisualContext(briefData);

		// The topic the USER actually asked for, as opposed to `topic`, which is
		// defaulted to generic filler at the top of this function. The two must stay
		// distinguishable: filler is worth defaulting into a prompt, an instruction
		// the user never gave is not.
		const explicitTopic = input.topic?.trim() || '';

		// ── Director (LLM) ──────────────────────────────────────────────────
		const buildDirectorPrompt = () =>
			[
				agentContext,
				// Product and topic are NOT alternatives. The product is the subject;
				// the topic is the angle taken on it. They used to be mutually
				// exclusive here, and because a product always resolves on a persona
				// with a brand brief (falling back to the first one), the user's
				// picked topic was dropped on exactly the personas most likely to
				// have one. Both go in now. With no explicit topic the subject line
				// stands alone, as before — the generic filler is not an angle.
				selectedProduct
					? `Product: "${selectedProduct.name}" — ${selectedProduct.description || 'no description'}. Price: ${selectedProduct.price || 'N/A'}.`
					: '',
				selectedProduct
					? explicitTopic
						? `Angle to take on that product: "${explicitTopic}"`
						: ''
					: `Topic: "${topic}"`,
				briefData
					? [
							`Brand: ${briefData.brandName || '(unnamed)'}.`,
							`Voice/tone: ${briefData.commStyle || 'authentic and direct'}.`,
							`Target audience: ${briefData.demographics || 'general'}.`,
							`Audience pain points: ${briefData.painPoints || 'N/A'}.`,
							briefData.samplePost ? `Reference post style: "${briefData.samplePost}".` : '',
							brandVisualCtx
						]
							.filter(Boolean)
							.join(' ')
					: '',
				`Content type detected: ${intent.type}. Platform: ${platform}. Platform voice guide: ${intent.platformVoice}.`,
				buildHookGuidance(intent, `${topic}|${platform}|${input.agentId || ''}`),
				formatPref === 'auto'
					? 'Requested format: choose spokesperson or broll based on what will perform best for this content type.'
					: formatPref === 'vo_broll'
						? 'Requested format: vo_broll — a product/lifestyle clip with the persona NARRATING over it. Write BOTH a spoken line (dialogue) and a scene the camera can show without anyone talking to camera.'
						: formatPref === 'motion_card'
							? 'Requested format: motion_card — a typographic card that will be animated. The card line IS the artwork; no photography, no person on camera.'
							: formatPref === 'listicle'
								? // The extra key is asked for HERE rather than in DIRECTOR_SYSTEM
									// because that schema is shared by every format: adding
									// list_items to it would have a photo post inventing a list
									// nothing reads, and the "no extra keys" instruction it ends
									// on would contradict itself on all seven other formats.
									[
										'Requested format: listicle — a numbered countdown spoken straight to camera. Each item is REVEALED on screen at the exact moment she says it, so the beats must be separable.',
										`Add ONE extra key to the JSON: "list_items": [{"label":"<=4 words, drawn on screen","line":"the full sentence she speaks for this item"}]. Write EXACTLY ${listicleItemTarget} items — this run is priced for that many voiceover calls and any extra is discarded.`,
										'"dialogue" is ONLY the framing line she says before item 1 — not the whole script. The items carry the rest, one sentence each.',
										// Measured, not stylistic. A phrase the voice model has to
										// think about — "longevity people" — came back with a 0.55s
										// dead gap in the MIDDLE of it, which drags every later
										// reveal off the word it was timed to.
										'Every spoken line must read aloud cleanly in one breath: plain noun phrases, ordinary word order, no stacked compound modifiers and no coined two-word categories. Write what a person would actually say out loud.'
									].join(' ')
								: `Requested format: ${formatPref}.`,
				voiceGender
					? `If the scene shows a person on camera, they must present as ${voiceGender} — the pinned voice is ${voiceGender} and the on-camera character must match.`
					: '',
				`Creative angle for this post: "${topic}". Output ONLY the JSON.`
			]
				.filter(Boolean)
				.join('\n');

		const raw =
			(await ai.generate(buildDirectorPrompt(), {
				systemInstruction: DIRECTOR_SYSTEM,
				json: true,
				stage: 'director'
			})) || '{}';
		let parsed = safeParseJson(raw);
		if (!parsed) throw new Error('AI returned unparseable response');
		if (parsed.text && typeof parsed.text === 'string' && parsed.text.trim().startsWith('{')) {
			try {
				parsed = { ...parsed, ...JSON.parse(parsed.text) };
			} catch {
				/* ignore */
			}
		}

		// ── Hook quality gate — retry once if score is below threshold ──────
		if (typeof parsed.hookScore === 'number' && parsed.hookScore < HOOK_SCORE_THRESHOLD) {
			console.warn(
				`[Director] hookScore ${parsed.hookScore} below threshold ${HOOK_SCORE_THRESHOLD} — retrying with stronger hook instruction.`
			);
			const retryRaw =
				(await ai.generate(
					`${buildDirectorPrompt()}\n\nYour previous hook scored ${parsed.hookScore}/99. The hook must be a genuine pattern-interrupt or confession that stops the scroll cold — not a description or question. Aim for 85+. Rewrite the entire JSON with a stronger hook.`,
					{ systemInstruction: DIRECTOR_SYSTEM, json: true, stage: 'director_retry_hook' }
				)) || '{}';
			const retryParsed = safeParseJson(retryRaw);
			if (retryParsed && (retryParsed.hookScore ?? 0) > (parsed.hookScore ?? 0)) {
				parsed = retryParsed;
			}
		}

		// ── Pre-media quality gate: independent grader, improvement-guided retry ──
		// Text grading is ~free; media is the expensive step. A draft below the
		// floor gets ONE targeted rewrite; still below → the slot is abandoned
		// BEFORE any image/video spend, and the rejection is logged as QC data.
		const floor = qualityFloor();
		let qualityGrade = await gradeDraftWithRetry(
			ai,
			parsed,
			selectedProduct?.name ?? null,
			platform
		);
		if (floor > 0 && qualityGrade && qualityGrade.overall < floor) {
			console.warn(
				`[QC] Draft graded ${qualityGrade.overall}/10 (< floor ${floor}) — one improvement-guided rewrite: ${qualityGrade.fix}`
			);
			const rewriteRaw =
				(await ai.generate(
					`${buildDirectorPrompt()}\n\nAn independent QC reviewer graded your draft ${qualityGrade.overall}/10. Top issue: ${qualityGrade.topIssue}. Required fix: ${qualityGrade.fix}. Rewrite the ENTIRE JSON applying that fix without losing the persona voice.`,
					{ systemInstruction: DIRECTOR_SYSTEM, json: true, stage: 'director_rewrite_qc' }
				)) || '{}';
			const rewritten = safeParseJson(rewriteRaw);
			if (rewritten?.text) {
				const regrade = await gradeDraft(ai, rewritten, selectedProduct?.name ?? null, platform);
				if (!regrade || regrade.overall >= (qualityGrade?.overall ?? 0)) {
					parsed = rewritten;
					qualityGrade = regrade ?? qualityGrade;
				}
			}
			if (qualityGrade && qualityGrade.overall < floor) {
				await logAutoReject(supabase, userId, input.agentId, qualityGrade, parsed);
				throw new Error(
					`Draft quality ${qualityGrade.overall}/10 below floor ${floor} after rewrite (${qualityGrade.topIssue}) — no media generated.`
				);
			}
		}

		let format:
			| 'spokesperson'
			| 'broll'
			| 'vo_broll'
			| 'motion_card'
			| 'v2v_replace'
			| 'v2v_move'
			| 'v2v_narrated'
			| 'listicle' =
			formatPref === 'auto' ? (parsed.format === 'broll' ? 'broll' : 'spokesperson') : formatPref;
		// The v2v formats are the only ones carrying an INPUT the brief can't
		// invent. Asked for without an ingested clip there is nothing to
		// re-perform, so the run degrades to the b-roll clip the same still would
		// have produced rather than failing after the Director has been paid.
		// `v2vMode` only names which transfer: the format is what the request
		// carries, so it settles the branch and the mode fills in behind it.
		const v2vRequested =
			format === 'v2v_replace' ||
			format === 'v2v_move' ||
			format === 'v2v_narrated' ||
			// A caller that pinned only the mode (no format) still means v2v — but
			// only when it also handed us a clip, or this would coerce right back.
			(Boolean(input.v2vMode) && Boolean(input.sourceVideoUrl?.trim()));
		const sourceVideoUrl = input.sourceVideoUrl?.trim() || null;
		if (v2vRequested) {
			if (!sourceVideoUrl) {
				// A narrated remake keeps the half of itself that never needed a clip:
				// its other four stages ARE vo_broll (director, still, tts, mux), so
				// coercing it to silent b-roll would drop a narration the user asked
				// for and the Director has already been paid to write.
				const narrated = format === 'v2v_narrated';
				console.warn(
					`[Composer] v2v asked for with no source clip — coercing to ${narrated ? 'narrated b-roll' : 'b-roll'}.`
				);
				format = narrated ? 'vo_broll' : 'broll';
			} else if (format !== 'v2v_replace' && format !== 'v2v_move' && format !== 'v2v_narrated') {
				format = input.v2vMode === 'move' ? 'v2v_move' : 'v2v_replace';
			}
		}
		// A graphic card has no face to animate — a talking head cannot run on it.
		// (Reachable only when the composer switches a graphic template to video.)
		// A listicle is a talking head with timed reveals, so it fails the same
		// test for the same reason and degrades the same way.
		if (input.stillStyle === 'graphic' && (format === 'spokesperson' || format === 'listicle')) {
			console.warn('[Composer] Graphic still cannot drive a talking head — coercing to b-roll.');
			format = 'broll';
		}
		// A motion card animates a TYPESET card. Asked for on a photographic
		// composition there is no card to animate, so it degrades to the clip the
		// user would otherwise have got rather than producing nothing.
		if (format === 'motion_card' && input.stillStyle !== 'graphic') {
			console.warn('[Composer] motion_card needs a graphic still — coercing to b-roll.');
			format = 'broll';
		}
		// Conversely a card cannot carry a narrated product clip.
		if (format === 'vo_broll' && input.stillStyle === 'graphic') {
			console.warn('[Composer] vo_broll on a graphic still — coercing to motion_card.');
			format = 'motion_card';
		}
		// A v2v run re-performs the source clip AS THE PERSONA, and its only input
		// besides the clip is a full-body reference OF that persona. A composition
		// that excludes the persona (a typographic card, refs.character=false) has
		// none and can never grow one, so this is a coercion rather than a fallback
		// the provider call would discover seven minutes and one charge later.
		if (
			(format === 'v2v_replace' || format === 'v2v_move' || format === 'v2v_narrated') &&
			(input.stillStyle === 'graphic' || input.useCharacterRef === false)
		) {
			// Same one-stage-at-a-time rule as the missing-clip coercion above: a
			// voice needs no reference of anybody, so a narrated remake that loses the
			// persona lands on vo_broll rather than on a silent clip. The typeset card
			// is the exception in both directions — no camera and nowhere to put a
			// voice — which is why vo_broll itself becomes motion_card a few lines up.
			const narrated = format === 'v2v_narrated';
			format = input.stillStyle === 'graphic' ? 'motion_card' : narrated ? 'vo_broll' : 'broll';
			console.warn(`[Composer] v2v needs the persona on camera — coercing to ${format}.`);
		}
		// A composer-edited visual brief outranks the Director's scene.
		// Graphic cards render a LINE, not a scene: the Director's on-screen hook is
		// written for exactly this job; the caption's first line is the fallback.
		const isGraphicStill = input.stillStyle === 'graphic';
		// 'auto' means "let pickCardLayout() read the text", which is the default
		// every existing caller relies on — only an explicit choice is passed on.
		const pinnedCardLayout: CardLayout | null =
			input.cardLayout && input.cardLayout !== 'auto' ? input.cardLayout : null;
		// Framing is a photographic register — a typographic card has no camera, so
		// pinning one there would tell the model to photograph a piece of type.
		const scenePrompt = isGraphicStill
			? // A pinned layout is art direction for the model card path; the local
				// renderer takes the same string as its (currently advisory) artDirection.
				withCardLayout(
					input.sceneOverride?.trim() || parsed.scene_prompt || parsed.ugc_broll_prompt || topic,
					input.cardLayout
				)
			: withFraming(
					input.sceneOverride?.trim() || parsed.scene_prompt || parsed.ugc_broll_prompt || topic,
					input.framing
				);
		const directorCardText = isGraphicStill
			? String(parsed.on_screen_text || String(parsed.text || '').split('\n')[0] || topic)
					.trim()
					.slice(0, 220)
			: null;
		// A user-typed card line is the artwork when the font can actually draw it.
		// sanitizeCardText is the same glyph gate the renderer applies to the
		// Director's line, run HERE so a rejected line degrades to the Director's
		// instead of failing a run the user has already paid the Director for.
		const pinnedCardText = (() => {
			if (!isGraphicStill) return null;
			const raw = input.cardText?.trim().slice(0, 220);
			if (!raw) return null;
			if (sanitizeCardText(raw)) return raw;
			console.warn('[Composer] Pinned card text lost too many glyphs — keeping the Director line.');
			return null;
		})();
		const cardText = pinnedCardText ?? directorCardText;
		const baseMotion =
			parsed.motion_prompt ||
			'Slow gimbal dolly-in, natural ambient light, product label in focus.';
		const motionPrompt = enhanceMotionPrompt(baseMotion, intent, format);

		// Provider preference from the composer: pinning 'fal' disables the
		// OpenRouter media failover; pinning 'openrouter' skips fal media entirely.
		// (Text/LLM routing is unaffected — this governs media only.)
		const resolvedKeys = await resolveImageKeys(supabase, userId);
		// Same identifier as refineUgcMedia so the cost sites below read one name.
		const orRoutes = resolvedKeys.orRoutes;
		const falRoutes = resolvedKeys.falRoutes;
		const pref = input.providerPreference || 'auto';
		const falKey = pref === 'openrouter' ? null : resolvedKeys.falKey;
		const orKey = pref === 'fal' ? null : resolvedKeys.orKey;

		// ── Spokesperson TTS — kicked off NOW, in parallel with the still ──
		// The audio depends only on the script + voice, never on the still; the two
		// paid calls only join at generateTalkingHead, so serializing them was pure
		// added latency. The promise settles into a value (never rejects) so a throw
		// on the still path can't leave an unhandled rejection — the error resurfaces
		// at the await inside the video try-block, where the existing fal-outage
		// fallback applies unchanged, and the cost event rides the success handler so
		// the spend is recorded (ledger flushes in finally) even if the still fails.
		// The composer's script pin — the first-run equivalent of refine's `dialogue`.
		// Gated on format because only a spokesperson run speaks: a pin left over
		// from a format switch must not end up recorded as this post's script when
		// nothing said it. Resolved AFTER the format coercions above so it agrees
		// with the branch that actually runs.
		// The narrated remake speaks, and it has to be counted HERE rather than in
		// the video branch: this flag is what launches TTS in parallel with the
		// still (and what lets a pinned script through). Left out, the mux below
		// would have no audio to lay under the transferred clip and every single
		// narrated run would degrade to a silent transfer.
		// ── The list, validated before a single beat is paid for ────────────
		// Nothing downstream can invent a list, so this is the last point at which
		// a listicle can degrade for free. A Director that returned no usable items
		// (wrong key, prose instead of objects, one item) becomes the plain
		// spokesperson it already is: the alternative is billing N voiceover calls
		// for a countdown with nothing to count.
		const listItems =
			format === 'listicle'
				? parseListItems(parsed.list_items, listicleItemTarget, input.listItemsOverride)
				: [];
		if (format === 'listicle' && listItems.length < LISTICLE_MIN_ITEMS) {
			console.warn(
				`[Listicle] Director returned ${listItems.length} usable item(s) — running as a plain spokesperson.`
			);
			format = 'spokesperson';
		}
		// True only for a run that reached the video stage still meaning to be a
		// listicle. Read at record time to explain a listicle request that shipped
		// as something else — captured AFTER every coercion above, because a
		// composition rule that ruled the format out is not an assembly failure.
		const listicleRequested = format === 'listicle';

		const speaks =
			format === 'spokesperson' ||
			format === 'vo_broll' ||
			format === 'v2v_narrated' ||
			format === 'listicle';
		const pinnedLine = speaks ? input.dialogueOverride?.trim() || '' : '';
		const dialogue = pinnedLine || parsed.dialogue || parsed.text || topic;
		/**
		 * The beats, in spoken order: the framing line, then one per item. Each
		 * entry IS a billing unit — one TTS call — and this length is the same
		 * number `$lib/formats` multiplied the voiceover stage by when it quoted
		 * the run, which is what `listicleItemTarget` exists to guarantee.
		 */
		const listicleBeats = listicleRequested ? [dialogue, ...listItems.map((i) => i.line)] : null;
		// Everything actually spoken this run, whether it left as one blob or as
		// measured segments. Recorded as the script/dialogue so the drawer never
		// shows only the framing line of a post that read out four more sentences.
		const spokenScript = listicleBeats ? listicleBeats.join('\n') : '';
		// The measured reveal track. Non-null ONLY when segmented TTS AND the local
		// join both succeeded — i.e. only when the reveals can be timed to speech.
		let listicleTrack: TimedCaption[] | null = null;
		// The voice that ACTUALLY spoke this run — updated when TTS degrades to the
		// classic fallback, so the stored post never claims a voice that didn't run.
		let ttsVoiceUsed = resolvedVoice;
		// The fal-supported classic this run degrades to if the picked voice is
		// rejected. Hoisted so the segmented path below cannot drift from the
		// single-call one — two lists of fallback voices is how a listicle ends up
		// half in one voice and half in another.
		const fallbackVoice = voiceGender === 'female' ? 'Rachel' : 'Adam';

		/**
		 * The listicle's voiceover: one call per beat, every one metered, then
		 * joined locally so the reveal times are measurements rather than guesses.
		 *
		 * Degrades in exactly one step. If the segments cannot be produced or
		 * joined, it speaks the WHOLE script as a single blob and leaves
		 * `listicleTrack` null — a talking head with no reveals still ships, and
		 * the record downgrades to 'spokesperson' because that is what it is. A
		 * spend refusal is the one thing that is NOT degraded past: falling back
		 * there would buy a second voiceover on the very run the cap rejected.
		 */
		const speakListicle = async (
			key: string,
			beats: string[]
		): Promise<{ url: string } | { err: Error }> => {
			try {
				// allSettled, not all: a rejection mid-flight must not discard the
				// segments that DID reach fal. Each one is a real provider call, so
				// each one records its own cost event — the quote already bills this
				// stage per beat (`stepBilling.tts`), and a single event here would
				// leave the ledger reading one voiceover against a four-beat quote.
				const settled = await Promise.allSettled(
					beats.map((line) =>
						generateVoiceAudio(key, resolvedVoice, line, fallbackVoice, falRoutes.tts)
					)
				);
				const urls: string[] = [];
				for (const s of settled) {
					if (s.status !== 'fulfilled') continue;
					ttsVoiceUsed = s.value.voiceUsed;
					costEvents.push({
						provider: 'fal',
						operation: 'tts',
						model: falRoutes.tts.id,
						usd: falRoutes.tts.usd
					});
					urls.push(s.value.url);
				}
				const failed = settled.find((s) => s.status === 'rejected');
				if (failed) throw (failed as PromiseRejectedResult).reason;

				// Same getter as the video branch's `svc`, resolved here because the
				// join runs BEFORE that branch — the joined audio has to be hosted
				// somewhere fal can fetch it before the lip-sync call is even made.
				const svcForVoice = (() => {
					try {
						return getServiceSupabase();
					} catch {
						return null;
					}
				})();
				const joined = await joinVoiceSegments(svcForVoice, userId, urls, LISTICLE_BEAT_GAP_SEC);
				if (!joined) throw new Error('segment join produced no audio');
				listicleTrack = buildListicleTrack(listItems, joined.startsAt);
				if (listicleTrack.length === 0) throw new Error('no reveal could be timed');
				return { url: joined.url };
			} catch (e) {
				if (isCreditsError(e) || /budget/i.test((e as Error).message ?? '')) {
					return { err: e as Error };
				}
				console.warn(
					`[Listicle] segmented voiceover failed (${((e as Error).message ?? '').slice(0, 160)}) — speaking the whole script in one call, no reveals.`
				);
				listicleTrack = null;
				try {
					const { url, voiceUsed } = await generateVoiceAudio(
						key,
						resolvedVoice,
						beats.join(' '),
						fallbackVoice,
						falRoutes.tts
					);
					ttsVoiceUsed = voiceUsed;
					costEvents.push({
						provider: 'fal',
						operation: 'tts',
						model: falRoutes.tts.id,
						usd: falRoutes.tts.usd
					});
					return { url };
				} catch (blobErr) {
					return { err: blobErr as Error };
				}
			}
		};

		const spokenAudio: Promise<{ url: string } | { err: Error }> | null =
			wantVideo && speaks && falKey
				? listicleBeats
					? speakListicle(falKey, listicleBeats)
					: generateVoiceAudio(
							falKey,
							resolvedVoice,
							dialogue,
							// Adam/Rachel are the original ElevenLabs voices — universally
							// fal-supported, so a rejected exotic voice degrades to a
							// same-gender classic, never a failure.
							fallbackVoice,
							falRoutes.tts
						).then(
							({ url, voiceUsed }) => {
								ttsVoiceUsed = voiceUsed;
								costEvents.push({
									provider: 'fal',
									operation: 'tts',
									model: falRoutes.tts.id,
									usd: falRoutes.tts.usd
								});
								return { url };
							},
							(err) => ({ err: err as Error })
						)
				: null;

		// ── Pinned creator face → consistent character across ALL posts ──
		// Composer override wins; when present we also skip lazy face generation.
		// Runs for every format the persona APPEARS in: b-roll stills feature the
		// persona too, and without a pinned face each still invents a brand-new
		// person (three posts, three different "influencers" — the exact identity
		// drift this anchor exists to prevent). First generation for an agent
		// creates + pins the hero portrait; everything after reuses it.
		// A composition that EXCLUDES the persona (refs.character=false — product
		// macros, mood boards, POV shots, graphic cards) skips all of this,
		// including the first-run face generation it would otherwise pay for.
		// "Use my own still": resolved HERE, above the reference work, because the
		// only consumer of a character/product reference is the still composite. If
		// the user supplied the still, the lazy first-run face generation below
		// would be a paid call for an image nothing in this run can use.
		const suppliedStill = suppliedStillUrl(input.stillUrlOverride);
		const wantCharacterRef = input.useCharacterRef !== false && !isGraphicStill;
		let characterRef =
			input.characterRefOverride?.trim() || (wantCharacterRef ? cfg.characterRef : null);
		if (wantCharacterRef && input.agentId && !input.characterRefOverride && !suppliedStill) {
			let svcForRef: any = null;
			try {
				svcForRef = getServiceSupabase();
			} catch {
				svcForRef = null;
			}
			if (svcForRef) {
				characterRef = await ensureCharacterRef(
					supabase,
					svcForRef,
					userId,
					input.agentId,
					cfg.characterRef,
					falKey,
					briefData,
					agentData,
					voiceGender
				);
			}
		}

		// ── Still — routed by the composition contract ──
		// graphic → typographic card, NO references (the text is the artwork).
		// photo   → Nano Banana composite of whichever refs this composition uses
		//           (product+face, face only, or product only), flux last resort.
		// Failover: a fal OUTAGE (balance lock, 5xx) degrades to the OpenRouter
		// path — keeping the slot alive — rather than killing generation outright.
		// Composer's still-model pick. Kept as a raw id and resolved PER BRANCH,
		// because the same pick means 'image_edit' when references are composited
		// and 'image_t2i' when they aren't — and because absent must mean "the
		// compiled-in Nano Banana routing", not resolveModel's t2i default (Schnell),
		// which would quietly downgrade every still that never asked for a model.
		const stillModelId = input.stillModel?.trim() || null;
		let still: string;
		const wantProductRef = input.useProductRef !== false && !isGraphicStill;
		const productPhoto =
			input.productPhotoUrlOverride?.trim() ||
			(wantProductRef ? selectedProduct?.photoUrl || null : null);
		// What actually rendered the still is NOT tracked in a second variable here
		// the way videoModelRan is: every still path already pushes the model it ran
		// into the cost ledger, and summarizeAspects derives provenance from exactly
		// those events — so aspects.image.models is the single truth, failovers
		// included. Only the REQUEST is recorded separately, below.
		if (suppliedStill) {
			// No model call, so no cost event — a step that did not run records no
			// spend. Everything downstream (talking head, i2v, caption burn, durable
			// persist) treats this exactly as a generated still, and it wins over the
			// card path: a supplied image IS the artwork.
			still = suppliedStill;
		} else if (isGraphicStill) {
			// ── $0 deterministic render first (server-side ffmpeg typography) ──
			// The text IS the artwork, and the Director already wrote it — so the
			// default is to typeset it locally for free. The model providers below
			// are the FALLBACK: no ffmpeg/font on this host, glyphs the system font
			// can't draw (emoji), no durable storage, or a persist failure all fall
			// through to exactly the pre-renderer paths. UGC_CARD_RENDERER=model
			// restores model-only rendering.
			let renderedCardUrl: string | null = null;
			const svcForCard = (() => {
				try {
					return getServiceSupabase();
				} catch {
					return null; // No service key — a local PNG would have nowhere durable to live.
				}
			})();
			if (svcForCard) {
				// A pinned palette enters through the one door resolveCardPalette has:
				// the brand ground. The ink is still derived from its luminance, so a
				// pick can't produce an illegible card.
				const cardGround = cardGroundOverride(input.cardPalette);
				const card = await renderTypographicCard({
					cardText: cardText!,
					artDirection: scenePrompt,
					// A pinned layout reaches the LOCAL renderer too. Without this the
					// composer's Layout control only steered the model fallback, which
					// is the path that almost never runs.
					layout: pinnedCardLayout,
					brand: {
						primary: cardGround ?? briefData?.primaryColor,
						secondary: briefData?.secondaryColor
					},
					handle: agentData?.handle ? `@${agentData.handle}` : null
				});
				if (card) {
					try {
						renderedCardUrl = await persistBufferToStorage(
							svcForCard,
							card.buffer,
							userId,
							'png',
							'image/png'
						);
						// $0 by construction — recorded so the ledger/provenance/drawer all
						// say this post's image cost nothing, not that it went unaccounted.
						costEvents.push({
							provider: 'local',
							operation: 'image',
							model: CARD_RENDERER_LABEL,
							usd: 0
						});
					} catch (e) {
						console.warn(
							'[CardRenderer] Persist failed — model path will run:',
							(e as Error).message
						);
						renderedCardUrl = null;
					}
				}
			}
			if (renderedCardUrl) {
				still = renderedCardUrl;
			} else if (falKey) {
				// A card feeds no references, so the pick resolves as text-to-image.
				const cardModel = stillModelId ? resolveModel('image_t2i', stillModelId) : null;
				try {
					still = await generateGraphicStill(
						falKey,
						cardText!,
						scenePrompt,
						brandVisualCtx,
						cardModel
					);
					costEvents.push({
						provider: 'fal',
						operation: 'image',
						// Bill and name the model that RAN — resolveModel already replaced
						// an unknown pick, so this can never claim a model fal never saw.
						model: cardModel ? cardModel.label : NANO_STILL_LABEL,
						usd: cardModel ? cardModel.usd : priceOf('fal', 'image', 'nano')
					});
				} catch (e) {
					const msg = (e as Error).message;
					if (orKey && isFalOutage(msg)) {
						console.warn(
							`[Failover] fal graphic still failed (${msg.slice(0, 120)}) — OpenRouter Nano-Banana t2i fallback.`
						);
						still = await openRouterImageEdit(
							orKey,
							userId,
							buildGraphicStillPrompt(cardText!, scenePrompt, brandVisualCtx),
							[],
							orRoutes.edit
						);
						costEvents.push({
							provider: 'openrouter',
							operation: 'image',
							model: orRoutes.edit.id,
							usd: orRoutes.edit.usd
						});
					} else {
						throw e;
					}
				}
			} else if (orKey) {
				still = await openRouterImageEdit(
					orKey,
					userId,
					buildGraphicStillPrompt(cardText!, scenePrompt, brandVisualCtx),
					[],
					orRoutes.edit
				);
				costEvents.push({
					provider: 'openrouter',
					operation: 'image',
					model: orRoutes.edit.id,
					usd: orRoutes.edit.usd
				});
			} else {
				throw new Error(
					'No media provider configured. Add a Fal AI or OpenRouter key in Settings.'
				);
			}
		} else if (falKey && (productPhoto || characterRef)) {
			// References are being composited, so the pick resolves as an image EDIT
			// model — a t2i id here would drop the refs and invent a new person.
			const compositeModel = stillModelId ? resolveModel('image_edit', stillModelId) : null;
			try {
				still = await generateProductStill(
					falKey,
					scenePrompt,
					productPhoto,
					characterRef,
					brandVisualCtx,
					compositeModel
				);
				costEvents.push({
					provider: 'fal',
					operation: 'image',
					model: compositeModel ? compositeModel.label : NANO_STILL_LABEL,
					usd: compositeModel ? compositeModel.usd : priceOf('fal', 'image', 'nano')
				});
			} catch (e) {
				const msg = (e as Error).message;
				if (orKey && isFalOutage(msg)) {
					// True composite failover: OpenRouter serves the same Nano-Banana
					// model family with image input, so the attached refs stay
					// in-frame — flux text-to-image is only the last resort.
					try {
						const refs = [characterRef, productPhoto].filter(Boolean) as string[];
						console.warn(
							`[Failover] fal still failed (${msg.slice(0, 120)}) — OpenRouter Nano-Banana composite fallback.`
						);
						still = await openRouterImageEdit(
							orKey,
							userId,
							buildCompositeFallbackPrompt(scenePrompt, !!characterRef, !!productPhoto),
							refs,
							orRoutes.edit
						);
						costEvents.push({
							provider: 'openrouter',
							operation: 'image',
							model: orRoutes.edit.id,
							usd: orRoutes.edit.usd
						});
					} catch (editErr) {
						console.warn(
							`[Failover] OpenRouter composite also failed (${(editErr as Error).message.slice(0, 120)}) — flux text-to-image last resort.`
						);
						const t2i = await generateUgcImage(
							scenePrompt,
							orKey,
							null,
							stillModelId,
							'3:4',
							wantCharacterRef,
							orRoutes.t2i
						);
						still = t2i.url;
						costEvents.push({
							provider: t2i.provider,
							operation: 'image',
							model: t2i.model,
							usd: t2i.usd ?? priceOf(t2i.provider, 'image')
						});
					}
				} else {
					throw e;
				}
			}
		} else if (orKey && (productPhoto || characterRef)) {
			// OpenRouter-pinned (or fal-less) WITH refs → real composite via Nano
			// Banana on OpenRouter, not a generic text-to-image scene.
			try {
				const refs = [characterRef, productPhoto].filter(Boolean) as string[];
				still = await openRouterImageEdit(
					orKey,
					userId,
					buildCompositeFallbackPrompt(scenePrompt, !!characterRef, !!productPhoto),
					refs,
					orRoutes.edit
				);
				costEvents.push({
					provider: 'openrouter',
					operation: 'image',
					model: orRoutes.edit.id,
					usd: orRoutes.edit.usd
				});
			} catch (e) {
				console.warn(
					`[Composer] OpenRouter composite failed (${(e as Error).message.slice(0, 120)}) — flux fallback.`
				);
				const t2i = await generateUgcImage(
					scenePrompt,
					orKey,
					null,
					stillModelId,
					'3:4',
					wantCharacterRef,
					orRoutes.t2i
				);
				still = t2i.url;
				costEvents.push({
					provider: t2i.provider,
					operation: 'image',
					model: t2i.model,
					usd: t2i.usd ?? priceOf(t2i.provider, 'image')
				});
			}
		} else {
			// No refs to composite — the pick is a plain text-to-image model, and
			// generateUgcImage resolves it (and bills what it ran) internally.
			const t2i = await generateUgcImage(
				scenePrompt,
				orKey,
				falKey,
				stillModelId,
				'3:4',
				wantCharacterRef,
				orRoutes.t2i
			);
			still = t2i.url;
			costEvents.push({
				provider: t2i.provider,
				operation: 'image',
				model: t2i.model,
				usd: t2i.usd ?? priceOf(t2i.provider, 'image', t2i.provider === 'fal' ? 'flux' : undefined)
			});
		}

		// ── Video — fal primary, OpenRouter video API failover ──────────────
		// Verified 2026-07-04: OpenRouter's /api/v1/videos carries Kling v3.0, so a
		// fal outage degrades b-roll to OpenRouter Kling instead of an image-only
		// post. Spokesperson (TTS + talking-head) is fal-exclusive — on outage it
		// degrades to OpenRouter b-roll format rather than failing the slot.
		const brollModel = resolveModel('video_i2v', input.videoModel);
		// An unknown id can never reach fal: resolveModel falls back to the kind's
		// default rather than posting a slug the provider has never heard of.
		const talkingHeadModel = resolveModel('talking_head', input.talkingHeadModel);
		let mediaUrl = still;
		let mediaType: 'image' | 'video' = 'image';
		// The i2v model that ACTUALLY produced the clip (null = none ran: image-only
		// posts and talking-head runs). Recorded in selections so the drawer's
		// "Video model" line names the run, not the request — failovers included.
		let videoModelRan: string | null = null;
		// The v2v endpoint this run SET OUT to drive, kept even when the run ends up
		// on the i2v fallback — otherwise a composer that pinned no model at all
		// would leave the record with no trace that a performance transfer was
		// asked for, and the fallback clip would read as a plain b-roll request.
		let v2vModelRequested: string | null = null;
		// The image actually SENT to the v2v endpoint: a FULL-BODY reference, not
		// the bust-crop characterRef the rest of the pipeline composites from. The
		// images block below must name the file that left the app.
		let v2vReferenceSent: string | null = null;
		// The transfer's own record, and the whole of the truth contract for this
		// stage: it is assigned ONLY after the v2v endpoint returned a clip, and
		// cleared by every path that then replaces that clip with an i2v one. Its
		// mere PRESENCE in the stored provenance is the claim "a performance
		// transfer produced this video", so a run that fell back must leave it null
		// rather than record it with a failure flag — a reader filtering on
		// `generation.v2v` would otherwise count the fallbacks as transfers.
		let v2vTransfer: NonNullable<GenerationProvenance['v2v']> | null = null;
		// A motion card this host could not animate. Recorded so the post explains
		// why a video format shipped a still.
		let motionCardDegraded = false;
		// Resolved BEFORE the video branch: the locally assembled formats produce a
		// Buffer, and a Buffer has to reach storage before captions or the client
		// can fetch it. Same getter the persist block below uses.
		const svc = (() => {
			try {
				return getServiceSupabase();
			} catch {
				return null; // No service-role key configured at all.
			}
		})();
		if (wantVideo && (falKey || orKey)) {
			try {
				if (
					(format === 'v2v_replace' ||
						format === 'v2v_move' ||
						// The narrated remake's first stage IS this transfer — everything
						// that separates it from Replace happens after the clip exists
						// (TTS was already launched above; the mux runs below). Branching it
						// off into its own copy of this block is how the two would drift.
						format === 'v2v_narrated') &&
					falKey &&
					sourceVideoUrl
				) {
					// ── Performance transfer: the source clip IS the direction ──
					// Everything this stage needs that the brief cannot supply: the
					// ingested clip, and a FULL-BODY reference of the persona. The still
					// generated above is not an input here at all — it stays as the
					// poster, and as the anchor the never-brick i2v fallback runs from.
					// Narrated inherits 'replace' from the default arm on purpose: a
					// remake keeps the SOURCE clip's scene, and 'move' would put the
					// persona back in their own scene — a different product entirely.
					const mode = format === 'v2v_move' ? 'move' : 'replace';
					// The FORMAT chooses the endpoint, never the model dropdown: replace
					// and move are two different transfers with two different outputs
					// (replace inherits the SOURCE's scene and aspect; move keeps the
					// reference's). Running the picked model when it disagrees with the
					// requested transfer would deliver a clip the record cannot describe.
					const v2vModel =
						MODEL_CATALOG.find((m) => m.kind === 'video_v2v' && m.id.endsWith(`/${mode}`)) ??
						resolveModel('video_v2v', input.videoModel);
					v2vModelRequested = v2vModel.id;
					// The adapter riding on this request was probed for the i2v stage. It
					// is usable here ONLY when it names a source-clip param and belongs to
					// the id we are about to run — otherwise it would drive this endpoint
					// with another model's param names, which is a 422 seven minutes in.
					const v2vAdapter =
						input.videoAdapter?.video && input.videoModel === v2vModel.id
							? input.videoAdapter
							: undefined;
					try {
						const fullBody = await resolveFullBodyReference(
							supabase,
							userId,
							input.agentId,
							cfg.referenceKit,
							characterRef,
							falKey,
							voiceGender
						);
						v2vReferenceSent = fullBody;
						mediaUrl = await generateV2vVideo(
							falKey,
							v2vModel.id,
							sourceVideoUrl,
							fullBody,
							motionPrompt,
							v2vAdapter
						);
						videoModelRan = v2vModel.id;
						// ── Metering: a PER-SECOND rate, multiplied here ──
						// priceOf() and every other cost site in this file quote a per-CALL
						// number; this model's catalog `usd` is a per-SECOND rate (models.ts
						// `billing: 'per_second'`, pricing.ts's "per source second" row), and
						// priceOf's signature has nowhere to put a multiplier. So the
						// multiplication happens at the call site — guarded on the model's own
						// declared basis, so a catalog edit back to a flat price can never
						// silently multiply a per-call rate by the clip length. Billing a flat
						// rate instead would make a 20-second transfer a near-free path the
						// moment credits_mode=enforce.
						// The catalog rate, NEVER input.videoModelUsd: that number is resolved
						// against the `video_i2v` registry kind by the caller, so on a v2v
						// request it carries the i2v DEFAULT's per-CALL price (~$0.42).
						// Multiplying that by the clip length would bill a 10-second remake
						// at $4.20 instead of $0.60 — a 7x overcharge that would look like a
						// price, not a bug. A registry override for this stage needs the
						// caller to resolve it as 'video_v2v' first.
						const perSecond = v2vModel.usd;
						const billedSeconds = v2vBillableSeconds(input.sourceSeconds);
						costEvents.push({
							provider: 'fal',
							operation: 'video',
							// The basis rides in the label: a $0.90 video row against a $0.06
							// catalog price is otherwise unexplainable in the ledger.
							model: `${v2vModel.label} (${billedSeconds}s source @ $${perSecond}/s)`,
							usd:
								v2vModel.billing === 'per_second'
									? +(perSecond * billedSeconds).toFixed(6)
									: perSecond
						});
						// Built from the SAME two locals the ledger row above was computed
						// from, deliberately: a provenance block that called
						// v2vBillableSeconds() a second time would be a second answer to
						// "what was billed", and the two would disagree the first time
						// either the clamp or the assumed-duration rule changed — which is
						// exactly the unauditable per-second charge this block exists to
						// prevent.
						v2vTransfer = {
							mode,
							source_video: sourceVideoUrl,
							resolution: V2V_RESOLUTION,
							// The full-body kit shot, never the pinned bust crop — see
							// resolveFullBodyReference. A bad output is only diagnosable if the
							// record names the image that actually left the app.
							reference: fullBody,
							// Mirrors the cost event's own guard: under a flat catalog price
							// nothing is billed per second, and publishing a rate × duration
							// the ledger never charged is a bill nobody can reconcile.
							...(v2vModel.billing === 'per_second'
								? { billed_seconds: billedSeconds, usd_per_second: perSecond }
								: {})
						};
					} catch (v2vErr) {
						const v2vMsg = (v2vErr as Error).message ?? '';
						// A spend refusal is fail-closed everywhere in this file — falling
						// back here would spend MORE money on the very run the cap rejected.
						if (isCreditsError(v2vErr) || /budget/i.test(v2vMsg)) throw v2vErr;
						// Never-brick: a failed transfer (no full-body reference, a source
						// clip fal could not fetch, a job past its deadline) still ships the
						// clip this still would have produced. The RECORD becomes 'broll'
						// because that is what the viewer watches — the truth contract is
						// about what ran, and a post claiming a performance transfer it did
						// not perform is the exact lie that contract exists to prevent.
						console.warn(
							`[generate] v2v ${mode} failed (${v2vMsg.slice(0, 160)}) — falling back to the i2v b-roll clip.`
						);
						// A narrated remake keeps its narration through this rung: the voice
						// never depended on the transfer, so the fallback clip still gets the
						// voiceover mixed under it by the vo_broll block below, and only a
						// mux failure after that drops it to silent 'broll'.
						format = format === 'v2v_narrated' ? 'vo_broll' : 'broll';
						v2vReferenceSent = null;
						// Belt to the "only assigned on success" brace: nothing above can
						// have set it on this path, and clearing it here is what keeps that
						// true if the try block ever grows a second failure point.
						v2vTransfer = null;
						// falKey is non-null by this branch's own condition. If the i2v
						// fallback ALSO fails it throws on into the outer catch, which owns
						// the OpenRouter failover — one more rung, not a dead end.
						mediaUrl = await generateBrollVideo(falKey, brollModel.id, still, motionPrompt);
						videoModelRan = brollModel.id;
						costEvents.push({
							provider: 'fal',
							operation: 'video',
							model: brollModel.label,
							usd: brollModel.usd
						});
					}
				} else if ((format === 'spokesperson' || format === 'listicle') && falKey) {
					// A listicle IS a spokesperson at this stage: same still, same
					// lip-sync model, same price. Everything that makes it a listicle
					// already happened (the voiceover arrives as one joined track with
					// measured beat offsets) or happens after (the reveals are burned on
					// below), so branching it off here would be a second copy of this
					// call that could only ever drift from it.
					// TTS was launched in parallel with the still (see spokenAudio above) —
					// non-null here because this branch's condition matches its launch
					// condition. A TTS failure rethrows HERE so the fal-outage fallback
					// below still degrades the post to OpenRouter b-roll.
					const settledAudio = await spokenAudio!;
					if ('err' in settledAudio) throw settledAudio.err;
					mediaUrl = await generateTalkingHead(
						falKey,
						still,
						settledAudio.url,
						talkingHeadModel.id
					);
					costEvents.push({
						provider: 'fal',
						operation: 'talking_head',
						// Bill the model that RAN. Kling AI-Avatar is 40% of OmniHuman's
						// price; charging the default rate for it would overcharge exactly
						// the users who chose to spend less.
						model: talkingHeadModel.id,
						usd: talkingHeadModel.usd
					});
				} else if (format === 'motion_card') {
					// The card is already typeset by our own renderer, so animating it is a
					// local ffmpeg pass — the only video format in the product that costs
					// nothing beyond the Director. No cost event: no provider was called.
					const motion = await stillToMotion(still);
					if (motion && svc) {
						mediaUrl = await persistBufferToStorage(svc, motion, userId, 'mp4', 'video/mp4');
					} else {
						// ffmpeg missing, or no bucket to put a Buffer in. The composer hides
						// this format on a host without ffmpeg, so this is the belt to that
						// braces: deliver the card as a still rather than failing a run the
						// user already approved, and let the record say what shipped.
						console.warn(
							'[generate] motion_card could not be assembled locally — delivering the still card.'
						);
						motionCardDegraded = true;
					}
				} else if ((format === 'broll' || format === 'vo_broll') && falKey) {
					// The user picked this tier in the composer (Wan $0.10 → Veo $1.50); bill
					// what actually ran rather than a hard-coded Kling Standard rate.
					// With an adapter, run the REQUESTED id: resolveModel() only knows the
					// static catalog, so a swapped-in discovered model used to silently
					// resolve to the default here — the swap never actually ran.
					const runModelId =
						input.videoAdapter && input.videoModel ? input.videoModel : brollModel.id;
					mediaUrl = await generateBrollVideo(
						falKey,
						runModelId,
						still,
						motionPrompt,
						input.videoAdapter ?? undefined
					);
					videoModelRan = runModelId;
					costEvents.push({
						provider: 'fal',
						operation: 'video',
						model: input.videoAdapter && input.videoModel ? runModelId : brollModel.label,
						// Bill the model that RAN. A discovered model with no adapter falls
						// back to the catalog default — billing the requested model's price
						// there would charge for a model that never executed.
						usd:
							runModelId === input.videoModel
								? (input.videoModelUsd ?? brollModel.usd)
								: brollModel.usd
					});
				} else {
					// No fal at all — straight to OpenRouter video. TTS + talking head are
					// fal-exclusive, so a spokesperson request runs as b-roll here — record
					// that, or the post would claim a talking head the viewer never gets.
					// The same holds for a performance transfer: OpenRouter's video API is
					// image-to-video only, so the source clip is not re-performed at all.
					// (motion_card can't reach here — it is handled above whether or not
					// there is a key, since it calls no provider at all.)
					if (format !== 'vo_broll') format = 'broll';
					mediaUrl = await openRouterBrollVideo(
						orKey!,
						userId,
						still,
						motionPrompt,
						undefined,
						orRoutes.video
					);
					videoModelRan = orRoutes.video.id;
					costEvents.push({
						provider: 'openrouter',
						operation: 'video',
						model: orRoutes.video.id,
						usd: orRoutes.video.usd
					});
				}
				if ((format === 'vo_broll' || format === 'v2v_narrated') && mediaUrl !== still) {
					// The clip exists; now lay the persona's voice under it. A failure here
					// must NOT lose the clip that was just paid for, so it degrades to the
					// silent version — and the recorded format becomes 'broll', because
					// what the viewer actually watches is what the record has to say.
					// The narrated remake shares this tail rather than owning a copy: same
					// TTS promise, same mux, same degradation — the only differences are
					// the duration policy and which silent format it falls back to.
					const narratedRemake = format === 'v2v_narrated';
					const settled = spokenAudio ? await spokenAudio : null;
					const mixed =
						settled && !('err' in settled)
							? await muxVoiceover(mediaUrl, settled.url, {
									// A transferred clip is billed per SOURCE second, so the
									// default 'audio' policy — which trims the video down to the
									// narration — would throw away seconds the user was charged
									// for whenever the line runs short. 'longest' cuts neither
									// side. B-roll keeps the default: its clip is a fixed ~5s
									// nobody paid for by the second.
									...(narratedRemake ? { keep: 'longest' as const } : {})
								}).catch(() => null)
							: null;
					if (mixed && svc) {
						mediaUrl = await persistBufferToStorage(svc, mixed, userId, 'mp4', 'video/mp4');
					} else {
						console.warn(
							`[generate] ${format} narration could not be mixed — delivering the ${
								narratedRemake ? 'transferred clip without narration' : 'silent clip'
							}.`
						);
						// What ships on a lost mux is a silent performance transfer, which is
						// precisely the Replace format — so that is what the record says, and
						// v2vTransfer stays: the transfer really did run and was really paid
						// for. Only the local, $0 stage was lost.
						format = narratedRemake ? 'v2v_replace' : 'broll';
					}
				}
				// A motion card this host could not animate ships as the still it already
				// is; every other path through this branch produced a clip.
				mediaType = motionCardDegraded ? 'image' : 'video';
			} catch (e) {
				const msg = (e as Error).message;
				if (orKey && isFalOutage(msg)) {
					console.warn(
						`[Failover] fal video failed (${msg.slice(0, 120)}) — OpenRouter Kling b-roll fallback.`
					);
					// The delivered clip is silent b-roll whatever was requested — the
					// recorded format must describe what the viewer actually watches.
					if (format !== 'broll') format = 'broll';
					// The clip about to ship comes from an image-to-video model, so nothing
					// of a transfer survives into the record — including a transfer that HAD
					// succeeded before a later step in the same try block threw us here. The
					// spend stays in the ledger (it was really incurred); the claim does not.
					v2vTransfer = null;
					v2vReferenceSent = null;
					mediaUrl = await openRouterBrollVideo(
						orKey,
						userId,
						still,
						motionPrompt,
						undefined,
						orRoutes.video
					);
					videoModelRan = orRoutes.video.id;
					costEvents.push({
						provider: 'openrouter',
						operation: 'video',
						model: orRoutes.video.id,
						usd: orRoutes.video.usd
					});
					mediaType = 'video';
				} else {
					throw e;
				}
			}
		}

		// ── Burn captions + AI badge, then persist to durable storage ──
		// Every generation MUST be archived in our own bucket so the paid-for media
		// survives provider URL expiry. If we own storage (service key present) a
		// persist failure is LOUD — we throw rather than store an ephemeral provider
		// URL that will 404 later (the exact bug that lost earlier videos).
		let durableStill = still;
		let durableMedia = mediaUrl;
		// Did ffmpeg actually burn the requested caption/badge overlay? burnCaptions
		// returns null when it no-ops (nothing requested) OR silently can't run (no
		// ffmpeg/font in the deploy image, or the video fetch failed) — in which case
		// the clean original is kept. We record the ACTUAL outcome below, not the
		// request, so the post's observability never claims a burn that didn't happen.
		let captionsApplied = false;
		if (svc) {
			durableStill = await persistToStorage(svc, still, userId, 'png');
			if (mediaType === 'video') {
				// Captions and the AI badge are BOTH opt-in and independent. With neither,
				// burnCaptions no-ops and the clean original video is kept.
				const captioned = await burnCaptions(mediaUrl, {
					badge: input.aiBadge,
					hook: input.captions ? parsed.on_screen_text : '',
					// The track is NOT gated on `input.captions`. The hook is an optional
					// overlay on any clip; the numbered reveals ARE the listicle, and a
					// listicle that ships without them is a talking head reading numbers
					// off a page nobody sees — the exact thing the format's ffmpeg
					// requirement exists to refuse.
					// Gated on `format` as well as on the track because a run that fell
					// back to a 5-second b-roll clip (fal outage) still holds the offsets
					// measured for a 20-second narration, and burning those onto it would
					// dump the whole list on the first frame.
					...(format === 'listicle' && listicleTrack ? { track: listicleTrack } : {})
				}).catch(() => null);
				captionsApplied = captioned != null;
				durableMedia = captioned
					? await persistBufferToStorage(svc, captioned, userId, 'mp4', 'video/mp4')
					: await persistVideoDurable(svc, mediaUrl, userId);
			} else {
				durableMedia = durableStill;
			}
		} else {
			console.warn(
				'[generate] No service-role Supabase key configured — storing EPHEMERAL provider URLs (media is NOT backed up).'
			);
		}

		// ── The listicle's truth test ───────────────────────────────────────
		// A listicle is only a listicle if the reveals reached the file. Both halves
		// have to have happened: the segments had to be measurable (listicleTrack)
		// AND the burn had to run (captionsApplied — null from burnCaptions on a
		// host with no ffmpeg or no font, or on a fetch failure). Either one missing
		// and what ships is a talking head speaking a list with nothing on screen,
		// so the record says 'spokesperson' — the same rule a lost mux follows when
		// it records 'broll'. `generation.listicle.assembled` below is what keeps
		// the downgrade explainable rather than merely silent — and it is a field of
		// its own, not `motion_assembled`, because THIS run still shipped a video.
		const listicleAssembled = format === 'listicle' && Boolean(listicleTrack) && captionsApplied;
		if (format === 'listicle' && !listicleAssembled) {
			console.warn(
				'[Listicle] reveals were not burned onto the clip — recording this post as a spokesperson.'
			);
			format = 'spokesperson';
		}

		// Record durable asset URLs in the ledger (flushed in finally) so this spend
		// is always recoverable from the DB even if a later step throws.
		if (durableMedia)
			costEvents.push({
				provider: 'storage',
				operation: 'persist',
				model: 'ugc-media',
				usd: 0,
				assetUrl: durableMedia
			});
		if (durableStill && durableStill !== durableMedia)
			costEvents.push({
				provider: 'storage',
				operation: 'persist',
				model: 'ugc-media',
				usd: 0,
				assetUrl: durableStill
			});

		const content: UgcContent = {
			text: parsed.text || '',
			hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
			hookScore: parsed.hookScore,
			// The line that was actually SPOKEN — a pinned script must be what the
			// post records, or the drawer would show a script nobody said. On a
			// listicle that is every beat, not just the framing line: the framing line
			// alone would show a fifth of what the voice said.
			dialogue: spokenScript || pinnedLine || parsed.dialogue || '',
			on_screen_text: parsed.on_screen_text || '',
			// Actual burn outcome (see captionsApplied) — not merely what was requested.
			// The caption flag ALSO requires real hook text: a badge-only burn returns a
			// buffer too, so gating on captionsApplied alone would falsely claim a caption
			// when on_screen_text was empty. Observability must reflect what was drawn.
			captions:
				Boolean(input.captions) && captionsApplied && Boolean((parsed.on_screen_text || '').trim()),
			ai_badge: Boolean(input.aiBadge) && captionsApplied,
			// The prompt ACTUALLY sent to the image model — scenePrompt already resolves
			// the composer's scene override over the Director's scene_prompt, so storing
			// the raw Director output here would show (and refine from) a prompt that
			// never ran whenever the user pinned a scene.
			ugc_broll_prompt: scenePrompt,
			script: spokenScript || pinnedLine || parsed.script || parsed.dialogue || '',
			// Kept whenever the beats were spoken, INCLUDING a run that degraded to a
			// single blob — the words were said either way. `format` says whether they
			// were also shown.
			...(listicleBeats ? { list_items: listItems } : {}),
			media_url: durableMedia,
			poster_url: durableStill,
			media_type: mediaType,
			media_generated: true,
			format,
			// The voice that actually spoke (TTS can degrade to a classic fallback) —
			// never the merely-requested one.
			voice: ttsVoiceUsed,
			product: selectedProduct
				? {
						name: selectedProduct.name,
						price: selectedProduct.price,
						description: selectedProduct.description
					}
				: null,
			platform,
			qualityGrade,
			qc_status: qualityGrade ? 'graded' : 'ungraded',
			costBreakdown: summarizeCosts(costEvents)
		};
		if (input.autopilot) content.autopilot = true;

		// Observability record: exactly which models ran for which aspect, what each
		// aspect cost, the input images actually SENT, the prompts, and the selections
		// made — so the post drawer can show what produced this result and why.
		content.generation = {
			...summarizeAspects(costEvents),
			// The images actually SENT to a model. A supplied still means none were:
			// claiming refs here would show the drawer inputs that never left the app.
			// A v2v run is the one path whose character reference is NOT the pinned
			// bust crop — the full-body kit shot is what left the app, so that is what
			// this names (and it is null again when the transfer fell back to i2v).
			images: suppliedStill
				? { character_ref: null, product_photo: null }
				: {
						character_ref: v2vReferenceSent || characterRef || null,
						product_photo: productPhoto || null
					},
			// The composition contract this run obeyed. Refine honors it (a null ref
			// under policy=false is deliberate, not lost provenance), and the drawer
			// can say WHY a ref is absent.
			still_style: isGraphicStill ? 'graphic' : 'photo',
			refs_policy: { character: wantCharacterRef, product: wantProductRef },
			// Only claim a typeset line when one was actually typeset: a supplied
			// still replaced the card, so no card text was rendered on this post.
			...(isGraphicStill && cardText && !suppliedStill ? { card_text: cardText } : {}),
			// Where the still came from, so the drawer can explain a $0 image row
			// that has no image model behind it at all.
			...(suppliedStill ? { still_source: 'supplied' as const } : {}),
			// A motion card that shipped as a still: a VIDEO format that produced an
			// IMAGE. Nothing else may borrow this flag — a listicle degradation is a
			// different event entirely (the clip shipped; the reveals didn't), and
			// one boolean covering both would leave a reader unable to say which
			// happened. The listicle records its own, below.
			...(motionCardDegraded ? { motion_assembled: false as const } : {}),
			// The list, present ONLY on a run that still meant to be a listicle when
			// it reached the video stage — `listicleRequested` is captured after
			// every composition coercion, so a request that lost its items to a bad
			// Director response, or was ruled out for a graphic still, carries no
			// block at all rather than an empty one claiming a list that never
			// existed. `assembled` then separates "the reveals were burned" from
			// "the items were spoken and never shown".
			// `beats` is COUNTED FROM THE LEDGER, not from listicleBeats.length: the
			// quote bills one voiceover per beat, and the degraded path buys the
			// segments that landed plus a whole-script blob on top. Recomputing the
			// intended count here would print a number the invoice contradicts.
			...(listicleRequested
				? {
						listicle: {
							items: listItems.map((i) => i.label),
							beats: costEvents.filter((e) => e.operation === 'tts').length,
							assembled: listicleAssembled
						}
					}
				: {}),
			// Present ONLY when the v2v provider actually produced the clip that
			// shipped. Every path that substitutes an i2v clip nulls v2vTransfer, so
			// this spread is the difference between "a transfer was requested" (which
			// lives in selections.videoModelRequested) and "a transfer ran".
			...(v2vTransfer ? { v2v: v2vTransfer } : {}),
			...(isGraphicStill && input.cardLayout && input.cardLayout !== 'auto'
				? { card_layout: input.cardLayout }
				: {}),
			// When TTS degraded to the classic fallback, say so — the post's voice
			// field alone can't explain why it differs from the persona's pick.
			...(ttsVoiceUsed !== resolvedVoice
				? { voice_fallback: { requested: resolvedVoice, used: ttsVoiceUsed } }
				: {}),
			prompts: { scene: scenePrompt, script: content.script },
			selections: {
				platforms: [platform],
				brand: briefData?.name ?? briefData?.brandName ?? briefData?.data?.brandName ?? null,
				// The i2v model that RAN (null when none did: image posts, talking heads).
				// The request is kept separately so a failover stays explainable.
				videoModel: videoModelRan,
				// What was asked for, when it differs from what ran. The v2v endpoint is
				// included because a transfer that fell back to i2v is otherwise
				// indistinguishable from a plain b-roll request in this record — and the
				// composer need not have pinned any model for a transfer to be requested.
				...(input.videoModel && input.videoModel !== videoModelRan
					? { videoModelRequested: input.videoModel }
					: v2vModelRequested && v2vModelRequested !== videoModelRan
						? { videoModelRequested: v2vModelRequested }
						: {}),
				// The still model REQUESTED. What ran is in aspects.image.models,
				// derived from the ledger — recording a second "what ran" here is how
				// the two would eventually disagree.
				...(stillModelId ? { stillModelRequested: stillModelId } : {}),
				...(input.talkingHeadModel ? { talkingHeadModel: input.talkingHeadModel } : {}),
				...(input.llmModel ? { llmModel: input.llmModel } : {}),
				...(input.framing ? { framing: input.framing } : {}),
				provider: input.providerPreference ?? null,
				mediaType
			}
		};

		// Advisory, last, and unable to change anything above it — see judgeDraftFit.
		const fit = await judgeDraftFit({
			supabase,
			userId,
			agentId: input.agentId,
			postId: input.postId,
			ai: rawAi,
			agent: agentData,
			content
		});
		if (fit.fit_score !== null) {
			content.fit_score = fit.fit_score;
			if (fit.fit_notes) content.fit_notes = fit.fit_notes;
		}

		return { content, selectedProduct, briefData, agentData };
	} finally {
		// Flush the ledger even if generation threw partway through — otherwise
		// every failed/retried generation is silent spend the cap never sees.
		await recordCostEvents(supabase, userId, input.agentId, costEvents, input.postId);
	}
}

// ── Refine: regenerate ONLY the media from a user-edited prompt ──────────────

export interface RefineMediaInput {
	supabase: any;
	userId: string;
	agentId?: string;
	/** The post being refined — links the refine spend to it in the ledger. */
	postId?: string;
	/** The post's current content record — caption, voice, format and refs are all kept. */
	content: UgcContent;
	/** User-edited visual prompt. Replaces the stored scene prompt VERBATIM. */
	scene: string;
	/** Optionally edited spoken line (spokesperson posts). Blank → keep the stored one. */
	dialogue?: string;
	/** Re-typeset a graphic card with a different line. Same sanitizeCardText gate
	 *  as a fresh run; a rejected line keeps the post's stored card text. */
	cardText?: string;
	/** Pins the card composition for this re-render ('auto'/absent = the shape
	 *  heuristic). Same vocabulary as UgcPackInput.cardLayout. */
	cardLayout?: 'auto' | 'statement' | 'quote' | 'stack' | 'list' | 'split';
	/** Card ground hex — the only palette identifier resolveCardPalette accepts.
	 *  Absent keeps the brand-derived look, so an unchanged line re-renders
	 *  byte-identical. */
	cardPalette?: string;
	/** Realism register spliced onto the edited visual brief (photo posts). */
	framing?: 'front' | 'mirror' | 'third';
	/** Voice for this re-record. Unknown names keep the post's stored voice —
	 *  a refine must never introduce a voice the original post never had. */
	voiceOverride?: string;
	/** Lip-sync model for the re-run, resolved through resolveModel('talking_head').
	 *  Absent keeps the model the post was originally made with. */
	talkingHeadModel?: string;
	/** Image model for the re-shot still, resolved through resolveModel(). */
	stillModel?: string;
	/** Replace the still with a supplied http(s) image instead of re-shooting it:
	 *  no image model runs and no still cost event is recorded. */
	stillUrlOverride?: string;
}

/** The OpenRouter Nano-Banana composite prompt (fal-outage fallback), shared verbatim with generateUgcPack's failover. */
function buildCompositeFallbackPrompt(
	scenePrompt: string,
	hasCharacter: boolean,
	hasProduct: boolean = true
): string {
	return `${scenePrompt}\n\nVertical 9:16 photorealistic UGC photo.${hasProduct ? " Keep the product's exact label, shape and colors from the reference image — do not redesign it." : ''}${hasCharacter ? ' Keep the same person/face as the first reference image.' : ''} Authentic, slightly imperfect, real — not a studio ad.`;
}

/**
 * Refine pass for an existing draft: the Director does NOT run again — the
 * user's edited visual prompt is the script now. Everything that made the post
 * consistent is reused from its stored provenance record (pinned face,
 * product photo, voice, spokesperson-vs-broll format, video-model pick,
 * caption/badge burn choices), and only the media is regenerated:
 *   still (Nano Banana composite) → TTS + talking head, or b-roll clip.
 * Caption, hashtags, platforms and schedule are untouched; the returned
 * content merges the refine spend into the post's cost/provenance record so
 * observability keeps telling the truth about total spend.
 */
export async function refineUgcMedia(input: RefineMediaInput): Promise<UgcContent> {
	const { supabase, userId, content } = input;
	const rawScene = input.scene?.trim();
	if (!rawScene) throw new Error('Refine needs a visual prompt');
	// Same still-model contract as generateUgcPack: keep the raw id and resolve it
	// per branch, so absent means "the compiled-in Nano Banana routing" rather than
	// resolveModel's t2i default.
	const stillModelId = input.stillModel?.trim() || null;
	// "Use my own still" on a refine: swap the image without paying to re-shoot it.
	const suppliedStill = suppliedStillUrl(input.stillUrlOverride);
	// Cinematic posts are multi-shot Kling O3 Pro reference videos — this
	// single-shot pipeline would silently downgrade them. The route rejects
	// these up front; this is the defense-in-depth backstop.
	if ((content as any).cinematic === true) {
		throw new Error('Cinematic multi-shot posts cannot be refined through the standard pipeline.');
	}

	// Same fail-closed spend guard as a fresh generation — a refine is paid media.
	await assertWithinBudget(supabase, userId, input.agentId);
	const costEvents: CostEvent[] = [];
	try {
		const { orKey, falKey, orRoutes, falRoutes } = await resolveImageKeys(supabase, userId);
		if (!falKey && !orKey) {
			throw new Error('No media provider configured. Add a Fal AI or OpenRouter key in Settings.');
		}

		// The refs that actually produced this post — preferred over the persona's
		// CURRENT pins, which may have changed since (same rule the drawer's
		// observability panel follows). Posts that predate full provenance capture
		// have no stored refs, and regenerating with NONE would invent a brand-new
		// person / generic product — the exact drift the anchors exist to prevent —
		// so those fall back to the persona's pinned face and the brief's photo for
		// the product this post was made for.
		// BUT: a null under refs_policy=false is DELIBERATE ("no product in this
		// composition"), not lost provenance — backfilling it would composite a
		// product into a product-free post. Only refs the policy allows get filled.
		const gen: any = (content as any).generation || {};
		const refsPolicy = {
			character: gen.refs_policy?.character !== false,
			product: gen.refs_policy?.product !== false
		};
		const isGraphicRefine = gen.still_style === 'graphic';
		// The composer's register pins compose ONTO the user's edited brief rather
		// than replacing it, and they're mutually exclusive by medium: a card has no
		// camera to frame, a photo has no typographic layout.
		const scene = isGraphicRefine
			? withCardLayout(rawScene, input.cardLayout)
			: withFraming(rawScene, input.framing);
		// A refine re-renders an approved card. Keep the layout it was generated
		// with unless this refine pins a different one, so re-running for a better
		// image doesn't silently re-shape the card the user already signed off.
		const storedCardLayout = (content.generation as any)?.card_layout as CardLayout | undefined;
		const refineCardLayout: CardLayout | null =
			input.cardLayout && input.cardLayout !== 'auto'
				? input.cardLayout
				: (storedCardLayout ?? null);
		let characterRef = content.generation?.images?.character_ref || null;
		let productPhoto = content.generation?.images?.product_photo || null;
		if (
			!isGraphicRefine &&
			((!characterRef && refsPolicy.character) || (!productPhoto && refsPolicy.product))
		) {
			const cfg = await loadUgcConfig(supabase, input.agentId);
			if (!characterRef && refsPolicy.character) characterRef = cfg.characterRef;
			if (!productPhoto && refsPolicy.product) {
				const brief = await loadBriefForAgent(createDbService(supabase), userId, cfg.brandBriefId);
				const products = Array.isArray(brief?.data?.products) ? brief.data.products : [];
				const byName = content.product?.name
					? products.find((p: any) => p.name === content.product?.name && p.photoUrl)
					: null;
				productPhoto = byName?.photoUrl || products.find((p: any) => p.photoUrl)?.photoUrl || null;
			}
		}

		// ── Still — identical routing/failover to generateUgcPack ──
		// The line this refine actually typeset (null when no card was rendered) —
		// the post's stored card_text is stale the moment the user retypes it.
		let renderedCardText: string | null = null;
		let still: string;
		if (suppliedStill) {
			// A supplied still is the whole still step: no model runs, so no still
			// cost event is recorded, and the video branch below re-animates it
			// exactly as it would a re-shot one.
			still = suppliedStill;
		} else if (isGraphicRefine) {
			// Re-render the typographic card: the stored line is the artwork, the
			// user's edited visual prompt is the art direction. No references.
			const storedCardText = String(
				gen.card_text || String(content.text || '').split('\n')[0] || ''
			)
				.trim()
				.slice(0, 220);
			// A retyped line passes the same glyph gate a fresh run applies; a line
			// the font can't draw keeps the stored one rather than failing a refine
			// the user is already paying for.
			const retypedCardText = (() => {
				const raw = input.cardText?.trim().slice(0, 220);
				if (!raw) return null;
				if (sanitizeCardText(raw)) return raw;
				console.warn('[Refine] Pinned card text lost too many glyphs — keeping the stored line.');
				return null;
			})();
			const cardText = retypedCardText ?? storedCardText;
			if (!cardText) throw new Error('This graphic card has no stored text to re-render.');
			renderedCardText = cardText;
			// ── $0 deterministic re-render first — same contract as the original
			// generation, so a free card stays free through refine. Palette derives
			// from text + brand, so an unchanged line keeps its exact look; brand
			// colors and the handle credit are re-read best-effort (they're cosmetic,
			// so a read failure renders on the curated palette rather than billing
			// the model path).
			let renderedCardUrl: string | null = null;
			const svcForCard = (() => {
				try {
					return getServiceSupabase();
				} catch {
					return null;
				}
			})();
			if (svcForCard) {
				let cardBrand: { primary?: string | null; secondary?: string | null } | null = null;
				let cardHandle: string | null = null;
				try {
					const cfg = await loadUgcConfig(supabase, input.agentId);
					const db = createDbService(supabase);
					const brief = await loadBriefForAgent(db, userId, cfg.brandBriefId);
					cardBrand = brief?.data
						? { primary: brief.data.primaryColor, secondary: brief.data.secondaryColor }
						: null;
					const agentRow = input.agentId ? (await db.agents.get(input.agentId)).data : null;
					cardHandle = agentRow?.handle ? `@${agentRow.handle}` : null;
				} catch {
					/* cosmetic only — curated palette still renders */
				}
				// A pinned ground overrides the brand's, through the one identifier
				// resolveCardPalette accepts; the ink still derives from its luminance.
				const cardGround = cardGroundOverride(input.cardPalette);
				const card = await renderTypographicCard({
					cardText,
					artDirection: scene,
					// Reuse the layout this post was generated with, so a refine does not
					// silently re-shape a card the user already approved.
					layout: refineCardLayout,
					brand: cardGround ? { ...(cardBrand ?? {}), primary: cardGround } : cardBrand,
					handle: cardHandle
				});
				if (card) {
					try {
						renderedCardUrl = await persistBufferToStorage(
							svcForCard,
							card.buffer,
							userId,
							'png',
							'image/png'
						);
						costEvents.push({
							provider: 'local',
							operation: 'image',
							model: CARD_RENDERER_LABEL,
							usd: 0
						});
					} catch (e) {
						console.warn(
							'[CardRenderer] Refine persist failed — model path will run:',
							(e as Error).message
						);
						renderedCardUrl = null;
					}
				}
			}
			if (renderedCardUrl) {
				still = renderedCardUrl;
			} else if (falKey) {
				// A card feeds no references, so the pick resolves as text-to-image.
				const cardModel = stillModelId ? resolveModel('image_t2i', stillModelId) : null;
				try {
					still = await generateGraphicStill(falKey, cardText, scene, undefined, cardModel);
					costEvents.push({
						provider: 'fal',
						operation: 'image',
						// Bill and name what ran — resolveModel already replaced an
						// unknown pick, so this can't claim a model fal never saw.
						model: cardModel ? cardModel.label : NANO_STILL_LABEL,
						usd: cardModel ? cardModel.usd : priceOf('fal', 'image', 'nano')
					});
				} catch (e) {
					const msg = (e as Error).message;
					if (orKey && isFalOutage(msg)) {
						console.warn(
							`[Refine] fal graphic still failed (${msg.slice(0, 120)}) — OpenRouter t2i fallback.`
						);
						still = await openRouterImageEdit(
							orKey,
							userId,
							buildGraphicStillPrompt(cardText, scene),
							[],
							orRoutes.edit
						);
						costEvents.push({
							provider: 'openrouter',
							operation: 'image',
							model: orRoutes.edit.id,
							usd: orRoutes.edit.usd
						});
					} else {
						throw e;
					}
				}
			} else if (orKey) {
				still = await openRouterImageEdit(
					orKey,
					userId,
					buildGraphicStillPrompt(cardText, scene),
					[],
					orRoutes.edit
				);
				costEvents.push({
					provider: 'openrouter',
					operation: 'image',
					model: orRoutes.edit.id,
					usd: orRoutes.edit.usd
				});
			} else {
				throw new Error(
					'No media provider configured. Add a Fal AI or OpenRouter key in Settings.'
				);
			}
		} else if (falKey && (productPhoto || characterRef)) {
			// References are composited here, so the pick resolves as an image EDIT
			// model — a t2i id would drop the refs and invent a new person.
			const compositeModel = stillModelId ? resolveModel('image_edit', stillModelId) : null;
			try {
				still = await generateProductStill(
					falKey,
					scene,
					productPhoto,
					characterRef,
					undefined,
					compositeModel
				);
				costEvents.push({
					provider: 'fal',
					operation: 'image',
					model: compositeModel ? compositeModel.label : NANO_STILL_LABEL,
					usd: compositeModel ? compositeModel.usd : priceOf('fal', 'image', 'nano')
				});
			} catch (e) {
				const msg = (e as Error).message;
				if (orKey && isFalOutage(msg)) {
					console.warn(
						`[Refine] fal still failed (${msg.slice(0, 120)}) — OpenRouter Nano-Banana composite fallback.`
					);
					const refs = [characterRef, productPhoto].filter(Boolean) as string[];
					still = await openRouterImageEdit(
						orKey,
						userId,
						buildCompositeFallbackPrompt(scene, !!characterRef, !!productPhoto),
						refs,
						orRoutes.edit
					);
					costEvents.push({
						provider: 'openrouter',
						operation: 'image',
						model: orRoutes.edit.id,
						usd: orRoutes.edit.usd
					});
				} else {
					throw e;
				}
			}
		} else if (orKey && (productPhoto || characterRef)) {
			const refs = [characterRef, productPhoto].filter(Boolean) as string[];
			still = await openRouterImageEdit(
				orKey,
				userId,
				buildCompositeFallbackPrompt(scene, !!characterRef, !!productPhoto),
				refs,
				orRoutes.edit
			);
			costEvents.push({
				provider: 'openrouter',
				operation: 'image',
				model: orRoutes.edit.id,
				usd: orRoutes.edit.usd
			});
		} else {
			// Nothing to composite — a plain text-to-image model, resolved and billed
			// inside generateUgcImage.
			const t2i = await generateUgcImage(
				scene,
				orKey,
				falKey,
				stillModelId,
				'3:4',
				refsPolicy.character,
				orRoutes.t2i
			);
			still = t2i.url;
			costEvents.push({
				provider: t2i.provider,
				operation: 'image',
				model: t2i.model,
				usd: t2i.usd ?? priceOf(t2i.provider, 'image', t2i.provider === 'fal' ? 'flux' : undefined)
			});
		}

		// ── Video — same format the post already has ──
		const wantVideo = content.media_type === 'video';
		// A refine re-shoots the STILL and re-runs the clip from it — it has no
		// source clip, because the ingested file is not part of the stored post. So a
		// performance-transfer post refines as b-roll (what a still can actually
		// produce) rather than as a spokesperson, which is what the old
		// anything-else-is-spokesperson default would have made of it.
		let format: 'spokesperson' | 'broll' | 'vo_broll' | 'motion_card' =
			content.format === 'broll' ||
			content.format === 'vo_broll' ||
			content.format === 'motion_card'
				? content.format
				: content.format === 'v2v_narrated'
					? // A narrated remake has no clip to re-transfer either, but its voice
						// is fully reproducible from the stored script and voice — so it
						// refines as the narrated b-roll clip rather than silently losing
						// the narration the post is named for.
						'vo_broll'
					: content.format === 'v2v_replace' || content.format === 'v2v_move'
						? 'broll'
						: 'spokesperson';
		const dialogue = (
			input.dialogue?.trim() ||
			content.dialogue ||
			content.script ||
			content.text ||
			''
		).trim();
		let mediaUrl = still;
		let mediaType: 'image' | 'video' = 'image';
		// Truth trackers for the refined record: the voice that actually spoke and
		// the i2v model that actually ran — mirrors generateUgcPack's bookkeeping.
		let refineVoiceUsed: string | null = null;
		let videoModelRan: string | null = null;
		// A motion card this host could not re-animate — same posture as a fresh run.
		let refineMotionDegraded = false;
		// Resolved before the video branch: the locally assembled formats produce a
		// Buffer, which has to reach storage before anything can fetch it.
		const svc = (() => {
			try {
				return getServiceSupabase();
			} catch {
				return null; // No service-role key configured at all.
			}
		})();
		if (wantVideo && (falKey || orKey)) {
			// The original Director motion_prompt isn't stored on the post, and the
			// user's edited brief is the ground truth now — so motion guidance is
			// rebuilt from it with the same camera-vocabulary pass a fresh run gets.
			const intent = classifyContentIntent(content.text || '', content.platform || 'instagram');
			const motionPrompt = enhanceMotionPrompt(scene, intent, format);
			try {
				if (format === 'spokesperson' && falKey) {
					// A composer voice pick re-records this post in a different voice.
					// Unknown names keep the post's own voice: a refine changes the
					// media, it must not silently introduce a voice nobody chose.
					const requestedVoice = input.voiceOverride?.trim();
					const voice =
						requestedVoice && VOICE_CATALOG.some((v) => v.name === requestedVoice)
							? requestedVoice
							: content.voice || DEFAULT_VOICE;
					const voiceGender = VOICE_CATALOG.find((v) => v.name === voice)?.gender;
					const { url: audioUrl, voiceUsed } = await generateVoiceAudio(
						falKey,
						voice,
						dialogue,
						voiceGender === 'female' ? 'Rachel' : 'Adam',
						falRoutes.tts
					);
					refineVoiceUsed = voiceUsed;
					costEvents.push({
						provider: 'fal',
						operation: 'tts',
						model: falRoutes.tts.id,
						usd: falRoutes.tts.usd
					});
					const refineHead = resolveModel(
						'talking_head',
						input.talkingHeadModel ?? content.generation?.selections?.talkingHeadModel
					);
					mediaUrl = await generateTalkingHead(falKey, still, audioUrl, refineHead.id);
					costEvents.push({
						provider: 'fal',
						operation: 'talking_head',
						model: refineHead.id,
						usd: refineHead.usd
					});
				} else if (format === 'motion_card') {
					// Re-typeset above, re-animated here — a refine of a motion card calls
					// no provider at all, so it costs the Director's re-run and nothing
					// more. A host that cannot animate keeps the card as a still.
					const motion = await stillToMotion(still);
					if (motion && svc) {
						mediaUrl = await persistBufferToStorage(svc, motion, userId, 'mp4', 'video/mp4');
					} else {
						console.warn(
							'[refine] motion_card could not be re-assembled — keeping the still card.'
						);
						refineMotionDegraded = true;
					}
				} else if (falKey) {
					const brollModel = resolveModel('video_i2v', content.generation?.selections?.videoModel);
					mediaUrl = await generateBrollVideo(falKey, brollModel.id, still, motionPrompt);
					videoModelRan = brollModel.id;
					costEvents.push({
						provider: 'fal',
						operation: 'video',
						model: brollModel.label,
						usd: brollModel.usd
					});
					if (format === 'vo_broll') {
						// Re-record the narration for the refreshed clip. As in a fresh run,
						// a mixing failure keeps the clip and downgrades the record rather
						// than losing what was just paid for.
						const requestedVoice = input.voiceOverride?.trim();
						const voice =
							requestedVoice && VOICE_CATALOG.some((v) => v.name === requestedVoice)
								? requestedVoice
								: content.voice || DEFAULT_VOICE;
						const voiceGender = VOICE_CATALOG.find((v) => v.name === voice)?.gender;
						let mixed: Buffer | null = null;
						try {
							const { url: audioUrl, voiceUsed } = await generateVoiceAudio(
								falKey,
								voice,
								dialogue,
								voiceGender === 'female' ? 'Rachel' : 'Adam',
								falRoutes.tts
							);
							refineVoiceUsed = voiceUsed;
							costEvents.push({
								provider: 'fal',
								operation: 'tts',
								model: falRoutes.tts.id,
								usd: falRoutes.tts.usd
							});
							mixed = await muxVoiceover(mediaUrl, audioUrl);
						} catch (voErr) {
							console.warn('[refine] vo_broll narration failed:', (voErr as Error).message);
						}
						if (mixed && svc) {
							mediaUrl = await persistBufferToStorage(svc, mixed, userId, 'mp4', 'video/mp4');
						} else {
							format = 'broll';
						}
					}
				} else {
					// TTS + talking head are fal-exclusive — a refine without a fal key
					// runs as silent b-roll, and the record must say so.
					if (format !== 'broll') format = 'broll';
					mediaUrl = await openRouterBrollVideo(
						orKey!,
						userId,
						still,
						motionPrompt,
						undefined,
						orRoutes.video
					);
					videoModelRan = orRoutes.video.id;
					costEvents.push({
						provider: 'openrouter',
						operation: 'video',
						model: orRoutes.video.id,
						usd: orRoutes.video.usd
					});
				}
				mediaType = 'video';
			} catch (e) {
				const msg = (e as Error).message;
				if (orKey && isFalOutage(msg)) {
					console.warn(
						`[Refine] fal video failed (${msg.slice(0, 120)}) — OpenRouter Kling b-roll fallback.`
					);
					// Degraded to a silent clip — record the format that actually delivered.
					if (format === 'spokesperson') format = 'broll';
					mediaUrl = await openRouterBrollVideo(
						orKey,
						userId,
						still,
						motionPrompt,
						undefined,
						orRoutes.video
					);
					videoModelRan = orRoutes.video.id;
					costEvents.push({
						provider: 'openrouter',
						operation: 'video',
						model: orRoutes.video.id,
						usd: orRoutes.video.usd
					});
					mediaType = 'video';
				} else {
					throw e;
				}
			}
		}

		// ── Re-burn what the post had burned, persist to durable storage ──
		let durableStill = still;
		let durableMedia = mediaUrl;
		let captionsApplied = false;
		if (svc) {
			durableStill = await persistToStorage(svc, still, userId, 'png');
			if (mediaType === 'video') {
				const captioned = await burnCaptions(mediaUrl, {
					badge: content.ai_badge,
					hook: content.captions ? content.on_screen_text : ''
				}).catch(() => null);
				captionsApplied = captioned != null;
				durableMedia = captioned
					? await persistBufferToStorage(svc, captioned, userId, 'mp4', 'video/mp4')
					: await persistVideoDurable(svc, mediaUrl, userId);
			} else {
				durableMedia = durableStill;
			}
		} else {
			console.warn(
				'[Refine] No service-role Supabase key configured — storing EPHEMERAL provider URLs (media is NOT backed up).'
			);
		}
		if (durableMedia)
			costEvents.push({
				provider: 'storage',
				operation: 'persist',
				model: 'ugc-media',
				usd: 0,
				assetUrl: durableMedia
			});
		if (durableStill && durableStill !== durableMedia)
			costEvents.push({
				provider: 'storage',
				operation: 'persist',
				model: 'ugc-media',
				usd: 0,
				assetUrl: durableStill
			});

		// ── Merge the refine spend into the post's cost + provenance record ──
		// The post's totals must reflect EVERYTHING it cost, original run included.
		const refineRun = summarizeAspects(costEvents);
		const prevAspects = content.generation?.aspects ?? {};
		const mergedAspects: Record<string, { models: string[]; usd: number }> = {};
		for (const [op, v] of Object.entries(prevAspects)) {
			mergedAspects[op] = { models: [...(v?.models ?? [])], usd: Number(v?.usd ?? 0) };
		}
		for (const [op, v] of Object.entries(refineRun.aspects)) {
			const prev = mergedAspects[op];
			mergedAspects[op] = prev
				? {
						models: [...new Set([...prev.models, ...v.models])],
						usd: +(prev.usd + v.usd).toFixed(6)
					}
				: v;
		}
		// A pre-observability post has spend but no per-aspect record. Seed that
		// spend as an explicit 'prior' row, so the aspect table's visible rows
		// always sum to the Total beneath them instead of silently under-adding.
		if (Object.keys(prevAspects).length === 0) {
			const priorSpend = Number(content.generation?.total ?? content.costBreakdown?.total ?? 0);
			if (priorSpend > 0) mergedAspects.prior = { models: [], usd: +priorSpend.toFixed(6) };
		}
		const refineCosts = summarizeCosts(costEvents);
		const prevBreakdown = content.costBreakdown ?? { total: 0, byProvider: {} };
		const mergedByProvider: Record<string, number> = { ...(prevBreakdown.byProvider ?? {}) };
		for (const [provider, usd] of Object.entries(refineCosts.byProvider)) {
			mergedByProvider[provider] = +((mergedByProvider[provider] ?? 0) + usd).toFixed(6);
		}
		const prevTotal = Number(content.generation?.total ?? prevBreakdown.total ?? 0);

		const refined: UgcContent = {
			...content,
			// What THIS media actually is: a degraded refine records b-roll, and a
			// TTS voice fallback records the voice that really spoke.
			format,
			...(refineVoiceUsed ? { voice: refineVoiceUsed } : {}),
			...(refineMotionDegraded ? { motion_assembled: false as const } : {}),
			dialogue: format === 'spokesperson' ? dialogue : content.dialogue,
			script: format === 'spokesperson' ? dialogue : content.script,
			// Actual burn outcome for THIS media, not the old video's flags.
			captions:
				Boolean(content.captions) &&
				captionsApplied &&
				Boolean((content.on_screen_text || '').trim()),
			ai_badge: Boolean(content.ai_badge) && captionsApplied,
			ugc_broll_prompt: scene,
			media_url: durableMedia,
			poster_url: durableStill,
			media_type: mediaType,
			media_generated: true,
			costBreakdown: {
				total: +(Number(prevBreakdown.total ?? 0) + refineCosts.total).toFixed(6),
				byProvider: mergedByProvider
			},
			generation: {
				...(content.generation ?? {}),
				aspects: mergedAspects,
				total: +(prevTotal + refineRun.total).toFixed(6),
				// The card line THIS media carries — a retyped line makes the stored
				// one wrong, and a supplied still means no card was typeset at all.
				...(renderedCardText ? { card_text: renderedCardText } : {}),
				...(suppliedStill ? { still_source: 'supplied' as const } : {}),
				images: content.generation?.images ?? {
					character_ref: characterRef,
					product_photo: productPhoto
				},
				selections: {
					...(content.generation?.selections ?? {}),
					// The clip model THIS media came from (null = none ran on it).
					videoModel: videoModelRan,
					mediaType
				},
				prompts: {
					...(content.generation?.prompts ?? {}),
					scene,
					script: format === 'spokesperson' ? dialogue : content.generation?.prompts?.script
				}
			}
		};
		// A previous failed refine's error must not survive a successful one.
		delete (refined as any).refine_error;
		return refined;
	} finally {
		await recordCostEvents(supabase, userId, input.agentId, costEvents, input.postId);
	}
}
