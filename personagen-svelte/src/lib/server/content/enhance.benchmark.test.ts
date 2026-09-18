/**
 * P0.2 — the blind benchmark the enhancement chain shipped without.
 *
 * The chain went in on an argument, not a measurement, and the argument has a
 * hole in it: ESRGAN is super-resolution. It sharpens edges and INTERPOLATES
 * skin, and that family's failure mode is a smooth, waxy surface — the exact
 * "AI glaze" the Fannabe teardown names as the tell we are trying to remove.
 * Fannabe lists a skin enhancer SEPARATELY from its upscaler. So until someone
 * looks, "we enhanced it" is a mechanism, not an improvement, and it could be a
 * regression. This is the looking.
 *
 * WHAT IT DOES. For each realism register the studio actually ships in, it
 * renders one base portrait, runs the upscale pass over it, and writes both to
 * a grid under portfolio/enhance-benchmark/<run>/ with the pairs SHUFFLED and
 * the answer key in a separate file — so the judge does not know which is
 * which. Judge, then open the key.
 *
 * WHAT IT COSTS. One t2i still plus one upscale per register — a few cents per
 * pair, and it is live money, which is why it is:
 *
 *   - an integration test, not a unit test (`npm run test:integration`);
 *   - gated on ENHANCE_BENCHMARK=1 as well as a key, so a credentialed CI run
 *     of the integration project does not spend on it by accident;
 *   - run against fal DIRECTLY through enhance.ts, with no server, no
 *     scheduler, no ledger and no persona — nothing it makes can reach a
 *     customer or a wallet.
 *
 * It does not assert a winner. It cannot: whether skin looks real is a
 * judgment, and encoding one here would be the same as skipping the benchmark.
 * It asserts the harness itself worked — every pair exists, on disk, judgeable.
 *
 * Usage:  ENHANCE_BENCHMARK=1 npm run test:integration -- enhance.benchmark
 */
import { describe, it, expect, vi } from 'vitest';
import 'dotenv/config';

// vitest does not boot SvelteKit, so $env/dynamic/private is a real but EMPTY
// module here (see voices-truth.test.ts) — it is not process.env, and setting
// process.env.UGC_ENHANCE_CHAIN has no effect on what flags.ts or enhance.ts
// read. Both import `env` from this specifier, so one mock covers the switch
// (flags.ts's enhanceChain) and the price (enhance.ts's upscaleUsd) together.
// Missing this the first time this file was written made every run record
// "skipped: chain off" without a single call ever reaching fal — a benchmark
// that looked green while measuring nothing.
vi.mock('$env/dynamic/private', () => ({
	env: {
		UGC_ENHANCE_CHAIN: 'upscale',
		// The live-measured rate from the feasibility doc this module's default
		// model was chosen from (~$0.001/MP, ~$0.004 for a typical 4MP portrait).
		UGC_UPSCALE_USD: '0.004'
	}
}));

// The pass persists its result through storage.persistToStorage, which only
// short-circuits for URLs already in OUR bucket. A fal URL is not, so with no
// real service client it would throw, never-brick to the original, and this
// harness would record "skipped" for every register without ever making a
// pair — measuring nothing while looking like it ran. Persistence is the one
// thing a benchmark must not do anyway (nothing it makes may reach a customer),
// so it is replaced with the identity: the provider URL is the result.
vi.mock('$lib/server/storage', () => ({
	persistToStorage: async (_svc: unknown, url: string) => url,
	isDurableBucketUrl: () => false
}));
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SELFIE_LOOK, MIRROR_LOOK, PROPPED_LOOK } from '$lib/studio-templates';

const KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || '';
const ARMED = process.env.ENHANCE_BENCHMARK === '1';
const MODEL = process.env.BENCHMARK_T2I_MODEL || 'fal-ai/flux-pro/v1.1';

/**
 * The prompt scaffold is the one the pipeline sends — generate.ts's "shot on
 * iPhone 15 Pro with ProRAW … imperfection is quality" clause, restated here
 * because the benchmark must exercise the same register as production or it
 * measures a different product.
 */
