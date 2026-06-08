<script lang="ts">
  import { showToast } from '$lib/stores/ui.svelte';

  type InboxTab = 'social' | 'email';
  let activeTab = $state<InboxTab>('social');
  let agentFilter = $state('all');
  let expandedId = $state<string | null>(null);

  interface SocialThread {
    id: string;
    platform: 'instagram' | 'tiktok' | 'twitter' | 'youtube';
    agentId: string;
    agentName: string;
    userName: string;
    userAvatar: string;
    type: 'comment' | 'dm' | 'mention';
    messagePreview: string;
    fullMessage: string;
    aiReply: string;
    timestamp: string;
    status: 'pending' | 'approved' | 'ignored';
  }

  interface EmailThread {
    id: string;
    agentId: string;
    agentName: string;
    sender: string;
    senderEmail: string;
    subject: string;
    preview: string;
    fullBody: string;
    aiDraft: string;
    date: string;
    read: boolean;
  }

  let threads = $state<SocialThread[]>([
    {
      id: 'th1',
      platform: 'instagram',
      agentId: 'sofia-rivera',
      agentName: 'Sofia Rivera',
      userName: 'FitJenna_23',
      userAvatar: 'J',
      type: 'comment',
      messagePreview: 'Omg this workout routine is exactly what I needed! Can you do a full leg day...',
      fullMessage: 'Omg this workout routine is exactly what I needed! Can you do a full leg day breakdown? I\'ve been struggling with my form on Romanian deadlifts and your tips are always so clear. Also, do you have any recommendations for pre-workout snacks? 🙏💪',
      aiReply: 'Thank you so much, Jenna! 💕 I\'m so glad this resonated with you! A full leg day breakdown is definitely coming — I\'ll make sure to cover RDL form in detail. For pre-workout snacks, I love a banana with almond butter about 30 min before. Quick energy without feeling heavy! Stay tuned for that leg day video, chica! 🔥',
      timestamp: '2 hours ago',
      status: 'pending'
    },
    {
      id: 'th2',
      platform: 'tiktok',
      agentId: 'veronica-hap',
      agentName: 'Veronica Hap',
      userName: 'BeautyByMaya',
      userAvatar: 'M',
      type: 'dm',
      messagePreview: 'Hey babe! Love your content 💖 I was wondering if you\'d be open to a collab...',
      fullMessage: 'Hey babe! Love your content 💖 I was wondering if you\'d be open to a collab? I have 85K followers and we\'re in a similar niche. I was thinking we could do a "get ready with me" duet or a POV challenge together. Let me know! xx',
      aiReply: 'Hiii Maya! 🥰 Tysm for reaching out, I love your content too! A GRWM duet sounds SO fun — I\'m totally down! Let me check my schedule this week and we can plan something. DM me your availability and we\'ll make it happen! 💕✨',
      timestamp: '4 hours ago',
      status: 'pending'
    },
    {
      id: 'th3',
      platform: 'twitter',
      agentId: 'marcus-chen',
      agentName: 'Marcus Chen',
      userName: '@devtechbro',
      userAvatar: 'D',
      type: 'mention',
      messagePreview: '@marcuschen.tech Your take on the new GPT-5 API pricing is wrong. Here\'s why...',
      fullMessage: '@marcuschen.tech Your take on the new GPT-5 API pricing is wrong. Here\'s why: the cost-per-token decrease doesn\'t account for the increased context window requirements. When you factor in the 200K context, you\'re actually paying MORE for the same output quality. Thread incoming. 🧵',
      aiReply: 'Fair counterpoint, but you\'re comparing apples to oranges. The 200K context is optional — most production workloads use <32K. At equivalent context, GPT-5 is 40% cheaper per million tokens. The pricing model shifted from "charge per token" to "charge per capability." Different calculus entirely. Data: [link to analysis]',
      timestamp: '6 hours ago',
      status: 'pending'
    },
    {
      id: 'th4',
      platform: 'instagram',
      agentId: 'aisha-noori',
      agentName: 'Aisha Noori',
      userName: 'LuxeStyleDubai',
      userAvatar: 'L',
      type: 'comment',
      messagePreview: 'This Valentino look is STUNNING 😍 Where did you find the vintage piece?...',
      fullMessage: 'This Valentino look is STUNNING 😍 Where did you find the vintage piece from the second slide? I\'ve been searching for something similar for months. Also, your styling with the Cartier bracelet stack is perfection. Do you do personal styling consultations?',
      aiReply: 'Thank you so much, darling! ✨ That vintage Valentino piece is from a private estate sale in Milan — I work with a few trusted dealers who source exceptional archival pieces. I don\'t currently offer formal styling consultations, but I\'m considering it! Drop your email and I\'ll add you to the waitlist. The Cartier stack is all about layering different widths — it creates that effortless dimension. 💎',
      timestamp: '8 hours ago',
      status: 'approved'
    },
    {
      id: 'th5',
      platform: 'youtube',
      agentId: 'sofia-rivera',
      agentName: 'Sofia Rivera',
      userName: 'HealthyHabit_Mike',
      userAvatar: 'H',
      type: 'comment',
      messagePreview: 'This meal prep video saved my week! Quick question about the protein ratios...',
      fullMessage: 'This meal prep video saved my week! Quick question about the protein ratios — you mentioned 1.6g per kg bodyweight but I\'ve seen some sources say 2.2g for muscle building. What\'s your recommendation for someone who trains 5x/week? Also, love the Spanglish in your videos, it feels so authentic! 💪',
      aiReply: 'Mike, so glad the meal prep helped! 🙌 For 5x/week training, I\'d actually bump it up to 1.8-2.0g/kg — that 1.6g is more of a minimum baseline. The 2.2g studies are legit but show diminishing returns above 2.0g for most people. Save your money on extra protein powder and invest in quality carb sources for recovery! And gracias for the love on the Spanglish — that\'s just how my brain works, jaja! 😄',
      timestamp: '1 day ago',
      status: 'approved'
    },
    {
      id: 'th6',
      platform: 'tiktok',
      agentId: 'veronica-hap',
      agentName: 'Veronica Hap',
      userName: 'ToxicFanBoy99',
      userAvatar: 'T',
      type: 'comment',
      messagePreview: 'This is so fake lol nobody actually lives like this 🙄 stop pretending...',
      fullMessage: 'This is so fake lol nobody actually lives like this 🙄 stop pretending to be something you\'re not, this whole aesthetic is manufactured garbage. Your followers are bots. Get a real job.',
      aiReply: '',
      timestamp: '12 hours ago',
      status: 'ignored'
    }
  ]);

  let emails = $state<EmailThread[]>([
    {
      id: 'em1',
      agentId: 'aisha-noori',
      agentName: 'Aisha Noori',
      sender: 'Sarah Mitchell',
      senderEmail: 'sarah.m@luxebrands.com',
      subject: 'Partnership Opportunity — Spring Collection',
      preview: 'Hi Aisha, We\'d love to discuss a potential brand partnership for our upcoming spring...',
      fullBody: 'Hi Aisha,\n\nWe\'d love to discuss a potential brand partnership for our upcoming spring collection launch. Your aesthetic perfectly aligns with our brand values, and we believe a collaboration could be mutually beneficial.\n\nWe\'re looking at:\n- 3x Instagram posts + stories\n- 1x YouTube video (unboxing + styling)\n- 1x TikTok trend participation\n\nBudget range: $8,000 - $12,000 USD\nTimeline: March 15 - April 30\n\nWould you be available for a call this week?\n\nBest,\nSarah Mitchell\nBrand Partnerships Manager\nLuxe Brands International',
      aiDraft: 'Dear Sarah,\n\nThank you for reaching out — I\'m genuinely interested in this opportunity. Your spring collection aesthetics align beautifully with the direction I\'m taking my content this season.\n\nI\'d love to hop on a call to discuss the details. I\'m available Thursday or Friday this week between 2-5 PM GST.\n\nA few quick questions:\n1. Will you be providing the pieces, or is there a styling budget included?\n2. Is there flexibility on the posting timeline for optimal engagement?\n3. Do you have brand guidelines I can review beforehand?\n\nLooking forward to connecting!\n\nWarm regards,\nAisha',
      date: '2 hours ago',
      read: false
    },
    {
      id: 'em2',
      agentId: 'marcus-chen',
      agentName: 'Marcus Chen',
      sender: 'TechConf Team',
      senderEmail: 'speakers@techconf2026.io',
      subject: 'Speaker Invitation — TechConf 2026',
      preview: 'Marcus, Your thought leadership in AI has not gone unnoticed. We\'d like to invite you...',
      fullBody: 'Marcus,\n\nYour thought leadership in AI has not gone unnoticed. We\'d like to invite you to speak at TechConf 2026 in San Francisco.\n\nDetails:\n- Date: September 15-17, 2026\n- Slot: 45-minute keynote + 15-minute Q&A\n- Track: "AI in Production"\n- Honorarium: $5,000 + travel/accommodation\n- Expected attendance: 3,000+\n\nPast speakers include leaders from Google DeepMind, Anthropic, and Meta AI.\n\nPlease confirm your interest by July 1st.\n\nBest,\nTechConf Program Committee',
      aiDraft: 'Thanks for the invitation — I\'m interested.\n\nA few things I\'d want to clarify:\n1. Is the talk recorded and distributed? I want to ensure I can share clips on my channels.\n2. Any topic restrictions within the "AI in Production" track? I\'d want to cover real-world cost optimization, not just the hype.\n3. Panel participation in addition to the keynote — is that an option?\n\nI\'ll pencil in the dates. Send over the speaker agreement and I\'ll review.\n\nMarcus Chen',
      date: '1 day ago',
      read: true
    },
    {
      id: 'em3',
      agentId: 'sofia-rivera',
      agentName: 'Sofia Rivera',
      sender: 'FitFuel Nutrition',
      senderEmail: 'partnerships@fitfuel.co',
      subject: 'Affiliate Program Invite — FitFuel Supplements',
      preview: 'Hey Sofia! We love your fitness content and think you\'d be a perfect fit for our...',
      fullBody: 'Hey Sofia!\n\nWe love your fitness content and think you\'d be a perfect fit for our affiliate program.\n\nWhat we offer:\n- 15% commission on all sales through your link\n- Free monthly product box ($200 value)\n- Custom discount code for your followers\n- Priority access to new product launches\n\nNo minimum posting requirements — just authentic integration when it fits your content.\n\nInterested? Reply and we\'ll send over the details!\n\n— Team FitFuel',
      aiDraft: 'Hi FitFuel team!\n\nThanks for thinking of me — I appreciate the offer! Before I commit, I have a few questions:\n\n1. Can I see the full ingredient list and third-party testing results? I only promote supplements I\'d personally use.\n2. Is there exclusivity? I currently work with another brand for protein powder.\n3. What\'s the cookie duration on the affiliate link?\n\nI\'m selective about partnerships because my community trusts my recommendations. If everything checks out, I\'d love to collaborate!\n\nBest,\nSofia',
      date: '3 days ago',
      read: true
    }
  ]);

  let pendingSocialCount = $derived(threads.filter(t => t.status === 'pending').length);
  let unreadEmailCount = $derived(emails.filter(e => !e.read).length);

  let filteredThreads = $derived(
    agentFilter === 'all'
      ? threads
      : threads.filter(t => t.agentId === agentFilter)
  );

  const agents = [
    { id: 'all', name: 'All Agents' },
    { id: 'sofia-rivera', name: 'Sofia Rivera' },
    { id: 'marcus-chen', name: 'Marcus Chen' },
    { id: 'aisha-noori', name: 'Aisha Noori' },
    { id: 'veronica-hap', name: 'Veronica Hap' }
  ];

  function platformIcon(platform: string): string {
    const icons: Record<string, string> = {
      instagram: '📸',
      tiktok: '🎵',
      twitter: '𝕏',
      youtube: '▶️'
    };
    return icons[platform] ?? '🌐';
  }

  function typeLabel(type: string): string {
    const labels: Record<string, string> = {
      comment: 'Comment',
      dm: 'Direct Message',
      mention: 'Mention'
    };
    return labels[type] ?? type;
  }

  function statusColor(status: string): string {
    if (status === 'pending') return 'var(--warning)';
    if (status === 'approved') return 'var(--success)';
    return 'var(--text-dim)';
  }

  function approveThread(id: string) {
    threads = threads.map(t => t.id === id ? { ...t, status: 'approved' as const } : t);
    showToast('Reply approved and sent', 'success');
  }

  function ignoreThread(id: string) {
    threads = threads.map(t => t.id === id ? { ...t, status: 'ignored' as const } : t);
    showToast('Thread ignored', 'info');
  }

  function sendEmailReply(id: string) {
    emails = emails.map(e => e.id === id ? { ...e, read: true } : e);
    expandedId = null;
    showToast('Email reply sent', 'success');
  }

  function archiveEmail(id: string) {
    emails = emails.filter(e => e.id !== id);
    expandedId = null;
    showToast('Email archived', 'info');
  }

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }
</script>

