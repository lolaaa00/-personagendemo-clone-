import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { VOICE_CATALOG, SAMPLE_LINE, isValidVoice, DEFAULT_VOICE } from '$lib/server/voices';
import { resolveImageKeys } from '$lib/server/content/generate';

/**
 * Voice picker backend for the persona Settings tab.
 *   GET  /api/voices            -> the catalog the UI renders
 *   POST /api/voices {voice,text?} -> a sample audio URL to "press play"
 *
 * TTS runs through fal's ElevenLabs (the user's fal key), same provider the
 * generation engine uses, so the previewed voice == the produced voice.
 */
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

	try {
		const res = await fetch('https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5', {
			method: 'POST',
			headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, voice, stability: 0.5, similarity_boost: 0.75 })
		});
		if (!res.ok) {
			const t = await res.text();
			return json(
				{ success: false, error: `TTS failed (${res.status}): ${t.slice(0, 160)}` },
				{ status: 502 }
			);
		}
		const data = (await res.json()) as any;
		const url = data?.audio?.url;
		if (!url) return json({ success: false, error: 'TTS returned no audio' }, { status: 502 });
		return json({ success: true, audio_url: url, voice });
	} catch (e) {
		return json({ success: false, error: (e as Error).message }, { status: 500 });
	}
};
