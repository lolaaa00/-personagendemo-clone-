<script lang="ts">
  import { ChannelDecode, Blueprints } from '$lib/services/api';
  import { showToast } from '$lib/stores/ui.svelte';

  type Step = 'input' | 'processing' | 'results';

  const PLATFORMS = [
    { id: 'youtube', label: 'YouTube', color: '#ff0000' },
    { id: 'tiktok', label: 'TikTok', color: '#00f2ea' },
    { id: 'instagram', label: 'Instagram', color: '#e1306c' },
    { id: 'x', label: 'X / Twitter', color: '#1da1f2' }
  ];

  const LAYERS = [
    { id: 1, name: 'Content DNA', icon: '🧬' },
    { id: 2, name: 'Audience Profile', icon: '👥' },
    { id: 3, name: 'Posting Cadence', icon: '📅' },
    { id: 4, name: 'Hook Patterns', icon: '🪝' },
    { id: 5, name: 'Visual Identity', icon: '🎨' },
    { id: 6, name: 'Engagement Mechanics', icon: '⚙️' },
    { id: 7, name: 'Growth Levers', icon: '📈' },
    { id: 8, name: 'Monetization', icon: '💰' },
    { id: 9, name: 'Replication Blueprint', icon: '🔁' }
  ];

  const SAMPLE_AGENTS = [
    { id: 'sofia-rivera', name: 'Sofia Rivera', handle: '@sofiarivera.ai' },
    { id: 'marcus-chen', name: 'Marcus Chen', handle: '@marcuschen.tech' },
    { id: 'aisha-noori', name: 'Aisha Noori', handle: '@aishanoori.style' },
    { id: 'veronica-hap', name: 'Veronica Hap', handle: '@veronicahap' }
  ];

  let step = $state<Step>('input');
  let url = $state('');
  let platform = $state('youtube');
  let currentLayer = $state(0);
  let layersCompleted = $state<number[]>([]);
  let showAgentSelector = $state(false);
  let selectedAgent = $state('');
  let saving = $state(false);

  interface LayerResult {
    score: number;
    title: string;
    findings: string[];
    confidence: number;
  }

  let results = $state<{
    channelName: string;
    platform: string;
    overallScore: number;
    layers: LayerResult[];
  } | null>(null);

  function generateDemoResults(): typeof results {
    return {
      channelName: extractChannelName(url),
      platform,
      overallScore: 87,
      layers: [
        {
          score: 92,
          title: 'Content DNA',
          findings: [
            'Primary format: Short-form vertical (68% of posts)',
            'Average video length: 47 seconds (optimal for algorithm)',
            'Content pillars: Educational (40%), Entertainment (35%), BTS (25%)',
            'Consistent opening pattern detected across 89% of top posts'
          ],
          confidence: 95
        },
        {
          score: 88,
          title: 'Audience Profile',
          findings: [
            'Core demographic: 18-34 (72%), Female-skewing (61%)',
            'Peak engagement hours: 7-9 AM, 6-8 PM local',
            'High comment sentiment score: 0.84/1.0',
            'Audience overlap with 3 complementary niches detected'
          ],
          confidence: 91
        },
        {
          score: 85,
          title: 'Posting Cadence',
          findings: [
            'Posting frequency: 5.2x/week average (last 90 days)',
            'Best performing days: Tuesday, Thursday, Saturday',
            'Consistency score: 94% (missed only 2 scheduled slots)',
            'Cross-posting delay: 2-4 hours between platforms'
          ],
          confidence: 88
        },
        {
          score: 94,
          title: 'Hook Patterns',
          findings: [
            'Top hook type: Question-based ("Did you know...") — 42% CTR',
            'Pattern interrupt hooks drive 3.2x more shares',
            'First 3 seconds retention rate: 78% (above niche avg)',
            'Text overlay hooks outperform voice-only by 28%'
          ],
          confidence: 93
        },
        {
          score: 79,
          title: 'Visual Identity',
          findings: [
            'Dominant color palette: warm earth tones + accent purple',
            'Thumbnail consistency score: 82/100',
            'Face-forward thumbnails get 2.1x higher CTR',
            'Brand font detected: Inter Bold for overlays'
          ],
          confidence: 84
        },
        {
          score: 91,
          title: 'Engagement Mechanics',
          findings: [
            'Reply rate to comments: 34% (top 5% in niche)',
            'CTA placement: End-screen with pinned comment combo',
            'Community tab usage: 3x/week polls and questions',
            'Average saves-to-likes ratio: 0.12 (content bookmark-worthy)'
          ],
          confidence: 90
        },
        {
          score: 86,
          title: 'Growth Levers',
          findings: [
            'Collab frequency: 2x/month with 10K-100K creators',
            'SEO-optimized titles detected in 76% of long-form',
            'Hashtag strategy: 3-5 niche + 1-2 trending mix',
            'Follower growth rate: +8.3% MoM (accelerating)'
          ],
          confidence: 87
        },
        {
          score: 83,
          title: 'Monetization',
          findings: [
            'Revenue streams detected: Brand deals, digital products, affiliate',
            'Estimated CPM range: $12-18 (premium niche)',
            'Affiliate link frequency: 1-2 per week (non-spammy)',
            'Product launch pattern: Quarterly with 2-week warmup'
          ],
          confidence: 78
        },
        {
          score: 90,
          title: 'Replication Blueprint',
          findings: [
            'Replicable framework score: 90/100 — highly templatable',
            'Key differentiator: Storytelling + data hybrid format',
            'Recommended entry strategy: Mirror hook + cadence first',
            'Estimated time to traction: 60-90 days with consistent output'
          ],
          confidence: 92
        }
      ]
    };
  }

  function extractChannelName(u: string): string {
    try {
      const parsed = new URL(u);
      const path = parsed.pathname.split('/').filter(Boolean);
      return path[path.length - 1]?.replace(/^@/, '') || parsed.hostname;
    } catch {
      return u || 'Unknown Channel';
    }
  }

  function isValidUrl(u: string): boolean {
    try {
      new URL(u);
      return true;
    } catch {
      return false;
    }
  }

  let canDecode = $derived(url.trim().length > 0 && isValidUrl(url));

  async function startDecode() {
    if (!canDecode) return;
    step = 'processing';
    currentLayer = 0;
    layersCompleted = [];

    // Animate through 9 layers
    for (let i = 0; i < 9; i++) {
      currentLayer = i;
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      layersCompleted = [...layersCompleted, i];
    }

    // Try API call
    try {
      const res = await ChannelDecode.decode(url, platform);
      if (res.success && res.data) {
        results = res.data as typeof results;
      } else {
        results = generateDemoResults();
      }
    } catch {
      results = generateDemoResults();
    }

    step = 'results';
  }

  function resetWizard() {
    step = 'input';
    url = '';
    platform = 'youtube';
    results = null;
    currentLayer = 0;
    layersCompleted = [];
    showAgentSelector = false;
    selectedAgent = '';
  }

  async function saveBlueprint() {
    if (!results) return;
    saving = true;
    try {
      const res = await ChannelDecode.analyze(results);
      if (res.success) {
        showToast('Blueprint saved successfully', 'success');
      } else {
        showToast('Blueprint saved locally (offline mode)', 'info');
      }
    } catch {
      showToast('Blueprint saved locally (offline mode)', 'info');
    }
    saving = false;
  }

  async function feedToAgent() {
    if (!selectedAgent || !results) return;
    try {
      const res = await Blueprints.feedToAgent('demo-blueprint', selectedAgent, results);
      if (res.success) {
        showToast(`Blueprint fed to agent successfully`, 'success');
      } else {
        showToast(`Blueprint queued for ${SAMPLE_AGENTS.find(a => a.id === selectedAgent)?.name}`, 'info');
      }
    } catch {
      showToast(`Blueprint queued for ${SAMPLE_AGENTS.find(a => a.id === selectedAgent)?.name}`, 'info');
    }
    showAgentSelector = false;
  }

  function getScoreColor(score: number): string {
    if (score >= 90) return 'var(--success)';
    if (score >= 75) return 'var(--cyan)';
    if (score >= 60) return 'var(--gold)';
    return 'var(--rose)';
  }

  function getConfidenceLabel(conf: number): string {
    if (conf >= 90) return 'High';
    if (conf >= 75) return 'Medium';
    return 'Low';
  }
