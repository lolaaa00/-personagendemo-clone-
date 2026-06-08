<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { sidebarState, toggleSidebar, toggleSidebarCollapse, closeSidebar } from '$lib/stores/ui.svelte';

  let { children, data } = $props();

  let userDropdownOpen = $state(false);

  function toggleUserDropdown(event: MouseEvent) {
    event.stopPropagation();
    userDropdownOpen = !userDropdownOpen;
  }

  function closeUserDropdown() {
    userDropdownOpen = false;
  }

  async function handleLogout() {
    closeUserDropdown();
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        await goto('/login');
      } else {
        console.error('Logout failed');
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  }

  const navSections = [
    {
      label: 'Overview',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
        { href: '/scout', label: 'Social Scout', icon: 'radar' },
        { href: '/trends', label: 'Trends', icon: 'trending' },
      ]
    },
    {
      label: 'Create',
      items: [
        { href: '/generator', label: 'Generate Agent', icon: 'sparkles' },
        { href: '/persona-config', label: 'Persona Config', icon: 'users' },
        { href: '/calendar', label: 'Content Calendar', icon: 'calendar' },
      ]
    },
    {
      label: 'Intelligence',
      items: [
        { href: '/intel-wizard', label: 'Intel Wizard', icon: 'search' },
        { href: '/channel-decoder', label: 'Channel Decoder', icon: 'decode' },
        { href: '/content-forge', label: 'Content Forge', icon: 'forge' },
      ]
    },
    {
      label: 'Manage',
      items: [
        { href: '/inbox', label: 'Inbox', icon: 'inbox' },
        { href: '/accounts', label: 'AI Accounts', icon: 'link' },
        { href: '/pm', label: 'Projects', icon: 'folder' },
        { href: '/brand-brief', label: 'Brand Brief', icon: 'bolt' },
        { href: '/agreement', label: 'Agreement', icon: 'file' },
        { href: '/settings', label: 'Settings', icon: 'settings' },
      ]
    }
  ];

  function isActive(href: string, pathname: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    return pathname.startsWith(href);
  }
</script>

<svelte:window onclick={closeUserDropdown} />

