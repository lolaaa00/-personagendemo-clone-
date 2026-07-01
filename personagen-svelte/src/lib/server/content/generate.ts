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
import { resolveAiClient } from '$lib/server/ai-client';
import { createDbService } from '$lib/server/db';
import { DEFAULT_VOICE, VOICE_CATALOG } from '$lib/server/voices';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { persistToStorage, persistBufferToStorage } from '$lib/server/storage';
import { burnCaptions } from '$lib/server/video';

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

/** Tolerant JSON parse for AI responses (strips markdown fences). */
export function safeParseJson(text: string): any {
	try {
		const cleaned = text
			.replace(/```json/g, '')
			.replace(/```/g, '')
			.trim();
		return JSON.parse(cleaned);
	} catch (e) {
		console.warn('[Content] Failed to parse AI response as JSON:', e);
		return null;
	}
}

/** Resolves the OpenRouter + fal.ai keys available for media generation. */
export async function resolveImageKeys(
	supabase: any,
	userId: string
): Promise<{ orKey: string | null; falKey: string | null }> {
	const orKey = await getUserApiKey(supabase, userId, 'openrouter').catch(() => null);
	const userFalKey = await getUserApiKey(supabase, userId, 'fal_ai').catch(() => null);
	const falKey = userFalKey || env.FAL_API_KEY || process.env.FAL_API_KEY || null;
	return { orKey, falKey };
}

// ── fal helpers ─────────────────────────────────────────────────────────────

