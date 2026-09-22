<!--
  Stale notices — the persona page's "what you're looking at isn't current" strip.

  `stale-state.ts` decides WHAT is stale; this file decides only how it looks. It
  is deliberately NOT a `<details>`: a warning behind a closed disclosure is a
  warning nobody reads, so these sit open at the top of the page, above every
  section, and are the first thing on the page after the identity header.

  It renders nothing — no container, no heading, no spacer — for an empty array.
  A persona nobody has touched produces no warnings, and must therefore see the
  page exactly as it did before this strip existed.

  Two severities, both drawn from the app's existing tokens rather than a new
  palette: 'warn' (something failed, and someone has to act) borrows the
  --warning tint; 'info' (nothing broke, what you see is simply old) stays on
  the neutral surface so it cannot shout down the warning beside it.
-->
<script lang="ts">
	import type { StaleWarning } from './stale-state';

	let {
		warnings,
		onAction = null,
		busy = false
	}: {
		warnings: StaleWarning[];
		/**
		 * Runs a warning's fix. Without it the button is not rendered at all —
		 * a control that does nothing would be the defect this exists to close.
		 */
		onAction?: ((warning: StaleWarning) => void) | null;
		/** True while any generation the page runs is in flight. */
		busy?: boolean;
	} = $props();
</script>

{#if warnings.length}
	<div class="stale-notices" role="status" aria-live="polite">
		{#each warnings as warning (warning.key)}
			<div class="stale-notice" class:warn={warning.severity === 'warn'}>
				<span class="stale-icon" aria-hidden="true">
					{#if warning.severity === 'warn'}
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path
								d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
							/>
							<path d="M12 9v4" />
							<path d="M12 17h.01" />
						</svg>
					{:else}
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 11v5" />
							<path d="M12 8h.01" />
						</svg>
					{/if}
				</span>
				<div class="stale-body">
					<p class="stale-title">{warning.title}</p>
					<p class="stale-detail" id="stale-detail-{warning.key}">{warning.detail}</p>
					{#if warning.action && onAction}
						<!-- UX-007: the notice told the user to retry and offered no
						     retry. The fix runs the page's own confirm-first flow, so a
						     paid retry is approved exactly like the first attempt. -->
						<button
							type="button"
							class="stale-action"
							disabled={busy}
							aria-describedby="stale-detail-{warning.key}"
							onclick={() => onAction?.(warning)}
						>
							{busy ? 'Working…' : warning.action.label}
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.stale-notices {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0 0 1.25rem;
	}

	.stale-notice {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 14px);
		background: var(--surface-2);
		/* The severity stripe: the same left-border language the app already uses
		   for success/error/warning rows, so this reads as one more of those. */
		border-left: 3px solid var(--border-strong, var(--border));
		min-width: 0;
	}

	.stale-action {
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		margin-top: 0.55rem;
		padding: 0 0.9rem;
		border: 1px solid var(--border-strong, var(--border));
		border-radius: var(--radius-full, 999px);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
	}
	.stale-action:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.stale-action:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}
	.stale-action:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.stale-notice.warn {
		background: var(--warning-soft, var(--surface-2));
		border-color: color-mix(in srgb, var(--warning) 24%, transparent);
		border-left-color: var(--warning);
	}

	.stale-icon {
		display: flex;
		flex-shrink: 0;
		margin-top: 0.05rem;
		color: var(--text-dim);
	}

	.stale-notice.warn .stale-icon {
		color: var(--warning-text, var(--warning));
	}

	.stale-body {
		min-width: 0;
	}

	.stale-title {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text);
		/* Long titles wrap rather than widening the strip past its column. */
		overflow-wrap: anywhere;
	}

	.stale-notice.warn .stale-title {
		color: var(--warning-text, var(--text));
	}

	.stale-detail {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--text-muted);
		max-width: 80ch;
		overflow-wrap: anywhere;
	}
</style>
