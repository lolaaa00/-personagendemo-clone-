import { env } from '$env/dynamic/private';
import { persistToStorage } from '$lib/server/storage';
import { enhanceChain } from '$lib/server/flags';
import type { CostEvent } from '$lib/pricing';

/**
 * Post-generation enhancement — the stage our images have never had.
 *
 * The competitive finding this exists to answer (docs/competitive/
 * fannabe-viability-assessment-2026-09-09.md) is that the leading platform's
 * realism does not come from a better base model. It comes from passes applied
 * AFTER generation: a face restore, a skin/detail pass, and an upscale. We had
 * none of the three and ended at the base model's raw output.
 *
 * This module is the first of those passes. Upscale goes first deliberately:
 * it is the cheapest, it is the least likely to damage identity (a bad face
 * blend is worse than no blend at all), and detail/resolution is where the
 * "shot on a camera" micro-texture actually comes from. Face restore and the
 * skin pass extend `EnhanceChainSetting` later rather than reinterpreting it.
 *
 * STANDALONE ON PURPOSE. It imports storage and flags and nothing from
 * `generate.ts`, because generate.ts is where the callers live — importing it
 * back would be a cycle. That is also why the fal call below is eight lines
 * here instead of reusing generate.ts's private `falSyncJson`.
 *
 * ── The two gates, and why there are two ────────────────────────────────────
 *
 * 1. The switch (`enhance_chain`, off by default).
 * 2. A configured price.
 *
 * fal's OpenAPI schema publishes no cost field for this endpoint (verified
 * 2026-09-17). Unlike the compute-second models this module deliberately does
 * NOT wire (esrgan, aura-sr, ccsr, retoucher — see the feasibility doc below),
 * seedvr bills per output megapixel, a basis a human CAN look up and quote —
 * it is simply not exposed in the machine-readable schema. So the operator
 * still supplies the rate in UGC_UPSCALE_USD (a live-measured $0.001/MP ≈
 * $0.004 for a typical 4MP portrait is the documented starting point — see
 * .env.example), and without a usable one this stage does not run even when
 * the switch is on.
 *
 * That is deliberate and it is the whole billing argument: a paid step with no
 * rate is a step the ledger cannot record, and under `credits_mode=enforce` an
 * unmetered path is a free path. Guessing a number instead would be the same
 * class of bug as the forged clip duration that quoted $0.30 and billed $1.80 —
 * a figure on a customer's receipt that nothing measured.
 *
 * ── Never-brick ─────────────────────────────────────────────────────────────
 *
 * Every failure returns the ORIGINAL image. A realism pass that loses someone
 * their post is worse than one that never ran, so there is no throw path out of
 * `enhanceImage` — same discipline as the card renderer's fallback.
 *
 * See docs/competitive/realism-chain-feasibility-2026-09-09.md for the full
 * model survey (11 live-tested endpoints across all three stages), the
 * recommended three-stage chain this is stage 1 of, and why upscale ships
 * first on risk/cost grounds rather than "largest visible jump" grounds — a
 * claim that document tests and finds unsupported (plastic skin, the tell
 * this whole effort answers to, is a stage-B problem, not a resolution one).
 */

/**
 * Verified 2026-09-17 against fal's live OpenAPI schema: input `image_url`,
 * factor `upscale_factor`, output `image.url`.
 *
 * SWAPPED FROM `fal-ai/esrgan` (this module's original default) the same day,
 * on the strength of docs/competitive/realism-chain-feasibility-2026-09-09.md
 * — written before P0.1 shipped and not read until after. That document ran
 * 11 live calls against fal and its verdict is unambiguous: esrgan bills
 * per compute-second, which "has no measurable ceiling" and is explicitly
 * named a High-severity risk ("Refuse to wire... however attractive esrgan's
 * face:true is"). seedvr bills per output megapixel — a real, quotable basis
 * — measured live at $0.001/MP (a 1600x912 output cost ≈$0.0015), confirmed
 * non-generative, and confirmed to preserve aspect ratio to within ~1.3%
 * (rounding to a multiple of 16). Same queue-only API shape as esrgan, so
 * the fallback below and the response parsing needed no other change.
 */
const DEFAULT_UPSCALE_MODEL = 'fal-ai/seedvr/upscale/image';

const UPSCALE_TIMEOUT_MS = 120_000;

/**
 * Below this there is no point starting: the call would be killed mid-flight,
 * and a cancelled upscale still costs whatever the provider already spent.
 */
const MIN_UPSCALE_BUDGET_MS = 15_000;

/**
 * Ceiling on the upscaled file we are willing to store and then serve.
 *
 * Our storage host is not behind a CDN — video.ts sizes its whole web encode
 * around that — so a 4x PNG of a portrait is not just a big file, it is a
 * portrait that takes tens of seconds to appear for every viewer afterwards,
 * forever. fal returns `file_size` on the image object, so this is checked
 * BEFORE the download rather than after we have already paid the transfer.
 *
 * Over the cap we keep the original: a slightly softer portrait that loads is
 * worth more than a sharper one that does not.
 */
