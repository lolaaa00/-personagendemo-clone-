// ═══════════════════════════════════════════════════════════════
// PersonaGen Brand Brief Interview — Multi-step onboarding wizard
// Crawls website, collects brand identity, generates AI personas
// ═══════════════════════════════════════════════════════════════

const BrandBrief = (() => {
  let container;
  let currentStep = 0;
  let briefData = {};
  let crawlData = null;
  let isLoading = false;
  const TOTAL_STEPS = 8;
  const STORAGE_KEY = 'pg_brand_brief_draft';

  // Dedicated webhook endpoints for brand brief workflows
  const N8N_BASE = (typeof PersonaGenConfig !== 'undefined' && PersonaGenConfig.webhook_url)
    ? PersonaGenConfig.webhook_url.replace(/\/[^\/]*$/, '')
    : 'https://auto.l2gseo.com/webhook';
  const CRAWL_URL = N8N_BASE + '/brand-brief-crawl';
  const ASSESS_URL = N8N_BASE + '/brand-brief-assess';

  // Step definitions
  const steps = [
    { id: 'crawl', title: 'Website Analysis', icon: '🔍', desc: 'Enter your website URL to auto-detect brand elements' },
    { id: 'identity', title: 'Brand Identity', icon: '🏢', desc: 'Company name, mission, products & services' },
    { id: 'visual', title: 'Visual Identity', icon: '🎨', desc: 'Colors, typography, and logo' },
    { id: 'voice', title: 'Brand Voice', icon: '🗣️', desc: 'Tone, language, and messaging style' },
    { id: 'audience', title: 'Target Audience', icon: '🎯', desc: 'Demographics, markets, and pain points' },
    { id: 'platforms', title: 'Platform Strategy', icon: '📱', desc: 'Platform priorities and content cadence' },
    { id: 'personas', title: 'Persona Archetypes', icon: '🤖', desc: 'AI creator profiles for your brand' },
    { id: 'review', title: 'Review & Submit', icon: '✅', desc: 'Confirm your brief and get viability assessment' }
  ];

  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;

    // Load saved draft
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { briefData = JSON.parse(saved); } catch(e) {}
    }

    render();
  }

  function saveDraft() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(briefData));
  }

  function render() {
    container.innerHTML = `
      <div class="bb-container">
        <div class="bb-progress">
          ${steps.map((s, i) => `
            <div class="bb-step-dot ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}"
                 onclick="BrandBrief.goToStep(${i})" title="${s.title}">
              <span>${i < currentStep ? '✓' : s.icon}</span>
            </div>
            ${i < steps.length - 1 ? '<div class="bb-step-line ' + (i < currentStep ? 'done' : '') + '"></div>' : ''}
          `).join('')}
        </div>

        <div class="bb-header">
          <h3 class="bb-title">${steps[currentStep].icon} ${steps[currentStep].title}</h3>
          <p class="bb-desc">${steps[currentStep].desc}</p>
          <span class="bb-step-label">Step ${currentStep + 1} of ${TOTAL_STEPS}</span>
        </div>

        <div class="bb-content">
          ${renderStep(currentStep)}
        </div>

        <div class="bb-nav">
          ${currentStep > 0 ? '<button class="bb-btn bb-btn-back" onclick="BrandBrief.prev()">← Back</button>' : '<div></div>'}
          ${currentStep < TOTAL_STEPS - 1
            ? '<button class="bb-btn bb-btn-next" onclick="BrandBrief.next()">Next →</button>'
            : '<button class="bb-btn bb-btn-submit" onclick="BrandBrief.submit()">Submit Brief & Get Assessment</button>'
          }
        </div>
      </div>
    `;
  }

  function renderStep(step) {
    switch(step) {
      case 0: return renderCrawlStep();
      case 1: return renderIdentityStep();
      case 2: return renderVisualStep();
      case 3: return renderVoiceStep();
      case 4: return renderAudienceStep();
      case 5: return renderPlatformStep();
      case 6: return renderPersonaStep();
      case 7: return renderReviewStep();
      default: return '';
    }
  }

  // ── Step 0: Website Crawl ──
  function renderCrawlStep() {
    const detected = crawlData ? true : false;
    return `
      <div class="bb-card">
        <label class="bb-label">Your Website URL</label>
        <div class="bb-crawl-row">
          <input type="url" class="bb-input" id="bb-url" placeholder="https://yourwebsite.com"
                 value="${briefData.websiteUrl || ''}">
          <button class="bb-btn bb-btn-analyze" onclick="BrandBrief.crawl()" ${isLoading ? 'disabled' : ''}>
            ${isLoading ? '<span class="bb-spinner"></span> Analyzing...' : '🔍 Analyze Brand'}
          </button>
        </div>
        ${detected ? `
          <div class="bb-detected-badge">
            <span>✨</span> Brand data auto-detected! We found colors, fonts, and brand voice from your site.
          </div>
          <div class="bb-crawl-preview">
            <div class="bb-preview-section">
              <h4>Colors Found</h4>
              <div class="bb-color-row">
                ${(crawlData.crawl?.colors ? Object.entries(crawlData.crawl.colors).map(([k,v]) =>
                  `<div class="bb-color-chip"><div class="bb-color-swatch" style="background:${v}"></div><span>${k}</span></div>`
                ).join('') : '<span class="bb-muted">None detected</span>')}
              </div>
            </div>
            <div class="bb-preview-section">
              <h4>Typography</h4>
              <span>${crawlData.crawl?.typography?.headings || 'Not detected'} / ${crawlData.crawl?.typography?.body || 'Not detected'}</span>
            </div>
            <div class="bb-preview-section">
              <h4>Brand Voice</h4>
              <span>${crawlData.analysis?.brandVoice || 'Not detected'}</span>
            </div>
          </div>
        ` : `
          <div class="bb-hint">
            <span>💡</span> We'll crawl your website to auto-detect brand colors, fonts, logos, and voice. This pre-fills the next steps so you don't have to enter everything manually.
          </div>
        `}
      </div>
    `;
  }

  // ── Step 1: Brand Identity ──
  function renderIdentityStep() {
    const d = briefData;
    const auto = crawlData?.analysis;
    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Company / Brand Name ${auto ? '<span class="bb-auto">✨ Auto-detected</span>' : ''}</label>
          <input type="text" class="bb-input" id="bb-company" placeholder="e.g., HoneyForX"
                 value="${d.companyName || ''}" onchange="BrandBrief.save('companyName', this.value)">
        </div>
        <div class="bb-field">
          <label class="bb-label">Tagline / Mission Statement</label>
          <input type="text" class="bb-input" id="bb-tagline" placeholder="e.g., Natural Male Wellness"
                 value="${d.tagline || ''}" onchange="BrandBrief.save('tagline', this.value)">
        </div>
        <div class="bb-field">
          <label class="bb-label">Brand Story / Origin</label>
          <textarea class="bb-textarea" id="bb-story" placeholder="Tell us about your brand..."
                    onchange="BrandBrief.save('brandStory', this.value)">${d.brandStory || ''}</textarea>
        </div>
        <div class="bb-field">
          <label class="bb-label">Core Products / Services</label>
          <textarea class="bb-textarea" id="bb-products" placeholder="List your main products or services..."
                    onchange="BrandBrief.save('products', this.value)">${d.products || ''}</textarea>
        </div>
        <div class="bb-field">
          <label class="bb-label">Product USPs / Certifications</label>
          <input type="text" class="bb-input" id="bb-usps" placeholder="e.g., FDA approved, organic, clinically tested"
                 value="${d.usps || ''}" onchange="BrandBrief.save('usps', this.value)">
        </div>
      </div>
    `;
  }

  // ── Step 2: Visual Identity ──
  function renderVisualStep() {
    const d = briefData;
    const colors = d.colors || crawlData?.crawl?.colors || {};
    const typo = d.typography || crawlData?.crawl?.typography || {};
    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Brand Colors ${crawlData ? '<span class="bb-auto">✨ Auto-detected</span>' : ''}</label>
          <div class="bb-color-editor">
            ${['primary', 'secondary', 'accent', 'background'].map(key => `
              <div class="bb-color-edit-item">
                <input type="color" class="bb-color-input" value="${colors[key] || '#000000'}"
                       onchange="BrandBrief.saveColor('${key}', this.value)">
                <span>${key.charAt(0).toUpperCase() + key.slice(1)}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="bb-field-row">
          <div class="bb-field">
            <label class="bb-label">Heading Font ${crawlData ? '<span class="bb-auto">✨</span>' : ''}</label>
            <input type="text" class="bb-input" placeholder="e.g., Montserrat"
                   value="${typo.headings || ''}" onchange="BrandBrief.saveTypo('headings', this.value)">
          </div>
          <div class="bb-field">
            <label class="bb-label">Body Font</label>
            <input type="text" class="bb-input" placeholder="e.g., Inter"
                   value="${typo.body || ''}" onchange="BrandBrief.saveTypo('body', this.value)">
          </div>
        </div>
        ${crawlData?.crawl?.logo ? `
          <div class="bb-field">
            <label class="bb-label">Logo <span class="bb-auto">✨ Auto-detected</span></label>
            <div class="bb-logo-preview">
              <img src="${crawlData.crawl.logo}" alt="Logo" style="max-width:200px;max-height:80px;">
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Step 3: Brand Voice ──
  function renderVoiceStep() {
    const d = briefData;
    const auto = crawlData?.analysis;
    const tone = d.voiceTone || auto?.brandVoice || '';
    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Brand Voice Tone ${auto ? '<span class="bb-auto">✨ Auto-detected</span>' : ''}</label>
          <select class="bb-select" onchange="BrandBrief.save('voiceTone', this.value)">
            <option value="" ${!tone ? 'selected' : ''}>Select tone...</option>
            ${['Professional & Authoritative', 'Friendly & Approachable', 'Bold & Edgy', 'Luxurious & Premium', 'Casual & Relatable', 'Inspirational & Motivational', 'Educational & Informative', 'Playful & Fun'].map(t =>
              `<option value="${t}" ${tone.toLowerCase().includes(t.split(' ')[0].toLowerCase()) ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
        </div>
        <div class="bb-field">
          <label class="bb-label">Words / Phrases to Always Use</label>
          <textarea class="bb-textarea bb-textarea-sm" placeholder="e.g., natural, clinically proven, vitality..."
                    onchange="BrandBrief.save('voiceInclude', this.value)">${d.voiceInclude || ''}</textarea>
        </div>
        <div class="bb-field">
          <label class="bb-label">Words / Phrases to Never Use</label>
          <textarea class="bb-textarea bb-textarea-sm" placeholder="e.g., cheap, fake, synthetic..."
                    onchange="BrandBrief.save('voiceExclude', this.value)">${d.voiceExclude || ''}</textarea>
        </div>
        ${auto?.keyMessages ? `
          <div class="bb-field">
            <label class="bb-label">Key Messaging Themes <span class="bb-auto">✨ Auto-detected</span></label>
            <div class="bb-tag-row">
              ${auto.keyMessages.map(m => `<span class="bb-tag">${m}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Step 4: Target Audience ──
  function renderAudienceStep() {
    const d = briefData;
    const auto = crawlData?.analysis;
    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Target Demographics ${auto ? '<span class="bb-auto">✨ Suggested</span>' : ''}</label>
          <input type="text" class="bb-input" placeholder="e.g., Men 25-45, health-conscious"
                 value="${d.demographics || auto?.targetAudience || ''}"
                 onchange="BrandBrief.save('demographics', this.value)">
        </div>
        <div class="bb-field">
          <label class="bb-label">Target Markets / Regions</label>
          <div class="bb-checkbox-grid">
            ${['US', 'LATAM', 'Europe', 'MENA', 'Asia Pacific', 'Global'].map(m => `
              <label class="bb-check-item">
                <input type="checkbox" ${(d.markets || []).includes(m) ? 'checked' : ''}
                       onchange="BrandBrief.toggleMarket('${m}', this.checked)">
                <span>${m}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="bb-field">
          <label class="bb-label">Audience Pain Points</label>
          <textarea class="bb-textarea" placeholder="What problems does your audience face?"
                    onchange="BrandBrief.save('painPoints', this.value)">${d.painPoints || ''}</textarea>
        </div>
        <div class="bb-field">
          <label class="bb-label">Audience Interests / Psychographics</label>
          <textarea class="bb-textarea bb-textarea-sm" placeholder="What does your audience care about?"
                    onchange="BrandBrief.save('psychographics', this.value)">${d.psychographics || ''}</textarea>
        </div>
      </div>
    `;
  }

  // ── Step 5: Platform Strategy ──
  function renderPlatformStep() {
    const d = briefData;
    const platforms = d.platforms || ['Instagram', 'TikTok'];
    const allPlatforms = ['Instagram', 'TikTok', 'YouTube', 'Twitter/X', 'LinkedIn', 'Threads'];
    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Select Platforms (priority order)</label>
          <div class="bb-platform-grid">
            ${allPlatforms.map(p => {
              const selected = platforms.includes(p);
              const icons = { 'Instagram': '📸', 'TikTok': '🎵', 'YouTube': '📺', 'Twitter/X': '𝕏', 'LinkedIn': '💼', 'Threads': '🧵' };
              return `
                <button class="bb-platform-btn ${selected ? 'selected' : ''}"
                        onclick="BrandBrief.togglePlatform('${p}')">
                  <span class="bb-platform-icon">${icons[p]}</span>
                  <span>${p}</span>
                  ${selected ? '<span class="bb-platform-check">✓</span>' : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>
        <div class="bb-field">
          <label class="bb-label">Content Cadence (posts per day per persona)</label>
          <select class="bb-select" onchange="BrandBrief.save('cadence', this.value)">
            <option value="1" ${d.cadence === '1' ? 'selected' : ''}>1 post/day</option>
            <option value="2" ${d.cadence === '2' || !d.cadence ? 'selected' : ''}>2 posts/day</option>
            <option value="3" ${d.cadence === '3' ? 'selected' : ''}>3 posts/day</option>
            <option value="5" ${d.cadence === '5' ? 'selected' : ''}>5+ posts/day</option>
          </select>
        </div>
        <div class="bb-field">
          <label class="bb-label">Content Focus</label>
          <div class="bb-checkbox-grid">
            ${['UGC Reviews', 'Educational', 'Lifestyle', 'Behind-the-scenes', 'Testimonials', 'Product Demos', 'Trending/Viral', 'Story-driven'].map(f => `
              <label class="bb-check-item">
                <input type="checkbox" ${(d.contentFocus || []).includes(f) ? 'checked' : ''}
                       onchange="BrandBrief.toggleContentFocus('${f}', this.checked)">
                <span>${f}</span>
              </label>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ── Step 6: Persona Archetypes ──
  function renderPersonaStep() {
    const d = briefData;
    const count = d.personaCount || 3;
    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">How many AI personas do you want?</label>
          <select class="bb-select" onchange="BrandBrief.save('personaCount', this.value)">
            ${[1,2,3,5,8,13].map(n => `<option value="${n}" ${count == n ? 'selected' : ''}>${n} personas</option>`).join('')}
          </select>
        </div>
        <div class="bb-field">
          <label class="bb-label">Persona Style Preferences</label>
          <textarea class="bb-textarea" placeholder="Describe the types of creators you want. e.g., 'A Latina fitness coach, a tech reviewer bro, a luxury lifestyle influencer...'"
                    onchange="BrandBrief.save('personaPreferences', this.value)">${d.personaPreferences || ''}</textarea>
        </div>
        <div class="bb-field">
          <label class="bb-label">Competitor Accounts to Analyze</label>
          <textarea class="bb-textarea bb-textarea-sm" placeholder="@competitor1, @competitor2..."
                    onchange="BrandBrief.save('competitors', this.value)">${d.competitors || ''}</textarea>
        </div>
        <div class="bb-hint">
          <span>🤖</span> After you submit, our AI will generate persona profiles tailored to your brand. You'll review and approve each one before they go live.
        </div>
      </div>
    `;
  }

  // ── Step 7: Review ──
  function renderReviewStep() {
    const d = briefData;
    const sections = [
      { title: 'Brand Identity', fields: [
        ['Company', d.companyName],
        ['Tagline', d.tagline],
        ['Products', d.products],
      ]},
      { title: 'Visual Identity', fields: [
        ['Colors', d.colors ? Object.entries(d.colors).map(([k,v]) => `${k}: ${v}`).join(', ') : 'Not set'],
        ['Fonts', d.typography ? `${d.typography.headings || '?'} / ${d.typography.body || '?'}` : 'Not set'],
      ]},
      { title: 'Brand Voice', fields: [
        ['Tone', d.voiceTone],
        ['Include', d.voiceInclude],
        ['Exclude', d.voiceExclude],
      ]},
      { title: 'Target Audience', fields: [
        ['Demographics', d.demographics],
        ['Markets', (d.markets || []).join(', ')],
        ['Pain Points', d.painPoints],
      ]},
      { title: 'Platform Strategy', fields: [
        ['Platforms', (d.platforms || []).join(', ')],
        ['Cadence', d.cadence ? `${d.cadence} posts/day` : 'Not set'],
        ['Content Focus', (d.contentFocus || []).join(', ')],
      ]},
      { title: 'Personas', fields: [
        ['Count', d.personaCount],
        ['Preferences', d.personaPreferences],
        ['Competitors', d.competitors],
      ]},
    ];

    return `
      <div class="bb-review">
        ${sections.map(s => `
          <div class="bb-review-section">
            <h4>${s.title}</h4>
            ${s.fields.map(([label, value]) => `
              <div class="bb-review-row">
                <span class="bb-review-label">${label}</span>
                <span class="bb-review-value">${value || '<em class="bb-muted">Not provided</em>'}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
        <div class="bb-hint" style="margin-top:1rem;">
          <span>📋</span> Review all fields above. Click any step in the progress bar to go back and edit. When ready, submit to receive your viability assessment and AI-generated personas.
        </div>
      </div>
    `;
  }

  // ── Actions ──
  async function apiCall(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function crawl() {
    const url = document.getElementById('bb-url')?.value;
    if (!url) return;
    briefData.websiteUrl = url;
    isLoading = true;
    render();

    try {
      const result = await apiCall(CRAWL_URL, { url });
      if (result && !result.error) {
        crawlData = result;
        // Pre-fill briefData from crawl results
        if (result.analysis) {
          if (result.analysis.targetAudience && !briefData.demographics) briefData.demographics = result.analysis.targetAudience;
          if (result.analysis.brandVoice && !briefData.voiceTone) briefData.voiceTone = result.analysis.brandVoice;
        }
        if (result.crawl?.colors && !briefData.colors) briefData.colors = result.crawl.colors;
        if (result.crawl?.typography && !briefData.typography) briefData.typography = result.crawl.typography;
        saveDraft();
      }
    } catch(e) {
      console.error('[BrandBrief] Crawl error:', e);
    }
    isLoading = false;
    render();
  }

  async function submit() {
    if (!confirm('Submit your brand brief? This will generate your AI persona recommendations.')) return;
    isLoading = true;
    render();

    try {
      const result = await apiCall(ASSESS_URL, {
        brief: briefData,
        crawlData: crawlData
      });

      if (result && result.viability) {
        showViabilityResults(result);
      }
    } catch(e) {
      console.error('[BrandBrief] Submit error:', e);
    }
    isLoading = false;
  }

  function showViabilityResults(result) {
    container.innerHTML = `
      <div class="bb-container">
        <div class="bb-header" style="text-align:center;">
          <h3 class="bb-title">✅ Brand Brief Submitted</h3>
          <p class="bb-desc">Your viability assessment is ready</p>
        </div>

        <div class="bb-viability">
          <div class="bb-viability-score">
            <div class="bb-score-circle">
              <span class="bb-score-num">${result.viability.overall || '—'}</span>
              <span class="bb-score-label">/ 10</span>
            </div>
            <h4>Overall Viability</h4>
          </div>

          <div class="bb-viability-breakdown">
            ${['nicheCompetitiveness', 'platformFit', 'personaFeasibility', 'contentAlignment'].map(key => {
              const labels = { nicheCompetitiveness: 'Niche Competitiveness', platformFit: 'Platform-Audience Fit', personaFeasibility: 'Persona Feasibility', contentAlignment: 'Content Strategy' };
              const score = result.viability[key] || 0;
              return `
                <div class="bb-viability-item">
                  <div class="bb-viability-item-header">
                    <span>${labels[key]}</span>
                    <span>${score}/10</span>
                  </div>
                  <div class="bb-viability-bar"><div class="bb-viability-fill" style="width:${score * 10}%"></div></div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        ${result.personas ? `
          <div class="bb-card" style="margin-top:1.5rem;">
            <h4 style="margin-bottom:1rem;">🤖 AI-Generated Personas (Draft)</h4>
            <p class="bb-muted" style="margin-bottom:1rem;">Review each persona. Approve to add to your agent roster.</p>
            <div class="bb-persona-drafts">
              ${result.personas.map((p, i) => `
                <div class="bb-persona-draft" id="bb-persona-${i}">
                  <div class="bb-persona-draft-header">
                    <div class="bb-persona-avatar" style="background:${p.gradient || 'linear-gradient(135deg, #6366f1, #a78bfa)'}">${p.initial || p.name?.charAt(0) || '?'}</div>
                    <div>
                      <strong>${p.name || 'Unnamed'}</strong>
                      <div class="bb-muted">${p.niche || ''} · ${(p.platforms || []).join(', ')}</div>
                    </div>
                  </div>
                  <p class="bb-persona-bio">${p.bio || ''}</p>
                  <div class="bb-persona-draft-actions">
                    <button class="bb-btn bb-btn-approve" onclick="BrandBrief.approvePersona(${i})">✓ Approve</button>
                    <button class="bb-btn bb-btn-back" onclick="BrandBrief.rejectPersona(${i})">✕ Skip</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="bb-nav" style="margin-top:1.5rem;">
          <button class="bb-btn bb-btn-back" onclick="BrandBrief.restart()">← Edit Brief</button>
          <div></div>
        </div>
      </div>
    `;
  }

  function approvePersona(index) {
    const el = document.getElementById(`bb-persona-${index}`);
    if (el) {
      el.style.opacity = '0.5';
      el.querySelector('.bb-persona-draft-actions').innerHTML = '<span style="color:var(--success);font-weight:600;">✓ Approved — added to roster</span>';
    }
    // Fire webhook to add persona to agent roster
    PersonaWebhook.fire('persona.create', { index, briefId: briefData.id || Date.now() });
  }

  function rejectPersona(index) {
    const el = document.getElementById(`bb-persona-${index}`);
    if (el) {
      el.style.opacity = '0.3';
      el.querySelector('.bb-persona-draft-actions').innerHTML = '<span class="bb-muted">Skipped</span>';
    }
  }

  // ── Helpers ──
  function saveField(key, value) {
    briefData[key] = value;
    saveDraft();
  }

  function saveColor(key, value) {
    if (!briefData.colors) briefData.colors = {};
    briefData.colors[key] = value;
    saveDraft();
  }

  function saveTypo(key, value) {
    if (!briefData.typography) briefData.typography = {};
    briefData.typography[key] = value;
    saveDraft();
  }

  function toggleMarket(market, checked) {
    if (!briefData.markets) briefData.markets = [];
    if (checked && !briefData.markets.includes(market)) briefData.markets.push(market);
    if (!checked) briefData.markets = briefData.markets.filter(m => m !== market);
    saveDraft();
  }

  function togglePlatform(platform) {
    if (!briefData.platforms) briefData.platforms = [];
    const idx = briefData.platforms.indexOf(platform);
    if (idx >= 0) briefData.platforms.splice(idx, 1);
    else briefData.platforms.push(platform);
    saveDraft();
    render();
  }

  function toggleContentFocus(focus, checked) {
    if (!briefData.contentFocus) briefData.contentFocus = [];
    if (checked && !briefData.contentFocus.includes(focus)) briefData.contentFocus.push(focus);
    if (!checked) briefData.contentFocus = briefData.contentFocus.filter(f => f !== focus);
    saveDraft();
  }

  function next() {
    if (currentStep < TOTAL_STEPS - 1) { currentStep++; render(); container.scrollIntoView({ behavior: 'smooth' }); }
  }
  function prev() {
    if (currentStep > 0) { currentStep--; render(); container.scrollIntoView({ behavior: 'smooth' }); }
  }
  function goToStep(step) {
    if (step <= currentStep || step === currentStep + 1) { currentStep = step; render(); }
  }
  function restart() {
    currentStep = 0;
    render();
  }

  return {
    init,
    crawl,
    submit,
    next,
    prev,
    goToStep,
    restart,
    save: saveField,
    saveColor,
    saveTypo,
    toggleMarket,
    togglePlatform,
    toggleContentFocus,
    approvePersona,
    rejectPersona
  };
})();
