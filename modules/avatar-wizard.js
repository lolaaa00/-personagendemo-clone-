// ═══════════════════════════════════════════════════════════════
// PersonaGen Avatar Wizard — 5-Stage New Avatar Creation Flow
// ① Identity → ② Photo → ③ Accounts → ④ Soul → ⑤ Activate
// Renders inline using Brand Brief (.bb-*) CSS classes
// ═══════════════════════════════════════════════════════════════

const AvatarWizard = (() => {
  let container = null;
  let currentStep = 0;
  let avatarData = {};
  let isGenerating = false;

  const STEPS = [
    { id: 'identity', title: 'Identity',  icon: '🪪', desc: 'Name, niche, personality, and market' },
    { id: 'photo',    title: 'Photo',     icon: '📸', desc: 'Generate a profile photo with AI' },
    { id: 'accounts', title: 'Accounts',  icon: '📱', desc: 'Set up social platform handles' },
    { id: 'soul',     title: 'Soul',      icon: '🧠', desc: 'Define voice, values, and behavioral directives' },
    { id: 'activate', title: 'Activate',  icon: '🚀', desc: 'Review and launch your new avatar' },
  ];
  const TOTAL_STEPS = STEPS.length;

  const NICHES = [
    'Fitness & Wellness', 'Tech & AI', 'Finance & Crypto', 'Fashion & Beauty',
    'Food & Cooking', 'Travel & Adventure', 'Gaming', 'Music & Entertainment',
    'Real Estate', 'Education', 'Health & Mental Wellness', 'Parenting',
    'DIY & Crafts', 'Automotive', 'Luxury & Lifestyle'
  ];

  const PERSONALITIES = [
    { key: 'authority', label: 'Authority', desc: 'Expert, credible, data-driven' },
    { key: 'relatable', label: 'Relatable', desc: 'Warm, approachable, friend-next-door' },
    { key: 'provocative', label: 'Provocative', desc: 'Bold, contrarian, conversation-starter' },
    { key: 'inspirational', label: 'Inspirational', desc: 'Motivational, uplifting, aspirational' },
  ];

  const MARKETS = ['us', 'au', 'eu', 'latam', 'mena', 'apac'];
  const MARKET_LABELS = { us: 'United States', au: 'Australia', eu: 'Europe', latam: 'Latin America', mena: 'MENA', apac: 'Asia-Pacific' };
  const AU_CITIES = ['All of Australia','Sydney','Melbourne','Brisbane','Perth','Gold Coast','Adelaide','Canberra','Hobart','Darwin','Sunshine Coast','Newcastle','Wollongong'];

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Init (inline pattern like BrandBrief) ──
  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;

    currentStep = 0;
    avatarData = {
      name: '', handle: '', niche: 'Tech & AI', personality: 'authority',
      market: 'us', gender: 'female', photoUrl: '', photoPrompt: '',
      platforms: { instagram: '', tiktok: '', x: '', reddit: '' },
      soul: '', tools: '', skills: '', heartbeat: '',
    };

    render();
  }

  // ── Render ──
  function render() {
    if (!container) return;

    const step = STEPS[currentStep];
    container.innerHTML = `
      <div class="bb-container">
        <div class="bb-progress">
          ${STEPS.map((s, i) => `
            <div class="bb-step-dot ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}"
                 onclick="AvatarWizard.goToStep(${i})" title="${s.title}">
              <span>${i < currentStep ? '✓' : s.icon}</span>
            </div>
            ${i < STEPS.length - 1 ? '<div class="bb-step-line ' + (i < currentStep ? 'done' : '') + '"></div>' : ''}
          `).join('')}
        </div>

        <div class="bb-header">
          <h3 class="bb-title">${step.icon} ${step.title}</h3>
          <p class="bb-desc">${step.desc}</p>
          <span class="bb-step-label">Step ${currentStep + 1} of ${TOTAL_STEPS}</span>
        </div>

        <div class="bb-content">
          ${renderStep()}
        </div>

        <div class="bb-nav">
          ${currentStep > 0 ? '<button class="bb-btn bb-btn-back" onclick="AvatarWizard.prev()">← Back</button>' : '<div></div>'}
          ${currentStep < TOTAL_STEPS - 1
            ? `<button class="bb-btn bb-btn-next" onclick="AvatarWizard.next()">${STEPS[currentStep + 1].icon} Next: ${STEPS[currentStep + 1].title} →</button>`
            : '<button class="bb-btn bb-btn-submit" onclick="AvatarWizard.activate()">🚀 Activate Avatar</button>'
          }
        </div>
      </div>
    `;
  }

  function renderStep() {
    switch (STEPS[currentStep].id) {
      case 'identity': return renderIdentity();
      case 'photo':    return renderPhoto();
      case 'accounts': return renderAccounts();
      case 'soul':     return renderSoul();
      case 'activate': return renderActivate();
      default: return '';
    }
  }

  // ── Step 1: Identity ──
  function renderIdentity() {
    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Avatar Name</label>
          <input type="text" class="bb-input" id="aw-name" value="${esc(avatarData.name)}"
                 placeholder="e.g., Luna Vega" oninput="AvatarWizard.update('name', this.value)">
        </div>
        <div class="bb-field">
          <label class="bb-label">Handle</label>
          <input type="text" class="bb-input" id="aw-handle" value="${esc(avatarData.handle)}"
                 placeholder="@lunavega.ai" oninput="AvatarWizard.update('handle', this.value)">
        </div>
        <div class="bb-field-row">
          <div class="bb-field" style="flex:1">
            <label class="bb-label">Niche</label>
            <select class="bb-select" id="aw-niche" onchange="AvatarWizard.update('niche', this.value)">
              ${NICHES.map(n => `<option value="${n}" ${avatarData.niche === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
          <div class="bb-field" style="flex:1">
            <label class="bb-label">Target Market</label>
            <select class="bb-select" id="aw-market" onchange="AvatarWizard.update('market', this.value)">
              ${MARKETS.map(m => `<option value="${m}" ${avatarData.market === m ? 'selected' : ''}>${MARKET_LABELS[m]}</option>`).join('')}
            </select>
            ${avatarData.market === 'au' ? `
            <label class="bb-label" style="margin-top:0.5rem;">City / Region</label>
            <select class="bb-select" onchange="AvatarWizard.update('marketCity', this.value)">
              ${AU_CITIES.map(c => `<option value="${c}"${avatarData.marketCity===c?' selected':''}>${c}</option>`).join('')}
            </select>
            ` : ''}
          </div>
        </div>
        <div class="bb-field">
          <label class="bb-label">Gender Presentation</label>
          <div class="bb-platform-grid">
            ${['female', 'male', 'non-binary'].map(g => `
              <button class="bb-platform-btn ${avatarData.gender === g ? 'selected' : ''}" onclick="AvatarWizard.update('gender', '${g}')">
                <span class="bb-platform-icon">${g === 'female' ? '♀' : g === 'male' ? '♂' : '⚧'}</span>
                <span>${g.charAt(0).toUpperCase() + g.slice(1)}</span>
                ${avatarData.gender === g ? '<span class="bb-platform-check">✓</span>' : ''}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="bb-field">
          <label class="bb-label">Personality Archetype</label>
          <div class="bb-platform-grid">
            ${PERSONALITIES.map(p => `
              <button class="bb-platform-btn ${avatarData.personality === p.key ? 'selected' : ''}"
                      onclick="AvatarWizard.update('personality', '${p.key}')">
                <span style="font-weight:700;font-size:0.82rem;">${p.label}</span>
                <span style="font-size:0.68rem;color:var(--text-dim);">${p.desc}</span>
                ${avatarData.personality === p.key ? '<span class="bb-platform-check">✓</span>' : ''}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ── Step 2: Photo (Grok Imagine via OpenRouter) ──
  function renderPhoto() {
    const defaultPrompt = `Professional headshot portrait of a ${avatarData.gender || 'female'} social media influencer in the ${avatarData.niche || 'tech'} space, ${avatarData.personality || 'confident'} expression, modern studio lighting, clean background, high quality professional photo`;

    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Photo Generation Prompt</label>
          <textarea class="bb-textarea" id="aw-photo-prompt" rows="3"
                    placeholder="Describe your avatar's look..."
                    oninput="AvatarWizard.update('photoPrompt', this.value)">${esc(avatarData.photoPrompt || defaultPrompt)}</textarea>
          <div class="bb-hint">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Powered by Grok Imagine via OpenRouter
          </div>
        </div>

        <button class="bb-btn bb-btn-next" style="width:100%;justify-content:center;" id="aw-gen-photo-btn"
                onclick="AvatarWizard.generatePhoto()" ${isGenerating ? 'disabled' : ''}>
          ${isGenerating ? '<span class="bb-spinner"></span> Generating...' : '📸 Generate Profile Photo'}
        </button>

        <div style="margin-top:1rem;border:1px solid var(--border,#333);border-radius:12px;overflow:hidden;min-height:200px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.02);">
          ${avatarData.photoUrl
            ? `<img src="${avatarData.photoUrl}" alt="Avatar photo" style="width:100%;max-height:360px;object-fit:cover;display:block;">`
            : '<div style="color:var(--text-dim,#666);font-size:0.82rem;padding:2rem;">Photo will appear here after generation</div>'
          }
        </div>

        ${avatarData.photoUrl ? '<p style="font-size:0.72rem;color:var(--success,#22c55e);margin-top:6px;">✅ Photo generated. Click Generate again for a different look.</p>' : ''}
      </div>
    `;
  }

  // ── Step 3: Accounts ──
  function renderAccounts() {
    const platforms = [
      { key: 'instagram', label: 'Instagram', icon: '📷', color: '#e1306c' },
      { key: 'tiktok',    label: 'TikTok',    icon: '♪',  color: '#000' },
      { key: 'x',         label: 'X / Twitter',icon: '𝕏', color: '#14171a' },
      { key: 'reddit',    label: 'Reddit',     icon: '⬆',  color: '#ff4500' },
    ];

    return `
      <div class="bb-card">
        <div class="bb-hint" style="margin-bottom:1rem;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          Enter handles for each platform this avatar will be active on. Leave blank to skip.
        </div>
        ${platforms.map(p => `
          <div class="bb-field" style="margin-bottom:0.75rem;">
            <label class="bb-label">
              <span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:${p.color};color:#fff;text-align:center;line-height:22px;font-size:0.7rem;margin-right:6px;vertical-align:middle;">${p.icon}</span>
              ${p.label}
            </label>
            <input type="text" class="bb-input" id="aw-plat-${p.key}"
                   value="${esc(avatarData.platforms[p.key] || '')}"
                   placeholder="@${(avatarData.name || 'handle').toLowerCase().replace(/\s+/g, '')}"
                   oninput="AvatarWizard.updatePlatform('${p.key}', this.value)">
          </div>
        `).join('')}
      </div>
    `;
  }

  // ── Step 4: Soul ──
  function renderSoul() {
    const name = avatarData.name || 'New Avatar';
    const defaultSoul = `# ${name} — Soul Document\n\n## Identity\n- Name: ${name}\n- Niche: ${avatarData.niche}\n- Personality: ${avatarData.personality}\n- Market: ${MARKET_LABELS[avatarData.market] || avatarData.market}\n\n## Voice & Values\n- Speak with ${avatarData.personality === 'authority' ? 'expertise and confidence' : avatarData.personality === 'relatable' ? 'warmth and authenticity' : avatarData.personality === 'provocative' ? 'boldness and conviction' : 'inspiration and energy'}\n- Always prioritize ${avatarData.niche} content\n\n## Behavioral Directives\n- Post consistently on schedule\n- Engage with community comments\n- Stay on-brand at all times`;

    return `
      <div class="bb-card">
        <div class="bb-field">
          <label class="bb-label">Soul Document (Markdown)</label>
          <textarea class="bb-textarea" id="aw-soul" rows="14" style="font-family:var(--font-mono,monospace);font-size:0.78rem;min-height:280px;line-height:1.6;"
                    oninput="AvatarWizard.update('soul', this.value)">${esc(avatarData.soul || defaultSoul)}</textarea>
          <div class="bb-hint">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            This defines your avatar's core identity, voice, and behavioral rules. You can refine this later in Persona Config.
          </div>
        </div>
      </div>
    `;
  }

  // ── Step 5: Activate ──
  function renderActivate() {
    const name = avatarData.name || 'New Avatar';
    const platformCount = Object.values(avatarData.platforms).filter(v => v && v.trim()).length;

    return `
      <div class="bb-review">
        <div class="bb-review-section">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:1rem;">
            ${avatarData.photoUrl
              ? `<img src="${avatarData.photoUrl}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--accent,#7c6aed);">`
              : `<div style="width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:800;color:#fff;background:linear-gradient(135deg,var(--accent,#7c6aed),#ec4899);">${(name.charAt(0) || '?')}</div>`
            }
            <div>
              <h4 style="font-size:1.1rem;font-weight:700;margin:0;">${esc(name)}</h4>
              <span style="font-size:0.78rem;color:var(--accent,#7c6aed);">${esc(avatarData.handle || '@' + name.toLowerCase().replace(/\s+/g, ''))}</span>
            </div>
          </div>
        </div>

        <div class="bb-review-section">
          <h4>Configuration</h4>
          <div class="bb-review-row">
            <span class="bb-review-label">Niche</span>
            <span class="bb-review-value">${esc(avatarData.niche)}</span>
          </div>
          <div class="bb-review-row">
            <span class="bb-review-label">Personality</span>
            <span class="bb-review-value">${esc(avatarData.personality)}</span>
          </div>
          <div class="bb-review-row">
            <span class="bb-review-label">Market</span>
            <span class="bb-review-value">${esc(MARKET_LABELS[avatarData.market] || avatarData.market)}</span>
          </div>
          <div class="bb-review-row">
            <span class="bb-review-label">Platforms</span>
            <span class="bb-review-value">${platformCount} connected</span>
          </div>
          <div class="bb-review-row">
            <span class="bb-review-label">Photo</span>
            <span class="bb-review-value">${avatarData.photoUrl ? '✅ Generated' : '⏭ Skipped'}</span>
          </div>
          <div class="bb-review-row">
            <span class="bb-review-label">Soul Doc</span>
            <span class="bb-review-value">${avatarData.soul ? '✅ ' + avatarData.soul.split('\n').length + ' lines' : '⏭ Default'}</span>
          </div>
        </div>

        <div class="bb-hint" style="margin-top:1rem;">
          <span>🚀</span> Review all fields above. Click any step in the progress bar to go back and edit. When ready, activate your avatar!
        </div>
      </div>
    `;
  }

  // ── Navigation ──
  function next() {
    collectStepData();
    if (currentStep === 0 && !avatarData.name?.trim()) {
      PersonaGenAPI.showToast('Please enter an avatar name', 'warning');
      return;
    }
    if (currentStep < TOTAL_STEPS - 1) {
      currentStep++;
      render();
      if (container) container.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function prev() {
    collectStepData();
    if (currentStep > 0) {
      currentStep--;
      render();
      if (container) container.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function goToStep(step) {
    if (step <= currentStep || step === currentStep + 1) {
      collectStepData();
      currentStep = step;
      render();
    }
  }

  function collectStepData() {
    // Collect data from current step's inputs before navigating
    const nameEl = document.getElementById('aw-name');
    const handleEl = document.getElementById('aw-handle');
    if (nameEl) avatarData.name = nameEl.value;
    if (handleEl) avatarData.handle = handleEl.value;

    const soulEl = document.getElementById('aw-soul');
    if (soulEl) avatarData.soul = soulEl.value;

    const promptEl = document.getElementById('aw-photo-prompt');
    if (promptEl) avatarData.photoPrompt = promptEl.value;
  }

  function update(key, value) {
    avatarData[key] = value;
    // Default marketCity when switching to Australia
    if (key === 'market' && value === 'au' && !avatarData.marketCity) {
      avatarData.marketCity = 'All of Australia';
    }
    // Re-render chips/cards that depend on selection state
    if (key === 'gender' || key === 'personality' || key === 'market') render();
  }

  function updatePlatform(platform, value) {
    avatarData.platforms[platform] = value;
  }

  // ── Photo Generation (Grok Imagine via OpenRouter) ──
  async function generatePhoto() {
    const promptEl = document.getElementById('aw-photo-prompt');
    const prompt = promptEl?.value?.trim() || `Professional headshot of a ${avatarData.gender} influencer`;

    avatarData.photoPrompt = prompt;
    isGenerating = true;
    render();

    try {
      // Call n8n workflow that proxies to OpenRouter Grok Imagine
      const webhookBase = (typeof PersonaGenConfig !== 'undefined')
        ? PersonaGenConfig.n8n_url || 'https://auto.l2gseo.com'
        : 'https://auto.l2gseo.com';

      const res = await fetch(webhookBase + '/webhook/personagen-avatar-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          prompt: prompt,
          name: avatarData.name,
          niche: avatarData.niche,
          ts: Date.now()
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url || data.image_url || data.photo_url) {
          avatarData.photoUrl = data.url || data.image_url || data.photo_url;
          PersonaGenAPI.showToast('Profile photo generated!', 'success');
        } else {
          throw new Error('No image URL in response');
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('[AvatarWizard] Photo generation failed:', err);
      // Generate a placeholder gradient avatar
      avatarData.photoUrl = '';
      PersonaGenAPI.showToast('Photo generation unavailable — you can upload one later', 'info');
    } finally {
      isGenerating = false;
      render();
    }
  }

  // ── Activate (Create the avatar) ──
  async function activate() {
    collectStepData();
    const name = avatarData.name?.trim();
    if (!name) {
      PersonaGenAPI.showToast('Avatar needs a name', 'warning');
      return;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '');
    const handle = avatarData.handle?.trim() || '@' + id.replace(/-/g, '');
    const initial = name.charAt(0).toUpperCase();

    // Generate a gradient based on name
    const hue1 = (name.charCodeAt(0) * 37) % 360;
    const hue2 = (hue1 + 60) % 360;
    const gradient = `linear-gradient(135deg, hsl(${hue1},75%,60%), hsl(${hue2},75%,55%))`;

    // Build the new agent object
    const newAgent = {
      id,
      name,
      handle,
      initial,
      niche: avatarData.niche,
      gradient,
      color: `hsl(${hue1},75%,60%)`,
      personality: avatarData.personality,
      market: avatarData.market,
      gender: avatarData.gender,
      photoUrl: avatarData.photoUrl || '',
      platforms: Object.entries(avatarData.platforms)
        .filter(([_, v]) => v?.trim())
        .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1)),
      soul: avatarData.soul || '',
      tools: '',
      skills: '',
      heartbeat: '',
      trend: 'up',
      perf: 'Launching',
      engagementRate: '0.0%',
    };

    // Add to DATA.agents
    if (window.DATA && window.DATA.agents) {
      window.DATA.agents.push(newAgent);
    }

    // Add to INFLUENCERS
    if (typeof INFLUENCERS !== 'undefined') {
      INFLUENCERS.push(newAgent);
    }

    // Save account connections
    const acData = JSON.parse(localStorage.getItem('personagen_ai_accounts') || '{}');
    acData[id] = {};
    Object.entries(avatarData.platforms).forEach(([k, v]) => {
      if (v?.trim()) acData[id][k] = v.trim().startsWith('@') ? v.trim() : '@' + v.trim();
    });
    localStorage.setItem('personagen_ai_accounts', JSON.stringify(acData));

    // Fire webhook to n8n
    try {
      PersonaWebhook.fire('avatar.created', {
        agent: newAgent,
        platforms: avatarData.platforms,
        soul: avatarData.soul,
      });
    } catch (e) {
      console.warn('[AvatarWizard] Webhook fire failed:', e);
    }

    // Refresh the AccountCreator sidebar
    if (typeof AccountCreator !== 'undefined') {
      AccountCreator.renderSidebar();
      AccountCreator.select(id);
      AccountCreator.updateAllSidebarBadges();
    }

    PersonaGenAPI.showToast(`🎉 ${name} activated! Avatar is live.`, 'success');

    // Reset wizard for next use
    currentStep = 0;
    avatarData = {
      name: '', handle: '', niche: 'Tech & AI', personality: 'authority',
      market: 'us', gender: 'female', photoUrl: '', photoPrompt: '',
      platforms: { instagram: '', tiktok: '', x: '', reddit: '' },
      soul: '', tools: '', skills: '', heartbeat: '',
    };
    render();
  }

  return { init, next, prev, update, updatePlatform, generatePhoto, activate, goToStep };
})();

// Auto-init when DOMContentLoaded if mount div exists
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('pg-avatar-wizard');
  if (mount && !mount.hasChildNodes()) {
    AvatarWizard.init('pg-avatar-wizard');
  }
});