<div class="portal-layout" class:sidebar-collapsed={sidebarState.collapsed}>
  <!-- Sidebar overlay (mobile) -->
  {#if sidebarState.open}
    <button
      class="sidebar-overlay"
      onclick={closeSidebar}
      aria-label="Close sidebar"
      tabindex="-1"
    ></button>
  {/if}

  <!-- Sidebar -->
  <aside class="sidebar" class:open={sidebarState.open} aria-label="Main navigation">
    <!-- Brand -->
    <div class="sidebar-brand">
      <a href="/dashboard" class="sidebar-logo-link">
        <div class="sidebar-logo">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        {#if !sidebarState.collapsed}
          <span class="sidebar-wordmark">PersonaGen</span>
        {/if}
      </a>
      <button
        class="sidebar-collapse-btn"
        onclick={toggleSidebarCollapse}
        aria-label={sidebarState.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {#if sidebarState.collapsed}
            <path d="M9 18l6-6-6-6"/>
          {:else}
            <path d="M15 18l-6-6 6-6"/>
          {/if}
        </svg>
      </button>
    </div>

    <!-- Client badge -->
    {#if !sidebarState.collapsed}
      <div class="sidebar-client">
        <span class="sidebar-client-dot"></span>
        <span class="sidebar-client-name">{data.user?.email?.split('@')[0] ?? 'Client'}</span>
      </div>
    {/if}

    <!-- Navigation -->
    <nav class="sidebar-nav">
      {#each navSections as section}
        {#if !sidebarState.collapsed}
          <span class="sidebar-section-label">{section.label}</span>
        {/if}
        {#each section.items as item}
          <a
            href={item.href}
            class="sidebar-nav-item"
            class:active={isActive(item.href, $page.url.pathname)}
            onclick={closeSidebar}
            title={sidebarState.collapsed ? item.label : undefined}
          >
            <span class="sidebar-nav-icon">
              {#if item.icon === 'grid'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              {:else if item.icon === 'search'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {:else if item.icon === 'bolt'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              {:else if item.icon === 'sparkles'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5.636 5.636l12.728 12.728M3 12h18M5.636 18.364L18.364 5.636"/></svg>
              {:else if item.icon === 'users'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
              {:else if item.icon === 'calendar'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {:else if item.icon === 'radar'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
              {:else if item.icon === 'trending'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              {:else if item.icon === 'decode'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              {:else if item.icon === 'forge'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              {:else if item.icon === 'inbox'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
              {:else if item.icon === 'link'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              {:else if item.icon === 'folder'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              {:else if item.icon === 'file'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              {:else if item.icon === 'settings'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              {/if}
            </span>
            {#if !sidebarState.collapsed}
              <span class="sidebar-nav-label">{item.label}</span>
            {/if}
          </a>
        {/each}
      {/each}
    </nav>

    <!-- Bottom -->
    <div class="sidebar-bottom">
      {#if !sidebarState.collapsed}
        <div class="sidebar-plan-badge">
          <span class="sidebar-plan-dot"></span>
          <span>Managed Plan · Active</span>
        </div>
      {/if}
    </div>
  </aside>

  <!-- Main area -->
  <div class="portal-main">
    <!-- Header -->
    <header class="portal-header">
      <div class="portal-header-left">
        <button
          class="hamburger-btn"
          onclick={toggleSidebar}
          aria-label="Toggle navigation menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <h2 class="portal-header-title">
          {navSections
            .flatMap(s => s.items)
            .find(i => isActive(i.href, $page.url.pathname))?.label ?? 'Dashboard'}
        </h2>
      </div>
      <div class="portal-header-right">
        <div class="portal-user-badge-container">
          <button
            class="portal-user-badge"
            onclick={toggleUserDropdown}
            aria-expanded={userDropdownOpen}
            aria-haspopup="true"
            aria-label="User menu"
          >
            <span class="portal-user-avatar">
              {(data.user?.email?.[0] ?? 'U').toUpperCase()}
            </span>
            {#if !sidebarState.collapsed}
              <span class="portal-user-name">
                {data.user?.email?.split('@')[0] ?? 'User'}
              </span>
            {/if}
          </button>

          {#if userDropdownOpen}
            <div class="user-dropdown-menu glass-card" role="menu">
              <div class="user-dropdown-info">
                <span class="user-email">{data.user?.email ?? 'client@personagen.ai'}</span>
              </div>
              <hr class="dropdown-divider" />
              <a href="/settings" class="dropdown-item" role="menuitem" onclick={closeUserDropdown}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                Settings
              </a>
              <a href="/settings/billing" class="dropdown-item" role="menuitem" onclick={closeUserDropdown}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
                Billing & Subscription
              </a>
              <hr class="dropdown-divider" />
              <button class="dropdown-item logout-btn" role="menuitem" onclick={handleLogout}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Log Out
              </button>
            </div>
          {/if}
        </div>
      </div>
    </header>

    <!-- Page content -->
    <main class="portal-content">
      {@render children()}
    </main>
  </div>
</div>

<style>
  /* ═══════════════════════════════════════════════════════════════
     PORTAL LAYOUT — Sidebar + Header + Content
     ═══════════════════════════════════════════════════════════════ */

  .portal-layout {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    height: 100vh;
    height: 100dvh;
    background: var(--bg);
    position: relative;
    overflow: hidden;
    transition: grid-template-columns 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .portal-layout.sidebar-collapsed {
    grid-template-columns: var(--sidebar-collapsed-width) 1fr;
  }

  /* ── Sidebar overlay (mobile) ── */
  .sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: calc(var(--z-drawer) - 1);
    border: none;
    cursor: default;
  }

  /* ── Sidebar ── */
  .sidebar {
    background: var(--surface);
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    padding: var(--space-5) var(--space-4);
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    position: sticky;
    top: 0;
    overflow-y: auto;
    overflow-x: hidden;
    z-index: var(--z-nav);
    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1),
                padding 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .sidebar-collapsed .sidebar {
    padding: var(--space-5) var(--space-2);
  }

  /* ── Brand ── */
  .sidebar-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-5);
    min-height: 40px;
  }

  .sidebar-logo-link {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    color: inherit;
    flex: 1;
    min-width: 0;
  }

  .sidebar-logo-link:hover {
    color: inherit;
  }

  .sidebar-logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--gradient);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    box-shadow: 0 0 20px rgba(124, 106, 237, 0.3);
    flex-shrink: 0;
  }

  .sidebar-wordmark {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.05rem;
    background: var(--gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    white-space: nowrap;
  }

  .sidebar-collapse-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.2s ease, background 0.2s ease, color 0.2s ease;
  }

  .sidebar:hover .sidebar-collapse-btn {
    opacity: 1;
  }

  .sidebar-collapse-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
  }

  /* ── Client badge ── */
  .sidebar-client {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    padding: 8px 12px;
    margin-bottom: var(--space-5);
  }

  .sidebar-client-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
    flex-shrink: 0;
  }

  .sidebar-client-name {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Navigation ── */
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .sidebar-section-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    font-weight: 700;
    padding: var(--space-4) 10px var(--space-1);
    white-space: nowrap;
  }

  .sidebar-nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px;
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
    white-space: nowrap;
  }

  .sidebar-collapsed .sidebar-nav-item {
    justify-content: center;
    padding: 9px;
  }

  .sidebar-nav-item:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text);
  }

  .sidebar-nav-item:hover .sidebar-nav-icon :global(svg) {
    opacity: 0.75;
  }

  .sidebar-nav-item.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .sidebar-nav-item.active .sidebar-nav-icon :global(svg) {
    opacity: 1;
    stroke: var(--accent);
  }

  .sidebar-nav-item:focus-visible {
    box-shadow: 0 0 0 2px var(--accent-mid);
    outline: none;
  }

  .sidebar-nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .sidebar-nav-icon :global(svg) {
    opacity: 0.5;
    transition: opacity 0.15s ease, stroke 0.15s ease;
  }

  .sidebar-nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Sidebar bottom ── */
  .sidebar-bottom {
    margin-top: auto;
    padding-top: var(--space-4);
  }

  .sidebar-plan-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border);
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }

  .sidebar-plan-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
    flex-shrink: 0;
    animation: pulse-dot 2s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* ═══════════════════════════════════════════════════════════════
     MAIN AREA
     ═══════════════════════════════════════════════════════════════ */

  .portal-main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    position: relative;
  }

  /* ── Header ── */
  .portal-header {
    height: var(--header-height);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-6);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: var(--z-header);
    flex-shrink: 0;
  }

  .portal-header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .portal-header-title {
    font-family: var(--font-body);
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .hamburger-btn {
    display: none;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .hamburger-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
  }

  .portal-header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .portal-user-badge-container {
    position: relative;
    display: inline-block;
  }

  .portal-user-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 14px 5px 5px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
  }

  .portal-user-badge:hover {
    border-color: var(--border-hover);
    background: rgba(255, 255, 255, 0.04);
  }

  .portal-user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--rose));
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 700;
    font-size: 0.7rem;
    flex-shrink: 0;
  }

  .portal-user-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
  }

  .user-dropdown-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 220px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    z-index: 100;
    animation: dropdown-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes dropdown-fade-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .user-dropdown-info {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
  }

  .user-email {
    font-size: 0.78rem;
    color: var(--text-dim);
    word-break: break-all;
  }

  .dropdown-divider {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 6px 0;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 0.82rem;
    text-decoration: none;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.15s ease, color 0.15s ease;
    font-family: inherit;
  }

  .dropdown-item:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text);
  }

  .dropdown-item :global(svg) {
    opacity: 0.5;
    transition: opacity 0.15s ease;
  }

  .dropdown-item:hover :global(svg) {
    opacity: 0.8;
  }

  .logout-btn {
    color: var(--error);
  }

  .logout-btn:hover {
    background: var(--error-soft);
    color: #ff6b6b;
  }

  /* ── Content ── */
  .portal-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-8);
  }

  /* ═══════════════════════════════════════════════════════════════
     MOBILE RESPONSIVE
     ═══════════════════════════════════════════════════════════════ */

  @media (max-width: 768px) {
    .portal-layout {
      grid-template-columns: 1fr;
    }

    .portal-layout.sidebar-collapsed {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--sidebar-width);
      transform: translateX(-100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: var(--z-drawer);
      padding: var(--space-5) var(--space-4);
    }

    .sidebar.open {
      transform: translateX(0);
    }

    .sidebar-overlay {
      display: block;
    }

    .sidebar-collapse-btn {
      display: none;
    }

    .hamburger-btn {
      display: flex;
    }

    .portal-content {
      padding: var(--space-4);
    }

    .portal-header-title {
      font-size: 0.95rem;
    }

    .portal-user-name {
      display: none;
    }

    .portal-user-badge {
      padding: 4px;
    }
  }

  @media (min-width: 769px) and (max-width: 1024px) {
    .portal-content {
      padding: var(--space-6);
    }
  }
</style>
