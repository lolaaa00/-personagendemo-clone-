<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		goto('/calendar?forge=true', { replaceState: true });
	});
</script>

<div class="redirect-container">
	<p>Redirecting to Content Forge & Scheduler...</p>
</div>

<style>
	.redirect-container {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--text-muted);
		font-family: var(--font-display);
	}
</style>
