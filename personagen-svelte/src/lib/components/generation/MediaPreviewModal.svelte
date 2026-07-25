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
				<!--
					No caption track exists for this asset. The clip is a freshly rendered
					generation straight from the provider — there is no transcript, no
					sidecar VTT, and nothing to point a <track> at. Shipping an empty
					<track kind="captions"> would announce captions to assistive tech and
					then deliver none, which is worse than the honest absence. Burned-in
					captions (the composer's "Burn on-screen captions" opt-in) are the
					only caption channel this pipeline has today.
				-->
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={url} controls playsinline></video>
			{:else}
				<!--
					width/height are a pre-load ratio placeholder only: generated assets
					vary (4:5, 9:16, 1:1) and the real intrinsic size wins once decoded,
					because .stage img forces width/height back to auto.
				-->
				<img src={url} alt={title} width="1080" height="1350" />
			{/if}
		</div>

		<div class="row">
			{#if !isDurable}
				<span class="badge warn" title="This is a provider URL and can expire">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
					not archived
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
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
				{regenerating ? 'Regenerating…' : 'Regenerate'}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.stage {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-2);
		border-radius: 12px;
		border: 1px solid var(--border);
		overflow: hidden;
		max-height: 66dvh;
	}
	.stage img,
	.stage video {
		max-width: 100%;
		max-height: 66dvh;
		/* Beat the width/height attributes' presentational hint so the asset's real
		   intrinsic ratio drives layout once it decodes. The attributes stay purely
		   as a pre-load placeholder ratio. */
		width: auto;
		height: auto;
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
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.74rem;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--muted);
		text-decoration: none;
	}
	.badge.warn {
		background: var(--warning-soft);
		border-color: color-mix(in srgb, var(--warning) 40%, transparent);
		color: var(--warning-text);
	}
	/* Keep the pill visually small but give the link a real 44×44 tap area. */
	.badge.link {
		position: relative;
	}
	.badge.link::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		min-width: 44px;
		height: 44px;
	}
	.badge.link:hover {
		color: var(--accent-text);
		border-color: var(--accent);
	}
	.empty {
		color: var(--muted);
		text-align: center;
		padding: 2rem 0;
	}
	.btn-ghost,
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 44px;
		min-width: 44px;
		border-radius: 10px;
		padding: 0.5rem 0.95rem;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.86rem;
	}
	.btn-ghost {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
	}
	.btn-primary {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: #fff;
	}
	.btn-primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
