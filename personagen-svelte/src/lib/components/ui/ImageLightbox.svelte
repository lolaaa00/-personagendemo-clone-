<script lang="ts">
	/**
	 * One lightbox for every enlargeable image/video in the app. Before this,
	 * five pages hand-rolled their own `.lightbox-backdrop` markup with
	 * divergent behaviour (some closed on Escape, some didn't, some had no
	 * "open original" link).
	 *
	 * Pass `url` to open it; `null` closes. Video is detected from the URL
	 * unless `type` is given explicitly.
	 */
	let {
		url = null,
		label = '',
		type = null,
		poster = null,
		onClose
	}: {
		url?: string | null;
		label?: string;
		type?: 'image' | 'video' | null;
		poster?: string | null;
		onClose: () => void;
	} = $props();

	const isVideo = $derived(
		type === 'video' || (type == null && !!url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url))
	);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && url) onClose();
	}}
/>

{#if url}
	<div class="lb-backdrop" onclick={onClose} role="presentation">
		<div
			class="lb-content"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-label={label || 'Enlarged media'}
		>
			{#if isVideo}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={url} poster={poster || undefined} controls autoplay playsinline></video>
			{:else}
				<img src={url} alt={label || 'Enlarged media'} />
			{/if}
			<div class="lb-bar">
				<span>{label}</span>
				<a href={url} target="_blank" rel="noopener noreferrer">Open original ↗</a>
				<button type="button" onclick={onClose}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.lb-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(10, 14, 26, 0.88);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1200;
		padding: 1.5rem;
	}
	.lb-content {
		max-width: min(1000px, 94vw);
		max-height: 92vh;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius, 12px);
		overflow: hidden;
		background: var(--surface, #fff);
		border: 1px solid var(--border-strong, #d8dbe8);
	}
	.lb-content img,
	.lb-content video {
		max-width: 100%;
		max-height: calc(92vh - 52px);
		object-fit: contain;
		background: #0b0f1a;
	}
	.lb-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		font-size: 0.75rem;
		color: var(--text-muted, #6b7280);
	}
	.lb-bar span {
		flex: 1;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lb-bar a {
		color: var(--accent, #7c6aed);
		text-decoration: none;
		font-weight: 600;
		white-space: nowrap;
	}
	.lb-bar button {
		background: var(--surface-2, #f3f4f6);
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 6px;
		padding: 0.35rem 0.8rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text, #14172b);
		cursor: pointer;
	}
</style>
