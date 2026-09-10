<!--
	How a draft landed with the persona's panel of imagined readers.

	Deliberately quiet. This is four people's reaction, not a mark out of a
	hundred, so there is no pass line, no red, no warning icon and no call to
	action — the writer reads it, disagrees if they like, and approves anyway.

	It renders NOTHING unless there is a real verdict to show. `fit_score` is null
	on most posts (never judged, no panel, no provider, an unusable answer), and
	`buildFitPanel` turns every one of those into `null`, so a post without a
	verdict draws no container, no placeholder and no "not scored yet" label — it
	looks exactly as it did before this component was mounted.

	Objections are model-written strings from a database column: they are
	interpolated as TEXT and must never be passed to `{@html}`.
-->
<script lang="ts">
	import { buildFitPanel } from './fit-verdict';

	let {
		fitScore = null,
		fitNotes = null
	}: {
		/** The post's `fit_score` column. `null` — the usual case — renders nothing. */
		fitScore?: unknown;
		/** The post's `fit_notes` column. Validated per row; junk renders nothing. */
		fitNotes?: unknown;
	} = $props();

	let panel = $derived(buildFitPanel(fitScore, fitNotes));
</script>

{#if panel}
	<section class="fit-verdict" aria-label="How this landed with the reader panel">
		<span class="drawer-block-label">
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
				<circle cx="9" cy="7" r="4" />
				<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
				<path d="M16 3.13a4 4 0 0 1 0 7.75" />
			</svg>
			Reader reactions
		</span>

		<div class="fv-head">
			<span class="fv-score" data-band={panel.band}>
				{panel.score}<small>/100</small>
			</span>
			<p class="fv-headline">{panel.headline}</p>
		</div>

		<ul class="fv-list">
			{#each panel.reactions as reaction (reaction.key)}
				<li class="fv-row">
					<div class="fv-who">
						<span class="fv-viewer">{reaction.viewer}</span>
						<span class="fv-fit" data-band={reaction.band}>{reaction.fit}</span>
					</div>
					{#if reaction.objection}
						<p class="fv-objection">{reaction.objection}</p>
					{/if}
				</li>
			{/each}
		</ul>

		<p class="fv-hint">
			An opinion from {panel.reactions.length}
			{panel.reactions.length === 1 ? 'imagined reader' : 'imagined readers'}, not a grade. Post it
			anyway if you disagree.
		</p>
	</section>
{/if}

<style>
	.fit-verdict {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.75rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		min-width: 0;
	}

	/* Matches the drawer's own block labels so this reads as one more section of
	   the post, not a widget bolted on. */
	.drawer-block-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		font-weight: 700;
		display: block;
	}

	.drawer-block-label svg {
		vertical-align: -0.15em;
		flex-shrink: 0;
	}

	.fv-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	/* Emphasis, not a traffic light: the three bands only differ in how much of
	   the existing accent they carry. Nothing here is red, and a low score is
	   simply quieter than a high one. */
	.fv-score {
		font-size: 1.05rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--text-muted);
		padding: 0.28rem 0.5rem;
		border-radius: var(--radius-sm);
		background: var(--surface-3);
		flex-shrink: 0;
	}

	.fv-score[data-band='strong'] {
		color: var(--accent-text);
		background: var(--accent-soft);
	}

	.fv-score[data-band='cool'] {
		color: var(--text-dim);
	}

	.fv-score small {
		font-size: 0.62rem;
		font-weight: 600;
		opacity: 0.7;
	}

	.fv-headline {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted);
		min-width: 0;
	}

	.fv-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.fv-row {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
		min-width: 0;
	}

	.fv-who {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}

	.fv-viewer {
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--text);
		min-width: 0;
		/* Panel summaries are whole sentences about a person; they must wrap rather
		   than push the drawer sideways on a 390px screen. */
		overflow-wrap: anywhere;
	}

	.fv-fit {
		font-size: 0.72rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.fv-fit[data-band='strong'] {
		color: var(--accent-text);
	}

	.fv-fit[data-band='cool'] {
		color: var(--text-dim);
	}

	.fv-objection {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.5;
		color: var(--text-dim);
		overflow-wrap: anywhere;
	}

	.fv-hint {
		margin: 0;
		font-size: 0.7rem;
		font-style: italic;
		color: var(--text-dim);
	}
</style>
