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
import { resolveAiClient, type AiClient } from '$lib/server/ai-client';
import {
	priceOf,
	summarizeCosts,
	summarizeAspects,
	type CostEvent,
	type GenerationProvenance
} from '$lib/pricing';
import { appearanceToPromptClause } from '$lib/persona-profile';
import { createDbService } from '$lib/server/db';
import { DEFAULT_VOICE, VOICE_CATALOG } from '$lib/server/voices';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { resolveModel, getModel, type ModelOption } from '$lib/models';
import { persistToStorage, persistBufferToStorage } from '$lib/server/storage';
import { burnCaptions } from '$lib/server/video';
import { fetchWithTimeout } from '$lib/server/social/http';
import { assertWithinBudget } from '$lib/server/budget';

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
const TTS_MODEL = env.UGC_TTS_MODEL || 'fal-ai/elevenlabs/tts/turbo-v2.5';
const TALKINGHEAD_MODEL = env.UGC_TALKINGHEAD_MODEL || 'veed/fabric-1.0';
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
const BROLL_MODEL_STANDARD =
	env.UGC_BROLL_MODEL || 'fal-ai/kling-video/o3/standard/image-to-video';
const BROLL_MODEL_CINEMATIC =
	env.UGC_BROLL_MODEL_CINEMATIC || 'fal-ai/kling-video/o3/pro/reference-to-video';
// Veo 3.1 (still Google's latest as of this date — no Veo 4 released despite
// plenty of speculation) is intentionally NOT wired into any active
// generation path right now (no multi-shot/elements support via fal, and
// ~2x Kling's cost) — kept here, unused, so it's a one-line change to bring
// back later rather than a re-integration from scratch.
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
export async function resolveImageKeys(
	supabase: any,
	userId: string
): Promise<{ orKey: string | null; falKey: string | null }> {
	const userOrKey = await getUserApiKey(supabase, userId, 'openrouter').catch(() => null);
	const envOrKey = env.OPENROUTER_API_KEY?.trim();
	const orKey =
		userOrKey || (envOrKey && !envOrKey.includes('placeholder') ? envOrKey : null) || null;
	const userFalKey = await getUserApiKey(supabase, userId, 'fal_ai').catch(() => null);
	const falKey = userFalKey || env.FAL_API_KEY || process.env.FAL_API_KEY || null;
	return { orKey, falKey };
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
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 5000));
		const s = await genFetch(status_url, { headers: { Authorization: `Key ${falKey}` } });
		if (!s.ok) continue;
		const st = (await s.json()) as any;
		if (st.status === 'COMPLETED') {
			const r = await genFetch(response_url, { headers: { Authorization: `Key ${falKey}` } });
			return r.json();
		}
		if (['FAILED', 'ERROR', 'CANCELLED'].includes(st.status)) {
			throw new Error(`${model} job ${st.status}`);
		}
	}
	throw new Error(`${model} timed out`);
}

/**
 * Generates a UGC-style lifestyle image from a b-roll prompt (text-to-image fallback
 * when there is no product photo to composite). Throws on failure.
 */
export const UGC_IMAGE_PREFIX =
	'UGC lifestyle photo, candid and authentic, shot on iPhone, natural lighting, real person not staged. ';
/** The text-to-image models this helper actually calls -- surfaced so the UI shows the truth. */
export const UGC_IMAGE_MODEL_FAL = 'fal-ai/flux/schnell';
export const UGC_IMAGE_MODEL_OPENROUTER = 'black-forest-labs/flux-schnell';

