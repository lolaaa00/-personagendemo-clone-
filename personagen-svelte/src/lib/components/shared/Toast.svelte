<script lang="ts">
  import { toasts, dismissToast } from '$lib/stores/ui.svelte';

  const iconMap: Record<string, string> = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
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
        <span class="toast-icon toast-icon-{toast.type}">{iconMap[toast.type]}</span>
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
    background: var(--success-soft, rgba(52,211,153,0.10));
    color: var(--success, #34d399);
  }

  .toast-icon-error {
    background: var(--error-soft, rgba(239,68,68,0.10));
    color: var(--error, #ef4444);
  }

  .toast-icon-info {
    background: var(--info-soft, rgba(59,130,246,0.10));
    color: var(--info, #3b82f6);
  }

  .toast-icon-warning {
    background: var(--warning-soft, rgba(245,158,11,0.10));
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
