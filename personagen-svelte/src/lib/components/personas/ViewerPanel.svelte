<!--
  Viewer panel — the read-only body of the persona page's "Who they're talking
  to" section.

  An audience is stored as a bracket ("women 45–54, mid income, parents"). Nobody
  writes a post for a bracket. `sampleViewerPanel` turns the bracket into a
  handful of concrete viewers, deterministically from the persona's seed, and
  this file is the only thing that draws them.

  The <details> shell, its summary and its chevron stay on the page so this card
  is styled by the page's own `.profile-section` rules and cannot drift into a
  second visual language — exactly as LifeDetails does. This component owns only
  what is inside.

  It renders nothing for an empty panel, and `hasStatedAudience` below lets the
  page refuse to mount the shell when the audience says nothing at all: a panel
  sampled from no constraints is five strangers, not this persona's viewers, and
  a persona that has never named an audience must see no section header.

  READ-ONLY BY DESIGN. Nothing here is stored, nothing here is editable, and the
  panel is regenerated from the seed on every render rather than persisted.
-->
<script lang="ts" module>
	import { isToken, label } from '$lib/persona-contract';
	import type { PersonaAudience, ViewerSkeleton } from '$lib/persona-contract';

	/**
	 * True when the audience states something the sampler can actually narrow on.
	 *
	 * `sampleViewerPanel` never returns an empty panel — an audience of nothing
	 * still yields five viewers drawn from the whole population — so emptiness is
	 * a question about the INPUT, and it is asked here. The fields are exactly the
	 * ones the sampler reads; anything else on the audience (a prose avatar, a
	 * platform list) does not constrain a viewer and so does not earn the section.
	 */
	export function hasStatedAudience(audience: PersonaAudience | null | undefined): boolean {
		if (!audience || typeof audience !== 'object' || Array.isArray(audience)) return false;
		const a = audience as PersonaAudience;

		if (Array.isArray(a.ageRanges) && a.ageRanges.some((v) => isToken('ageRange', v))) return true;
		if (isToken('genderMix', a.genderMix)) return true;
		if (Array.isArray(a.lifeStage) && a.lifeStage.some((v) => isToken('lifeStage', v))) return true;
		if (isToken('incomeBand', a.incomeBand)) return true;

		const d = a.decisioning;
		if (d && typeof d === 'object' && !Array.isArray(d)) {
			if (isToken('priceSensitivity', d.priceSensitivity)) return true;
			if (isToken('purchaseChannel', d.purchaseChannel)) return true;
			if (isToken('brandLoyalty', d.brandLoyalty)) return true;
			if (isToken('promoResponsiveness', d.promoResponsiveness)) return true;
			if (isToken('messageProcessingStyle', d.messageProcessingStyle)) return true;
			if (isToken('communicationPreference', d.communicationPreference)) return true;
			if (isToken('digitalCapability', d.digitalCapability)) return true;
		}
		return false;
	}

	interface Chip {
		key: string;
		text: string;
	}

	/**
	 * The facts that are NOT already in `viewer.summary` (which carries gender,
	 * age, place, job, income and a child count). Every token goes through
	 * `label()`; nothing raw from storage reaches the screen.
	 */
	function chipsFor(viewer: ViewerSkeleton): Chip[] {
		const chips: Chip[] = [];
		const push = (key: string, text: string) => {
			if (text.trim()) chips.push({ key, text: text.trim() });
		};

		push('geo', label('geographicContext', viewer.location?.geographicContext));
		push('seniority', label('seniority', viewer.work?.seniority));
		push('work-mode', label('workLocationMode', viewer.work?.workLocationMode));
		push('relationship', label('relationshipStatus', viewer.household?.relationshipStatus));
		const bands = viewer.household?.children?.ageBands ?? [];
		bands.forEach((band, i) => push(`child-${i}`, label('childAgeBand', band)));
		push('housing', label('housingType', viewer.household?.housingType));
		push('price', label('priceFrame', viewer.economic?.priceFrame));

		return chips;
	}

	/**
	 * A headline for a viewer whose summary is missing — the sampler's own
	 * fallback seat, which carries a gender and nothing else. A seat always shows
	 * something, because a blank card reads as a bug.
	 */
	function headlineFor(viewer: ViewerSkeleton, index: number): string {
		const summary = typeof viewer.summary === 'string' ? viewer.summary.trim() : '';
		if (summary) return summary;
		const gender = label('gender', viewer.gender);
		return gender || `Viewer ${index + 1}`;
	}
</script>

<script lang="ts">
	let { viewers }: { viewers: ViewerSkeleton[] } = $props();
</script>

{#if viewers.length}
	<div class="viewer-panel">
		<p class="vp-note">
			Nobody writes for a bracket. These are people your stated audience implies — invented from
			this persona’s seed, the same every time you open this page. They aren’t real, nothing here is
			saved, and they’re here so a draft can be judged against someone.
		</p>

		<div class="vp-cards">
			{#each viewers as viewer, index (viewer.seed)}
				{@const chips = chipsFor(viewer)}
				<article class="vp-card">
					<span class="vp-seat" aria-hidden="true">{index + 1}</span>
					<div class="vp-card-body">
						<p class="vp-headline">{headlineFor(viewer, index)}</p>
						{#if chips.length}
							<span class="vp-chips">
								{#each chips as chip (chip.key)}
									<span class="vp-chip">{chip.text}</span>
								{/each}
							</span>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	</div>
{/if}

<style>
	.vp-note {
		font-size: 0.8rem;
		color: var(--text-dim);
		margin: 0 0 1.25rem;
		max-width: 90ch;
	}

	/* Columns, not grid — the same call LifeDetails makes, and for the same
	   reason: seats have different heights (a viewer with three children carries
	   more chips than a single renter), and a grid would leave the short ones
	   padding out a uniform row. Columns pack vertically and reflow from a wide
	   classic card down to one column inside a narrow bento column, with no media
	   query and no horizontal scroll at any width. */
	.vp-cards {
		column-width: 260px;
		column-gap: 1rem;
	}

	.vp-card {
		/* Keep a seat whole — without this one can be split down the middle. */
		break-inside: avoid;
		-webkit-column-break-inside: avoid;
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		min-width: 0;
		margin: 0 0 1rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 14px);
		background: var(--surface-2);
	}

	.vp-seat {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: var(--radius-full, 999px);
		background: var(--surface-3, var(--surface-2));
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.vp-card-body {
		min-width: 0;
	}

	.vp-headline {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.4;
		color: var(--text);
		/* A long job title or city wraps instead of widening the column. */
		overflow-wrap: anywhere;
	}

	.vp-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.45rem;
	}

	.vp-chip {
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full, 999px);
		background: var(--surface);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-muted);
		white-space: nowrap;
	}
</style>