/** The full string the provider receives, prefix included, so a preview can never lie. */
export function buildUgcImagePrompt(ugcPrompt: string): string {
	return `${UGC_IMAGE_PREFIX}${ugcPrompt}`;
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

export async function generateUgcImage(
	ugcPrompt: string,
	orKey: string | null,
	falKey: string | null,
	modelId?: string | null,
	aspect: string = '3:4'
): Promise<string> {
	const imagePrompt = buildUgcImagePrompt(ugcPrompt);

	// An explicitly chosen model is a budget/quality decision the user made and
	// confirmed. It must win over the "OpenRouter first" default routing, which
	// would otherwise silently ignore the pick and bill a different model.
	if (modelId && falKey) {
		const model = resolveModel('image_t2i', modelId);
		const falData = await falSyncJson(model.id, buildT2iInput(model, imagePrompt, aspect), falKey);
		const url = falData.images?.[0]?.url;
		if (!url) throw new Error(`${model.label} returned no image`);
		return url;
	}

	if (orKey) {
		const orRes = await genFetch('https://openrouter.ai/api/v1/images/generations', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${orKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://personagen.app',
				'X-Title': 'PersonaGen'
			},
			body: JSON.stringify({
				model: UGC_IMAGE_MODEL_OPENROUTER,
				prompt: imagePrompt,
				n: 1,
				size: '1024x1024'
			})
		});
		if (!orRes.ok)
			throw new Error(
				`OpenRouter image failed (${orRes.status}): ${(await orRes.text()).slice(0, 200)}`
			);
		const url = ((await orRes.json()) as any).data?.[0]?.url;
		if (!url) throw new Error('OpenRouter image returned no URL');
		return url;
	}
	if (falKey) {
		const falData = await falSyncJson(
			UGC_IMAGE_MODEL_FAL,
			{ prompt: imagePrompt, image_size: 'square_hd', num_images: 1 },
			falKey
		);
		const url = falData.images?.[0]?.url;
		if (!url) throw new Error('fal image returned no URL');
		return url;
	}
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

	const setting: 'indoor' | 'outdoor' =
		type === 'lifestyle' ? 'outdoor' : 'indoor';

	const voiceMap: Record<string, string> = {
		tiktok: 'Gen-Z casual energy, trending-aware, watch-till-end hook in first 1.5 seconds, fast-paced',
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
	{ name: 'Confession', pattern: `Admit something vulnerable/counterintuitive: "I was wrong about…", "I almost returned this…"`, bestFor: ['testimonial', 'review'] },
	{ name: 'Contrarian', pattern: `Attack the accepted belief: "Everyone tells you to X. That's exactly why you're stuck."`, bestFor: ['review', 'tutorial'] },
	{ name: 'Cost of inaction', pattern: `Name what ignoring this costs: "Every week you skip this, you're paying for it in…"`, bestFor: ['tutorial', 'testimonial'] },
	{ name: 'Specific number', pattern: `Oddly precise stat/result: "17 days. That's how long it took before…"`, bestFor: ['testimonial', 'review', 'tutorial'] },
	{ name: 'POV switch', pattern: `Speak as/to the skeptic: "To the person who scrolled past this twice already…"`, bestFor: ['testimonial', 'lifestyle'] },
	{ name: 'Before/after tease', pattern: `State the after, withhold the how: "My mornings look nothing like they did in March."`, bestFor: ['lifestyle', 'testimonial'] },
	{ name: 'Forbidden knowledge', pattern: `Insider framing: "Nobody in [industry] wants you to figure this out."`, bestFor: ['review', 'tutorial'] },
	{ name: 'Pattern break', pattern: `Open mid-story, no context: "So the second jar arrived and my husband hid it."`, bestFor: ['unboxing', 'lifestyle', 'testimonial'] },
	{ name: 'Stakes-first', pattern: `Lead with what was at risk: "I had one week before the wedding and zero plan."`, bestFor: ['lifestyle', 'testimonial'] },
	{ name: 'Anti-sell', pattern: `Disqualify buyers: "Honestly? Don't buy this if you only want…"`, bestFor: ['review', 'unboxing'] }
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
			{ systemInstruction: GRADER_SYSTEM, json: true }
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
 * Builds a rich agent context string from the agent row, pulling extended
 * persona profile from agent.market (stored as JSON by the persona editor).
 */
function buildRichAgentContext(agent: any): string {
	const lines: string[] = [
		`You are ${agent.name} (@${agent.handle}), a ${agent.niche} creator.`,
		`Core personality: ${agent.soul || 'authentic and relatable'}.`
	];

	let pp: Record<string, any> = {};
	try {
		if (agent.market && typeof agent.market === 'string' && agent.market.startsWith('{')) {
			pp = JSON.parse(agent.market);
		}
	} catch {
		/* ignore malformed market field */
	}

	if (pp.archetype)
		lines.push(
			`Persona archetype: "${pp.archetype}" — let this archetype's energy, tone, and style govern every creative decision.`
		);
	if (pp.contentFocus) lines.push(`Primary content focus: ${pp.contentFocus}.`);
	if (pp.contentAngle)
		lines.push(`Signature content angle / POV: "${pp.contentAngle}" — this is the unique lens through which all content is filtered.`);
	if (Array.isArray(pp.ageRanges) && pp.ageRanges.length)
		lines.push(`Target age demographic: ${pp.ageRanges.join(', ')}.`);
	else if (pp.ageMin && pp.ageMax)
		lines.push(`Target age demographic: ${pp.ageMin}–${pp.ageMax} year olds.`);
	if (pp.targetAvatar) lines.push(`Ideal viewer profile: ${pp.targetAvatar}.`);
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
	format: 'spokesperson' | 'broll'
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
		format === 'spokesperson'
			? 'Character: natural direct eye contact with lens, occasional glance to product, subtle head tilt on key spoken word. Real micro-expressions — not posed or frozen.'
			: 'Product: slow rotation revealing texture, label, and material. Hand entering frame to pick up or use it. Real surface contact — not floating or artificially suspended.';

	return `${basePrompt}\n\nCamera: ${cameraByLevel[intent.motionLevel]}\n${subjectByFormat}\nTechnical: smooth motion, no compression artifacts, no overexposed highlights, no jump cuts.`;
}

/** Nano Banana: composite the real product (+ optional pinned face) into a UGC scene. */
async function generateProductStill(
	falKey: string,
	scenePrompt: string,
	productPhotoUrl: string | null,
	characterRef: string | null,
	brandVisualContext?: string
): Promise<string> {
	const refs = [characterRef, productPhotoUrl].filter(Boolean) as string[];
	const brandLine = brandVisualContext ? `\n\nBrand visual direction: ${brandVisualContext}` : '';
	const prompt = [
		scenePrompt,
		'',
		'Vertical 9:16 photorealistic UGC photo. Shoot quality: shot on iPhone 15 Pro with ProRAW, 24mm equivalent, natural light, real environment — NOT a studio ad or stock photo.',
		'Product accuracy: preserve the exact label typography, packaging shape, color, and material from the reference. Never redesign, genericize, or omit the product.',
		characterRef
			? 'Character consistency: the person must be IDENTICAL to the first reference image — same facial bone structure, skin tone, hair color, and texture. Not a similar person. The exact same person.'
			: '',
		'Imperfection is quality: slight skin texture visible, natural shadows, lived-in authentic setting — not retouched or plastic-looking.',
		brandLine
	]
		.filter(Boolean)
		.join('\n');

	const data = await falSyncJson(NANO_MODEL, { prompt, image_urls: refs, aspect_ratio: '9:16' }, falKey);
	const url = data.images?.[0]?.url;
	if (!url) throw new Error('Nano Banana returned no image');
	return url;
}

async function generateVoiceAudio(falKey: string, voice: string, text: string): Promise<string> {
	const data = await falSyncJson(
		TTS_MODEL,
		{ text, voice, stability: 0.5, similarity_boost: 0.75 },
		falKey
	);
	const url = data.audio?.url;
	if (!url) throw new Error('TTS returned no audio');
	return url;
}

async function generateTalkingHead(
	falKey: string,
	stillUrl: string,
	audioUrl: string
): Promise<string> {
	const data = await falQueueJson(
		TALKINGHEAD_MODEL,
		{ image_url: stillUrl, audio_url: audioUrl, resolution: FABRIC_RES },
		falKey
	);
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
	motionPrompt: string
): Promise<string> {
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
	imageUrls: string[]
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
			model: IMAGE_EDIT_MODEL_OPENROUTER,
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
	timeoutMs = 270000
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
			model: BROLL_MODEL_OPENROUTER,
			prompt: motionPrompt,
			duration: parseInt(VIDEO_DURATION, 10) || 5,
			aspect_ratio: '9:16',
			generate_audio: BROLL_AUDIO_ENABLED,
			frame_images: [
				{ type: 'image_url', image_url: { url: stillUrl }, frame_type: 'first_frame' }
			]
		})
	});
	if (!submit.ok) {
		const t = await submit.text();
		throw new Error(`OpenRouter video submit failed (${submit.status}): ${t.slice(0, 200)}`);
	}
	const job = (await submit.json()) as any;
	const pollingUrl = job.polling_url || `https://openrouter.ai/api/v1/videos/${job.id}`;
	if (!job.id && !job.polling_url) {
		throw new Error(`OpenRouter video submit returned no job: ${JSON.stringify(job).slice(0, 200)}`);
	}

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 5000));
		const res = await genFetch(pollingUrl, { headers: { Authorization: `Bearer ${orKey}` } });
		if (!res.ok) continue;
		const st = (await res.json()) as any;
		if (st.status === 'completed') {
			const url = st.unsigned_urls?.[0] || st.urls?.[0] || st.video?.url;
			if (!url) throw new Error('OpenRouter video completed but returned no URL');
			// Persist NOW, with the Bearer header only we have, to a permanent URL.
			const svc = getServiceSupabase();
			return persistToStorage(svc, url, userId, 'mp4', { Authorization: `Bearer ${orKey}` });
		}
		if (st.status === 'failed') {
			throw new Error(`OpenRouter video job failed: ${JSON.stringify(st).slice(0, 200)}`);
		}
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
const CINEMATIC_MIN_SHOT_SECONDS = 2;
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
		resolveAiClient(supabase, userId),
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
	if (!selectedProduct?.photoUrl) {
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
			voiceGender ? `The on-camera character (@Element1) must present as ${voiceGender}, matching the pinned voice.` : '',
			`Angle for this post: "${topic}". Output ONLY the JSON.`
		]
			.filter(Boolean)
			.join('\n');

	const prompt = buildCinematicPrompt();

	const raw =
		(await ai.generate(prompt, { systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true })) ||
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
				{ systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true }
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
	let cinematicGrade = await gradeDraftWithRetry(ai, parsed, selectedProduct?.name ?? null, platform);
	if (cinematicFloor > 0 && cinematicGrade && cinematicGrade.overall < cinematicFloor) {
		console.warn(
			`[Cinematic QC] Draft graded ${cinematicGrade.overall}/10 (< floor ${cinematicFloor}) — one rewrite: ${cinematicGrade.fix}`
		);
		const rewriteRaw =
			(await ai.generate(
				`${buildCinematicPrompt()}\n\nAn independent QC reviewer graded your draft ${cinematicGrade.overall}/10. Top issue: ${cinematicGrade.topIssue}. Required fix: ${cinematicGrade.fix}. Rewrite the ENTIRE JSON applying that fix.`,
				{ systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true }
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
				{ systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true }
			)) || '{}';
		const retryParsed = safeParseJson(retryRaw);
		if (Array.isArray(retryParsed?.shots) && retryParsed.shots.length >= CINEMATIC_MIN_SHOT_COUNT) {
			directorShots = retryParsed.shots;
		} else {
			console.warn(
				`[Cinematic] Retry still returned ${retryParsed?.shots?.length ?? 0} shot(s) — proceeding with what we have.`
			);
		}
	}

	const rawShots: CinematicShot[] = directorShots.length > 0
		? directorShots
				.slice(0, 5)
				.map((s: any) => ({
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
				generateProductStill(falKey, shot.prompt, selectedProduct.photoUrl, characterRef, cinematicBrandVisualCtx).catch((err) => {
					console.warn(`[Cinematic] Storyboard still ${i + 1}/${shots.length} failed, skipping:`, err);
					return null;
				})
			)
		)
	).filter((url): url is string => Boolean(url));

	for (let i = 0; i < storyboard.length; i++) {
		costEvents.push({ provider: 'fal', operation: 'image', model: 'nano-banana-2 (storyboard)', usd: priceOf('fal', 'image', 'nano') });
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
		productPhotoUrl: selectedProduct.photoUrl
	};

	const videoUrl = await generateCinematicVideo(falKey, cinematicRefs, shots);
	costEvents.push({ provider: 'fal', operation: 'video', model: 'kling-o3-pro reference (cinematic)', usd: priceOf('fal', 'video', 'pro') });

	const captioned = parsed.on_screen_text
		? await burnCaptions(videoUrl, parsed.on_screen_text).catch(() => null)
		: null;
	const durableMedia = captioned
		? await persistBufferToStorage(svc, captioned, userId, 'mp4', 'video/mp4')
		: await persistToStorage(svc, videoUrl, userId, 'mp4');

	// Record the durable asset URLs in the ledger (flushed in finally, even on a
	// later throw) so this spend is always recoverable from the DB.
	costEvents.push({ provider: 'storage', operation: 'persist', model: 'ugc-media', usd: 0, assetUrl: durableMedia });
	if (durableStoryboard[0])
		costEvents.push({ provider: 'storage', operation: 'persist', model: 'ugc-media', usd: 0, assetUrl: durableStoryboard[0] });

	const content: UgcContent & { storyboard?: string[]; cinematic?: boolean } = {
		text: parsed.text || '',
		hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
		hookScore: parsed.hookScore,
		on_screen_text: parsed.on_screen_text || '',
		ugc_broll_prompt: shots.map((s, i) => `Shot ${i + 1} (${s.duration}s): ${s.prompt}`).join('\n\n'),
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
			product_photo: selectedProduct?.photoUrl || null,
			reference_kit: [kit.full_body, kit.side_profiles, kit.face_closeup, kit.feature_grid].filter(
				Boolean
			) as string[]
		},
		prompts: { scene: content.ugc_broll_prompt, script: content.script },
		selections: {
			platforms: [platform],
			brand: briefData?.name ?? briefData?.brandName ?? briefData?.data?.brandName ?? null,
			videoModel: 'cinematic (Kling O3 Pro reference)',
			provider: input.providerPreference ?? null,
			mediaType: 'video'
		}
	};

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
	format: 'auto' | 'spokesperson' | 'broll';
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
	if (brandBriefId) {
		const { data } = await db.brandBriefs.getById(brandBriefId, userId);
		if (data) return data;
		console.warn(
			`[UGC] Persona's selected brand brief ${brandBriefId} not found — falling back to newest brief.`
		);
	}
	const { data } = await db.brandBriefs.get(userId);
	return data ?? null;
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
	/** Model picks from the composer — the user's budget-vs-quality decision. */
	videoModel?: string;
	/** The post row this generation belongs to — links ledger rows to the post. */
	postId?: string;
}

