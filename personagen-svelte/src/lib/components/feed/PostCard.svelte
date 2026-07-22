<script lang="ts">
	import { getPostDisplay, getPostErrorSummary, summarizeGenError } from './postDisplay';
	import { platformColor } from '$lib/platforms';

	let {
		post,
		onOpen,
		onRetry = null,
		onPublishFallback = null
	}: {
		post: any;
		onOpen: (post: any) => void;
		onRetry?: ((post: any) => void) | null;
		/** Publish an already-generated but unpublished post to a connected platform. */
		onPublishFallback?: ((post: any) => void) | null;
	} = $props();

	// In-flight / failed state is read from the POST ROW, not a client flag, so a
	// hard refresh mid-generation still shows the spinner and a failure survives
	// the 4s toast that would otherwise be the only place it ever appeared.
	let isGenerating = $derived(post.status === 'generating');
	let isFailed = $derived(post.status === 'failed');

	// One safe, short sentence — never the raw provider payload (it leaks key ids
	// and reads as noise). See summarizeGenError().
	let genError = $derived(isFailed ? summarizeGenError(post) : null);

	// Video tiles stay static (poster only) until the user explicitly hits play,
	// so the feed pays zero metadata-fetch cost on load. One click mounts a real
	// <video> for THIS tile and plays it inline — no drawer needed.
	let playingInline = $state(false);

	let genTopic = $derived.by(() => {
		try {
			const c = typeof post.content === 'string' ? JSON.parse(post.content) : post.content;
			return c?.topic || null;
		} catch {
			return null;
		}
	});

	// Elapsed-vs-expected curve. fal gives no real progress, so this decelerates
	// toward 95% instead of parking at 100% while still spinning (which reads as
	// "stuck"). It resolves only when the row actually leaves 'generating'.
	const EXPECTED_MS = 90_000;
	let now = $state(Date.now());
	$effect(() => {
		if (!isGenerating) return;
		const t = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(t);
	});
	let startedAt = $derived(post.created_at ? new Date(post.created_at).getTime() : Date.now());
	let pct = $derived(
		Math.round(Math.min(0.95, 1 - Math.exp(-Math.max(0, now - startedAt) / (EXPECTED_MS * 0.6))) * 100)
	);
	let elapsedS = $derived(Math.max(0, Math.round((now - startedAt) / 1000)));

	let display = $derived(getPostDisplay(post));

	// A 'failed' row with media DID generate successfully — it only failed to
	// PUBLISH (e.g. no connected account). Keep the thumbnail and tag it "failed
	// to post"; reserve the blank "Generation failed" card for rows that truly
	// produced no media.
	let isPublishFail = $derived(isFailed && Boolean(display.mediaUrl));
	let isGenFail = $derived(isFailed && !display.mediaUrl);
	let postErrorLabel = $derived(getPostErrorSummary(post));

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

	// Warm the browser cache for the FULL media the instant the user shows intent to
	// open a tile, so the drawer renders from cache instead of a cold fetch. Videos
	// are the big win: the tile only ever loads the poster image, so the clip is
	// otherwise fetched for the very first time on click. The prefetch is low
	// priority (won't fight the visible feed) and deduped, so a hover-sweep across
	// the mosaic costs at most one lazy fetch per distinct clip.
	let warmed = false;
	function warmMedia() {
		const url = display.mediaUrl;
		if (warmed || !url || isGenerating || isGenFail) return;
		warmed = true;
		const link = document.createElement('link');
		link.rel = 'prefetch';
		link.as = display.mediaType === 'video' ? 'video' : 'image';
		link.href = url;
		document.head.appendChild(link);
	}
</script>

<!-- Media-first mosaic tile: the media IS the card. Everything else lives in
     the drawer that opens on click — tags stay as light overlays.
     It's a role=button DIV, not a <button>, so the inline video play control
     (a real <button>) and the <video> can nest legally inside it. -->
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
	class="post-tile"
	role="button"
	tabindex="0"
	onclick={() => onOpen(post)}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onOpen(post);
		}
	}}
	onpointerenter={warmMedia}
	onfocus={warmMedia}
	aria-label="Open post details"
