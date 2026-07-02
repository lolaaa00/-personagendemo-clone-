<script lang="ts">
	import { getPostDisplay } from './postDisplay';
	import { platformColor } from '$lib/platforms';

	let {
		post,
		onOpen
	}: {
		post: any;
		onOpen: (post: any) => void;
	} = $props();

	let display = $derived(getPostDisplay(post));
	let analytics = $derived(post.analytics ?? null);
	let hasRealStats = $derived(Boolean(analytics && (analytics.views || analytics.likes)));

	let hasError = $derived.by(() => {
		const results = post.publication_results;
		if (!results || typeof results !== 'object') return false;
		if (results._post?.error) return true;
		return Object.entries(results).some(
			([key, val]: [string, any]) => key !== '_post' && val?.status === 'failed'
		);
	});

	let plat = $derived((post.platforms?.[0] ?? 'instagram').toLowerCase());
</script>

<!-- Media-first mosaic tile: the media IS the card. Everything else lives in
     the drawer that opens on click — tags stay as light overlays. -->
<button type="button" class="post-tile" onclick={() => onOpen(post)} aria-label="Open post details">
	{#if display.mediaUrl}
		{#if display.mediaType === 'video'}
			<video
				src={display.mediaUrl}
				poster={display.posterUrl || undefined}
				muted
				playsinline
				preload="metadata"
			></video>
			<span class="tile-video-badge">▶</span>
		{:else}
			<img src={display.mediaUrl} loading="lazy" alt="Post media" />
		{/if}
	{:else}
		<!-- Defensive: media-less posts are purged, but render sanely if one appears -->
		<div class="tile-text-fallback">{display.text}</div>
	{/if}

	<div class="tile-chips-top">
		<span class="tile-platform" style="background: {platformColor(plat)}">{plat}</span>
		<span class="tile-status" data-status={post.status}>{post.status}</span>
	</div>

	{#if hasError}
		<span class="tile-error-dot" title="This post has an error — open for details">⚠</span>
	{/if}

	{#if hasRealStats}
		<div class="tile-stats">
			{#if analytics.views}
				<span>👁 {analytics.views >= 1000 ? (analytics.views / 1000).toFixed(1) + 'K' : analytics.views}</span>
			{/if}
			{#if analytics.likes}<span>♥ {analytics.likes}</span>{/if}
		</div>
	{/if}
</button>

<style>
	.post-tile {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--surface);
		cursor: pointer;
		break-inside: avoid;
		margin-bottom: 1rem;
		transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
	}

	.post-tile:hover {
		border-color: var(--accent-mid);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}

	.post-tile img,
	.post-tile video {
		width: 100%;
		display: block;
		object-fit: cover;
	}

	.tile-text-fallback {
		padding: 1rem;
		font-size: 0.78rem;
		color: var(--text-muted);
		line-height: 1.5;
		text-align: left;
		display: -webkit-box;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: pre-wrap;
		min-height: 90px;
	}

	.tile-chips-top {
		position: absolute;
		top: 8px;
		left: 8px;
		right: 8px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		pointer-events: none;
	}

	.tile-platform {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		color: #fff;
		padding: 2px 8px;
		border-radius: 999px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
	}

	.tile-status {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 7px;
		border-radius: 4px;
		background: rgba(10, 14, 26, 0.72);
		backdrop-filter: blur(4px);
		border: 1px solid;
	}

	.tile-status[data-status='published'] {
		color: var(--success);
		border-color: var(--success);
	}
	.tile-status[data-status='scheduled'] {
		color: var(--accent);
		border-color: var(--accent);
	}
	.tile-status[data-status='publishing'] {
		color: var(--cyan);
		border-color: var(--cyan);
	}
	.tile-status[data-status='draft'] {
		color: #d9dbe3;
		border-color: rgba(255, 255, 255, 0.45);
	}
	.tile-status[data-status='failed'] {
		color: var(--error);
		border-color: var(--error);
	}
	.tile-status[data-status='partial'] {
		color: var(--warning);
		border-color: var(--warning);
	}

	.tile-video-badge {
		position: absolute;
		bottom: 8px;
		right: 8px;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		font-size: 11px;
		border-radius: 999px;
		pointer-events: none;
	}

	.tile-error-dot {
		position: absolute;
		bottom: 8px;
		left: 8px;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--error);
		color: #fff;
		font-size: 12px;
		border-radius: 999px;
		pointer-events: none;
	}

	.tile-stats {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		gap: 0.75rem;
		padding: 1.4rem 0.7rem 0.5rem;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
		color: #fff;
		font-size: 0.72rem;
		font-weight: 600;
		pointer-events: none;
	}
</style>
