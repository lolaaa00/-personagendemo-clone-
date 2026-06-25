<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		goto('/brand-brief?tab=intel', { replaceState: true });
	});
</script>

<svelte:head>
	<title>Redirecting... — PersonaGen</title>
</svelte:head>

<div class="redirect-container">
	<p>Redirecting to Brand Brief...</p>
</div>

<style>
	.redirect-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 50vh;
		color: var(--text-muted);
		font-family: var(--font-body);
	}
</style>
