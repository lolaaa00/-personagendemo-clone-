<script lang="ts">
	import { getPostDisplay } from './postDisplay';

	let {
		post,
		onOpen,
		onDelete,
		onApprove,
		deleting = false,
		approving = false
	}: {
		post: any;
		onOpen: (post: any) => void;
		onDelete: (post: any) => void;
		onApprove: (post: any) => void;
		deleting?: boolean;
		approving?: boolean;
	} = $props();

	let display = $derived(getPostDisplay(post));
	let analytics = $derived(post.analytics ?? {});

	// ── Publication results / error parsing ──────────────────────────
	function truncate(str: string, len = 80): string {
		if (!str) return str;
		return str.length > len ? str.slice(0, len).trimEnd() + '…' : str;
	}

	let hasError = $derived.by(() => {
		const results = post.publication_results;
		if (!results || typeof results !== 'object') return false;
		if (results._post?.error) return true;
		return Object.entries(results).some(
			([key, val]: [string, any]) => key !== '_post' && val?.status === 'failed'
		);
	});

	let errorSummary = $derived.by(() => {
		const results = post.publication_results;
		if (!results || typeof results !== 'object') return null;
		if (results._post?.error) return truncate(String(results._post.error));
		for (const [key, val] of Object.entries(results) as [string, any][]) {
			if (key === '_post') continue;
			if (val?.status === 'failed' && val?.error) return truncate(String(val.error));
		}
		return hasError ? 'Publish failed' : null;
	});

	// ── Platform / date helpers ───────────────────────────────────────
	let plat = $derived((post.platforms?.[0] ?? 'instagram').toLowerCase());

	function platformColor(p: string): string {
		if (p === 'tiktok') return '#fe2c55';
		if (p === 'instagram') return '#e1306c';
		if (p === 'youtube') return '#ff0000';
		return '#1877f2';
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
		if (deleting) return;
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
</script>

<div class="post-card">
	<!-- Tag chips -->
	<div class="post-card-header">
		<span class="platform-pill" style="background: {platformColor(plat)}">{plat}</span>
		<span
			class="media-type-pill"
			title={display.mediaType === 'video' ? 'Video' : 'Image'}
		>
			{display.mediaType === 'video' ? '🎬 video' : '🖼 image'}
		</span>
		<span class="post-date">{formatPostDate(post)}</span>
		<span class="post-status-badge" data-status={post.status}>{post.status}</span>
	</div>

	<!-- Media preview -->
	{#if display.mediaUrl}
		<button type="button" class="post-media" onclick={() => onOpen(post)} aria-label="Open post details">
			{#if display.mediaType === 'video'}
				<video src={display.mediaUrl} poster={display.posterUrl || undefined} muted playsinline preload="metadata"></video>
				<span class="video-badge">▶ video</span>
			{:else}
				<img src={display.mediaUrl} loading="lazy" alt="Post media" />
			{/if}
		</button>
	{/if}

	<!-- Error note -->
	{#if hasError}
		<div class="post-error-note">⚠ {errorSummary}</div>
	{/if}

	<!-- Caption -->
	<p class="post-text">{display.text}</p>

	<!-- UGC prompt if present -->
	{#if display.ugcPrompt}
		<div class="post-ugc-prompt">
			<span class="ugc-label">UGC prompt</span>
			<span class="ugc-text">{display.ugcPrompt}</span>
		</div>
	{/if}

	<!-- Analytics strip -->
	{#if post.status === 'published' && (analytics.views || analytics.likes || analytics.comments || analytics.shares)}
		<div class="analytics-strip">
			{#if analytics.views}
				<span class="analytics-stat">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
					{analytics.views >= 1000 ? (analytics.views / 1000).toFixed(1) + 'K' : analytics.views}
				</span>
			{/if}
			{#if analytics.likes}
				<span class="analytics-stat">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
					{analytics.likes}
				</span>
			{/if}
			{#if analytics.comments}
				<span class="analytics-stat">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
					{analytics.comments}
				</span>
			{/if}
			{#if analytics.shares}
				<span class="analytics-stat">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
					{analytics.shares}
				</span>
			{/if}
			{#if analytics.views && analytics.likes}
				<span class="analytics-stat engagement-rate">
					{((analytics.likes / analytics.views) * 100).toFixed(1)}% eng
				</span>
			{/if}
		</div>
	{/if}

	<!-- Footer actions -->
	<div class="post-card-footer">
		<button type="button" class="btn-card-open" onclick={() => onOpen(post)}>View details</button>
		<span class="footer-actions-right">
			{#if post.status === 'draft'}
				<button
					type="button"
					class="btn-card-approve"
					disabled={approving}
					onclick={() => onApprove(post)}
				>
					{#if approving}
						<span class="spinner-sm"></span> Approving…
					{:else}
						✓ Approve
					{/if}
				</button>
			{/if}
			<button
				type="button"
				class="btn-card-delete"
				class:confirming={confirmingDelete}
				disabled={deleting}
				onclick={handleDeleteClick}
			>
				{#if deleting}
					<span class="spinner-sm"></span> Deleting…
				{:else if confirmingDelete}
					Confirm delete?
				{:else}
					Delete
				{/if}
			</button>
		</span>
	</div>
</div>

<style>
	.post-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		transition:
			border-color 0.15s ease,
			transform 0.15s ease;
		break-inside: avoid;
		margin-bottom: 1rem;
	}

	.post-card:hover {
		border-color: var(--accent-mid);
		transform: translateY(-2px);
	}

	.post-card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.platform-pill {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		color: #fff;
		padding: 2px 8px;
		border-radius: 999px;
	}

	.media-type-pill {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-dim);
		background: var(--surface-2);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: 999px;
	}

	.post-date {
		font-size: 0.72rem;
		color: var(--text-dim);
		flex: 1;
	}

	.post-status-badge {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid;
	}

	.post-status-badge[data-status='published'] {
		color: var(--success);
		border-color: var(--success);
	}
	.post-status-badge[data-status='scheduled'] {
		color: var(--accent);
		border-color: var(--accent);
	}
	.post-status-badge[data-status='draft'] {
		color: var(--text-dim);
		border-color: var(--border-strong);
	}
	.post-status-badge[data-status='failed'] {
		color: var(--error);
		border-color: var(--error);
	}
	.post-status-badge[data-status='publishing'] {
		color: var(--cyan);
		border-color: var(--cyan);
	}
	.post-status-badge[data-status='partial'] {
		color: var(--warning);
		border-color: var(--warning);
	}

	.post-media {
		position: relative;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--border);
		max-height: 200px;
		display: block;
		width: 100%;
		padding: 0;
		background: none;
		cursor: pointer;
	}

	.post-media img,
	.post-media video {
		width: 100%;
		height: 100%;
		max-height: 200px;
		object-fit: cover;
		display: block;
	}

	.video-badge {
		position: absolute;
		bottom: 6px;
		right: 6px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		pointer-events: none;
	}

	.post-error-note {
		color: var(--error);
		background: var(--error-soft);
		border-left: 3px solid var(--error);
		padding: 0.4rem 0.6rem;
		font-size: 0.75rem;
		border-radius: 4px;
	}

	.post-text {
		font-size: 0.82rem;
		color: var(--text);
		line-height: 1.55;
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: pre-wrap;
	}

	.post-ugc-prompt {
		background: rgba(124, 106, 237, 0.06);
		border: 1px solid rgba(124, 106, 237, 0.2);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}

	.ugc-label {
		display: block;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
		font-weight: 700;
		margin-bottom: 2px;
	}

	.ugc-text {
		font-size: 0.75rem;
		color: var(--text-dim);
		font-style: italic;
	}

	.analytics-strip {
		display: flex;
		gap: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
		flex-wrap: wrap;
	}

	.analytics-stat {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		color: var(--text-muted);
		font-weight: 500;
	}

	.analytics-stat.engagement-rate {
		margin-left: auto;
		color: var(--accent);
		font-weight: 700;
	}

	.post-card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
	}

	.btn-card-open {
		background: none;
		border: none;
		color: var(--accent);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.3rem 0;
	}

	.btn-card-open:hover {
		text-decoration: underline;
	}

	.footer-actions-right {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.btn-card-approve {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--success-soft);
		color: var(--success);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.35rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-card-approve:hover:not(:disabled) {
		background: var(--success);
		color: #fff;
	}

	.btn-card-approve:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-card-delete {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--error-soft);
		color: var(--error);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.35rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-card-delete:hover:not(:disabled) {
		background: var(--error);
		color: #fff;
	}

	.btn-card-delete.confirming {
		background: var(--error);
		color: #fff;
	}

	.btn-card-delete:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
