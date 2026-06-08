<script lang="ts">
  import { page } from '$app/stores';
  import { showToast } from '$lib/stores/ui.svelte';
  import type { AutonomyLevel } from '$lib/types';
  import { AUTONOMY_LABELS } from '$lib/types';

  let { data }: { data: any } = $props();
  const agents: any[] = data.agents ?? [];

  let selectedAgentId = $state<string | null>(null);
  let activeTab = $state<'soul' | 'skills' | 'tools' | 'heartbeat' | 'autonomy'>('soul');

  $effect(() => {
    const paramAgentId = $page.params.agentId;
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
    { id: 'soul' as const, label: 'Soul', icon: '✦' },
    { id: 'skills' as const, label: 'Skills', icon: '⚙' },
    { id: 'tools' as const, label: 'Tools', icon: '🔧' },
    { id: 'heartbeat' as const, label: 'Heartbeat', icon: '💓' },
    { id: 'autonomy' as const, label: 'Autonomy', icon: '🤖' }
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
      
      // Sync local storage cache
      localStorage.setItem(storageKey(agentId), JSON.stringify({
        soul: soulText,
        skills: skillsText,
        tools: toolsText,
        timezone,
        postsPerDay,
        activeHoursStart,
        activeHoursEnd,
        autonomyLevel
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
  }

  function selectAgent(id: string) {
    selectedAgentId = id;
    activeTab = 'soul';
    loadConfig(id);
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
      autonomyLevel
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
        autonomyLevel: autonomyLevel
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
        {#if activeTab === 'soul'}
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
            <div class="panel-actions">
              <button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
                {#if saving}
                  <span class="spinner"></span> Saving…
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save Autonomy
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
</style>
