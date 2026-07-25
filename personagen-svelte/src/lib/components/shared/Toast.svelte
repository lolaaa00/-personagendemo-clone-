<script lang="ts">
	import { toasts, dismissToast } from '$lib/stores/ui.svelte';

	/** Lucide-style path data, one `d` per status — rendered as an inline SVG below. */
	const iconMap: Record<string, string> = {
		success: 'M20 6 9 17l-5-5',
		error: 'M18 6 6 18M6 6l12 12',
		info: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20M12 16v-4M12 8h.01',
		warning:
			'm10.29 3.86-8.47 14.14A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0M12 9v4M12 17h.01'
	};
</script>

{#if toasts.length > 0}
	<div class="toast-container" aria-live="polite" aria-atomic="false">
		{#each toasts as toast (toast.id)}
			<button
				class="toast-item toast-{toast.type}"
				onclick={() => dismissToast(toast.id)}
				aria-label="Dismiss notification"
			>
				<span class="toast-icon toast-icon-{toast.type}">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d={iconMap[toast.type]} />
					</svg>
				</span>
				<span class="toast-message">{toast.message}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		top: var(--space-4, 1rem);
		right: var(--space-4, 1rem);
		z-index: var(--z-toast, 300);
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 0.75rem);
		pointer-events: none;
	}

	.toast-item {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--space-3, 0.75rem);
		padding: var(--space-3, 0.75rem) var(--space-5, 1.25rem);
		border-radius: var(--radius-sm, 10px);
		background: var(--surface-2);
		border: 1px solid var(--border);
		backdrop-filter: blur(16px) saturate(180%);
		-webkit-backdrop-filter: blur(16px) saturate(180%);
		box-shadow: var(--shadow-lg);
		font-size: var(--text-base, 0.875rem);
		font-weight: 500;
		color: var(--text);
		min-width: 280px;
		max-width: 420px;
		cursor: pointer;
		animation: toast-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
		text-align: left;
	}

	/* On a phone the right-anchored 420px max-width overflowed the left edge and
	   clipped the message. Span the width instead and let the toast shrink to fit. */
	@media (max-width: 480px) {
		.toast-container {
			left: var(--space-4, 1rem);
			right: var(--space-4, 1rem);
		}
		.toast-item {
			min-width: 0;
			max-width: 100%;
		}
	}

	.toast-success {
		border-left: 3px solid var(--success, #34d399);
	}

	.toast-error {
		border-left: 3px solid var(--error, #ef4444);
	}

	.toast-info {
		border-left: 3px solid var(--info, #3b82f6);
	}

	.toast-warning {
		border-left: 3px solid var(--warning, #f59e0b);
	}

	.toast-icon {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.toast-icon-success {
		background: var(--success-soft, rgba(52, 211, 153, 0.1));
		color: var(--success, #34d399);
	}

	.toast-icon-error {
		background: var(--error-soft, rgba(239, 68, 68, 0.1));
		color: var(--error, #ef4444);
	}

	.toast-icon-info {
		background: var(--info-soft, rgba(59, 130, 246, 0.1));
		color: var(--info, #3b82f6);
	}

	.toast-icon-warning {
		background: var(--warning-soft, rgba(245, 158, 11, 0.1));
		color: var(--warning, #f59e0b);
	}

	.toast-message {
		flex: 1;
		line-height: 1.4;
	}

	@keyframes toast-slide-in {
		from {
			opacity: 0;
			transform: translateX(100%) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateX(0) scale(1);
		}
	}
</style>
