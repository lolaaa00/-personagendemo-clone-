// ═══════════════════════════════════════════════════════════════
// PersonaGen API Layer — Communicates with n8n backend
// All dashboard CRUD operations go through this module
// ═══════════════════════════════════════════════════════════════

const PersonaGenAPI = (() => {
  const BASE = PersonaGenConfig.webhook_url.replace('/personagen-social', '');

  // Endpoints (match n8n webhook paths)
  const ENDPOINTS = {
    posts:      `${BASE}/personagen-posts`,
    generate:   `${BASE}/personagen-ai-generate`,
    publish:    `${BASE}/personagen-publish`,
    accounts:   `${BASE}/personagen-social`,
    feed:       `${BASE}/personagen-posts`,
    trends:     `${BASE}/personagen-trends`,
    inbox:      `${BASE}/personagen-engagement`,
    factory:    `${BASE}/personagen-account-factory`,
    email:      `${BASE}/personagen-email`,
  };


  // ─── Generic Fetch Wrapper ───
  async function request(endpoint, action, payload = {}) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ts: Date.now(), ...payload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`[PersonaGenAPI] ${action} failed:`, err);
      return { success: false, error: err.message };
    }
  }

  // ─── Posts CRUD ───
  const Posts = {
    create(post)    { return request(ENDPOINTS.posts, 'create', { post }); },
    update(id, data){ return request(ENDPOINTS.posts, 'update', { id, ...data }); },
    delete(id)      { return request(ENDPOINTS.posts, 'delete', { id }); },
    list(filters)   { return request(ENDPOINTS.posts, 'list', filters || {}); },
    get(id)         { return request(ENDPOINTS.posts, 'get', { id }); },
  };

  // ─── Content Generation ───
  const Generate = {
    content(personaId, prompt, platforms) {
      return request(ENDPOINTS.generate, 'content', { persona_id: personaId, prompt, platforms });
    },
    reply(personaId, context, platform) {
      return request(ENDPOINTS.generate, 'reply', { persona_id: personaId, context, platform });
    },
    trendPost(personaId, trendTopic, platforms) {
      return request(ENDPOINTS.generate, 'trend_post', { persona_id: personaId, trend_topic: trendTopic, platforms });
    },
    batch(personaId, count, platforms) {
      return request(ENDPOINTS.generate, 'batch', { persona_id: personaId, count, platforms });
    },
  };

  // ─── Publishing Pipeline ───
  const Publish = {
    now(post) {
      return request(ENDPOINTS.publish, 'publish', { post });
    },
    retry(postId) {
      return request(ENDPOINTS.publish, 'retry', { post_id: postId });
    },
  };

  // ─── Accounts (Composio) ───
  const Accounts = {
    initConnection(personaId, platform) {
      return request(ENDPOINTS.accounts, 'initiate_connection', { persona_id: personaId, platform });
    },
    checkStatus(personaId) {
      return request(ENDPOINTS.accounts, 'check_status', { persona_id: personaId });
    },
    disconnect(personaId, platform) {
      return request(ENDPOINTS.accounts, 'disconnect', { persona_id: personaId, platform });
    },
    listAll() {
      return request(ENDPOINTS.accounts, 'list_accounts', {});
    },
  };

  // ─── Feed / Calendar Data ───
  const Feed = {
    calendar(month, year, personaId) {
      return request(ENDPOINTS.feed, 'calendar', { month, year, persona_id: personaId });
    },
    upcoming(limit = 10) {
      return request(ENDPOINTS.feed, 'upcoming', { limit });
    },
    recent(limit = 10) {
      return request(ENDPOINTS.feed, 'recent', { limit });
    },
  };

  // ─── Trends ───
  const Trends = {
    get(personaId) {
      return request(ENDPOINTS.trends, 'get', { persona_id: personaId });
    },
    getByNiche(niche) {
      return request(ENDPOINTS.trends, 'get_by_niche', { niche });
    },
    refresh(personaId) {
      return request(ENDPOINTS.trends, 'refresh', { persona_id: personaId });
    },
  };

  // ─── Inbox ───
  const Inbox = {
    list(personaId, filters) {
      return request(ENDPOINTS.inbox, 'list', { persona_id: personaId, ...filters });
    },
    approve(id) {
      return request(ENDPOINTS.inbox, 'approve', { id });
    },
    ignore(id) {
      return request(ENDPOINTS.inbox, 'ignore', { id });
    },
    updateReply(id, replyText) {
      return request(ENDPOINTS.inbox, 'update_reply', { id, reply_text: replyText });
    },
  };

  // ─── Local Storage Fallback (for demo/offline mode) ───
  const Local = {
    _key: 'personagen_posts_local',

    getPosts() {
      try { return JSON.parse(localStorage.getItem(this._key) || '[]'); }
      catch { return []; }
    },

    savePost(post) {
      const posts = this.getPosts();
      const idx = posts.findIndex(p => p.id === post.id);
      if (idx >= 0) posts[idx] = post;
      else posts.push(post);
      localStorage.setItem(this._key, JSON.stringify(posts));
      return post;
    },

    deletePost(id) {
      const posts = this.getPosts().filter(p => p.id !== id);
      localStorage.setItem(this._key, JSON.stringify(posts));
    },

    uuid() {
      return 'pg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
    }
  };

  // ─── Account Factory ───
  const Factory = {
    create(persona)    { return request(`${BASE}/personagen-account-factory`, 'create_account', { persona }); },
    status(id)         { return request(`${BASE}/personagen-account-factory`, 'check_status', { id }); },
    retry(id, step)    { return request(`${BASE}/personagen-account-factory`, 'retry', { id, step }); },
    refresh(id)        { return request(`${BASE}/personagen-account-factory`, 'refresh_session', { id }); },
    health(id)         { return request(`${BASE}/personagen-account-factory`, 'health_check', { id }); },
    list()             { return request(`${BASE}/personagen-account-factory`, 'list_accounts', {}); },
  };

  // ─── Email (AgenticMail) ───
  const Email = {
    listInbox(personaId)      { return request(`${BASE}/personagen-email`, 'list', { persona_id: personaId }); },
    getThread(threadId)       { return request(`${BASE}/personagen-email`, 'thread', { thread_id: threadId }); },
    send(personaId, msg)      { return request(`${BASE}/personagen-email`, 'send', { persona_id: personaId, ...msg }); },
    draft(personaId, emailId) { return request(`${BASE}/personagen-email`, 'ai_draft', { persona_id: personaId, email_id: emailId }); },
    approve(emailId)          { return request(`${BASE}/personagen-email`, 'approve_send', { email_id: emailId }); },
    search(personaId, query)  { return request(`${BASE}/personagen-email`, 'search', { persona_id: personaId, q: query }); },
  };

  // ─── Toast Notifications ───
  function showToast(message, type = 'success') {
    let toast = document.getElementById('pg-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pg-toast';
      toast.className = 'pg-toast';
      document.body.appendChild(toast);
    }
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    toast.innerHTML = `<span class="pg-toast-icon">${icons[type] || '✅'}</span><span>${message}</span>`;
    toast.className = `pg-toast pg-toast--${type} pg-toast--visible`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('pg-toast--visible'), 4000);
  }

  return { Posts, Generate, Publish, Accounts, Feed, Trends, Inbox, Factory, Email, Local, showToast, ENDPOINTS };
})();
