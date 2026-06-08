<script lang="ts">
  import { ContentForge } from '$lib/services/api';
  import { showToast } from '$lib/stores/ui.svelte';
  import { goto } from '$app/navigation';

  const PLATFORMS = [
    { id: 'youtube', label: 'YouTube', color: '#ff0000' },
    { id: 'tiktok', label: 'TikTok', color: '#00f2ea' },
    { id: 'instagram', label: 'Instagram', color: '#e1306c' },
    { id: 'x', label: 'X / Twitter', color: '#1da1f2' }
  ];

  const CONTENT_TYPES = [
    { id: 'post', label: 'Post', icon: '📝' },
    { id: 'script', label: 'Script', icon: '🎬' },
    { id: 'titles', label: 'Title Ideas', icon: '💡' },
    { id: 'thumbnail', label: 'Thumbnail Brief', icon: '🖼️' }
  ];

  const SAMPLE_AGENTS = [
    { id: 'sofia-rivera', name: 'Sofia Rivera', handle: '@sofiarivera.ai', gradient: 'linear-gradient(135deg, #f472b6, #a78bfa)' },
    { id: 'marcus-chen', name: 'Marcus Chen', handle: '@marcuschen.tech', gradient: 'linear-gradient(135deg, #34d399, #60a5fa)' },
    { id: 'aisha-noori', name: 'Aisha Noori', handle: '@aishanoori.style', gradient: 'linear-gradient(135deg, #fbbf24, #f97316)' },
    { id: 'veronica-hap', name: 'Veronica Hap', handle: '@veronicahap', gradient: 'linear-gradient(135deg, #8b5cf6, #ec4899)' }
  ];

  interface SampleBlueprint {
    id: string;
    name: string;
    platform: string;
    niche: string;
    score: number;
    date: string;
    layers: number;
  }

  const SAMPLE_BLUEPRINTS: SampleBlueprint[] = [
    { id: 'bp-1', name: 'FitnessByKira', platform: 'youtube', niche: 'Fitness & Wellness', score: 92, date: '2 days ago', layers: 9 },
    { id: 'bp-2', name: 'TechBroDaily', platform: 'x', niche: 'Tech & AI', score: 87, date: '1 week ago', layers: 9 },
    { id: 'bp-3', name: 'StyleWithMaya', platform: 'instagram', niche: 'Fashion & Luxury', score: 95, date: '3 days ago', layers: 9 },
    { id: 'bp-4', name: 'CookingVibes', platform: 'tiktok', niche: 'Food & Cooking', score: 78, date: '5 days ago', layers: 9 }
  ];

  let selectedBlueprint = $state<string | null>(SAMPLE_BLUEPRINTS[0].id);
  let topic = $state('');
  let selectedAgent = $state('');
  let selectedPlatforms = $state<string[]>(['youtube']);
  let contentType = $state('post');
  let forging = $state(false);
  let editing = $state(false);
  let showRepurpose = $state(false);
  let repurposePlatforms = $state<string[]>([]);

  interface ForgeOutput {
    type: string;
    platform: string;
    content: string;
    hashtags: string[];
    hookScore: number;
    estimatedReach: string;
    titles?: string[];
    thumbnailNotes?: string[];
  }

  let output = $state<ForgeOutput | null>(null);
  let editableContent = $state('');

  let selectedBp = $derived(SAMPLE_BLUEPRINTS.find(b => b.id === selectedBlueprint));
  let canForge = $derived(selectedBlueprint && topic.trim().length > 0 && selectedAgent && selectedPlatforms.length > 0);

  function togglePlatform(id: string) {
    if (selectedPlatforms.includes(id)) {
      if (selectedPlatforms.length > 1) {
        selectedPlatforms = selectedPlatforms.filter(p => p !== id);
      }
    } else {
      selectedPlatforms = [...selectedPlatforms, id];
    }
  }

  function toggleRepurposePlatform(id: string) {
    if (repurposePlatforms.includes(id)) {
      repurposePlatforms = repurposePlatforms.filter(p => p !== id);
    } else {
      repurposePlatforms = [...repurposePlatforms, id];
    }
  }

  function generateDemoOutput(): ForgeOutput {
    const base: Record<string, ForgeOutput> = {
      post: {
        type: 'post',
        platform: selectedPlatforms[0],
        content: `🔥 ${topic}\n\nMost people in ${selectedBp?.niche || 'this space'} get this completely wrong.\n\nHere's what the top 1% actually do:\n\n1️⃣ They focus on consistency over perfection\n→ Posting 5x/week beats 1 "perfect" post\n\n2️⃣ They lead with the transformation, not the method\n→ Show the result in the first 3 seconds\n\n3️⃣ They treat every comment as a content idea\n→ Your audience literally tells you what to make next\n\n4️⃣ They have a system, not motivation\n→ Blueprint-driven content creation eliminates burnout\n\n5️⃣ They study competitors, then do the opposite\n→ Pattern-breaking content gets 3.2x more shares\n\nWhich one are you implementing first?\n\nDrop "BLUEPRINT" in the comments for my free content strategy template 👇`,
        hashtags: ['#ContentStrategy', '#CreatorEconomy', '#GrowthHacks', `#${selectedBp?.niche.replace(/\s*&\s*/g, '').replace(/\s+/g, '') || 'Content'}`, '#PersonaGen'],
        hookScore: 89,
        estimatedReach: '12.4K - 28.7K',
        titles: undefined,
        thumbnailNotes: undefined
      },
      script: {
        type: 'script',
        platform: selectedPlatforms[0],
        content: `[HOOK — 0:00-0:03]\n"I decoded the exact strategy behind a ${selectedBp?.score || 90}-score channel and here's what I found..."\n\n[PATTERN INTERRUPT — 0:03-0:05]\n[Quick zoom cut, text overlay: "${topic}"]\n\n[SETUP — 0:05-0:15]\n"I ran this channel through our 9-layer decoder and the results were insane. Their content DNA showed a pattern that 99% of creators miss."\n\n[VALUE — 0:15-0:45]\n"Here's the framework:\n\nFirst — they use what I call 'Question Hooks.' Every single video starts with a question that creates an open loop in your brain.\n\nSecond — their posting cadence isn't random. They post at exactly the times when their audience's engagement peaks — which is different from what most gurus tell you.\n\nThird — and this is the big one — they have a 'Replication Blueprint.' A literal system that turns one piece of content into 5 platform-native posts."\n\n[CTA — 0:45-0:55]\n"If you want me to decode YOUR competitors and build a custom blueprint, drop 'DECODE' in the comments. Link in bio for the full breakdown."\n\n[OUTRO — 0:55-1:00]\n[End screen with subscribe/follow prompt]`,
        hashtags: ['#ContentCreator', '#VideoScript', '#GrowthStrategy'],
        hookScore: 94,
        estimatedReach: '18.2K - 45.1K',
        titles: undefined,
        thumbnailNotes: undefined
      },
      titles: {
        type: 'titles',
        platform: selectedPlatforms[0],
        content: '',
        hashtags: [],
        hookScore: 91,
        estimatedReach: 'N/A',
        titles: [
          `I Decoded a ${selectedBp?.score || 90}-Score Channel — Here's Their Exact Blueprint`,
          `The ${topic} Strategy Nobody Talks About (9-Layer Analysis)`,
          `Why 99% of ${selectedBp?.niche || 'Content'} Creators Fail (Data Proof)`,
          `I Reverse-Engineered the #1 ${selectedBp?.niche || 'Content'} Channel — Here's What I Found`,
          `Stop Guessing: The Exact ${topic} Framework That Works`,
          `${topic}: The Content Blueprint That Gets 10x Engagement`,
          `I Spent 48 Hours Analyzing Top Channels — This Pattern Changed Everything`,
          `The ${topic} Playbook: What Top 1% Creators Do Differently`
        ],
        thumbnailNotes: undefined
      },
      thumbnail: {
        type: 'thumbnail',
        platform: selectedPlatforms[0],
        content: '',
        hashtags: [],
        hookScore: 86,
        estimatedReach: 'N/A',
        titles: undefined,
        thumbnailNotes: [
          '**Layout:** Split-frame with face (left 60%) + data visualization (right 40%)',
          '**Expression:** Surprised/intrigued face, slight head tilt, eyebrows raised',
          '**Text Overlay:** "I DECODED IT" in bold Impact font, white with black outline',
          `**Accent Elements:** ${selectedBp?.score || 90}/100 score badge in top-right, glowing accent color`,
          '**Background:** Dark gradient (#0b0713 → #1e1e2e) with subtle grid pattern',
          '**Color Palette:** Primary purple (#7c6aed), accent cyan (#22d3ee), white text',
          '**Props/Overlays:** Holographic data streams, floating analysis cards',
          '**Emotion Target:** Curiosity + FOMO — "I need to know what they found"'
        ]
      }
    };
    return base[contentType] || base.post;
  }

  async function forgeContent() {
    if (!canForge) return;
    forging = true;
    output = null;

    // Simulate processing time
    await new Promise(r => setTimeout(r, 1800 + Math.random() * 1200));

    try {
      let res;
      if (contentType === 'post') {
        res = await ContentForge.generate(selectedBlueprint!, topic, selectedAgent, selectedPlatforms);
      } else if (contentType === 'script') {
        res = await ContentForge.script(selectedBlueprint!, topic, selectedAgent);
      } else if (contentType === 'titles') {
        res = await ContentForge.titles(selectedBlueprint!, topic);
      } else {
        res = await ContentForge.thumbnailBrief(selectedBlueprint!, topic);
      }

      if (res.success && res.data) {
        output = res.data as ForgeOutput;
      } else {
        output = generateDemoOutput();
      }
    } catch {
      output = generateDemoOutput();
    }

    if (output) {
      editableContent = output.content;
    }
    forging = false;
  }

  async function copyContent() {
    const text = editing ? editableContent : (output?.content || '');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Content copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy', 'error');
    }
  }

  function toggleEdit() {
    if (editing && output) {
      output.content = editableContent;
      showToast('Content updated', 'success');
    }
    editing = !editing;
  }

  function getPlatformColor(id: string): string {
    return PLATFORMS.find(p => p.id === id)?.color || 'var(--accent)';
  }

  function getScoreColor(score: number): string {
    if (score >= 90) return 'var(--success)';
    if (score >= 75) return 'var(--cyan)';
    if (score >= 60) return 'var(--gold)';
    return 'var(--rose)';
  }

  async function handleRepurpose() {
    if (repurposePlatforms.length === 0) return;
    try {
      await ContentForge.repurpose('demo-content', repurposePlatforms);
      showToast(`Content queued for repurposing to ${repurposePlatforms.length} platform(s)`, 'success');
    } catch {
      showToast(`Content queued for repurposing to ${repurposePlatforms.length} platform(s)`, 'info');
    }
    showRepurpose = false;
    repurposePlatforms = [];
  }
