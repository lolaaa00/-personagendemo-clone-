// ═══════════════════════════════════════════════════════════════
// PersonaGen Trend Monitor — Real Apify trend data via n8n
// Fetches live trends from Twitter, Instagram, TikTok, Reddit
// Falls back to cached/demo data when Apify actors are running
// ═══════════════════════════════════════════════════════════════

const TrendMonitor = (() => {
  let selectedPersona = null;
  let cachedTrends = {};
  let lastFetched = null;
  let isLoading = false;

  const PLATFORM_META = {
    x:         { icon: '\u{1D54F}', label: 'X / Twitter',  bg: '#14171a', border: true },
    twitter:   { icon: '\u{1D54F}', label: 'X / Twitter',  bg: '#14171a', border: true },
    instagram: { icon: '\u{1F4F7}', label: 'Instagram',   bg: '#e1306c', border: false },
    tiktok:    { icon: '\u266A',  label: 'TikTok',      bg: '#000',    border: true },
    reddit:    { icon: '\u2B06',  label: 'Reddit',      bg: '#ff4500', border: false },
  };

  // Demo trends as fallback while real data loads
  const DEMO_TRENDS = {
    twitter: [
      { topic: 'Loading live trends...', volume: '--', delta: '--', hot: false, url: '' },
    ],
    instagram: [
      { topic: 'Loading live trends...', volume: '--', delta: '--', hot: false, url: '' },
    ],
    tiktok: [
      { topic: 'Loading live trends...', volume: '--', delta: '--', hot: false, url: '' },
    ],
    reddit: [
      { topic: 'Loading live trends...', volume: '--', delta: '--', hot: false, url: '' },
    ],
  };

  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (typeof INFLUENCERS !== 'undefined' && INFLUENCERS.length > 0) {
      selectedPersona = INFLUENCERS[0];
    }
    container.innerHTML = renderShell();
    // Fetch real data on init
    fetchTrends();
  }

  function renderShell() {
    const personas = (typeof INFLUENCERS !== 'undefined') ? INFLUENCERS : [];

    return `
      <div class="trends-wrapper">
        <!-- Header -->
        <div class="trends-toolbar">
          <div class="trends-toolbar-left">
            <h3 class="trends-title">\u{1F4C8} Trending Now</h3>
            <span class="trends-subtitle" id="trends-last-updated">Auto-refreshed every 6 hours</span>
          </div>
          <div class="trends-toolbar-right">
            <select class="trends-persona-select" onchange="TrendMonitor.selectPersona(this.value)">
              ${personas.map((p, i) => `<option value="${p.handle}" ${i === 0 ? 'selected' : ''}>${p.name} \u2014 ${p.niche}</option>`).join('')}
            </select>
            <button class="trends-refresh-btn" onclick="TrendMonitor.refresh()" id="trends-refresh-btn">\u{1F504} Refresh</button>
          </div>
        </div>

        <!-- Trend Content -->
        <div class="trends-content" id="trends-content"></div>
      </div>
    `;
  }

  async function fetchTrends() {
    if (isLoading) return;
    isLoading = true;

    // Show loading state
    const btn = document.getElementById('trends-refresh-btn');
    if (btn) { btn.textContent = '\u23F3 Scanning...'; btn.disabled = true; }

    const keywords = selectedPersona
      ? [selectedPersona.niche, ...(selectedPersona.tags || [])].filter(Boolean).join(', ')
      : 'trending';

    try {
      const resp = await fetch(PersonaGenAPI?.baseUrl
        ? `${PersonaGenAPI.baseUrl}/webhook/personagen-trends`
        : 'https://auto.l2gseo.com/webhook/personagen-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scan',
          keywords,
          persona: selectedPersona?.handle || 'default',
          niche: selectedPersona?.niche || 'general',
        }),
      });

      const data = await resp.json();

      if (data.success && data.trends) {
        // Normalize and cache the real trend data
        cachedTrends = normalizeTrends(data.trends);
        lastFetched = new Date();
        const ts = document.getElementById('trends-last-updated');
        if (ts) ts.textContent = `Last updated: ${lastFetched.toLocaleTimeString()}`;
      }
    } catch (err) {
      console.warn('Trend fetch failed, using cached/demo data:', err);
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Using cached trend data', 'info');
      }
    } finally {
      isLoading = false;
      if (btn) { btn.textContent = '\u{1F504} Refresh'; btn.disabled = false; }
    }

    renderTrends();
  }

  // Normalize raw Apify data into display format
  function normalizeTrends(raw) {
    const normalized = {};

    Object.entries(raw).forEach(([platform, items]) => {
      if (!Array.isArray(items) || items.length === 0) return;

      normalized[platform] = items.slice(0, 10).map((item, idx) => {
        // Handle different Apify actor output schemas
        if (platform === 'twitter' || platform === 'x') {
          return {
            topic: item.text?.substring(0, 80) || item.full_text?.substring(0, 80) || item.hashtags?.[0] || `Trending #${idx + 1}`,
            volume: formatCount(item.retweet_count || item.retweetCount || item.likes || 0) + ' engagements',
            delta: item.reply_count ? `${item.reply_count} replies` : '--',
            hot: (item.retweet_count || item.retweetCount || 0) > 100 || (item.likes || 0) > 500,
            url: item.url || item.tweetUrl || '',
            author: item.author?.userName || item.user?.screen_name || '',
          };
        }

        if (platform === 'instagram') {
          return {
            topic: item.caption?.substring(0, 80) || item.hashtags?.[0] || `Post #${idx + 1}`,
            volume: formatCount(item.likesCount || item.likes || 0) + ' likes',
            delta: formatCount(item.commentsCount || item.comments || 0) + ' comments',
            hot: (item.likesCount || item.likes || 0) > 1000,
            url: item.url || item.shortCode ? `https://instagram.com/p/${item.shortCode}` : '',
            author: item.ownerUsername || item.owner?.username || '',
          };
        }

        if (platform === 'tiktok') {
          return {
            topic: item.text?.substring(0, 80) || item.desc?.substring(0, 80) || `Video #${idx + 1}`,
            volume: formatCount(item.playCount || item.plays || item.stats?.playCount || 0) + ' plays',
            delta: formatCount(item.diggCount || item.likes || item.stats?.diggCount || 0) + ' likes',
            hot: (item.playCount || item.plays || item.stats?.playCount || 0) > 100000,
            url: item.webVideoUrl || item.url || '',
            author: item.authorMeta?.name || item.author?.uniqueId || '',
          };
        }

        if (platform === 'reddit') {
          return {
            topic: item.title?.substring(0, 80) || `Post #${idx + 1}`,
            volume: formatCount(item.score || item.ups || 0) + ' upvotes',
            delta: formatCount(item.numberOfComments || item.num_comments || 0) + ' comments',
            hot: (item.score || item.ups || 0) > 100,
            url: item.url || (item.permalink ? `https://reddit.com${item.permalink}` : ''),
            author: item.author || item.communityName || '',
          };
        }

        // Generic fallback
        return {
          topic: item.title || item.text || item.name || `Item #${idx + 1}`,
          volume: '--',
          delta: '--',
          hot: false,
          url: item.url || '',
          author: '',
        };
      });
    });

    return normalized;
  }

  function formatCount(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  function renderTrends() {
    const content = document.getElementById('trends-content');
    if (!content) return;

    const trends = Object.keys(cachedTrends).length > 0 ? cachedTrends : DEMO_TRENDS;

    if (Object.keys(trends).length === 0) {
      content.innerHTML = `
        <div class="trends-empty">
          <span class="trends-empty-icon">\u{1F4CA}</span>
          <h4>No trend data available</h4>
          <p>Click Refresh to scan for trends across all platforms.</p>
        </div>
      `;
      return;
    }

    // Collect all hot topics for the tag cloud
    const hotTopics = [];
    Object.values(trends).forEach(platTrends => {
      if (Array.isArray(platTrends)) {
        platTrends.filter(t => t.hot).forEach(t => hotTopics.push(t));
      }
    });

    let html = '';

    // Hot Topics Cloud
    if (hotTopics.length > 0) {
      const nicheLabel = selectedPersona?.niche || 'All Platforms';
      html += `
        <div class="trends-cloud-section">
          <div class="trends-cloud-label">\u{1F525} Hot Topics in ${nicheLabel}</div>
          <div class="trends-cloud">
            ${hotTopics.map(t => `
              <button class="trends-cloud-tag" onclick="TrendMonitor.generateFromTrend('${(t.topic || '').replace(/'/g, "\\'")}')">
                ${truncate(t.topic, 40)} <span class="trends-cloud-delta">${t.delta || ''}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Per-platform sections
    html += '<div class="trends-platform-grid">';
    Object.entries(trends).forEach(([platform, items]) => {
      if (!Array.isArray(items) || items.length === 0) return;
      const key = platform === 'x' ? 'twitter' : platform;
      const meta = PLATFORM_META[key] || PLATFORM_META.twitter;
      html += `
        <div class="trends-platform-card">
          <div class="trends-platform-header">
            <div class="trends-platform-icon" style="background:${meta.bg};${meta.border ? 'border:1px solid var(--border-strong);' : ''}">${meta.icon}</div>
            <span class="trends-platform-name">${meta.label}</span>
            <span class="trends-platform-count">${items.length} results</span>
          </div>
          <div class="trends-platform-list">
            ${items.map(t => `
              <div class="trends-item ${t.hot ? 'trends-item--hot' : ''}">
                <div class="trends-item-main">
                  <span class="trends-item-topic">${t.url ? `<a href="${t.url}" target="_blank" rel="noopener">${truncate(t.topic, 60)}</a>` : truncate(t.topic, 60)}</span>
                  <span class="trends-item-vol">${t.volume || ''}</span>
                </div>
                <div class="trends-item-meta">
                  ${t.author ? `<span class="trends-item-author">@${t.author}</span>` : ''}
                  <span class="trends-item-delta ${isHighDelta(t.delta) ? 'trends-item-delta--up' : ''}">${t.delta || ''}</span>
                  ${t.hot ? '<span class="trends-item-fire">\u{1F525}</span>' : ''}
                  <button class="trends-item-gen-btn" onclick="TrendMonitor.generateFromTrend('${(t.topic || '').replace(/'/g, "\\'")}')">✏️</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });
    html += '</div>';

    content.innerHTML = html;
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  function isHighDelta(delta) {
    if (!delta) return false;
    const num = parseInt(delta.replace(/[^0-9-]/g, ''));
    return !isNaN(num) && num > 20;
  }

  function selectPersona(handle) {
    selectedPersona = INFLUENCERS?.find(i => i.handle === handle) || INFLUENCERS?.[0];
    // Re-fetch with new persona keywords
    fetchTrends();
  }

  function refresh() {
    if (typeof PersonaGenAPI !== 'undefined') {
      PersonaGenAPI.showToast('Scanning trends across all platforms...', 'info');
    }
    fetchTrends();
  }

  function generateFromTrend(topic) {
    // Open composer with trend-based generation
    if (typeof PostComposer !== 'undefined') {
      PostComposer.open();
    }

    // Small delay to let modal render
    setTimeout(() => {
      const promptInput = document.getElementById('composer-ai-prompt');
      const promptWrap = document.getElementById('composer-ai-prompt-wrap');
      if (promptWrap) promptWrap.style.display = 'block';
      if (promptInput) {
        promptInput.value = `Create a post about the trending topic: ${topic}. Make it relevant, insightful, and engaging for my audience.`;
        promptInput.focus();
      }
    }, 300);
  }

  return { init, selectPersona, refresh, generateFromTrend };
})();

// Auto-init on built sub-pages
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('trends-mount');
  if (mount && !mount.hasChildNodes()) {
    TrendMonitor.init('trends-mount');
  }
});
