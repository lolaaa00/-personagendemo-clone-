<script lang="ts">
	/**
	 * TraitPicker — chip-based persona trait selection.
	 *
	 * Replaces the free-text appearance inputs. The category standard (and the
	 * reason this exists) is that picking a persona's look should require ZERO
	 * prompt writing: every trait defaults to a real, selectable `Best Fit` chip
	 * that means "leave it to the model", so a user can reach a preview without
	 * making a single decision.
	 *
	 * STORAGE IS UNCHANGED. Chips emit the same plain strings the text inputs did
	 * (`hairColor: 'Light Brown'`), so `coerceAppearance` /
	 * `appearanceToPromptClause` and every downstream prompt builder keep working
	 * untouched. This is an input-method change, not a data-format change.
	 *
	 * LEGACY VALUES ARE SACRED. Personas created before the curated option sets
	 * hold free text that matches no chip ('honey blonde'). Those render as an
	 * extra, selected "custom" chip on their row — never dropped, never snapped to
	 * the nearest option. Silently normalising them would visibly change an
	 * existing persona's face on its next generation.
	 */
	import {
		CURATED_APPEARANCE_FIELDS,
		ADVANCED_APPEARANCE_FIELDS,
		BEST_FIT
	} from '$lib/persona-profile';

	let {
		appearance = $bindable(),
		disabled = false
	}: { appearance: Record<string, string>; disabled?: boolean } = $props();

	/** How many real options show before the "+N more" chip. Best Fit is always extra. */
	const VISIBLE = 3;

	/** Rows the user has expanded via "+N more", keyed by trait. */
	let expanded = $state<Record<string, boolean>>({});

	/** Current value for a trait; '' means Best Fit (unset). */
	function valueOf(key: string): string {
		return (appearance?.[key] ?? '').trim();
	}

	/**
	 * A stored value that matches no curated option — a legacy free-text entry, or
	 * something the LLM invented. Surfaced as its own selected chip so it survives.
	 */
	function customValue(key: string, options: readonly string[]): string {
		const v = valueOf(key);
		if (!v) return '';
		return options.some((o) => o.toLowerCase() === v.toLowerCase()) ? '' : v;
	}

	/** Options shown on a row: collapsed to VISIBLE unless expanded or the value is hidden below the fold. */
	function shownOptions(key: string, options: readonly string[]): readonly string[] {
		if (expanded[key]) return options;
		const v = valueOf(key);
		const idx = options.findIndex((o) => o.toLowerCase() === v.toLowerCase());
		// Keep the selected option visible even when it sits past the cut.
		if (idx >= VISIBLE) return [...options.slice(0, VISIBLE - 1), options[idx]];
		return options.slice(0, VISIBLE);
	}

	function hiddenCount(key: string, options: readonly string[]): number {
		return expanded[key] ? 0 : Math.max(0, options.length - shownOptions(key, options).length);
	}

	function select(key: string, option: string) {
		if (disabled) return;
		// Best Fit stores '' so nothing reaches the prompt builder.
		appearance = { ...appearance, [key]: option === BEST_FIT ? '' : option };
	}

	function isSelected(key: string, option: string): boolean {
		const v = valueOf(key);
		return option === BEST_FIT ? v === '' : v.toLowerCase() === option.toLowerCase();
	}

	/**
	 * Roving focus within a row: arrows move, Home/End jump. Selection follows
	 * focus the way a native radiogroup does.
	 */
	function onRowKeydown(e: KeyboardEvent, key: string, chips: string[]) {
		const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(e.key)) return;
		e.preventDefault();
		const current = chips.findIndex((c) => isSelected(key, c));
		const from = current < 0 ? 0 : current;
		let next = from;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % chips.length;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
			next = (from - 1 + chips.length) % chips.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = chips.length - 1;
		select(key, chips[next]);
		const row = (e.currentTarget as HTMLElement) ?? null;
		const el = row?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next];
		el?.focus();
	}

	/** Full chip list for a row, in render order — drives keyboard navigation. */
	function chipsFor(key: string, options: readonly string[]): string[] {
		const custom = customValue(key, options);
		return [BEST_FIT, ...shownOptions(key, options), ...(custom ? [custom] : [])];
	}