export interface UgcContent {
	text: string;
	hashtags: string[];
	hookScore?: number;
	dialogue?: string;
	on_screen_text?: string;
	ugc_broll_prompt?: string;
	script?: string;
	media_url: string;
	poster_url?: string;
	media_type: 'image' | 'video';
	media_generated: boolean;
	format: 'spokesperson' | 'broll';
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
}

/** Wraps an AiClient so every text call self-records into the cost ledger. */
function trackAi(ai: AiClient, costEvents: CostEvent[]): AiClient {
	return {
		provider: ai.provider,
		async generate(prompt, opts) {
			costEvents.push({
				provider: ai.provider,
				operation: 'llm',
				model: 'text-generation',
				usd: priceOf(ai.provider, 'llm')
			});
			return ai.generate(prompt, opts);
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
	job: () => Promise<T>
): Promise<T> {
	await assertWithinBudget(supabase, userId, agentId);
	try {
		return await job();
	} finally {
		await recordCostEvents(supabase, userId, agentId, costEvents);
	}
}

/** Best-effort ledger write — spend analytics must never break generation. */
async function recordCostEvents(
	supabase: any,
	userId: string,
	agentId: string | undefined,
	events: CostEvent[],
	postId?: string
): Promise<void> {
	if (events.length === 0) return;
	// Link every spent generation to the post it produced (was always null before)
	// and record the durable asset URL, so no token spend is ever untraceable and
	// every asset is recoverable from the DB.
	const rows = events.map((e) => ({
		user_id: userId,
		agent_id: agentId ?? null,
		post_id: postId ?? null,
		provider: e.provider,
		operation: e.operation,
		model: e.model,
		est_cost: e.usd,
		asset_url: e.assetUrl ?? null
	}));
	try {
		const { error } = await supabase.from('generation_events').insert(rows);
		if (!error) return;
		// The asset_url column is added by generation_events_asset_url_migration.sql.
		// If it isn't applied yet, the insert fails for an unknown column — retry
		// WITHOUT asset_url so the ledger (and cap accounting) keeps working rather
		// than silently dropping every cost row until the migration lands.
		if (/asset_url/i.test(error.message ?? '') || error.code === 'PGRST204' || error.code === '42703') {
			const { error: retryErr } = await supabase
				.from('generation_events')
				.insert(rows.map(({ asset_url, ...rest }) => rest));
			if (retryErr)
				console.warn('[Cost] Failed to record generation events:', retryErr.message);
			else
				console.warn(
					'[Cost] Recorded generation events without asset_url — apply generation_events_asset_url_migration.sql to enable asset recovery.'
				);
			return;
		}
		console.warn('[Cost] Failed to record generation events:', error.message);
	} catch (err) {
		console.warn('[Cost] Failed to record generation events:', (err as Error).message);
	}
}

export interface UgcPack {
	content: UgcContent;
	selectedProduct: any | null;
	briefData: any | null;
	agentData: any | null;
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

/** Persona-profile JSON stored in agents.market (gender/archetype/target avatar/etc. from the Profile tab). */
function parsePersonaProfile(agentData: any): Record<string, any> {
	try {
		const m = agentData?.market;
		if (typeof m === 'string' && m.trim().startsWith('{')) return JSON.parse(m);
	} catch {
		/* legacy plain-text market value */
	}
	return {};
}

/**
 * Best-effort gender inference from free-text persona description. Used ONLY as
 * a fallback when the explicit Gender field is unset — so a persona whose soul
 * plainly reads "a slim blond girl" is never mis-voiced as male just because
 * someone skipped the dropdown. Deterministic keyword scan (word-boundary), and
 * deliberately returns undefined on ambiguity rather than guessing.
 */
export function inferGenderFromText(
	...texts: Array<string | undefined | null>
): 'male' | 'female' | undefined {
	const t = texts.filter(Boolean).join(' ').toLowerCase();
	if (!t) return undefined;
	// \bman\b does NOT match "woman"/"human"; \bmen\b does NOT match "women" — the
	// missing word boundary protects against those overlaps.
	const female = /\b(she|her|hers|herself|woman|women|girl|girls|female|lady|ladies|mother|mom|mum|feminine|actress|businesswoman|queen|sister|daughter|wife|girlfriend)\b/;
	const male = /\b(he|him|his|himself|man|men|boy|boys|male|gentleman|father|dad|masculine|actor|businessman|king|brother|son|husband|boyfriend|guy|dude|bloke)\b/;
	const hasF = female.test(t);
	const hasM = male.test(t);
	if (hasF && !hasM) return 'female';
	if (hasM && !hasF) return 'male';
	return undefined; // none, or contradictory → don't guess
}

// First-name → gender lookup. A persona named "Aisha Noori" or "Marcus Chen"
// has a clear gender its soul text may never state in pronouns — without this
// a female persona silently generates a male face/voice (the exact "Aisha but
// male images" bug). Curated toward the app's own personas plus common names;
// unknown names fall through to the text scan, never a wrong guess.
const NAME_GENDER: Record<string, 'male' | 'female'> = {
	// female
	aisha: 'female', sofia: 'female', sophia: 'female', veronica: 'female', chloe: 'female',
	aria: 'female', elena: 'female', jenny: 'female', jennifer: 'female', lexy: 'female', lexi: 'female',
	alexa: 'female', emma: 'female', olivia: 'female', ava: 'female', isabella: 'female', mia: 'female',
	amelia: 'female', harper: 'female', evelyn: 'female', charlotte: 'female', luna: 'female',
	grace: 'female', chloé: 'female', maya: 'female', zoe: 'female', zoey: 'female', nora: 'female',
	lily: 'female', hannah: 'female', layla: 'female', aaliyah: 'female', fatima: 'female', noor: 'female',
	sara: 'female', sarah: 'female', priya: 'female', ananya: 'female', mei: 'female', yuki: 'female',
	kayla: 'female', mila: 'female', ivy: 'female', ruby: 'female', jade: 'female', bella: 'female',
	// male
	marcus: 'male', kai: 'male', ryan: 'male', james: 'male', liam: 'male', noah: 'male', oliver: 'male',
	elijah: 'male', william: 'male', henry: 'male', lucas: 'male', mason: 'male', ethan: 'male',
	logan: 'male', jack: 'male', aiden: 'male', jackson: 'male', david: 'male', joseph: 'male',
	samuel: 'male', omar: 'male', ali: 'male', hassan: 'male', raj: 'male', arjun: 'male', chen: 'male',
	hiro: 'male', kenji: 'male', diego: 'male', mateo: 'male', leo: 'male', max: 'male', adam: 'male',
	brian: 'male', josh: 'male', joshua: 'male', tyler: 'male', dylan: 'male', nathan: 'male'
};

/** Gender from a name's first token (e.g. "Aisha Noori" → female), else undefined. */
export function inferGenderFromName(name: string | undefined | null): 'male' | 'female' | undefined {
	if (!name) return undefined;
	const first = name.trim().toLowerCase().split(/[\s._-]+/)[0]?.replace(/[^a-zà-ÿ]/g, '');
	return first ? NAME_GENDER[first] : undefined;
}

/** Extracts the character's name from a soul doc's "— Name" / "soul.md — Name" heading, if present. */
function characterNameFromSoul(soul: string | undefined | null): string | undefined {
	if (!soul) return undefined;
	const m = String(soul).match(/(?:soul(?:\.md)?\s*)?[—–-]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]+(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]+){0,2})/);
	return m?.[1]?.trim();
}