async function falSyncJson(model: string, input: any, falKey: string): Promise<any> {
	const res = await fetch(`https://fal.run/${model}`, {
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
	const sub = await fetch(`https://queue.fal.run/${model}`, {
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
		const s = await fetch(status_url, { headers: { Authorization: `Key ${falKey}` } });
		if (!s.ok) continue;
		const st = (await s.json()) as any;
		if (st.status === 'COMPLETED') {
			const r = await fetch(response_url, { headers: { Authorization: `Key ${falKey}` } });
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
export async function generateUgcImage(
	ugcPrompt: string,
	orKey: string | null,
	falKey: string | null
): Promise<string> {
	const imagePrompt = `UGC lifestyle photo, candid and authentic, shot on iPhone, natural lighting, real person not staged. ${ugcPrompt}`;
	if (orKey) {
		const orRes = await fetch('https://openrouter.ai/api/v1/images/generations', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${orKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://personagen.app',
				'X-Title': 'PersonaGen'
			},
			body: JSON.stringify({
				model: 'black-forest-labs/flux-schnell',
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
			'fal-ai/flux/schnell',
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

/** Nano Banana: composite the real product (+ optional pinned face) into a UGC scene. */
async function generateProductStill(
	falKey: string,
	scenePrompt: string,
	productPhotoUrl: string | null,
	characterRef: string | null
): Promise<string> {
	const refs = [characterRef, productPhotoUrl].filter(Boolean) as string[];
	const prompt = `${scenePrompt}\n\nVertical 9:16 photorealistic UGC photo. Keep the product's exact label, shape and colors from the reference image — do not redesign it.${characterRef ? ' Keep the same person/face as the first reference image.' : ''} Authentic, slightly imperfect, real — not a studio ad.`;
	const data = await falSyncJson(
		NANO_MODEL,
		{ prompt, image_urls: refs, aspect_ratio: '9:16' },
		falKey
	);
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
	// Kling uses start_image_url; Veo and most others use image_url.
	const isKling = model.includes('kling');
	const input: any = isKling
		? {
				start_image_url: stillUrl,
				prompt: motionPrompt,
				duration: VIDEO_DURATION,
				generate_audio: false
			}
		: { image_url: stillUrl, prompt: motionPrompt, generate_audio: false, resolution: '1080p' };
	const data = await falQueueJson(model, input, falKey);
	const url = data.video?.url;
	if (!url) throw new Error('B-roll model returned no video');
	return url;
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

const CINEMATIC_DIRECTOR_SYSTEM = `You are a world-class commercial/UGC director storyboarding a short vertical ad.
Strict rules:
- Caption: 1 punchy hook + 1-2 authentic lines + 1 natural CTA. No hashtags in the caption.
- BANNED words: "elevate", "premium quality", "transform", "game-changer", "innovative", "discover", "unlock potential".
- The character is referenced as @Element1 and the product as @Image1 — every single shot's prompt MUST mention both @Element1 and @Image1, clearly visible together. Never a shot of just the environment or just the product alone. This is the most important rule.
- Each shot prompt must describe ONE dominant action/camera move only (per current video-model best practice, a single prompt trying to cover multiple actions produces worse, blended results) — sequence distinct beats as separate shots instead of packing them into one.
- 3 to 5 shots total, each shot's "duration" between "3" and "6" seconds, summing to at most 15 seconds.
- Respond with ONLY valid JSON. No markdown fences.

JSON schema:
{
  "format": "broll",
  "text": "caption — hook, 1-2 personal lines, CTA (no hashtags)",
  "hashtags": ["#a","#b","#c","#d","#e"],
  "hookScore": <integer 70-99>,
  "on_screen_text": "<=6 word burned-in caption hook",
  "shots": [
    { "prompt": "shot 1: what's shown, one dominant action, camera move, framing — @Element1 and @Image1 both visible", "duration": "3" },
    { "prompt": "shot 2: ...", "duration": "3" }
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
	// Four independent lookups (none depends on another's result) — run
	// concurrently rather than paying 4 sequential round-trips.
	const [ai, cfg, agentResult, brandBriefResult] = await Promise.all([
		resolveAiClient(supabase, userId),
		loadUgcConfig(supabase, input.agentId),
		input.agentId ? db.agents.get(input.agentId) : Promise.resolve({ data: null as any }),
		db.brandBriefs.get(userId)
	]);
	if (!ai)
		throw new Error('No AI provider configured. Add an OpenRouter or Gemini key in Settings.');

	const voiceGender = VOICE_CATALOG.find((v) => v.name === cfg.voice)?.gender;

	let agentContext = '';
	let agentData: any = null;
	const agent = agentResult?.data;
	if (agent) {
		agentData = agent;
		agentContext = `You are ${agent.name} (@${agent.handle}), a ${agent.niche} creator. Personality: ${agent.soul || 'authentic and relatable'}.`;
	}

	let selectedProduct: any = null;
	let briefData: any = null;
	const brandBrief = brandBriefResult?.data;
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

	const prompt = `${agentContext}
Product: "${selectedProduct.name}" — ${selectedProduct.description || 'no description'}. Price: ${selectedProduct.price || 'N/A'}.
${briefData ? `Brand: ${briefData.brandName || ''}. Voice: ${briefData.commStyle || 'authentic'}. Audience: ${briefData.demographics || 'general'}. Pain points: ${briefData.painPoints || 'N/A'}.` : ''}
${voiceGender ? `The on-camera character should read as ${voiceGender}, matching the pinned voice.` : ''}
Angle for this post: "${topic}". Output ONLY the JSON.`;

	const raw =
		(await ai.generate(prompt, { systemInstruction: CINEMATIC_DIRECTOR_SYSTEM, json: true })) ||
		'{}';
	const parsed = safeParseJson(raw);
	if (!parsed) throw new Error('AI returned unparseable response');

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

	// Pinned character face — same consistency anchor as the standard spokesperson path.
	const characterRef = await ensureCharacterRef(
		supabase,
		svc,
		userId,
		input.agentId,
		cfg.characterRef,
		falKey,
		briefData,
		agentData,
		voiceGender
	);

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
				generateProductStill(falKey, shot.prompt, selectedProduct.photoUrl, characterRef).catch((err) => {
					console.warn(`[Cinematic] Storyboard still ${i + 1}/${shots.length} failed, skipping:`, err);
					return null;
				})
			)
		)
	).filter((url): url is string => Boolean(url));

	const durableStoryboard = await Promise.all(
		storyboard.map((url) => persistToStorage(svc, url, userId, 'png').catch(() => url))
	);

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

	const captioned = parsed.on_screen_text
		? await burnCaptions(videoUrl, parsed.on_screen_text).catch(() => null)
		: null;
	const durableMedia = captioned
		? await persistBufferToStorage(svc, captioned, userId, 'mp4', 'video/mp4').catch(() => videoUrl)
		: await persistToStorage(svc, videoUrl, userId, 'mp4').catch(() => videoUrl);

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
		voice: cfg.voice,
		product: {
			name: selectedProduct.name,
			price: selectedProduct.price,
			description: selectedProduct.description
		},
		platform,
		storyboard: durableStoryboard,
		cinematic: true
	};
	if (input.autopilot) content.autopilot = true;

	return { content, selectedProduct, briefData, agentData };
}

// ── Per-agent UGC config (read defensively from agent_configs) ──────────────

interface UgcConfig {
	voice: string;
	format: 'auto' | 'spokesperson' | 'broll';
	quality: 'mvp' | 'premium';
	characterRef: string | null;
	/** full_body/side_profiles/face_closeup/feature_grid, from the Profile tab's reference-kit flow. */
	referenceKit: Record<string, string> | null;
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
		referenceKit: row?.ugc_reference_kit || null
	};
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
}

export interface UgcPack {
	content: UgcContent;
	selectedProduct: any | null;
	briefData: any | null;
	agentData: any | null;
}

const DIRECTOR_SYSTEM = `You are a world-class short-form UGC creator. You write like a real person, never like a brand.
Strict rules:
- Caption: 1 punchy hook + 1-2 authentic lines + 1 natural CTA. No hashtags in the caption.
- BANNED words: "elevate", "premium quality", "transform", "game-changer", "innovative", "discover", "unlock potential".
- The spoken "dialogue" is a first-person testimonial, ~6-10 seconds when read aloud, casual and specific.
- Respond with ONLY valid JSON. No markdown fences.

JSON schema:
{
  "format": "spokesperson" | "broll",
  "text": "caption — hook, 1-2 personal lines, CTA (no hashtags)",
  "hashtags": ["#a","#b","#c","#d","#e"],
  "hookScore": <integer 70-99>,
  "dialogue": "spoken first-person testimonial line(s), ~6-10s",
  "on_screen_text": "<=6 word burned-in caption hook",
  "scene_prompt": "what the still shows: for spokesperson a real person holding the product in a real setting; for broll the product in a real setting. Specific location, lighting, framing.",
  "motion_prompt": "for broll only: subtle camera/product motion (slow push-in, hand enters frame, gentle rotate)"
}`;

/** Generates (and durably persists) a fresh hero portrait image. No DB pin — just the image. */
async function generateHeroPortraitImage(
	svc: any,
	userId: string,
	falKey: string,
	briefData: any,
	agentData: any,
	voiceGender: 'male' | 'female' | undefined
): Promise<string> {
	const audience = briefData?.demographics || 'a general lifestyle audience';
	const persona = agentData?.soul ? ` Personality vibe: ${String(agentData.soul).slice(0, 120)}.` : '';
	// This face is pinned and reused for every future spokesperson video for this
	// agent, so it must match the agent's configured voice gender once, up front —
	// there's no per-post opportunity to correct it after the fact.
	const genderLine = voiceGender ? ` The creator is ${voiceGender}, matching the agent's pinned voice.` : '';
	const heroPrompt = `Photorealistic vertical portrait of one relatable UGC content creator who fits this audience: ${audience}.${persona}${genderLine} Friendly, casual, natural window light, looking straight at the camera, authentic iPhone selfie style, clear visible face, upper body. Single person only.`;

	const heroUrl = await generateUgcImage(heroPrompt, null, falKey);
	try {
		return await persistToStorage(svc, heroUrl, userId, 'png');
	} catch {
		return heroUrl;
	}
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
	voiceGender: 'male' | 'female' | undefined
): Promise<string> {
	const durable = await generateHeroPortraitImage(svc, userId, falKey, briefData, agentData, voiceGender);

	await supabase.from('agent_configs').update({ ugc_character_ref: durable }).eq('agent_id', agentId);
	// Replace, not merge: a fresh from-scratch face invalidates any
	// side_profiles/face_closeup/feature_grid derived from a previous face
	// (whether from an earlier regenerate or an earlier uploaded photo).
	await mergeReferenceKit(supabase, agentId, { full_body: durable }, true);
	return durable;
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
async function mergeReferenceKit(
	supabase: any,
	agentId: string,
	patch: Record<string, string>,
	replace = false
): Promise<void> {
	let merged = patch;
	if (!replace) {
		const { data } = await supabase
			.from('agent_configs')
			.select('ugc_reference_kit')
			.eq('agent_id', agentId)
			.maybeSingle();
		merged = { ...(data?.ugc_reference_kit || {}), ...patch };
	}
	await supabase.from('agent_configs').update({ ugc_reference_kit: merged }).eq('agent_id', agentId);
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
	const data = await falSyncJson(
		NANO_MODEL,
		{ prompt: CHARACTER_SHEET_PROMPT, image_urls: [referenceImageUrl], aspect_ratio: '16:9' },
		falKey
	);
	const sheetUrl = data.images?.[0]?.url;
	if (!sheetUrl) throw new Error('Nano Banana returned no image');

	let durableSheet = sheetUrl;
	try {
		durableSheet = await persistToStorage(svc, sheetUrl, userId, 'png');
	} catch {
		/* keep provider url */
	}

	const heroShotUrl = await generateAvatarHeroShot(falKey, sheetUrl);

	let durable = heroShotUrl;
	try {
		durable = await persistToStorage(svc, heroShotUrl, userId, 'png');
	} catch {
		/* keep provider url */
	}

	await supabase.from('agent_configs').update({ ugc_character_ref: durable }).eq('agent_id', agentId);
	// Replace, not merge: a newly uploaded photo is a new identity, so any
	// side_profiles/face_closeup/feature_grid derived from a previous photo
	// (or a previous from-scratch face) no longer depict the same person.
	await mergeReferenceKit(supabase, agentId, { sheet: durableSheet, full_body: durable }, true);
	return durable;
}

/**
 * Stage 3's fixed prompt: given the approved full-body shot + the original
 * turnaround sheet, produce one composite image of the character's left and
 * right side profiles, preserving facial detail/imperfections (facial hair,
 * skin texture, etc.) at high fidelity.
 */
const SIDE_PROFILE_PROMPT =
	'Upscale this and the character sheet to 4K resolution for maximum detail. I need a close-up shot of his side profile, left and right, to retain his facial details and imperfections including facial hair etc. Output as one high quality composite image.';

/**
 * Stage 3: takes the approved full-body hero shot + the stage-1 turnaround
 * sheet and produces one composite of both side profiles (left + right), for
 * maximum facial-detail consistency. Persists the result and merges it into
 * `ugc_reference_kit.side_profiles` — does not touch `ugc_character_ref`
 * (the primary avatar stays the full-body shot from stage 2).
 */
export async function generateSideProfileComposite(
	supabase: any,
	svc: any,
	userId: string,
	agentId: string,
	falKey: string,
	fullBodyShotUrl: string,
	characterSheetUrl: string
): Promise<string> {
	const data = await falSyncJson(
		NANO_MODEL,
		{
			prompt: SIDE_PROFILE_PROMPT,
			image_urls: [fullBodyShotUrl, characterSheetUrl],
			aspect_ratio: '16:9'
		},
		falKey
	);
	const url = data.images?.[0]?.url;
	if (!url) throw new Error('Nano Banana returned no image for the side-profile composite');

	let durable = url;
	try {
		durable = await persistToStorage(svc, url, userId, 'png');
	} catch {
		/* keep provider url */
	}

	await mergeReferenceKit(supabase, agentId, { side_profiles: durable });
	return durable;
}

/**
 * Stage 4's fixed prompt: an extreme facial close-up, for maximum
 * skin-texture/feature fidelity in the reference kit.
 */
const FACE_CLOSEUP_PROMPT = 'give me a close up of this man focusing on his facial features';

/**
 * Stage 4: takes the stage-3 side-profile composite (richest facial-detail
 * reference so far) and produces one extreme facial close-up. Persists the
 * result and merges it into `ugc_reference_kit.face_closeup`.
 */
export async function generateFacialCloseup(
	supabase: any,
	svc: any,
	userId: string,
	agentId: string,
	falKey: string,
	referenceImageUrl: string
): Promise<string> {
	const data = await falSyncJson(
		NANO_MODEL,
		{ prompt: FACE_CLOSEUP_PROMPT, image_urls: [referenceImageUrl], aspect_ratio: '1:1' },
		falKey
	);
	const url = data.images?.[0]?.url;
	if (!url) throw new Error('Nano Banana returned no image for the facial close-up');

	let durable = url;
	try {
		durable = await persistToStorage(svc, url, userId, 'png');
	} catch {
		/* keep provider url */
	}

	await mergeReferenceKit(supabase, agentId, { face_closeup: durable });
	return durable;
}

/**
 * Stage 5's fixed prompt: a labelless grid of individual feature close-ups
 * (eyes, lips, nose, lashes, brow, hair) — a companion to stage 4's single
 * close-up, giving the kit per-feature detail crops in one image.
 */
const FEATURE_GRID_PROMPT =
	"give me a grid of close up shots of the man's features such as eyes, lips, nose, lashes, brow, and hair.";

/**
 * Stage 5: takes the facial close-up (+ the original turnaround sheet, which
 * already has hair/skin/clothing detail panels) and produces a labelless grid
 * of individual feature close-ups. Persists the result and merges it into
 * `ugc_reference_kit.feature_grid`.
 */
export async function generateFeatureGrid(
	supabase: any,
	svc: any,
	userId: string,
	agentId: string,
	falKey: string,
	faceCloseupUrl: string,
	characterSheetUrl: string
): Promise<string> {
	const data = await falSyncJson(
		NANO_MODEL,
		{
			prompt: FEATURE_GRID_PROMPT,
			image_urls: [faceCloseupUrl, characterSheetUrl],
			aspect_ratio: '1:1'
		},
		falKey
	);
	const url = data.images?.[0]?.url;
	if (!url) throw new Error('Nano Banana returned no image for the feature grid');

	let durable = url;
	try {
		durable = await persistToStorage(svc, url, userId, 'png');
	} catch {
		/* keep provider url */
	}

	await mergeReferenceKit(supabase, agentId, { feature_grid: durable });
	return durable;
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

	const ai = await resolveAiClient(supabase, userId);
	if (!ai)
		throw new Error('No AI provider configured. Add an OpenRouter or Gemini key in Settings.');

	const db = createDbService(supabase);
	const cfg = await loadUgcConfig(supabase, input.agentId);
	// The on-camera character's depicted gender must match the configured voice —
	// the Director/character-ref prompts below don't know about `cfg.voice` on
	// their own, so this is threaded through explicitly to avoid e.g. a male
	// voice narrating a video of a female creator.
	const voiceGender = VOICE_CATALOG.find((v) => v.name === cfg.voice)?.gender;

	// ── Load agent persona ──────────────────────────────────────────────
	let agentContext = '';
	let agentData: any = null;
	if (input.agentId) {
		const { data: agent } = await db.agents.get(input.agentId);
		if (agent) {
			agentData = agent;
			agentContext = `You are ${agent.name} (@${agent.handle}), a ${agent.niche} creator. Personality: ${agent.soul || 'authentic and relatable'}.`;
		}
	}

	// ── Brand brief + product ───────────────────────────────────────────
	let selectedProduct: any = null;
	let briefData: any = null;
	const { data: brandBrief } = await db.brandBriefs.get(userId);
	if (brandBrief?.data) {
		briefData = brandBrief.data;
		const products = Array.isArray(briefData.products) ? briefData.products : [];
		selectedProduct = input.productId
			? products.find((p: any) => p.id === input.productId)
			: products.find((p: any) => p.photoUrl) || products[0];
	}

	// ── Director (LLM) ──────────────────────────────────────────────────
	const prompt = `${agentContext}
${selectedProduct ? `Product: "${selectedProduct.name}" — ${selectedProduct.description || 'no description'}. Price: ${selectedProduct.price || 'N/A'}.` : `Topic: "${topic}"`}
${briefData ? `Brand: ${briefData.brandName || ''}. Voice: ${briefData.commStyle || 'authentic'}. Audience: ${briefData.demographics || 'general'}. Pain points: ${briefData.painPoints || 'N/A'}.` : ''}
Requested format: ${cfg.format === 'auto' ? 'choose the best of spokesperson or broll' : cfg.format}.
${voiceGender ? `If the scene shows a person on camera, they should read as ${voiceGender} — the pinned voice is ${voiceGender}, and the two must match.` : ''}
Angle for this post: "${topic}". Output ONLY the JSON.`;

	const raw =
		(await ai.generate(prompt, { systemInstruction: DIRECTOR_SYSTEM, json: true })) || '{}';
	let parsed = safeParseJson(raw);
	if (!parsed) throw new Error('AI returned unparseable response');
	if (parsed.text && typeof parsed.text === 'string' && parsed.text.trim().startsWith('{')) {
		try {
			parsed = { ...parsed, ...JSON.parse(parsed.text) };
		} catch {
			/* ignore */
		}
	}

	const format: 'spokesperson' | 'broll' =
		cfg.format === 'auto' ? (parsed.format === 'broll' ? 'broll' : 'spokesperson') : cfg.format;
	const scenePrompt = parsed.scene_prompt || parsed.ugc_broll_prompt || topic;
	const motionPrompt =
		parsed.motion_prompt || 'Subtle handheld motion, gentle push-in, soft natural light.';

	const { orKey, falKey } = await resolveImageKeys(supabase, userId);

	// ── Pinned creator face (spokesperson) → consistent character across posts ──
	let characterRef = cfg.characterRef;
	if (format === 'spokesperson' && wantVideo) {
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
	let still: string;
	if (falKey && selectedProduct?.photoUrl) {
		still = await generateProductStill(falKey, scenePrompt, selectedProduct.photoUrl, characterRef);
	} else {
		still = await generateUgcImage(scenePrompt, orKey, falKey);
	}

	// ── Video (skip for fast preview, or when no fal key) ───────────────
	let mediaUrl = still;
	let mediaType: 'image' | 'video' = 'image';
	if (wantVideo && falKey) {
		if (format === 'spokesperson') {
			const dialogue = parsed.dialogue || parsed.text || topic;
			const audio = await generateVoiceAudio(falKey, cfg.voice, dialogue);
			mediaUrl = await generateTalkingHead(falKey, still, audio);
		} else {
			// Both quality tiers route to Kling Standard for now — see BROLL_MODEL_VEO_DEFERRED.
			mediaUrl = await generateBrollVideo(falKey, BROLL_MODEL_STANDARD, still, motionPrompt);
		}
		mediaType = 'video';
	}

	// ── Burn captions + AI badge (best-effort), then persist to durable storage ──
	let durableStill = still;
	let durableMedia = mediaUrl;
	try {
		const svc = getServiceSupabase();
		durableStill = await persistToStorage(svc, still, userId, 'png').catch(() => still);
		if (mediaType === 'video') {
			const captioned = parsed.on_screen_text
				? await burnCaptions(mediaUrl, parsed.on_screen_text).catch(() => null)
				: null;
			durableMedia = captioned
				? await persistBufferToStorage(svc, captioned, userId, 'mp4', 'video/mp4').catch(() => mediaUrl)
				: await persistToStorage(svc, mediaUrl, userId, 'mp4').catch(() => mediaUrl);
		} else {
			durableMedia = durableStill;
		}
	} catch {
		// No service-role key configured — keep the provider URLs.
	}

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
		voice: cfg.voice,
		product: selectedProduct
			? {
					name: selectedProduct.name,
					price: selectedProduct.price,
					description: selectedProduct.description
				}
			: null,
		platform
	};
	if (input.autopilot) content.autopilot = true;

	return { content, selectedProduct, briefData, agentData };
}
