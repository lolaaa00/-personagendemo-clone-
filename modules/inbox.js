// ═══════════════════════════════════════════════════════════════
// PersonaGen Inbox Hub — Comments, DMs, Mentions management
// AI-generated reply drafts with human approval workflow
// ═══════════════════════════════════════════════════════════════

const InboxHub = (() => {
  let selectedPersona = 'all';
  let activeFilter = 'all';
  let inboxItems = [];

  // Demo data for initial display
  const DEMO_ITEMS = [
    {
      id: 'inbox_1', persona_id: '@sofiarivera.ai', persona_name: 'Sofia Rivera',
      persona_initial: 'S', persona_gradient: 'linear-gradient(135deg, #f472b6, #a78bfa)',
      platform: 'instagram', type: 'comment', from_user: '@fitnesslover92',
      content: 'OMG this workout routine is exactly what I needed! 🔥 Do you have a full version?',
      post_url: '#', status: 'ai_draft',
      ai_reply: 'Thank you so much! 💪 Yes, the full 30-minute version is linked in my bio — let me know how it goes! Remember, consistency over intensity 🙌',
      received_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'inbox_2', persona_id: '@marcuschen.tech', persona_name: 'Marcus Chen',
      persona_initial: 'M', persona_gradient: 'linear-gradient(135deg, #34d399, #60a5fa)',
      platform: 'x', type: 'mention', from_user: '@devops_daily',
      content: '@marcuschen.tech Your thread on AI infrastructure was spot on. What do you think about the new Claude 4 release?',
      post_url: '#', status: 'new',
      ai_reply: '',
      received_at: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      id: 'inbox_3', persona_id: '@sofiarivera.ai', persona_name: 'Sofia Rivera',
      persona_initial: 'S', persona_gradient: 'linear-gradient(135deg, #f472b6, #a78bfa)',
      platform: 'tiktok', type: 'comment', from_user: '@wellness.journey',
      content: 'Can you do a video on post-workout nutrition? I always struggle with what to eat after!',
      post_url: '#', status: 'ai_draft',
      ai_reply: 'Great question! 🥑 Post-workout nutrition is SO important. I\'ll film one this week — in the meantime, my go-to is protein + complex carbs within 30 min. Think Greek yogurt with berries or a smoothie bowl 🍓',
      received_at: new Date(Date.now() - 14400000).toISOString(),
    },
    {
      id: 'inbox_4', persona_id: '@aishanoori.style', persona_name: 'Aisha Noori',
      persona_initial: 'A', persona_gradient: 'linear-gradient(135deg, #fbbf24, #f97316)',
      platform: 'instagram', type: 'dm', from_user: '@luxury_brands_mena',
      content: 'Hi Aisha! We love your content and would love to discuss a potential collaboration for our Fall collection. Would you be interested?',
      post_url: '', status: 'new',
      ai_reply: '',
      received_at: new Date(Date.now() - 21600000).toISOString(),
    },
    {
      id: 'inbox_5', persona_id: '@marcuschen.tech', persona_name: 'Marcus Chen',
      persona_initial: 'M', persona_gradient: 'linear-gradient(135deg, #34d399, #60a5fa)',
      platform: 'reddit', type: 'comment', from_user: 'u/neural_architect',
      content: 'Interesting take on transformer scaling laws. Have you seen the DeepSeek paper on MoE efficiency?',
      post_url: '#', status: 'ai_draft',
      ai_reply: 'Yeah, the DeepSeek MoE work is fascinating. What stands out is their routing efficiency — they\'re getting 90% of the quality at 30% of the compute. This is exactly why I think dense models are hitting diminishing returns. The future is sparse.',
      received_at: new Date(Date.now() - 28800000).toISOString(),
    },
  ];

  const PLATFORM_ICONS = {
    x: { icon: '𝕏', bg: '#14171a', border: true },
    instagram: { icon: '📷', bg: '#e1306c', border: false },
    tiktok: { icon: '♪', bg: '#000', border: true },
    reddit: { icon: '⬆', bg: '#ff4500', border: false },
  };

  const TYPE_LABELS = {
    comment: { icon: '💬', label: 'Comment' },
    dm: { icon: '✉️', label: 'Direct Message' },
    mention: { icon: '📣', label: 'Mention' },
  };

  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    inboxItems = loadItems();
    container.innerHTML = renderShell();
    renderItems();
  }

  function loadItems() {
    const stored = localStorage.getItem('personagen_inbox');
    if (stored) {
      try { return JSON.parse(stored); } catch { /* fall through */ }
    }
    // Use demo data
    localStorage.setItem('personagen_inbox', JSON.stringify(DEMO_ITEMS));
    return [...DEMO_ITEMS];
  }

  function saveItems() {
    localStorage.setItem('personagen_inbox', JSON.stringify(inboxItems));
  }

  function renderShell() {
    const personas = (typeof INFLUENCERS !== 'undefined') ? INFLUENCERS : [];

    return `
      <div class="inbox-wrapper">
        <!-- Toolbar -->
        <div class="inbox-toolbar">
          <div class="inbox-toolbar-left">
            <div class="inbox-filter-tabs">
              <button class="inbox-filter-tab active" data-filter="all" onclick="InboxHub.setFilter('all')">All</button>
              <button class="inbox-filter-tab" data-filter="comment" onclick="InboxHub.setFilter('comment')">💬 Comments</button>
              <button class="inbox-filter-tab" data-filter="dm" onclick="InboxHub.setFilter('dm')">✉️ DMs</button>
              <button class="inbox-filter-tab" data-filter="mention" onclick="InboxHub.setFilter('mention')">📣 Mentions</button>
            </div>
          </div>
          <div class="inbox-toolbar-right">
            <select class="inbox-persona-select" onchange="InboxHub.setPersona(this.value)">
              <option value="all">All Personas</option>
              ${personas.map(p => `<option value="${p.handle}">${p.name}</option>`).join('')}
            </select>
            <div class="inbox-counter" id="inbox-counter">0 items</div>
          </div>
        </div>

        <!-- Items List -->
        <div class="inbox-list" id="inbox-list"></div>
      </div>
    `;
  }

  function renderItems() {
    const list = document.getElementById('inbox-list');
    const counter = document.getElementById('inbox-counter');
    if (!list) return;

    const filtered = inboxItems.filter(item => {
      if (activeFilter !== 'all' && item.type !== activeFilter) return false;
      if (selectedPersona !== 'all' && item.persona_id !== selectedPersona) return false;
      return true;
    });

    if (counter) counter.textContent = `${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="inbox-empty">
          <span class="inbox-empty-icon">📭</span>
          <h4>No items</h4>
          <p>When your personas receive comments, DMs, or mentions, they'll appear here with AI-generated reply drafts.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = filtered.map(item => renderItem(item)).join('');
  }

  function renderItem(item) {
    const plat = PLATFORM_ICONS[item.platform] || PLATFORM_ICONS.x;
    const type = TYPE_LABELS[item.type] || TYPE_LABELS.comment;
    const timeAgo = getTimeAgo(item.received_at);
    const isNew = item.status === 'new';
    const hasDraft = item.status === 'ai_draft' && item.ai_reply;

    return `
      <div class="inbox-item ${isNew ? 'inbox-item--new' : ''}" id="inbox-item-${item.id}">
        <div class="inbox-item-header">
          <div class="inbox-item-left">
            <div class="inbox-item-plat" style="background:${plat.bg};${plat.border ? 'border:1px solid var(--border-strong);' : ''}">${plat.icon}</div>
            <div class="inbox-item-from">
              <span class="inbox-item-username">${item.from_user}</span>
              <span class="inbox-item-type">${type.icon} ${type.label}</span>
            </div>
          </div>
          <div class="inbox-item-right">
            <div class="inbox-item-persona-badge" style="background:${item.persona_gradient}">${item.persona_initial}</div>
            <span class="inbox-item-time">${timeAgo}</span>
            ${isNew ? '<span class="inbox-item-new-badge">NEW</span>' : ''}
          </div>
        </div>

        <div class="inbox-item-content">${item.content}</div>

        ${hasDraft ? `
          <div class="inbox-item-reply-section">
            <div class="inbox-item-reply-label">🤖 AI-Generated Reply (as ${item.persona_name})</div>
            <textarea class="inbox-item-reply-text" id="reply-text-${item.id}" rows="3">${item.ai_reply}</textarea>
            <div class="inbox-item-reply-actions">
              <button class="inbox-reply-btn inbox-reply-btn--approve" onclick="InboxHub.approve('${item.id}')">✅ Approve & Send</button>
              <button class="inbox-reply-btn inbox-reply-btn--edit" onclick="InboxHub.regenerate('${item.id}')">🔄 Regenerate</button>
              <button class="inbox-reply-btn inbox-reply-btn--ignore" onclick="InboxHub.ignore('${item.id}')">🚫 Ignore</button>
            </div>
          </div>
        ` : isNew ? `
          <div class="inbox-item-reply-section">
            <div class="inbox-item-reply-actions">
              <button class="inbox-reply-btn inbox-reply-btn--approve" onclick="InboxHub.generateReply('${item.id}')">🤖 Generate AI Reply</button>
              <button class="inbox-reply-btn inbox-reply-btn--ignore" onclick="InboxHub.ignore('${item.id}')">🚫 Ignore</button>
            </div>
          </div>
        ` : `
          <div class="inbox-item-status-badge inbox-item-status--${item.status}">
            ${item.status === 'replied' ? '✅ Replied' : item.status === 'ignored' ? '🚫 Ignored' : item.status}
          </div>
        `}
      </div>
    `;
  }

  // ─── Actions ───
  async function approve(id) {
    const item = inboxItems.find(i => i.id === id);
    if (!item) return;

    const textarea = document.getElementById(`reply-text-${id}`);
    const replyText = textarea?.value || item.ai_reply;

    // Update status
    item.status = 'replied';
    item.ai_reply = replyText;
    item.replied_at = new Date().toISOString();
    saveItems();

    // Fire webhook to n8n → Composio to send the reply
    try {
      await PersonaWebhook.fire('inbox.reply', {
        inbox_id: id,
        persona_id: item.persona_id,
        platform: item.platform,
        reply_text: replyText,
        reply_to: item.from_user,
        type: item.type,
      });
    } catch (e) {
      console.warn('[Inbox] Reply webhook failed:', e);
    }

    PersonaGenAPI.showToast(`Reply sent as ${item.persona_name} on ${item.platform}`, 'success');
    renderItems();
  }

  async function generateReply(id) {
    const item = inboxItems.find(i => i.id === id);
    if (!item) return;

    const persona = INFLUENCERS?.find(i => i.handle === item.persona_id);
    if (!persona) return;

    // Try API first
    try {
      const result = await PersonaGenAPI.Generate.reply(item.persona_id, {
        message: item.content,
        from_user: item.from_user,
        type: item.type,
        platform: item.platform,
      }, item.platform);

      if (result?.success && result?.data?.reply) {
        item.ai_reply = result.data.reply;
      } else {
        // Fallback local generation
        item.ai_reply = generateLocalReply(persona, item);
      }
    } catch {
      item.ai_reply = generateLocalReply(persona, item);
    }

    item.status = 'ai_draft';
    saveItems();
    renderItems();
    PersonaGenAPI.showToast('AI reply generated — review before sending', 'info');
  }

  function generateLocalReply(persona, item) {
    const name = persona.name.split(' ')[0];
    const templates = [
      `Great question! I'll definitely cover that in an upcoming post. Stay tuned! 🙌`,
      `Thank you so much for the love! This means a lot 💯 Keep pushing!`,
      `I appreciate you bringing this up! That's an interesting perspective — I think there's a lot more nuance to explore here.`,
      `Wow, thank you! 🙏 Glad this resonated with you. More content like this coming soon!`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  async function regenerate(id) {
    const item = inboxItems.find(i => i.id === id);
    if (!item) return;
    item.status = 'new';
    item.ai_reply = '';
    saveItems();
    await generateReply(id);
  }

  function ignore(id) {
    const item = inboxItems.find(i => i.id === id);
    if (!item) return;
    item.status = 'ignored';
    saveItems();
    renderItems();
    PersonaGenAPI.showToast('Item ignored', 'info');
  }

  function setFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.inbox-filter-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.filter === filter);
    });
    renderItems();
  }

  function setPersona(value) {
    selectedPersona = value;
    renderItems();
  }

  function getTimeAgo(isoStr) {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return { init, setFilter, setPersona, approve, generateReply, regenerate, ignore };
})();
