// ═══════════════════════════════════════════════════════════════
// PersonaGen Bulk Scheduler — Wizard UI for generating and
// scheduling up to 56 posts in one session. User-driven, not
// automated. Each step is confirmed before proceeding.
// ═══════════════════════════════════════════════════════════════

const BulkScheduler = (() => {
  let step = 1;
  let config = {
    persona:   null,  // INFLUENCERS entry
    platform:  'instagram',
    startDate: null,  // Date object
    days:      7,
    startHour: 9,
    endHour:   17,
    intervalH: 1,    // hours between posts
    theme:     '',
    tone:      'engaging',
  };
  let generatedSlots = []; // { scheduledAt, content, status: idle|generating|done|error }
  let isGenerating = false;
  let genIndex = 0;
  let abortGen = false;

  // ── MOUNT POINT ──────────────────────────────────────────────
  function openWizard() {
    if (document.getElementById('bs-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'bs-overlay';
    overlay.innerHTML = `
      <div class="bs-modal" id="bs-modal">
        <div class="bs-header">
          <div class="bs-header-left">
            <span class="bs-header-icon">⚡</span>
            <div>
              <h2 class="bs-title">Bulk Schedule Generator</h2>
              <p class="bs-subtitle">AI-powered • Instagram • Multi-day campaigns</p>
            </div>
          </div>
          <button class="bs-close" onclick="BulkScheduler.close()">✕</button>
        </div>

        <!-- Step Indicator -->
        <div class="bs-steps" id="bs-steps">
          ${[
            { n:1, label:'Persona' },
            { n:2, label:'Schedule' },
            { n:3, label:'Theme' },
            { n:4, label:'Generate' },
            { n:5, label:'Confirm' },
          ].map(s => `
            <div class="bs-step" id="bs-step-ind-${s.n}" onclick="BulkScheduler.goStep(${s.n})">
              <div class="bs-step-dot">${s.n}</div>
              <span class="bs-step-label">${s.label}</span>
            </div>
          `).join('<div class="bs-step-line"></div>')}
        </div>

        <!-- Step Content -->
        <div class="bs-body" id="bs-body"></div>

        <!-- Footer -->
        <div class="bs-footer" id="bs-footer">
          <button class="bs-btn bs-btn-ghost" id="bs-back-btn" onclick="BulkScheduler.back()">← Back</button>
          <div class="bs-footer-right">
            <div class="bs-slot-count" id="bs-slot-count"></div>
            <button class="bs-btn bs-btn-primary" id="bs-next-btn" onclick="BulkScheduler.next()">Next →</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('bs-overlay--visible'));
    renderStep(1);
  }

  function close() {
    abortGen = true;
    const el = document.getElementById('bs-overlay');
    if (el) {
      el.classList.remove('bs-overlay--visible');
      setTimeout(() => el.remove(), 300);
    }
  }

  // ── STEP ROUTER ──────────────────────────────────────────────
  function goStep(n) {
    if (n < step) { step = n; renderStep(n); }
  }

  function next() {
    if (!validateStep(step)) return;
    step++;
    if (step === 4) buildSlots();
    renderStep(step);
  }

  function back() {
    if (step <= 1) { close(); return; }
    step--;
    renderStep(step);
  }

  function validateStep(s) {
    if (s === 1 && !config.persona) {
      toast('Select a persona first', 'warning'); return false;
    }
    if (s === 3 && !config.theme.trim()) {
      toast('Enter a content theme or topic', 'warning'); return false;
    }
    return true;
  }

  function renderStep(n) {
    // Update step indicators
    document.querySelectorAll('.bs-step').forEach((el, i) => {
      const sn = i > 0 ? Math.ceil((i+1)/2) : 1;
      const stepN = [1,2,3,4,5][Math.floor(i/2)];
      if (typeof stepN !== 'undefined') {
        el.classList.toggle('bs-step--active', stepN === n);
        el.classList.toggle('bs-step--done', stepN < n);
      }
    });

    const body = document.getElementById('bs-body');
    const nextBtn = document.getElementById('bs-next-btn');
    const backBtn = document.getElementById('bs-back-btn');

    backBtn.textContent = step === 1 ? '✕ Cancel' : '← Back';
    nextBtn.style.display = n === 5 ? 'none' : '';

    switch(n) {
      case 1: body.innerHTML = renderStep1(); break;
      case 2: body.innerHTML = renderStep2(); break;
      case 3: body.innerHTML = renderStep3(); break;
      case 4: body.innerHTML = renderStep4(); nextBtn.style.display = 'none'; break;
      case 5: body.innerHTML = renderStep5(); break;
    }
    updateSlotCount();
  }

  // ── STEP 1: PERSONA ──────────────────────────────────────────
  function renderStep1() {
    const influencers = (typeof INFLUENCERS !== 'undefined') ? INFLUENCERS : [];
    return `
      <div class="bs-step-content">
        <h3 class="bs-step-title">Who is posting?</h3>
        <p class="bs-step-hint">Select the AI persona that will own this campaign</p>
        <div class="bs-persona-grid">
          ${influencers.map(inf => `
            <div class="bs-persona-card ${config.persona?.handle === inf.handle ? 'bs-persona-card--active' : ''}"
                 onclick="BulkScheduler.selectPersona('${inf.handle}')">
              <div class="bs-persona-avatar" style="background:${inf.gradient}">${inf.initial}</div>
              <div class="bs-persona-info">
                <div class="bs-persona-name">${inf.name}</div>
                <div class="bs-persona-niche">${inf.niche || inf.handle}</div>
              </div>
              <div class="bs-persona-check">✓</div>
            </div>
          `).join('')}
        </div>

        <div class="bs-field bs-mt">
          <label class="bs-label">Platform</label>
          <div class="bs-plat-pills">
            ${[
              { key:'instagram', icon:'📷', label:'Instagram' },
              { key:'x',        icon:'𝕏', label:'X / Twitter' },
              { key:'tiktok',   icon:'♪', label:'TikTok' },
            ].map(p => `
              <button class="bs-plat-pill ${config.platform === p.key ? 'bs-plat-pill--active' : ''}"
                      onclick="BulkScheduler.selectPlatform('${p.key}', this)">
                <span class="bs-plat-pill-icon">${p.icon}</span> ${p.label}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function selectPersona(handle) {
    const inf = (typeof INFLUENCERS !== 'undefined') ? INFLUENCERS.find(i => i.handle === handle) : null;
    if (inf) config.persona = inf;
    document.querySelectorAll('.bs-persona-card').forEach(c => {
      c.classList.toggle('bs-persona-card--active', c.onclick?.toString().includes(handle));
    });
    // Re-render to update active state cleanly
    document.getElementById('bs-body').innerHTML = renderStep1();
  }

  function selectPlatform(key, btn) {
    config.platform = key;
    document.querySelectorAll('.bs-plat-pill').forEach(b => b.classList.remove('bs-plat-pill--active'));
    btn.classList.add('bs-plat-pill--active');
  }

  // ── STEP 2: SCHEDULE ─────────────────────────────────────────
  function renderStep2() {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    if (!config.startDate) config.startDate = today;

    return `
      <div class="bs-step-content">
        <h3 class="bs-step-title">Set your posting schedule</h3>
        <p class="bs-step-hint">Define the date range and posting frequency</p>

        <div class="bs-fields-row">
          <div class="bs-field">
            <label class="bs-label">Start Date</label>
            <input type="date" class="bs-input" id="bs-start-date"
                   value="${config.startDate.toISOString().split('T')[0]}"
                   min="${todayStr}"
                   onchange="BulkScheduler.updateConfig('startDate', new Date(this.value + 'T00:00:00'))">
          </div>
          <div class="bs-field">
            <label class="bs-label">Number of Days</label>
            <select class="bs-input" id="bs-days"
                    onchange="BulkScheduler.updateConfig('days', +this.value)">
              ${[1,3,5,7,10,14].map(d => `<option value="${d}" ${config.days===d?'selected':''}>${d} day${d>1?'s':''}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="bs-fields-row">
          <div class="bs-field">
            <label class="bs-label">Post from</label>
            <select class="bs-input" onchange="BulkScheduler.updateConfig('startHour', +this.value)">
              ${Array.from({length:13},(_,i)=>i+7).map(h => `
                <option value="${h}" ${config.startHour===h?'selected':''}>${h}:00 ${h<12?'AM':'PM'}</option>
              `).join('')}
            </select>
          </div>
          <div class="bs-field">
            <label class="bs-label">Until</label>
            <select class="bs-input" onchange="BulkScheduler.updateConfig('endHour', +this.value)">
              ${Array.from({length:13},(_,i)=>i+9).map(h => `
                <option value="${h}" ${config.endHour===h?'selected':''}>${h}:00 ${h<12?'AM':'PM'}</option>
              `).join('')}
            </select>
          </div>
          <div class="bs-field">
            <label class="bs-label">Every</label>
            <select class="bs-input" onchange="BulkScheduler.updateConfig('intervalH', +this.value)">
              ${[1,2,3,4,6].map(h => `
                <option value="${h}" ${config.intervalH===h?'selected':''}>${h} hour${h>1?'s':''}</option>
              `).join('')}
            </select>
          </div>
        </div>

        <div class="bs-schedule-preview" id="bs-sched-preview">
          ${renderSchedulePreview()}
        </div>
      </div>
    `;
  }

  function renderSchedulePreview() {
    const slots = computeSlots();
    const byDay = {};
    slots.slice(0, 14).forEach(dt => {
      const day = dt.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(dt.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }));
    });
    const moreSlots = slots.length > 14 ? slots.length - 14 : 0;

    return `
      <div class="bs-sched-header">
        <span class="bs-sched-total">${slots.length} posts planned</span>
        <span class="bs-sched-meta">${config.days} days · ${config.startHour}–${config.endHour}h · every ${config.intervalH}h</span>
      </div>
      <div class="bs-sched-days">
        ${Object.entries(byDay).map(([day, times]) => `
          <div class="bs-sched-day">
            <div class="bs-sched-day-label">${day}</div>
            <div class="bs-sched-times">${times.map(t => `<span class="bs-time-chip">${t}</span>`).join('')}</div>
          </div>
        `).join('')}
        ${moreSlots > 0 ? `<div class="bs-sched-more">+ ${moreSlots} more slots</div>` : ''}
      </div>
    `;
  }

  // ── STEP 3: THEME ────────────────────────────────────────────
  function renderStep3() {
    return `
      <div class="bs-step-content">
        <h3 class="bs-step-title">What's the content theme?</h3>
        <p class="bs-step-hint">Describe the topic and tone — the AI will generate unique posts for each slot</p>

        <div class="bs-field">
          <label class="bs-label">Content Theme / Topic</label>
          <textarea class="bs-textarea" id="bs-theme" placeholder="e.g., Morning fitness motivation, gym tips, workout routines, healthy eating habits, transformation stories..."
                    onInput="BulkScheduler.updateConfig('theme', this.value)">${config.theme}</textarea>
          <div class="bs-theme-examples">
            <span class="bs-theme-ex-label">Quick picks:</span>
            ${[
              'Fitness & morning motivation',
              'Luxury fashion & style tips',
              'AI & tech insights',
              'Healthy recipes & meal prep',
              'Travel & hidden gems',
              'Crypto & investing',
            ].map(ex => `
              <button class="bs-theme-ex" onclick="BulkScheduler.setTheme('${ex}')">${ex}</button>
            `).join('')}
          </div>
        </div>

        <div class="bs-fields-row bs-mt">
          <div class="bs-field">
            <label class="bs-label">Tone</label>
            <select class="bs-input" onchange="BulkScheduler.updateConfig('tone', this.value)">
              ${[
                ['engaging', '🔥 Engaging & Bold'],
                ['inspirational', '✨ Inspirational'],
                ['educational', '📚 Educational'],
                ['casual', '😊 Casual & Fun'],
                ['luxury', '💎 Premium & Aspirational'],
              ].map(([v,l]) => `<option value="${v}" ${config.tone===v?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="bs-field">
            <label class="bs-label">Hashtag Style</label>
            <select class="bs-input" id="bs-hashtag-style">
              <option value="niche">Niche (5–8 targeted)</option>
              <option value="broad">Broad (10–15 mixed)</option>
              <option value="viral">Viral-focused (trending)</option>
              <option value="none">No hashtags</option>
            </select>
          </div>
        </div>

        <div class="bs-info-box">
          <span class="bs-info-icon">ℹ️</span>
          Each post slot gets a <strong>unique prompt</strong> — no repeated content. The AI
          follows ${config.persona?.name || 'the persona'}'s voice and writing style.
        </div>
      </div>
    `;
  }

  function setTheme(theme) {
    config.theme = theme;
    const ta = document.getElementById('bs-theme');
    if (ta) ta.value = theme;
  }

  // ── STEP 4: GENERATE ─────────────────────────────────────────
  function buildSlots() {
    const rawSlots = computeSlots();
    generatedSlots = rawSlots.map(dt => ({
      scheduledAt: dt.toISOString(),
      label: dt.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
              + ' ' + dt.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }),
      content: null,
      status: 'idle',  // idle | generating | done | error
      hashtags: [],
    }));
  }

  function renderStep4() {
    const total = generatedSlots.length;
    const done = generatedSlots.filter(s => s.status === 'done').length;

    return `
      <div class="bs-step-content bs-step-content--generate">
        <div class="bs-gen-header">
          <div>
            <h3 class="bs-step-title">Generate AI Content</h3>
            <p class="bs-step-hint">Click Generate to create unique content for all ${total} scheduled slots</p>
          </div>
          <div class="bs-gen-controls">
            <button class="bs-btn bs-btn-primary" id="bs-gen-btn" onclick="BulkScheduler.startGeneration()">
              🤖 Generate All ${total} Posts
            </button>
            ${done > 0 ? `<button class="bs-btn bs-btn-ghost" onclick="BulkScheduler.proceedToConfirm()">Review → (${done} ready)</button>` : ''}
          </div>
        </div>

        <div class="bs-gen-progress" id="bs-gen-progress" style="${done === 0 ? 'display:none' : ''}">
          <div class="bs-gen-bar-wrap">
            <div class="bs-gen-bar" id="bs-gen-bar" style="width:${total ? (done/total*100).toFixed(0)+'%' : '0%'}"></div>
          </div>
          <span class="bs-gen-progress-label" id="bs-gen-label">${done}/${total} generated</span>
        </div>

        <div class="bs-slots-list" id="bs-slots-list">
          ${generatedSlots.map((slot, i) => renderSlotRow(slot, i)).join('')}
        </div>
      </div>
    `;
  }

  function renderSlotRow(slot, i) {
    const statusIcons = {
      idle:       '<span class="bs-slot-status bs-slot-status--idle">⏳</span>',
      generating: '<span class="bs-slot-status bs-slot-status--gen"><div class="bs-spinner"></div></span>',
      done:       '<span class="bs-slot-status bs-slot-status--done">✓</span>',
      error:      '<span class="bs-slot-status bs-slot-status--err">⚠</span>',
    };

    return `
      <div class="bs-slot-row ${slot.status === 'done' ? 'bs-slot-row--done' : ''}" id="bs-slot-${i}">
        <div class="bs-slot-time">${slot.label}</div>
        <div class="bs-slot-body">
          ${slot.content
            ? `<div class="bs-slot-text">${slot.content.substring(0, 120)}${slot.content.length > 120 ? '…' : ''}</div>
               <div class="bs-slot-tags">${slot.hashtags.slice(0,4).map(h=>`<span class="bs-slot-tag">${h}</span>`).join('')}</div>`
            : `<div class="bs-slot-placeholder">Content will appear here after generation</div>`
          }
        </div>
        <div class="bs-slot-actions">
          ${statusIcons[slot.status] || ''}
          ${slot.status === 'done' ? `<button class="bs-slot-edit" onclick="BulkScheduler.editSlot(${i})" title="Edit">✏️</button>` : ''}
        </div>
      </div>
    `;
  }

  async function startGeneration() {
    if (isGenerating) return;
    abortGen = false;
    isGenerating = true;
    genIndex = 0;

    const genBtn = document.getElementById('bs-gen-btn');
    if (genBtn) {
      genBtn.innerHTML = '<div class="bs-spinner bs-spinner--sm"></div> Generating… <button class="bs-stop-btn" onclick="BulkScheduler.stopGeneration()">Stop</button>';
      genBtn.disabled = true;
    }

    const progressWrap = document.getElementById('bs-gen-progress');
    if (progressWrap) progressWrap.style.display = 'flex';

    const total = generatedSlots.length;

    for (let i = 0; i < total; i++) {
      if (abortGen) break;
      genIndex = i;

      // Skip already done
      if (generatedSlots[i].status === 'done') {
        updateSlotUI(i);
        continue;
      }

      // Mark as generating
      generatedSlots[i].status = 'generating';
      updateSlotUI(i);
      updateProgress();

      try {
        const result = await generateSlotContent(i);
        if (result) {
          generatedSlots[i].content = result.text;
          generatedSlots[i].hashtags = result.hashtags || [];
          generatedSlots[i].status = 'done';
        } else {
          generatedSlots[i].status = 'error';
        }
      } catch (e) {
        generatedSlots[i].status = 'error';
      }

      updateSlotUI(i);
      updateProgress();
      await sleep(400); // Small delay between calls
    }

    isGenerating = false;
    const done = generatedSlots.filter(s => s.status === 'done').length;

    if (genBtn) {
      genBtn.innerHTML = done === total
        ? `✅ All ${total} Generated — Review & Schedule →`
        : `🔄 Regenerate Failed (${total - done} errors)`;
      genBtn.disabled = false;
      if (done === total) {
        genBtn.onclick = () => BulkScheduler.proceedToConfirm();
        genBtn.classList.add('bs-btn--success');
      }
    }

    if (done > 0) {
      toast(`${done}/${total} posts generated! Review and confirm to schedule.`, 'success');
    }
  }

  async function generateSlotContent(i) {
    const slot = generatedSlots[i];
    const persona = config.persona;
    const platform = config.platform;
    const hashtagStyle = document.getElementById('bs-hashtag-style')?.value || 'niche';

    // Build unique prompt for this slot
    const slotLabel = slot.label;
    const prompt = `
      Create a ${config.tone} ${platform} post for ${persona.name} (${persona.niche || 'influencer'}).
      Topic: ${config.theme}.
      Slot: ${slotLabel}.
      Hashtag style: ${hashtagStyle}.
      Make it feel natural, authentic, and native to ${platform}.
      Do NOT repeat content from other posts in this campaign.
      Return JSON: { "text": "...", "hashtags": ["#tag1", "#tag2", ...] }
    `.trim();

    try {
      // Try n8n Content Forge first
      const res = await fetch(PersonaGenAPI._endpoints().contentForge, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_id: persona.handle,
          platforms: [platform],
          prompt,
          soul: persona.soul || '',
          tone: config.tone,
        })
      });

      if (res.ok) {
        const data = await res.json();
        // Try to parse JSON from LLM response
        const raw = data.text || data.content || JSON.stringify(data);
        const jsonMatch = raw.match(/\{[\s\S]*"text"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.text) return parsed;
          } catch(_) {}
        }
        // Fallback: treat whole thing as text
        if (data.text && data.text.length > 10) {
          return { text: data.text, hashtags: data.hashtags || [] };
        }
      }
    } catch(e) {
      console.warn('[BulkScheduler] API call failed, using local fallback:', e);
    }

    // Local fallback generation
    return localFallbackContent(i);
  }

  function localFallbackContent(i) {
    const persona = config.persona;
    const themes = config.theme.split(',').map(t => t.trim()).filter(Boolean);
    const theme = themes[i % themes.length] || config.theme;
    const hour = new Date(generatedSlots[i].scheduledAt).getHours();
    const timeOfDay = hour < 10 ? 'morning' : hour < 13 ? 'midday' : hour < 17 ? 'afternoon' : 'evening';

    const templates = [
      { text: `This ${timeOfDay} reminder: ${theme} is not about perfection — it's about progress. 💪\n\nSmall steps daily beat big leaps occasionally. Trust the process.\n\nWho else is working on their goals today? Drop a 🔥 below.`, hashtags: [`#${theme.replace(/\s+/g,'').toLowerCase()}`, '#motivation', '#progress', '#personagen'] },
      { text: `POV: You've been consistent with ${theme} for 30 days and the results are real.\n\nThe secret? You stopped waiting for the "perfect moment" and just started.\n\nTag someone who needs to see this today. 👇`, hashtags: [`#${theme.replace(/\s+/g,'').toLowerCase()}`, '#consistency', '#results', '#growth'] },
      { text: `Real talk about ${theme}: Most people give up right before the breakthrough.\n\nI've been there. The plateau is part of the process, not the end of it.\n\nKeep going. Your future self is watching. ✨`, hashtags: [`#${theme.replace(/\s+/g,'').toLowerCase()}`, '#mindset', '#breakthrough', '#keepgoing'] },
      { text: `3 things I wish I knew when I started with ${theme}:\n\n1️⃣ Start before you're ready\n2️⃣ Done is better than perfect\n3️⃣ Community matters more than you think\n\nWhich one hits hardest? 🎯`, hashtags: [`#${theme.replace(/\s+/g,'').toLowerCase()}`, '#tips', '#lessons', '#creator'] },
      { text: `${timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1)} energy ✨\n\nFocused on ${theme} today and the momentum is building. \n\nWhat are YOU working on right now? Let's motivate each other 👇`, hashtags: [`#${theme.replace(/\s+/g,'').toLowerCase()}`, '#${timeOfDay}', '#focus', '#grind'] },
    ];

    return templates[i % templates.length];
  }

  function updateSlotUI(i) {
    const el = document.getElementById(`bs-slot-${i}`);
    if (el) el.outerHTML = renderSlotRow(generatedSlots[i], i);
  }

  function updateProgress() {
    const total = generatedSlots.length;
    const done = generatedSlots.filter(s => s.status === 'done').length;
    const pct = total ? (done / total * 100).toFixed(0) : 0;
    const bar = document.getElementById('bs-gen-bar');
    const label = document.getElementById('bs-gen-label');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = `${done}/${total} generated`;
  }

  function stopGeneration() {
    abortGen = true;
    isGenerating = false;
    toast('Generation paused — you can resume or proceed with what\'s ready', 'info');
    const genBtn = document.getElementById('bs-gen-btn');
    if (genBtn) {
      genBtn.innerHTML = '🤖 Resume Generation';
      genBtn.disabled = false;
    }
  }

  function editSlot(i) {
    const slot = generatedSlots[i];
    const newText = prompt('Edit post content:', slot.content);
    if (newText !== null) {
      generatedSlots[i].content = newText;
      updateSlotUI(i);
    }
  }

  function proceedToConfirm() {
    step = 5;
    renderStep(5);
  }

  // ── STEP 5: CONFIRM ──────────────────────────────────────────
  function renderStep5() {
    const done = generatedSlots.filter(s => s.status === 'done');
    const persona = config.persona;

    return `
      <div class="bs-step-content">
        <h3 class="bs-step-title">Review & Confirm Schedule</h3>
        <p class="bs-step-hint">${done.length} posts ready to schedule as ${persona?.name}  on ${platformLabel(config.platform)}</p>

        <div class="bs-confirm-summary">
          <div class="bs-confirm-stat">
            <div class="bs-confirm-stat-num">${done.length}</div>
            <div class="bs-confirm-stat-label">Posts Ready</div>
          </div>
          <div class="bs-confirm-stat">
            <div class="bs-confirm-stat-num">${config.days}</div>
            <div class="bs-confirm-stat-label">Days</div>
          </div>
          <div class="bs-confirm-stat">
            <div class="bs-confirm-stat-num">${config.startHour}–${config.endHour}h</div>
            <div class="bs-confirm-stat-label">Daily Window</div>
          </div>
          <div class="bs-confirm-stat">
            <div class="bs-confirm-stat-num">${config.intervalH}h</div>
            <div class="bs-confirm-stat-label">Interval</div>
          </div>
        </div>

        <div class="bs-confirm-list">
          ${done.slice(0, 8).map((slot, i) => `
            <div class="bs-confirm-row">
              <span class="bs-confirm-time">${slot.label}</span>
              <span class="bs-confirm-text">${(slot.content || '').substring(0, 80)}…</span>
            </div>
          `).join('')}
          ${done.length > 8 ? `<div class="bs-confirm-more">+ ${done.length - 8} more posts</div>` : ''}
        </div>

        <div class="bs-confirm-actions">
          <button class="bs-btn bs-btn-ghost" onclick="BulkScheduler.goStep(4)">← Edit Content</button>
          <button class="bs-btn bs-btn-success bs-btn-lg" id="bs-schedule-btn"
                  onclick="BulkScheduler.scheduleAll()">
            📅 Schedule All ${done.length} Posts
          </button>
        </div>
      </div>
    `;
  }

  async function scheduleAll() {
    const btn = document.getElementById('bs-schedule-btn');
    if (btn) { btn.innerHTML = '<div class="bs-spinner bs-spinner--sm"></div> Scheduling…'; btn.disabled = true; }

    const done = generatedSlots.filter(s => s.status === 'done');
    let savedCount = 0;

    for (const slot of done) {
      const post = {
        id:              uuid(),
        persona_id:      config.persona.handle,
        persona_name:    config.persona.name,
        persona_initial: config.persona.initial,
        persona_gradient:config.persona.gradient,
        platforms:       [config.platform],
        content: {
          text:      slot.content,
          hashtags:  slot.hashtags || [],
          media_url: null,
          privacy:   'public',
        },
        status:       'scheduled',
        scheduled_at: slot.scheduledAt,
        timezone:     'America/New_York',
        created_at:   new Date().toISOString(),
        generation_source: 'bulk-scheduler',
      };

      // Save locally first (always works)
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.Local.savePost(post);
      } else {
        const posts = JSON.parse(localStorage.getItem('pg_posts') || '[]');
        posts.push(post);
        localStorage.setItem('pg_posts', JSON.stringify(posts));
      }

      // Also push to n8n Post Manager (best-effort)
      try {
        await PersonaGenAPI.Posts.create(post);
      } catch(e) { /* local save is the source of truth */ }

      savedCount++;
    }

    // Refresh calendar
    if (typeof DynamicCalendar !== 'undefined') DynamicCalendar.refresh();

    toast(`🎉 ${savedCount} posts scheduled! Check your content calendar.`, 'success');
    close();

    // Navigate to calendar tab if possible
    const calTab = document.querySelector('[data-tab="calendar"], [onclick*="calendar"]');
    if (calTab) calTab.click();
  }

  // ── HELPERS ──────────────────────────────────────────────────
  function computeSlots() {
    const slots = [];
    const start = config.startDate instanceof Date
      ? new Date(config.startDate)
      : new Date();

    for (let d = 0; d < config.days; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + d);
      for (let h = config.startHour; h <= config.endHour; h += config.intervalH) {
        const dt = new Date(day);
        dt.setHours(h, 0, 0, 0);
        slots.push(new Date(dt));
      }
    }
    return slots;
  }

  function updateConfig(key, value) {
    config[key] = value;
    // Re-render schedule preview if on step 2
    if (step === 2) {
      const preview = document.getElementById('bs-sched-preview');
      if (preview) preview.innerHTML = renderSchedulePreview();
    }
    updateSlotCount();
  }

  function updateSlotCount() {
    const el = document.getElementById('bs-slot-count');
    if (!el) return;
    const count = computeSlots().length;
    el.textContent = count > 0 ? `${count} posts` : '';
  }

  function platformLabel(key) {
    return { instagram:'Instagram', x:'X / Twitter', tiktok:'TikTok' }[key] || key;
  }

  function uuid() {
    return 'bs_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,6);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function toast(msg, type) {
    if (typeof PersonaGenAPI !== 'undefined' && PersonaGenAPI.showToast) {
      PersonaGenAPI.showToast(msg, type);
    } else {
      console.log(`[BulkScheduler] ${type}: ${msg}`);
    }
  }

  return {
    openWizard, close, next, back, goStep,
    selectPersona, selectPlatform, updateConfig, setTheme,
    startGeneration, stopGeneration, editSlot, proceedToConfirm, scheduleAll,
  };
})();
