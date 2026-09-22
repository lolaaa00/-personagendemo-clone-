/**
 * "What does a post cost?" for the pages that answer it WITHOUT a persona —
 * /billing ("≈ 33 video posts") and the landing page's receipt.
 *
 * They priced from a hand-kept table (billing-packs `outcomeSteps`, a static
 * `priceOf('fal', 'video', 'standard')`) while the composer prices from the
 * live model registry. A round-2 re-audit found /billing and the landing
 * quoting a video post at $1.58 that no format in the composer costs — the
 * cheapest video there was $2.51 and product motion $3.62 — so /billing
 * overstated what a top-up buys by 2.3×.
 *
 * This resolves each stage from the SAME registry defaults the generate-post
 * preview uses and plans it with the composer's own planPipeline(), so the
 * three can only disagree when a persona picks a non-default model.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRegistry, effectiveResolve, registryDefault, type RegistryRow } from './model-registry';
import { planPipeline, type StepKind, type StepModel } from '$lib/formats';
import { priceOf } from '$lib/pricing';
import { isCardRendererAvailable } from './content/card-renderer';
import { TTS_MODEL } from './content/generate';

export type PostOutcome = 'textPost' | 'imagePost' | 'videoPost' | 'talkingHead';

/** The composer format each outcome is priced as. */
const FORMAT_OF: Record<PostOutcome, string> = {
	textPost: 'text-card',
	imagePost: 'photo',
	videoPost: 'product-motion',
	talkingHead: 'spokesperson'
};

/** Platform rows only: a nil uuid matches no personal registry copy. */
const NO_USER = '00000000-0000-0000-0000-000000000000';

function toStep(m: { id: string; label: string; usd: number; provider: string; tier?: StepModel['tier']; billing?: StepModel['billing'] }): StepModel {
	return { id: m.id, label: m.label, usd: m.usd, provider: m.provider, tier: m.tier, billing: m.billing };
}

/**
 * The platform-rows answer (no user) is the same for every anonymous visitor,
 * so the landing page reuses it for a few minutes instead of querying the
 * registry on every hit.
 */
let anonCache: { at: number; value: Record<PostOutcome, number[]> } | null = null;
const ANON_TTL_MS = 5 * 60 * 1000;

/** Per-stage provider USD for each outcome, from the live registry defaults. Never throws. */
export async function outcomeStepsUsd(
	supabase: SupabaseClient,
	userId: string | null
): Promise<Record<PostOutcome, number[]>> {
	if (!userId && anonCache && Date.now() - anonCache.at < ANON_TTL_MS) return anonCache.value;
	const value = await computeOutcomeSteps(supabase, userId);
	if (!userId) anonCache = { at: Date.now(), value };
	return value;
}

async function computeOutcomeSteps(
	supabase: SupabaseClient,
	userId: string | null
): Promise<Record<PostOutcome, number[]>> {
	// Without rows the static catalog IS the effective catalog.
	const rows: RegistryRow[] = await loadRegistry(supabase, userId ?? NO_USER).catch(() => []);
	const llm = priceOf('openrouter', 'llm');
	const freeCard = await isCardRendererAvailable().catch(() => false);
	const tts = registryDefault(rows, 'tts', 'fal', TTS_MODEL, priceOf('fal', 'tts'));
	const fixed: Partial<Record<StepKind, StepModel>> = {
		director: { id: 'director', label: 'director', usd: llm, provider: 'openrouter' },
		grader: { id: 'grader', label: 'grader', usd: llm, provider: 'openrouter' },
		// A persona post composites the face, so it is an EDIT, as in the preview.
		still: toStep(effectiveResolve(rows, 'image_edit', null)),
		video: toStep(effectiveResolve(rows, 'video_i2v', null)),
		talkinghead: toStep(effectiveResolve(rows, 'talking_head', null)),
		tts: { id: tts.id, label: tts.id, usd: tts.usd, provider: 'fal' },
		card: freeCard
			? { id: 'local/typographic-card', label: 'card', usd: 0, provider: 'local', tier: 'free' }
			: { id: 'nano', label: 'nano', usd: priceOf('fal', 'image', 'nano'), provider: 'fal' }
	};
	const out = {} as Record<PostOutcome, number[]>;
	for (const k of Object.keys(FORMAT_OF) as PostOutcome[]) {
		out[k] = planPipeline({ formatId: FORMAT_OF[k], fixed, options: {} }).map((s) => s.usd);
	}
	return out;
}
