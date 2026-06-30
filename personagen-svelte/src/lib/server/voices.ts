/**
 * Voice catalog for UGC characters.
 *
 * Each agent pins one `voice` (the `name` below) in its config; the engine passes
 * that name to ElevenLabs TTS (via fal) for every post, giving a constant voice.
 *
 * The config UI lists these and calls POST /api/voices to play a sample.
 */

export interface VoiceOption {
	/** Value passed to the TTS `voice` field — must match an ElevenLabs voice name. */
	name: string;
	/** Display label for the picker. */
	label: string;
	gender: 'male' | 'female';
	/** Short vibe description for the picker. */
	style: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
	{ name: 'Adam', label: 'Adam', gender: 'male', style: 'Deep, natural, confident' },
	{ name: 'Brian', label: 'Brian', gender: 'male', style: 'Warm narrator' },
	{ name: 'Antoni', label: 'Antoni', gender: 'male', style: 'Friendly, approachable' },
	{ name: 'Josh', label: 'Josh', gender: 'male', style: 'Young, casual' },
	{ name: 'Bill', label: 'Bill', gender: 'male', style: 'Mature, trustworthy' },
	{ name: 'Rachel', label: 'Rachel', gender: 'female', style: 'Calm, clear' },
	{ name: 'Sarah', label: 'Sarah', gender: 'female', style: 'Conversational' },
	{ name: 'Charlotte', label: 'Charlotte', gender: 'female', style: 'Warm, soft' },
	{ name: 'Matilda', label: 'Matilda', gender: 'female', style: 'Friendly, upbeat' },
	{ name: 'Lily', label: 'Lily', gender: 'female', style: 'Bright, energetic' }
];

/** Default sample line used by the "press play" preview when no text is provided. */
export const SAMPLE_LINE =
	'Okay, I have to tell you about this — it honestly changed my whole routine. No joke, give it a try.';

export const DEFAULT_VOICE = 'Adam';

export function isValidVoice(name: string): boolean {
	return VOICE_CATALOG.some((v) => v.name === name);
}
