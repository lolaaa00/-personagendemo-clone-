<script lang="ts">
	import { dialog } from '$lib/actions/dialog';
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

	// Element ref used purely for focus management (a11y).
	let contentEl = $state<HTMLDivElement | null>(null);

	const FOCUSABLE =
		'a[href], button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

	function onKeydown(e: KeyboardEvent) {
		if (!url) return;
		if (e.key === 'Escape') {
			onClose();
			return;
		}
		const root = contentEl;
		if (e.key !== 'Tab' || !root) return;
		// A full-screen viewer must not leak focus to the page behind it.
		const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			(el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
		);
		if (items.length === 0) {
			e.preventDefault();
			root.focus();
			return;
		}
		const active = document.activeElement as HTMLElement | null;
		const idx = active ? items.indexOf(active) : -1;
		if (e.shiftKey) {
			if (idx <= 0) {
				e.preventDefault();
				items[items.length - 1].focus();
			}
		} else if (idx === -1 || idx === items.length - 1) {
			e.preventDefault();
			items[0].focus();
		}
	}

	// Focus in on open, hand focus back to the thumbnail that opened it on close.
	$effect(() => {
		if (!url || !contentEl) return;
		const el = contentEl;
		const returnTo = document.activeElement as HTMLElement | null;
		el.focus({ preventScroll: true });
		return () => {
			if (returnTo && typeof returnTo.focus === 'function' && returnTo.isConnected) {
				returnTo.focus({ preventScroll: true });
			}
		};
	});
</script>

<svelte:window onkeydown={url ? onKeydown : undefined} />

{#if url}
	<div class="lb-backdrop" onclick={onClose} role="presentation">
		<div
			class="lb-content"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-label={label || 'Enlarged media'}
			tabindex="-1"
			bind:this={contentEl}
			use:dialog={{ onClose }}
		>
			{#if isVideo}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={url} poster={poster || undefined} controls autoplay playsinline></video>
			{:else}
				<img src={url} alt={label || 'Enlarged media'} />
			{/if}
			<div class="lb-bar">
				<span>{label}</span>
				<a href={url} target="_blank" rel="noopener noreferrer">
					Open original
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M7 17 17 7M9 7h8v8" />
					</svg>
				</a>
				<button type="button" onclick={onClose} aria-label="Close enlarged media">Close</button>
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
		z-index: var(--z-lightbox);
		padding: 1.5rem;
	}
	.lb-content {
		max-width: min(1000px, 94vw);
		max-height: 92dvh;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius, 12px);
		overflow: hidden;
		background: var(--surface, #fff);
		border: 1px solid var(--border-strong, #d8dbe8);
	}
	.lb-content:focus {
		outline: none;
	}
	.lb-content:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.lb-content img,
	.lb-content video {
		max-width: 100%;
		/* 64px = the bar's 44px min touch target plus its 0.6rem vertical padding. */
		max-height: calc(92dvh - 64px);
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
	/* Both bar controls keep their compact look but carry a 44px-tall hit area. */
	.lb-bar a {
		color: var(--accent-text, #6338d4);
		text-decoration: none;
		font-weight: 600;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 44px;
		padding: 0 0.25rem;
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
		min-height: 44px;
		min-width: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.lb-bar a:focus-visible,
	.lb-bar button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
