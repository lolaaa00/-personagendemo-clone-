// ═══════════════════════════════════════════════════════════════
// PersonaGen Post Composer — Full-screen modal for creating,
// editing, and scheduling posts across multiple platforms.
// ═══════════════════════════════════════════════════════════════

const PostComposer = (() => {
  let currentPost = null;   // null = new post, object = editing
  let selectedPlatforms = new Set();
  let hashtags = [];
  let uploadedMedia = null;
  let isGenerating = false;

  // Platform config
  const PLATFORMS = {
    x:         { label: 'X / Twitter',  icon: '𝕏', color: '#14171a', charLimit: 280,  border: 'var(--border-strong)' },
    instagram: { label: 'Instagram',    icon: '📷', color: '#e1306c', charLimit: 2200, border: '' },
    tiktok:    { label: 'TikTok',       icon: '♪',  color: '#000',    charLimit: 2200, border: 'var(--border-strong)' },
    reddit:    { label: 'Reddit',       icon: '⬆',  color: '#ff4500', charLimit: 40000, border: '' },
  };

  // ─── Render Modal HTML ───
  function renderModal() {
    if (document.getElementById('composer-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'composer-modal';
    modal.className = 'composer-overlay';
    modal.innerHTML = `
      <div class="composer-container">
        <!-- Header -->
        <div class="composer-header">
          <div class="composer-header-left">
            <h2 class="composer-title">✏️ <span id="composer-mode-label">New Post</span></h2>
            <span class="composer-subtitle" id="composer-subtitle">Compose and publish across platforms</span>
          </div>
          <div class="composer-header-right">
            <button class="composer-close-btn" onclick="PostComposer.close()" title="Close">✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="composer-body">
          <!-- Left Column: Editor -->
          <div class="composer-editor">

            <!-- Persona Selector -->
            <div class="composer-field">
              <label class="composer-label">Posting As</label>
              <div class="composer-persona-select" id="composer-persona-select">
                <!-- Populated dynamically -->
              </div>
            </div>

            <!-- Platform Selector -->
            <div class="composer-field">
              <label class="composer-label">Platforms</label>
              <div class="composer-platforms" id="composer-platforms">
                ${Object.entries(PLATFORMS).map(([key, p]) => `
                  <button class="composer-plat-chip" data-platform="${key}" onclick="PostComposer.togglePlatform('${key}')">
                    <span class="composer-plat-icon" style="background:${p.color};${p.border ? 'border:1px solid '+p.border+';' : ''}">${p.icon}</span>
                    <span>${p.label}</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <!-- Content -->
            <div class="composer-field">
              <label class="composer-label">
                Content
                <button class="composer-ai-btn" id="composer-ai-btn" onclick="PostComposer.generateWithAI()" title="Generate with AI">
                  🤖 Generate with AI
                </button>
              </label>
              <textarea class="composer-textarea" id="composer-content" placeholder="Write your post content here..." oninput="PostComposer.updateCharCounts()"></textarea>
              <div class="composer-char-counts" id="composer-char-counts"></div>
            </div>

            <!-- AI Prompt (hidden by default, shown when AI btn clicked) -->
            <div class="composer-field composer-ai-prompt-wrap" id="composer-ai-prompt-wrap" style="display:none;">
              <label class="composer-label">🤖 AI Generation Prompt</label>
              <div class="composer-ai-prompt-row">
                <input type="text" class="composer-ai-input" id="composer-ai-prompt" placeholder="e.g., Write a motivational morning post about consistency...">
                <button class="composer-ai-go" id="composer-ai-go" onclick="PostComposer.runGeneration()">Generate →</button>
              </div>
            </div>

            <!-- Hashtags -->
            <div class="composer-field">
              <label class="composer-label">Hashtags</label>
              <div class="composer-tags-container" id="composer-tags" onclick="document.getElementById('composer-tag-input').focus()">
                <input type="text" class="composer-tag-input" id="composer-tag-input" placeholder="Type and press Enter..." onkeydown="PostComposer.handleTagKey(event)">
              </div>
            </div>

            <!-- Media Upload -->
            <div class="composer-field">
              <label class="composer-label">Media</label>
              <div class="composer-upload" id="composer-upload" onclick="PostComposer.simulateUpload()">
                <div class="composer-upload-inner" id="composer-upload-inner">
                  <span class="composer-upload-icon">🎥</span>
                  <span class="composer-upload-text">Click to upload image or video</span>
                  <span class="composer-upload-hint">JPEG, PNG, MP4, MOV · Max 100 MB</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Settings -->
          <div class="composer-settings">
            <!-- Schedule -->
            <div class="composer-field">
              <label class="composer-label">Schedule</label>
              <div class="composer-schedule-options">
                <button class="composer-sched-btn active" data-sched="now" onclick="PostComposer.setSchedule('now')">Post Now</button>
                <button class="composer-sched-btn" data-sched="schedule" onclick="PostComposer.setSchedule('schedule')">Schedule</button>
                <button class="composer-sched-btn" data-sched="draft" onclick="PostComposer.setSchedule('draft')">Save Draft</button>
              </div>
              <div class="composer-datetime-wrap" id="composer-datetime-wrap" style="display:none;">
                <input type="date" class="composer-date-input" id="composer-date">
                <input type="time" class="composer-time-input" id="composer-time" value="09:00">
                <select class="composer-tz-select" id="composer-tz">
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">London (GMT)</option>
                  <option value="Asia/Dubai">Dubai (GST)</option>
                </select>
              </div>
            </div>

            <!-- Privacy -->
            <div class="composer-field">
              <label class="composer-label">Privacy</label>
              <select class="composer-select" id="composer-privacy">
                <option value="public">🌍 Public — Anyone can view</option>
                <option value="friends">👥 Friends Only</option>
                <option value="private">🔒 Private — Only you</option>
              </select>
            </div>

            <!-- Reddit-specific: Subreddit -->
            <div class="composer-field" id="composer-reddit-field" style="display:none;">
              <label class="composer-label">Subreddit</label>
              <input type="text" class="composer-text-input" id="composer-subreddit" placeholder="e.g., r/socialmedia">
            </div>

            <!-- Disclosures -->
            <div class="composer-field">
              <label class="composer-label">Content Disclosures</label>
              <div class="composer-toggles">
                <div class="composer-toggle-row">
                  <span class="composer-toggle-label">Branded Content</span>
                  <div class="composer-toggle" id="toggle-branded" onclick="PostComposer.toggle(this)"></div>
                </div>
                <div class="composer-toggle-row">
                  <span class="composer-toggle-label">Allow Comments</span>
                  <div class="composer-toggle composer-toggle--on" id="toggle-comments" onclick="PostComposer.toggle(this)"></div>
                </div>
                <div class="composer-toggle-row">
                  <span class="composer-toggle-label">Allow Duets / Remixes</span>
                  <div class="composer-toggle composer-toggle--on" id="toggle-duets" onclick="PostComposer.toggle(this)"></div>
                </div>
              </div>
            </div>

            <!-- Platform Preview -->
            <div class="composer-field">
              <label class="composer-label">Preview</label>
              <div class="composer-preview" id="composer-preview">
                <div class="composer-preview-empty">Select platforms and write content to see preview</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="composer-footer">
          <button class="composer-footer-btn composer-btn-ghost" onclick="PostComposer.close()">Cancel</button>
          <button class="composer-footer-btn composer-btn-draft" onclick="PostComposer.saveDraft()">💾 Save Draft</button>
          <button class="composer-footer-btn composer-btn-primary" id="composer-submit-btn" onclick="PostComposer.submit()">
            🚀 Publish Now
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // ─── Open / Close ───
  function open(editPost = null, prefillDate = null) {
    renderModal();
    currentPost = editPost;
    selectedPlatforms.clear();
    hashtags = [];
    uploadedMedia = null;

    // Populate persona selector
    const personaSelect = document.getElementById('composer-persona-select');
    if (personaSelect && typeof INFLUENCERS !== 'undefined') {
      personaSelect.innerHTML = INFLUENCERS.map((inf, i) => `
        <button class="composer-persona-chip ${i === 0 ? 'active' : ''}" data-persona="${inf.handle}" onclick="PostComposer.selectPersona(this, '${inf.handle}')">
          <div class="composer-persona-avatar" style="background:${inf.gradient}">${inf.initial}</div>
          <span>${inf.name.split(' ')[0]}</span>
        </button>
      `).join('');
    }

    // Reset form
    const content = document.getElementById('composer-content');
    if (content) content.value = editPost?.content?.text || '';

    // Set date if prefilled
    if (prefillDate) {
      const dateInput = document.getElementById('composer-date');
      if (dateInput) dateInput.value = prefillDate;
      setSchedule('schedule');
    }

    // If editing, populate fields
    if (editPost) {
      document.getElementById('composer-mode-label').textContent = 'Edit Post';
      if (editPost.platforms) {
        editPost.platforms.forEach(p => togglePlatform(p));
      }
      if (editPost.content?.hashtags) {
        editPost.content.hashtags.forEach(tag => addTag(tag));
      }
      if (editPost.status === 'scheduled') {
        setSchedule('schedule');
        if (editPost.scheduled_at) {
          const dt = new Date(editPost.scheduled_at);
          document.getElementById('composer-date').value = dt.toISOString().split('T')[0];
          document.getElementById('composer-time').value = dt.toTimeString().slice(0, 5);
        }
      }
    } else {
      document.getElementById('composer-mode-label').textContent = 'New Post';
    }

    // Show modal
    requestAnimationFrame(() => {
      document.getElementById('composer-modal').classList.add('composer-overlay--visible');
    });

    updateCharCounts();
  }

  function close() {
    const modal = document.getElementById('composer-modal');
    if (modal) {
      modal.classList.remove('composer-overlay--visible');
      setTimeout(() => { if (modal.parentNode) modal.remove(); }, 300);
    }
  }

  // ─── Platform Toggle ───
  function togglePlatform(key) {
    if (selectedPlatforms.has(key)) selectedPlatforms.delete(key);
    else selectedPlatforms.add(key);

    // Update chips
    document.querySelectorAll('.composer-plat-chip').forEach(chip => {
      chip.classList.toggle('active', selectedPlatforms.has(chip.dataset.platform));
    });

    // Show/hide reddit field
    const redditField = document.getElementById('composer-reddit-field');
    if (redditField) redditField.style.display = selectedPlatforms.has('reddit') ? 'block' : 'none';

    updateCharCounts();
    updatePreview();
  }

  // ─── Persona Selection ───
  function selectPersona(btn, handle) {
    document.querySelectorAll('.composer-persona-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  }

  function getSelectedPersona() {
    const active = document.querySelector('.composer-persona-chip.active');
    if (!active) return INFLUENCERS[0];
    const handle = active.dataset.persona;
    return INFLUENCERS.find(i => i.handle === handle) || INFLUENCERS[0];
  }

  // ─── Char Counts ───
  function updateCharCounts() {
    const content = document.getElementById('composer-content')?.value || '';
    const countsEl = document.getElementById('composer-char-counts');
    if (!countsEl) return;

    if (selectedPlatforms.size === 0) {
      countsEl.innerHTML = '<span class="composer-char-item">Select platforms to see limits</span>';
      return;
    }

    countsEl.innerHTML = Array.from(selectedPlatforms).map(key => {
      const p = PLATFORMS[key];
      const len = content.length;
      const over = len > p.charLimit;
      return `<span class="composer-char-item ${over ? 'composer-char--over' : ''}">
        ${p.icon} ${len}/${p.charLimit.toLocaleString()}
      </span>`;
    }).join('');

    updatePreview();
  }

  // ─── Preview ───
  function updatePreview() {
    const previewEl = document.getElementById('composer-preview');
    if (!previewEl) return;
    const content = document.getElementById('composer-content')?.value || '';
    const persona = getSelectedPersona();

    if (!content || selectedPlatforms.size === 0) {
      previewEl.innerHTML = '<div class="composer-preview-empty">Select platforms and write content to see preview</div>';
      return;
    }

    const tags = hashtags.map(t => `<span style="color:var(--cyan);">${t}</span>`).join(' ');

    previewEl.innerHTML = Array.from(selectedPlatforms).map(key => {
      const p = PLATFORMS[key];
      const truncated = content.length > p.charLimit
        ? content.substring(0, p.charLimit - 3) + '...'
        : content;
      return `
        <div class="composer-preview-card">
          <div class="composer-preview-header">
            <span class="composer-preview-plat-icon" style="background:${p.color};${p.border ? 'border:1px solid '+p.border+';' : ''}">${p.icon}</span>
            <span class="composer-preview-plat-name">${p.label}</span>
          </div>
          <div class="composer-preview-meta">
            <div class="composer-preview-avatar" style="background:${persona.gradient}">${persona.initial}</div>
            <span class="composer-preview-handle">${persona.handle}</span>
          </div>
          <div class="composer-preview-text">${truncated}</div>
          ${tags ? `<div class="composer-preview-tags">${tags}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // ─── Hashtags ───
  function handleTagKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const input = document.getElementById('composer-tag-input');
    let val = input.value.trim();
    if (!val) return;
    if (!val.startsWith('#')) val = '#' + val;
    addTag(val);
    input.value = '';
  }

  function addTag(val) {
    if (hashtags.includes(val)) return;
    hashtags.push(val);
    renderTags();
    updatePreview();
  }

  function removeTag(idx) {
    hashtags.splice(idx, 1);
    renderTags();
    updatePreview();
  }

  function renderTags() {
    const container = document.getElementById('composer-tags');
    if (!container) return;
    const input = document.getElementById('composer-tag-input');
    container.innerHTML = hashtags.map((tag, i) => `
      <span class="composer-tag">${tag} <span class="composer-tag-x" onclick="PostComposer.removeTag(${i})">×</span></span>
    `).join('') + '<input type="text" class="composer-tag-input" id="composer-tag-input" placeholder="Type and press Enter..." onkeydown="PostComposer.handleTagKey(event)">';
  }

  // ─── Schedule ───
  function setSchedule(type) {
    document.querySelectorAll('.composer-sched-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sched === type);
    });
    const dtWrap = document.getElementById('composer-datetime-wrap');
    if (dtWrap) dtWrap.style.display = type === 'schedule' ? 'flex' : 'none';

    const submitBtn = document.getElementById('composer-submit-btn');
    if (submitBtn) {
      if (type === 'now') submitBtn.innerHTML = '🚀 Publish Now';
      else if (type === 'schedule') submitBtn.innerHTML = '📅 Schedule Post';
      else submitBtn.innerHTML = '💾 Save Draft';
    }
  }

  function getScheduleType() {
    const active = document.querySelector('.composer-sched-btn.active');
    return active?.dataset.sched || 'now';
  }

  // ─── Toggle Switches ───
  function toggle(el) {
    el.classList.toggle('composer-toggle--on');
  }

  // ─── Upload Simulation ───
  function simulateUpload() {
    const inner = document.getElementById('composer-upload-inner');
    const zone = document.getElementById('composer-upload');
    if (!inner || zone.classList.contains('composer-upload--done')) return;

    inner.innerHTML = `<div class="composer-upload-loading"><div class="pg-spinner"></div> Uploading...</div>`;

    setTimeout(() => {
      uploadedMedia = { name: 'content_video_' + Date.now() + '.mp4', size: '18.4 MB', duration: '0:32' };
      zone.classList.add('composer-upload--done');
      inner.innerHTML = `
        <div class="composer-upload-file">
          <span class="composer-upload-file-icon">🎬</span>
          <div class="composer-upload-file-info">
            <span class="composer-upload-file-name">${uploadedMedia.name}</span>
            <span class="composer-upload-file-meta">${uploadedMedia.size} · ${uploadedMedia.duration} · 1080×1920</span>
          </div>
          <span class="composer-upload-file-check">✓</span>
        </div>
      `;
    }, 1500);
  }

  // ─── AI Generation ───
  function generateWithAI() {
    const wrap = document.getElementById('composer-ai-prompt-wrap');
    if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
  }

  async function runGeneration() {
    if (isGenerating) return;
    isGenerating = true;
    const btn = document.getElementById('composer-ai-go');
    const prompt = document.getElementById('composer-ai-prompt')?.value;
    const persona = getSelectedPersona();
    const platforms = Array.from(selectedPlatforms);

    if (!prompt) {
      PersonaGenAPI.showToast('Enter a prompt for the AI', 'warning');
      isGenerating = false;
      return;
    }

    btn.innerHTML = '<div class="pg-spinner pg-spinner--sm"></div>';
    btn.disabled = true;

    try {
      // Try API first, fallback to local generation
      const result = await PersonaGenAPI.Generate.content(persona.handle, prompt, platforms);

      if (result?.success && result?.data?.text) {
        document.getElementById('composer-content').value = result.data.text;
        if (result.data.hashtags) {
          hashtags = result.data.hashtags.map(t => t.startsWith('#') ? t : '#' + t);
          renderTags();
        }
      } else {
        // Fallback: local demo generation
        const demoContent = generateLocalContent(persona, prompt, platforms);
        document.getElementById('composer-content').value = demoContent.text;
        hashtags = demoContent.hashtags;
        renderTags();
      }

      updateCharCounts();
      PersonaGenAPI.showToast('Content generated! Review and edit before posting.', 'success');
    } catch (err) {
      console.error('[Composer] AI generation failed:', err);
      PersonaGenAPI.showToast('Generation failed — using demo content', 'warning');
      const demoContent = generateLocalContent(persona, prompt, []);
      document.getElementById('composer-content').value = demoContent.text;
    } finally {
      btn.innerHTML = 'Generate →';
      btn.disabled = false;
      isGenerating = false;
    }
  }

  // Local fallback content generation (demo mode)
  function generateLocalContent(persona, prompt, platforms) {
    const name = persona.name.split(' ')[0];
    const templates = [
      `Real talk: ${prompt}\n\nI've been thinking about this a lot lately, and here's what I've learned — consistency beats perfection every single time. 💯\n\nThe key isn't doing everything right. It's showing up, even when it's messy.\n\nWhat's your take? Drop a comment 👇`,
      `POV: You finally ${prompt.toLowerCase()}\n\nThis is the content I wish I had when I started. No gatekeeping here — just pure value.\n\nSave this for later, you'll thank me. 🔖`,
      `3 things I learned about ${prompt.toLowerCase()} that nobody talks about:\n\n1️⃣ It's not about talent, it's about systems\n2️⃣ Most people quit right before the breakthrough\n3️⃣ Your network is your net worth\n\nWhich one hits hardest? 🎯`,
    ];
    const text = templates[Math.floor(Math.random() * templates.length)];
    const tagWords = prompt.split(' ').filter(w => w.length > 3).slice(0, 3);
    const tags = tagWords.map(w => '#' + w.toLowerCase().replace(/[^a-z0-9]/g, ''));
    tags.push('#personagen', '#contentcreator');
    return { text, hashtags: tags };
  }

  // ─── Submit ───
  async function submit() {
    const content = document.getElementById('composer-content')?.value;
    const persona = getSelectedPersona();
    const schedType = getScheduleType();

    if (!content) {
      PersonaGenAPI.showToast('Please write some content first', 'warning');
      return;
    }
    if (selectedPlatforms.size === 0) {
      PersonaGenAPI.showToast('Select at least one platform', 'warning');
      return;
    }

    const post = {
      id: currentPost?.id || PersonaGenAPI.Local.uuid(),
      persona_id: persona.handle,
      persona_name: persona.name,
      persona_initial: persona.initial,
      persona_gradient: persona.gradient,
      platforms: Array.from(selectedPlatforms),
      content: {
        text: content,
        hashtags: [...hashtags],
        media_url: uploadedMedia?.name || null,
        privacy: document.getElementById('composer-privacy')?.value || 'public',
        subreddit: document.getElementById('composer-subreddit')?.value || null,
      },
      status: schedType === 'draft' ? 'draft' : schedType === 'schedule' ? 'scheduled' : 'publishing',
      scheduled_at: null,
      timezone: document.getElementById('composer-tz')?.value || 'America/New_York',
      created_at: currentPost?.created_at || new Date().toISOString(),
      generation_source: 'manual',
    };

    // Set scheduled time
    if (schedType === 'schedule') {
      const date = document.getElementById('composer-date')?.value;
      const time = document.getElementById('composer-time')?.value;
      if (!date || !time) {
        PersonaGenAPI.showToast('Please select a date and time', 'warning');
        return;
      }
      post.scheduled_at = new Date(`${date}T${time}`).toISOString();
    }

    // Save locally first
    PersonaGenAPI.Local.savePost(post);

    // Try to save to backend
    try {
      if (currentPost) {
        await PersonaGenAPI.Posts.update(post.id, post);
      } else {
        await PersonaGenAPI.Posts.create(post);
      }
    } catch (e) {
      console.warn('[Composer] Backend save failed, post saved locally:', e);
    }

    // For immediate publishes, call the Post Publisher pipeline
    if (schedType === 'now') {
      const submitBtn = document.getElementById('composer-submit-btn');
      if (submitBtn) { submitBtn.innerHTML = '<div class="pg-spinner pg-spinner--sm"></div> Publishing...'; submitBtn.disabled = true; }
      
      try {
        const publishResult = await PersonaGenAPI.Publish.now(post);
        
        if (publishResult?.success) {
          const platforms = publishResult.data?.results || [];
          const successCount = platforms.filter(r => r.success).length;
          
          // Update local post status
          post.status = 'published';
          post.published_at = new Date().toISOString();
          post.publish_results = platforms;
          PersonaGenAPI.Local.savePost(post);
          
          PersonaGenAPI.showToast(`🚀 Published to ${successCount}/${selectedPlatforms.size} platform${successCount !== 1 ? 's' : ''}!`, 'success');
        } else {
          // Publisher returned but failed
          post.status = 'failed';
          PersonaGenAPI.Local.savePost(post);
          PersonaGenAPI.showToast('⚠️ Publishing attempted — check post status for details', 'warning');
        }
      } catch (err) {
        console.warn('[Composer] Publish pipeline error:', err);
        PersonaGenAPI.showToast('Publishing queued — will retry automatically', 'info');
      }
      
      if (submitBtn) { submitBtn.innerHTML = '🚀 Publish Now'; submitBtn.disabled = false; }
    } else {
      const msgs = {
        draft: '💾 Draft saved!',
        schedule: `📅 Scheduled for ${document.getElementById('composer-date')?.value} at ${document.getElementById('composer-time')?.value}`,
      };
      PersonaGenAPI.showToast(msgs[schedType] || 'Post saved');
    }
    
    close();

    // Refresh calendar if it exists
    if (typeof DynamicCalendar !== 'undefined') DynamicCalendar.refresh();
  }

  function saveDraft() {
    // Force draft mode and submit
    document.querySelectorAll('.composer-sched-btn').forEach(b => b.classList.remove('active'));
    const draftBtn = document.querySelector('.composer-sched-btn[data-sched="draft"]');
    if (draftBtn) draftBtn.classList.add('active');
    submit();
  }

  // ─── Public API ───
  return {
    open, close, togglePlatform, selectPersona, updateCharCounts,
    handleTagKey, removeTag, setSchedule, toggle, simulateUpload,
    generateWithAI, runGeneration, submit, saveDraft, renderModal,
    getSelectedPersona, PLATFORMS,
  };
})();
