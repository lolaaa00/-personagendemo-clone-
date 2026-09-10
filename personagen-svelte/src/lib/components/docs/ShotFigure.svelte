<script lang="ts">
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';

	/**
	 * A screenshot that is legible at column width. The captures are full-page
	 * (2160×1350, some 360×2250), and squeezing one into an 860px column made
	 * every label 5px tall — which is why readers said the docs "look
	 * horrible". This shows a FRAMED VIEWPORT of the capture, optionally zoomed
	 * on the region the step is about, and opens the full capture in the app's
	 * lightbox on click.
	 *
	 *   focus  { x, y }  0–100: which point of the capture stays centred
	 *   zoom   1–3       how far to magnify that region (1 = whole capture)
	 *   ratio  'wide' | 'tall'  the viewport's shape
	 */
	let {
		src,
		alt,
		caption = '',
		focus = { x: 50, y: 0 },
		zoom = 1,
		ratio = 'wide'
	}: {
		src: string;
		alt: string;
		caption?: string;
		focus?: { x: number; y: number };
		zoom?: number;
		ratio?: 'wide' | 'tall';
	} = $props();

	let open = $state(false);
	const z = $derived(Math.max(1, Math.min(3, zoom)));
</script>

<figure class="shot" class:tall={ratio === 'tall'}>
	<div class="shot-chrome" aria-hidden="true">
		<span></span><span></span><span></span>
	</div>
	<button
		type="button"
		class="shot-view"
		onclick={() => (open = true)}
		title="Open full size"
		aria-label={`${alt} — open full size`}
	>
		<img
			{src}
			{alt}
			loading="lazy"
			style={`object-position: ${focus.x}% ${focus.y}%; transform: scale(${z}); transform-origin: ${focus.x}% ${focus.y}%;`}
		/>
		{#if z > 1}
			<span class="shot-zoom">zoomed ×{z} · click for the full page</span>
		{:else}
			<span class="shot-zoom">click to enlarge</span>
		{/if}
	</button>
	{#if caption}
		<figcaption>{caption}</figcaption>
	{/if}
</figure>

{#if open}
	<ImageLightbox url={src} label={alt} type="image" onClose={() => (open = false)} />
{/if}

<style>
	.shot {
		margin: 0.75rem 0 0.25rem;
		max-width: 760px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md, 12px);
		background: var(--surface);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}
	.shot-chrome {
		display: flex;
		gap: 5px;
		padding: 8px 10px;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2, var(--bg));
	}
	.shot-chrome span {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--border-strong);
	}
	.shot-view {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: var(--bg);
		cursor: zoom-in;
		position: relative;
		aspect-ratio: 16 / 10;
		overflow: hidden;
	}
	.shot.tall .shot-view {
		aspect-ratio: 4 / 3;
	}
	.shot-view img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.25s ease;
	}
	.shot-view:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.shot-zoom {
		position: absolute;
		right: 8px;
		bottom: 8px;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text) 78%, transparent);
		color: var(--bg);
		font-size: var(--text-xs);
		opacity: 0;
		transition: opacity 0.15s;
		pointer-events: none;
	}
	.shot-view:hover .shot-zoom,
	.shot-view:focus-visible .shot-zoom {
		opacity: 1;
	}
	figcaption {
		padding: 0.5rem 0.8rem;
		border-top: 1px solid var(--border);
		font-size: var(--text-sm);
		color: var(--text-dim);
	}
</style>
