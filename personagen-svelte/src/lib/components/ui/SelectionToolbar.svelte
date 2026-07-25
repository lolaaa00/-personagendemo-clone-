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
		onClear: () => void;
		onDelete: () => void;
		actions?: import('svelte').Snippet | null;
	} = $props();

	const plural = $derived(nounPlural ?? `${noun}s`);
</script>

<div class="sel-toolbar" class:has-selection={selectedCount > 0}>
	<span class="sel-count">
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
			disabled={busy || selectedCount === 0}
		>
			{busy ? 'Deleting…' : deleteLabel}{selectedCount > 0 ? ` (${selectedCount})` : ''}
		</button>
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
	}
	.sel-btn:hover:not(:disabled) {
		border-color: var(--accent, #7c6aed);
	}
	.sel-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.sel-btn.danger:not(:disabled) {
		color: #dc2626;
	}
	.sel-btn.danger:hover:not(:disabled) {
		border-color: #dc2626;
	}
</style>