/**
 * Resolves a persona's authoritative gender: the explicit Profile-tab field
 * first, then its NAME (agent name + the character name in the soul heading),
 * then a pronoun/keyword scan of the soul/audience text. Name beats text scan
 * because "Aisha, a fashion curator" has no gendered keyword but an obvious
 * name. This is what both the voice and the on-camera character must agree with.
 */
export function resolvePersonaGender(agentData: any): 'male' | 'female' | undefined {
	const explicit = parsePersonaProfile(agentData).gender;
	if (explicit === 'male' || explicit === 'female') return explicit;

	const byName =
		inferGenderFromName(characterNameFromSoul(agentData?.soul)) ||
		inferGenderFromName(agentData?.name);
	if (byName) return byName;

	return inferGenderFromText(
		agentData?.soul,
		agentData?.name,
		parsePersonaProfile(agentData).targetAvatar
	);
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
function resolveVoiceForPersona(
	cfgVoice: string,
	agentData: any
): { voice: string; voiceGender: 'male' | 'female' | undefined } {
	const personaGender = resolvePersonaGender(agentData);
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
	const persona = agentData?.soul ? ` Personality vibe: ${String(agentData.soul).slice(0, 600)}.` : '';
	// This face is pinned and reused for every future spokesperson video for this
	// agent, so it must match the agent's configured voice gender once, up front —
	// there's no per-post opportunity to correct it after the fact.
	const genderLine = voiceGender ? ` The creator is ${voiceGender}, matching the agent's pinned voice.` : '';
	// Persona Profile fields feed the portrait too — the hero face should look
	// like the influencer the brief describes, not a generic person.
	const profile = parsePersonaProfile(agentData);
	const archetypeLine = profile.archetype ? ` Their creator archetype: ${profile.archetype}.` : '';
	const avatarLine = profile.targetAvatar ? ` They make content for: ${String(profile.targetAvatar).slice(0, 120)}.` : '';
	// Wardrobe/hair/eyes/headwear directives from the persona profile — so the
	// pinned face reflects the exact look the user configured (and "Generate for
	// brand" filled), instead of a generic person.
	const appearanceLine = appearanceToPromptClause(profile.appearance);
	return `Photorealistic vertical portrait of one relatable UGC content creator who fits this audience: ${audience}.${persona}${genderLine}${archetypeLine}${avatarLine}${appearanceLine} Friendly, casual, natural window light, looking straight at the camera, authentic iPhone selfie style, clear visible face, upper body. Single person only.`;
}

/**
 * Prompt for REGENERATING the profile picture as an EDIT of the existing face —
 * it keeps the persona the same person (same facial identity) while refreshing
 * the shot and applying any configured wardrobe/styling. Used whenever a profile
 * picture already exists, so a regenerate never produces a whole new person.
 */
export function buildPortraitEditPrompt(agentData: any): string {
	const profile = parsePersonaProfile(agentData);
	const appearanceLine = appearanceToPromptClause(profile.appearance);
	return `Regenerate this exact person as a fresh photorealistic vertical portrait. Preserve their facial identity from the reference image — same face, bone structure, eye shape, nose, jaw, hairline, and skin tone; do NOT turn them into a different person.${appearanceLine} Friendly, casual, natural window light, looking straight at the camera, authentic iPhone selfie style, clear visible face, upper body. Single person only.`;
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
	const heroPrompt = promptOverride?.trim() || buildHeroPortraitPrompt(briefData, agentData, voiceGender);

	// Portraits are 3:4. orKey stays null on purpose: routing to OpenRouter would
	// silently ignore the model the user picked (and billed for) in the composer.
	const heroUrl = await generateUgcImage(heroPrompt, null, falKey, modelId, '3:4');
	// Loud persist: pinned reusable face fed as grounding to every future video
	// -- never return the ephemeral provider URL, which would expire and break it.
	return await persistToStorage(svc, heroUrl, userId, 'png');
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
	return await runBudgetedAssetJob(supabase, userId, agentId, costEvents, async () => {
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
	await supabase.from('agent_configs').update({ ugc_character_ref: durable }).eq('agent_id', agentId);

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

		const durableSheet = await persistToStorage(svc, sheetUrl, userId, 'png');

		const heroShotUrl = await generateAvatarHeroShot(falKey, sheetUrl);
		costEvents.push({
			provider: 'fal',
			operation: 'image',
			model: 'nano-banana-2 (avatar hero shot)',
			usd: priceOf('fal', 'image', 'nano')
		});
		const durableFull = await persistToStorage(svc, heroShotUrl, userId, 'png');

		await mergeReferenceKit(supabase, agentId, { sheet: durableSheet, full_body: durableFull }, true);
	} catch (err) {
		console.warn(
			'[Content] Character-sheet foundation generation failed; kit stages will need a reference photo:',
			(err as Error).message
		);
		await mergeReferenceKit(supabase, agentId, { full_body: durable }, true);
	}

	return durable;
	});
}

