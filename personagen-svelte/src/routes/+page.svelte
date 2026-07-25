<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data } = $props();

	onMount(() => {
		// In dev mode (no real session), always go to dashboard
		goto('/dashboard');
	});
</script>

<svelte:head>
	<title>PersonaGen — AI Personas That Run Your Accounts</title>
	<meta
		name="description"
		content="Create AI personas with a locked identity and run their content, calendar, and analytics from one place."
	/>
</svelte:head>

<div class="loading-screen">
	<div class="loader"></div>
</div>

<style>
	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--bg);
	}
	.loader {
		width: 40px;
		height: 40px;
		border: 3px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
