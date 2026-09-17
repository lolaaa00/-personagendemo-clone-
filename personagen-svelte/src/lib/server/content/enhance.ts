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
 * fal publishes NO rate for either upscaler — verified 2026-09-17 against both
 * model API pages and fal.ai/pricing, none of which carries a number for
 * `fal-ai/esrgan` or `fal-ai/clarity-upscaler`. So the operator supplies one in
 * UGC_UPSCALE_USD, and without a usable one this stage does not run even when
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
 */

/** Verified 2026-09-17 against fal's model API page: input `image_url`, output `image.url`. */
const DEFAULT_UPSCALE_MODEL = 'fal-ai/esrgan';

const UPSCALE_TIMEOUT_MS = 120_000;

/** How much bigger. fal's own default is 2; anything unparseable falls back to it. */
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
	svc: any,
	userId: string,
	imageUrl: string,
	falKey: string
): Promise<EnhanceResult> {
	if (!imageUrl) return untouched(imageUrl, 'no image');
	if (enhanceChain() !== 'upscale') return untouched(imageUrl, 'chain off');
	if (!falKey) return untouched(imageUrl, 'no fal key');

	const usd = upscaleUsd();
	if (usd === null) {
		// Loud, because this is a switch that is ON and silently doing nothing.
		console.warn(
			'[enhance] enhance_chain is on but UGC_UPSCALE_USD is unset or invalid — the upscale pass is off. fal publishes no rate for this endpoint, so set the price you are actually charged; an unpriced paid step cannot be metered.'
		);
		return untouched(imageUrl, 'no configured price');
	}

	const model = upscaleModel();
	try {
		const res = await fetch(`https://fal.run/${model}`, {
			method: 'POST',
			headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
			// `image_url` SINGULAR and `scale` — verified against fal's schema.
			// The t2i models in this codebase take `image_size`/`aspect_ratio` and
			// return `images[]`; these upscalers share neither, which is exactly
			// the mismatch models.ts warns guessing produces.
			body: JSON.stringify({ image_url: imageUrl, scale: upscaleFactor() }),
			signal: AbortSignal.timeout(UPSCALE_TIMEOUT_MS)
		});
		if (!res.ok) {
			throw new Error(`${model} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
		}
		const data = await res.json();
		// `image.url` — a single object, NOT `images[0].url`. Reading the wrong
		// path here would return undefined and silently bill for nothing.
		const out = data?.image?.url;
		if (typeof out !== 'string' || !out) {
			throw new Error(`${model} returned no image`);
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
					assetUrl: durable
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
