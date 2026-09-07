import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { VOICE_CATALOG, SAMPLE_LINE, isValidVoice, DEFAULT_VOICE } from '$lib/server/voices';
import { resolveImageKeys } from '$lib/server/content/generate';
import { meteredCall, meteringRefusal } from '$lib/server/metering';
import { RateLimiter } from '$lib/server/rate-limit';
import { priceOf } from '$lib/pricing';

/**
 * Voice picker backend for the persona Settings tab.
 *   GET  /api/voices            -> the catalog the UI renders
 *   POST /api/voices {voice,text?} -> a sample audio URL to "press play"
 *
 * TTS runs through fal's ElevenLabs (the user's fal key), same provider the
 * generation engine uses, so the previewed voice == the produced voice.
 * Every press is a paid call: gated, recorded and debited like any other
 * generation, and rate-limited so a held-down button cannot run up a bill.
 */
const previewLimiter = new RateLimiter(10, 60 * 1000);
export const GET: RequestHandler = async ({ locals }) => {
	const { session } = await locals.safeGetSession();
	if (!session) return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	return json({ success: true, voices: VOICE_CATALOG, default: DEFAULT_VOICE });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as any;
	const voice = String(body.voice || DEFAULT_VOICE);
	const text =
		typeof body.text === 'string' && body.text.trim()
			? body.text.trim().slice(0, 300)
			: SAMPLE_LINE;

	if (!isValidVoice(voice)) {
		return json({ success: false, error: `Unknown voice: ${voice}` }, { status: 400 });
	}

	const { falKey } = await resolveImageKeys(locals.supabase, user.id);
	if (!falKey) {
		return json({ success: false, error: 'No fal/TTS provider configured.' }, { status: 400 });
	}

	const limit = previewLimiter.check(`voice-preview:${user.id}`);
	if (!limit.allowed) {
		return json(
			{ success: false, error: `Too many previews — try again in ${limit.retryAfterSeconds}s.` },
			{ status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
		);
	}

	const ttsUsd = priceOf('fal', 'tts');
	try {
		const url = await meteredCall(
			{ supabase: locals.supabase, userId: user.id },
			async () => {
				const res = await fetch('https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5', {
					method: 'POST',
					headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({ text, voice, stability: 0.5, similarity_boost: 0.75 })
				});
				if (!res.ok) {
					const t = await res.text();
					throw Object.assign(new Error(`TTS failed (${res.status}): ${t.slice(0, 160)}`), { status: 502 });
				}
				const data = (await res.json()) as any;
				const audio = data?.audio?.url;
				if (!audio) throw Object.assign(new Error('TTS returned no audio'), { status: 502 });
				return audio as string;
			},
			{ estimateUsd: ttsUsd, event: () => ({ provider: 'fal', operation: 'tts', model: 'elevenlabs turbo-v2.5', usd: ttsUsd }) }
		);
		return json({ success: true, audio_url: url, voice });
	} catch (e) {
		if (/budget|credits|ceiling/i.test((e as Error).message)) {
			const r = meteringRefusal(e);
			return json(r.body, { status: r.status });
		}
		return json({ success: false, error: (e as Error).message }, { status: (e as any)?.status ?? 500 });
	}
};