const MAX_UPSCALED_BYTES = 8 * 1024 * 1024;

/**
 * How much bigger. fal's schema (verified 2026-09-17 from the OpenAPI JSON)
 * allows 1-10 with a default of 2. We stop at 4 by CHOICE: above that the
 * file-size cap below rejects nearly everything anyway, and a portrait no
 * viewer can load is not an improvement.
 */
function upscaleFactor(): number {
	const n = Number((env.UGC_UPSCALE_SCALE ?? '').trim());
	return Number.isFinite(n) && n > 1 && n <= 4 ? n : 2;
}

function upscaleModel(): string {
	return (env.UGC_UPSCALE_MODEL ?? '').trim() || DEFAULT_UPSCALE_MODEL;
}

/**
 * The operator's declared provider cost for one upscale call, in USD.
 * Returns null when unset, unparseable, negative, or absurd — every one of
 * which must read as "no price", never as free.
 */
export function upscaleUsd(): number | null {
	const raw = (env.UGC_UPSCALE_USD ?? '').trim();
	if (raw === '') return null;
	const n = Number(raw);
	// 0 is rejected along with the rest: a genuinely free provider step would
	// still be a claim nobody verified, and it would make the ledger row lie.
	if (!Number.isFinite(n) || n <= 0 || n > 1) return null;
	return n;
}

/**
 * fal's published OpenAPI for this endpoint describes ONLY the queue host
 * (queue.fal.run), where POST answers with a QueueStatus and the image comes
 * from a later GET. Production proves the sync host (fal.run) answers with the
 * output directly for every other model here — but that host is documented
 * nowhere, so this module accepts BOTH shapes rather than betting the pass on
 * an undocumented one. A QueueStatus is collected by polling inside the same
 * time budget; anything else is treated as the output.
 */
interface QueueStatusLike {
	request_id: string;
	status?: string;
	status_url?: string;
	response_url?: string;
	cancel_url?: string;
}

function looksQueued(d: unknown): d is QueueStatusLike {
	const q = d as QueueStatusLike | null;
	return !!q && typeof q.request_id === 'string' && !Object.hasOwn(q, 'image');
}

const QUEUE_POLL_MS = 2_000;

async function collectQueued(
	model: string,
	q: QueueStatusLike,
	falKey: string,
	deadline: number
): Promise<unknown> {
	const base = `https://queue.fal.run/${model}/requests/${q.request_id}`;
	const headers = { Authorization: `Key ${falKey}` };
	const statusUrl = q.status_url || `${base}/status`;
	const resultUrl = q.response_url || base;
	const cancelUrl = q.cancel_url || `${base}/cancel`;

	while (Date.now() < deadline) {
		const st = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(10_000) });
		if (!st.ok) throw new Error(`${model} queue status ${st.status}`);
		const body = (await st.json()) as { status?: string };
		if (body.status === 'COMPLETED') {
			const r = await fetch(resultUrl, { headers, signal: AbortSignal.timeout(30_000) });
			if (!r.ok) throw new Error(`${model} queue result ${r.status}`);
			return r.json();
		}
		await new Promise((res) =>
			setTimeout(res, Math.min(QUEUE_POLL_MS, Math.max(0, deadline - Date.now())))
		);
	}
	// Out of time. Do not leave paid work running that nobody will collect —
	// best effort, and the throw below is what the caller acts on either way.
	try {
		await fetch(cancelUrl, { method: 'PUT', headers, signal: AbortSignal.timeout(5_000) });
	} catch {
		/* the deadline is the failure being reported; a failed cancel does not change it */
	}
	throw new Error(`${model} queued request did not complete inside the budget`);
}

export interface EnhanceResult {
	/** What to use. The original when nothing ran — callers need no branch. */
	url: string;
	/** The pre-enhancement image, always. The A/B evidence, and the undo. */
	original: string;
	/** Stages that actually ran, in order. Empty when nothing did. */
	applied: string[];
	/** What to bill. Empty when nothing ran; never populated for a failed call. */
	costEvents: CostEvent[];
	/** Why nothing ran, for the caller to log or surface. Absent on success. */
	skipped?: string;
}

function untouched(url: string, skipped?: string): EnhanceResult {
	return { url, original: url, applied: [], costEvents: [], skipped };
}

/**
 * Runs the enhancement chain over a finished image.
 *
 * Returns the enhanced URL, or the original unchanged when the chain is off,
 * unpriced, or fails. `costEvents` is what the caller must record — it is
 * returned rather than written here so the stage bills through exactly the same
 * `recordCostEvents` path as every other generation, rather than inventing a
 * second way for money to reach the ledger.
 */
