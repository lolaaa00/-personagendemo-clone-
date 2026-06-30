/**
 * Shared UGC content generation.
 *
 * Pipeline (all on the user's fal key + an LLM key):
 *   1. LLM "director"  -> JSON: caption, hashtags, dialogue, on-screen text, scene & motion prompts
 *   2. Nano Banana     -> product-accurate still (real product + optional pinned creator face)
 *   3a. spokesperson   -> ElevenLabs TTS (pinned voice) -> VEED Fabric talking head
 *   3b. b-roll         -> Kling v3 Pro (mvp) / Veo 3.1 (premium) motion clip
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
import { DEFAULT_VOICE } from '$lib/server/voices';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { persistToStorage } from '$lib/server/storage';

// ── Model slugs (env-overridable so quality/provider is a one-line swap) ─────
const NANO_MODEL = env.UGC_NANO_MODEL || 'fal-ai/gemini-25-flash-image/edit';
const TTS_MODEL = env.UGC_TTS_MODEL || 'fal-ai/elevenlabs/tts/turbo-v2.5';
const TALKINGHEAD_MODEL = env.UGC_TALKINGHEAD_MODEL || 'veed/fabric-1.0';
const BROLL_MODEL_MVP = env.UGC_BROLL_MODEL || 'fal-ai/kling-video/v3/pro/image-to-video';
const BROLL_MODEL_PREMIUM = env.UGC_BROLL_MODEL_PREMIUM || 'fal-ai/veo3.1/image-to-video';
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

// ── Per-agent UGC config (read defensively from agent_configs) ──────────────

interface UgcConfig {
	voice: string;
	format: 'auto' | 'spokesperson' | 'broll';
	quality: 'mvp' | 'premium';
	characterRef: string | null;
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
		characterRef: row?.ugc_character_ref || null
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

	// ── Still (Nano Banana with real product, else flux fallback) ───────
	let still: string;
	if (falKey && selectedProduct?.photoUrl) {
		still = await generateProductStill(
			falKey,
			scenePrompt,
			selectedProduct.photoUrl,
			cfg.characterRef
		);
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
			const model = cfg.quality === 'premium' ? BROLL_MODEL_PREMIUM : BROLL_MODEL_MVP;
			mediaUrl = await generateBrollVideo(falKey, model, still, motionPrompt);
		}
		mediaType = 'video';
	}

	// ── Persist to durable storage (don't rely on the provider's ephemeral CDN) ──
	let durableStill = still;
	let durableMedia = mediaUrl;
	try {
		const svc = getServiceSupabase();
		durableStill = await persistToStorage(svc, still, userId, 'png').catch(() => still);
		durableMedia =
			mediaType === 'video'
				? await persistToStorage(svc, mediaUrl, userId, 'mp4').catch(() => mediaUrl)
				: durableStill;
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
