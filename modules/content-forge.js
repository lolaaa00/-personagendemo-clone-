// ═══════════════════════════════════════════════════════════════
// PersonaGen Content Forge — Turn blueprints into production-
// ready content packages. Takes Channel Decoder blueprints or
// free-text topics and outputs full scripts, hooks, thumbnails,
// multi-platform adaptations, and hashtags.
// ═══════════════════════════════════════════════════════════════

const ContentForge = (() => {
  let container;
  let selectedAgent = null;
  let selectedBlueprint = null;
  let currentPackage = null;
  let inputMode = 'blueprint'; // 'blueprint' | 'topic'
  let isGenerating = false;
  let generationSeed = Date.now();

  const WEBHOOK_URL = 'https://auto.l2gseo.com/webhook/personagen-content-forge';

  // ─── HTML Escape ───
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Demo Content Package ───
  const DEMO_PACKAGE = {
    titles: [
      'Why 90% of Home Workouts Fail (And the 3-Minute Fix)',
      'I Trained Like a Navy SEAL for 30 Days — Here\'s What Broke',
      'The Morning Routine That Replaced My Gym Membership',
      'Stop Counting Calories. Do This Instead.',
      'Your Body Isn\'t Broken — Your Programming Is'
    ],
    hook: {
      type: 'Pattern Interrupt + Curiosity Gap',
      script: '"I spent $4,000 on personal trainers last year and got WORSE. Then I discovered something that changed everything — and it\'s completely free." *pause* "Let me show you the exact 3-minute protocol that outperformed every program I\'ve tried."',
      notes: 'Open with vulnerability + specific dollar amount for credibility. Curiosity gap created with "completely free" contrast. Direct address ("let me show you") builds intimacy.'
    },
    scriptOutline: [
      { section: 'Cold Open', duration: '0:00–0:08', content: 'Pattern interrupt — bold claim or relatable frustration. Visual: close-up face, raw/unfiltered look.' },
      { section: 'The Problem', duration: '0:08–0:25', content: 'Establish shared pain point. "You\'ve tried X, Y, Z and nothing sticks." Show B-roll of common mistakes.' },
      { section: 'The Shift', duration: '0:25–0:45', content: 'Reveal the insight. "The real problem isn\'t discipline — it\'s design." Transition visual to clean, structured format.' },
      { section: 'The Method', duration: '0:45–1:30', content: 'Walk through 3 actionable steps. Use numbered text overlays. Each step = one clear visual demonstration.' },
      { section: 'Proof', duration: '1:30–1:50', content: 'Show results — screenshots, before/after, testimonials. Keep it authentic, not polished.' },
      { section: 'CTA', duration: '1:50–2:00', content: '"Follow for the full 30-day breakdown. Save this and try step one TODAY." End on engagement hook.' }
    ],
    thumbnailBrief: {
      layout: 'Split composition — subject on left (2/3), bold text on right (1/3)',
      palette: ['#FF6B35', '#1A1A2E', '#FFFFFF'],
      textOverlay: '"The 3-Min Fix" in bold Impact/Bebas — large enough to read on mobile',
      expression: 'Surprised/intrigued face or mid-action shot',
      style: 'High contrast, slightly desaturated background, subject in vibrant color. NO cluttered elements.',
      reference: 'MrBeast / Ali Abdaal thumbnail energy — clean, bold, one focal point'
    },
    toneGuidance: {
      voice: 'Conversational authority — speak like a knowledgeable friend, not a lecturer',
      energy: 'High but controlled. Not screaming-YouTuber, more "I genuinely can\'t wait to tell you this."',
      vocabulary: 'Simple words, specific numbers. Replace "a lot" with "847 people". Replace "recently" with "last Tuesday."',
      avoid: ['Corporate jargon', 'Clickbait without payoff', 'Humble-bragging', 'Filler phrases like "in this video"'],
      embrace: ['Direct address ("you")', 'Specific timeframes', 'Vulnerability + authority combo', 'Pattern interrupts']
    },
    adaptations: {
      youtube: { format: 'Long-form (8–12 min) or Shorts (< 60s)', notes: 'Full script version. Add chapters for each section. Thumbnail is critical — test 3 variants.' },
      instagram: { format: 'Reel (60–90s) or Carousel (7–10 slides)', notes: 'Condense to key insight + 3 steps. Carousel: 1 idea per slide, bold headlines. Reel: fast cuts, text overlays.' },
      tiktok: { format: 'Video (30–60s)', notes: 'Lead with the hook IMMEDIATELY — no intro. Use trending audio if relevant. Stitch-friendly format. Green screen for proof section.' },
      x: { format: 'Thread (5–8 tweets) or single post', notes: 'Tweet 1 = hook as standalone insight. Each tweet = one complete thought. End with engagement question. Add relevant quote tweet.' }
    },
    hashtags: {
      primary: ['#FitnessMotivation', '#HomeWorkout', '#HealthyLifestyle', '#WorkoutRoutine'],
      secondary: ['#FitTok', '#GymTok', '#MorningRoutine', '#BodyTransformation'],
      niche: ['#3MinuteFix', '#NoGymNeeded', '#FitnessMyths', '#ConsistencyOverPerfection'],
      branded: ['#PersonaGen', '#AICreator']
    },
    meta: {
      blueprint: 'Fitness & Wellness Blueprint',
      agent: 'Sofia Rivera',
      generatedAt: new Date().toISOString(),
      seed: 'demo'
    }
  };

  // ─── Init ───
  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;

    if (typeof INFLUENCERS !== 'undefined' && INFLUENCERS.length > 0) {
      selectedAgent = INFLUENCERS[0];
    }

    currentPackage = DEMO_PACKAGE;
    render();
  }

  // ─── Main Render ───
  function render() {
    if (!container) return;

    container.innerHTML = `
      <style>${getStyles()}</style>
      <div class="cf-wrapper">
        <!-- Header -->
        <div class="cf-header">
          <div class="cf-header-text">
            <h3 class="cf-title">⚡ Content Forge</h3>
            <p class="cf-subtitle">Turn blueprints into production-ready content</p>
          </div>
          <div class="cf-header-badge">
            <span class="cf-badge cf-badge--active">
              <span class="cf-badge-dot"></span>
              ${currentPackage ? 'Package Ready' : 'Awaiting Input'}
            </span>
          </div>
        </div>

        <!-- Input Panel -->
        <div class="cf-input-panel">
          <!-- Mode Tabs -->
          <div class="cf-mode-tabs">
            <button class="cf-mode-tab ${inputMode === 'blueprint' ? 'active' : ''}"
                    onclick="ContentForge.setMode('blueprint')">
              📋 From Blueprint
            </button>
            <button class="cf-mode-tab ${inputMode === 'topic' ? 'active' : ''}"
                    onclick="ContentForge.setMode('topic')">
              ✏️ Free Topic
            </button>
          </div>

          <div class="cf-input-body">
            <!-- Blueprint Mode -->
            <div class="cf-input-field" id="cf-blueprint-field" style="display:${inputMode === 'blueprint' ? 'block' : 'none'}">
              <label class="cf-label">Channel Blueprint</label>
              <select class="cf-select" id="cf-blueprint-select" onchange="ContentForge.selectBlueprint(this.value)">
                <option value="">Select a saved blueprint...</option>
                ${getBlueprintOptions()}
              </select>
              <span class="cf-hint">Blueprints are saved from Channel Decoder analyses</span>
            </div>

            <!-- Topic Mode -->
            <div class="cf-input-field" id="cf-topic-field" style="display:${inputMode === 'topic' ? 'block' : 'none'}">
              <label class="cf-label">Content Topic</label>
              <input type="text" class="cf-text-input" id="cf-topic-input"
                     placeholder="e.g., Morning routine that replaced my gym membership"
                     value="">
            </div>

            <!-- Agent Selector -->
            <div class="cf-input-field">
              <label class="cf-label">Target Agent</label>
              <div class="cf-agent-chips" id="cf-agent-chips">
                ${renderAgentChips()}
              </div>
            </div>

            <!-- Generate Button -->
            <button class="cf-generate-btn" id="cf-generate-btn" onclick="ContentForge.generate()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              Generate Content Package
            </button>
          </div>
        </div>

        <!-- Package Output -->
        <div class="cf-package" id="cf-package">
          ${currentPackage ? renderPackage(currentPackage) : renderEmptyState()}
        </div>
      </div>
    `;
  }

  // ─── Render Helpers ───
  function getBlueprintOptions() {
    try {
      const blueprints = JSON.parse(localStorage.getItem('personagen_blueprints') || '[]');
      if (blueprints.length === 0) {
        return '<option value="" disabled>No blueprints saved yet — use Channel Decoder first</option>';
      }
      return blueprints.map((bp, i) => {
        const label = bp.channelName || bp.name || `Blueprint #${i + 1}`;
        const niche = bp.niche || bp.category || '';
        return `<option value="${i}">${esc(label)}${niche ? ' — ' + esc(niche) : ''}</option>`;
      }).join('');
    } catch {
      return '<option value="" disabled>No blueprints available</option>';
    }
  }

  function renderAgentChips() {
    const agents = (typeof INFLUENCERS !== 'undefined') ? INFLUENCERS : [];
    if (agents.length === 0) return '<span class="cf-hint">No agents loaded</span>';
    return agents.map((a, i) => `
      <button class="cf-agent-chip ${selectedAgent?.handle === a.handle ? 'active' : ''}"
              onclick="ContentForge.selectAgent('${a.handle}')">
        <div class="cf-agent-av" style="background:${a.gradient}">${a.initial}</div>
        <span>${a.name.split(' ')[0]}</span>
      </button>
    `).join('');
  }

  function renderEmptyState() {
    return `
      <div class="cf-empty">
        <span class="cf-empty-icon">🔨</span>
        <h4>No content package yet</h4>
        <p>Select a blueprint or enter a topic, choose an agent, and hit Generate.</p>
      </div>
    `;
  }

  // ─── Render Package ───
  function renderPackage(pkg) {
    return `
      <!-- Action Bar -->
      <div class="cf-action-bar">
        <button class="cf-action-btn cf-action--primary" onclick="ContentForge.openInComposer()">
          ✏️ Open in Composer
        </button>
        <button class="cf-action-btn" onclick="ContentForge.saveDraft()">
          💾 Save as Draft
        </button>
        <button class="cf-action-btn" onclick="ContentForge.copyScript()">
          📋 Copy Script
        </button>
        <button class="cf-action-btn" onclick="ContentForge.regenerate()">
          🔄 Regenerate
        </button>
      </div>

      <!-- Meta -->
      <div class="cf-meta-row">
        <span class="cf-meta-tag cf-tag--indigo">📋 ${esc(pkg.meta?.blueprint || 'Custom Topic')}</span>
        <span class="cf-meta-tag cf-tag--cyan">🤖 ${esc(pkg.meta?.agent || 'No Agent')}</span>
        <span class="cf-meta-tag cf-tag--dim">${new Date(pkg.meta?.generatedAt || Date.now()).toLocaleString()}</span>
      </div>

      <!-- Titles -->
      <div class="cf-section">
        <div class="cf-section-header">
          <span class="cf-section-icon" style="background:rgba(99,102,241,0.15);color:#a5b4fc;">🎯</span>
          <h4 class="cf-section-title">Title Options</h4>
          <span class="cf-section-count">${pkg.titles?.length || 0} variants</span>
        </div>
        <div class="cf-titles-list">
          ${(pkg.titles || []).map((t, i) => `
            <div class="cf-title-item">
              <span class="cf-title-num">${i + 1}</span>
              <span class="cf-title-text">${esc(t)}</span>
              <button class="cf-copy-mini" onclick="ContentForge.copyText('${esc(t).replace(/'/g, "\\'")}')" title="Copy">📋</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Hook -->
      <div class="cf-section">
        <div class="cf-section-header">
          <span class="cf-section-icon" style="background:rgba(236,72,153,0.15);color:#f9a8d4;">🪝</span>
          <h4 class="cf-section-title">Hook</h4>
          <span class="cf-section-badge">${esc(pkg.hook?.type || '')}</span>
        </div>
        <div class="cf-hook-card">
          <div class="cf-hook-script">${esc(pkg.hook?.script || '')}</div>
          ${pkg.hook?.notes ? `<div class="cf-hook-notes"><strong>Director's Notes:</strong> ${esc(pkg.hook.notes)}</div>` : ''}
        </div>
      </div>

      <!-- Script Outline -->
      <div class="cf-section">
        <div class="cf-section-header">
          <span class="cf-section-icon" style="background:rgba(6,182,212,0.15);color:#67e8f9;">📝</span>
          <h4 class="cf-section-title">Script Outline</h4>
          <span class="cf-section-count">${pkg.scriptOutline?.length || 0} sections</span>
        </div>
        <div class="cf-script-timeline">
          ${(pkg.scriptOutline || []).map((s, i) => `
            <div class="cf-script-block">
              <div class="cf-script-marker">
                <div class="cf-script-dot"></div>
                ${i < (pkg.scriptOutline.length - 1) ? '<div class="cf-script-line"></div>' : ''}
              </div>
              <div class="cf-script-content">
                <div class="cf-script-header">
                  <span class="cf-script-section">${esc(s.section)}</span>
                  <span class="cf-script-duration">${esc(s.duration)}</span>
                </div>
                <p class="cf-script-text">${esc(s.content)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Thumbnail Brief -->
      <div class="cf-section">
        <div class="cf-section-header">
          <span class="cf-section-icon" style="background:rgba(251,191,36,0.15);color:#fcd34d;">🖼️</span>
          <h4 class="cf-section-title">Thumbnail Brief</h4>
        </div>
        <div class="cf-thumb-grid">
          <div class="cf-thumb-item">
            <span class="cf-thumb-label">Layout</span>
            <span class="cf-thumb-value">${esc(pkg.thumbnailBrief?.layout || '')}</span>
          </div>
          <div class="cf-thumb-item">
            <span class="cf-thumb-label">Color Palette</span>
            <div class="cf-thumb-colors">
              ${(pkg.thumbnailBrief?.palette || []).map(c => `
                <span class="cf-color-chip" style="background:${c}" title="${c}"></span>
              `).join('')}
            </div>
          </div>
          <div class="cf-thumb-item">
            <span class="cf-thumb-label">Text Overlay</span>
            <span class="cf-thumb-value">${esc(pkg.thumbnailBrief?.textOverlay || '')}</span>
          </div>
          <div class="cf-thumb-item">
            <span class="cf-thumb-label">Expression</span>
            <span class="cf-thumb-value">${esc(pkg.thumbnailBrief?.expression || '')}</span>
          </div>
          <div class="cf-thumb-item cf-thumb-item--full">
            <span class="cf-thumb-label">Style Direction</span>
            <span class="cf-thumb-value">${esc(pkg.thumbnailBrief?.style || '')}</span>
          </div>
          ${pkg.thumbnailBrief?.reference ? `
          <div class="cf-thumb-item cf-thumb-item--full">
            <span class="cf-thumb-label">Reference</span>
            <span class="cf-thumb-value cf-thumb-ref">${esc(pkg.thumbnailBrief.reference)}</span>
          </div>` : ''}
        </div>
      </div>

      <!-- Tone Guidance -->
      <div class="cf-section">
        <div class="cf-section-header">
          <span class="cf-section-icon" style="background:rgba(52,211,153,0.15);color:#6ee7b7;">🎙️</span>
          <h4 class="cf-section-title">Tone Guidance</h4>
        </div>
        <div class="cf-tone-grid">
          <div class="cf-tone-card">
            <span class="cf-tone-label">Voice</span>
            <span class="cf-tone-value">${esc(pkg.toneGuidance?.voice || '')}</span>
          </div>
          <div class="cf-tone-card">
            <span class="cf-tone-label">Energy Level</span>
            <span class="cf-tone-value">${esc(pkg.toneGuidance?.energy || '')}</span>
          </div>
          <div class="cf-tone-card cf-tone-card--full">
            <span class="cf-tone-label">Vocabulary</span>
            <span class="cf-tone-value">${esc(pkg.toneGuidance?.vocabulary || '')}</span>
          </div>
          ${pkg.toneGuidance?.avoid?.length ? `
          <div class="cf-tone-card">
            <span class="cf-tone-label">❌ Avoid</span>
            <div class="cf-tone-list cf-tone-list--avoid">
              ${pkg.toneGuidance.avoid.map(a => `<span class="cf-tone-chip cf-tone-chip--avoid">${esc(a)}</span>`).join('')}
            </div>
          </div>` : ''}
          ${pkg.toneGuidance?.embrace?.length ? `
          <div class="cf-tone-card">
            <span class="cf-tone-label">✅ Embrace</span>
            <div class="cf-tone-list cf-tone-list--embrace">
              ${pkg.toneGuidance.embrace.map(e => `<span class="cf-tone-chip cf-tone-chip--embrace">${esc(e)}</span>`).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>

      <!-- Multi-Platform Adaptations -->
      <div class="cf-section">
        <div class="cf-section-header">
          <span class="cf-section-icon" style="background:rgba(139,92,246,0.15);color:#c4b5fd;">📱</span>
          <h4 class="cf-section-title">Multi-Platform Adaptations</h4>
        </div>
        <div class="cf-adapt-grid">
          ${renderAdaptations(pkg.adaptations)}
        </div>
      </div>

      <!-- Hashtags & Tags -->
      <div class="cf-section">
        <div class="cf-section-header">
          <span class="cf-section-icon" style="background:rgba(244,63,94,0.15);color:#fda4af;">#️⃣</span>
          <h4 class="cf-section-title">Hashtags & Tags</h4>
          <button class="cf-copy-mini" onclick="ContentForge.copyHashtags()" title="Copy all hashtags">📋 Copy All</button>
        </div>
        <div class="cf-tags-container">
          ${renderHashtagGroup('Primary', pkg.hashtags?.primary, 'cf-ht--primary')}
          ${renderHashtagGroup('Secondary', pkg.hashtags?.secondary, 'cf-ht--secondary')}
          ${renderHashtagGroup('Niche', pkg.hashtags?.niche, 'cf-ht--niche')}
          ${renderHashtagGroup('Branded', pkg.hashtags?.branded, 'cf-ht--branded')}
        </div>
      </div>
    `;
  }

  function renderAdaptations(adaptations) {
    if (!adaptations) return '<span class="cf-hint">No adaptations generated</span>';
    const platformIcons = {
      youtube: '📺', instagram: '📸', tiktok: '🎵', x: '𝕏',
      linkedin: '💼', threads: '🧵', reddit: '⬆'
    };
    const platformColors = {
      youtube: '#FF0000', instagram: '#E1306C', tiktok: '#000000',
      x: '#14171a', linkedin: '#0A66C2', threads: '#000000', reddit: '#FF4500'
    };
    return Object.entries(adaptations).map(([platform, data]) => `
      <div class="cf-adapt-card">
        <div class="cf-adapt-header">
          <span class="cf-adapt-icon" style="background:${platformColors[platform] || '#333'}">${platformIcons[platform] || '📱'}</span>
          <span class="cf-adapt-name">${platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
        </div>
        <div class="cf-adapt-format">${esc(data.format)}</div>
        <p class="cf-adapt-notes">${esc(data.notes)}</p>
      </div>
    `).join('');
  }

  function renderHashtagGroup(label, tags, cls) {
    if (!tags || tags.length === 0) return '';
    return `
      <div class="cf-ht-group">
        <span class="cf-ht-label">${label}</span>
        <div class="cf-ht-tags">
          ${tags.map(t => `<span class="cf-ht-tag ${cls}">${esc(t)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  // ─── Mode Switching ───
  function setMode(mode) {
    inputMode = mode;
    const bpField = document.getElementById('cf-blueprint-field');
    const topicField = document.getElementById('cf-topic-field');
    if (bpField) bpField.style.display = mode === 'blueprint' ? 'block' : 'none';
    if (topicField) topicField.style.display = mode === 'topic' ? 'block' : 'none';

    document.querySelectorAll('.cf-mode-tab').forEach(tab => {
      tab.classList.toggle('active', tab.textContent.includes(mode === 'blueprint' ? 'Blueprint' : 'Topic'));
    });
  }

  // ─── Selections ───
  function selectAgent(handle) {
    selectedAgent = (typeof INFLUENCERS !== 'undefined')
      ? INFLUENCERS.find(i => i.handle === handle) || INFLUENCERS[0]
      : null;
    document.querySelectorAll('.cf-agent-chip').forEach(chip => {
      const isMatch = chip.querySelector('.cf-agent-av')?.parentElement?.onclick?.toString().includes(handle);
      chip.classList.remove('active');
    });
    // Re-render just the chips
    const chipsEl = document.getElementById('cf-agent-chips');
    if (chipsEl) chipsEl.innerHTML = renderAgentChips();
  }

  function selectBlueprint(index) {
    try {
      const blueprints = JSON.parse(localStorage.getItem('personagen_blueprints') || '[]');
      selectedBlueprint = blueprints[parseInt(index)] || null;
    } catch {
      selectedBlueprint = null;
    }
  }

  // ─── Generation ───
  async function generate() {
    if (isGenerating) return;

    const topic = inputMode === 'topic'
      ? document.getElementById('cf-topic-input')?.value?.trim()
      : null;
    const blueprint = inputMode === 'blueprint' ? selectedBlueprint : null;

    if (inputMode === 'topic' && !topic) {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Enter a topic to generate content', 'warning');
      return;
    }
    if (inputMode === 'blueprint' && !blueprint) {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Select a blueprint first', 'warning');
      return;
    }

    isGenerating = true;
    generationSeed = Date.now();
    const btn = document.getElementById('cf-generate-btn');
    if (btn) {
      btn.innerHTML = '<div class="cf-spinner"></div> Forging content package...';
      btn.disabled = true;
    }

    try {
      const result = await generatePackage(blueprint, topic, selectedAgent);
      if (result) {
        currentPackage = result;
        if (typeof PersonaGenAPI !== 'undefined') {
          PersonaGenAPI.showToast('Content package generated!', 'success');
        }
      }
    } catch (err) {
      console.error('[ContentForge] Generation failed:', err);
      currentPackage = generateLocalPackage(blueprint, topic, selectedAgent);
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Generated locally — API unavailable', 'info');
      }
    } finally {
      isGenerating = false;
    }

    render();
  }

  async function generatePackage(blueprint, topic, agent) {
    try {
      const resp = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          blueprint: blueprint || null,
          topic: topic || null,
          agentHandle: agent?.handle || null,
          ts: Date.now()
        })
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      if (data.success && data.package) {
        return {
          ...data.package,
          meta: {
            blueprint: blueprint?.channelName || topic || 'API Generated',
            agent: agent?.name || 'Unknown',
            generatedAt: new Date().toISOString(),
            seed: generationSeed.toString()
          }
        };
      }
      throw new Error('Invalid API response');
    } catch (err) {
      console.warn('[ContentForge] API failed, falling back to local generation:', err);
      return generateLocalPackage(blueprint, topic, agent);
    }
  }

  // ─── Local Fallback Generator ───
  function generateLocalPackage(blueprint, topic, agent) {
    const seed = generationSeed;
    const niche = blueprint?.niche || agent?.niche || 'General';
    const subject = topic || blueprint?.channelName || niche;
    const agentName = agent?.name || 'AI Creator';

    const titleTemplates = [
      `Why 90% of People Get ${subject} Wrong (And the Simple Fix)`,
      `I Tried ${subject} for 30 Days — Here's What Nobody Tells You`,
      `The ${subject} Strategy That Changed Everything`,
      `Stop Doing ${subject} Like This. Here's What Works.`,
      `${subject}: The Complete Breakdown You Actually Need`
    ];

    const shuffled = titleTemplates.sort(() => Math.sin(seed + Math.random()) - 0.5);

    return {
      titles: shuffled.slice(0, 4 + Math.floor((seed % 2))),
      hook: {
        type: 'Curiosity Gap + Authority',
        script: `"Everyone's talking about ${subject.toLowerCase()} but almost nobody actually understands how it works. I've spent the last 6 months testing every method out there, and I'm about to save you hundreds of hours." *beat* "Here's exactly what you need to know."`,
        notes: `Opens with contrarian framing to stop the scroll. Specific timeframe (6 months) builds authority. Promise of saved time = instant value proposition.`
      },
      scriptOutline: [
        { section: 'Hook', duration: '0:00–0:05', content: `Bold opening statement about ${subject.toLowerCase()}. Visual: dynamic intro, face-to-camera.` },
        { section: 'Context', duration: '0:05–0:20', content: `Why this matters NOW. Reference current trends in ${niche.toLowerCase()}. Quick montage of the problem.` },
        { section: 'Key Insight', duration: '0:20–0:45', content: `The core revelation. What makes this approach different. Use visual metaphor or analogy.` },
        { section: 'Walkthrough', duration: '0:45–1:30', content: `Step-by-step breakdown. 3 actionable points with text overlays. Show, don't just tell.` },
        { section: 'Social Proof', duration: '1:30–1:45', content: `Results, data, or testimonials. Screenshots or B-roll of real outcomes.` },
        { section: 'Call to Action', duration: '1:45–2:00', content: `"Follow for part 2" or "Save this for later." End with engagement question.` }
      ],
      thumbnailBrief: {
        layout: 'Subject centered, bold text above/below — mobile-first composition',
        palette: ['#6366F1', '#0F0F1A', '#FFFFFF'],
        textOverlay: `"${subject}" in bold sans-serif — readable at 100px width`,
        expression: 'Confident direct eye contact or action shot',
        style: 'Dark background, accent color highlight on subject. Clean, minimal, high contrast.',
        reference: `Match the visual energy of top ${niche.toLowerCase()} creators — authority + approachability`
      },
      toneGuidance: {
        voice: `Channel ${agentName}'s persona — ${agent?.soul?.includes('Warm') ? 'warm and encouraging' : agent?.soul?.includes('Sharp') ? 'sharp and analytical' : 'conversational yet authoritative'}`,
        energy: 'Authentic enthusiasm — like sharing a discovery with a close friend',
        vocabulary: `${niche}-native terminology mixed with accessible language. Be specific: numbers, dates, names.`,
        avoid: ['Clickbait without substance', 'Over-explaining basics', 'Generic filler phrases', 'Competitor bashing'],
        embrace: ['Specific data points', 'Personal experience', '"You" language', 'Open loops between sections']
      },
      adaptations: {
        youtube: { format: 'Long-form (6–10 min) or Shorts (< 60s)', notes: `Full walkthrough version with chapters. Strong thumbnail with "${subject}" hook. Pin top comment with resources.` },
        instagram: { format: 'Reel (60–90s) or Carousel (8 slides)', notes: `Carousel: slide 1 = hook question, slides 2–7 = one point each, slide 8 = CTA. Reel: fast-cut version with text overlays.` },
        tiktok: { format: 'Video (15–60s)', notes: `Skip all preamble — open with the hook directly. Use trending audio as bed. Optimize for stitch/duet responses.` },
        x: { format: 'Thread (5–7 tweets)', notes: `Tweet 1 = standalone insight (must work alone). Each subsequent tweet = one key point. Final tweet = question + follow CTA.` }
      },
      hashtags: {
        primary: generateHashtags(subject, 4),
        secondary: generateHashtags(niche, 4),
        niche: [`#${subject.replace(/\s+/g, '')}Tips`, `#${niche.replace(/[\s&]+/g, '')}Content`, '#CreatorEconomy'],
        branded: ['#PersonaGen', '#AICreator']
      },
      meta: {
        blueprint: blueprint?.channelName || subject,
        agent: agentName,
        generatedAt: new Date().toISOString(),
        seed: seed.toString()
      }
    };
  }

  function generateHashtags(text, count) {
    const words = text.split(/[\s&,]+/).filter(w => w.length > 2);
    const tags = [];
    const bases = [...words.slice(0, 3), text.replace(/\s+/g, '')];
    bases.forEach(w => {
      if (tags.length < count) tags.push('#' + w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    });
    while (tags.length < count) tags.push('#Content' + tags.length);
    return tags.slice(0, count);
  }

  // ─── Action Buttons ───
  function openInComposer() {
    if (!currentPackage) return;

    const scriptText = buildFullScript();
    const allTags = [
      ...(currentPackage.hashtags?.primary || []),
      ...(currentPackage.hashtags?.secondary || []),
      ...(currentPackage.hashtags?.niche || [])
    ];

    if (typeof PostComposer !== 'undefined') {
      PostComposer.open({
        content: { text: scriptText, hashtags: allTags }
      });
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Content loaded into Composer', 'success');
      }
    } else {
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Post Composer not available', 'warning');
      }
    }
  }

  function saveDraft() {
    if (!currentPackage) return;
    const scriptText = buildFullScript();
    const post = {
      id: (typeof PersonaGenAPI !== 'undefined') ? PersonaGenAPI.Local.uuid() : 'cf_' + Date.now(),
      persona_id: selectedAgent?.handle || 'unknown',
      persona_name: selectedAgent?.name || 'Content Forge',
      persona_initial: selectedAgent?.initial || 'C',
      persona_gradient: selectedAgent?.gradient || 'linear-gradient(135deg, #6366f1, #ec4899)',
      platforms: Object.keys(currentPackage.adaptations || {}),
      content: {
        text: scriptText,
        hashtags: [
          ...(currentPackage.hashtags?.primary || []),
          ...(currentPackage.hashtags?.secondary || [])
        ],
        media_url: null,
        privacy: 'public'
      },
      status: 'draft',
      created_at: new Date().toISOString(),
      generation_source: 'content-forge',
      forge_package: currentPackage
    };

    if (typeof PersonaGenAPI !== 'undefined') {
      PersonaGenAPI.Local.savePost(post);
      PersonaGenAPI.showToast('Draft saved!', 'success');
    }
  }

  function copyScript() {
    if (!currentPackage) return;
    const text = buildFullScript();
    navigator.clipboard.writeText(text).then(() => {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Script copied to clipboard', 'success');
    }).catch(() => {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Copy failed — try manually', 'warning');
    });
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Copied!', 'success');
    }).catch(() => {});
  }

  function copyHashtags() {
    if (!currentPackage?.hashtags) return;
    const all = [
      ...(currentPackage.hashtags.primary || []),
      ...(currentPackage.hashtags.secondary || []),
      ...(currentPackage.hashtags.niche || []),
      ...(currentPackage.hashtags.branded || [])
    ].join(' ');
    navigator.clipboard.writeText(all).then(() => {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('All hashtags copied!', 'success');
    }).catch(() => {});
  }

  function regenerate() {
    generationSeed = Date.now();
    generate();
  }

  function buildFullScript() {
    if (!currentPackage) return '';
    const lines = [];
    const title = currentPackage.titles?.[0] || 'Untitled';
    lines.push(`📌 TITLE: ${title}\n`);

    if (currentPackage.hook?.script) {
      lines.push(`🪝 HOOK:\n${currentPackage.hook.script}\n`);
    }

    if (currentPackage.scriptOutline?.length) {
      lines.push('📝 SCRIPT OUTLINE:');
      currentPackage.scriptOutline.forEach(s => {
        lines.push(`[${s.duration}] ${s.section}: ${s.content}`);
      });
      lines.push('');
    }

    if (currentPackage.toneGuidance?.voice) {
      lines.push(`🎙️ TONE: ${currentPackage.toneGuidance.voice}\n`);
    }

    const allTags = [
      ...(currentPackage.hashtags?.primary || []),
      ...(currentPackage.hashtags?.secondary || []),
      ...(currentPackage.hashtags?.niche || [])
    ];
    if (allTags.length) {
      lines.push(`#️⃣ HASHTAGS: ${allTags.join(' ')}`);
    }

    return lines.join('\n');
  }

  // ─── External Entry Points ───
  function forgeFromBlueprint(blueprint) {
    selectedBlueprint = blueprint;
    inputMode = 'blueprint';
    currentPackage = null;
    render();
    generate();
  }

  function forgeFromTrend(trendTopic) {
    inputMode = 'topic';
    currentPackage = null;
    render();
    setTimeout(() => {
      const input = document.getElementById('cf-topic-input');
      if (input) input.value = trendTopic;
      generate();
    }, 100);
  }

  // ─── Styles ───
  function getStyles() {
    return `
      .cf-wrapper { max-width: 100%; }

      .cf-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 1.5rem; gap: 1rem; flex-wrap: wrap;
      }
      .cf-title {
        font-size: 1.35rem; font-weight: 800; color: rgba(255,255,255,0.92);
        margin: 0; letter-spacing: -0.02em;
      }
      .cf-subtitle {
        font-size: 0.82rem; color: rgba(255,255,255,0.4); margin: 4px 0 0;
      }
      .cf-badge {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.06em; padding: 5px 12px; border-radius: 20px;
        background: rgba(99,102,241,0.1); color: #a5b4fc;
        border: 1px solid rgba(99,102,241,0.2);
      }
      .cf-badge-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #34d399; animation: cf-pulse 2s infinite;
      }
      @keyframes cf-pulse {
        0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
      }

      /* Input Panel */
      .cf-input-panel {
        background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
        border-radius: 16px; padding: 1.25rem; margin-bottom: 1.5rem;
        backdrop-filter: blur(12px);
      }
      .cf-mode-tabs {
        display: flex; gap: 4px; margin-bottom: 1rem;
        background: rgba(255,255,255,0.03); border-radius: 10px; padding: 3px;
      }
      .cf-mode-tab {
        flex: 1; padding: 8px 16px; border: none; border-radius: 8px;
        background: transparent; color: rgba(255,255,255,0.4);
        font-size: 0.82rem; font-weight: 600; cursor: pointer;
        transition: all 0.2s ease;
      }
      .cf-mode-tab:hover { color: rgba(255,255,255,0.6); }
      .cf-mode-tab.active {
        background: rgba(99,102,241,0.15); color: #a5b4fc;
        box-shadow: 0 2px 8px rgba(99,102,241,0.1);
      }
      .cf-input-body { display: flex; flex-direction: column; gap: 1rem; }
      .cf-input-field { display: flex; flex-direction: column; gap: 6px; }
      .cf-label {
        font-size: 0.75rem; font-weight: 600; color: rgba(255,255,255,0.5);
        text-transform: uppercase; letter-spacing: 0.05em;
      }
      .cf-select, .cf-text-input {
        width: 100%; padding: 10px 14px; border-radius: 10px;
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
        color: rgba(255,255,255,0.85); font-size: 0.88rem;
        outline: none; transition: border-color 0.2s;
      }
      .cf-select:focus, .cf-text-input:focus {
        border-color: rgba(99,102,241,0.5);
      }
      .cf-select option { background: #1a1a2e; color: #fff; }
      .cf-hint { font-size: 0.72rem; color: rgba(255,255,255,0.25); }

      /* Agent Chips */
      .cf-agent-chips { display: flex; gap: 8px; flex-wrap: wrap; }
      .cf-agent-chip {
        display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 6px;
        border-radius: 24px; border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.6);
        font-size: 0.8rem; font-weight: 500; cursor: pointer;
        transition: all 0.2s ease;
      }
      .cf-agent-chip:hover { border-color: rgba(255,255,255,0.15); }
      .cf-agent-chip.active {
        border-color: rgba(99,102,241,0.4); background: rgba(99,102,241,0.1);
        color: #c7d2fe;
      }
      .cf-agent-av {
        width: 26px; height: 26px; border-radius: 50%; display: flex;
        align-items: center; justify-content: center; font-size: 0.7rem;
        font-weight: 700; color: #fff; flex-shrink: 0;
      }

      /* Generate Button */
      .cf-generate-btn {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        width: 100%; padding: 12px 24px; border-radius: 12px;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff; font-size: 0.9rem; font-weight: 700; border: none;
        cursor: pointer; transition: all 0.25s ease;
        box-shadow: 0 4px 16px rgba(99,102,241,0.25);
      }
      .cf-generate-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 24px rgba(99,102,241,0.35);
      }
      .cf-generate-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .cf-spinner {
        width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff; border-radius: 50%;
        animation: cf-spin 0.7s linear infinite;
      }
      @keyframes cf-spin { to { transform: rotate(360deg); } }

      /* Empty State */
      .cf-empty {
        text-align: center; padding: 3rem 1rem; color: rgba(255,255,255,0.3);
      }
      .cf-empty-icon { font-size: 2.5rem; display: block; margin-bottom: 0.75rem; }
      .cf-empty h4 { color: rgba(255,255,255,0.5); margin: 0 0 0.5rem; }
      .cf-empty p { font-size: 0.82rem; margin: 0; }

      /* Action Bar */
      .cf-action-bar {
        display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.25rem;
        padding: 12px; background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;
      }
      .cf-action-btn {
        padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.6);
        font-size: 0.78rem; font-weight: 600; cursor: pointer;
        transition: all 0.2s ease;
      }
      .cf-action-btn:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85); }
      .cf-action--primary {
        background: rgba(99,102,241,0.15); color: #a5b4fc;
        border-color: rgba(99,102,241,0.25);
      }
      .cf-action--primary:hover {
        background: rgba(99,102,241,0.25);
      }

      /* Meta Row */
      .cf-meta-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.25rem; }
      .cf-meta-tag {
        font-size: 0.72rem; font-weight: 600; padding: 4px 12px;
        border-radius: 16px; display: inline-flex; align-items: center; gap: 4px;
      }
      .cf-tag--indigo { background: rgba(99,102,241,0.1); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.15); }
      .cf-tag--cyan { background: rgba(6,182,212,0.1); color: #67e8f9; border: 1px solid rgba(6,182,212,0.15); }
      .cf-tag--dim { background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.06); }

      /* Sections */
      .cf-section {
        margin-bottom: 1.25rem; padding: 1.25rem;
        background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
        border-radius: 14px; transition: border-color 0.2s;
      }
      .cf-section:hover { border-color: rgba(255,255,255,0.1); }
      .cf-section-header {
        display: flex; align-items: center; gap: 10px; margin-bottom: 1rem;
      }
      .cf-section-icon {
        width: 32px; height: 32px; border-radius: 8px; display: flex;
        align-items: center; justify-content: center; font-size: 0.9rem;
        flex-shrink: 0;
      }
      .cf-section-title {
        font-size: 0.95rem; font-weight: 700; color: rgba(255,255,255,0.85);
        margin: 0; flex: 1;
      }
      .cf-section-count {
        font-size: 0.7rem; color: rgba(255,255,255,0.3); font-weight: 500;
      }
      .cf-section-badge {
        font-size: 0.68rem; padding: 3px 10px; border-radius: 12px;
        background: rgba(236,72,153,0.1); color: #f9a8d4;
        border: 1px solid rgba(236,72,153,0.15); font-weight: 500;
      }

      /* Titles */
      .cf-titles-list { display: flex; flex-direction: column; gap: 6px; }
      .cf-title-item {
        display: flex; align-items: center; gap: 12px; padding: 10px 14px;
        background: rgba(255,255,255,0.02); border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.04);
        transition: background 0.15s;
      }
      .cf-title-item:hover { background: rgba(255,255,255,0.04); }
      .cf-title-num {
        width: 24px; height: 24px; border-radius: 6px; display: flex;
        align-items: center; justify-content: center; font-size: 0.7rem;
        font-weight: 700; background: rgba(99,102,241,0.15); color: #a5b4fc;
        flex-shrink: 0;
      }
      .cf-title-text {
        flex: 1; font-size: 0.88rem; color: rgba(255,255,255,0.8);
        font-weight: 500;
      }
      .cf-copy-mini {
        width: 28px; height: 28px; border-radius: 6px; border: none;
        background: transparent; cursor: pointer; font-size: 0.75rem;
        opacity: 0.3; transition: opacity 0.15s; display: flex;
        align-items: center; justify-content: center;
      }
      .cf-copy-mini:hover { opacity: 0.8; }

      /* Hook */
      .cf-hook-card {
        background: rgba(236,72,153,0.04); border: 1px solid rgba(236,72,153,0.1);
        border-radius: 12px; padding: 1rem; border-left: 3px solid rgba(236,72,153,0.4);
      }
      .cf-hook-script {
        font-size: 0.88rem; color: rgba(255,255,255,0.8);
        line-height: 1.65; font-style: italic; margin-bottom: 0.75rem;
      }
      .cf-hook-notes {
        font-size: 0.76rem; color: rgba(255,255,255,0.4); line-height: 1.5;
        padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.05);
      }

      /* Script Timeline */
      .cf-script-timeline { display: flex; flex-direction: column; }
      .cf-script-block { display: flex; gap: 14px; min-height: 60px; }
      .cf-script-marker {
        display: flex; flex-direction: column; align-items: center;
        width: 20px; flex-shrink: 0; padding-top: 6px;
      }
      .cf-script-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--cyan, #06b6d4); flex-shrink: 0;
        box-shadow: 0 0 8px rgba(6,182,212,0.3);
      }
      .cf-script-line {
        width: 2px; flex: 1; background: rgba(6,182,212,0.15);
        margin: 4px 0;
      }
      .cf-script-content {
        flex: 1; padding-bottom: 1rem;
      }
      .cf-script-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 4px;
      }
      .cf-script-section {
        font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.75);
      }
      .cf-script-duration {
        font-size: 0.7rem; color: rgba(6,182,212,0.7); font-weight: 600;
        font-family: monospace;
      }
      .cf-script-text {
        font-size: 0.8rem; color: rgba(255,255,255,0.5); line-height: 1.55;
        margin: 0;
      }

      /* Thumbnail */
      .cf-thumb-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      }
      .cf-thumb-item {
        padding: 12px; background: rgba(255,255,255,0.02);
        border-radius: 10px; border: 1px solid rgba(255,255,255,0.04);
      }
      .cf-thumb-item--full { grid-column: 1 / -1; }
      .cf-thumb-label {
        display: block; font-size: 0.68rem; font-weight: 600;
        color: rgba(255,255,255,0.35); text-transform: uppercase;
        letter-spacing: 0.04em; margin-bottom: 4px;
      }
      .cf-thumb-value {
        font-size: 0.82rem; color: rgba(255,255,255,0.7); line-height: 1.5;
      }
      .cf-thumb-ref { font-style: italic; color: rgba(251,191,36,0.7); }
      .cf-thumb-colors { display: flex; gap: 6px; margin-top: 4px; }
      .cf-color-chip {
        width: 28px; height: 28px; border-radius: 6px;
        border: 2px solid rgba(255,255,255,0.1);
      }

      /* Tone */
      .cf-tone-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      }
      .cf-tone-card {
        padding: 12px; background: rgba(255,255,255,0.02);
        border-radius: 10px; border: 1px solid rgba(255,255,255,0.04);
      }
      .cf-tone-card--full { grid-column: 1 / -1; }
      .cf-tone-label {
        display: block; font-size: 0.68rem; font-weight: 600;
        color: rgba(255,255,255,0.35); text-transform: uppercase;
        letter-spacing: 0.04em; margin-bottom: 4px;
      }
      .cf-tone-value {
        font-size: 0.82rem; color: rgba(255,255,255,0.7); line-height: 1.5;
      }
      .cf-tone-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .cf-tone-chip {
        font-size: 0.72rem; padding: 3px 10px; border-radius: 12px;
        font-weight: 500;
      }
      .cf-tone-chip--avoid {
        background: rgba(244,63,94,0.1); color: #fda4af;
        border: 1px solid rgba(244,63,94,0.15);
      }
      .cf-tone-chip--embrace {
        background: rgba(52,211,153,0.1); color: #6ee7b7;
        border: 1px solid rgba(52,211,153,0.15);
      }

      /* Adaptations */
      .cf-adapt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .cf-adapt-card {
        padding: 14px; background: rgba(255,255,255,0.02);
        border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);
        transition: border-color 0.15s;
      }
      .cf-adapt-card:hover { border-color: rgba(255,255,255,0.1); }
      .cf-adapt-header {
        display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
      }
      .cf-adapt-icon {
        width: 24px; height: 24px; border-radius: 6px; display: flex;
        align-items: center; justify-content: center; font-size: 0.7rem;
        color: #fff; flex-shrink: 0;
      }
      .cf-adapt-name {
        font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.75);
      }
      .cf-adapt-format {
        font-size: 0.72rem; color: rgba(139,92,246,0.8); font-weight: 600;
        margin-bottom: 6px;
      }
      .cf-adapt-notes {
        font-size: 0.78rem; color: rgba(255,255,255,0.45); line-height: 1.5;
        margin: 0;
      }

      /* Hashtags */
      .cf-tags-container { display: flex; flex-direction: column; gap: 12px; }
      .cf-ht-group { display: flex; flex-direction: column; gap: 6px; }
      .cf-ht-label {
        font-size: 0.68rem; font-weight: 600; color: rgba(255,255,255,0.3);
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      .cf-ht-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .cf-ht-tag {
        font-size: 0.76rem; font-weight: 500; padding: 4px 12px;
        border-radius: 14px;
      }
      .cf-ht--primary { background: rgba(99,102,241,0.12); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.15); }
      .cf-ht--secondary { background: rgba(6,182,212,0.1); color: #67e8f9; border: 1px solid rgba(6,182,212,0.12); }
      .cf-ht--niche { background: rgba(236,72,153,0.1); color: #f9a8d4; border: 1px solid rgba(236,72,153,0.12); }
      .cf-ht--branded { background: rgba(251,191,36,0.1); color: #fcd34d; border: 1px solid rgba(251,191,36,0.12); }

      /* Responsive */
      @media (max-width: 640px) {
        .cf-thumb-grid, .cf-tone-grid, .cf-adapt-grid { grid-template-columns: 1fr; }
        .cf-action-bar { flex-direction: column; }
        .cf-action-btn { width: 100%; text-align: center; }
      }
    `;
  }

  // ─── Public API ───
  return {
    init,
    setMode,
    selectAgent,
    selectBlueprint,
    generate,
    regenerate,
    openInComposer,
    saveDraft,
    copyScript,
    copyText,
    copyHashtags,
    forgeFromBlueprint,
    forgeFromTrend
  };
})();

// Auto-init on page load
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('content-forge-mount');
  if (mount && !mount.hasChildNodes()) {
    ContentForge.init('content-forge-mount');
  }
});
