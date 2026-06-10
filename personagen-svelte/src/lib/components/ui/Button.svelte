<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    onclick?: (e: MouseEvent) => void;
    class?: string;
    children?: Snippet;
  }

  let { 
    variant = 'primary', 
    type = 'button', 
    disabled = false, 
    loading = false,
    onclick, 
    class: className = '',
    children 
  }: Props = $props();
</script>

<button 
  {type} 
  disabled={disabled || loading} 
  {onclick} 
  class="btn btn-{variant} {className}"
>
  {#if loading}
    <span class="btn-spinner"></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>

<style>
  .btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    display: inline-block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
