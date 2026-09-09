/**
 * Voice catalog for UGC characters.
 *
 * Each agent pins one `voice` (the `name` below) in its config; the engine passes
 * that name to ElevenLabs TTS (via fal) for every post, giving a constant voice.
 *
 * The config UI lists these and calls POST /api/voices to play a sample.
 */

import { env } from '$env/dynamic/private';

export interface VoiceOption {
	/** Value passed to the TTS `voice` field — an ElevenLabs voice name or voice ID. */
	name: string;
	/** Display label for the picker. */
	label: string;
	gender: 'male' | 'female';
	/** Short vibe description for the picker. */
	style: string;
	/** Accent tag shown in the picker (e.g. 'American', 'British', 'Australian'). */
	accent?: string;
}

const BUILTIN_VOICES: VoiceOption[] = [
	// ── Male · American ────────────────────────────────────────────────────
	{
		name: 'Adam',
		label: 'Adam',
		gender: 'male',
		style: 'Deep, natural, confident',
		accent: 'American'
	},
	{ name: 'Brian', label: 'Brian', gender: 'male', style: 'Warm narrator', accent: 'American' },
	{ name: 'Bill', label: 'Bill', gender: 'male', style: 'Mature, trustworthy', accent: 'American' },
	{
		name: 'Chris',
		label: 'Chris',
		gender: 'male',
		style: 'Casual, real-guy energy',
		accent: 'American'
	},
	{
		name: 'Will',
		label: 'Will',
		gender: 'male',
		style: 'Friendly, conversational',
		accent: 'American'
	},
	{
		name: 'Liam',
		label: 'Liam',
		gender: 'male',
		style: 'Young, energetic narrator',
		accent: 'American'
	},
	// ── Male · accents ─────────────────────────────────────────────────────
	{
		name: 'Charlie',
		label: 'Charlie',
		gender: 'male',
		style: 'Casual, natural',
		accent: 'Australian'
	},
	{
		name: 'Daniel',
		label: 'Daniel',
		gender: 'male',
		style: 'Authoritative, polished',
		accent: 'British'
	},
	{ name: 'George', label: 'George', gender: 'male', style: 'Warm storyteller', accent: 'British' },
	// Voice Library picks (referenced by voice ID). Widely-used Indian-English
	// voices — ▶ Preview each once before relying on it for scheduled content.
	{
		name: 'zgqefOY5FPQ3bB7OZTVR',
		label: 'Niraj',
		gender: 'male',
		style: 'Veteran narrator, smooth',
		accent: 'Indian'
	},
	{
		name: 'N2al4jd45e882svx17SU',
		label: 'Aakash',
		gender: 'male',
		style: 'Guy-next-door, soothing',
		accent: 'Indian'
	},
	// ── Female · American ──────────────────────────────────────────────────
	{ name: 'Rachel', label: 'Rachel', gender: 'female', style: 'Calm, clear', accent: 'American' },
	{ name: 'Sarah', label: 'Sarah', gender: 'female', style: 'Conversational', accent: 'American' },
	{
		name: 'Matilda',
		label: 'Matilda',
		gender: 'female',
		style: 'Friendly, upbeat',
		accent: 'American'
	},
	{
		name: 'Jessica',
		label: 'Jessica',
		gender: 'female',
		style: 'Expressive, playful',
		accent: 'American'
	},
	{ name: 'Laura', label: 'Laura', gender: 'female', style: 'Upbeat, sunny', accent: 'American' },
	{ name: 'Aria', label: 'Aria', gender: 'female', style: 'Husky, relaxed', accent: 'American' },
	// ── Female · accents ───────────────────────────────────────────────────
	{
		name: 'Charlotte',
		label: 'Charlotte',
		gender: 'female',
		style: 'Warm, soft',
		accent: 'Swedish'
	},
	{ name: 'Lily', label: 'Lily', gender: 'female', style: 'Bright, energetic', accent: 'British' },
	{
		name: 'Alice',
		label: 'Alice',
		gender: 'female',
		style: 'Confident, news-style',
		accent: 'British'
	},
	// Voice Library picks (by voice ID) — ▶ Preview once before relying on them.
	{
		name: 'VZyYADHcMi33m0wO9zD1',
		label: 'Monika',
		gender: 'female',
		style: 'Warm, engaging',
		accent: 'Indian'
	},
	{
		name: 'mfMM3ijQgz8QtMeKifko',
		label: 'Riya',
		gender: 'female',
		style: 'Clear, friendly',
		accent: 'Indian'
	}
];

/**
 * Extra voices injected via env — lets the client add any ElevenLabs voice
 * (e.g. an Australian female from the Voice Library, passed by voice ID)
 * without a code change:
 *   UGC_EXTRA_VOICES='[{"name":"<voice-id>","label":"Kylie","gender":"female","style":"Sunny, relatable","accent":"Australian"}]'
 */
