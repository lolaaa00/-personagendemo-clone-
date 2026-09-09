<!--
  Life details — the read-only body of the persona page's "Life details" section.

  The <details> shell, its summary and its chevron stay on the page so this card
  is styled by the page's own `.profile-section` rules and cannot drift into a
  second visual language. This component owns only what is inside: the groups,
  the rows, and the quiet "auto" marker.

  It renders nothing for an empty `groups` array, and the page additionally
  refuses to mount the shell in that case — belt and braces, because a persona
  with nothing to show must see no section header at all.

  READ-ONLY BY DESIGN. There is no binding, no form control and no save path
  here. These facts are filled in by the sampler; editing them is a later phase,
  and until then showing them must not be able to change them.
-->
<script lang="ts">
	import { hasAutoRows, type LifeDetailGroup } from './life-details';

	let { groups }: { groups: LifeDetailGroup[] } = $props();

	const showAutoNote = $derived(hasAutoRows(groups));
</script>

{#if groups.length}
	<div class="life-details">
		{#if showAutoNote}
			<p class="ld-note">
				Details marked <span class="ld-auto">auto</span> were filled in for you — you were never asked
				for them, and nothing here is required.
			</p>
		{/if}

		<div class="ld-groups">
			{#each groups as group (group.key)}
				<section class="ld-group">
					<h3 class="ld-group-title">{group.title}</h3>
					<dl class="ld-rows">
						{#each group.rows as row (row.key)}
							{@const value = row.value}
							<div class="ld-row">
								<dt class="ld-label">
									<span>{row.label}</span>
									{#if row.auto}
										<span class="ld-auto" title="Filled in automatically — you didn’t set this"
											>auto</span
										>
									{/if}
								</dt>
								<dd class="ld-value">
									{#if value.kind === 'chips'}
										<span class="ld-chips">
											{#each value.chips as chip, i (i)}
												<span class="ld-chip">{chip}</span>
											{/each}
										</span>
									{:else if value.kind === 'meter'}
										<span class="ld-meter">
											<span class="ld-meter-track">
												<span class="ld-meter-fill" style="width: {value.percent}%"></span>
											</span>
											<span class="ld-meter-num tabular-nums">{value.text}</span>
										</span>
									{:else}
										{value.text}
									{/if}
								</dd>
							</div>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	</div>
{/if}

<style>
	.ld-note {
		font-size: 0.8rem;
		color: var(--text-dim);
		margin: 0 0 1.25rem;
		max-width: 90ch;
	}

	/* Multi-column, not grid — the same call the page makes for its bento
	   layout, and for the same reason. Grid rows are uniform, so a three-row
	   group beside a nine-row one parks at the top of the row and leaves the
	   rest of that row empty. These groups have wildly different heights and no
	   fixed count, so every grid arrangement is wrong for some persona.
	   Columns pack vertically and reflow, from four columns across a wide
	   classic card down to one inside a narrow bento column, with no media
	   query and no horizontal scroll at any width. */
	.ld-groups {
		column-width: 240px;
		column-gap: 1.5rem;
	}

	.ld-group {
		/* Keep a group whole — without this one can be split down the middle. */
		break-inside: avoid;
		-webkit-column-break-inside: avoid;
		min-width: 0;
		margin: 0 0 1.25rem;
	}

	.ld-group-title {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-dim);
		margin: 0 0 0.5rem;
	}

	.ld-rows {
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.ld-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--border);
	}

	.ld-row:last-child {
		border-bottom: none;
	}

	.ld-label {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		flex-shrink: 0;
		font-size: 0.8rem;
		color: var(--text-dim);
	}

	.ld-value {
		margin: 0;
		min-width: 0;
		text-align: right;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text);
		/* Long free text (a job title, a timezone) wraps instead of widening the
		   card past its column. */
		overflow-wrap: anywhere;
	}

	/* The provenance marker. Deliberately the quietest thing on the row: it
	   answers "did I choose this?" for anyone who wonders, and is invisible to
	   anyone who doesn't. */
	.ld-auto {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-dim);
		opacity: 0.55;
		cursor: help;
	}

	.ld-chips {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.3rem;
	}

	.ld-chip {
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full, 999px);
		background: var(--surface-2);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.ld-meter {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.ld-meter-track {
		display: block;
		width: 56px;
		height: 4px;
		border-radius: var(--radius-full, 999px);
		background: var(--surface-3, var(--surface-2));
		overflow: hidden;
	}

	.ld-meter-fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}

	.ld-meter-num {
		min-width: 1.6em;
		text-align: right;
	}

	/* Below the page's own narrow breakpoint a label and a right-aligned value
	   collide, so stack them. */
	@media (max-width: 480px) {
		.ld-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.15rem;
		}
		.ld-value {
			text-align: left;
		}
		.ld-chips {
			justify-content: flex-start;
		}
	}
</style>