/**
 * Fixed prompt for turning a user-uploaded reference photo into a neutral,
 * reusable character turnaround/reference sheet (multi-view + detail panels),
 * via Nano Banana's edit endpoint. Kept verbatim as given — this is a tuned
 * prompt, not something to paraphrase.
 */
const CHARACTER_SHEET_PROMPT = `This is for upscale 4k hyper realistic UGC generation. Create a professional character turnaround and reference sheet based on the reference image. Use the uploaded image as the primary visual reference for the character's identity, proportions, facial features, body shape, hairstyle, and overall design language, while translating it into a clean, neutral, reusable presentation board. The final image should be arranged like a polished concept art sheet on a pure white studio background. Show the same character in four full-body views: front view, side profile, back view, and three-quarter view. On the right side, include multiple clean detail panels with close-ups of the eyes, upper face, lower face lips, skin texture, hair detail, and one small clothing or material detail. Keep the styling neutral and generic so the sheet can be reused as a base template for future adaptations. Simplify anything overly specific, thematic, fantasy-based, branded, culturally tied, or heavily ornamental from the source image into a more universal version while preserving the essence of the character. The outfit should become a clean neutral base outfit with minimal detailing, soft solid tones, and a refined silhouette. No excessive accessories, no dramatic headpieces, no strong lore-specific elements, no heavy decoration unless they are essential to the base identity. The character should feel balanced, elegant, realistic, and adaptable. Expression should be calm and neutral. Makeup should be subtle and natural. Lighting should be soft, even, and studio-clean. The layout should feel like a premium design presentation board used for model sheets, character development, or production reference. Preserve the core identity from the reference, but present it in a simplified, neutral, production-ready format that can serve as a universal template for future redesigns.`;

