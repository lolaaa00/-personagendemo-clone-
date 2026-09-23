<script lang="ts">
	/**
	 * The app had no shared modal — every dialog was a hand-rolled overlay with its
	 * own backdrop, escape handling and scroll behaviour (and most had none of it).
	 * This is the one place that gets the focus trap, Escape-to-close and
	 * background scroll-lock right, so new dialogs don't each reinvent it.
	 */
	import type { Snippet } from 'svelte';
	import { dialog } from '$lib/actions/dialog';

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

	// Focus trap, initial focus, focus restore, Escape and scroll lock all live in
	// the shared `use:dialog` action so this component and the ~17 hand-rolled
	// dialogs elsewhere in the app share one implementation.
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={onClose}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="modal modal-{size}"
			role="dialog"
			aria-modal="true"
			aria-label={title ?? 'Dialog'}
			tabindex="-1"
			use:dialog={{ onClose }}
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
	/* The head and foot are the title/close and the action buttons: they must
	   never scroll away, so they are the two non-shrinking rows and the body is
	   the only scroll container. `min-height: 0` keeps that true once the
	   content is taller than the dialog — a column flex item otherwise refuses
	   to shrink past its content and pushes the footer out of the box. */
	.modal-head,
	.modal-foot {
		flex-shrink: 0;
	}
	.modal-body {
		padding: 1.25rem;
		overflow-y: auto;
		min-height: 0;
		/* Hitting the end of a long composer step shouldn't start scrolling the
		   page behind the dialog on touch. */
		overscroll-behavior: contain;
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

	/* ── Phone: bottom sheet ────────────────────────────────────────────────
	   This component is the container for the four-step composer, the campaign
	   planner and every confirmation in the product. Centred at 90dvh with a
	   1.25rem gutter, a phone spends its scarcest resource — vertical space —
	   on backdrop ABOVE and BELOW the dialog, while the step nav and the pinned
	   footer fight over what is left. Anchoring to the bottom edge spends none
	   of it: the sheet meets the thumb, grows to nearly the full viewport, and
	   the leftover space collapses into one strip at the top that still reads
	   as "there is a page behind this".
	   480px is one of the three breakpoints this codebase is normalising to
	   (480 / 768 / 1120) — don't introduce a fourth value here. */
	@media (max-width: 480px) {
		.modal-backdrop {
			padding: 0;
			align-items: flex-end;
		}
		.modal,
		.modal-md,
		.modal-lg,
		.modal-xl {
			/* Full-bleed: the size classes only decide the desktop width. */
			max-width: none;
			max-height: 94dvh;
			border-radius: 18px 18px 0 0;
			border-bottom: none;
			animation: modal-sheet-rise 0.18s cubic-bezier(0.16, 1, 0.3, 1);
		}
		.modal-head {
			padding: 1rem 1rem 0.9rem;
		}
		.modal-body {
			padding: 1rem;
		}
		/* Only when there is no footer — with one, the footer already owns the
		   inset and this would add dead space to the end of the scroll. */
		.modal-body:last-child {
			padding-bottom: calc(1rem + env(safe-area-inset-bottom));
		}
		/* Keeps the actions clear of the home indicator. */
		.modal-foot {
			padding: 0.9rem 1rem calc(0.9rem + env(safe-area-inset-bottom));
		}
	}

	@keyframes modal-sheet-rise {
		from {
			transform: translateY(12px);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.modal {
			animation: none;
		}
	}
	/* 320–390: the running price and two buttons did not fit one row —
	   "Approve & generate" overprinted "Back" (round-7 re-audit). */
	@media (max-width: 480px) {
		.modal-foot {
			flex-wrap: wrap;
			gap: 0.5rem;
		}
		.modal-foot > * {
			min-width: 0;
		}
	}
</style>
