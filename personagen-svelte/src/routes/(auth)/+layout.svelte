<script lang="ts">
	import { onMount } from 'svelte';
	import { initializeThemeAndColors } from '$lib/stores/ui.svelte';

	let { children } = $props();

	onMount(() => {
		initializeThemeAndColors();
	});
</script>

{@render children()}
