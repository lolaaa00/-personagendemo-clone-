/**
 * Price a Studio template from the SAME plan the composer charges.
 *
 * The Studio tiles and the Campaign Planner used a hand-kept table
 * (PIPELINE_USD) while the composer priced from the live model registry, so the
 * two drifted. A client re-audit found four product-motion tiles quoting $1.61
 * where the approve step charged $3.62, a planner estimate built on the same
 * wrong table, and "Photo" at $0.09 in one composer and $0.32 on every tile —
 * the audit's ENH-003 in reverse: the price before the click was not the price
 * at the click.
 *
 * The server's free preview (`preview: true` — it resolves the plan and returns
 * before any spend) hands back the registry-resolved stage options. Pricing a
 * template with planPipeline/planTotalUsd over those options is exactly the
 * arithmetic the composer runs, so the three surfaces cannot disagree. The
 * table remains the fallback for when no plan is available.
 *
 * Client-safe: no server imports.
 */
import { planPipeline, planTotalUsd, formatFromRequest } from '$lib/formats';
import { PIPELINE_USD, type StudioTemplate } from '$lib/studio-templates';

export interface StudioPlan {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preview's plan options are the server's StepModel map, passed through untouched
	options: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
	fixed: any;
	shots: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
	oneOffs: any[];
	/**
	 * Whether the persona's brand brief has a product WITH a photo. Cinematic
	 * refuses without one; knowing it here lets a tile say so before the click
	 * instead of opening a composer whose only way out is a Retry that cannot
	 * succeed (re-audit: the "Wild Card" tile).
	 */
	hasProductPhoto: boolean;
}

/**
 * The template's per-stage provider USD, from the plan — or null when there
 * is no plan yet (still loading, or a seat that cannot preview). Callers price
 * it with quoteSteps() so the tile rounds per stage exactly like the ledger,
 * and show nothing rather than the hand-kept table while it is null: that
 * table flashed stale prices for half a second on every load, and stayed for
 * a viewer seat (re-audit: $1.61 tiles against a $3.62 composer).
 */
export function templateStepsUsd(t: StudioTemplate, plan: StudioPlan | null): number[] | null {
	if (!plan) return null;
	try {
		const steps = planPipeline({
			formatId: formatFromRequest(t.baseBody as Record<string, unknown>),
			options: plan.options,
			fixed: plan.fixed,
			shots: plan.shots,
			oneOffs: plan.oneOffs
		}).map((s) => s.usd);
		return steps.some((u) => u > 0) ? steps : null;
	} catch {
		return null;
	}
}

/** Provider USD for one template, from the plan when there is one. */
export function templateUsd(t: StudioTemplate, plan: StudioPlan | null): number {
	if (!plan) return PIPELINE_USD[t.pipeline];
	try {
		const usd = planTotalUsd(
			planPipeline({
				formatId: formatFromRequest(t.baseBody as Record<string, unknown>),
				options: plan.options,
				fixed: plan.fixed,
				shots: plan.shots,
				oneOffs: plan.oneOffs
			})
		);
		return usd > 0 ? usd : PIPELINE_USD[t.pipeline];
	} catch {
		return PIPELINE_USD[t.pipeline];
	}
}

/**
 * Fetch the persona's plan from the free preview. Resolves null on any failure
 * (a viewer seat, a network blip) so callers fall back to the table.
 */
export async function fetchStudioPlan(
	agentId: string,
	/** The server load passes its own `event.fetch` (cookies forwarded, no HTTP hop). */
	fetcher: typeof fetch = fetch
): Promise<StudioPlan | null> {
	try {
		const res = await fetcher(`/api/agent/${agentId}/generate-post`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ preview: true })
		});
		if (!res.ok) return null;
		const d = await res.json();
		const plan = d?.preview?.plan;
		if (!plan?.options) return null;
		const products = Array.isArray(d?.preview?.products) ? d.preview.products : [];
		return {
			options: plan.options,
			fixed: plan.fixed ?? {},
			shots: plan.shots ?? 4,
			oneOffs: plan.oneOffs ?? [],
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- preview product rows are untyped JSON
			hasProductPhoto: products.some((p: any) => typeof p?.photoUrl === 'string' && p.photoUrl)
		};
	} catch {
		return null;
	}
}