/**
 * Reads-modifies-writes `agent_configs.ugc_reference_kit`, merging in one new
 * stage's asset. Pass `replace: true` when `patch` establishes a new identity
 * (a fresh from-scratch portrait, or a newly uploaded reference photo) — the
 * later kit stages (side_profiles/face_closeup/feature_grid) are all derived
 * from a specific full_body+sheet pair, so keeping them around after that
 * pair changes would silently mix two different faces into one "reference
 * kit" sent to the video model as a single character.
 */
/** Stages that keep a per-stage "restore from history" pool (a `<stage>_history`
 *  array in ugc_reference_kit). Every stage image ever generated is retained
 *  here so it can be re-pinned later; nothing is deleted from the bucket. */
const KIT_HISTORY_STAGES = ['sheet', 'full_body', 'side_profiles', 'face_closeup', 'feature_grid'];
/** Cap each stage's history so the JSONB row can't grow without bound. */
const KIT_HISTORY_CAP = 24;

async function mergeReferenceKit(
	supabase: any,
	agentId: string,
	patch: Record<string, string>,
	replace = false
): Promise<void> {
	// Always read the existing kit — even on replace — so we can maintain the
	// per-stage `<stage>_history` arrays that power each stage's restore picker.
	const { data } = await supabase
		.from('agent_configs')
		.select('ugc_reference_kit')
		.eq('agent_id', agentId)
		.maybeSingle();
	const existing: Record<string, any> = data?.ugc_reference_kit || {};

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

	let merged: Record<string, any>;
	if (replace) {
		// New identity: drop the derived stages' CURRENT values (a fresh face
		// invalidates them), but PRESERVE every `<stage>_history` array — history
		// is just the pool of past images the user can re-pin, never load-bearing
		// for what's sent to the video model.
		const preservedHistory: Record<string, any> = {};
		for (const k of Object.keys(existing)) if (k.endsWith('_history')) preservedHistory[k] = existing[k];
		merged = { ...preservedHistory, ...patch, ...historyPatch };
	} else {
		merged = { ...existing, ...patch, ...historyPatch };
	}
	await supabase.from('agent_configs').update({ ugc_reference_kit: merged }).eq('agent_id', agentId);
}

/** Kit stages a client is allowed to restore-from-history. */
export const RESTORABLE_KIT_STAGES = KIT_HISTORY_STAGES;

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
	if (!RESTORABLE_KIT_STAGES.includes(stage)) throw new Error(`Unknown reference-kit stage: ${stage}`);
	// The caller (restore-kit-stage route) already enforces that `url` is one of
	// THIS user's own bucket images, so a stage can be re-pinned either from its
	// own tagged history OR from the full image library (the fallback for personas
	// generated before per-stage history existed). No history-membership gate here.
	await mergeReferenceKit(supabase, agentId, { [stage]: url });
	const { data: fresh } = await supabase
		.from('agent_configs')
		.select('ugc_reference_kit')
		.eq('agent_id', agentId)
		.maybeSingle();
	return fresh?.ugc_reference_kit || {};
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
	return await runBudgetedAssetJob(supabase, userId, agentId, costEvents, async () => {
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

	const durableSheet = await persistToStorage(svc, sheetUrl, userId, 'png');

	const heroShotUrl = await generateAvatarHeroShot(falKey, sheetUrl);
	costEvents.push({
		provider: 'fal',
		operation: 'image',
		model: 'nano-banana-2 (avatar hero shot)',
		usd: priceOf('fal', 'image', 'nano')
	});

	const durable = await persistToStorage(svc, heroShotUrl, userId, 'png');

	await supabase.from('agent_configs').update({ ugc_character_ref: durable }).eq('agent_id', agentId);
	// Replace, not merge: a newly uploaded photo is a new identity, so any
	// side_profiles/face_closeup/feature_grid derived from a previous photo
	// (or a previous from-scratch face) no longer depict the same person.
	await mergeReferenceKit(supabase, agentId, { sheet: durableSheet, full_body: durable }, true);
	return durable;
	});
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
): { prompt: string; model: string; image_urls: string[]; aspect_ratio: string } | { error: string } {
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
	return await runBudgetedAssetJob(supabase, userId, agentId, costEvents, async () => {
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
	});
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
	} catch {
		return null;
	}
}

/**
 * Generates a single UGC post pack tuned to the agent persona, brand brief and product,
 * using the agent's pinned voice/format/quality. Throws on unrecoverable failures.
 */
