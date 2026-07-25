<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		loading?: boolean;
		onclick?: (e: MouseEvent) => void;
		class?: string;
		children?: Snippet;
	}

	let {
		variant = 'primary',
		type = 'button',
		disabled = false,
		loading = false,
		onclick,
		class: className = '',
		children
	}: Props = $props();
</script>

<button
	{type}
	disabled={disabled || loading}
	{onclick}
	aria-busy={loading}
	class="btn btn-{variant} {className}"
>
	{#if loading}
		<span class="btn-spinner" aria-hidden="true"></span>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</button>

<style>
	/* The global `.btn` base sets padding but no minimum box, so short labels
	   (and icon-only buttons) fell under the 44x44 touch minimum. */
	.btn {
		min-height: 44px;
		min-width: 44px;
	}

	.btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.btn-spinner {
		width: 16px;
		height: 16px;
		/* was a fixed white track — invisible on ghost/secondary buttons */
		border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		display: inline-block;
		flex-shrink: 0;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
