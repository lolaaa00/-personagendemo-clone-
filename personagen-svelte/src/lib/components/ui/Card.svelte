<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		dark?: boolean;
		class?: string;
		header?: Snippet;
		title?: Snippet;
		description?: Snippet;
		children?: Snippet;
		footer?: Snippet;
	}

	let {
		dark = false,
		class: className = '',
		header,
		title,
		description,
		children,
		footer
	}: Props = $props();
</script>

<div class="glass-panel {className}" class:theme-dark-context={dark}>
	{#if header || title || description}
		<div class="card-header">
			{#if title}
				<div class="card-title">
					{@render title()}
				</div>
			{/if}
			{#if description}
				<div class="card-description">
					{@render description()}
				</div>
			{/if}
			{#if header}
				{@render header()}
			{/if}
		</div>
	{/if}

	{#if children}
		<div class="card-content">
			{@render children()}
		</div>
	{/if}

	{#if footer}
		<div class="card-footer">
			{@render footer()}
		</div>
	{/if}
</div>

<style>
	.card-header {
		padding: var(--space-6) var(--space-8);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.card-title :global(h1),
	.card-title :global(h2),
	.card-title :global(h3) {
		font-size: var(--text-2xl);
		font-weight: var(--weight-semi);
		color: var(--text);
	}

	.card-description :global(p) {
		color: var(--text-muted);
		font-size: var(--text-base);
	}

	.card-content {
		padding: 0 var(--space-8) var(--space-8) var(--space-8);
	}

	/* A header-less card had no top padding at all — its content sat flush against
	   the panel edge. Restore it only when the content leads. */
	.card-content:first-child {
		padding-top: var(--space-8);
	}

	.card-footer {
		padding: var(--space-5) var(--space-8);
		border-top: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
	}
</style>
