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
	{ name: 'Adam', label: 'Adam', gender: 'male', style: 'Deep, natural, confident', accent: 'American' },
	{ name: 'Brian', label: 'Brian', gender: 'male', style: 'Warm narrator', accent: 'American' },
	{ name: 'Antoni', label: 'Antoni', gender: 'male', style: 'Friendly, approachable', accent: 'American' },
	{ name: 'Josh', label: 'Josh', gender: 'male', style: 'Young, casual', accent: 'American' },
	{ name: 'Bill', label: 'Bill', gender: 'male', style: 'Mature, trustworthy', accent: 'American' },
	{ name: 'Charlie', label: 'Charlie', gender: 'male', style: 'Casual, natural', accent: 'Australian' },
	{ name: 'Rachel', label: 'Rachel', gender: 'female', style: 'Calm, clear', accent: 'American' },
	{ name: 'Sarah', label: 'Sarah', gender: 'female', style: 'Conversational', accent: 'American' },
	{ name: 'Charlotte', label: 'Charlotte', gender: 'female', style: 'Warm, soft', accent: 'Swedish' },
	{ name: 'Matilda', label: 'Matilda', gender: 'female', style: 'Friendly, upbeat', accent: 'American' },
	{ name: 'Lily', label: 'Lily', gender: 'female', style: 'Bright, energetic', accent: 'British' },
	{ name: 'Alice', label: 'Alice', gender: 'female', style: 'Confident, news-style', accent: 'British' }
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
		return arr.filter(
			(v: any) =>
				v && typeof v.name === 'string' && v.name && (v.gender === 'male' || v.gender === 'female')
		).map((v: any) => ({
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

export function isValidVoice(name: string): boolean {
	return VOICE_CATALOG.some((v) => v.name === name);
}
