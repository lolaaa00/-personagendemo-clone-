// ═══════════════════════════════════════════════════════════════
// PersonaGen Persona Config Editor — Edit soul/tools/skills/heartbeat
// MDs in-browser with live preview. Saves to n8n data tables.
// ═══════════════════════════════════════════════════════════════

const PersonaConfigEditor = (() => {
  let selectedPersona = null;
  let activeTab = 'soul';
  let unsavedChanges = false;

  const TABS = [
    { key: 'soul',      label: '🧠 Soul',      desc: 'Identity, voice, values, behavioral directives' },
    { key: 'tools',     label: '🔧 Tools',     desc: 'Connected platforms, integrations, capabilities' },
    { key: 'skills',    label: '⚡ Skills',    desc: 'Content skills, scouting skills, learning loop' },
    { key: 'heartbeat', label: '💓 Heartbeat', desc: 'Cron schedule, scout → create → publish → analyze cycle' },
  ];

  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = renderShell();
    if (typeof INFLUENCERS !== 'undefined' && INFLUENCERS.length > 0) {
      selectPersona(INFLUENCERS[0]);
    }
  }

  function renderShell() {
    const personas = (typeof INFLUENCERS !== 'undefined') ? INFLUENCERS : [];

    return `
      <div class="pce-layout">
        <!-- Persona Sidebar -->
        <div class="pce-sidebar">
          <div class="pce-sidebar-label">Select Persona</div>
          ${personas.map((p, i) => `
            <button class="pce-persona-item ${i === 0 ? 'active' : ''}" data-handle="${p.handle}" onclick="PersonaConfigEditor.selectPersonaByHandle('${p.handle}')">
              <div class="pce-persona-avatar" style="background:${p.gradient}">${p.initial}</div>
              <div class="pce-persona-info">
                <span class="pce-persona-name">${p.name}</span>
                <span class="pce-persona-niche">${p.niche}</span>
              </div>
            </button>
          `).join('')}

          <!-- Connected Accounts Section -->
          <div class="pce-sidebar-label" style="margin-top:1.5rem;">Connected Accounts</div>
          <div class="pce-accounts" id="pce-accounts">
            <!-- Populated on persona select -->
          </div>
        </div>

        <!-- Editor Area -->
        <div class="pce-editor">
          <!-- Persona Header -->
          <div class="pce-editor-header" id="pce-editor-header">
            <div class="pce-editor-avatar" id="pce-editor-avatar">S</div>
            <div class="pce-editor-meta">
              <h3 id="pce-editor-name">Sofia Rivera</h3>
              <span id="pce-editor-handle" class="pce-editor-handle">@sofiarivera.ai</span>
              <span id="pce-editor-niche" class="pce-editor-niche">Fitness & Wellness</span>
            </div>
            <div class="pce-editor-actions">
              <button class="pce-save-btn" id="pce-save-btn" onclick="PersonaConfigEditor.save()" style="display:none;">
                💾 Save Changes
              </button>
            </div>
          </div>

          <!-- Config Tabs -->
          <div class="pce-tabs">
            ${TABS.map((t, i) => `
              <button class="pce-tab ${i === 0 ? 'active' : ''}" data-tab="${t.key}" onclick="PersonaConfigEditor.switchTab('${t.key}')">
                ${t.label}
              </button>
            `).join('')}
          </div>

          <!-- Tab Description -->
          <div class="pce-tab-desc" id="pce-tab-desc">${TABS[0].desc}</div>

          <!-- Editor Content -->
          <div class="pce-content">
            <div class="pce-editor-split">
              <div class="pce-editor-col">
                <div class="pce-editor-col-header">
                  <span>📝 Edit</span>
                  <span class="pce-unsaved-badge" id="pce-unsaved" style="display:none;">Unsaved</span>
                </div>
                <textarea class="pce-textarea" id="pce-textarea" spellcheck="false" oninput="PersonaConfigEditor.onEdit()"></textarea>
              </div>
              <div class="pce-editor-col">
                <div class="pce-editor-col-header">👁️ Preview</div>
                <div class="pce-preview" id="pce-preview"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function selectPersonaByHandle(handle) {
    const persona = INFLUENCERS.find(i => i.handle === handle);
    if (persona) selectPersona(persona);
  }

  function selectPersona(persona) {
    if (unsavedChanges) {
      // Auto-save before switching
      save();
      PersonaGenAPI.showToast('Changes auto-saved', 'info');
    }

    selectedPersona = persona;
    unsavedChanges = false;

    // Update sidebar
    document.querySelectorAll('.pce-persona-item').forEach(el => {
      el.classList.toggle('active', el.dataset.handle === persona.handle);
    });

    // Update header
    const avatar = document.getElementById('pce-editor-avatar');
    if (avatar) { avatar.textContent = persona.initial; avatar.style.background = persona.gradient; }
    const name = document.getElementById('pce-editor-name');
    if (name) name.textContent = persona.name;
    const handle = document.getElementById('pce-editor-handle');
    if (handle) handle.textContent = persona.handle;
    const niche = document.getElementById('pce-editor-niche');
    if (niche) niche.textContent = persona.niche;

    // Update accounts
    renderAccounts(persona);

    // Load active tab content
    loadTabContent();
    hideUnsaved();
  }

  function renderAccounts(persona) {
    const container = document.getElementById('pce-accounts');
    if (!container) return;

    const platforms = [
      { key: 'x',         label: 'X / Twitter', icon: '𝕏', bg: '#14171a', border: true },
      { key: 'instagram', label: 'Instagram',   icon: '📷', bg: '#e1306c', border: false },
      { key: 'tiktok',    label: 'TikTok',      icon: '♪',  bg: '#000',    border: true },
      { key: 'reddit',    label: 'Reddit',      icon: '⬆',  bg: '#ff4500', border: false },
    ];

    // Check which platforms this persona uses
    const personaPlatforms = (persona.platforms || []).map(p => p.toLowerCase().replace('twitter/x','x'));

    container.innerHTML = platforms.map(p => {
      const connected = personaPlatforms.includes(p.key) || personaPlatforms.includes(p.label.toLowerCase());
      return `
        <div class="pce-account-row">
          <div class="pce-account-icon" style="background:${p.bg};${p.border ? 'border:1px solid var(--border-strong);' : ''}">${p.icon}</div>
          <span class="pce-account-label">${p.label}</span>
          <span class="pce-account-status ${connected ? 'pce-account-status--on' : ''}">
            ${connected ? '● Active' : '○ —'}
          </span>
        </div>
      `;
    }).join('');
  }

  function switchTab(tab) {
    if (unsavedChanges) {
      // Auto-save before switching tabs
      save();
      PersonaGenAPI.showToast('Changes auto-saved', 'info');
    }

    activeTab = tab;
    unsavedChanges = false;

    document.querySelectorAll('.pce-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    const desc = document.getElementById('pce-tab-desc');
    const tabObj = TABS.find(t => t.key === tab);
    if (desc && tabObj) desc.textContent = tabObj.desc;

    loadTabContent();
    hideUnsaved();
  }

  function loadTabContent() {
    if (!selectedPersona) return;

    const textarea = document.getElementById('pce-textarea');
    if (!textarea) return;

    // Get content from persona object
    const content = selectedPersona[activeTab] || `# ${activeTab}.md — ${selectedPersona.name}\n\n(No content yet)`;

    // Unescape the \\n sequences to actual newlines
    textarea.value = content.replace(/\\n/g, '\n');
    updatePreview();
  }

  function onEdit() {
    unsavedChanges = true;
    showUnsaved();
    updatePreview();
  }

  function updatePreview() {
    const preview = document.getElementById('pce-preview');
    const textarea = document.getElementById('pce-textarea');
    if (!preview || !textarea) return;

    // Simple markdown-to-HTML conversion
    const md = textarea.value;
    const html = renderMarkdown(md);
    preview.innerHTML = html;
  }

  function renderMarkdown(md) {
    return md
      .replace(/^### (.+)$/gm, '<h4 class="pce-md-h4">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="pce-md-h3">$1</h3>')
      .replace(/^# (.+)$/gm, '<h2 class="pce-md-h2">$1</h2>')
      .replace(/^\- (.+)$/gm, '<div class="pce-md-li">• $1</div>')
      .replace(/^→ (.+)$/gm, '<div class="pce-md-arrow">→ $1</div>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/✅/g, '<span style="color:var(--success)">✅</span>')
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function showUnsaved() {
    const badge = document.getElementById('pce-unsaved');
    const btn = document.getElementById('pce-save-btn');
    if (badge) badge.style.display = 'inline-flex';
    if (btn) btn.style.display = 'inline-flex';
  }

  function hideUnsaved() {
    const badge = document.getElementById('pce-unsaved');
    const btn = document.getElementById('pce-save-btn');
    if (badge) badge.style.display = 'none';
    if (btn) btn.style.display = 'none';
  }

  async function save() {
    if (!selectedPersona) return;

    const textarea = document.getElementById('pce-textarea');
    if (!textarea) return;

    // Update persona object in memory
    selectedPersona[activeTab] = textarea.value;

    // Try to save to backend
    try {
      await PersonaWebhook.fire('persona.update', {
        persona_id: selectedPersona.handle,
        field: activeTab,
        content: textarea.value,
      });
    } catch (e) {
      console.warn('[PersonaConfig] Backend save failed, saved in memory:', e);
    }

    // Persist locally via AgentStore if available
    if (window.AgentStore) {
      window.AgentStore.updateField(selectedPersona.id, activeTab, textarea.value);
    }

    unsavedChanges = false;
    hideUnsaved();
    PersonaGenAPI.showToast(`${activeTab}.md saved for ${selectedPersona.name}`, 'success');
  }

  return { init, selectPersonaByHandle, switchTab, onEdit, save };
})();

// Auto-init on built sub-pages
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('persona-config-mount');
  if (mount && !mount.hasChildNodes()) {
    PersonaConfigEditor.init('persona-config-mount');
  }
});
