<script lang="ts">
  import type { Agent } from '$lib/types';
  import { Accounts } from '$lib/services/api';
  import { showToast } from '$lib/stores/ui.svelte';
  import { page } from '$app/stores';

  interface PageData {
    agents: Agent[];
  }

  let { data } = $props<{ data: PageData }>();

  let selectedAgentId = $state($page.url.searchParams.get('agentId') || '');
  let statusLoading = $state(false);
  let connectingPlatform = $state('');

  const PLATFORMS = [
    { key: 'tiktok', name: 'TikTok', color: '#fe2c55' },
    { key: 'instagram', name: 'Instagram', color: '#e1306c' },
    { key: 'youtube', name: 'YouTube', color: '#ff0000' },
    { key: 'facebook', name: 'Facebook', color: '#1877f2' }
  ] as const;

  interface PlatformStatus {
    connected: boolean;
    handle?: string;
    verified?: boolean;
    lastSync?: string;
  }

  let platformStatuses = $state<Record<string, PlatformStatus>>({});

  let selectedAgent = $derived(data.agents.find((a: Agent) => a.id === selectedAgentId));

  $effect(() => {
    if (selectedAgentId) {
      checkStatuses();
    } else {
      platformStatuses = {};
    }
  });

  async function checkStatuses() {
    statusLoading = true;
    try {
      const res = await Accounts.checkStatus(selectedAgentId);
      if (res.success && res.data) {
        const statusData = res.data as Record<string, PlatformStatus>;
        platformStatuses = statusData;
      } else {
        // API not connected — set all disconnected
        platformStatuses = {};
        PLATFORMS.forEach((p) => {
          platformStatuses[p.key] = { connected: false };
        });
      }
    } catch {
      platformStatuses = {};
      PLATFORMS.forEach((p) => {
        platformStatuses[p.key] = { connected: false };
      });
    }
    statusLoading = false;
  }

  async function connectPlatform(platform: string) {
    if (!selectedAgentId) return;
    connectingPlatform = platform;
    try {
      const res = await Accounts.initConnection(selectedAgentId, platform);
      if (res.success) {
        showToast(`Connection initiated for ${platform}`, 'success');
        const redirectUrl = (res.data as any)?.redirect_url;
        if (redirectUrl) {
          showToast(`Opening authentication for ${platform}...`, 'info');
          window.open(redirectUrl, '_blank');
        }
        await checkStatuses();
      } else {
        showToast(res.error || `Failed to connect ${platform}`, 'error');
      }
    } catch {
      showToast(`Unable to reach API — ${platform} connection unavailable`, 'warning');
    }
    connectingPlatform = '';
  }

  async function disconnectPlatform(platform: string) {
    if (!selectedAgentId) return;
    try {
      const res = await Accounts.disconnect(selectedAgentId, platform);
      if (res.success) {
        showToast(`Disconnected ${platform}`, 'info');
        platformStatuses[platform] = { connected: false };
      } else {
        showToast(res.error || `Failed to disconnect ${platform}`, 'error');
      }
    } catch {
      showToast('Unable to reach API', 'warning');
    }
  }

  function formatSyncTime(iso?: string): string {
    if (!iso) return 'Never';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  }
</script>

<svelte:head>
  <title>Connected Accounts — PersonaGen</title>
</svelte:head>

