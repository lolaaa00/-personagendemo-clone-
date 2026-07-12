<script lang="ts">
	/**
	 * The app had no shared modal — every dialog was a hand-rolled overlay with its
	 * own backdrop, escape handling and scroll behaviour (and most had none of it).
	 * This is the one place that gets focus-trap-ish behaviour, Escape-to-close and
	 * background scroll-lock right, so new dialogs don't each reinvent it.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title?: string;
		subtitle?: string;
		/** 'md' for forms, 'lg' for the composer, 'xl' for image previews. */
		size?: 'md' | 'lg' | 'xl';
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let { open, title, subtitle, size = 'md', onClose, children, footer }: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	// Lock background scroll while open, and always release it on unmount — a
	// modal that closes via navigation must not leave the page unscrollable.
	$effect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	});
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={onClose}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="modal modal-{size}"
			role="dialog"
			aria-modal="true"
			aria-label={title ?? 'Dialog'}
			onclick={(e) => e.stopPropagation()}
		>
			{#if title}
				<header class="modal-head">
					<div class="modal-titles">
						<h3>{title}</h3>
						{#if subtitle}<p class="modal-sub">{subtitle}</p>{/if}
					</div>
					<button class="modal-x" onclick={onClose} aria-label="Close">✕</button>
				</header>
			{/if}

			<div class="modal-body">
				{@render children()}
			</div>

			{#if footer}
				<footer class="modal-foot">
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 18, 32, 0.62);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		z-index: 1000;
	}
	.modal {
		background: var(--surface, #fff);
		color: var(--text, #14172b);
		border-radius: 18px;
		border: 1px solid var(--border, #e6e8f0);
		box-shadow: 0 24px 70px rgba(15, 18, 32, 0.32);
		width: 100%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.modal-md {
		max-width: 520px;
	}
	.modal-lg {
		max-width: 760px;
	}
	.modal-xl {
		max-width: 1080px;
	}
	.modal-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.25rem;
		border-bottom: 1px solid var(--border, #e6e8f0);
	}
	.modal-titles h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}
	.modal-sub {
		margin: 0.25rem 0 0;
		font-size: 0.82rem;
		color: var(--muted, #6b7280);
	}
	.modal-x {
		background: transparent;
		border: none;
		font-size: 1rem;
		cursor: pointer;
		color: var(--muted, #6b7280);
		padding: 0.25rem 0.4rem;
		border-radius: 8px;
		line-height: 1;
	}
	.modal-x:hover {
		background: var(--surface-2, #f3f4f8);
		color: var(--text, #14172b);
	}
	.modal-body {
		padding: 1.25rem;
		overflow-y: auto;
	}
	.modal-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 0.9rem 1.25rem;
		border-top: 1px solid var(--border, #e6e8f0);
		background: var(--surface-2, #fafbfd);
	}
</style>
