<script lang="ts">
  import { page } from '$app/stores';
  import { showToast } from '$lib/stores/ui.svelte';
  import type { AutonomyLevel } from '$lib/types';
  import { AUTONOMY_LABELS } from '$lib/types';
  import { Accounts } from '$lib/services/api';

  let { data }: { data: any } = $props();
  const agents: any[] = data.agents ?? [];

  let selectedAgentId = $state<string | null>(null);
  let activeTab = $state<'accounts' | 'soul' | 'skills' | 'tools' | 'heartbeat' | 'autonomy' | 'rss'>('accounts');

  $effect(() => {
    const paramAgentId = $page.params.agentId || $page.url.searchParams.get('agentId');
    if (paramAgentId) {
      const agentExists = agents.some((a) => a.id === paramAgentId);
      if (agentExists && selectedAgentId !== paramAgentId) {
        selectAgent(paramAgentId);
      }
    }
  });

  // Config state
  let soulText = $state('');
  let skillsText = $state('');
  let toolsText = $state('');
  let timezone = $state('Australia/Sydney');
  let postsPerDay = $state(3);
  let activeHoursStart = $state(8);
  let activeHoursEnd = $state(22);
  let autonomyLevel = $state<AutonomyLevel>('advisor');
  let rssUrl = $state('');
  let rssActive = $state(false);
  let rssLastPolledAt = $state<string | null>(null);
  let saving = $state(false);

  const timezones = [
    { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEST)' },
    { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
    { value: 'Australia/Perth', label: 'Perth (AWST)' },
    { value: 'Australia/Adelaide', label: 'Adelaide (ACST)' },
    { value: 'Australia/Hobart', label: 'Hobart (AEST)' },
    { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
    { value: 'Australia/Canberra', label: 'Canberra (AEST)' }
  ];

  const tabs = [
    { id: 'accounts' as const, label: 'Connected Accounts', icon: '🔗' },
    { id: 'soul' as const, label: 'Soul', icon: '✦' },
    { id: 'skills' as const, label: 'Skills', icon: '⚙' },
    { id: 'tools' as const, label: 'Tools', icon: '🔧' },
    { id: 'heartbeat' as const, label: 'Heartbeat', icon: '💓' },
    { id: 'autonomy' as const, label: 'Autonomy', icon: '🤖' },
    { id: 'rss' as const, label: 'RSS Feed', icon: '📰' }
  ];

  const autonomyKeys: AutonomyLevel[] = ['advisor', 'semi_autonomous', 'fully_autonomous'];

  let selectedAgent = $derived(agents.find((a: any) => a.id === selectedAgentId));

  function storageKey(agentId: string) {
    return `personagen_agent_config_${agentId}`;
  }

  function loadConfig(agentId: string) {
    const agent = agents.find((a: any) => a.id === agentId);
    if (!agent) return;

    // First try database values loaded in server data
    if (agent.timezone !== undefined) {
      soulText = agent.soul ?? '';
      skillsText = agent.skills ?? '';
      toolsText = agent.tools ?? '';
      timezone = agent.timezone ?? 'Australia/Sydney';
      postsPerDay = agent.posts_per_day ?? 3;
      activeHoursStart = agent.active_hours_start ?? 8;
      activeHoursEnd = agent.active_hours_end ?? 22;
      autonomyLevel = agent.autonomy_level ?? 'advisor';
      rssUrl = agent.rss_url ?? '';
      rssActive = agent.rss_active ?? false;
      rssLastPolledAt = agent.rss_last_polled_at ?? null;
      
      // Sync local storage cache
      localStorage.setItem(storageKey(agentId), JSON.stringify({
        soul: soulText,
        skills: skillsText,
        tools: toolsText,
        timezone,
        postsPerDay,
        activeHoursStart,
        activeHoursEnd,
        autonomyLevel,
        rssUrl,
        rssActive,
        rssLastPolledAt
      }));
      return;
    }

    // Otherwise fallback to localStorage
    const stored = localStorage.getItem(storageKey(agentId));
    if (stored) {
      try {
        const cfg = JSON.parse(stored);
        soulText = cfg.soul ?? agent.soul ?? '';
        skillsText = cfg.skills ?? agent.skills ?? '';
        toolsText = cfg.tools ?? agent.tools ?? '';
        timezone = cfg.timezone ?? 'Australia/Sydney';
        postsPerDay = cfg.postsPerDay ?? 3;
        activeHoursStart = cfg.activeHoursStart ?? 8;
        activeHoursEnd = cfg.activeHoursEnd ?? 22;
        autonomyLevel = cfg.autonomyLevel ?? 'advisor';
        rssUrl = cfg.rssUrl ?? agent.rss_url ?? '';
        rssActive = cfg.rssActive ?? agent.rss_active ?? false;
        rssLastPolledAt = cfg.rssLastPolledAt ?? agent.rss_last_polled_at ?? null;
        return;
      } catch { /* fall through */ }
    }

    soulText = agent.soul ?? '';
    skillsText = agent.skills ?? '';
    toolsText = agent.tools ?? '';
    timezone = 'Australia/Sydney';
    postsPerDay = 3;
    activeHoursStart = 8;
    activeHoursEnd = 22;
    autonomyLevel = 'advisor';
    rssUrl = agent.rss_url ?? '';
    rssActive = agent.rss_active ?? false;
    rssLastPolledAt = agent.rss_last_polled_at ?? null;
  }

  function selectAgent(id: string) {
    selectedAgentId = id;
    activeTab = 'accounts';
    loadConfig(id);
  }

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

  $effect(() => {
    if (selectedAgentId) {
      checkStatuses();
    } else {
      platformStatuses = {};
    }
  });

  async function checkStatuses() {
    if (!selectedAgentId) return;
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

  async function saveCurrentTab() {
    if (!selectedAgentId) return;
    saving = true;

    const payload = {
      agentId: selectedAgentId,
      soulText,
      skillsText,
      toolsText,
      timezone,
      postsPerDay,
      activeHoursStart,
      activeHoursEnd,
      autonomyLevel,
      rssUrl,
      rssActive
    };

    try {
      const res = await fetch('/api/agents/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Server error');
      }

      // Also update agent in local state so the UI reflects it immediately
      const agent = agents.find((a: any) => a.id === selectedAgentId);
      if (agent) {
        agent.soul = soulText;
        agent.skills = skillsText;
        agent.tools = toolsText;
        agent.timezone = timezone;
        agent.posts_per_day = postsPerDay;
        agent.active_hours_start = activeHoursStart;
        agent.active_hours_end = activeHoursEnd;
        agent.autonomy_level = autonomyLevel;
        agent.rss_url = rssUrl;
        agent.rss_active = rssActive;
      }

      showToast(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} config saved for ${selectedAgent?.name}`, 'success');
    } catch (err) {
      console.error('Failed to save config:', err);
      // Fallback to localStorage for development bypass/offline
      localStorage.setItem(storageKey(selectedAgentId), JSON.stringify({
        soul: soulText,
        skills: skillsText,
        tools: toolsText,
        timezone,
        postsPerDay: postsPerDay,
        activeHoursStart: activeHoursStart,
        activeHoursEnd: activeHoursEnd,
        autonomyLevel: autonomyLevel,
        rssUrl,
        rssActive,
        rssLastPolledAt
      }));
      showToast(`Saved locally (offline) for ${selectedAgent?.name}`, 'warning');
    } finally {
      saving = false;
    }
  }

  function formatHour(h: number): string {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:00 ${ampm}`;
  }

  function getStatusColor(status: string): string {
    if (status === 'active') return 'var(--success)';
    if (status === 'paused') return 'var(--warning)';
    return 'var(--text-dim)';
  }
</script>

<svelte:head>
  <title>Persona Config — PersonaGen</title>
</svelte:head>

<section class="page">
  <header class="page-header">
    <h1>Persona <span class="grad">Config</span></h1>
    <p class="subtitle">Configure your AI agent's personality, skills, tools, schedule, and autonomy level</p>
  </header>

  <!-- Agent Selector Grid -->
  <div class="agent-grid">
    {#each agents as agent (agent.id)}
      <button
        class="agent-card"
        class:selected={selectedAgentId === agent.id}
        onclick={() => selectAgent(agent.id)}
      >
        <div class="agent-avatar" style="background: {agent.gradient}">
          <span>{agent.initial}</span>
        </div>
        <div class="agent-info">
          <span class="agent-name">{agent.name}</span>
          <span class="agent-handle">{agent.handle}</span>
        </div>
        <span class="agent-status" style="color: {getStatusColor(agent.status)}">
          <span class="status-dot" style="background: {getStatusColor(agent.status)}"></span>
          {agent.status}
        </span>
      </button>
    {/each}
  </div>

  <!-- Config Editor -->
  {#if selectedAgent}
    <div class="config-editor">
      <!-- Tab Navigation -->
      <nav class="tab-nav">
        {#each tabs as tab (tab.id)}
          <button
            class="tab-btn"
            class:active={activeTab === tab.id}
            onclick={() => activeTab = tab.id}
          >
            <span class="tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        {/each}
      </nav>

      <!-- Tab Content -->
      <div class="tab-content">
        {#if activeTab === 'accounts'}
          <div class="tab-panel">
            <div class="panel-header">
              <h3>Connected Accounts</h3>
              <p class="panel-desc">Manage social platform connections for <strong>{selectedAgent.name}</strong>.</p>
            </div>
            
            {#if statusLoading}
              <div class="loading-bar">
                <div class="loading-bar-inner"></div>
              </div>
            {/if}

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
          </div>
        {:else if activeTab === 'soul'}
          <div class="tab-panel">
            <div class="panel-header">
              <h3>Soul Definition</h3>
              <p class="panel-desc">Define the core personality, voice, values, and behavioral directives for <strong>{selectedAgent.name}</strong>.</p>
            </div>
            <textarea
              class="config-textarea"
              bind:value={soulText}
              placeholder="Define your agent's personality, voice, and behavioral directives..."
              rows="20"
            ></textarea>
            <div class="panel-actions">
              <button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
                {#if saving}
                  <span class="spinner"></span> Saving…
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save Soul
                {/if}
              </button>
            </div>
          </div>
        {:else if activeTab === 'skills'}
          <div class="tab-panel">
            <div class="panel-header">
              <h3>Skills & Capabilities</h3>
              <p class="panel-desc">Define what <strong>{selectedAgent.name}</strong> can do — content skills, scouting, learning loops.</p>
            </div>
            <textarea
              class="config-textarea"
              bind:value={skillsText}
              placeholder="Define your agent's skills, capabilities, and learning loop..."
              rows="20"
            ></textarea>
            <div class="panel-actions">
              <button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
                {#if saving}
                  <span class="spinner"></span> Saving…
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save Skills
                {/if}
              </button>
            </div>
          </div>
        {:else if activeTab === 'tools'}
          <div class="tab-panel">
            <div class="panel-header">
              <h3>Tool Configuration</h3>
              <p class="panel-desc">Configure platforms, integrations, and capability layers for <strong>{selectedAgent.name}</strong>.</p>
            </div>
            <textarea
              class="config-textarea"
              bind:value={toolsText}
              placeholder="Configure connected platforms, integrations, and capabilities..."
              rows="20"
            ></textarea>
            <div class="panel-actions">
              <button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
                {#if saving}
                  <span class="spinner"></span> Saving…
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save Tools
                {/if}
              </button>
            </div>
          </div>
        {:else if activeTab === 'heartbeat'}
          <div class="tab-panel">
            <div class="panel-header">
              <h3>Heartbeat Schedule</h3>
              <p class="panel-desc">Configure posting schedule, timezone, and active hours for <strong>{selectedAgent.name}</strong>.</p>
            </div>
            <div class="heartbeat-grid">
              <div class="field-group">
                <label for="tz-select">Timezone</label>
                <select id="tz-select" bind:value={timezone}>
                  {#each timezones as tz (tz.value)}
                    <option value={tz.value}>{tz.label}</option>
                  {/each}
                </select>
              </div>

              <div class="field-group">
                <label for="ppd-slider">Posts Per Day: <strong class="accent-val">{postsPerDay}</strong></label>
                <div class="slider-wrap">
                  <span class="slider-label">1</span>
                  <input id="ppd-slider" type="range" min="1" max="10" step="1" bind:value={postsPerDay} />
                  <span class="slider-label">10</span>
                </div>
              </div>

              <div class="field-group">
                <label>Active Hours</label>
                <div class="hours-row">
                  <div class="hour-input">
                    <span class="hour-label">Start</span>
                    <select bind:value={activeHoursStart}>
                      {#each Array.from({length: 24}, (_, i) => i) as h (h)}
                        <option value={h}>{formatHour(h)}</option>
                      {/each}
                    </select>
                  </div>
                  <span class="hour-sep">→</span>
                  <div class="hour-input">
                    <span class="hour-label">End</span>
                    <select bind:value={activeHoursEnd}>
                      {#each Array.from({length: 24}, (_, i) => i) as h (h)}
                        <option value={h}>{formatHour(h)}</option>
                      {/each}
                    </select>
                  </div>
                </div>
              </div>

              <div class="field-group full-width">
                <label>Schedule Preview</label>
                <div class="schedule-preview">
                  <div class="hour-bar">
                    {#each Array.from({length: 24}, (_, i) => i) as h (h)}
                      <div
                        class="hour-block"
                        class:active-hour={h >= activeHoursStart && h < activeHoursEnd}
                        title="{formatHour(h)}"
                      >
                        {#if h % 6 === 0}
                          <span class="hour-tick">{formatHour(h)}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                  <p class="preview-text">{postsPerDay} posts spread across {activeHoursEnd - activeHoursStart}h active window in {timezones.find(t => t.value === timezone)?.label ?? timezone}</p>
                </div>
              </div>
            </div>
            <div class="panel-actions">
              <button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
                {#if saving}
                  <span class="spinner"></span> Saving…
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save Heartbeat
                {/if}
              </button>
            </div>
          </div>
        {:else if activeTab === 'autonomy'}
          <div class="tab-panel">
            <div class="panel-header">
              <h3>Autonomy Level</h3>
              <p class="panel-desc">Choose how much independence <strong>{selectedAgent.name}</strong> has when creating and publishing content.</p>
            </div>
            <div class="autonomy-cards">
              {#each autonomyKeys as level (level)}
                {@const meta = AUTONOMY_LABELS[level]}
                <button
                  class="autonomy-card"
                  class:selected={autonomyLevel === level}
                  onclick={() => autonomyLevel = level}
                >
                  <div class="autonomy-radio">
                    <div class="radio-outer">
                      {#if autonomyLevel === level}
                        <div class="radio-inner"></div>
                      {/if}
                    </div>
                  </div>
                  <div class="autonomy-body">
                    <span class="autonomy-icon">{meta.icon}</span>
                    <span class="autonomy-label">{meta.label}</span>
                    <p class="autonomy-desc">{meta.description}</p>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {:else if activeTab === 'rss'}
          <div class="tab-panel">
            <div class="panel-header">
              <h3>Content Sourcing & Mode Settings</h3>
              <p class="panel-desc">Configure how <strong>{selectedAgent.name}</strong> creates posts: autonomously from their core persona, or auto-repurposed from an RSS Feed.</p>
            </div>

            <div class="mode-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; margin-bottom: 2rem;">
              <button
                type="button"
                class="autonomy-card"
                class:selected={!rssActive}
                onclick={() => rssActive = false}
              >
                <div class="autonomy-radio">
                  <div class="radio-outer">
                    {#if !rssActive}
                      <div class="radio-inner"></div>
                    {/if}
                  </div>
                </div>
                <div class="autonomy-body">
                  <span class="autonomy-icon">✨</span>
                  <span class="autonomy-label">Dynamic Generation</span>
                  <p class="autonomy-desc">Generate original content from niche concepts, current trends, and core persona instructions.</p>
                </div>
              </button>

              <button
                type="button"
                class="autonomy-card"
                class:selected={rssActive}
                onclick={() => rssActive = true}
              >
                <div class="autonomy-radio">
                  <div class="radio-outer">
                    {#if rssActive}
                      <div class="radio-inner"></div>
                    {/if}
                  </div>
                </div>
                <div class="autonomy-body">
                  <span class="autonomy-icon">📰</span>
                  <span class="autonomy-label">RSS Feed Auto-Repurpose</span>
                  <p class="autonomy-desc">Monitor an RSS feed to automatically spin, customize, and post feed updates in this agent's voice.</p>
                </div>
              </button>
            </div>

            {#if rssActive}
              <div class="field-group" style="margin-bottom: 1.5rem; animation: fadeIn 0.3s ease;">
                <label for="rss-url-input">RSS Feed URL</label>
                <input
                  id="rss-url-input"
                  type="url"
                  placeholder="https://example.com/feed.xml"
                  bind:value={rssUrl}
                  style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
                  onfocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-mid)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 106, 237, 0.08)'; }}
                  onblur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
                <p style="font-size: var(--text-xs); color: var(--text-dim); margin-top: 0.5rem;">
                  Enter a valid RSS or Atom XML feed URL. The scheduler will check this feed periodically and spin new items.
                </p>
              </div>

              <div class="field-group" style="animation: fadeIn 0.3s ease;">
                <label>Scheduler Status</label>
                <div style="background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1rem; display: flex; align-items: center; gap: 0.75rem;">
                  <span style="font-size: 1.25rem;">⏰</span>
                  <div>
                    <span style="font-size: var(--text-xs); color: var(--text-dim); display: block; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Last Polled</span>
                    <span style="font-size: var(--text-sm); font-family: var(--font-mono); color: var(--text);">
                      {rssLastPolledAt ? new Date(rssLastPolledAt).toLocaleString() : 'Never polled yet'}
                    </span>
                  </div>
                </div>
              </div>
            {/if}

            <div class="panel-actions">
              <button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
                {#if saving}
                  <span class="spinner"></span> Saving…
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save RSS Config
                {/if}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 10-16 0"/><path d="M12 12v4m-2-2h4" stroke="var(--accent)" stroke-width="2"/></svg>
      </div>
      <h3>Select an Agent</h3>
      <p>Choose an agent from the grid above to configure their AI personality, skills, and behavior.</p>
    </div>
  {/if}
</section>

<style>
  .page {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-header {
    margin-bottom: 2rem;
  }

  .page-header h1 {
    font-size: var(--text-3xl);
    font-family: var(--font-display);
    margin-bottom: 0.5rem;
  }

  .grad {
    background: var(--gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  /* ── Agent Grid ── */
  .agent-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .agent-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
    text-align: left;
    width: 100%;
    color: var(--text);
    font-family: var(--font-body);
  }

  .agent-card:hover {
    border-color: var(--border-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .agent-card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 20px rgba(124, 106, 237, 0.15);
    background: var(--surface-2);
  }

  .agent-avatar {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .agent-avatar span {
    color: white;
    font-weight: 700;
    font-size: 1.1rem;
    font-family: var(--font-display);
  }

  .agent-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
  }

  .agent-name {
    font-weight: 600;
    font-size: var(--text-base);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .agent-handle {
    font-size: var(--text-xs);
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .agent-status {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    flex-shrink: 0;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }

  /* ── Config Editor ── */
  .config-editor {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .tab-nav {
    display: flex;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tab-nav::-webkit-scrollbar {
    display: none;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
    font-family: var(--font-body);
  }

  .tab-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.02);
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-icon {
    font-size: 1rem;
  }

  .tab-content {
    padding: 0;
  }

  .tab-panel {
    padding: 2rem;
  }

  .panel-header {
    margin-bottom: 1.5rem;
  }

  .panel-header h3 {
    font-size: var(--text-xl);
    font-family: var(--font-display);
    margin-bottom: 0.5rem;
  }

  .panel-desc {
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .panel-desc strong {
    color: var(--accent);
  }

  .config-textarea {
    width: 100%;
    min-height: 400px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1.25rem;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.7;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .config-textarea:focus {
    border-color: var(--accent-mid);
    box-shadow: 0 0 0 3px rgba(124, 106, 237, 0.08);
  }

  .panel-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .save-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.75rem;
    background: var(--gradient-subtle);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    font-family: var(--font-body);
  }

  .save-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-accent);
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Heartbeat ── */
  .heartbeat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .field-group {
    display: flex;
    flex-direction: column;
  }

  .field-group.full-width {
    grid-column: 1 / -1;
  }

  .field-group label {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin-bottom: 0.5rem;
  }

  .accent-val {
    color: var(--accent);
    font-size: var(--text-base);
  }

  .slider-wrap {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .slider-label {
    font-size: var(--text-xs);
    color: var(--text-dim);
    font-family: var(--font-mono);
    min-width: 1.5rem;
    text-align: center;
  }

  .slider-wrap input[type="range"] {
    flex: 1;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--surface-3);
    border-radius: 3px;
    outline: none;
    border: none;
    padding: 0;
  }

  .slider-wrap input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg);
    box-shadow: 0 0 8px rgba(124, 106, 237, 0.3);
  }

  .slider-wrap input[type="range"]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg);
  }

  .hours-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .hour-input {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .hour-label {
    font-size: var(--text-xs);
    color: var(--text-dim);
  }

  .hour-sep {
    color: var(--accent);
    font-size: 1.25rem;
    margin-top: 1rem;
  }

  .schedule-preview {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1rem;
  }

  .hour-bar {
    display: flex;
    gap: 2px;
    margin-bottom: 0.75rem;
  }

  .hour-block {
    flex: 1;
    height: 28px;
    background: var(--surface-3);
    border-radius: 3px;
    position: relative;
    transition: background 0.2s ease;
  }

  .hour-block.active-hour {
    background: var(--accent-mid);
  }

  .hour-tick {
    position: absolute;
    bottom: -18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 9px;
    color: var(--text-dim);
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  .preview-text {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-top: 0.5rem;
  }

  /* ── Autonomy ── */
  .autonomy-cards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .autonomy-card {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.25rem 1.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    width: 100%;
    color: var(--text);
    font-family: var(--font-body);
    transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  }

  .autonomy-card:hover {
    border-color: var(--border-hover);
    background: var(--surface-2);
  }

  .autonomy-card.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 20px rgba(124, 106, 237, 0.1);
  }

  .autonomy-radio {
    margin-top: 0.25rem;
    flex-shrink: 0;
  }

  .radio-outer {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-strong);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s ease;
  }

  .autonomy-card.selected .radio-outer {
    border-color: var(--accent);
  }

  .radio-inner {
    width: 10px;
    height: 10px;
    background: var(--accent);
    border-radius: 50%;
    animation: radioIn 0.2s ease;
  }

  @keyframes radioIn {
    from { transform: scale(0); }
    to { transform: scale(1); }
  }

  .autonomy-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .autonomy-icon {
    font-size: 1.5rem;
    margin-bottom: 0.25rem;
  }

  .autonomy-label {
    font-weight: 700;
    font-size: var(--text-md);
  }

  .autonomy-desc {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* ── Empty State ── */
  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .empty-icon {
    margin-bottom: 1.5rem;
    display: flex;
    justify-content: center;
  }

  .empty-state h3 {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    margin-bottom: 0.5rem;
  }

  .empty-state p {
    color: var(--text-muted);
    font-size: var(--text-base);
    max-width: 400px;
    margin: 0 auto;
  }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .page {
      padding: 1rem;
    }

    .agent-grid {
      grid-template-columns: 1fr;
    }

    .heartbeat-grid {
      grid-template-columns: 1fr;
    }

    .tab-panel {
      padding: 1.25rem;
    }

    .config-textarea {
      min-height: 280px;
    }

    .tab-btn {
      padding: 0.75rem 1rem;
      font-size: var(--text-sm);
    }
  }

  /* ── Platform grid ── */
  .platforms-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1.5rem;
  }

  @media (max-width: 1024px) {
    .platforms-grid {
      grid-template-columns: 1fr;
    }
  }

  .platform-card {
    background: var(--surface-2);
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
    font-weight: 600;
    font-size: var(--text-md, 1rem);
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
    font-weight: 600;
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
    font-weight: 600;
    font-size: var(--text-xs);
    cursor: pointer;
    transition: background 0.2s ease;
    font-family: var(--font-body);
  }

  .btn-disconnect:hover {
    background: rgba(239,68,68,0.2);
  }

  /* ── Loading bar ── */
  .loading-bar {
    width: 100%;
    height: 3px;
    background: var(--surface-3);
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

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
