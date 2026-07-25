<script lang="ts">
	import { onMount } from 'svelte';
	import { initializeThemeAndColors } from '$lib/stores/ui.svelte';

	let { children } = $props();

	onMount(() => {
		initializeThemeAndColors();
	});
</script>

<!-- Auth screens have no global nav, so the page itself is the single main landmark. -->
<main id="main-content">
	{@render children()}
</main>
