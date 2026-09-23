<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { initializeThemeAndColors } from '$lib/stores/ui.svelte';
	import Toast from '$lib/components/shared/Toast.svelte';
	import ActivityIndicator from '$lib/components/generation/ActivityIndicator.svelte';
	import { browser } from '$app/environment';
	import { resetPricing } from '$lib/stores/pricing.svelte';

	let { children } = $props();

	// Every server render starts from at-cost defaults; the portal layout then
	// primes this request's pricing. See resetPricing() for why.
	if (!browser) resetPricing();

	/**
	 * Theme init belongs at the ROOT, not per route group.
	 *
	 * It was called only from (auth) and (portal), and the marketing page at `/`
	 * belongs to neither — so `data-theme` was never set there and a dark-mode
	 * visitor got the light palette on the first page they ever see. The two
	 * group-level calls still run first and are idempotent; this is the backstop
	 * that covers every route.
	 */
	onMount(() => {
		initializeThemeAndColors();
		// The viewer's zone, for the server to render instants in (see
		// PricingContext.timeZone). Written here — on the login page too — so
		// the FIRST portal render already has it; a portal-only cookie left every
		// new browser one page in the server's zone (round-4 re-audit).
		try {
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			if (tz && !document.cookie.split('; ').includes(`tz=${tz}`)) {
				document.cookie = `tz=${tz}; path=/; max-age=31536000; samesite=lax`;
			}
		} catch {
			/* no Intl zone — the server keeps its default */
		}
	});

	/**
	 * Share-card branding, env-driven.
	 *
	 * These tags were hardcoded to the HoneyX client deployment, so every share of
	 * any instance — including the PersonaGen marketing page — previewed as
	 * HoneyX on a honeyx.monarchstack.com URL. One repo serves both the product
	 * and per-client deployments, so the fix is configuration, not a rename:
	 * PersonaGen is the default and a client instance overrides via env.
	 */
	const brandName = env.PUBLIC_BRAND_NAME || 'PersonaGen';
	const brandUrl = env.PUBLIC_BRAND_URL || '';
	const brandTagline =
		env.PUBLIC_BRAND_TAGLINE ||
		`${brandName} — AI personas with a locked identity that publish to 13 platforms, with every post approved by you.`;
	const brandImage = env.PUBLIC_BRAND_OG_IMAGE || (brandUrl ? `${brandUrl}/assets/og-share.png` : '');
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
	<meta name="description" content={brandTagline} />
	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content={brandName} />
	<meta property="og:description" content={brandTagline} />
	{#if brandImage}<meta property="og:image" content={brandImage} />{/if}
	{#if brandUrl}<meta property="og:url" content={brandUrl} />{/if}
	<!-- Twitter Card -->
	<meta name="twitter:card" content={brandImage ? 'summary_large_image' : 'summary'} />
	<meta name="twitter:title" content={brandName} />
	<meta name="twitter:description" content={brandTagline} />
	{#if brandImage}<meta name="twitter:image" content={brandImage} />{/if}
</svelte:head>

<Toast />
<ActivityIndicator />
{@render children()}