export async function enhanceImage(
	/** Typed off the one function that consumes it, so this cannot drift from it. */
	svc: Parameters<typeof persistToStorage>[0],
	userId: string,
	imageUrl: string,
	falKey: string,
	/**
	 * How long the CALLER still has. The preview route is synchronous, and its
	 * justification for that was "one model call" — this pass made it two, which
	 * would have let a slow portrait plus a slow upscale run past the reverse
	 * proxy and return nothing at all. The budget makes the second call fit in
	 * whatever the first one left, and skip rather than overrun.
	 */
	budgetMs: number = UPSCALE_TIMEOUT_MS
): Promise<EnhanceResult> {
	if (!imageUrl) return untouched(imageUrl, 'no image');
	if (enhanceChain() !== 'upscale') return untouched(imageUrl, 'chain off');
	if (!falKey) return untouched(imageUrl, 'no fal key');

	const timeout = Math.min(UPSCALE_TIMEOUT_MS, Math.max(0, budgetMs));
	if (timeout < MIN_UPSCALE_BUDGET_MS) {
		return untouched(imageUrl, `not enough time left (${Math.round(timeout / 1000)}s)`);
	}

	const usd = upscaleUsd();
	if (usd === null) {
		// Loud, because this is a switch that is ON and silently doing nothing.
		console.warn(
			'[enhance] enhance_chain is on but UGC_UPSCALE_USD is unset or invalid — the upscale pass is off. fal publishes no rate for this endpoint, so set the price you are actually charged; an unpriced paid step cannot be metered.'
		);
		return untouched(imageUrl, 'no configured price');
	}

	const model = upscaleModel();
	const deadline = Date.now() + timeout;
	try {
		const res = await fetch(`https://fal.run/${model}`, {
			method: 'POST',
			headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
			// `image_url` SINGULAR and `upscale_factor` — verified against fal's
			// schema. The t2i models in this codebase take `image_size`/
			// `aspect_ratio` and return `images[]`; this upscaler shares neither,
			// which is exactly the mismatch models.ts warns guessing produces.
			body: JSON.stringify({ image_url: imageUrl, upscale_factor: upscaleFactor() }),
			signal: AbortSignal.timeout(timeout)
		});
		if (!res.ok) {
			throw new Error(`${model} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
		}
		let data: unknown = await res.json();
		if (looksQueued(data)) {
			data = await collectQueued(model, data, falKey, deadline);
		}
		// `image.url` — a single object, NOT `images[0].url`. Reading the wrong
		// path here would return undefined and silently bill for nothing.
		const out = (data as { image?: { url?: unknown } })?.image?.url;
		if (typeof out !== 'string' || !out) {
			throw new Error(`${model} returned no image`);
		}

		// fal reports the size on the image object, so this costs nothing and
		// happens before persistToStorage pulls the bytes across.
		const size = Number((data as { image?: { file_size?: unknown } })?.image?.file_size);
		if (Number.isFinite(size) && size > MAX_UPSCALED_BYTES) {
			// Not an error: the provider did its job and we are declining the
			// result. Billed all the same — fal ran the work either way, and a
			// ledger that hides a call we made would be the lie this file exists
			// to avoid. The caller still gets a usable portrait.
			console.warn(
				`[enhance] upscaled image is ${(size / 1048576).toFixed(1)}MB, over the ${MAX_UPSCALED_BYTES / 1048576}MB cap — keeping the original so it still loads over un-CDN'd storage`
			);
			return {
				url: imageUrl,
				original: imageUrl,
				applied: [],
				costEvents: [
					{
						provider: 'fal',
						operation: 'image',
						model: `${model} (upscale, discarded: oversize)`,
						usd,
						measuredUsd: null
					}
				],
				skipped: `upscaled image over ${MAX_UPSCALED_BYTES / 1048576}MB`
			};
		}

		// Persist before billing: the provider URL is ephemeral, and an event
		// whose assetUrl expires is a charge with nothing behind it.
		const durable = await persistToStorage(svc, out, userId, 'png');

		return {
			url: durable,
			original: imageUrl,
			applied: ['upscale'],
			costEvents: [
				{
					provider: 'fal',
					operation: 'image',
					model: `${model} (upscale)`,
					usd,
					assetUrl: durable,
				// Explicitly \"did not say\", never \"was free\". fal's schema for this
				// endpoint declares no cost, usage or billing field anywhere (checked
				// 2026-09-17), so the price_table_drift view shows this row as unmeasured
				// instead of the declared rate quietly passing for truth.
				measuredUsd: null
				}
			]
		};
	} catch (err) {
		// The original is still a perfectly good image. Losing it to a failed
		// enhancement would be a worse outcome than never enhancing.
		console.error('[enhance] upscale failed, keeping the original:', (err as Error).message);
		return untouched(imageUrl, `upscale failed: ${(err as Error).message}`);
	}
}
