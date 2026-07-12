<script lang="ts">
	/**
	 * Expandable preview for a generated asset (profile picture, reference-kit
	 * stage, post media). Shows the full-size render rather than the cropped tile,
	 * and offers Regenerate right where the user is judging the result — that's the
	 * moment they decide it's wrong, so the action belongs here.
	 *
	 * It also surfaces WHERE the file lives. Every generation is archived to our own
	 * Supabase bucket; if a URL ever isn't, that's a durability regression and the
	 * badge makes it visible instead of silent.
	 */
	import Modal from '$lib/components/ui/Modal.svelte';

	interface Props {
		open: boolean;
		url: string | null;
		title?: string;
		/** Omit to hide the regenerate action (e.g. for an uploaded reference photo). */
		onRegenerate?: (() => void) | null;
		regenerating?: boolean;
		onClose: () => void;
	}

	let { open, url, title = 'Generated asset', onRegenerate = null, regenerating = false, onClose }: Props =
		$props();

	let isVideo = $derived(!!url && /\.mp4($|\?)/i.test(url));
	let isDurable = $derived(!!url && url.includes('/storage/v1/object/public/ugc-media/'));
</script>

<Modal {open} size="xl" {title} subtitle={isDurable ? 'Archived in your storage' : undefined} {onClose}>
	{#if url}
		<div class="stage">
			{#if isVideo}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={url} controls playsinline></video>
			{:else}
				<img src={url} alt={title} />
			{/if}
		</div>

		<div class="row">
			{#if !isDurable}
				<span class="badge warn" title="This is a provider URL and can expire">
					⚠ not archived
				</span>
			{/if}
			<a class="badge link" href={url} target="_blank" rel="noopener noreferrer">Open original</a>
		</div>
	{:else}
		<p class="empty">Nothing to preview yet.</p>
	{/if}

	{#snippet footer()}
		<button class="btn-ghost" onclick={onClose}>Close</button>
		{#if onRegenerate}
			<button class="btn-primary" disabled={regenerating} onclick={onRegenerate}>
				{regenerating ? 'Regenerating…' : '↺ Regenerate'}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.stage {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-2, #f3f4f8);
		border-radius: 12px;
		border: 1px solid var(--border, #e6e8f0);
		overflow: hidden;
		max-height: 66vh;
	}
	.stage img,
	.stage video {
		max-width: 100%;
		max-height: 66vh;
		display: block;
		object-fit: contain;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}
	.badge {
		font-size: 0.74rem;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border, #e6e8f0);
		color: var(--muted, #6b7280);
		text-decoration: none;
	}
	.badge.warn {
		background: #fffbeb;
		border-color: #fde68a;
		color: #92400e;
	}
	.badge.link:hover {
		color: var(--accent, #7c6aed);
		border-color: var(--accent, #7c6aed);
	}
	.empty {
		color: var(--muted, #6b7280);
		text-align: center;
		padding: 2rem 0;
	}
	.btn-ghost,
	.btn-primary {
		border-radius: 10px;
		padding: 0.5rem 0.95rem;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.86rem;
	}
	.btn-ghost {
		background: transparent;
		border: 1px solid var(--border, #e6e8f0);
		color: var(--text, #14172b);
	}
	.btn-primary {
		background: var(--accent, #7c6aed);
		border: 1px solid var(--accent, #7c6aed);
		color: #fff;
	}
	.btn-primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
