/**
 * ONE-OFF PROOF: a "Don't Search This" franchise video in the close-framed
 * selfie register (the veronicahap format), through the same fal models the
 * real talking-head pipeline uses — WITHOUT booting the server (no scheduler
 * tick, no publishes, no db writes; db is read-only for the character ref).
 *
 * Steps: prod db read (persona's pinned face + voice) → nano-banana-2/edit
 * selfie still anchored on the character ref → ElevenLabs TTS → OmniHuman
 * lipsync → download mp4 to portfolio/selfie-format-demo/.
 *
 * Cost estimate: still $0.08 + TTS ~$0.03 + OmniHuman ~$0.14/s (~18s ≈ $2.5).
 *
 * Usage: node --env-file=.env scripts/selfie-format-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAL = process.env.FAL_API_KEY;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!FAL || !SB_URL || !SB_KEY) throw new Error('Missing FAL_API_KEY / SUPABASE env');

const sb = async (path) => {
	const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
		headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` }
	});
	if (!r.ok) throw new Error(`db ${path}: ${r.status}`);
	return r.json();
};

const falSync = async (model, input) => {
	const r = await fetch(`https://fal.run/${model}`, {
		method: 'POST',
		headers: { Authorization: `Key ${FAL}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!r.ok) throw new Error(`${model} ${r.status}: ${(await r.text()).slice(0, 300)}`);
	return r.json();
};

const falQueue = async (model, input, timeoutMs = 420000) => {
	const sub = await fetch(`https://queue.fal.run/${model}`, {
		method: 'POST',
		headers: { Authorization: `Key ${FAL}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!sub.ok) throw new Error(`${model} submit ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
	const { status_url, response_url } = await sub.json();
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 6000));
		const s = await (await fetch(status_url, { headers: { Authorization: `Key ${FAL}` } })).json();
		process.stdout.write(`  ${model}: ${s.status}      \r`);
		if (s.status === 'COMPLETED')
			return (await fetch(response_url, { headers: { Authorization: `Key ${FAL}` } })).json();
		if (['FAILED', 'ERROR', 'CANCELLED'].includes(s.status)) throw new Error(`${model} ${s.status}`);
	}
	throw new Error(`${model} timed out`);
};

// ── 1. Persona: pinned face + voice, read-only ─────────────────────────────
const agents = await sb(`agents?select=id,name,niche&order=created_at.asc&limit=20`);
const persona =
	agents.find((a) => a.name === 'Lexy Connor') ?? agents.find((a) => a.name?.trim());
if (!persona) throw new Error('no persona found');
const [cfg] = await sb(
	`agent_configs?agent_id=eq.${persona.id}&select=ugc_character_ref,ugc_voice&limit=1`
);
const faceRef = cfg?.ugc_character_ref;
if (!faceRef) throw new Error(`persona ${persona.name} has no pinned character ref`);
const voice = cfg?.ugc_voice || 'Rachel';
console.log(`persona: ${persona.name} (${persona.niche}) · voice: ${voice}`);

// ── 2. The franchise script (Don't Search This · tech-minimalism payload) ──
// ~55 words ≈ 18s of speech. Hook line doubles as the on-screen overlay.
const HOOK = "Do NOT search 'phantom vibration syndrome'";
const SCRIPT =
	"Do not search phantom vibration syndrome. I'm serious. Because once you read it, " +
	"you'll notice it — that buzz in your pocket when your phone isn't even there. " +
	"Your brain invented a notification. It misses being needed. " +
	"Anyway. Phantom vibration syndrome. Don't look it up.";

// ── 3. Selfie still in the close-framed register, anchored on her face ─────
const STILL_PROMPT =
	'Extreme close selfie, phone front camera held by the subject: her face filling most of the frame, ' +
	'chin-to-forehead framing, direct eye contact with the lens, slight wide-angle distortion, ' +
	'lying against a pillow in soft warm bedroom lamp light, casual sleep shirt, hair down and imperfect, ' +
	'authentic room barely visible at the edges, candid phone-camera realism, visible skin texture, ' +
	'NO studio lighting, NO professional composition, NO photoshoot polish. Vertical 9:16.';
console.log('generating selfie still…');
const still = await falSync('fal-ai/nano-banana-2/edit', {
	prompt: STILL_PROMPT,
	image_urls: [faceRef],
	aspect_ratio: '9:16'
});
const stillUrl = still.images?.[0]?.url;
if (!stillUrl) throw new Error('no still produced');
console.log('still:', stillUrl);

// ── 4. Voice ───────────────────────────────────────────────────────────────
console.log('generating voiceover…');
let tts;
try {
	tts = await falSync('fal-ai/elevenlabs/tts/turbo-v2.5', {
		text: SCRIPT, voice, stability: 0.5, similarity_boost: 0.75
	});
} catch {
	// same fallback the real pipeline uses when a voice name is rejected
	tts = await falSync('fal-ai/elevenlabs/tts/turbo-v2.5', {
		text: SCRIPT, voice: 'Rachel', stability: 0.5, similarity_boost: 0.75
	});
}
const audioUrl = tts.audio?.url;
if (!audioUrl) throw new Error('no audio produced');
console.log('audio:', audioUrl);

// ── 5. Lipsync ─────────────────────────────────────────────────────────────
console.log('lipsyncing (OmniHuman, 2–5 min)…');
const th = await falQueue('fal-ai/bytedance/omnihuman', { image_url: stillUrl, audio_url: audioUrl });
const videoUrl = th.video?.url;
if (!videoUrl) throw new Error('no video produced');
console.log('\nvideo:', videoUrl);

// ── 6. Save ────────────────────────────────────────────────────────────────
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'portfolio', 'selfie-format-demo');
mkdirSync(outDir, { recursive: true });
const buf = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
const outPath = join(outDir, 'dont-search-this-demo.mp4');
writeFileSync(outPath, buf);
writeFileSync(join(outDir, 'README.md'),
`# Selfie-format proof — "Don't Search This" franchise

- Persona: ${persona.name} · voice ${voice}
- Register: close front-cam selfie (veronicahap format) — face fills frame, bedroom lamp light
- Hook (for overlay): **${HOOK}**
- Script: ${SCRIPT}
- Pipeline: nano-banana-2/edit (character-anchored still) → ElevenLabs turbo-v2.5 → OmniHuman v1.5
- Still: ${stillUrl}
- Video: ${videoUrl}
- Matches Studio template: \`dont-search-this\` — bulk-eligible via Campaigns.
`);
console.log('saved:', outPath, `(${(buf.length / 1e6).toFixed(1)} MB)`);
