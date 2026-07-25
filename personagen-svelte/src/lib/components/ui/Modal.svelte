<script lang="ts">
	/**
	 * The app had no shared modal — every dialog was a hand-rolled overlay with its
	 * own backdrop, escape handling and scroll behaviour (and most had none of it).
	 * This is the one place that gets the focus trap, Escape-to-close and
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

	// Element refs used purely for focus management (a11y) — no behaviour beyond that.
	let dialogEl = $state<HTMLDivElement | null>(null);

	const FOCUSABLE =
		'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

	function focusables(): HTMLElement[] {
		const root = dialogEl;
		if (!root) return [];
		return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			(el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
		);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
			return;
		}
		const root = dialogEl;
		if (e.key !== 'Tab' || !root) return;
		// Trap Tab / Shift+Tab inside the dialog.
		const items = focusables();
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

	// Move focus into the dialog on open and hand it back to whatever opened it on
	// close, so keyboard users aren't dumped at the top of the document.
	$effect(() => {
		if (!open || !dialogEl) return;
		const el = dialogEl;
		const returnTo = document.activeElement as HTMLElement | null;
		el.focus({ preventScroll: true });
		return () => {
			if (returnTo && typeof returnTo.focus === 'function' && returnTo.isConnected) {
				returnTo.focus({ preventScroll: true });
			}
		};
	});

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
			tabindex="-1"
			bind:this={dialogEl}
			onclick={(e) => e.stopPropagation()}
		>
			{#if title}
				<header class="modal-head">
					<div class="modal-titles">
						<h3>{title}</h3>
						{#if subtitle}<p class="modal-sub">{subtitle}</p>{/if}
					</div>
					<button class="modal-x" type="button" onclick={onClose} aria-label="Close">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M18 6 6 18M6 6l12 12" />
						</svg>
					</button>
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
		z-index: var(--z-modal);
	}
	.modal {
		background: var(--surface);
		color: var(--text);
		border-radius: 18px;
		border: 1px solid var(--border);
		box-shadow: 0 24px 70px rgba(15, 18, 32, 0.32);
		width: 100%;
		max-height: 90dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.modal:focus {
		outline: none;
	}
	.modal:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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
		border-bottom: 1px solid var(--border);
	}
	.modal-titles h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}
	.modal-sub {
		margin: 0.25rem 0 0;
		font-size: 0.82rem;
		color: var(--muted);
	}
	/* Glyph stays 16px; the hit area is expanded to the 44x44 minimum around it. */
	.modal-x {
		background: transparent;
		border: none;
		font-size: 1rem;
		cursor: pointer;
		color: var(--muted);
		padding: 0;
		min-width: 44px;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin: -0.35rem -0.5rem -0.35rem 0;
		border-radius: 8px;
		line-height: 1;
	}
	.modal-x:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.modal-x:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}
</style>