</script>

<svelte:head>
  <title>Content Forge — PersonaGen</title>
</svelte:head>

<section class="page">
  <header class="page-header">
    <div class="title-row">
      <div class="title-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#forgeGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <defs><linearGradient id="forgeGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="var(--rose)"/><stop offset="100%" stop-color="var(--gold)"/></linearGradient></defs>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
      </div>
      <div>
        <h1>Content Forge</h1>
        <p class="subtitle">Transform blueprints into production-ready content</p>
      </div>
    </div>
  </header>

  <div class="forge-layout">
    <!-- ─── LEFT: Blueprint Selector ─── -->
    <aside class="blueprint-panel">
      <div class="panel-header">
        <h2>Blueprints</h2>
        <span class="badge">{SAMPLE_BLUEPRINTS.length}</span>
      </div>
      <div class="blueprint-list">
        {#each SAMPLE_BLUEPRINTS as bp}
          <button
            class="blueprint-item"
            class:active={selectedBlueprint === bp.id}
            onclick={() => selectedBlueprint = bp.id}
          >
            <div class="bp-score" style="color: {getScoreColor(bp.score)}">{bp.score}</div>
            <div class="bp-info">
              <span class="bp-name">{bp.name}</span>
              <span class="bp-meta">{bp.niche} • {bp.date}</span>
            </div>
            <span class="bp-platform" style="color: {getPlatformColor(bp.platform)}">
              {PLATFORMS.find(p => p.id === bp.platform)?.label || bp.platform}
            </span>
          </button>
        {/each}
      </div>
      <a href="/channel-decoder" class="new-blueprint-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Decode New Channel
      </a>
    </aside>

    <!-- ─── RIGHT: Forge Controls ─── -->
    <main class="forge-main">
      <div class="controls-card">
        <h3>Forge Settings</h3>

        <div class="form-grid">
          <div class="input-group full-width">
            <label for="forge-topic">Topic / Prompt</label>
            <input id="forge-topic" type="text" bind:value={topic} placeholder="e.g. How to grow on TikTok in 2026" />
          </div>

          <div class="input-group">
            <label for="forge-agent">Agent</label>
            <select id="forge-agent" bind:value={selectedAgent}>
              <option value="">Select agent...</option>
              {#each SAMPLE_AGENTS as agent}
                <option value={agent.id}>{agent.name}</option>
              {/each}
            </select>
          </div>

          <div class="input-group">
            <label>Content Type</label>
            <div class="type-selector">
              {#each CONTENT_TYPES as ct}
                <button
                  class="type-btn"
                  class:active={contentType === ct.id}
                  onclick={() => contentType = ct.id}
                >
                  <span class="type-icon">{ct.icon}</span>
                  <span>{ct.label}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="input-group full-width">
            <label>Target Platforms</label>
            <div class="platform-checks">
              {#each PLATFORMS as p}
                <button
                  class="plat-check"
                  class:checked={selectedPlatforms.includes(p.id)}
                  onclick={() => togglePlatform(p.id)}
                  style="--plat-color: {p.color}"
                >
                  <div class="check-box">
                    {#if selectedPlatforms.includes(p.id)}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {/if}
                  </div>
                  <span>{p.label}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <button class="forge-btn" disabled={!canForge || forging} onclick={forgeContent}>
          {#if forging}
            <div class="btn-spinner"></div>
            Forging...
          {:else}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
            Forge Content
          {/if}
        </button>
      </div>

      <!-- ─── Output Area ─── -->
      {#if forging}
        <div class="output-card loading-card" style="animation: fadeUp 0.3s var(--ease-out)">
          <div class="forge-loading">
            <div class="loading-anvil">
              <div class="spark spark-1"></div>
              <div class="spark spark-2"></div>
              <div class="spark spark-3"></div>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>
            <p>Forging your content from the blueprint...</p>
            <div class="loading-bar">
              <div class="loading-fill"></div>
            </div>
          </div>
        </div>
      {/if}

      {#if output && !forging}
        <div class="output-card" style="animation: fadeUp 0.4s var(--ease-out)">
          <div class="output-header">
            <div class="output-type">
              <span class="type-badge">{CONTENT_TYPES.find(c => c.id === output?.type)?.icon} {CONTENT_TYPES.find(c => c.id === output?.type)?.label}</span>
              {#if output.hookScore}
                <span class="hook-score" style="color: {getScoreColor(output.hookScore)}">Hook Score: {output.hookScore}</span>
              {/if}
              {#if output.estimatedReach && output.estimatedReach !== 'N/A'}
                <span class="reach-badge">Est. Reach: {output.estimatedReach}</span>
              {/if}
            </div>
            <div class="output-actions">
              <button class="icon-btn" onclick={copyContent} title="Copy">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button class="icon-btn" class:active={editing} onclick={toggleEdit} title="{editing ? 'Save' : 'Edit'}">
                {#if editing}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                {/if}
              </button>
            </div>
          </div>

          <!-- Content body -->
          {#if output.type === 'titles' && output.titles}
            <div class="titles-grid">
              {#each output.titles as title, i}
                <div class="title-item">
                  <span class="title-num">{i + 1}</span>
                  <span class="title-text">{title}</span>
                  <button class="copy-title" onclick={async () => { try { await navigator.clipboard.writeText(title); showToast('Title copied', 'success'); } catch { /* no-op */ } }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </div>
              {/each}
            </div>
          {:else if output.type === 'thumbnail' && output.thumbnailNotes}
            <div class="thumbnail-brief">
              {#each output.thumbnailNotes as note}
                <div class="brief-item">{@html note.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</div>
              {/each}
            </div>
          {:else}
            <div class="content-body">
              {#if editing}
                <textarea class="edit-textarea" bind:value={editableContent}></textarea>
              {:else}
                <pre class="content-pre">{output.content}</pre>
              {/if}
            </div>
          {/if}

          <!-- Hashtags -->
          {#if output.hashtags && output.hashtags.length > 0}
            <div class="hashtags-row">
              {#each output.hashtags as tag}
                <span class="hashtag">{tag}</span>
              {/each}
            </div>
          {/if}

          <!-- Platform Previews -->
          <div class="preview-strip">
            {#each selectedPlatforms as platId}
              <div class="platform-preview" style="border-color: {getPlatformColor(platId)}20">
                <span class="preview-label" style="color: {getPlatformColor(platId)}">{PLATFORMS.find(p => p.id === platId)?.label}</span>
                <span class="preview-status">Ready to publish</span>
              </div>
            {/each}
          </div>

          <!-- Bottom Actions -->
          <div class="bottom-actions">
            <button class="action-btn schedule" onclick={() => goto('/calendar')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Schedule
            </button>
            <button class="action-btn repurpose" onclick={() => showRepurpose = !showRepurpose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              Repurpose
            </button>
          </div>

          {#if showRepurpose}
            <div class="repurpose-panel" style="animation: fadeUp 0.25s var(--ease-out)">
              <p class="repurpose-label">Select platforms to cross-post:</p>
              <div class="repurpose-options">
                {#each PLATFORMS.filter(p => !selectedPlatforms.includes(p.id)) as p}
                  <button
                    class="repurpose-opt"
                    class:selected={repurposePlatforms.includes(p.id)}
                    onclick={() => toggleRepurposePlatform(p.id)}
                    style="--plat-color: {p.color}"
                  >
                    {p.label}
                  </button>
                {/each}
              </div>
              <button class="repurpose-go" disabled={repurposePlatforms.length === 0} onclick={handleRepurpose}>
                Repurpose to {repurposePlatforms.length} platform{repurposePlatforms.length !== 1 ? 's' : ''}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </main>
  </div>
</section>

<style>
  .page {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-header { margin-bottom: 2rem; }

  .title-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .title-icon {
    width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
    background: var(--rose-soft);
    border: 1px solid rgba(244,114,182,0.2);
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

  /* ─── Layout ─── */
  .forge-layout {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  /* ─── Blueprint Panel ─── */
  .blueprint-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    position: sticky;
    top: 1rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .panel-header h2 {
    font-family: var(--font-display);
    font-size: 1rem;
    color: var(--text);
    margin: 0;
  }

  .badge {
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-full);
  }

  .blueprint-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .blueprint-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    width: 100%;
  }

  .blueprint-item:hover {
    border-color: var(--border-hover);
    background: var(--surface-2);
  }

  .blueprint-item.active {
    border-color: var(--accent-mid);
    background: var(--accent-soft);
  }

  .bp-score {
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-weight: 700;
    flex-shrink: 0;
    width: 32px;
    text-align: center;
  }

  .bp-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .bp-name {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bp-meta {
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  .bp-platform {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .new-blueprint-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.65rem;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 0.8rem;
    font-weight: 500;
    transition: all 0.2s ease;
    text-decoration: none;
  }

  .new-blueprint-link:hover {
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  /* ─── Forge Controls ─── */
  .controls-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.75rem;
    margin-bottom: 1.5rem;
  }

  .controls-card h3 {
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: var(--text);
    margin: 0 0 1.25rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .input-group.full-width {
    grid-column: 1 / -1;
  }

  .type-selector {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .type-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.6rem 0.5rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .type-btn:hover {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .type-btn.active {
    border-color: var(--accent-mid);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .type-icon { font-size: 0.95rem; }

  .platform-checks {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .plat-check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .plat-check:hover {
    border-color: var(--border-hover);
  }

  .plat-check.checked {
    border-color: var(--plat-color);
    color: var(--plat-color);
  }

  .check-box {
    width: 18px; height: 18px;
    border: 2px solid var(--border-strong);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .plat-check.checked .check-box {
    border-color: var(--plat-color);
    background: color-mix(in srgb, var(--plat-color) 20%, transparent);
  }

  .forge-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 1rem;
    background: var(--gradient-warm);
    border: none;
    border-radius: var(--radius-sm);
    color: #fff;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.3s ease;
  }

  .forge-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(244,114,182,0.25);
  }

  .forge-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ─── Loading ─── */
  .loading-card {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .forge-loading {
    text-align: center;
    padding: 2rem;
  }

  .loading-anvil {
    position: relative;
    width: 60px; height: 60px;
    margin: 0 auto 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .spark {
    position: absolute;
    width: 4px; height: 4px;
    background: var(--gold);
    border-radius: 50%;
    animation: sparkle 1.2s ease-in-out infinite;
  }

  .spark-1 { top: 0; left: 10px; animation-delay: 0s; }
  .spark-2 { top: 5px; right: 5px; animation-delay: 0.3s; }
  .spark-3 { bottom: 10px; left: 5px; animation-delay: 0.6s; }

  @keyframes sparkle {
    0%, 100% { opacity: 0; transform: translateY(0) scale(0.5); }
    50% { opacity: 1; transform: translateY(-10px) scale(1.2); }
  }

  .forge-loading p {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .loading-bar {
    width: 200px;
    height: 4px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin: 0 auto;
  }

  .loading-fill {
    height: 100%;
    width: 40%;
    background: var(--gradient-warm);
    border-radius: var(--radius-full);
    animation: loadSlide 1.5s ease-in-out infinite;
  }

  @keyframes loadSlide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  /* ─── Output Card ─── */
  .output-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.75rem;
  }

  .output-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .output-type {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .type-badge {
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-full);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
  }

  .hook-score {
    font-size: 0.78rem;
    font-weight: 700;
    font-family: var(--font-mono);
  }

  .reach-badge {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .output-actions {
    display: flex;
    gap: 0.5rem;
  }

  .icon-btn {
    width: 36px; height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .icon-btn:hover, .icon-btn.active {
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  .content-body { margin-bottom: 1rem; }

  .content-pre {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1.25rem;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: var(--font-body);
    font-size: 0.85rem;
    color: var(--text);
    line-height: 1.7;
    max-height: 500px;
    overflow-y: auto;
  }

  .edit-textarea {
    width: 100%;
    min-height: 300px;
    background: var(--surface-2);
    border: 1px solid var(--accent-mid);
    border-radius: var(--radius-sm);
    padding: 1.25rem;
    color: var(--text);
    font-family: var(--font-body);
    font-size: 0.85rem;
    line-height: 1.7;
    resize: vertical;
  }

  .titles-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .title-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition: border-color 0.2s ease;
  }

  .title-item:hover {
    border-color: var(--border-hover);
  }

  .title-num {
    width: 24px; height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    border-radius: var(--radius-full);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--accent);
    flex-shrink: 0;
  }

  .title-text {
    flex: 1;
    font-size: 0.85rem;
    color: var(--text);
    line-height: 1.4;
  }

  .copy-title {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.25rem;
    flex-shrink: 0;
    transition: color 0.2s ease;
  }

  .copy-title:hover { color: var(--accent); }

  .thumbnail-brief {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }

  .brief-item {
    padding: 0.75rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .brief-item :global(strong) {
    color: var(--text);
  }

  .hashtags-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 1.25rem;
  }

  .hashtag {
    padding: 0.3rem 0.6rem;
    background: var(--accent-soft);
    border-radius: var(--radius-full);
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--accent);
  }

  .preview-strip {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }

  .platform-preview {
    flex: 1;
    min-width: 140px;
    padding: 0.75rem 1rem;
    background: var(--surface-2);
    border: 1px solid;
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .preview-label {
    font-size: 0.78rem;
    font-weight: 700;
  }

  .preview-status {
    font-size: 0.7rem;
    color: var(--success);
  }

  .bottom-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1.25rem;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid;
  }

  .action-btn.schedule {
    background: var(--accent-soft);
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  .action-btn.schedule:hover {
    background: var(--accent-mid);
    color: var(--text);
  }

  .action-btn.repurpose {
    background: var(--cyan-soft);
    border-color: var(--cyan-mid);
    color: var(--cyan);
  }

  .action-btn.repurpose:hover {
    background: var(--cyan-mid);
    color: var(--text);
  }

  .repurpose-panel {
    margin-top: 1.25rem;
    padding: 1.25rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .repurpose-label {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  .repurpose-options {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .repurpose-opt {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-xs);
    color: var(--text-muted);
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .repurpose-opt.selected {
    border-color: var(--plat-color);
    color: var(--plat-color);
    background: color-mix(in srgb, var(--plat-color) 10%, transparent);
  }

  .repurpose-go {
    padding: 0.6rem 1.2rem;
    background: var(--gradient);
    border: none;
    border-radius: var(--radius-sm);
    color: #fff;
    font-weight: 600;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .repurpose-go:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ─── Responsive ─── */
  @media (max-width: 900px) {
    .forge-layout {
      grid-template-columns: 1fr;
    }

    .blueprint-panel {
      position: static;
    }

    .form-grid {
      grid-template-columns: 1fr;
    }

    .type-selector {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .page { padding: 1rem; }
  }
</style>
