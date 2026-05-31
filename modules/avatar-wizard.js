// ═══════════════════════════════════════════════════════════════
// PersonaGen Avatar Wizard — 5-Stage New Avatar Creation Flow
// ① Identity → ② Photo → ③ Accounts → ④ Soul → ⑤ Activate
// ═══════════════════════════════════════════════════════════════

const AvatarWizard = (() => {
  let overlay = null;
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

  const MARKETS = ['us', 'eu', 'latam', 'mena', 'apac'];
  const MARKET_LABELS = { us: 'United States', eu: 'Europe', latam: 'Latin America', mena: 'MENA', apac: 'Asia-Pacific' };

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Open / Close ──
  function open() {
    currentStep = 0;
    avatarData = {
      name: '', handle: '', niche: 'Tech & AI', personality: 'authority',
      market: 'us', gender: 'female', photoUrl: '', photoPrompt: '',
      platforms: { instagram: '', tiktok: '', x: '', reddit: '' },
      soul: '', tools: '', skills: '', heartbeat: '',
    };
    render();
  }

  function close() {
    if (overlay) {
      overlay.classList.add('aw-closing');
      setTimeout(() => { if (overlay) overlay.remove(); overlay = null; }, 300);
    }
  }

  // ── Render ──
  function render() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'aw-overlay';
      document.body.appendChild(overlay);
    }

    const step = STEPS[currentStep];
    overlay.innerHTML = `
      <div class="aw-modal">
        <!-- Header -->
        <div class="aw-header">
          <div>
            <h3 class="aw-title">✨ New Avatar Wizard</h3>
            <p class="aw-subtitle">${step.desc}</p>
          </div>
          <button class="aw-close" onclick="AvatarWizard.close()">✕</button>
        </div>

        <!-- Progress -->
        <div class="aw-progress">
          ${STEPS.map((s, i) => `
            <div class="aw-step-dot ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}" title="${s.title}">
              <span>${i < currentStep ? '✓' : s.icon}</span>
              <div class="aw-step-label">${s.title}</div>
            </div>
            ${i < STEPS.length - 1 ? '<div class="aw-step-line ' + (i < currentStep ? 'done' : '') + '"></div>' : ''}
          `).join('')}
        </div>

        <!-- Content -->
        <div class="aw-content" id="aw-content">
          ${renderStep()}
        </div>

        <!-- Footer -->
        <div class="aw-footer">
          ${currentStep > 0 ? '<button class="aw-btn aw-btn--secondary" onclick="AvatarWizard.prev()">← Back</button>' : '<span></span>'}
          ${currentStep < STEPS.length - 1
            ? `<button class="aw-btn aw-btn--primary" onclick="AvatarWizard.next()">${STEPS[currentStep + 1].icon} Next: ${STEPS[currentStep + 1].title} →</button>`
            : `<button class="aw-btn aw-btn--success" onclick="AvatarWizard.activate()">🚀 Activate Avatar</button>`
          }
        </div>
      </div>
    `;
    overlay.classList.remove('aw-closing');
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
      <div class="aw-form">
        <div class="aw-field">
          <label class="aw-label">Avatar Name</label>
          <input type="text" class="aw-input" id="aw-name" value="${esc(avatarData.name)}"
                 placeholder="e.g., Luna Vega" oninput="AvatarWizard.update('name', this.value)">
        </div>
        <div class="aw-field">
          <label class="aw-label">Handle</label>
          <input type="text" class="aw-input" id="aw-handle" value="${esc(avatarData.handle)}"
                 placeholder="@lunavega.ai" oninput="AvatarWizard.update('handle', this.value)">
        </div>
        <div class="aw-row">
          <div class="aw-field" style="flex:1">
            <label class="aw-label">Niche</label>
            <select class="aw-select" id="aw-niche" onchange="AvatarWizard.update('niche', this.value)">
              ${NICHES.map(n => `<option value="${n}" ${avatarData.niche === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
          <div class="aw-field" style="flex:1">
            <label class="aw-label">Target Market</label>
            <select class="aw-select" id="aw-market" onchange="AvatarWizard.update('market', this.value)">
              ${MARKETS.map(m => `<option value="${m}" ${avatarData.market === m ? 'selected' : ''}>${MARKET_LABELS[m]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="aw-field">
          <label class="aw-label">Gender Presentation</label>
          <div class="aw-chip-row">
            ${['female', 'male', 'non-binary'].map(g => `
              <button class="aw-chip ${avatarData.gender === g ? 'active' : ''}" onclick="AvatarWizard.update('gender', '${g}')">
                ${g === 'female' ? '♀' : g === 'male' ? '♂' : '⚧'} ${g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="aw-field">
          <label class="aw-label">Personality Archetype</label>
          <div class="aw-personality-grid">
            ${PERSONALITIES.map(p => `
              <button class="aw-personality-card ${avatarData.personality === p.key ? 'active' : ''}"
                      onclick="AvatarWizard.update('personality', '${p.key}')">
                <strong>${p.label}</strong>
                <span>${p.desc}</span>
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
      <div class="aw-form">
        <div class="aw-field">
          <label class="aw-label">Photo Generation Prompt</label>
          <textarea class="aw-textarea" id="aw-photo-prompt" rows="3"
                    placeholder="Describe your avatar's look..."
                    oninput="AvatarWizard.update('photoPrompt', this.value)">${esc(avatarData.photoPrompt || defaultPrompt)}</textarea>
          <span class="aw-hint">Powered by Grok Imagine via OpenRouter</span>
        </div>

        <button class="aw-btn aw-btn--primary aw-generate-photo-btn" id="aw-gen-photo-btn"
                onclick="AvatarWizard.generatePhoto()" ${isGenerating ? 'disabled' : ''}>
          ${isGenerating ? '<span class="aw-spinner"></span> Generating...' : '📸 Generate Profile Photo'}
        </button>

        <div class="aw-photo-preview" id="aw-photo-preview">
          ${avatarData.photoUrl
            ? `<img src="${avatarData.photoUrl}" alt="Avatar photo" class="aw-photo-img">`
            : '<div class="aw-photo-placeholder">Photo will appear here after generation</div>'
          }
        </div>

        ${avatarData.photoUrl ? '<p class="aw-photo-note">✅ Photo generated. Click Generate again for a different look.</p>' : ''}
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
      <div class="aw-form">
        <p class="aw-section-note">Enter handles for each platform this avatar will be active on. Leave blank to skip.</p>
        ${platforms.map(p => `
          <div class="aw-platform-row">
            <div class="aw-platform-icon" style="background:${p.color}">${p.icon}</div>
            <div class="aw-platform-info">
              <span class="aw-platform-label">${p.label}</span>
              <input type="text" class="aw-input aw-platform-input" id="aw-plat-${p.key}"
                     value="${esc(avatarData.platforms[p.key] || '')}"
                     placeholder="@${(avatarData.name || 'handle').toLowerCase().replace(/\s+/g, '')}"
                     oninput="AvatarWizard.updatePlatform('${p.key}', this.value)">
            </div>
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
      <div class="aw-form">
        <div class="aw-field">
          <label class="aw-label">Soul Document (Markdown)</label>
          <textarea class="aw-textarea aw-soul-editor" id="aw-soul" rows="14"
                    oninput="AvatarWizard.update('soul', this.value)">${esc(avatarData.soul || defaultSoul)}</textarea>
          <span class="aw-hint">This defines your avatar's core identity, voice, and behavioral rules. You can refine this later in Persona Config.</span>
        </div>
      </div>
    `;
  }

  // ── Step 5: Activate ──
  function renderActivate() {
    const name = avatarData.name || 'New Avatar';
    const platformCount = Object.values(avatarData.platforms).filter(v => v && v.trim()).length;

    return `
      <div class="aw-review">
        <div class="aw-review-card">
          <div class="aw-review-header">
            ${avatarData.photoUrl
              ? `<img src="${avatarData.photoUrl}" class="aw-review-photo">`
              : `<div class="aw-review-avatar-placeholder">${(name.charAt(0) || '?')}</div>`
            }
            <div>
              <h4 class="aw-review-name">${esc(name)}</h4>
              <span class="aw-review-handle">${esc(avatarData.handle || '@' + name.toLowerCase().replace(/\s+/g, ''))}</span>
            </div>
          </div>

          <div class="aw-review-grid">
            <div class="aw-review-item">
              <span class="aw-review-label">Niche</span>
              <span class="aw-review-value">${esc(avatarData.niche)}</span>
            </div>
            <div class="aw-review-item">
              <span class="aw-review-label">Personality</span>
              <span class="aw-review-value">${esc(avatarData.personality)}</span>
            </div>
            <div class="aw-review-item">
              <span class="aw-review-label">Market</span>
              <span class="aw-review-value">${esc(MARKET_LABELS[avatarData.market] || avatarData.market)}</span>
            </div>
            <div class="aw-review-item">
              <span class="aw-review-label">Platforms</span>
              <span class="aw-review-value">${platformCount} connected</span>
            </div>
            <div class="aw-review-item">
              <span class="aw-review-label">Photo</span>
              <span class="aw-review-value">${avatarData.photoUrl ? '✅ Generated' : '⏭ Skipped'}</span>
            </div>
            <div class="aw-review-item">
              <span class="aw-review-label">Soul Doc</span>
              <span class="aw-review-value">${avatarData.soul ? '✅ ' + avatarData.soul.split('\n').length + ' lines' : '⏭ Default'}</span>
            </div>
          </div>
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
    if (currentStep < STEPS.length - 1) {
      currentStep++;
      render();
    }
  }

  function prev() {
    collectStepData();
    if (currentStep > 0) {
      currentStep--;
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
    // Re-render chips/cards that depend on selection state
    if (key === 'gender' || key === 'personality') render();
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
    close();
  }

  // ── Inject Styles ──
  function injectStyles() {
    if (document.getElementById('aw-styles')) return;
    const style = document.createElement('style');
    style.id = 'aw-styles';
    style.textContent = `
      .aw-overlay {
        position:fixed; inset:0; z-index:9999;
        background:rgba(0,0,0,0.7); backdrop-filter:blur(8px);
        display:flex; align-items:center; justify-content:center;
        animation:awFadeIn 0.3s ease-out;
      }
      .aw-overlay.aw-closing { animation:awFadeOut 0.3s ease-in forwards; }
      @keyframes awFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes awFadeOut { from { opacity:1; } to { opacity:0; } }

      .aw-modal {
        background:var(--surface,#111118); border:1px solid var(--border,#222);
        border-radius:16px; width:min(640px, 92vw); max-height:88vh;
        display:flex; flex-direction:column; overflow:hidden;
        box-shadow:0 24px 64px rgba(0,0,0,0.5);
        animation:awSlideUp 0.35s ease-out;
      }
      @keyframes awSlideUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }

      .aw-header {
        display:flex; align-items:flex-start; justify-content:space-between;
        padding:1.25rem 1.5rem; border-bottom:1px solid var(--border,#222);
      }
      .aw-title { font-size:1.15rem; font-weight:800; margin:0; color:var(--text,#eee); }
      .aw-subtitle { font-size:0.78rem; color:var(--text-dim,#666); margin:4px 0 0; }
      .aw-close {
        background:none; border:none; color:var(--text-dim,#666); font-size:1.1rem;
        cursor:pointer; padding:4px 8px; border-radius:6px;
      }
      .aw-close:hover { background:rgba(255,255,255,0.06); color:var(--text,#eee); }

      /* Progress */
      .aw-progress {
        display:flex; align-items:center; justify-content:center;
        padding:1rem 1.5rem; gap:0; border-bottom:1px solid var(--border,#222);
      }
      .aw-step-dot {
        width:36px; height:36px; border-radius:50%;
        display:flex; align-items:center; justify-content:center; flex-direction:column;
        background:var(--surface-2,#1a1a22); border:2px solid var(--border,#333);
        font-size:0.7rem; cursor:default; position:relative; flex-shrink:0;
      }
      .aw-step-dot.active { border-color:var(--accent,#7c3aed); background:rgba(124,58,237,0.15); }
      .aw-step-dot.done { border-color:var(--success,#22c55e); background:rgba(34,197,94,0.1); color:var(--success); }
      .aw-step-label {
        position:absolute; bottom:-18px; font-size:0.55rem; font-weight:600;
        color:var(--text-dim); white-space:nowrap; letter-spacing:0.02em;
      }
      .aw-step-line {
        height:2px; flex:1; min-width:20px; max-width:60px;
        background:var(--border,#333); margin:0 4px;
      }
      .aw-step-line.done { background:var(--success,#22c55e); }

      /* Content */
      .aw-content { padding:1.5rem; overflow-y:auto; flex:1; min-height:300px; }

      /* Form */
      .aw-form { display:flex; flex-direction:column; gap:1rem; }
      .aw-field { display:flex; flex-direction:column; gap:4px; }
      .aw-label { font-size:0.72rem; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em; }
      .aw-input, .aw-select, .aw-textarea {
        background:var(--surface-2,#1a1a22); border:1px solid var(--border,#333);
        border-radius:8px; padding:10px 14px; color:var(--text,#eee);
        font-size:0.88rem; font-family:inherit; outline:none;
        transition:border-color 0.15s;
      }
      .aw-input:focus, .aw-select:focus, .aw-textarea:focus { border-color:var(--accent,#7c3aed); }
      .aw-textarea { resize:vertical; min-height:80px; }
      .aw-hint { font-size:0.68rem; color:var(--text-dim); }
      .aw-row { display:flex; gap:1rem; }
      .aw-section-note { font-size:0.82rem; color:var(--text-muted); margin:0 0 0.5rem; }

      /* Chip Row */
      .aw-chip-row { display:flex; gap:8px; flex-wrap:wrap; }
      .aw-chip {
        padding:8px 16px; border-radius:20px; font-size:0.78rem; font-weight:600;
        background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted);
        cursor:pointer; font-family:inherit; transition:all 0.15s;
      }
      .aw-chip:hover { border-color:var(--accent); }
      .aw-chip.active { background:rgba(124,58,237,0.15); border-color:var(--accent); color:var(--accent); }

      /* Personality Grid */
      .aw-personality-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .aw-personality-card {
        display:flex; flex-direction:column; gap:2px; padding:12px 16px;
        background:var(--surface-2); border:1px solid var(--border);
        border-radius:10px; cursor:pointer; text-align:left;
        font-family:inherit; color:var(--text-muted); transition:all 0.15s;
      }
      .aw-personality-card strong { font-size:0.82rem; color:var(--text); }
      .aw-personality-card span { font-size:0.68rem; color:var(--text-dim); }
      .aw-personality-card:hover { border-color:var(--border-hover); }
      .aw-personality-card.active { border-color:var(--accent); background:rgba(124,58,237,0.08); }
      .aw-personality-card.active strong { color:var(--accent); }

      /* Photo */
      .aw-generate-photo-btn { width:100%; margin-top:4px; }
      .aw-photo-preview {
        margin-top:1rem; border:1px solid var(--border); border-radius:12px;
        overflow:hidden; min-height:200px; display:flex; align-items:center; justify-content:center;
        background:var(--surface-2);
      }
      .aw-photo-img { width:100%; max-height:360px; object-fit:cover; display:block; }
      .aw-photo-placeholder { color:var(--text-dim); font-size:0.82rem; padding:2rem; }
      .aw-photo-note { font-size:0.72rem; color:var(--success); margin-top:6px; }
      .aw-spinner {
        width:16px; height:16px; border:2px solid rgba(255,255,255,0.2);
        border-top-color:#fff; border-radius:50%; display:inline-block;
        animation:awSpin 0.6s linear infinite; vertical-align:middle; margin-right:6px;
      }
      @keyframes awSpin { to { transform:rotate(360deg); } }

      /* Platform Rows */
      .aw-platform-row {
        display:flex; align-items:center; gap:12px; padding:10px;
        background:var(--surface-2); border:1px solid var(--border);
        border-radius:10px;
      }
      .aw-platform-icon {
        width:32px; height:32px; border-radius:8px; display:flex;
        align-items:center; justify-content:center; font-size:1rem;
        color:#fff; flex-shrink:0;
      }
      .aw-platform-info { display:flex; flex-direction:column; gap:4px; flex:1; }
      .aw-platform-label { font-size:0.72rem; font-weight:700; color:var(--text-dim); }
      .aw-platform-input { padding:6px 10px !important; font-size:0.82rem !important; }

      /* Soul Editor */
      .aw-soul-editor { font-family:var(--font-mono, monospace); font-size:0.78rem; min-height:280px; line-height:1.6; }

      /* Review */
      .aw-review-card {
        background:var(--surface-2); border:1px solid var(--border);
        border-radius:14px; overflow:hidden;
      }
      .aw-review-header {
        display:flex; align-items:center; gap:16px; padding:1.25rem;
        border-bottom:1px solid var(--border);
        background:linear-gradient(135deg, rgba(124,58,237,0.08), rgba(236,72,153,0.06));
      }
      .aw-review-photo { width:56px; height:56px; border-radius:50%; object-fit:cover; border:2px solid var(--accent); }
      .aw-review-avatar-placeholder {
        width:56px; height:56px; border-radius:50%; display:flex;
        align-items:center; justify-content:center; font-size:1.5rem;
        font-weight:800; color:#fff;
        background:linear-gradient(135deg, var(--accent), #ec4899);
      }
      .aw-review-name { font-size:1.1rem; font-weight:700; margin:0; }
      .aw-review-handle { font-size:0.78rem; color:var(--accent); }
      .aw-review-grid { display:grid; grid-template-columns:1fr 1fr; gap:1px; }
      .aw-review-item {
        display:flex; flex-direction:column; gap:2px; padding:12px 16px;
        border-bottom:1px solid rgba(255,255,255,0.03);
      }
      .aw-review-label { font-size:0.65rem; font-weight:700; color:var(--text-dim); text-transform:uppercase; }
      .aw-review-value { font-size:0.85rem; color:var(--text-muted); font-weight:500; }

      /* Footer */
      .aw-footer {
        display:flex; justify-content:space-between; align-items:center;
        padding:1rem 1.5rem; border-top:1px solid var(--border,#222);
      }
      .aw-btn {
        padding:10px 20px; border-radius:10px; font-size:0.82rem;
        font-weight:700; cursor:pointer; font-family:inherit;
        border:none; transition:all 0.15s; display:inline-flex;
        align-items:center; gap:6px;
      }
      .aw-btn--primary { background:var(--accent,#7c3aed); color:#fff; }
      .aw-btn--primary:hover { filter:brightness(1.15); }
      .aw-btn--secondary { background:var(--surface-2); color:var(--text-muted); border:1px solid var(--border); }
      .aw-btn--secondary:hover { border-color:var(--accent); }
      .aw-btn--success { background:var(--success,#22c55e); color:#000; font-weight:800; }
      .aw-btn--success:hover { filter:brightness(1.1); }
      .aw-btn:disabled { opacity:0.5; cursor:not-allowed; }

      /* Responsive */
      @media (max-width:640px) {
        .aw-modal { width:100vw; height:100vh; max-height:100vh; border-radius:0; }
        .aw-personality-grid { grid-template-columns:1fr; }
        .aw-row { flex-direction:column; }
        .aw-review-grid { grid-template-columns:1fr; }
        .aw-step-label { display:none; }
      }
    `;
    document.head.appendChild(style);
  }

  // Inject styles on load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
      injectStyles();
    }
  }

  return { open, close, next, prev, update, updatePlatform, generatePhoto, activate };
})();
