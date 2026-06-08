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
    // Support both old (crawl/analysis) and new (branding/metadata/markdown) response shapes
    const b = crawlData?.branding || {};
    const m = crawlData?.metadata || {};
    const md = crawlData?.markdown || '';
    // Fallback to old shape
    const c = crawlData?.crawl || {};
    const a = crawlData?.analysis || {};

    const logo = b.logo || c.logo || '';
    const favicon = m.favicon || '';
    const ogImage = m.ogImage || '';
    const title = (m.title || c.title || '').trim();
    const desc = (m.description || c.description || '').trim();
    const colors = b.colors || c.colors || {};
    const fonts = b.fonts || {};
    const typo = b.typography || c.typography || {};
    const spacing = b.spacing || {};
    const buttons = b.buttons || {};
    const personality = b.personality || {};
    const designSys = b.designSystem || {};
    const confidence = b.confidence || {};

    // Auto-fill identity fields from crawl
    if (detected && title && !briefData.companyName) {
      briefData.companyName = title.replace(/\s*[-–|].*$/, '').trim();
    }
    if (detected && desc && !briefData.tagline) {
      briefData.tagline = desc.substring(0, 120);
    }

    // Build a clean markdown summary (first ~600 chars, stripped of image links)
    const mdClean = md.replace(/!\[.*?\]\(.*?\)/g, '').replace(/\n{3,}/g, '\n\n').trim().substring(0, 600);

    return `
      <div class="bb-card">
        <label class="bb-label">Your Website URL</label>
        <div class="bb-crawl-row">
          <input type="url" class="bb-input" id="bb-url" placeholder="https://yourwebsite.com"
                 value="${briefData.websiteUrl || ''}">
          <button class="bb-btn bb-btn-analyze" onclick="BrandBrief.crawl()" ${isLoading ? 'disabled' : ''}>
            ${isLoading ? '<span class="bb-spinner"></span> Analyzing...' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze Brand'}
          </button>
        </div>
        ${detected ? `
          <div class="bb-detected-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Brand data auto-detected! We found your logo, colors, fonts, and brand personality.
          </div>

          <!-- ═══ Brand Hero: Logo + Title + Description ═══ -->
          ${title || logo ? `
          <div class="bb-brand-hero" style="display:flex;align-items:center;gap:1.25rem;padding:1.25rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:1rem;">
            ${logo ? `<img src="${logo}" alt="Brand Logo" style="width:72px;height:72px;object-fit:contain;border-radius:10px;background:rgba(255,255,255,0.05);padding:6px;flex-shrink:0;" onerror="this.style.display='none'">` : ''}
            <div style="flex:1;min-width:0;">
              ${title ? `<div style="font-size:1rem;font-weight:700;color:var(--text);margin-bottom:4px;">${title}</div>` : ''}
              ${desc ? `<div style="font-size:0.78rem;color:var(--text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${desc}</div>` : ''}
              ${briefData.websiteUrl ? `<a href="${briefData.websiteUrl}" target="_blank" style="font-size:0.7rem;color:var(--accent);text-decoration:none;margin-top:6px;display:inline-flex;align-items:center;gap:4px;opacity:0.8;">${briefData.websiteUrl} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : ''}
            </div>
          </div>
          ` : ''}

          <!-- ═══ Images: Logo / Favicon / OG Image ═══ -->
          ${(logo || favicon || ogImage) ? `
          <div class="bb-preview-section" style="margin-bottom:1rem;">
            <h4 style="margin-bottom:0.75rem;">Images</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;">
              ${logo ? `<div style="text-align:center;padding:1rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">
                <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:8px;">Logo</div>
                <img src="${logo}" alt="Logo" style="max-width:100%;max-height:60px;object-fit:contain;" onerror="this.parentElement.style.display='none'">
              </div>` : ''}
              ${favicon ? `<div style="text-align:center;padding:1rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">
                <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:8px;">Favicon</div>
                <img src="${favicon}" alt="Favicon" style="width:32px;height:32px;object-fit:contain;" onerror="this.parentElement.style.display='none'">
              </div>` : ''}
              ${ogImage ? `<div style="text-align:center;padding:1rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">
                <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:8px;">OG Image</div>
                <img src="${ogImage}" alt="OG Image" style="max-width:100%;max-height:60px;object-fit:contain;" onerror="this.parentElement.style.display='none'">
              </div>` : ''}
            </div>
          </div>
          ` : ''}

          <div class="bb-crawl-preview">
            <!-- ═══ Color Palette ═══ -->
            <div class="bb-preview-section">
              <h4>Color Palette</h4>
              <div class="bb-color-row">
                ${(Object.keys(colors).length > 0 ? Object.entries(colors).map(([k,v]) =>
                  `<div class="bb-color-chip">
                    <div class="bb-color-swatch" style="background:${v}"></div>
                    <span>${k}</span>
                    <span style="font-size:0.65rem;color:var(--text-dim);font-family:var(--font-mono,monospace);">${v}</span>
                  </div>`
                ).join('') : '<span class="bb-muted">None detected</span>')}
              </div>
            </div>

            <!-- ═══ Fonts ═══ -->
            <div class="bb-preview-section">
              <h4>Fonts</h4>
              ${fonts.primary || fonts.heading || fonts.body || typo.headings || typo.body ? `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                ${fonts.heading || fonts.primary || typo.headings ? `<div style="padding:0.5rem 0.75rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;">
                  <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:4px;">Heading</div>
                  <span style="font-size:0.85rem;font-weight:600;color:var(--text);">${fonts.heading?.family || fonts.primary?.family || typo.headings || 'N/A'}</span>
                  ${fonts.heading?.weight ? `<span style="font-size:0.65rem;color:var(--text-muted);margin-left:6px;">${fonts.heading.weight}</span>` : ''}
                </div>` : ''}
                ${fonts.body || typo.body ? `<div style="padding:0.5rem 0.75rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;">
                  <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:4px;">Body</div>
                  <span style="font-size:0.85rem;font-weight:600;color:var(--text);">${fonts.body?.family || typo.body || 'N/A'}</span>
                  ${fonts.body?.weight ? `<span style="font-size:0.65rem;color:var(--text-muted);margin-left:6px;">${fonts.body.weight}</span>` : ''}
                </div>` : ''}
              </div>
              ` : '<span class="bb-muted">Not detected</span>'}
            </div>

            <!-- ═══ Typography Scale ═══ -->
            ${typo.primary || typo.h1 || typo.headingSize ? `
            <div class="bb-preview-section">
              <h4>Typography Scale</h4>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:0.4rem;">
                ${typo.primary ? `<div style="text-align:center;padding:0.4rem;background:rgba(124,106,237,0.06);border:1px solid rgba(124,106,237,0.12);border-radius:6px;"><div style="font-size:0.55rem;text-transform:uppercase;color:var(--text-dim);letter-spacing:0.06em;">Primary</div><div style="font-size:0.8rem;font-weight:700;color:var(--accent);">${typo.primary}</div></div>` : ''}
                ${typo.heading ? `<div style="text-align:center;padding:0.4rem;background:rgba(124,106,237,0.06);border:1px solid rgba(124,106,237,0.12);border-radius:6px;"><div style="font-size:0.55rem;text-transform:uppercase;color:var(--text-dim);letter-spacing:0.06em;">Heading</div><div style="font-size:0.8rem;font-weight:700;color:var(--accent);">${typo.heading}</div></div>` : ''}
                ${typo.h1 ? `<div style="text-align:center;padding:0.4rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;"><div style="font-size:0.55rem;text-transform:uppercase;color:var(--text-dim);letter-spacing:0.06em;">H1</div><div style="font-size:0.8rem;font-weight:700;color:var(--text);">${typo.h1}</div></div>` : ''}
                ${typo.h2 ? `<div style="text-align:center;padding:0.4rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;"><div style="font-size:0.55rem;text-transform:uppercase;color:var(--text-dim);letter-spacing:0.06em;">H2</div><div style="font-size:0.8rem;font-weight:700;color:var(--text);">${typo.h2}</div></div>` : ''}
                ${typo.body ? `<div style="text-align:center;padding:0.4rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;"><div style="font-size:0.55rem;text-transform:uppercase;color:var(--text-dim);letter-spacing:0.06em;">Body</div><div style="font-size:0.8rem;font-weight:700;color:var(--text);">${typo.body}</div></div>` : ''}
                ${typo.scale ? `<div style="text-align:center;padding:0.4rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;"><div style="font-size:0.55rem;text-transform:uppercase;color:var(--text-dim);letter-spacing:0.06em;">Scale</div><div style="font-size:0.8rem;font-weight:700;color:var(--text);">${typo.scale}</div></div>` : ''}
              </div>
            </div>
            ` : ''}

            <!-- ═══ Spacing ═══ -->
            ${(spacing.base || spacing.borderRadius) ? `
            <div class="bb-preview-section">
              <h4>Spacing</h4>
              <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
                ${spacing.base ? `<div><span style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;">Base Unit:</span> <span style="font-size:0.85rem;font-weight:600;color:var(--accent);">${spacing.base}</span></div>` : ''}
                ${spacing.borderRadius ? `<div><span style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;">Border Radius:</span> <span style="font-size:0.85rem;font-weight:600;color:var(--rose,#f472b6);">${spacing.borderRadius}</span></div>` : ''}
              </div>
            </div>
            ` : ''}

            <!-- ═══ Button Components ═══ -->
            ${(buttons.primary || buttons.secondary) ? `
            <div class="bb-preview-section">
              <h4>Buttons</h4>
              <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">
                ${buttons.primary ? `<span style="display:inline-block;padding:8px 18px;border-radius:${spacing.borderRadius || '4px'};background:${colors.primary || '#7c6aed'};color:#fff;font-size:0.78rem;font-weight:600;">${buttons.primary.text || 'Primary'}</span>` : ''}
                ${buttons.secondary ? `<span style="display:inline-block;padding:8px 18px;border-radius:${spacing.borderRadius || '4px'};background:${buttons.secondary.backgroundColor || colors.textPrimary || '#000'};color:#fff;font-size:0.78rem;font-weight:600;">${buttons.secondary.text || 'Secondary'}</span>` : ''}
              </div>
            </div>
            ` : ''}

            <!-- ═══ Brand Personality ═══ -->
            ${(personality.tone || personality.energy || personality.targetAudience) ? `
            <div class="bb-preview-section">
              <h4>Brand Personality</h4>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.5rem;">
                ${personality.tone ? `<div style="padding:0.6rem 0.75rem;background:rgba(244,114,182,0.06);border:1px solid rgba(244,114,182,0.12);border-radius:8px;">
                  <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:2px;">Tone</div>
                  <span style="font-size:0.85rem;font-weight:600;color:var(--rose,#f472b6);text-transform:capitalize;">${personality.tone}</span>
                </div>` : ''}
                ${personality.energy ? `<div style="padding:0.6rem 0.75rem;background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.12);border-radius:8px;">
                  <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:2px;">Energy</div>
                  <span style="font-size:0.85rem;font-weight:600;color:var(--cyan,#22d3ee);text-transform:capitalize;">${personality.energy}</span>
                </div>` : ''}
                ${personality.targetAudience ? `<div style="padding:0.6rem 0.75rem;background:rgba(124,106,237,0.06);border:1px solid rgba(124,106,237,0.12);border-radius:8px;">
                  <div style="font-size:0.6rem;text-transform:uppercase;font-weight:700;color:var(--text-dim);letter-spacing:0.06em;margin-bottom:2px;">Target Audience</div>
                  <span style="font-size:0.8rem;font-weight:500;color:var(--text);">${personality.targetAudience}</span>
                </div>` : ''}
              </div>
            </div>
            ` : ''}

            <!-- ═══ Design System ═══ -->
            ${(designSys.framework) ? `
            <div class="bb-preview-section">
              <h4>Design System</h4>
              <span style="font-size:0.8rem;color:var(--text-muted);">Framework: <strong style="color:var(--text);">${designSys.framework}</strong></span>
              ${designSys.componentLibrary ? ` · Library: <strong style="color:var(--text);">${designSys.componentLibrary}</strong>` : ''}
            </div>
            ` : ''}

            <!-- ═══ Confidence Scores ═══ -->
            ${confidence.overall ? `
            <div class="bb-preview-section">
              <h4>Analysis Confidence</h4>
              <div style="display:flex;gap:1rem;flex-wrap:wrap;">
                ${confidence.overall ? `<div style="display:flex;align-items:center;gap:6px;"><div style="width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;"><div style="width:${Math.round(confidence.overall * 100)}%;height:100%;background:var(--success,#34d399);border-radius:2px;"></div></div><span style="font-size:0.7rem;color:var(--text-muted);">Overall ${Math.round(confidence.overall * 100)}%</span></div>` : ''}
                ${confidence.colors ? `<div style="display:flex;align-items:center;gap:6px;"><div style="width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;"><div style="width:${Math.round(confidence.colors * 100)}%;height:100%;background:var(--accent,#7c6aed);border-radius:2px;"></div></div><span style="font-size:0.7rem;color:var(--text-muted);">Colors ${Math.round(confidence.colors * 100)}%</span></div>` : ''}
                ${confidence.buttons ? `<div style="display:flex;align-items:center;gap:6px;"><div style="width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;"><div style="width:${Math.round(confidence.buttons * 100)}%;height:100%;background:var(--cyan,#22d3ee);border-radius:2px;"></div></div><span style="font-size:0.7rem;color:var(--text-muted);">Buttons ${Math.round(confidence.buttons * 100)}%</span></div>` : ''}
              </div>
            </div>
            ` : ''}

            <!-- ═══ Website Content Summary ═══ -->
            ${mdClean ? `
            <div class="bb-preview-section">
              <h4>Website Content Summary</h4>
              <div style="max-height:140px;overflow-y:auto;padding:0.75rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;font-size:0.75rem;color:var(--text-muted);line-height:1.65;white-space:pre-wrap;word-break:break-word;">${mdClean}${md.length > 600 ? '\n\n...(truncated)' : ''}</div>
            </div>
            ` : ''}

          </div>
        ` : `
          <div class="bb-hint">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            We'll crawl your website to auto-detect brand colors, fonts, logos, and voice. This pre-fills the next steps so you don't have to enter everything manually.
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
            ${['US', 'Australia', 'LATAM', 'Europe', 'MENA', 'Asia Pacific', 'Global'].map(m => `
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
    const text = await res.text();
    if (!text || text.trim() === '') {
      throw new Error('Empty response from server');
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('[BrandBrief] Non-JSON response:', text.substring(0, 200));
      throw new Error('Invalid response format');
    }
  }

  function showNotice(msg, type) {
    const el = container.querySelector('.bb-notice');
    if (el) el.remove();
    const notice = document.createElement('div');
    notice.className = 'bb-notice';
    notice.style.cssText = `padding:12px 16px;border-radius:8px;margin:1rem 0;font-size:0.85rem;display:flex;align-items:center;gap:8px;${
      type === 'error' ? 'background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.2);color:#f87171;' :
      type === 'success' ? 'background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);color:#4ade80;' :
      'background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);color:#a5b4fc;'
    }`;
    notice.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${msg}`;
    const stepContent = container.querySelector('.bb-step-content');
    if (stepContent) stepContent.prepend(notice);
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
        // Pre-fill briefData from new branding response
        const b = result.branding || {};
        const m = result.metadata || {};
        // Fallback to old shape
        const c = result.crawl || {};
        const a = result.analysis || {};

        // Colors
        if ((b.colors || c.colors) && !briefData.colors) briefData.colors = b.colors || c.colors;
        // Typography
        if ((b.typography || c.typography) && !briefData.typography) briefData.typography = b.typography || c.typography;
        // Brand voice / personality
        if (b.personality?.targetAudience && !briefData.demographics) briefData.demographics = b.personality.targetAudience;
        if (b.personality?.tone && !briefData.voiceTone) briefData.voiceTone = b.personality.tone;
        if (a.targetAudience && !briefData.demographics) briefData.demographics = a.targetAudience;
        if (a.brandVoice && !briefData.voiceTone) briefData.voiceTone = a.brandVoice;
        // Store markdown for context
        if (result.markdown) briefData._siteMarkdown = result.markdown;

        saveDraft();
        showNotice('Brand analysis complete! Logo, colors, fonts, personality — all captured.', 'success');
      } else {
        showNotice('Could not analyze site automatically. You can fill in details manually.', 'info');
      }
    } catch(e) {
      console.error('[BrandBrief] Crawl error:', e);
      showNotice('Website analysis unavailable — please fill in your brand details manually on the next steps.', 'info');
    }
    isLoading = false;
    render();
  }


  async function submit() {
    // Submit brief — no confirmation dialog needed, the button click is the intent
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

// Auto-init on built sub-pages (switchPortalView doesn't fire on static page load)
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('pg-brand-brief');
  if (mount && !mount.hasChildNodes()) {
    BrandBrief.init('pg-brand-brief');
  }
});
