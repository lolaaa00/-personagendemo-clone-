<script lang="ts">
	/**
	 * The one bulk-action bar. Every curatable collection in the app (posts,
	 * products, personas, reference photos, competitors) shows the same
	 * affordances so "manageability" means the same thing everywhere:
	 * a live count, Select all, Clear, and a destructive bulk action.
	 *
	 * Extra bulk actions (approve, reject, …) go in the `actions` snippet and
	 * render before Delete.
	 */
	let {
		total,
		selectedCount,
		noun = 'item',
		nounPlural = null,
		deleteLabel = 'Delete selected',
		busy = false,
		onSelectAll,
		deleteBlock = null,
		onClear,
		onDelete,
		actions = null
	}: {
		total: number;
		selectedCount: number;
		noun?: string;
		nounPlural?: string | null;
		deleteLabel?: string;
		busy?: boolean;
		onSelectAll: () => void;
		/** Why this seat cannot delete — disables Delete with the reason (round-7). */
		deleteBlock?: string | null;
		onClear: () => void;
		onDelete: () => void;
		actions?: import('svelte').Snippet | null;
	} = $props();

	const plural = $derived(nounPlural ?? `${noun}s`);
</script>

<div class="sel-toolbar" class:has-selection={selectedCount > 0}>
	<span class="sel-count" aria-live="polite" aria-atomic="true">
		{total}
		{total === 1 ? noun : plural}
		{#if selectedCount > 0}
			· <strong>{selectedCount} selected</strong>
		{/if}
	</span>
	<div class="sel-actions">
		{#if actions}{@render actions()}{/if}
		<button
			type="button"
			class="sel-btn"
			onclick={onSelectAll}
			disabled={busy || total === 0 || selectedCount === total}>Select all</button
		>
		<button type="button" class="sel-btn" onclick={onClear} disabled={busy || selectedCount === 0}
			>Clear</button
		>
		<button
			type="button"
			class="sel-btn danger"
			onclick={onDelete}
			aria-busy={busy}
			disabled={busy || selectedCount === 0 || !!deleteBlock}
			title={deleteBlock ?? undefined}
		>
			{busy ? 'Deleting…' : deleteLabel}{selectedCount > 0 ? ` (${selectedCount})` : ''}
		</button>
		{#if deleteBlock}<span class="sel-note">{deleteBlock}</span>{/if}
	</div>
</div>

<style>
	.sel-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.9rem;
		border: 1px solid var(--border, #e6e8f0);
		border-radius: var(--radius-sm, 10px);
		background: var(--surface-2, #f7f8fc);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.sel-toolbar.has-selection {
		border-color: var(--accent, #7c6aed);
		background: color-mix(in srgb, var(--accent, #7c6aed) 7%, transparent);
	}
	.sel-count {
		font-size: 0.76rem;
		color: var(--text-muted, #6b7280);
	}
	.sel-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	/* Labels stay compact; the box carries the 44px minimum touch target. */
	.sel-btn {
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 6px;
		padding: 0.35rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text, #14172b);
		cursor: pointer;
		font-family: var(--font-body, inherit);
		min-height: 44px;
		min-width: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.sel-btn:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.sel-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.sel-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	/* Destructive action sits apart from the benign ones so it isn't mis-tapped. */
	.sel-btn.danger {
		margin-left: 0.5rem;
	}
	.sel-btn.danger:not(:disabled) {
		color: var(--error-text);
	}
	.sel-btn.danger:hover:not(:disabled) {
		border-color: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, var(--surface, #fff));
	}
	.sel-btn.danger:focus-visible {
		outline-color: var(--danger);
	}
	.sel-note {
		flex-basis: 100%;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
</style>
