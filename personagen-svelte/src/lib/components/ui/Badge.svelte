<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'accent' | 'success' | 'warning' | 'error' | 'neutral';
		class?: string;
		children?: Snippet;
	}

	let { variant = 'neutral', class: className = '', children }: Props = $props();
</script>

<span class="badge-primitive badge-{variant} {className}">
	{#if children}
		{@render children()}
	{/if}
</span>
