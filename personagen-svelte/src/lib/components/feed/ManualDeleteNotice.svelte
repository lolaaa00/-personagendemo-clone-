<script lang="ts">
	import { platformColor, platformLabel } from '$lib/platforms';

	let {
		entries,
		onClose
	}: {
		entries: Array<{ platform: string; permalink: string | null }>;
		onClose: () => void;
	} = $props();
</script>

<div class="modal-backdrop z-top" onclick={onClose} role="presentation">
	<div class="notice-modal" onclick={(e) => e.stopPropagation()} role="dialog">
		<div class="modal-header">
			<h3>Removed locally — {entries.length} step{entries.length !== 1 ? 's' : ''} left</h3>
			<button class="modal-close" onclick={onClose} aria-label="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
			</button>
		</div>
		<div class="modal-body">
			<p class="notice-desc">
				The post was deleted from your dashboard. These platforms don't allow deletion through
				their API, so the live post must be removed by hand:
			</p>
			<div class="notice-list">
				{#each entries as entry}
					<div class="notice-item">
						<div class="notice-item-header">
							<span
								class="platform-badge"
								style="background: {platformColor(entry.platform)}20; color: {platformColor(entry.platform)}; border: 1px solid {platformColor(entry.platform)}40;"
							>
								{platformLabel(entry.platform)}
							</span>
							{#if entry.platform === 'instagram'}
								<span class="notice-hint">Open the post, tap ⋯ → Delete</span>
							{/if}
						</div>
						{#if entry.permalink}
							<a
								href={entry.permalink}
								target="_blank"
								rel="noopener noreferrer"
								class="notice-link"
								style="color: {platformColor(entry.platform)};"
							>
								Open {platformLabel(entry.platform)} post to delete ↗
							</a>
						{:else}
							<span class="notice-hint">
								No direct link available — open {platformLabel(entry.platform)} and remove it manually.
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
		<div class="modal-footer">
			<button class="btn-notice-dismiss" onclick={onClose}>Got it</button>
		</div>
	</div>
</div>

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

	.modal-backdrop.z-top {
		z-index: 1100;
	}

	.notice-modal {
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		width: 100%;
		max-width: 460px;
		max-height: 80vh;
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
		padding: 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		overflow-y: auto;
	}

	.notice-desc {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-dim);
		line-height: 1.6;
	}

	.notice-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.notice-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.85rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.notice-item-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.platform-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: capitalize;
		padding: 4px 10px;
		border-radius: 6px;
	}

	.notice-hint {
		font-size: 0.68rem;
		color: var(--text-dim);
	}

	.notice-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		font-weight: 700;
		text-decoration: none;
	}

	.notice-link:hover {
		text-decoration: underline;
	}

	.modal-footer {
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		display: flex;
		justify-content: flex-end;
	}

	.btn-notice-dismiss {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--gradient);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 1.1rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
</style>