<section class="page">
  <header class="page-header">
    <div class="header-top">
      <div>
        <h1>Connected Accounts</h1>
        <p class="subtitle">Manage social platform connections for each agent</p>
      </div>
      <div class="agent-selector">
        <label for="agent-select">Agent</label>
        <select id="agent-select" bind:value={selectedAgentId}>
          <option value="">Select an agent…</option>
          {#each data.agents as agent}
            <option value={agent.id}>{agent.name} — {agent.niche}</option>
          {/each}
        </select>
      </div>
    </div>
  </header>

  {#if !selectedAgentId}
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </div>
      <h3>Select an Agent</h3>
      <p>Choose an agent above to manage their social platform connections</p>
    </div>

  {:else}
    {#if statusLoading}
      <div class="loading-bar">
        <div class="loading-bar-inner"></div>
      </div>
    {/if}

    <div class="agent-info-banner">
      <div class="agent-avatar" style="background: {selectedAgent?.gradient}">
        {selectedAgent?.initial}
      </div>
      <div class="agent-meta">
        <h3>{selectedAgent?.name}</h3>
        <span class="agent-handle">{selectedAgent?.handle}</span>
      </div>
      <span class="agent-status" class:active={selectedAgent?.status === 'active'}>
        {selectedAgent?.status === 'active' ? 'Active' : 'Inactive'}
      </span>
    </div>

    <div class="platforms-grid">
      {#each PLATFORMS as platform}
        {@const status = platformStatuses[platform.key]}
        <div class="platform-card" class:connected={status?.connected} style="--platform-color: {platform.color}">
          <div class="platform-header">
            <div class="platform-icon">
              {#if platform.key === 'tiktok'}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.89a8.1 8.1 0 004.77 1.54V7.01a4.85 4.85 0 01-1-.32z" fill="{platform.color}"/></svg>
              {:else if platform.key === 'instagram'}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke="{platform.color}" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="{platform.color}" stroke-width="1.8"/><circle cx="17.5" cy="6.5" r="1.5" fill="{platform.color}"/></svg>
              {:else if platform.key === 'youtube'}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29.94 29.94 0 001 12a29.94 29.94 0 00.46 5.58 2.78 2.78 0 001.94 2c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29.94 29.94 0 0023 12a29.94 29.94 0 00-.46-5.58z" fill="{platform.color}"/><path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="#fff"/></svg>
              {:else if platform.key === 'facebook'}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.875V12h3.328l-.532 3.47h-2.796v8.384C19.612 22.954 24 17.99 24 12z" fill="{platform.color}"/></svg>
              {/if}
            </div>
            <div class="platform-name-wrap">
              <span class="platform-name">{platform.name}</span>
              <span class="status-dot" class:on={status?.connected}></span>
            </div>
          </div>

          <div class="platform-body">
            {#if status?.connected}
              <div class="connected-info">
                <div class="handle-row">
                  <span class="handle">{status.handle || '@connected'}</span>
                  {#if status.verified}
                    <svg class="verified-badge" width="16" height="16" viewBox="0 0 24 24" fill="var(--cyan)"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 12c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="var(--cyan)" stroke-width="1.5" fill="none"/><path d="M9 12l2 2 4-4" stroke="var(--cyan)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  {/if}
                </div>
                <span class="sync-time">Last sync: {formatSyncTime(status.lastSync)}</span>
              </div>
              <button class="btn-disconnect" onclick={() => disconnectPlatform(platform.key)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                Disconnect
              </button>
            {:else}
              <p class="disconnected-msg">Not connected</p>
              <button
                class="btn-connect"
                disabled={connectingPlatform === platform.key}
                onclick={() => connectPlatform(platform.key)}
              >
                {#if connectingPlatform === platform.key}
                  <span class="spinner"></span>
                  Connecting…
                {:else}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  Connect
                {/if}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .page {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .page-header {
    margin-bottom: 2rem;
  }

  .header-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2rem;
    flex-wrap: wrap;
  }

  .page-header h1 {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--text);
    margin: 0 0 0.35rem;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: var(--text-base);
    margin: 0;
  }

  .agent-selector {
    min-width: 280px;
  }

  .agent-selector label {
    margin-bottom: 0.35rem;
  }

  .agent-selector select {
    width: 100%;
  }

  /* ── Agent info banner ── */
  .agent-info-banner {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem 1.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 2rem;
  }

  .agent-avatar {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: var(--weight-bold);
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: #fff;
    flex-shrink: 0;
  }

  .agent-meta h3 {
    font-size: var(--text-md);
    margin: 0;
    font-family: var(--font-body);
    font-weight: var(--weight-semi);
  }

  .agent-handle {
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .agent-status {
    margin-left: auto;
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--text-dim);
    padding: 0.3rem 0.75rem;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .agent-status.active {
    color: var(--success);
    background: var(--success-soft);
    border-color: rgba(52,211,153,0.2);
  }

  /* ── Loading bar ── */
  .loading-bar {
    width: 100%;
    height: 3px;
    background: var(--surface-2);
    border-radius: 2px;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  .loading-bar-inner {
    width: 40%;
    height: 100%;
    background: var(--gradient);
    border-radius: 2px;
    animation: loading-slide 1.2s ease-in-out infinite;
  }

  @keyframes loading-slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  /* ── Platform grid ── */
  .platforms-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--gap-lg);
  }

  .platform-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.2s ease;
    position: relative;
    overflow: hidden;
  }

  .platform-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--platform-color);
    opacity: 0.5;
    transition: opacity 0.25s ease;
  }

  .platform-card:hover {
    border-color: var(--border-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .platform-card:hover::before {
    opacity: 1;
  }

  .platform-card.connected::before {
    opacity: 1;
  }

  .platform-header {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .platform-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .platform-icon :global(svg) {
    display: block;
  }

  .platform-name-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .platform-name {
    font-weight: var(--weight-semi);
    font-size: var(--text-md);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
    transition: background 0.2s ease;
  }

  .status-dot.on {
    background: var(--success);
    box-shadow: 0 0 8px rgba(52,211,153,0.5);
  }

  /* ── Platform body ── */
  .platform-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    flex: 1;
    justify-content: flex-end;
  }

  .connected-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .handle-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .handle {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .verified-badge {
    flex-shrink: 0;
    display: inline-block;
  }

  .sync-time {
    font-size: var(--text-xs);
    color: var(--text-dim);
  }

  .disconnected-msg {
    font-size: var(--text-sm);
    color: var(--text-dim);
    margin: 0;
  }

  /* ── Buttons ── */
  .btn-connect {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.6rem 1.2rem;
    border-radius: var(--radius-sm);
    background: var(--warning-soft);
    border: 1px solid rgba(245,158,11,0.25);
    color: var(--warning);
    font-weight: var(--weight-semi);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
    font-family: var(--font-body);
  }

  .btn-connect:hover:not(:disabled) {
    background: rgba(245,158,11,0.2);
    transform: translateY(-1px);
  }

  .btn-connect:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .btn-disconnect {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    background: var(--error-soft);
    border: 1px solid rgba(239,68,68,0.2);
    color: var(--error);
    font-weight: var(--weight-semi);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: background 0.2s ease;
    font-family: var(--font-body);
  }

  .btn-disconnect:hover {
    background: rgba(239,68,68,0.2);
  }

  /* ── Spinner ── */
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(245,158,11,0.25);
    border-top-color: var(--warning);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 5rem 2rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-align: center;
  }

  .empty-state.pending {
    border-color: rgba(245,158,11,0.2);
  }

  .empty-icon {
    margin-bottom: 1.25rem;
    opacity: 0.6;
  }

  .empty-state h3 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    margin: 0 0 0.5rem;
  }

  .empty-state p {
    color: var(--text-muted);
    font-size: var(--text-base);
    margin: 0;
    max-width: 420px;
    line-height: var(--leading-relaxed);
  }

  .empty-state a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* ── Responsive ── */
  @media (max-width: 900px) {
    .platforms-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 600px) {
    .page {
      padding: 1.25rem;
    }

    .header-top {
      flex-direction: column;
      gap: 1rem;
    }

    .agent-selector {
      min-width: 0;
      width: 100%;
    }

    .platforms-grid {
      grid-template-columns: 1fr;
    }

    .agent-info-banner {
      flex-wrap: wrap;
    }

    .agent-status {
      margin-left: 0;
    }
  }
</style>