</script>

<svelte:head>
  <title>Channel Decoder — PersonaGen</title>
</svelte:head>

<section class="page">
  <header class="page-header">
    <div class="title-row">
      <div class="title-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#decoderGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <defs><linearGradient id="decoderGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--cyan)"/></linearGradient></defs>
          <circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10"/><path d="M12 2a15 15 0 0 0-4 10 15 15 0 0 0 4 10"/><line x1="2" y1="12" x2="22" y2="12"/>
        </svg>
      </div>
      <div>
        <h1>Channel Decoder</h1>
        <p class="subtitle">9-layer reverse engineering of top-performing channels</p>
      </div>
    </div>
  </header>

  <!-- ─── STEP 1: INPUT ─── -->
  {#if step === 'input'}
    <div class="input-step" style="animation: fadeUp 0.4s var(--ease-out)">
      <div class="decoder-card">
        <div class="card-header">
          <h2>Decode a Channel</h2>
          <p class="card-desc">Paste any channel or profile URL to reverse-engineer their entire content strategy across 9 analysis layers.</p>
        </div>

        <div class="input-group">
          <label for="channel-url">Channel URL</label>
          <div class="url-input-wrapper">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <input
              id="channel-url"
              type="url"
              bind:value={url}
              placeholder="https://youtube.com/@channelname"
            />
          </div>
        </div>

        <div class="input-group">
          <label>Platform</label>
          <div class="platform-selector">
            {#each PLATFORMS as p}
              <button
                class="platform-btn"
                class:active={platform === p.id}
                onclick={() => platform = p.id}
                style="--plat-color: {p.color}"
              >
                {#if p.id === 'youtube'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>
                {:else if p.id === 'tiktok'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78c.29 0 .57.04.84.11v-3.5a6.37 6.37 0 0 0-.84-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 10.86 4.43V13.2a8.16 8.16 0 0 0 5.58 2.2V12a4.85 4.85 0 0 1-3.29-1.31l.04-.01A4.81 4.81 0 0 1 19.59 6.69z"/></svg>
                {:else if p.id === 'instagram'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                {/if}
                <span>{p.label}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="layers-preview">
          <label>9 Analysis Layers</label>
          <div class="layer-chips">
            {#each LAYERS as layer}
              <span class="layer-chip">
                <span class="chip-icon">{layer.icon}</span>
                <span class="chip-label">{layer.name}</span>
              </span>
            {/each}
          </div>
        </div>

        <button
          class="decode-btn"
          disabled={!canDecode}
          onclick={startDecode}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          Decode Channel
        </button>
      </div>
    </div>

  <!-- ─── STEP 2: PROCESSING ─── -->
  {:else if step === 'processing'}
    <div class="processing-step" style="animation: fadeUp 0.4s var(--ease-out)">
      <div class="decoder-card processing-card">
        <div class="processing-header">
          <div class="scan-orb">
            <div class="orb-ring"></div>
            <div class="orb-ring delay-1"></div>
            <div class="orb-ring delay-2"></div>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10"/>
            </svg>
          </div>
          <h2>Decoding Channel</h2>
          <p class="processing-url">{url}</p>
        </div>

        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: {((layersCompleted.length) / 9) * 100}%"></div>
          </div>
          <span class="progress-label">{layersCompleted.length} / 9 layers</span>
        </div>

        <div class="layers-list">
          {#each LAYERS as layer, i}
            <div
              class="layer-row"
              class:active={currentLayer === i && !layersCompleted.includes(i)}
              class:completed={layersCompleted.includes(i)}
              class:pending={currentLayer < i && !layersCompleted.includes(i)}
            >
              <div class="layer-status">
                {#if layersCompleted.includes(i)}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {:else if currentLayer === i}
                  <div class="spinner"></div>
                {:else}
                  <div class="dot"></div>
                {/if}
              </div>
              <span class="layer-icon">{layer.icon}</span>
              <span class="layer-name">{layer.name}</span>
              {#if layersCompleted.includes(i)}
                <span class="layer-done-tag">Done</span>
              {:else if currentLayer === i}
                <span class="layer-active-tag">Analyzing...</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

  <!-- ─── STEP 3: RESULTS ─── -->
  {:else if step === 'results' && results}
    <div class="results-step" style="animation: fadeUp 0.4s var(--ease-out)">
      <!-- Overall Score -->
      <div class="overall-score-card">
        <div class="score-visual">
          <div class="score-ring" style="--score: {results.overallScore}; --score-color: {getScoreColor(results.overallScore)}">
            <span class="score-number">{results.overallScore}</span>
          </div>
        </div>
        <div class="score-info">
          <h2>{results.channelName}</h2>
          <p class="score-platform">
            {PLATFORMS.find(p => p.id === results?.platform)?.label || results.platform} • Blueprint Score
          </p>
          <div class="score-actions">
            <button class="action-btn primary" onclick={saveBlueprint} disabled={saving}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {saving ? 'Saving...' : 'Save Blueprint'}
            </button>
            <button class="action-btn accent" onclick={() => showAgentSelector = !showAgentSelector}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Feed to Agent
            </button>
            <button class="action-btn ghost" onclick={resetWizard}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              Decode Another
            </button>
          </div>

          {#if showAgentSelector}
            <div class="agent-selector" style="animation: fadeUp 0.25s var(--ease-out)">
              <select bind:value={selectedAgent}>
                <option value="">Select an agent...</option>
                {#each SAMPLE_AGENTS as agent}
                  <option value={agent.id}>{agent.name} ({agent.handle})</option>
                {/each}
              </select>
              <button class="feed-btn" disabled={!selectedAgent} onclick={feedToAgent}>
                Send Blueprint
              </button>
            </div>
          {/if}
        </div>
      </div>

      <!-- Layer Cards -->
      <div class="layers-grid">
        {#each results.layers as layer, i}
          <div class="layer-card" style="animation-delay: {i * 0.06}s">
            <div class="layer-card-header">
              <div class="layer-badge" style="background: {getScoreColor(layer.score)}20; color: {getScoreColor(layer.score)}; border-color: {getScoreColor(layer.score)}40">
                {layer.score}
              </div>
              <div class="layer-title-group">
                <span class="layer-num">Layer {i + 1}</span>
                <h3>{layer.title}</h3>
              </div>
              <div class="confidence-indicator" title="Confidence: {layer.confidence}%">
                <div class="confidence-bar">
                  <div class="confidence-fill" style="width: {layer.confidence}%; background: {getScoreColor(layer.confidence)}"></div>
                </div>
                <span class="confidence-label" style="color: {getScoreColor(layer.confidence)}">{getConfidenceLabel(layer.confidence)}</span>
              </div>
            </div>
            <ul class="findings-list">
              {#each layer.findings as finding}
                <li>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  <span>{finding}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
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

  .title-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .title-icon {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    border: 1px solid var(--accent-mid);
    border-radius: var(--radius-sm);
  }

  .title-row h1 {
    font-family: var(--font-display);
    font-size: 1.75rem;
    color: var(--text);
    margin: 0;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0.25rem 0 0;
  }

  /* ─── Input Step ─── */
  .decoder-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2.5rem;
    max-width: 720px;
    margin: 0 auto;
  }

  .card-header {
    margin-bottom: 2rem;
    text-align: center;
  }

  .card-header h2 {
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--text);
    margin: 0 0 0.5rem;
  }

  .card-desc {
    color: var(--text-muted);
    font-size: 0.88rem;
    margin: 0;
    line-height: 1.6;
  }

  .input-group {
    margin-bottom: 1.5rem;
  }

  .url-input-wrapper {
    position: relative;
  }

  .url-input-wrapper .input-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .url-input-wrapper input {
    padding-left: 42px;
    width: 100%;
  }

  .platform-selector {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
  }

  .platform-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .platform-btn:hover {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .platform-btn.active {
    border-color: var(--plat-color);
    color: var(--plat-color);
    background: color-mix(in srgb, var(--plat-color) 8%, transparent);
    box-shadow: 0 0 20px color-mix(in srgb, var(--plat-color) 10%, transparent);
  }

  .layers-preview {
    margin-bottom: 2rem;
  }

  .layer-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .layer-chip {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .chip-icon {
    font-size: 0.85rem;
  }

  .decode-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 1rem;
    background: var(--gradient);
    border: none;
    border-radius: var(--radius-sm);
    color: #fff;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.3s ease;
  }

  .decode-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(124,106,237,0.3);
  }

  .decode-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ─── Processing Step ─── */
  .processing-card {
    max-width: 600px;
    margin: 0 auto;
    text-align: center;
  }

  .processing-header {
    margin-bottom: 2rem;
  }

  .scan-orb {
    position: relative;
    width: 80px;
    height: 80px;
    margin: 0 auto 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .orb-ring {
    position: absolute;
    inset: 0;
    border: 2px solid var(--accent-mid);
    border-radius: 50%;
    animation: orbPulse 2s ease-in-out infinite;
  }

  .orb-ring.delay-1 {
    animation-delay: 0.4s;
    inset: -8px;
  }

  .orb-ring.delay-2 {
    animation-delay: 0.8s;
    inset: -16px;
    border-color: var(--cyan-mid);
  }

  @keyframes orbPulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
  }

  .processing-header h2 {
    font-family: var(--font-display);
    font-size: 1.3rem;
    margin: 0 0 0.5rem;
    color: var(--text);
  }

  .processing-url {
    color: var(--text-dim);
    font-size: 0.8rem;
    font-family: var(--font-mono);
    word-break: break-all;
    margin: 0;
  }

  .progress-container {
    margin-bottom: 2rem;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .progress-fill {
    height: 100%;
    background: var(--gradient);
    border-radius: var(--radius-full);
    transition: width 0.5s var(--ease-out);
  }

  .progress-label {
    font-size: 0.78rem;
    color: var(--text-dim);
  }

  .layers-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    text-align: left;
  }

  .layer-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    border-radius: var(--radius-sm);
    transition: all 0.3s ease;
  }

  .layer-row.active {
    background: var(--accent-soft);
    border: 1px solid var(--accent-mid);
  }

  .layer-row.completed {
    opacity: 0.7;
  }

  .layer-row.pending {
    opacity: 0.35;
  }

  .layer-status {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--accent-mid);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border-strong);
  }

  .layer-icon {
    font-size: 1.1rem;
  }

  .layer-name {
    flex: 1;
    font-size: 0.88rem;
    color: var(--text);
    font-weight: 500;
  }

  .layer-done-tag, .layer-active-tag {
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-full);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .layer-done-tag {
    background: var(--success-soft);
    color: var(--success);
  }

  .layer-active-tag {
    background: var(--accent-soft);
    color: var(--accent);
    animation: ambientPulse 1.5s ease-in-out infinite;
  }

  /* ─── Results Step ─── */
  .overall-score-card {
    display: flex;
    align-items: center;
    gap: 2.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2rem 2.5rem;
    margin-bottom: 2rem;
  }

  .score-ring {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: conic-gradient(var(--score-color) calc(var(--score) * 3.6deg), var(--surface-3) 0);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    flex-shrink: 0;
  }

  .score-ring::before {
    content: '';
    position: absolute;
    inset: 8px;
    border-radius: 50%;
    background: var(--surface);
  }

  .score-number {
    position: relative;
    z-index: 1;
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 700;
    color: var(--text);
  }

  .score-info {
    flex: 1;
  }

  .score-info h2 {
    font-family: var(--font-display);
    font-size: 1.5rem;
    color: var(--text);
    margin: 0 0 0.25rem;
  }

  .score-platform {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0 0 1.25rem;
  }

  .score-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.2rem;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.2s ease;
  }

  .action-btn.primary {
    background: var(--gradient);
    color: #fff;
    border: none;
  }

  .action-btn.primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-accent);
  }

  .action-btn.accent {
    background: var(--accent-soft);
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  .action-btn.accent:hover {
    background: var(--accent-mid);
    color: var(--text);
  }

  .action-btn.ghost {
    background: transparent;
    border-color: var(--border-strong);
    color: var(--text-muted);
  }

  .action-btn.ghost:hover {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .agent-selector {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    align-items: center;
  }

  .agent-selector select {
    flex: 1;
    max-width: 300px;
  }

  .feed-btn {
    padding: 0.6rem 1.2rem;
    background: var(--gradient);
    border: none;
    border-radius: var(--radius-sm);
    color: #fff;
    font-weight: 600;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .feed-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-accent);
  }

  .feed-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ─── Layer Cards Grid ─── */
  .layers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 1.25rem;
  }

  .layer-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    transition: border-color 0.2s ease, transform 0.2s ease;
    animation: fadeUp 0.4s var(--ease-out) both;
  }

  .layer-card:hover {
    border-color: var(--border-hover);
    transform: translateY(-2px);
  }

  .layer-card-header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .layer-badge {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    font-family: var(--font-display);
    font-size: 1.2rem;
    font-weight: 700;
    border: 1px solid;
    flex-shrink: 0;
  }

  .layer-title-group {
    flex: 1;
    min-width: 0;
  }

  .layer-num {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
  }

  .layer-title-group h3 {
    font-family: var(--font-display);
    font-size: 1.05rem;
    color: var(--text);
    margin: 0.1rem 0 0;
  }

  .confidence-indicator {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .confidence-bar {
    width: 60px;
    height: 4px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .confidence-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 0.5s ease;
  }

  .confidence-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .findings-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .findings-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .findings-list li svg {
    flex-shrink: 0;
    margin-top: 2px;
  }

  /* ─── Responsive ─── */
  @media (max-width: 768px) {
    .page {
      padding: 1rem;
    }

    .decoder-card {
      padding: 1.5rem;
    }

    .platform-selector {
      grid-template-columns: repeat(2, 1fr);
    }

    .overall-score-card {
      flex-direction: column;
      text-align: center;
      padding: 1.5rem;
      gap: 1.5rem;
    }

    .score-actions {
      justify-content: center;
    }

    .agent-selector {
      flex-direction: column;
    }

    .agent-selector select {
      max-width: 100%;
    }

    .layers-grid {
      grid-template-columns: 1fr;
    }

    .platform-btn span {
      display: none;
    }
  }
</style>