>
	{#if isGenerating}
		<div class="tile-gen">
			<span class="tile-gen-spin"></span>
			<span class="tile-gen-title">Generating…</span>
			{#if genTopic}<span class="tile-gen-topic">{genTopic}</span>{/if}
			<div class="tile-gen-bar"><div class="tile-gen-fill" style="width:{pct}%"></div></div>
			<span class="tile-gen-time">{elapsedS}s · keeps running if you leave</span>
		</div>
	{:else if isGenFail}
		<div class="tile-gen failed">
			<span class="tile-gen-x">!</span>
			<span class="tile-gen-title">Generation failed</span>
			<span class="tile-gen-err">{genError}</span>
			{#if onRetry}
				<!-- svelte-ignore node_invalid_placement_ssr -->
				<span
					class="tile-gen-retry"
					role="button"
					tabindex="0"
					onclick={(e) => {
						e.stopPropagation();
						onRetry?.(post);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.stopPropagation();
							onRetry?.(post);
						}
					}}>↺ Retry</span
				>
			{/if}
		</div>
	{:else if display.mediaUrl}
		{#if display.mediaType === 'video'}
			<!-- Tiles start as a static POSTER (no <video>) so the feed pays zero
			     metadata-fetch cost on load. The real <video> mounts only after the
			     user clicks play — inline, right here, no drawer. -->
			{#if playingInline}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={display.mediaUrl}
					poster={display.posterUrl || undefined}
					controls
					autoplay
					playsinline
					preload="metadata"
					onclick={(e) => e.stopPropagation()}
				></video>
			{:else}
				{#if display.posterUrl}
					<img src={display.posterUrl} loading="lazy" alt="Video poster" />
				{:else}
					<div class="tile-video-placeholder"></div>
				{/if}
				<button
					type="button"
					class="tile-video-play"
					aria-label="Play video"
					onclick={(e) => {
						e.stopPropagation();
						playingInline = true;
					}}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
				</button>
			{/if}
		{:else}
			<img src={display.mediaUrl} loading="lazy" alt="Post media" />
		{/if}
	{:else}
		<!-- Defensive: media-less posts are purged, but render sanely if one appears -->
		<div class="tile-text-fallback">{display.text}</div>
	{/if}

	<div class="tile-chips-top">
		<span class="tile-platform" style="background: {platformColor(plat)}">{plat}</span>
		<span class="tile-status" data-status={isPublishFail ? 'post-failed' : post.status}>
			{isPublishFail ? 'not posted' : post.status}
		</span>
	</div>

	{#if isPublishFail}
		<!-- Media generated fine; only publishing failed. Show it, don't hide it,
		     and offer a one-tap route to a platform that IS connected. -->
		<div class="tile-postfail-banner">
			<span class="tile-postfail-msg" title={postErrorLabel ?? 'Failed to post'}>
				⚠ Failed to post{postErrorLabel ? ` — ${postErrorLabel.split('\n')[0]}` : ''}
			</span>
			{#if onPublishFallback}
				<!-- svelte-ignore node_invalid_placement_ssr -->
				<span
					class="tile-postfail-cta"
					role="button"
					tabindex="0"
					onclick={(e) => {
						e.stopPropagation();
						onPublishFallback?.(post);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.stopPropagation();
							onPublishFallback?.(post);
						}
					}}>📤 Publish to a connected platform</span
				>
			{/if}
		</div>
	{:else if hasError}
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
</div>

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
	.tile-status[data-status='post-failed'] {
		color: var(--warning);
		border-color: var(--warning);
	}

	.tile-postfail-banner {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 0.5rem 0.6rem;
		background: linear-gradient(transparent, rgba(180, 90, 10, 0.92));
		color: #fff;
		font-size: 0.66rem;
		font-weight: 600;
		line-height: 1.3;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		/* Let taps fall through to the tile — except the CTA, which opts back in. */
		pointer-events: none;
	}
	.tile-postfail-msg {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tile-postfail-cta {
		align-self: flex-start;
		pointer-events: auto;
		background: rgba(255, 255, 255, 0.95);
		color: #9a3412;
		border-radius: 6px;
		padding: 0.25rem 0.5rem;
		font-size: 0.64rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tile-postfail-cta:hover {
		background: #fff;
	}

	/* Centered play control — the ONE spot that plays inline. Clicking anywhere
	   else on the tile still opens the drawer (this stops propagation). */
	.tile-video-play {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 52px;
		height: 52px;
		padding: 0;
		padding-left: 3px; /* optically center the triangle */
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		border: 1.5px solid rgba(255, 255, 255, 0.85);
		border-radius: 999px;
		cursor: pointer;
		backdrop-filter: blur(2px);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
		transition: background 0.15s ease, transform 0.15s ease;
	}
	.tile-video-play:hover {
		background: rgba(0, 0, 0, 0.78);
		transform: translate(-50%, -50%) scale(1.08);
	}

	.post-tile video {
		aspect-ratio: 4 / 5;
		background: #000;
		object-fit: contain;
	}

	/* Fallback for legacy video posts with no poster still — a neutral tile
	   instead of forcing a video-frame download. */
	.tile-video-placeholder {
		width: 100%;
		height: 100%;
		background: linear-gradient(135deg, #1f2433, #2b3247);
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

	/* In-flight / failed generation states (driven by the post row's status).
	   This REPLACES the media, so it must carry its own height — absolutely
	   positioning it would collapse the tile to nothing. */
	.tile-gen {
		position: relative;
		aspect-ratio: 4 / 5;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.9rem;
		background: var(--surface, #fff);
		text-align: center;
	}
	.tile-gen.failed {
		background: #fef2f2;
	}
	.tile-gen-spin {
		width: 22px;
		height: 22px;
		border: 2px solid var(--border, #e6e8f0);
		border-top-color: var(--accent, #7c6aed);
		border-radius: 50%;
		animation: tile-spin 0.8s linear infinite;
	}
	@keyframes tile-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.tile-gen-x {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #dc2626;
		color: #fff;
		font-weight: 800;
		font-size: 0.8rem;
		display: grid;
		place-items: center;
	}
	.tile-gen-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text, #14172b);
	}
	.tile-gen-topic {
		font-size: 0.72rem;
		color: var(--muted, #6b7280);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tile-gen-err {
		font-size: 0.7rem;
		color: #991b1b;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tile-gen-bar {
		width: 80%;
		height: 5px;
		border-radius: 999px;
		background: var(--surface-2, #eef0f6);
		overflow: hidden;
	}
	.tile-gen-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent, #7c6aed), var(--cyan, #22d3ee));
		transition: width 0.5s ease-out;
	}
	.tile-gen-time {
		font-size: 0.66rem;
		color: var(--muted, #6b7280);
	}
	.tile-gen-retry {
		margin-top: 0.2rem;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.25rem 0.6rem;
		border-radius: 8px;
		background: #dc2626;
		color: #fff;
		cursor: pointer;
	}
</style>
