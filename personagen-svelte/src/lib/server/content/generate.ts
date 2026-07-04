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
	// Kling O3 takes `image_url` as the start frame (verified against the live
	// OpenAPI spec above — the older v3/pro shape's `start_image_url` is NOT in
	// this spec and fails validation). Veo also uses image_url but adds resolution.
	const isKling = model.includes('kling');
	const input: any = isKling
		? {
				image_url: stillUrl,
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

// ── OpenRouter video failover (verified 2026-07-04 against the live API) ────
// OpenRouter now ships a Video Generation API (POST /api/v1/videos, async job
// with polling_url → unsigned_urls) carrying kwaivgi/kling-v3.0-std|pro,
// google/veo-3.1(-fast|-lite), seedance, wan, etc. Used as the b-roll fallback
// when fal is down (balance lock, outage) so autopilot keeps producing video.

const BROLL_MODEL_OPENROUTER = env.UGC_BROLL_MODEL_OR || 'kwaivgi/kling-v3.0-std';

/** fal failures that warrant provider failover (vs. bad-input errors that would fail anywhere). */
function isFalOutage(msg: string): boolean {
	return /exhausted balance|user is locked|\b403\b|\b429\b|\b5\d\d\b|timed out|ECONNRESET|fetch failed/i.test(
		msg
	);
}

/** Image-to-video via OpenRouter's async videos API. Returns the finished video URL. */
async function openRouterBrollVideo(
	orKey: string,
	stillUrl: string,
	motionPrompt: string,
	timeoutMs = 270000
): Promise<string> {
	const submit = await fetch('https://openrouter.ai/api/v1/videos', {
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
			generate_audio: false,
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
		const res = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${orKey}` } });
		if (!res.ok) continue;
		const st = (await res.json()) as any;
		if (st.status === 'completed') {
			const url = st.unsigned_urls?.[0] || st.urls?.[0] || st.video?.url;
			if (!url) throw new Error('OpenRouter video completed but returned no URL');
			return url;
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
		agentContext = buildRichAgentContext(agent);
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
	let cinematicGrade = await gradeDraft(ai, parsed, selectedProduct?.name ?? null, platform);
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
				generateProductStill(falKey, shot.prompt, selectedProduct.photoUrl, characterRef, cinematicBrandVisualCtx).catch((err) => {
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
		cinematic: true,
		qualityGrade: cinematicGrade
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
	/** Independent QC grade (pre-media gate) — surfaced in the review queue. */
	qualityGrade?: QualityGrade | null;
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
	// 1. Config/brief-tuned hero portrait → pinned as the profile picture.
	const durable = await generateHeroPortraitImage(svc, userId, falKey, briefData, agentData, voiceGender);
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
		const sheetUrl = sheetData.images?.[0]?.url;
		if (!sheetUrl) throw new Error('Nano Banana returned no character sheet');

		let durableSheet = sheetUrl;
		try {
			durableSheet = await persistToStorage(svc, sheetUrl, userId, 'png');
		} catch {
			/* keep provider url */
		}

		const heroShotUrl = await generateAvatarHeroShot(falKey, sheetUrl);
		let durableFull = heroShotUrl;
		try {
			durableFull = await persistToStorage(svc, heroShotUrl, userId, 'png');
		} catch {
			/* keep provider url */
		}

		await mergeReferenceKit(supabase, agentId, { sheet: durableSheet, full_body: durableFull }, true);
	} catch (err) {
		console.warn(
			'[Content] Character-sheet foundation generation failed; kit stages will need a reference photo:',
			(err as Error).message
		);
		await mergeReferenceKit(supabase, agentId, { full_body: durable }, true);
	}

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
			agentContext = buildRichAgentContext(agent);
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
	let qualityGrade = await gradeDraft(ai, parsed, selectedProduct?.name ?? null, platform);
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
	const scenePrompt = parsed.scene_prompt || parsed.ugc_broll_prompt || topic;
	const baseMotion =
		parsed.motion_prompt || 'Slow gimbal dolly-in, natural ambient light, product label in focus.';
	const motionPrompt = enhanceMotionPrompt(baseMotion, intent, format);

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
	// Failover: a fal OUTAGE (balance lock, 5xx) degrades to the OpenRouter
	// text-to-image path — loses product-photo compositing but keeps the slot
	// alive — rather than killing generation outright.
	let still: string;
	if (falKey && selectedProduct?.photoUrl) {
		try {
			still = await generateProductStill(falKey, scenePrompt, selectedProduct.photoUrl, characterRef, brandVisualCtx);
		} catch (e) {
			const msg = (e as Error).message;
			if (orKey && isFalOutage(msg)) {
				console.warn(`[Failover] fal still failed (${msg.slice(0, 120)}) — OpenRouter image fallback.`);
				still = await generateUgcImage(scenePrompt, orKey, null);
			} else {
				throw e;
			}
		}
	} else {
		still = await generateUgcImage(scenePrompt, orKey, falKey);
	}

	// ── Video — fal primary, OpenRouter video API failover ──────────────
	// Verified 2026-07-04: OpenRouter's /api/v1/videos carries Kling v3.0, so a
	// fal outage degrades b-roll to OpenRouter Kling instead of an image-only
	// post. Spokesperson (TTS + talking-head) is fal-exclusive — on outage it
	// degrades to OpenRouter b-roll format rather than failing the slot.
	let mediaUrl = still;
	let mediaType: 'image' | 'video' = 'image';
	if (wantVideo && (falKey || orKey)) {
		try {
			if (format === 'spokesperson' && falKey) {
				const dialogue = parsed.dialogue || parsed.text || topic;
				const audio = await generateVoiceAudio(falKey, cfg.voice, dialogue);
				mediaUrl = await generateTalkingHead(falKey, still, audio);
			} else if (falKey) {
				// Both quality tiers route to Kling Standard for now — see BROLL_MODEL_VEO_DEFERRED.
				mediaUrl = await generateBrollVideo(falKey, BROLL_MODEL_STANDARD, still, motionPrompt);
			} else {
				// No fal at all — straight to OpenRouter video.
				mediaUrl = await openRouterBrollVideo(orKey!, still, motionPrompt);
			}
			mediaType = 'video';
		} catch (e) {
			const msg = (e as Error).message;
			if (orKey && isFalOutage(msg)) {
				console.warn(`[Failover] fal video failed (${msg.slice(0, 120)}) — OpenRouter Kling b-roll fallback.`);
				mediaUrl = await openRouterBrollVideo(orKey, still, motionPrompt);
				mediaType = 'video';
			} else {
				throw e;
			}
		}
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
		platform,
		qualityGrade
	};
	if (input.autopilot) content.autopilot = true;

	return { content, selectedProduct, briefData, agentData };
}
