<script lang="ts">
	import '../app.css';
	import Toast from '$lib/components/shared/Toast.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="HoneyX — AI Agent-Powered UGC Creator Management" />
	<meta
		property="og:description"
		content="HoneyX — autonomous AI agents managing your UGC creator roster, content calendar, and analytics."
	/>
	<meta property="og:image" content="https://honeyx.monarchstack.com/assets/og-share.png" />
	<meta property="og:url" content="https://honeyx.monarchstack.com" />
	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="HoneyX — AI Agent-Powered UGC Creator Management" />
	<meta
		name="twitter:description"
		content="HoneyX — autonomous AI agents managing your UGC creator roster, content calendar, and analytics."
	/>
	<meta name="twitter:image" content="https://honeyx.monarchstack.com/assets/og-share.png" />
</svelte:head>

<Toast />
{@render children()}