export async function generateUgcPack(input: UgcPackInput): Promise<UgcPack> {
	const { supabase, userId } = input;
	const platform = input.platform || 'instagram';
	const topic = input.topic || 'Sharing an honest experience with this product';
	const wantVideo = input.video !== false;

	const rawAi = await resolveAiClient(supabase, userId);
	if (!rawAi)
		throw new Error('No AI provider configured. Add an OpenRouter or Gemini key in Settings.');
	// Every text call (director, retries, grader) self-records into the ledger.
	const costEvents: CostEvent[] = [];
	const ai = trackAi(rawAi, costEvents);

	// Fail-closed spend guard: refuse to start a paid generation once this agent's
	// daily or the user's monthly estimated spend has crossed the configured cap.
	await assertWithinBudget(supabase, userId, input.agentId);

	try {

	const db = createDbService(supabase);
	const cfg = await loadUgcConfig(supabase, input.agentId);

	// ── Load agent persona ──────────────────────────────────────────────
	let agentContext = '';
	let agentData: any = null;
	if (input.agentId) {
		const { data: agent } = await db.agents.get(input.agentId);
		if (agent) {
			agentData = agent;
			agentContext = buildRichAgentContext(agent);
		}
	}

	// The on-camera character's depicted gender must match the voice actually
	// used — and the persona's configured gender (Profile tab) is authoritative
	// over a contradicting voice pick (e.g. the 'Adam' column default on a
	// female persona). Threaded through explicitly so the Director/character-ref
	// prompts and the TTS call all agree.
	const { voice: resolvedVoice, voiceGender } = resolveVoiceForPersona(cfg.voice, agentData);

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

	// ── Director (LLM) ──────────────────────────────────────────────────
	const buildDirectorPrompt = () => [
		agentContext,
		selectedProduct
			? `Product: "${selectedProduct.name}" — ${selectedProduct.description || 'no description'}. Price: ${selectedProduct.price || 'N/A'}.`
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
		`Requested format: ${cfg.format === 'auto' ? 'choose spokesperson or broll based on what will perform best for this content type' : cfg.format}.`,
		voiceGender
			? `If the scene shows a person on camera, they must present as ${voiceGender} — the pinned voice is ${voiceGender} and the on-camera character must match.`
			: '',
		`Creative angle for this post: "${topic}". Output ONLY the JSON.`
	]
		.filter(Boolean)
		.join('\n');

	const raw =
		(await ai.generate(buildDirectorPrompt(), { systemInstruction: DIRECTOR_SYSTEM, json: true })) ||
		'{}';
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
				{ systemInstruction: DIRECTOR_SYSTEM, json: true }
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
	let qualityGrade = await gradeDraftWithRetry(ai, parsed, selectedProduct?.name ?? null, platform);
	if (floor > 0 && qualityGrade && qualityGrade.overall < floor) {
		console.warn(
			`[QC] Draft graded ${qualityGrade.overall}/10 (< floor ${floor}) — one improvement-guided rewrite: ${qualityGrade.fix}`
		);
		const rewriteRaw =
			(await ai.generate(
				`${buildDirectorPrompt()}\n\nAn independent QC reviewer graded your draft ${qualityGrade.overall}/10. Top issue: ${qualityGrade.topIssue}. Required fix: ${qualityGrade.fix}. Rewrite the ENTIRE JSON applying that fix without losing the persona voice.`,
				{ systemInstruction: DIRECTOR_SYSTEM, json: true }
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

	const format: 'spokesperson' | 'broll' =
		cfg.format === 'auto' ? (parsed.format === 'broll' ? 'broll' : 'spokesperson') : cfg.format;
	// A composer-edited visual brief outranks the Director's scene.
	const scenePrompt =
		input.sceneOverride?.trim() || parsed.scene_prompt || parsed.ugc_broll_prompt || topic;
	const baseMotion =
		parsed.motion_prompt || 'Slow gimbal dolly-in, natural ambient light, product label in focus.';
	const motionPrompt = enhanceMotionPrompt(baseMotion, intent, format);

	// Provider preference from the composer: pinning 'fal' disables the
	// OpenRouter media failover; pinning 'openrouter' skips fal media entirely.
	// (Text/LLM routing is unaffected — this governs media only.)
	const resolvedKeys = await resolveImageKeys(supabase, userId);
	const pref = input.providerPreference || 'auto';
	const falKey = pref === 'openrouter' ? null : resolvedKeys.falKey;
	const orKey = pref === 'fal' ? null : resolvedKeys.orKey;

	// ── Pinned creator face → consistent character across ALL posts ──
	// Composer override wins; when present we also skip lazy face generation.
	// Runs for every format, not just spokesperson video: b-roll stills feature
	// the persona too, and without a pinned face each still invents a brand-new
	// person (three posts, three different "influencers" — the exact identity
	// drift this anchor exists to prevent). First generation for an agent
	// creates + pins the hero portrait; everything after reuses it.
	let characterRef = input.characterRefOverride?.trim() || cfg.characterRef;
	if (input.agentId && !input.characterRefOverride) {
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

	// ── Still (Nano Banana with real product + pinned face, else flux fallback) ──
	// Failover: a fal OUTAGE (balance lock, 5xx) degrades to the OpenRouter
	// text-to-image path — loses product-photo compositing but keeps the slot
	// alive — rather than killing generation outright.
	let still: string;
	const productPhoto = input.productPhotoUrlOverride?.trim() || selectedProduct?.photoUrl || null;
	if (falKey && productPhoto) {
		try {
			still = await generateProductStill(falKey, scenePrompt, productPhoto, characterRef, brandVisualCtx);
			costEvents.push({ provider: 'fal', operation: 'image', model: 'nano-banana-2', usd: priceOf('fal', 'image', 'nano') });
		} catch (e) {
			const msg = (e as Error).message;
			if (orKey && isFalOutage(msg)) {
				// True composite failover: OpenRouter serves the same Nano-Banana
				// model family with image input, so the REAL product (and pinned
				// face) stay in-frame — flux text-to-image is only the last resort.
				try {
					const refs = [characterRef, productPhoto].filter(Boolean) as string[];
					const compositePrompt = `${scenePrompt}\n\nVertical 9:16 photorealistic UGC photo. Keep the product's exact label, shape and colors from the reference image — do not redesign it.${characterRef ? ' Keep the same person/face as the first reference image.' : ''} Authentic, slightly imperfect, real — not a studio ad.`;
					console.warn(`[Failover] fal still failed (${msg.slice(0, 120)}) — OpenRouter Nano-Banana composite fallback.`);
					still = await openRouterImageEdit(orKey, userId, compositePrompt, refs);
					costEvents.push({ provider: 'openrouter', operation: 'image', model: IMAGE_EDIT_MODEL_OPENROUTER, usd: priceOf('openrouter', 'image') });
				} catch (editErr) {
					console.warn(`[Failover] OpenRouter composite also failed (${(editErr as Error).message.slice(0, 120)}) — flux text-to-image last resort.`);
					still = await generateUgcImage(scenePrompt, orKey, null);
					costEvents.push({ provider: 'openrouter', operation: 'image', model: 'flux-schnell', usd: priceOf('openrouter', 'image') });
				}
			} else {
				throw e;
			}
		}
	} else if (orKey && productPhoto) {
		// OpenRouter-pinned (or fal-less) WITH a product photo → real composite
		// via Nano Banana on OpenRouter, not a generic text-to-image scene.
		try {
			const refs = [characterRef, productPhoto].filter(Boolean) as string[];
			const compositePrompt = `${scenePrompt}\n\nVertical 9:16 photorealistic UGC photo. Keep the product's exact label, shape and colors from the reference image — do not redesign it.${characterRef ? ' Keep the same person/face as the first reference image.' : ''} Authentic, slightly imperfect, real — not a studio ad.`;
			still = await openRouterImageEdit(orKey, userId, compositePrompt, refs);
			costEvents.push({ provider: 'openrouter', operation: 'image', model: IMAGE_EDIT_MODEL_OPENROUTER, usd: priceOf('openrouter', 'image') });
		} catch (e) {
			console.warn(`[Composer] OpenRouter composite failed (${(e as Error).message.slice(0, 120)}) — flux fallback.`);
			still = await generateUgcImage(scenePrompt, orKey, null);
			costEvents.push({ provider: 'openrouter', operation: 'image', model: 'flux-schnell', usd: priceOf('openrouter', 'image') });
		}
	} else {
		still = await generateUgcImage(scenePrompt, orKey, falKey);
		costEvents.push(
			orKey
				? { provider: 'openrouter', operation: 'image', model: 'flux-schnell', usd: priceOf('openrouter', 'image') }
				: { provider: 'fal', operation: 'image', model: 'flux-schnell', usd: priceOf('fal', 'image', 'flux') }
		);
	}

	// ── Video — fal primary, OpenRouter video API failover ──────────────
	// Verified 2026-07-04: OpenRouter's /api/v1/videos carries Kling v3.0, so a
	// fal outage degrades b-roll to OpenRouter Kling instead of an image-only
	// post. Spokesperson (TTS + talking-head) is fal-exclusive — on outage it
	// degrades to OpenRouter b-roll format rather than failing the slot.
	const brollModel = resolveModel('video_i2v', input.videoModel);
	let mediaUrl = still;
	let mediaType: 'image' | 'video' = 'image';
	if (wantVideo && (falKey || orKey)) {
		try {
			if (format === 'spokesperson' && falKey) {
				const dialogue = parsed.dialogue || parsed.text || topic;
				const audio = await generateVoiceAudio(falKey, resolvedVoice, dialogue);
				costEvents.push({ provider: 'fal', operation: 'tts', model: 'elevenlabs-turbo-v2.5', usd: priceOf('fal', 'tts') });
				mediaUrl = await generateTalkingHead(falKey, still, audio);
				costEvents.push({ provider: 'fal', operation: 'talking_head', model: 'veed-fabric-1.0', usd: priceOf('fal', 'talking_head') });
			} else if (falKey) {
				// The user picked this tier in the composer (Wan $0.10 → Veo $1.50); bill
				// what actually ran rather than a hard-coded Kling Standard rate.
				mediaUrl = await generateBrollVideo(falKey, brollModel.id, still, motionPrompt);
				costEvents.push({ provider: 'fal', operation: 'video', model: brollModel.label, usd: brollModel.usd });
			} else {
				// No fal at all — straight to OpenRouter video.
				mediaUrl = await openRouterBrollVideo(orKey!, userId, still, motionPrompt);
				costEvents.push({ provider: 'openrouter', operation: 'video', model: BROLL_MODEL_OPENROUTER, usd: priceOf('openrouter', 'video') });
			}
			mediaType = 'video';
		} catch (e) {
			const msg = (e as Error).message;
			if (orKey && isFalOutage(msg)) {
				console.warn(`[Failover] fal video failed (${msg.slice(0, 120)}) — OpenRouter Kling b-roll fallback.`);
				mediaUrl = await openRouterBrollVideo(orKey, userId, still, motionPrompt);
				costEvents.push({ provider: 'openrouter', operation: 'video', model: BROLL_MODEL_OPENROUTER, usd: priceOf('openrouter', 'video') });
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
	const svc = (() => {
		try {
			return getServiceSupabase();
		} catch {
			return null; // No service-role key configured at all.
		}
	})();
	if (svc) {
		durableStill = await persistToStorage(svc, still, userId, 'png');
		if (mediaType === 'video') {
			const captioned = parsed.on_screen_text
				? await burnCaptions(mediaUrl, parsed.on_screen_text).catch(() => null)
				: null;
			durableMedia = captioned
				? await persistBufferToStorage(svc, captioned, userId, 'mp4', 'video/mp4')
				: await persistToStorage(svc, mediaUrl, userId, 'mp4');
		} else {
			durableMedia = durableStill;
		}
	} else {
		console.warn(
			'[generate] No service-role Supabase key configured — storing EPHEMERAL provider URLs (media is NOT backed up).'
		);
	}

	// Record durable asset URLs in the ledger (flushed in finally) so this spend
	// is always recoverable from the DB even if a later step throws.
	if (durableMedia)
		costEvents.push({ provider: 'storage', operation: 'persist', model: 'ugc-media', usd: 0, assetUrl: durableMedia });
	if (durableStill && durableStill !== durableMedia)
		costEvents.push({ provider: 'storage', operation: 'persist', model: 'ugc-media', usd: 0, assetUrl: durableStill });

	const content: UgcContent = {
		text: parsed.text || '',
		hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
		hookScore: parsed.hookScore,
		dialogue: parsed.dialogue || '',
		on_screen_text: parsed.on_screen_text || '',
		ugc_broll_prompt: parsed.scene_prompt || parsed.ugc_broll_prompt || '',
		script: parsed.script || parsed.dialogue || '',
		media_url: durableMedia,
		poster_url: durableStill,
		media_type: mediaType,
		media_generated: true,
		format,
		voice: resolvedVoice,
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
		images: { character_ref: characterRef || null, product_photo: productPhoto || null },
		prompts: { scene: scenePrompt, script: content.script },
		selections: {
			platforms: [platform],
			brand: briefData?.name ?? briefData?.brandName ?? briefData?.data?.brandName ?? null,
			videoModel: input.videoModel ?? null,
			provider: input.providerPreference ?? null,
			mediaType
		}
	};

	return { content, selectedProduct, briefData, agentData };
	} finally {
		// Flush the ledger even if generation threw partway through — otherwise
		// every failed/retried generation is silent spend the cap never sees.
		await recordCostEvents(supabase, userId, input.agentId, costEvents, input.postId);
	}
}
