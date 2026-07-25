<script lang="ts">
	import { getPostDisplay, getPostErrorSummary, summarizeGenError } from './postDisplay';
	import { platformColor } from '$lib/platforms';

	let {
		post,
		onOpen,
		onRetry = null,
		onPublishFallback = null,
		selectable = false,
		selected = false,
		onToggleSelect = null,
		onDelete = null,
		onEnlarge = null
	}: {
		post: any;
		onOpen: (post: any) => void;
		onRetry?: ((post: any) => void) | null;
		/** Publish an already-generated but unpublished post to a connected platform. */
		onPublishFallback?: ((post: any) => void) | null;
		/** Multi-select support — a checkbox overlay for bulk actions. */
		selectable?: boolean;
		selected?: boolean;
		onToggleSelect?: ((post: any) => void) | null;
		/** Per-card delete. Omit to hide the button. */
		onDelete?: ((post: any) => void) | null;
		/** Click-to-enlarge the tile's media in a lightbox. */
		onEnlarge?: ((post: any) => void) | null;
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
	// Kick playback imperatively the moment the <video> mounts (right after the
	// user's tap), then swallow the promise rejection. Unmuted autoplay via the
	// bare `autoplay` attribute is often blocked on iOS/Android when the element
	// is inserted a tick after the gesture — calling play() ourselves plays inside
	// the retained user-activation window, and if the browser still blocks it the
	// native `controls` remain as the manual fallback. We keep sound (these are
	// dialogue UGC clips) rather than muting to satisfy autoplay policy.
	function playOnMount(node: HTMLVideoElement) {
		node.play?.().catch(() => {});
	}

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
	class:selected
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
	<!-- Management overlays: select for bulk actions, enlarge, delete. All stop
	     propagation so they never open the drawer by accident. -->
	{#if selectable}
		<!-- svelte-ignore node_invalid_placement_ssr -->
		<label
			class="tile-select"
			title="Select for bulk actions"
			onclick={(e) => e.stopPropagation()}
		>
			<input
				type="checkbox"
				checked={selected}
				onchange={() => onToggleSelect?.(post)}
				aria-label="Select this post"
			/>
		</label>
	{/if}
	{#if onEnlarge || onDelete}
		<div class="tile-manage">
			{#if onEnlarge}
				<!-- svelte-ignore node_invalid_placement_ssr -->
				<button
					type="button"
					class="tile-manage-btn"
					title="Enlarge media"
					aria-label="Enlarge post media"
					onclick={(e) => {
						e.stopPropagation();
						onEnlarge?.(post);
					}}
				>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
						><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg
					>
				</button>
			{/if}
			{#if onDelete}
				<!-- svelte-ignore node_invalid_placement_ssr -->
				<button
					type="button"
					class="tile-manage-btn danger"
					title="Delete post"
					aria-label="Delete post"
					onclick={(e) => {
						e.stopPropagation();
						onDelete?.(post);
					}}
				>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
						><path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 01-2 2H9a2 2 0 01-2-2V6h12" /></svg
					>
				</button>
			{/if}
		</div>
	{/if}
	{#if isGenerating}
		<div class="tile-gen">
			<span class="tile-gen-spin"></span>
			<span class="tile-gen-title">Generating…</span>
			{#if genTopic}<span class="tile-gen-topic">{genTopic}</span>{/if}
			<div
				class="tile-gen-bar"
				role="progressbar"
				aria-label="Generation progress"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={pct}
			>
				<div class="tile-gen-fill" style="transform:scaleX({pct / 100})"></div>
			</div>
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
					}}
					><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v5h5" /></svg
					> Retry</span
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
					playsinline
					preload="metadata"
					use:playOnMount
					onclick={(e) => e.stopPropagation()}
				></video>
				<!-- Native controls capture taps, so the tile can't be clicked to open
				     the drawer while playing. This gives that exit back: stop the inline
				     clip and open the details sidebar in one tap. -->
				<button
					type="button"
					class="tile-video-details"
					aria-label="Stop and open details"
					onclick={(e) => {
						e.stopPropagation();
						playingInline = false;
						onOpen(post);
					}}
				>
					Details
				</button>
			{:else}
				{#if display.posterUrl}
					<img
						src={display.posterUrl}
						width="800"
						height="1000"
						loading="lazy"
						decoding="async"
						alt="Video poster frame for this post"
					/>
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
			<img
				src={display.mediaUrl}
				width="800"
				height="1000"
				loading="lazy"
				decoding="async"
				alt="Post media"
			/>
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
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg
				> Failed to post{postErrorLabel ? ` — ${postErrorLabel.split('\n')[0]}` : ''}
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
					}}
					><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg
					> Publish to a connected platform</span
				>
			{/if}
		</div>
	{:else if hasError}
		<span class="tile-error-dot" title="This post has an error — open for details">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="This post has an error"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
		</span>
	{/if}

	{#if hasRealStats}
		<div class="tile-stats">
			{#if analytics.views}
				<span
					><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg
					>
					<span class="sr-only">Views:</span>
					{analytics.views >= 1000 ? (analytics.views / 1000).toFixed(1) + 'K' : analytics.views}</span
				>
			{/if}
			{#if analytics.likes}<span
					><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg
					>
					<span class="sr-only">Likes:</span>
					{analytics.likes}</span
				>{/if}
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

	.post-tile.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent) inset;
	}

	/* ── Management overlays (select / enlarge / delete) ── */
	.tile-select {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 7px;
		background: rgba(12, 16, 30, 0.72);
		backdrop-filter: blur(4px);
		cursor: pointer;
	}
	/* Keep the 26px visual chip, but give the control a full 44x44 tap area. */
	.tile-select::after,
	.tile-manage-btn::after,
	.tile-video-play::after,
	.tile-video-details::after,
	.tile-gen-retry::after,
	.tile-postfail-cta::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		min-width: 44px;
		min-height: 44px;
		width: 100%;
		height: 100%;
	}
	.tile-select input {
		width: 15px;
		height: 15px;
		margin: 0;
		cursor: pointer;
		accent-color: var(--accent);
	}
	.tile-manage {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 5;
		display: flex;
		/* >= 18px so the two 44x44 tap areas below never overlap — a stray tap on
		   Enlarge must never land on Delete. */
		gap: 1.15rem;
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.post-tile:hover .tile-manage,
	.post-tile:focus-within .tile-manage,
	.post-tile.selected .tile-manage {
		opacity: 1;
	}
	.tile-manage-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border-radius: 7px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(12, 16, 30, 0.72);
		backdrop-filter: blur(4px);
		color: #fff;
		cursor: pointer;
	}
	.tile-manage-btn:hover {
		background: rgba(12, 16, 30, 0.94);
	}
	.tile-manage-btn.danger:hover {
		border-color: var(--error);
		/* The chip is always dark, so lighten the token rather than hardcoding a red. */
		color: color-mix(in srgb, var(--error) 60%, #fff);
	}

	/* Every tile is normalized to one aspect ratio so the mosaic reads as an even
	   grid — a failed/generating card is the SAME size as the image or video
	   beside it, regardless of the media's native ratio. */
	.post-tile img,
	.post-tile video {
		width: 100%;
		/* `height: auto` keeps aspect-ratio in charge — without it the img's
		   width/height attributes would apply as a presentational height hint. */
		height: auto;
		display: block;
		object-fit: cover;
		aspect-ratio: 4 / 5;
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
	.tile-postfail-msg svg,
	.tile-postfail-cta svg,
	.tile-gen-retry svg {
		vertical-align: -0.15em;
	}
	.tile-postfail-cta {
		position: relative;
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
	/* The CTA sits inside a pointer-events:none banner, so its expanded tap area
	   has to opt back in explicitly. */
	.tile-postfail-cta::after {
		pointer-events: auto;
	}

	/* Centered play control — the ONE spot that plays inline. Clicking anywhere
	   else on the tile still opens the drawer (this stops propagation). */
	.tile-video-play {
		position: absolute;
		bottom: 10px;
		right: 10px;
		width: 38px;
		height: 38px;
		padding: 0;
		padding-left: 2px; /* optically center the triangle */
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		border: 1.5px solid rgba(255, 255, 255, 0.85);
		border-radius: 999px;
		cursor: pointer;
		backdrop-filter: blur(2px);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
		transition: background 0.15s ease, transform 0.15s ease;
	}
	.tile-video-play:hover {
		background: rgba(0, 0, 0, 0.82);
		transform: scale(1.08);
	}

	/* Escape hatch while a tile plays inline — sits clear of the video's own
	   controls (top-right) so it never overlaps the scrubber. */
	.tile-video-details {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 2;
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 700;
		color: #fff;
		background: rgba(0, 0, 0, 0.62);
		border: 1px solid rgba(255, 255, 255, 0.7);
		border-radius: 999px;
		cursor: pointer;
		backdrop-filter: blur(4px);
	}
	.tile-video-details:hover {
		background: rgba(0, 0, 0, 0.85);
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
		aspect-ratio: 4 / 5;
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
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	.tile-stats span {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
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
		background: var(--surface);
		text-align: center;
	}
	.tile-gen.failed {
		background: var(--error-soft);
	}
	.tile-gen-spin {
		width: 22px;
		height: 22px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
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
		background: var(--error);
		color: #fff;
		font-weight: 800;
		font-size: 0.8rem;
		display: grid;
		place-items: center;
	}
	.tile-gen-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text);
	}
	.tile-gen-topic {
		font-size: 0.72rem;
		color: var(--muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tile-gen-err {
		font-size: 0.7rem;
		color: var(--error-text);
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
		background: var(--surface-2);
		overflow: hidden;
	}
	/* Full-width fill driven by scaleX so progress never triggers layout — the bar
	   has no text child, so the scale is visually identical to animating width. */
	.tile-gen-fill {
		width: 100%;
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent), var(--cyan));
		transform-origin: left center;
		transition: transform 0.25s ease-out;
	}
	.tile-gen-time {
		font-size: 0.66rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.tile-gen-retry {
		position: relative;
		margin-top: 0.2rem;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.25rem 0.6rem;
		border-radius: 8px;
		background: var(--error);
		color: #fff;
		cursor: pointer;
	}
</style>