<svelte:head>
  <title>Inbox — PersonaGen</title>
</svelte:head>

<section class="page">
  <header class="page-header">
    <h1>Inbox</h1>
    <p class="subtitle">Manage engagement threads, DMs, and email communications across all agents.</p>
  </header>

  <!-- Tabs -->
  <nav class="inbox-tabs">
    <button class="inbox-tab" class:active={activeTab === 'social'} onclick={() => activeTab = 'social'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      Social Inbox
      {#if pendingSocialCount > 0}
        <span class="tab-badge">{pendingSocialCount}</span>
      {/if}
    </button>
    <button class="inbox-tab" class:active={activeTab === 'email'} onclick={() => activeTab = 'email'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      Email
      {#if unreadEmailCount > 0}
        <span class="tab-badge">{unreadEmailCount}</span>
      {/if}
    </button>
  </nav>

  <!-- Social Inbox -->
  {#if activeTab === 'social'}
    <div class="filter-bar">
      <select bind:value={agentFilter}>
        {#each agents as agent (agent.id)}
          <option value={agent.id}>{agent.name}</option>
        {/each}
      </select>
    </div>

    <div class="thread-list">
      {#each filteredThreads as thread (thread.id)}
        <div class="thread-item" class:expanded={expandedId === thread.id}>
          <button class="thread-header" onclick={() => toggleExpand(thread.id)}>
            <span class="platform-icon">{platformIcon(thread.platform)}</span>
            <div class="thread-avatar" style="background: var(--gradient-subtle)">
              <span>{thread.userAvatar}</span>
            </div>
            <div class="thread-info">
              <div class="thread-meta-row">
                <span class="thread-user">{thread.userName}</span>
                <span class="thread-type">{typeLabel(thread.type)}</span>
                <span class="thread-agent">→ {thread.agentName}</span>
              </div>
              <span class="thread-preview">{thread.messagePreview}</span>
            </div>
            <div class="thread-right">
              <span class="thread-time">{thread.timestamp}</span>
              <span class="thread-status" style="color: {statusColor(thread.status)}">
                <span class="status-dot" style="background: {statusColor(thread.status)}"></span>
                {thread.status}
              </span>
            </div>
            <svg class="chevron" class:rotated={expandedId === thread.id} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          {#if expandedId === thread.id}
            <div class="thread-expanded">
              <div class="message-block">
                <div class="msg-label">
                  <span class="msg-from">{thread.userName}</span>
                  <span class="msg-badge">{typeLabel(thread.type)}</span>
                </div>
                <p class="msg-body">{thread.fullMessage}</p>
              </div>

              {#if thread.aiReply}
                <div class="message-block ai-block">
                  <div class="msg-label">
                    <span class="msg-from ai-tag">🤖 AI Suggested Reply</span>
                  </div>
                  <p class="msg-body">{thread.aiReply}</p>
                </div>
              {/if}

              {#if thread.status === 'pending'}
                <div class="thread-actions">
                  <button class="action-btn approve" onclick={() => approveThread(thread.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    Approve Reply
                  </button>
                  <button class="action-btn edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit Reply
                  </button>
                  <button class="action-btn ignore" onclick={() => ignoreThread(thread.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                    Ignore
                  </button>
                </div>
              {:else}
                <div class="thread-status-bar">
                  <span class="status-resolved" style="color: {statusColor(thread.status)}">
                    {thread.status === 'approved' ? '✓ Reply sent' : '⊘ Ignored'}
                  </span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Email Tab -->
  {#if activeTab === 'email'}
    <div class="thread-list">
      {#each emails as email (email.id)}
        <div class="thread-item email-item" class:expanded={expandedId === email.id} class:unread={!email.read}>
          <button class="thread-header" onclick={() => toggleExpand(email.id)}>
            <div class="email-avatar" style="background: var(--gradient-warm)">
              <span>{email.sender[0]}</span>
            </div>
            <div class="thread-info">
              <div class="thread-meta-row">
                <span class="thread-user">{email.sender}</span>
                <span class="thread-agent">→ {email.agentName}</span>
              </div>
              <span class="email-subject">{email.subject}</span>
              <span class="thread-preview">{email.preview}</span>
            </div>
            <div class="thread-right">
              <span class="thread-time">{email.date}</span>
              {#if !email.read}
                <span class="unread-dot"></span>
              {/if}
            </div>
            <svg class="chevron" class:rotated={expandedId === email.id} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          {#if expandedId === email.id}
            <div class="thread-expanded">
              <div class="email-meta">
                <span class="email-from">From: <strong>{email.sender}</strong> &lt;{email.senderEmail}&gt;</span>
                <span class="email-subj">Subject: {email.subject}</span>
              </div>

              <div class="message-block">
                <p class="msg-body email-body">{email.fullBody}</p>
              </div>

              <div class="message-block ai-block">
                <div class="msg-label">
                  <span class="msg-from ai-tag">🤖 AI Draft Reply</span>
                </div>
                <p class="msg-body email-body">{email.aiDraft}</p>
              </div>

              <div class="thread-actions">
                <button class="action-btn approve" onclick={() => sendEmailReply(email.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Send Reply
                </button>
                <button class="action-btn edit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit Draft
                </button>
                <button class="action-btn ignore" onclick={() => archiveEmail(email.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                  Archive
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .page {
    padding: 2rem;
    max-width: 1100px;
    margin: 0 auto;
  }

  .page-header {
    margin-bottom: 1.5rem;
  }

  .page-header h1 {
    font-size: var(--text-3xl);
    font-family: var(--font-display);
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  /* ── Tabs ── */
  .inbox-tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem;
    margin-bottom: 1.25rem;
    width: fit-content;
  }

  .inbox-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1.25rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: color 0.2s ease, background 0.2s ease;
    font-family: var(--font-body);
  }

  .inbox-tab:hover {
    color: var(--text);
  }

  .inbox-tab.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .tab-badge {
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }

  /* ── Filter ── */
  .filter-bar {
    margin-bottom: 1rem;
  }

  .filter-bar select {
    max-width: 220px;
  }

  /* ── Thread List ── */
  .thread-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .thread-item {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .thread-item:hover {
    border-color: var(--border-hover);
  }

  .thread-item.expanded {
    border-color: var(--accent-mid);
    box-shadow: 0 0 20px rgba(124, 106, 237, 0.08);
  }

  .thread-item.unread {
    border-left: 3px solid var(--accent);
  }

  .thread-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    font-family: var(--font-body);
  }

  .platform-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
    width: 28px;
    text-align: center;
  }

  .thread-avatar,
  .email-avatar {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .thread-avatar span,
  .email-avatar span {
    color: #fff;
    font-weight: 700;
    font-size: 0.85rem;
    font-family: var(--font-display);
  }

  .thread-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .thread-meta-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .thread-user {
    font-weight: 600;
    font-size: var(--text-sm);
  }

  .thread-type {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    background: var(--surface-3);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .thread-agent {
    font-size: var(--text-xs);
    color: var(--accent);
  }

  .thread-preview {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 500px;
  }

  .email-subject {
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--text);
  }

  .thread-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .thread-time {
    font-size: 10px;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .thread-status {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: inline-block;
  }

  .unread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }

  .chevron {
    color: var(--text-dim);
    flex-shrink: 0;
    transition: transform 0.2s ease;
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  /* ── Expanded ── */
  .thread-expanded {
    padding: 0 1.25rem 1.25rem;
    border-top: 1px solid var(--border);
    animation: slideDown 0.2s ease;
  }

  @keyframes slideDown {
    from { opacity: 0; max-height: 0; }
    to { opacity: 1; max-height: 1000px; }
  }

  .email-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .email-meta strong {
    color: var(--text);
  }

  .message-block {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1rem;
    margin-top: 0.75rem;
  }

  .ai-block {
    border-color: var(--accent-mid);
    background: rgba(124, 106, 237, 0.04);
  }

  .msg-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .msg-from {
    font-weight: 600;
    font-size: var(--text-sm);
  }

  .ai-tag {
    color: var(--accent);
  }

  .msg-badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    background: var(--surface-3);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .msg-body {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.7;
  }

  .email-body {
    white-space: pre-wrap;
  }

  /* ── Actions ── */
  .thread-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-muted);
    font-family: var(--font-body);
  }

  .action-btn:hover {
    transform: translateY(-1px);
  }

  .action-btn.approve {
    background: var(--success-soft);
    border-color: rgba(52, 211, 153, 0.25);
    color: var(--success);
  }

  .action-btn.approve:hover {
    background: rgba(52, 211, 153, 0.2);
  }

  .action-btn.edit:hover {
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  .action-btn.ignore {
    color: var(--text-dim);
  }

  .action-btn.ignore:hover {
    border-color: rgba(239, 68, 68, 0.2);
    color: var(--error);
  }

  .thread-status-bar {
    padding: 0.75rem 0 0;
  }

  .status-resolved {
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  @media (max-width: 768px) {
    .page {
      padding: 1rem;
    }

    .inbox-tabs {
      width: 100%;
    }

    .inbox-tab {
      flex: 1;
      justify-content: center;
    }

    .thread-header {
      flex-wrap: wrap;
      padding: 0.75rem;
    }

    .thread-right {
      width: 100%;
      flex-direction: row;
      justify-content: space-between;
      margin-top: 0.5rem;
    }

    .thread-preview {
      max-width: 100%;
    }

    .thread-actions {
      flex-direction: column;
    }

    .action-btn {
      justify-content: center;
    }
  }
</style>
