/**
 * Voice catalog, checked against the LIVE TTS endpoint.
 *
 * The picker makes one claim: every voice in it will speak. Nothing verified
 * that. On 2026-09-09 an audit found 8 of 30 catalog voices returned
 * `feature_not_supported` ("Voice not found") — offered in the UI, pinned by
 * personas, silently degraded to the gender fallback on every post since.
 *
 * WHY THIS TEST HAS TO SPEND MONEY
 *
 * The obvious cheap gate — submit a request and see whether it validates — does
 * not work here, and this is the whole reason this file exists. fal ACCEPTS an
 * unknown voice at submit and only rejects it at RENDER. That exact probe was
 * run against a catalog with 8 dead entries and reported 30/30 healthy. A voice
 * is only proven by generating audio with it.
 *
 * So each voice renders one short word. That is a real (small) charge per voice
 * per run, which is why this lives in the integration project rather than the
 * unit suite. `voices.spec.ts` holds everything checkable for free.
 *
 * Integration project (`npm run test:integration`): needs a fal key. Without one
 * it asserts that fact and stops, rather than passing silently — a green run
 * must mean the catalog was checked, never that the checker could not reach the
 * provider. Set VOICES_TRUTH_STRICT=1 (as deploy.ps1 does for the registry gate)
 * to turn "I could not check" into a failure.
 *
 * READ-ONLY with respect to our own data. It never writes a row.
 */
import { describe, it, expect } from 'vitest';
// vitest does not boot SvelteKit, so $env/dynamic/private is empty here.
// Load the same .env the app runs on.
import 'dotenv/config';
import { VOICE_CATALOG, RETIRED_VOICES } from './voices';

const KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || '';
const HAVE_KEY = Boolean(KEY);
/** Gate mode: an absent key is a failure, not a skip. */
const STRICT = process.env.VOICES_TRUTH_STRICT === '1';

const MODEL = 'fal-ai/elevenlabs/tts/turbo-v2.5';
const QUEUE = `https://queue.fal.run/${MODEL}`;
/** Results are polled here — fal's status path is the model FAMILY, not the endpoint. */
const REQUESTS = 'https://queue.fal.run/fal-ai/elevenlabs/requests';
/** One word: the charge scales with characters, and one word proves as much as ten. */
const PROBE_TEXT = 'Hi.';
const POLL_MS = 2000;
const MAX_POLLS = 40;

type Verdict = { voice: string; ok: boolean; reason?: string };

async function json(url: string, init?: RequestInit): Promise<any> {
	const res = await fetch(url, {
		...init,
		headers: { Authorization: `Key ${KEY}`, ...(init?.headers ?? {}) }
	});
	const text = await res.text();
	let body: any = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	return { ok: res.ok, status: res.status, body };
}

/** Renders one word and reports whether audio actually came back. */
async function probeVoice(voice: string): Promise<Verdict> {
	const sub = await json(QUEUE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text: PROBE_TEXT, voice })
	});
	if (!sub.ok) return { voice, ok: false, reason: `submit ${sub.status}` };

	const id = sub.body?.request_id;
	if (!id) return { voice, ok: false, reason: 'no request_id' };

	for (let i = 0; i < MAX_POLLS; i++) {
		const st = await json(`${REQUESTS}/${id}/status`);
		const status = st.body?.status;
		if (status === 'COMPLETED') {
			const out = await json(`${REQUESTS}/${id}`);
			// The tell: a rejected voice still COMPLETES, carrying a `detail`
			// payload instead of audio. Asserting on the URL — not on the status —
			// is what makes this test able to see the bug at all.
			if (out.body?.audio?.url) return { voice, ok: true };
			const detail = out.body?.detail;
			const msg = Array.isArray(detail) ? detail[0]?.msg : detail;
			return { voice, ok: false, reason: String(msg ?? 'no audio url').slice(0, 120) };
		}
		if (status === 'FAILED') return { voice, ok: false, reason: 'job FAILED' };
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	return { voice, ok: false, reason: 'timed out' };
}

describe('voice catalog truth (live TTS endpoint)', () => {
	it('has credentials, or says so', () => {
		if (STRICT) {
			expect(HAVE_KEY, 'VOICES_TRUTH_STRICT=1 but no fal key is configured').toBe(true);
		} else if (!HAVE_KEY) {
			console.warn('[voices-truth] No fal key — catalog NOT verified this run.');
		}
		expect(true).toBe(true);
	});

	it.runIf(HAVE_KEY)(
		'every voice in the picker actually speaks',
		async () => {
			const verdicts: Verdict[] = [];
			// Sequential on purpose: this is a correctness gate, not a benchmark,
			// and a burst of parallel calls is the fastest way to get rate-limited
			// into a false failure.
			for (const v of VOICE_CATALOG) verdicts.push(await probeVoice(v.name));

			const dead = verdicts.filter((v) => !v.ok);
			const report = dead.map((d) => `  ${d.voice} — ${d.reason}`).join('\n');
			expect(
				dead.length,
				dead.length
					? `\n${dead.length}/${verdicts.length} catalog voices do not speak:\n${report}\n` +
							'Remove them from BUILTIN_VOICES and add them to RETIRED_VOICES with a ' +
							'same-gender live replacement, so personas already pinned to them keep working.'
					: ''
			).toBe(0);
		},
		// One render per voice, sequential: the whole catalog needs real headroom.
		20 * 60_000
	);

	it.runIf(HAVE_KEY)(
		'every retired voice is still genuinely dead',
		async () => {
			// If a provider restores one, the retirement map is now silently
			// shadowing a working voice nobody can pick any more. That is the
			// mirror-image drift, and it is just as invisible.
			const revived: string[] = [];
			for (const name of Object.keys(RETIRED_VOICES)) {
				const v = await probeVoice(name);
				if (v.ok) revived.push(name);
			}
			expect(
				revived.length,
				revived.length
					? `These retired voices work again and should be restored to the catalog: ${revived.join(', ')}`
					: ''
			).toBe(0);
		},
		10 * 60_000
	);
});
