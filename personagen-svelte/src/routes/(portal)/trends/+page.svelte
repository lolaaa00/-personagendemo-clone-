<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		goto('/scout');
	});
</script>

<p style="padding: 2rem; color: var(--text-muted); font-family: var(--font-body);">Redirecting to Social Scout...</p>
