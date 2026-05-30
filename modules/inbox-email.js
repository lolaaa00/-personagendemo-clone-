// ═══════════════════════════════════════════════════════════════
// PersonaGen Inbox — Email & SMS Channel Module
// AgenticMail integration with AI draft replies & thread views
// ═══════════════════════════════════════════════════════════════

const InboxEmail = (() => {
  let items = [];
  let activeSubFilter = 'all';
  let activeChannel = 'email'; // 'email' | 'sms'
  let expandedThreads = {};

  // ─── Demo Data ───
  const DEMO_EMAIL_ITEMS = [
    {
      id: 'email_1',
      channel: 'email',
      persona_id: '@aishanoori.style',
      persona_name: 'Aisha Noori',
      persona_initial: 'A',
      persona_gradient: 'linear-gradient(135deg, #fbbf24, #f97316)',
      from_user: 'partnerships@luxebrand.com',
      from_name: 'Luxe Brand Partnerships',
      subject: 'Collaboration Opportunity — Fall 2026 Collection',
      body_preview: 'Hi Aisha, we\'ve been following your work and absolutely love the direction you\'re taking with luxury fashion content. We\'d love to explore a partnership for our upcoming Fall 2026 collection launch...',
      body_full: 'Hi Aisha,\n\nWe\'ve been following your work and absolutely love the direction you\'re taking with luxury fashion content.\n\nWe\'d love to explore a partnership for our upcoming Fall 2026 collection launch. The campaign would include:\n\n• 3 dedicated Instagram posts featuring our hero pieces\n• 1 TikTok unboxing/styling video\n• Story coverage during our exclusive preview event in Dubai\n\nCompensation: $4,500 + gifted pieces from the collection.\n\nWould you be available for a quick call this week to discuss?\n\nBest regards,\nSarah Kim\nHead of Influencer Partnerships\nLuxe Brand',
      status: 'ai_draft',
      ai_reply: 'Hi Sarah,\n\nThank you so much for reaching out — I\'m truly flattered by the kind words about my content! ✨\n\nThe Fall 2026 collection sounds absolutely stunning, and I\'d love to explore this partnership further. The campaign structure aligns perfectly with my content style.\n\nI\'m available for a call on Thursday or Friday this week. Would either work for you?\n\nLooking forward to connecting!\n\nWarm regards,\nAisha',
      category: 'inbox',
      thread_id: 'thread_luxe_1',
      thread_messages: [
        {
          id: 'msg_1a',
          from: 'partnerships@luxebrand.com',
          from_name: 'Sarah Kim',
          date: new Date(Date.now() - 86400000).toISOString(),
          body: 'Hi Aisha,\n\nWe\'ve been following your work and absolutely love the direction you\'re taking with luxury fashion content.\n\nWe\'d love to explore a partnership for our upcoming Fall 2026 collection launch. The campaign would include:\n\n• 3 dedicated Instagram posts featuring our hero pieces\n• 1 TikTok unboxing/styling video\n• Story coverage during our exclusive preview event in Dubai\n\nCompensation: $4,500 + gifted pieces from the collection.\n\nWould you be available for a quick call this week to discuss?\n\nBest regards,\nSarah Kim'
        }
      ],
      received_at: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: 'email_2',
      channel: 'email',
      persona_id: '@sofiarivera.ai',
      persona_name: 'Sofia Rivera',
      persona_initial: 'S',
      persona_gradient: 'linear-gradient(135deg, #f472b6, #a78bfa)',
      from_user: 'jessica.m@gmail.com',
      from_name: 'Jessica Martinez',
      subject: 'Your 30-day challenge literally changed my life 🙌',
      body_preview: 'Sofia!! I just finished your 30-day fitness challenge and I can\'t believe the results. I lost 12 pounds and my energy levels are through the roof...',
      body_full: 'Sofia!!\n\nI just finished your 30-day fitness challenge and I can\'t believe the results. I lost 12 pounds and my energy levels are through the roof!\n\nI\'ve been telling everyone about your program. My sister and two of my coworkers are starting it next week.\n\nDo you have any plans for an advanced version? I\'d pay anything for a level 2!\n\nThank you for everything,\nJessica 💪',
      status: 'ai_draft',
      ai_reply: 'Jessica!! 😭💕\n\nThis message made my entire WEEK! I am SO proud of you — 12 pounds and more energy? That\'s the dream combo right there!\n\nAnd the fact that you\'re inspiring your sister and coworkers?? That\'s what community is all about 🙌\n\nGuess what — Level 2 is actually in the works! I\'m designing it right now with progressive overload and more advanced HIIT circuits. Stay tuned!\n\nKeep crushing it queen 👑\nSofia',
      category: 'inbox',
      thread_id: 'thread_jessica_1',
      thread_messages: [
        {
          id: 'msg_2a',
          from: 'jessica.m@gmail.com',
          from_name: 'Jessica Martinez',
          date: new Date(Date.now() - 7200000).toISOString(),
          body: 'Sofia!!\n\nI just finished your 30-day fitness challenge and I can\'t believe the results. I lost 12 pounds and my energy levels are through the roof!\n\nI\'ve been telling everyone about your program. My sister and two of my coworkers are starting it next week.\n\nDo you have any plans for an advanced version? I\'d pay anything for a level 2!\n\nThank you for everything,\nJessica 💪'
        }
      ],
      received_at: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      id: 'email_3',
      channel: 'email',
      persona_id: '@marcuschen.tech',
      persona_name: 'Marcus Chen',
      persona_initial: 'M',
      persona_gradient: 'linear-gradient(135deg, #34d399, #60a5fa)',
      from_user: 'editor@ainewsletter.io',
      from_name: 'AI Weekly Newsletter',
      subject: 'Guest Column Invitation — AI Infrastructure Trends Q3',
      body_preview: 'Marcus, your recent thread on transformer scaling economics went viral. We\'d love to feature you as a guest columnist in our Q3 edition...',
      body_full: 'Marcus,\n\nYour recent thread on transformer scaling economics went viral in our community — over 2M impressions!\n\nWe\'d love to feature you as a guest columnist in our Q3 edition of AI Weekly. The piece would reach 180K subscribers across enterprise AI decision-makers.\n\nTopic: Your take on the MoE vs Dense model debate\nLength: 1,500-2,000 words\nDeadline: July 15, 2026\nCompensation: $2,000\n\nInterested?\n\nBest,\nDaniel Torres\nEditor-in-Chief, AI Weekly',
      status: 'new',
      ai_reply: '',
      category: 'inbox',
      thread_id: 'thread_ainews_1',
      thread_messages: [
        {
          id: 'msg_3a',
          from: 'editor@ainewsletter.io',
          from_name: 'Daniel Torres',
          date: new Date(Date.now() - 43200000).toISOString(),
          body: 'Marcus,\n\nYour recent thread on transformer scaling economics went viral in our community — over 2M impressions!\n\nWe\'d love to feature you as a guest columnist in our Q3 edition of AI Weekly. The piece would reach 180K subscribers across enterprise AI decision-makers.\n\nTopic: Your take on the MoE vs Dense model debate\nLength: 1,500-2,000 words\nDeadline: July 15, 2026\nCompensation: $2,000\n\nInterested?\n\nBest,\nDaniel Torres\nEditor-in-Chief, AI Weekly'
        }
      ],
      received_at: new Date(Date.now() - 43200000).toISOString(),
    },
    {
      id: 'email_4',
      channel: 'email',
      persona_id: '@sofiarivera.ai',
      persona_name: 'Sofia Rivera',
      persona_initial: 'S',
      persona_gradient: 'linear-gradient(135deg, #f472b6, #a78bfa)',
      from_user: 'noreply@fitbrands.co',
      from_name: 'FitBrands Newsletter',
      subject: 'Top 10 Fitness Creators to Watch in 2026',
      body_preview: 'You\'ve been selected as one of the Top 10 Fitness Creators to Watch in 2026! See the full list and your feature...',
      body_full: 'Congratulations!\n\nYou\'ve been selected as one of the Top 10 Fitness Creators to Watch in 2026 by FitBrands Magazine.\n\nYour feature highlights your innovative approach to blending tech-driven fitness with authentic Latina representation.\n\nThe full article goes live on June 5th. We\'d love a quote from you to include.\n\nPlease reply by June 2nd.\n\nThe FitBrands Team',
      status: 'ai_draft',
      ai_reply: 'Hi FitBrands Team!\n\nWow, what an incredible honor! 🙏 Thank you so much for including me in this amazing list.\n\nHere\'s a quote you can use:\n\n"Fitness isn\'t one-size-fits-all, and neither is representation. My mission is to show every Latina that strength looks like HER — on her terms, in her skin, with her story." — Sofia Rivera\n\nLet me know if you need anything else!\n\nCon cariño,\nSofia ❤️',
      category: 'inbox',
      thread_id: 'thread_fitbrands_1',
      thread_messages: [
        {
          id: 'msg_4a',
          from: 'noreply@fitbrands.co',
          from_name: 'FitBrands Team',
          date: new Date(Date.now() - 172800000).toISOString(),
          body: 'Congratulations!\n\nYou\'ve been selected as one of the Top 10 Fitness Creators to Watch in 2026 by FitBrands Magazine.\n\nYour feature highlights your innovative approach to blending tech-driven fitness with authentic Latina representation.\n\nThe full article goes live on June 5th. We\'d love a quote from you to include.\n\nPlease reply by June 2nd.\n\nThe FitBrands Team'
        }
      ],
      received_at: new Date(Date.now() - 172800000).toISOString(),
    },
  ];

  const DEMO_SMS_ITEMS = [
    {
      id: 'sms_1',
      channel: 'sms',
      persona_id: '@sofiarivera.ai',
      persona_name: 'Sofia Rivera',
      persona_initial: 'S',
      persona_gradient: 'linear-gradient(135deg, #f472b6, #a78bfa)',
      from_user: '+1 (305) 555-0147',
      from_name: 'Unknown',
      subject: '',
      body_preview: 'Hey Sofia! Saw your reel about morning routines. What protein powder do you use? My trainer recommended your page 🏋️‍♀️',
      body_full: 'Hey Sofia! Saw your reel about morning routines. What protein powder do you use? My trainer recommended your page 🏋️‍♀️',
      status: 'ai_draft',
      ai_reply: 'Hey! Thanks for reaching out 💪 I use Orgain Organic Plant-Based — the vanilla chai flavor is amazing in smoothies! Your trainer has good taste 😄 Let me know how you like it!',
      category: 'received',
      thread_id: 'sms_thread_1',
      thread_messages: [],
      received_at: new Date(Date.now() - 5400000).toISOString(),
    },
    {
      id: 'sms_2',
      channel: 'sms',
      persona_id: '@marcuschen.tech',
      persona_name: 'Marcus Chen',
      persona_initial: 'M',
      persona_gradient: 'linear-gradient(135deg, #34d399, #60a5fa)',
      from_user: '+1 (415) 555-0293',
      from_name: 'Unknown',
      subject: '',
      body_preview: 'Marcus, this is David from TechCrunch. We spoke at the AI Summit. Can we schedule that interview? DM me your availability.',
      body_full: 'Marcus, this is David from TechCrunch. We spoke at the AI Summit. Can we schedule that interview? DM me your availability.',
      status: 'new',
      ai_reply: '',
      category: 'received',
      thread_id: 'sms_thread_2',
      thread_messages: [],
      received_at: new Date(Date.now() - 10800000).toISOString(),
    },
    {
      id: 'sms_3',
      channel: 'sms',
      persona_id: '@aishanoori.style',
      persona_name: 'Aisha Noori',
      persona_initial: 'A',
      persona_gradient: 'linear-gradient(135deg, #fbbf24, #f97316)',
      from_user: '+971 50 555 8821',
      from_name: 'Unknown',
      subject: '',
      body_preview: 'Hi Aisha, this is Fatima from Dubai Fashion Week organizing committee. Quick question about your availability for the Sep showcase 🌟',
      body_full: 'Hi Aisha, this is Fatima from Dubai Fashion Week organizing committee. Quick question about your availability for the Sep showcase. We have a front row seat with your name on it, and would love for you to cover backstage content. Let me know! 🌟',
      status: 'ai_draft',
      ai_reply: 'Hi Fatima! ✨ Thank you so much for thinking of me for Dubai Fashion Week — that sounds absolutely incredible! I\'d love to be there for the September showcase. Front row + backstage access is a dream! Let me check my calendar and I\'ll confirm by tomorrow. So excited! 🌟',
      category: 'received',
      thread_id: 'sms_thread_3',
      thread_messages: [],
      received_at: new Date(Date.now() - 18000000).toISOString(),
    },
  ];

  // ─── Storage ───
  function loadItems() {
    const key = 'personagen_inbox_email';
    const stored = localStorage.getItem(key);
    if (stored) {
      try { return JSON.parse(stored); } catch { /* fall through */ }
    }
    const all = [...DEMO_EMAIL_ITEMS, ...DEMO_SMS_ITEMS];
    localStorage.setItem(key, JSON.stringify(all));
    return [...all];
  }

  function saveItems() {
    localStorage.setItem('personagen_inbox_email', JSON.stringify(items));
  }

  // ─── Init ───
  function init() {
    items = loadItems();
  }

  // ─── Rendering ───
  function renderItems(channel, subFilter, personaFilter) {
    activeChannel = channel || activeChannel;
    activeSubFilter = subFilter || 'all';

    const list = document.getElementById('inbox-list');
    const counter = document.getElementById('inbox-counter');
    if (!list) return;

    const filtered = items.filter(item => {
      if (item.channel !== activeChannel) return false;
      if (activeSubFilter !== 'all') {
        if (activeChannel === 'email' && activeSubFilter !== item.category) return false;
        if (activeChannel === 'sms' && activeSubFilter === 'sent' && item.category !== 'sent') return false;
        if (activeChannel === 'sms' && activeSubFilter === 'received' && item.category === 'sent') return false;
      }
      if (personaFilter && personaFilter !== 'all' && item.persona_id !== personaFilter) return false;
      return true;
    });

    if (counter) counter.textContent = `${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;

    if (filtered.length === 0) {
      const emptyIcon = activeChannel === 'email' ? '📧' : '📱';
      const emptyLabel = activeChannel === 'email' ? 'email' : 'SMS';
      list.innerHTML = `
        <div class="inbox-empty">
          <span class="inbox-empty-icon">${emptyIcon}</span>
          <h4>No ${emptyLabel} items</h4>
          <p>When your personas receive ${emptyLabel} messages, they'll appear here with AI-generated reply drafts.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = filtered.map(item => activeChannel === 'email' ? renderEmailItem(item) : renderSmsItem(item)).join('');
  }

  function renderEmailItem(item) {
    const timeAgo = getTimeAgo(item.received_at);
    const isNew = item.status === 'new';
    const hasDraft = item.status === 'ai_draft' && item.ai_reply;
    const isExpanded = expandedThreads[item.id];

    return `
      <div class="inbox-item inbox-email-item ${isNew ? 'inbox-item--new' : ''}" id="inbox-item-${item.id}">
        <div class="inbox-email-header" onclick="InboxEmail.toggleThread('${item.id}')">
          <div class="inbox-email-header-left">
            <div class="inbox-email-sender-avatar" style="background:${item.persona_gradient}">${item.persona_initial}</div>
            <div class="inbox-email-meta">
              <div class="inbox-email-from-row">
                <span class="inbox-email-from-name">${item.from_name}</span>
                <span class="inbox-email-from-addr">&lt;${item.from_user}&gt;</span>
              </div>
              <div class="inbox-email-subject">${item.subject}</div>
              <div class="inbox-email-preview">${item.body_preview}</div>
            </div>
          </div>
          <div class="inbox-email-header-right">
            <div class="inbox-item-persona-badge" style="background:${item.persona_gradient}" title="${item.persona_name}">${item.persona_initial}</div>
            <span class="inbox-item-time">${timeAgo}</span>
            ${isNew ? '<span class="inbox-item-new-badge">NEW</span>' : ''}
            <span class="inbox-email-expand-icon">${isExpanded ? '▼' : '▶'}</span>
          </div>
        </div>

        ${isExpanded ? `
          <div class="inbox-email-thread">
            ${(item.thread_messages || []).map(msg => `
              <div class="inbox-email-thread-msg">
                <div class="inbox-email-thread-msg-header">
                  <strong>${msg.from_name || msg.from}</strong>
                  <span class="inbox-item-time">${getTimeAgo(msg.date)}</span>
                </div>
                <div class="inbox-email-thread-msg-body">${(msg.body || '').replace(/\n/g, '<br>')}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${hasDraft ? `
          <div class="inbox-item-reply-section inbox-email-reply-section">
            <div class="inbox-item-reply-label">🤖 AI-Generated Reply (as ${item.persona_name})</div>
            <textarea class="inbox-item-reply-text" id="reply-text-${item.id}" rows="4">${item.ai_reply}</textarea>
            <div class="inbox-item-reply-actions">
              <button class="inbox-reply-btn inbox-reply-btn--approve" onclick="InboxEmail.approve('${item.id}')">✅ Approve & Send</button>
              <button class="inbox-reply-btn inbox-reply-btn--edit" onclick="InboxEmail.regenerate('${item.id}')">🔄 Regenerate</button>
              <button class="inbox-reply-btn inbox-reply-btn--ignore" onclick="InboxEmail.ignore('${item.id}')">🚫 Ignore</button>
            </div>
          </div>
        ` : isNew ? `
          <div class="inbox-item-reply-section">
            <div class="inbox-item-reply-actions">
              <button class="inbox-reply-btn inbox-reply-btn--approve" onclick="InboxEmail.generateDraft('${item.id}')">🤖 Generate AI Reply</button>
              <button class="inbox-reply-btn inbox-reply-btn--ignore" onclick="InboxEmail.ignore('${item.id}')">🚫 Ignore</button>
            </div>
          </div>
        ` : `
          <div class="inbox-item-status-badge inbox-item-status--${item.status}">
            ${item.status === 'replied' ? '✅ Replied' : item.status === 'ignored' ? '🚫 Ignored' : item.status === 'sent' ? '📤 Sent' : item.status}
          </div>
        `}
      </div>
    `;
  }

  function renderSmsItem(item) {
    const timeAgo = getTimeAgo(item.received_at);
    const isNew = item.status === 'new';
    const hasDraft = item.status === 'ai_draft' && item.ai_reply;

    return `
      <div class="inbox-item inbox-email-sms-item ${isNew ? 'inbox-item--new' : ''}" id="inbox-item-${item.id}">
        <div class="inbox-item-header">
          <div class="inbox-item-left">
            <div class="inbox-item-plat" style="background:#34a853;">📱</div>
            <div class="inbox-item-from">
              <span class="inbox-item-username">${item.from_user}</span>
              <span class="inbox-item-type">📱 SMS via Google Voice</span>
            </div>
          </div>
          <div class="inbox-item-right">
            <div class="inbox-item-persona-badge" style="background:${item.persona_gradient}">${item.persona_initial}</div>
            <span class="inbox-item-time">${timeAgo}</span>
            ${isNew ? '<span class="inbox-item-new-badge">NEW</span>' : ''}
          </div>
        </div>

        <div class="inbox-item-content">${item.body_full}</div>

        ${hasDraft ? `
          <div class="inbox-item-reply-section">
            <div class="inbox-item-reply-label">🤖 AI-Generated Reply (as ${item.persona_name})</div>
            <textarea class="inbox-item-reply-text" id="reply-text-${item.id}" rows="3">${item.ai_reply}</textarea>
            <div class="inbox-item-reply-actions">
              <button class="inbox-reply-btn inbox-reply-btn--approve" onclick="InboxEmail.approve('${item.id}')">✅ Approve & Send</button>
              <button class="inbox-reply-btn inbox-reply-btn--edit" onclick="InboxEmail.regenerate('${item.id}')">🔄 Regenerate</button>
              <button class="inbox-reply-btn inbox-reply-btn--ignore" onclick="InboxEmail.ignore('${item.id}')">🚫 Ignore</button>
            </div>
          </div>
        ` : isNew ? `
          <div class="inbox-item-reply-section">
            <div class="inbox-item-reply-actions">
              <button class="inbox-reply-btn inbox-reply-btn--approve" onclick="InboxEmail.generateDraft('${item.id}')">🤖 Generate AI Reply</button>
              <button class="inbox-reply-btn inbox-reply-btn--ignore" onclick="InboxEmail.ignore('${item.id}')">🚫 Ignore</button>
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

  // ─── Thread Toggle ───
  function toggleThread(id) {
    expandedThreads[id] = !expandedThreads[id];
    renderItems();
  }

  // ─── Actions ───
  async function approve(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;

    const textarea = document.getElementById(`reply-text-${id}`);
    const replyText = textarea?.value || item.ai_reply;

    item.status = 'replied';
    item.ai_reply = replyText;
    item.replied_at = new Date().toISOString();
    saveItems();

    // Try API
    try {
      if (item.channel === 'email') {
        await PersonaGenAPI.Email.approve(id);
      }
      await PersonaWebhook.fire(`${item.channel}.reply`, {
        inbox_id: id,
        persona_id: item.persona_id,
        channel: item.channel,
        reply_text: replyText,
        reply_to: item.from_user,
      });
    } catch (e) {
      console.warn('[InboxEmail] Reply webhook failed:', e);
    }

    const channelLabel = item.channel === 'email' ? 'email' : 'SMS';
    PersonaGenAPI.showToast(`${channelLabel} reply sent as ${item.persona_name}`, 'success');
    renderItems();
  }

  async function generateDraft(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;

    // Try API first
    try {
      const result = await PersonaGenAPI.Email.draft(item.persona_id, id);
      if (result?.success && result?.data?.reply) {
        item.ai_reply = result.data.reply;
      } else {
        item.ai_reply = generateLocalDraft(item);
      }
    } catch {
      item.ai_reply = generateLocalDraft(item);
    }

    item.status = 'ai_draft';
    saveItems();
    renderItems();
    PersonaGenAPI.showToast('AI reply draft generated — review before sending', 'info');
  }

  function generateLocalDraft(item) {
    if (item.channel === 'sms') {
      const templates = [
        'Hey! Thanks for reaching out 😊 Really appreciate the message. Let me get back to you on that!',
        'Hi there! Great to hear from you! I\'ll check on this and follow up shortly 🙌',
        'Thanks for the message! Love hearing from you. Let me look into that and circle back 💪',
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }

    const templates = [
      `Thank you so much for reaching out! I really appreciate you taking the time to write. Let me review this carefully and I'll get back to you within 24 hours.\n\nBest regards`,
      `Hi there!\n\nThank you for your kind words and thoughtful message. This means so much to me!\n\nI'd love to discuss this further — let me check my schedule and follow up soon.\n\nWarmly`,
      `Thank you for reaching out! I'm excited about this opportunity and would love to learn more.\n\nLet me review the details and I'll respond with my thoughts by end of day.\n\nBest`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  async function regenerate(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.status = 'new';
    item.ai_reply = '';
    saveItems();
    await generateDraft(id);
  }

  function ignore(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.status = 'ignored';
    saveItems();
    renderItems();
    PersonaGenAPI.showToast('Item ignored', 'info');
  }

  // ─── Compose ───
  function compose() {
    const existing = document.getElementById('inbox-email-compose-overlay');
    if (existing) existing.remove();

    const personas = (typeof INFLUENCERS !== 'undefined') ? INFLUENCERS : [];

    const overlay = document.createElement('div');
    overlay.id = 'inbox-email-compose-overlay';
    overlay.className = 'inbox-email-compose-overlay';
    overlay.innerHTML = `
      <div class="inbox-email-compose-modal">
        <div class="inbox-email-compose-header">
          <h3>✉️ Compose Email</h3>
          <button class="composer-close-btn" onclick="InboxEmail.closeCompose()">✕</button>
        </div>
        <div class="inbox-email-compose-body">
          <div class="inbox-email-compose-field">
            <label class="composer-label">Send As</label>
            <select class="inbox-persona-select" id="compose-persona" style="width:100%;">
              ${personas.map(p => `<option value="${p.handle}">${p.name} (${p.handle})</option>`).join('')}
            </select>
          </div>
          <div class="inbox-email-compose-field">
            <label class="composer-label">To</label>
            <input type="email" class="bb-input" id="compose-to" placeholder="recipient@example.com">
          </div>
          <div class="inbox-email-compose-field">
            <label class="composer-label">Subject</label>
            <input type="text" class="bb-input" id="compose-subject" placeholder="Email subject...">
          </div>
          <div class="inbox-email-compose-field">
            <label class="composer-label">Message</label>
            <textarea class="bb-textarea" id="compose-body" rows="8" placeholder="Write your message..."></textarea>
          </div>
          <div class="inbox-email-compose-field">
            <button class="inbox-email-compose-ai-btn" onclick="InboxEmail.aiComposeAssist()">
              🤖 AI Assist — Generate draft from context
            </button>
          </div>
        </div>
        <div class="inbox-email-compose-footer">
          <button class="composer-footer-btn composer-btn-ghost" onclick="InboxEmail.closeCompose()">Cancel</button>
          <button class="composer-footer-btn composer-btn-primary" onclick="InboxEmail.sendComposed()">📤 Send Email</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  function closeCompose() {
    const overlay = document.getElementById('inbox-email-compose-overlay');
    if (overlay) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
    }
  }

  async function sendComposed() {
    const persona = document.getElementById('compose-persona')?.value;
    const to = document.getElementById('compose-to')?.value?.trim();
    const subject = document.getElementById('compose-subject')?.value?.trim();
    const body = document.getElementById('compose-body')?.value?.trim();

    if (!to || !subject || !body) {
      PersonaGenAPI.showToast('Please fill in all fields', 'warning');
      return;
    }

    try {
      await PersonaGenAPI.Email.send(persona, { to, subject, body });
    } catch (e) {
      console.warn('[InboxEmail] Send failed (offline):', e);
    }

    // Add to local items as sent
    const newItem = {
      id: 'email_sent_' + Date.now().toString(36),
      channel: 'email',
      persona_id: persona,
      persona_name: persona,
      persona_initial: persona.charAt(1).toUpperCase(),
      persona_gradient: 'linear-gradient(135deg, #7c6aed, #a78bfa)',
      from_user: to,
      from_name: to,
      subject: subject,
      body_preview: body.substring(0, 120) + '...',
      body_full: body,
      status: 'sent',
      ai_reply: '',
      category: 'sent',
      thread_id: 'thread_' + Date.now().toString(36),
      thread_messages: [],
      received_at: new Date().toISOString(),
    };
    items.push(newItem);
    saveItems();

    closeCompose();
    PersonaGenAPI.showToast(`Email sent to ${to}`, 'success');
    renderItems();
  }

  async function aiComposeAssist() {
    const bodyEl = document.getElementById('compose-body');
    const subjectEl = document.getElementById('compose-subject');
    if (!bodyEl) return;

    const subject = subjectEl?.value || '';
    bodyEl.value = `Hi there,\n\nThank you for connecting! I wanted to reach out regarding ${subject || 'our potential collaboration'}.\n\nI\'d love to discuss this further at your convenience. Please let me know a good time to connect.\n\nBest regards`;
    PersonaGenAPI.showToast('AI draft generated — customize before sending', 'info');
  }

  // ─── Reply ───
  function reply(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    compose();
    setTimeout(() => {
      const toEl = document.getElementById('compose-to');
      const subjectEl = document.getElementById('compose-subject');
      if (toEl) toEl.value = item.from_user;
      if (subjectEl) subjectEl.value = `Re: ${item.subject}`;
    }, 100);
  }

  // ─── Counts ───
  function getCounts() {
    const emailCount = items.filter(i => i.channel === 'email').length;
    const smsCount = items.filter(i => i.channel === 'sms').length;
    return { email: emailCount, sms: smsCount, total: emailCount + smsCount };
  }

  // ─── Helpers ───
  function getTimeAgo(isoStr) {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return {
    init,
    renderItems,
    compose,
    reply,
    approve,
    closeCompose,
    sendComposed,
    aiComposeAssist,
    generateDraft,
    regenerate,
    ignore,
    toggleThread,
    getCounts,
  };
})();
