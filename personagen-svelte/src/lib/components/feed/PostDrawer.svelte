<script lang="ts">
	import { fly, fade } from 'svelte/transition';

	let {
		post,
		onClose,
		onDelete,
		onApprove,
		approving = false,
		deleting = false
	}: {
		post: any | null;
		onClose: () => void;
		onDelete: (post: any) => void;
		onApprove: (post: any) => void;
		approving?: boolean;
		deleting?: boolean;
	} = $props();

	function getPostDisplay(content: string) {
		try {
			const trimmed = content?.trim() ?? '';
			if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
				const parsed = JSON.parse(trimmed);
				return {
					text: parsed.text || content,
					mediaUrl: parsed.media_url || parsed.mediaUrl || null,
					mediaType: parsed.media_type || parsed.mediaType || 'image',
					posterUrl: parsed.poster_url || null,
					ugcPrompt: parsed.ugc_broll_prompt || parsed.ugcPrompt || null,
					script: parsed.script || null,
					product: parsed.product || null
				};
			}
		} catch {}
		return {
			text: content,
			mediaUrl: null,
			mediaType: 'image',
			posterUrl: null,
			ugcPrompt: null,
			script: null,
			product: null
		};
	}

	let display = $derived(post ? getPostDisplay(post.content) : null);
	let analytics = $derived(post?.analytics ?? null);
	let hasRealStats = $derived(
		Boolean(analytics && (analytics.views || analytics.likes || analytics.comments || analytics.shares))
	);

	let platformResults = $derived.by(() => {
		if (!post?.publication_results) return [];
		return Object.entries(post.publication_results).filter(([key]) => key !== '_post');
	});

	let postLevelError = $derived(post?.publication_results?._post?.error ?? null);

	function platformColor(p: string): string {
		const colors: Record<string, string> = {
			tiktok: '#fe2c55',
			instagram: '#e1306c',
			youtube: '#ff0000',
			facebook: '#1877f2',
			x: '#555',
			threads: '#999'
		};
		return colors[p?.toLowerCase()] || 'var(--accent)';
	}

	function statusColor(status: string): string {
		if (status === 'published') return 'var(--success)';
		if (status === 'failed') return 'var(--error)';
		if (status === 'publishing') return 'var(--cyan)';
		if (status === 'partial') return 'var(--warning)';
		if (status === 'scheduled') return 'var(--accent)';
		return 'var(--text-dim)';
	}

	function formatPostDate(p: any): string {
		const d =
			p.published_at ||
			(p.scheduled_date ? `${p.scheduled_date}T${p.scheduled_time || '10:00:00'}` : null);
		if (!d) return 'Recently';
		return new Date(d).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// ── Delete two-click confirm ──────────────────────────────────────
	let confirmingDelete = $state(false);
	let confirmTimeout: ReturnType<typeof setTimeout> | undefined;

	function handleDeleteClick() {
		if (!post || deleting) return;
		if (confirmingDelete) {
			clearTimeout(confirmTimeout);
			confirmingDelete = false;
			onDelete(post);
		} else {
			confirmingDelete = true;
			confirmTimeout = setTimeout(() => {
				confirmingDelete = false;
			}, 3000);
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={post ? onKeydown : undefined} />

{#if post && display}
	<div class="drawer-backdrop" transition:fade={{ duration: 150 }} onclick={onClose} role="presentation"></div>
	<aside class="post-drawer" transition:fly={{ x: 440, duration: 260, opacity: 1 }} role="dialog" aria-label="Post details" tabindex="-1">
		<div class="drawer-header">
			<div class="drawer-header-meta">
				<span class="drawer-date">{formatPostDate(post)}</span>
				<span class="drawer-status-badge" style="color: {statusColor(post.status)}; border-color: {statusColor(post.status)}">{post.status}</span>
				{#each post.platforms ?? [] as p (p)}
					<span class="drawer-platform-pill" style="background: {platformColor(p)}">{p}</span>
				{/each}
			</div>
			<button class="drawer-close" onclick={onClose} aria-label="Close details">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
			</button>
		</div>

		<div class="drawer-body">
			{#if display.mediaUrl}
				<div class="drawer-media">
					{#if display.mediaType === 'video'}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={display.mediaUrl} poster={display.posterUrl || undefined} controls playsinline preload="metadata"></video>
					{:else}
						<img src={display.mediaUrl} alt="Post media" />
					{/if}
				</div>
			{/if}

			{#if hasRealStats}
				<div class="drawer-stats">
					{#if analytics.views}<span class="stat"><strong>{analytics.views >= 1000 ? (analytics.views / 1000).toFixed(1) + 'K' : analytics.views}</strong> views</span>{/if}
					{#if analytics.likes}<span class="stat"><strong>{analytics.likes}</strong> likes</span>{/if}
					{#if analytics.comments}<span class="stat"><strong>{analytics.comments}</strong> comments</span>{/if}
					{#if analytics.shares}<span class="stat"><strong>{analytics.shares}</strong> shares</span>{/if}
				</div>
			{:else if post.status === 'published'}
				<p class="drawer-stats-pending">Stats pending first sync from the platform.</p>
			{/if}

			<p class="drawer-text">{display.text}</p>

			{#if display.product?.name}
				<div class="drawer-product">
					<span class="drawer-block-label">Product</span>
					<span>{display.product.name}{display.product.price ? ` — ${display.product.price}` : ''}</span>
				</div>
			{/if}

			{#if display.ugcPrompt || display.script}
				<details class="drawer-details-block">
					<summary>Generation details</summary>
					{#if display.ugcPrompt}
						<div>
							<span class="drawer-block-label">🎥 UGC prompt</span>
							<p>{display.ugcPrompt}</p>
						</div>
					{/if}
					{#if display.script}
						<div>
							<span class="drawer-block-label">🎬 Script</span>
							<p>{display.script}</p>
						</div>
					{/if}
				</details>
			{/if}

			{#if postLevelError}
				<div class="drawer-error">
					<strong>⚠ Post-level error</strong>
					<p>{postLevelError}</p>
				</div>
			{/if}

			{#if platformResults.length > 0}
				<div class="drawer-breakdown">
					<span class="drawer-block-label">Platform breakdown</span>
					{#each platformResults as [platform, result] (platform)}
						{@const r = result as any}
						<div class="breakdown-item">
							<div class="breakdown-head">
								<span style="color: {platformColor(platform)}; font-weight: 700; text-transform: capitalize;">{platform}</span>
								<span class="breakdown-pill" style="color: {statusColor(r.status)}; border-color: {statusColor(r.status)};">{r.status}</span>
							</div>
							{#if r.status === 'failed' && r.error}
								<p class="breakdown-error">{r.error}</p>
							{/if}
							{#if r.permalink}
								<a href={r.permalink} target="_blank" rel="noopener noreferrer" class="breakdown-link">View live post ↗</a>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="drawer-footer">
			<button type="button" class="btn-drawer-delete" class:confirming={confirmingDelete} disabled={deleting} onclick={handleDeleteClick}>
				{#if deleting}Deleting…{:else if confirmingDelete}Confirm delete?{:else}Delete{/if}
			</button>
			{#if post.status === 'draft'}
				<button type="button" class="btn-drawer-approve" disabled={approving} onclick={() => onApprove(post)}>
					{approving ? 'Approving…' : '✓ Approve & Schedule'}
				</button>
			{/if}
			<button type="button" class="btn-drawer-close" onclick={onClose}>Close</button>
		</div>
	</aside>
{/if}

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(4px);
		z-index: 1000;
	}

	.post-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(440px, 100vw);
		background: var(--surface);
		border-left: 1px solid var(--border-strong);
		z-index: 1001;
		display: flex;
		flex-direction: column;
		box-shadow: -18px 0 50px rgba(0, 0, 0, 0.35);
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}

	.drawer-header-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.drawer-date {
		font-size: 0.78rem;
		color: var(--text-dim);
	}

	.drawer-status-badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 8px;
		border-radius: 4px;
		border: 1px solid;
	}

	.drawer-platform-pill {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		color: #fff;
		padding: 2px 8px;
		border-radius: 999px;
	}

	.drawer-close {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: none;
		background: var(--surface);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.2s, color 0.2s, transform 0.2s;
	}

	.drawer-close:hover {
		color: var(--text);
		background: var(--border-strong);
		transform: rotate(90deg);
	}

	.drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.drawer-media {
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--border);
		background: #000;
	}

	.drawer-media img,
	.drawer-media video {
		width: 100%;
		max-height: 55vh;
		object-fit: contain;
		display: block;
	}

	.drawer-stats {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.6rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.stat {
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.stat strong {
		color: var(--text);
	}

	.drawer-stats-pending {
		font-size: 0.75rem;
		color: var(--text-dim);
		font-style: italic;
		margin: 0;
	}

	.drawer-text {
		font-size: 0.85rem;
		color: var(--text);
		line-height: 1.6;
		white-space: pre-wrap;
		margin: 0;
	}

	.drawer-product {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.drawer-block-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		font-weight: 700;
		display: block;
	}

	.drawer-details-block {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.75rem 0.9rem;
		font-size: 0.75rem;
		color: var(--text-dim);
	}

	.drawer-details-block summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.drawer-details-block div {
		margin-top: 0.6rem;
	}

	.drawer-details-block p {
		margin: 0.25rem 0 0;
		white-space: pre-wrap;
	}

	.drawer-error {
		background: var(--error-soft);
		border-left: 3px solid var(--error);
		border-radius: 6px;
		padding: 0.6rem 0.85rem;
		color: var(--error);
	}

	.drawer-error strong {
		font-size: 0.78rem;
		display: block;
	}

	.drawer-error p {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
	}

	.drawer-breakdown {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.breakdown-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.7rem 0.85rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.breakdown-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.breakdown-pill {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid;
	}

	.breakdown-error {
		font-size: 0.75rem;
		color: var(--error);
		margin: 0;
		line-height: 1.5;
	}

	.breakdown-link {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
		align-self: flex-start;
	}

	.breakdown-link:hover {
		text-decoration: underline;
	}

	.drawer-footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.9rem 1.25rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}

	.btn-drawer-delete {
		background: var(--error-soft);
		color: var(--error);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-drawer-delete:hover:not(:disabled),
	.btn-drawer-delete.confirming {
		background: var(--error);
		color: #fff;
	}

	.btn-drawer-approve {
		background: var(--success-soft);
		color: var(--success);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-drawer-approve:hover:not(:disabled) {
		background: var(--success);
		color: #fff;
	}

	.btn-drawer-approve:disabled,
	.btn-drawer-delete:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-drawer-close {
		margin-left: auto;
		background: var(--surface);
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-drawer-close:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	@media (max-width: 520px) {
		.post-drawer {
			width: 100vw;
			border-left: none;
		}
	}
</style>