const SCAFFOLD =
	'Vertical 3:4 photorealistic portrait of one relatable content creator, a unique specific individual with their own distinct face. Shoot quality: shot on iPhone 15 Pro with ProRAW, 24mm equivalent, natural light, real environment — NOT a studio ad or stock photo. Imperfection is quality: slight skin texture visible, natural shadows, lived-in authentic setting — not retouched or plastic-looking.';

const REGISTERS: Array<{ id: string; look: string }> = [
	{ id: 'front-cam', look: SELFIE_LOOK },
	{ id: 'mirror', look: MIRROR_LOOK },
	{ id: 'propped', look: PROPPED_LOOK }
];

async function t2i(prompt: string): Promise<string> {
	const res = await fetch(`https://fal.run/${MODEL}`, {
		method: 'POST',
		headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ prompt, image_size: 'portrait_4_3', num_images: 1 }),
		signal: AbortSignal.timeout(120_000)
	});
	if (!res.ok) throw new Error(`${MODEL} ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { images?: Array<{ url?: string }> };
	const url = data.images?.[0]?.url;
	if (!url) throw new Error(`${MODEL} returned no image`);
	return url;
}

async function download(url: string): Promise<Buffer> {
	const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
	if (!r.ok) throw new Error(`download ${r.status}`);
	return Buffer.from(await r.arrayBuffer());
}

describe.skipIf(!ARMED || !KEY)('enhancement benchmark (live, ENHANCE_BENCHMARK=1)', () => {
	it(
		'produces a shuffled, judgeable pair for every realism register',
		async () => {
			// Never through the app's storage or ledger: the pass is exercised with
			// persistence stubbed to the provider URL, so nothing lands in the bucket
			// and nothing is billed. The benchmark's whole cost is the fal charge.
			// The switch and price are set by the $env/dynamic/private mock above,
			// not here — see that mock's comment for why.
			const { enhanceImage } = await import('./enhance');

			const run = new Date().toISOString().replace(/[:.]/g, '-');
			const dir = join(process.cwd(), '..', 'portfolio', 'enhance-benchmark', run);
			mkdirSync(dir, { recursive: true });

			const key: Array<{ register: string; a: 'base' | 'upscaled'; b: 'base' | 'upscaled'; skipped?: string }> = [];

			for (const reg of REGISTERS) {
				const base = await t2i(`${SCAFFOLD} ${reg.look}`);
				// Storage is mocked above, so this is never touched.
				const svc = {} as unknown as Parameters<typeof enhanceImage>[0];
				const out = await enhanceImage(svc, 'benchmark', base, KEY);

				const pair: Array<['base' | 'upscaled', string]> = [
					['base', base],
					['upscaled', out.url]
				];
				if (Math.random() < 0.5) pair.reverse();

				writeFileSync(join(dir, `${reg.id}-A.png`), await download(pair[0][1]));
				writeFileSync(join(dir, `${reg.id}-B.png`), await download(pair[1][1]));
				key.push({ register: reg.id, a: pair[0][0], b: pair[1][0], skipped: out.skipped });

				// The harness worked for this register: both files exist and differ
				// unless the pass declined (in which case the key says why).
				expect(out.original).toBe(base);
				if (!out.skipped) expect(out.url).not.toBe(base);
			}

			writeFileSync(
				join(dir, 'ANSWER-KEY.json'),
				JSON.stringify({ model: MODEL, judgedBlind: 'open this only after scoring A vs B per register', key }, null, 2)
			);
			writeFileSync(
				join(dir, 'README.md'),
				[
					'# Enhancement benchmark — judge blind',
					'',
					'For each register, look at `<register>-A.png` and `<register>-B.png` and decide which reads as a REAL photo of a REAL person: skin texture, pores, natural shadows — not sharpness.',
					'',
					'Score: A / B / no difference. Write it down BEFORE opening ANSWER-KEY.json.',
					'',
					"If 'upscaled' does not win clearly across registers, the pass is not earning its money and the first stage should be a skin/detail pass, not super-resolution."
				].join('\n')
			);

			expect(key).toHaveLength(REGISTERS.length);
		},
		10 * 60_000
	);
});