</script>

<div class="trait-picker">
	{#each CURATED_APPEARANCE_FIELDS as f (f.key)}
		{@const options = f.options}
		{@const chips = chipsFor(f.key, options)}
		{@const custom = customValue(f.key, options)}
		{@const more = hiddenCount(f.key, options)}
		<div class="trait-row">
			<span class="trait-label" id="trait-label-{f.key}">{f.label}</span>
			<div
				class="trait-chips"
				role="radiogroup"
				aria-labelledby="trait-label-{f.key}"
				tabindex={-1}
				onkeydown={(e) => onRowKeydown(e, f.key, chips)}
			>
				{#each chips as opt (opt)}
					{@const selected = isSelected(f.key, opt)}
					<button
						type="button"
						role="radio"
						class="chip"
						class:selected
						class:best-fit={opt === BEST_FIT}
						class:custom={!!custom && opt === custom}
						aria-checked={selected}
						tabindex={selected ? 0 : -1}
						{disabled}
						onclick={() => select(f.key, opt)}
					>
						{opt}
						{#if !!custom && opt === custom}<span class="sr-only"> (custom value)</span>{/if}
					</button>
				{/each}
				{#if more > 0}
					<button
						type="button"
						class="chip more"
						aria-expanded="false"
						aria-label="Show {more} more {f.label} options"
						{disabled}
						onclick={() => (expanded = { ...expanded, [f.key]: true })}
					>
						+{more} more
					</button>
				{/if}
			</div>
		</div>
	{/each}

	<p class="trait-hint">
		Set the ones that matter — leave the rest on <strong>Best Fit</strong> and the model chooses.
		No prompt writing required.
	</p>

	<details class="trait-advanced">
		<summary>Advanced ({ADVANCED_APPEARANCE_FIELDS.length})</summary>
		<div class="advanced-grid">
			{#each ADVANCED_APPEARANCE_FIELDS as f (f.key)}
				<label class="advanced-field">
					<span>{f.label}</span>
					<input
						type="text"
						bind:value={appearance[f.key]}
						placeholder={f.placeholder}
						{disabled}
					/>
				</label>
			{/each}
		</div>
	</details>
</div>

<style>
	.trait-picker {
		display: flex;
		flex-direction: column;
	}

	.trait-row {
		display: grid;
		grid-template-columns: 8.5rem 1fr;
		gap: 0.75rem;
		align-items: start;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}

	.trait-label {
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		padding-top: 0.35rem;
	}

	.trait-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		border-radius: 999px;
		padding: 0.32rem 0.8rem;
		font-size: 0.82rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.chip:hover:not(:disabled) {
		border-color: var(--border-hover);
	}

	.chip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.chip.selected {
		border: 2px solid var(--accent);
		background: var(--accent-soft);
		font-weight: 600;
		padding: calc(0.32rem - 1px) calc(0.8rem - 1px);
	}

	.chip.best-fit:not(.selected) {
		color: var(--text-dim);
	}

	.chip.custom {
		font-style: italic;
	}

	.chip.more {
		border: 1px dashed var(--border-strong);
		color: var(--text-dim);
	}

	.chip:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.trait-hint {
		font-size: 0.78rem;
		color: var(--text-dim);
		margin: 0.75rem 0 0;
	}

	.trait-advanced {
		margin-top: 0.75rem;
	}

	.trait-advanced summary {
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--text-muted);
		padding: 0.3rem 0;
	}

	.advanced-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.6rem;
		margin-top: 0.5rem;
	}

	.advanced-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.advanced-field span {
		font-size: 0.75rem;
		color: var(--text-dim);
	}

	.advanced-field input {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.82rem;
		font-family: inherit;
	}

	.advanced-field input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	@media (max-width: 640px) {
		.trait-row {
			grid-template-columns: 1fr;
			gap: 0.35rem;
		}
		.trait-label {
			padding-top: 0;
		}
	}
</style>
