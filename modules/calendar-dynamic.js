// ═══════════════════════════════════════════════════════════════
// PersonaGen Dynamic Calendar — Monthly/Weekly view with CRUD
// Replaces the static hardcoded calendar with live post data
// ═══════════════════════════════════════════════════════════════

const DynamicCalendar = (() => {
  let currentMonth = new Date().getMonth();
  let currentYear = new Date().getFullYear();
  let currentView = 'month'; // 'month' | 'week'
  let filterPersona = 'all';
  let posts = [];

  const STATUS_COLORS = {
    draft:      { bg: 'rgba(122,120,144,0.15)', border: 'var(--text-dim)',  label: 'Draft',     dot: 'var(--text-dim)' },
    scheduled:  { bg: 'rgba(124,106,237,0.15)',  border: 'var(--accent)',    label: 'Scheduled', dot: 'var(--accent)' },
    publishing: { bg: 'rgba(251,191,36,0.15)',   border: 'var(--gold)',      label: 'Publishing', dot: 'var(--gold)' },
    published:  { bg: 'rgba(52,211,153,0.15)',   border: 'var(--success)',   label: 'Published', dot: 'var(--success)' },
    failed:     { bg: 'rgba(239,68,68,0.15)',    border: '#ef4444',          label: 'Failed',    dot: '#ef4444' },
  };

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // ─── Init ───
  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = renderCalendarShell();
    loadPosts();
    renderMonth();
  }

  // ─── Shell ───
  function renderCalendarShell() {
    const personaOptions = (typeof INFLUENCERS !== 'undefined')
      ? INFLUENCERS.map(i => `<option value="${i.handle}">${i.name}</option>`).join('')
      : '';

    return `
      <div class="dcal-wrapper">
        <!-- Toolbar -->
        <div class="dcal-toolbar">
          <div class="dcal-toolbar-left">
            <button class="dcal-nav-btn" onclick="DynamicCalendar.prevMonth()">‹</button>
            <h3 class="dcal-month-label" id="dcal-month-label"></h3>
            <button class="dcal-nav-btn" onclick="DynamicCalendar.nextMonth()">›</button>
            <button class="dcal-today-btn" onclick="DynamicCalendar.goToday()">Today</button>
          </div>
          <div class="dcal-toolbar-right">
            <select class="dcal-filter-select" id="dcal-persona-filter" onchange="DynamicCalendar.filterByPersona(this.value)">
              <option value="all">All Personas</option>
              ${personaOptions}
            </select>
            <div class="dcal-view-toggle">
              <button class="dcal-view-btn active" data-view="month" onclick="DynamicCalendar.setView('month')">Month</button>
              <button class="dcal-view-btn" data-view="week" onclick="DynamicCalendar.setView('week')">Week</button>
            </div>
            <button class="dcal-new-btn" onclick="PostComposer.open()">+ New Post</button>
          </div>
        </div>

        <!-- Stats Bar -->
        <div class="dcal-stats" id="dcal-stats"></div>

        <!-- Calendar Grid -->
        <div class="dcal-grid-wrap" id="dcal-grid-wrap"></div>
      </div>
    `;
  }

  // ─── Load Posts ───
  function loadPosts() {
    posts = PersonaGenAPI.Local.getPosts();
    // Also try to load from existing CALENDARS data if no posts exist
    if (posts.length === 0 && typeof CALENDARS !== 'undefined') {
      posts = convertLegacyCalendars();
    }
  }

  // Convert old static CALENDARS to post objects
  function convertLegacyCalendars() {
    const converted = [];
    const today = new Date();
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    if (typeof CALENDARS === 'undefined') return converted;

    Object.entries(CALENDARS).forEach(([persona, days]) => {
      const inf = INFLUENCERS?.find(i => i.name.split(' ')[0].toLowerCase() === persona.toLowerCase());
      if (!inf) return;

      Object.entries(days).forEach(([dayName, items]) => {
        const dayIdx = dayNames.indexOf(dayName);
        if (dayIdx < 0) return;

        // Map to this week's dates
        const diff = dayIdx - today.getDay();
        const postDate = new Date(today);
        postDate.setDate(today.getDate() + diff);

        items.forEach((item, j) => {
          const [time] = (item.time || '10:00 AM').split(' ');
          const hour = parseInt(time.split(':')[0]);
          postDate.setHours(hour + j, 0, 0, 0);

          converted.push({
            id: PersonaGenAPI.Local.uuid(),
            persona_id: inf.handle,
            persona_name: inf.name,
            persona_initial: inf.initial,
            persona_gradient: inf.gradient,
            platforms: [item.platform?.toLowerCase().replace('twitter/x','x').replace('instagram','instagram') || 'x'],
            content: { text: item.description || item.type || '', hashtags: [], media_url: null, privacy: 'public' },
            status: 'scheduled',
            scheduled_at: postDate.toISOString(),
            timezone: 'America/New_York',
            created_at: new Date().toISOString(),
            generation_source: 'legacy',
          });
        });
      });
    });

    // Save to localStorage
    converted.forEach(p => PersonaGenAPI.Local.savePost(p));
    return converted;
  }

  // ─── Render Month View ───
  function renderMonth() {
    const label = document.getElementById('dcal-month-label');
    if (label) label.textContent = `${MONTHS[currentMonth]} ${currentYear}`;

    renderStats();

    const wrap = document.getElementById('dcal-grid-wrap');
    if (!wrap) return;

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();

    let html = '<div class="dcal-grid dcal-grid--month">';

    // Day headers
    DAYS.forEach(d => { html += `<div class="dcal-day-header">${d}</div>`; });

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="dcal-cell dcal-cell--empty"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = today.getDate() === day && today.getMonth() === currentMonth && today.getFullYear() === currentYear;
      const dayPosts = getPostsForDate(dateStr);

      html += `
        <div class="dcal-cell ${isToday ? 'dcal-cell--today' : ''}" onclick="PostComposer.open(null, '${dateStr}')">
          <div class="dcal-cell-header">
            <span class="dcal-cell-day ${isToday ? 'dcal-cell-day--today' : ''}">${day}</span>
            ${dayPosts.length > 0 ? `<span class="dcal-cell-count">${dayPosts.length}</span>` : ''}
          </div>
          <div class="dcal-cell-posts">
            ${dayPosts.slice(0, 3).map(p => renderPostChip(p)).join('')}
            ${dayPosts.length > 3 ? `<span class="dcal-cell-more">+${dayPosts.length - 3} more</span>` : ''}
          </div>
        </div>
      `;
    }

    // Fill remaining cells
    const totalCells = firstDay + daysInMonth;
    const remaining = 7 - (totalCells % 7);
    if (remaining < 7) {
      for (let i = 0; i < remaining; i++) {
        html += '<div class="dcal-cell dcal-cell--empty"></div>';
      }
    }

    html += '</div>';
    wrap.innerHTML = html;
  }

  // ─── Post Chip (inside calendar cell) ───
  function renderPostChip(post) {
    const status = STATUS_COLORS[post.status] || STATUS_COLORS.draft;
    const platIcons = (post.platforms || []).map(p => {
      const plat = PostComposer.PLATFORMS[p];
      return plat ? plat.icon : p;
    }).join(' ');

    const truncText = (post.content?.text || '').substring(0, 30);

    return `
      <div class="dcal-post-chip" style="background:${status.bg};border-left:3px solid ${status.border};"
           onclick="event.stopPropagation(); PostComposer.open(${JSON.stringify(post).replace(/"/g, '&quot;')})">
        <div class="dcal-post-chip-top">
          <span class="dcal-post-chip-dot" style="background:${status.dot}"></span>
          <span class="dcal-post-chip-plats">${platIcons}</span>
          <span class="dcal-post-chip-persona" style="background:${post.persona_gradient}">${post.persona_initial}</span>
        </div>
        <div class="dcal-post-chip-text">${truncText}</div>
      </div>
    `;
  }

  // ─── Stats ───
  function renderStats() {
    const statsEl = document.getElementById('dcal-stats');
    if (!statsEl) return;

    const monthPosts = getPostsForMonth(currentMonth, currentYear);
    const counts = { draft: 0, scheduled: 0, published: 0, failed: 0 };
    monthPosts.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });

    statsEl.innerHTML = `
      <div class="dcal-stat"><span class="dcal-stat-dot" style="background:var(--text-dim)"></span> ${counts.draft} Drafts</div>
      <div class="dcal-stat"><span class="dcal-stat-dot" style="background:var(--accent)"></span> ${counts.scheduled} Scheduled</div>
      <div class="dcal-stat"><span class="dcal-stat-dot" style="background:var(--success)"></span> ${counts.published} Published</div>
      ${counts.failed > 0 ? `<div class="dcal-stat"><span class="dcal-stat-dot" style="background:#ef4444"></span> ${counts.failed} Failed</div>` : ''}
      <div class="dcal-stat" style="margin-left:auto;color:var(--text-dim);">${monthPosts.length} total this month</div>
    `;
  }

  // ─── Helpers ───
  function getPostsForDate(dateStr) {
    return posts.filter(p => {
      const pDate = (p.scheduled_at || p.created_at || '').split('T')[0];
      const match = pDate === dateStr;
      if (!match) return false;
      if (filterPersona !== 'all' && p.persona_id !== filterPersona) return false;
      return true;
    });
  }

  function getPostsForMonth(month, year) {
    return posts.filter(p => {
      const d = new Date(p.scheduled_at || p.created_at);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }

  // ─── Navigation ───
  function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderMonth();
  }

  function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderMonth();
  }

  function goToday() {
    currentMonth = new Date().getMonth();
    currentYear = new Date().getFullYear();
    renderMonth();
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll('.dcal-view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    if (view === 'month') renderMonth();
    else renderWeek();
  }

  function renderWeek() {
    // Simplified week view — show current week
    const wrap = document.getElementById('dcal-grid-wrap');
    if (!wrap) return;

    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    let html = '<div class="dcal-week-grid">';

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const isToday = d.toDateString() === today.toDateString();
      const dayPosts = getPostsForDate(dateStr);

      html += `
        <div class="dcal-week-day ${isToday ? 'dcal-week-day--today' : ''}" onclick="PostComposer.open(null, '${dateStr}')">
          <div class="dcal-week-day-header">
            <span class="dcal-week-day-name">${DAYS[i]}</span>
            <span class="dcal-week-day-num ${isToday ? 'dcal-cell-day--today' : ''}">${d.getDate()}</span>
          </div>
          <div class="dcal-week-day-posts">
            ${dayPosts.map(p => renderPostChip(p)).join('')}
            ${dayPosts.length === 0 ? '<div class="dcal-week-empty">No posts</div>' : ''}
          </div>
        </div>
      `;
    }

    html += '</div>';
    wrap.innerHTML = html;
  }

  function filterByPersona(value) {
    filterPersona = value;
    if (currentView === 'month') renderMonth();
    else renderWeek();
  }

  function refresh() {
    loadPosts();
    if (currentView === 'month') renderMonth();
    else renderWeek();
  }

  return { init, prevMonth, nextMonth, goToday, setView, filterByPersona, refresh, renderMonth };
})();

// Auto-init on built sub-pages
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('dynamic-calendar-mount');
  if (mount && !mount.hasChildNodes()) {
    DynamicCalendar.init('dynamic-calendar-mount');
  }
});
