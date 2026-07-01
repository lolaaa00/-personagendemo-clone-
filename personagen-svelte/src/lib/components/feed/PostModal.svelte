<script lang="ts">
	import { getPostDisplay } from './postDisplay';

	let {
		post,
		onClose,
		onDelete,
		onApprove,
		approving = false
	}: {
		post: any | null;
		onClose: () => void;
		onDelete: (post: any) => void;
		onApprove: (post: any) => void;
		approving?: boolean;
	} = $props();

	let display = $derived(post ? getPostDisplay(post) : null);

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
			x: '#1da1f2',
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
		if (!post) return;
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

{#if post && display}
	<div class="modal-backdrop" onclick={onClose} role="presentation">
		<div class="post-modal-panel" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="modal-header">
				<h3>Post Details</h3>
				<button class="modal-close" onclick={onClose} aria-label="Close modal">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
				</button>
			</div>

			<div class="modal-body scrollable">
				<div class="detail-top-row">
					<span class="post-date">{formatPostDate(post)}</span>
					<span class="post-status-badge" data-status={post.status}>{post.status}</span>
				</div>

				<!-- Full-size media -->
				{#if display.mediaUrl}
					<div class="modal-media">
						{#if display.mediaType === 'video'}
							<!-- svelte-ignore a11y_media_has_caption -->
							<video src={display.mediaUrl} poster={display.posterUrl || undefined} controls playsinline></video>
						{:else}
							<img src={display.mediaUrl} alt="Post media" />
						{/if}
					</div>
				{/if}

				<!-- Full caption -->
				<p class="modal-text">{display.text}</p>

				<!-- UGC prompt / script -->
				{#if display.ugcPrompt || display.script}
					<div class="modal-ugc-block">
						{#if display.ugcPrompt}
							<div>
								<strong class="ugc-block-label accent">🎥 UGC B-Roll Prompt:</strong>
								<p class="ugc-block-text">{display.ugcPrompt}</p>
							</div>
						{/if}
						{#if display.script}
							<div>
								<strong class="ugc-block-label cyan">🎬 Script:</strong>
								<p class="ugc-block-text">{display.script}</p>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Whole-post-level error banner -->
				{#if postLevelError}
					<div class="post-level-error">
						<strong>⚠ Post-level error</strong>
						<p>{postLevelError}</p>
					</div>
				{/if}

				<!-- Per-platform breakdown -->
				{#if platformResults.length > 0}
					<div class="platform-breakdown">
						<span class="breakdown-label">Platform breakdown</span>
						<div class="breakdown-list">
							{#each platformResults as [platform, result] (platform)}
								{@const r = result as any}
								<div class="breakdown-item">
									<div class="breakdown-item-header">
										<span class="breakdown-platform" style="color: {platformColor(platform)}">{platform}</span>
										<span
											class="status-pill"
											style="color: {statusColor(r.status)}; border-color: {statusColor(r.status)};"
										>
											{r.status}
										</span>
									</div>
									{#if r.status === 'failed' && r.error}
										<p class="breakdown-error">{r.error}</p>
									{/if}
									{#if r.permalink}
										<a href={r.permalink} target="_blank" rel="noopener noreferrer" class="breakdown-link">
											View live post ↗
										</a>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<div class="modal-footer">
				<button
					type="button"
					class="btn-modal-delete"
					class:confirming={confirmingDelete}
					onclick={handleDeleteClick}
				>
					{confirmingDelete ? 'Confirm delete?' : 'Delete Post'}
				</button>
				{#if post.status === 'draft'}
					<button
						type="button"
						class="btn-modal-approve"
						disabled={approving}
						onclick={() => onApprove(post)}
					>
						{approving ? 'Approving…' : '✓ Approve & Schedule'}
					</button>
				{/if}
				<button type="button" class="btn-modal-close" onclick={onClose}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1.5rem;
	}

	.post-modal-panel {
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		width: 100%;
		max-width: 600px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow:
			0 20px 25px -5px rgba(0, 0, 0, 0.3),
			0 0 50px rgba(124, 106, 237, 0.15);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}

	.modal-header h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
		color: var(--text);
	}

	.modal-close {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: none;
		background: var(--surface-2);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			background 0.2s,
			color 0.2s,
			transform 0.2s;
	}

	.modal-close:hover {
		color: var(--text);
		background: var(--border-strong);
		transform: rotate(90deg);
	}

	.modal-body {
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.modal-body.scrollable {
		max-height: 65vh;
	}

	.modal-footer {
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.detail-top-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.post-date {
		font-size: 0.78rem;
		color: var(--text-dim);
	}

	.post-status-badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 3px 8px;
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

	.modal-media {
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--border);
		max-height: 420px;
		background: #000;
	}

	.modal-media img,
	.modal-media video {
		width: 100%;
		height: 100%;
		max-height: 420px;
		object-fit: contain;
		display: block;
	}

	.modal-text {
		font-size: 0.85rem;
		color: var(--text);
		line-height: 1.6;
		white-space: pre-wrap;
		margin: 0;
	}

	.modal-ugc-block {
		padding: 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		color: var(--text-dim);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.ugc-block-label {
		font-size: 0.75rem;
	}

	.ugc-block-label.accent {
		color: var(--accent);
	}

	.ugc-block-label.cyan {
		color: var(--cyan);
	}

	.ugc-block-text {
		margin: 0.25rem 0 0 0;
		font-size: 0.75rem;
		white-space: pre-wrap;
	}

	.post-level-error {
		background: var(--error-soft);
		border-left: 3px solid var(--error);
		border-radius: 6px;
		padding: 0.6rem 0.85rem;
		color: var(--error);
	}

	.post-level-error strong {
		font-size: 0.78rem;
		display: block;
	}

	.post-level-error p {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
	}

	.platform-breakdown {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.breakdown-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		font-weight: 700;
	}

	.breakdown-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.breakdown-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.breakdown-item-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.breakdown-platform {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: capitalize;
	}

	.status-pill {
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

	.btn-modal-delete {
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

	.btn-modal-delete:hover,
	.btn-modal-delete.confirming {
		background: var(--error);
		color: #fff;
	}

	.btn-modal-approve {
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

	.btn-modal-approve:hover:not(:disabled) {
		background: var(--success);
		color: #fff;
	}

	.btn-modal-approve:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-modal-close {
		background: var(--surface);
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
		margin-left: auto;
	}

	.btn-modal-close:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}
</style>