function parseExtraVoices(): VoiceOption[] {
	const raw = env.UGC_EXTRA_VOICES;
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr
			.filter(
				(v: any) =>
					v &&
					typeof v.name === 'string' &&
					v.name &&
					(v.gender === 'male' || v.gender === 'female')
			)
			.map((v: any) => ({
				name: v.name,
				label: v.label || v.name,
				gender: v.gender,
				style: v.style || 'Custom voice',
				accent: v.accent || undefined
			}));
	} catch {
		console.warn('[Voices] UGC_EXTRA_VOICES is not valid JSON — ignoring.');
		return [];
	}
}

export const VOICE_CATALOG: VoiceOption[] = [...BUILTIN_VOICES, ...parseExtraVoices()];

/** Default sample line used by the "press play" preview when no text is provided. */
export const SAMPLE_LINE =
	'Okay, I have to tell you about this — it honestly changed my whole routine. No joke, give it a try.';

export const DEFAULT_VOICE = 'Adam';

/**
 * Voices the catalog used to offer that the TTS endpoint no longer serves, and
 * the live same-gender voice each one now resolves to.
 *
 * Audited against the live endpoint on 2026-09-09: 8 of 30 catalog entries
 * returned `feature_not_supported` ("Voice not found"). They are removed from
 * the picker above, but removal alone is not enough — personas pinned to one
 * still carry that name in `agent_configs.ugc_voice`, and a database is not
 * rewritten by deleting a line of TypeScript.
 *
 * Without this map those personas rely on the runtime 422 → fallback path,
 * which works but pays for it on EVERY post: one rejected call, then a second
 * real one, forever, at double the latency. Redirecting up front makes the
 * first call the only call.
 *
 * IMPORTANT: the endpoint accepts an unknown voice at SUBMIT and only fails at
 * RENDER, so a cheap validation probe cannot detect a dead voice — it has to
 * generate. That is why the gate is `voices-truth.test.ts` (integration), not a
 * unit test.
 */
export const RETIRED_VOICES: Record<string, string> = {
	Antoni: 'Brian',
	Josh: 'Chris',
	James: 'Charlie',
	Fin: 'Daniel',
	Giovanni: 'Brian',
	Domi: 'Aria',
	Grace: 'Laura',
	Dorothy: 'Alice'
};

/**
 * The voice that will actually speak for a stored pick. Resolves a retired name
 * to its same-gender replacement; passes everything else through untouched so a
 * valid pick and an env-injected custom voice are unaffected.
 */
export function liveVoice(name: string | null | undefined): string {
	const n = (name ?? '').trim();
	if (!n) return DEFAULT_VOICE;
	return RETIRED_VOICES[n] ?? n;
}

export function isValidVoice(name: string): boolean {
	return VOICE_CATALOG.some((v) => v.name === name);
}

/** Accent synonyms → catalog accent tags, so an inferred accent like
 *  "English", "South Asian", or "Aussie" still matches the tagged voices. */
const ACCENT_ALIASES: Record<string, string> = {
	english: 'british',
	uk: 'british',
	'received pronunciation': 'british',
	us: 'american',
	usa: 'american',
	'north american': 'american',
	aussie: 'australian',
	'indian english': 'indian',
	'south asian': 'indian',
	hindi: 'indian',
	desi: 'indian',
	southern: 'american-southern',
	'southern american': 'american-southern'
};

/** Stable string hash — same seed always lands on the same voice. */
function voiceSeedHash(seed: string): number {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	return h;
}

/**
 * Deterministically picks the best catalog voice for an inferred voice profile
 * (gender + accent). Exact accent matches within the gender first — and when
 * several voices share the accent, `seed` (e.g. the agent id) spreads different
 * personas across them so no two influencers default to the same voice.
 * Otherwise the closest available (American of that gender, else any of that
 * gender) with `exact: false` so callers can say the real accent isn't in the
 * catalog yet. Voices added via UGC_EXTRA_VOICES (e.g. a Vietnamese accent from
 * the ElevenLabs Voice Library) are matched automatically by their accent tag.
 */
export function pickVoiceForProfile(
	gender: 'male' | 'female',
	accent?: string | null,
	seed?: string
): { voice: VoiceOption; exact: boolean } {
	const pool = VOICE_CATALOG.filter((v) => v.gender === gender);
	const fallbackPool = pool.length ? pool : VOICE_CATALOG;
	const pick = (arr: VoiceOption[]) => arr[seed ? voiceSeedHash(seed) % arr.length : 0];
	const wantRaw = (accent || '').trim().toLowerCase();
	const want = ACCENT_ALIASES[wantRaw] ?? wantRaw;
	if (want) {
		const matches = pool.filter((v) => {
			const tag = (v.accent || '').toLowerCase();
			return tag && (tag === want || tag.includes(want) || want.includes(tag));
		});
		if (matches.length) return { voice: pick(matches), exact: true };
	}
	const americans = fallbackPool.filter((v) => (v.accent || '').toLowerCase() === 'american');
	return { voice: pick(americans.length ? americans : fallbackPool), exact: !want };
}
