<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		sidebarState,
		toggleSidebar,
		toggleSidebarCollapse,
		closeSidebar,
		themeState,
		toggleTheme,
		initializeThemeAndColors
	} from '$lib/stores/ui.svelte';
	import { onMount } from 'svelte';
	import BrandWave from '$lib/components/shared/BrandWave.svelte';

	let { children, data } = $props();

	onMount(() => {
		initializeThemeAndColors();
	});

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

	const staticSections = {
		network: [{ href: '/dashboard', label: 'Dashboard', icon: 'grid' }],
		publish: [{ href: '/calendar', label: 'Calendar', icon: 'calendar' }],
		setup: [
			{ href: '/brand-brief', label: 'Brand Brief', icon: 'bolt' },
			{ href: '/settings', label: 'Settings', icon: 'settings' }
		]
	};

	let sidebarAgents = $derived((data as any).sidebarAgents ?? []);

	function isActive(href: string, pathname: string): boolean {
		const baseHref = href.split('?')[0];
		if (baseHref === '/dashboard') return pathname === '/dashboard' || pathname === '/';
		return pathname.startsWith(baseHref);
	}

	function isAgentActive(agentId: string, pathname: string): boolean {
		return pathname.startsWith(`/personas/${agentId}`);
	}
</script>

<svelte:window onclick={closeUserDropdown} />

<div class="portal-layout" class:sidebar-collapsed={sidebarState.collapsed}>
	<!-- Sidebar overlay (mobile) -->
	{#if sidebarState.open}
		<button class="sidebar-overlay" onclick={closeSidebar} aria-label="Close sidebar" tabindex="-1"
		></button>
	{/if}

	<!-- Sidebar -->
	<aside class="sidebar" class:open={sidebarState.open} aria-label="Main navigation">
		<!-- Brand -->
		<div class="sidebar-brand">
			<a href="/dashboard" class="sidebar-logo-link">
				<div class="sidebar-logo">
					<svg
						aria-hidden="true"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
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
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					{#if sidebarState.collapsed}
						<path d="M9 18l6-6-6-6" />
					{:else}
						<path d="M15 18l-6-6 6-6" />
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
			<!-- NETWORK -->
			{#if !sidebarState.collapsed}
				<span class="sidebar-section-label">Network</span>
			{/if}
			{#each staticSections.network as item}
				<a
					href={item.href}
					class="sidebar-nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? item.label : undefined}
				>
					<span class="sidebar-nav-icon">
						{#if item.icon === 'grid'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
								><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
						{/if}
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">{item.label}</span>
					{/if}
				</a>
			{/each}

			<!-- PERSONAS -->
			{#if !sidebarState.collapsed}
				<span class="sidebar-section-label">Personas</span>
			{:else}
				<div class="sidebar-section-divider"></div>
			{/if}
			{#each sidebarAgents as agent (agent.id)}
				<a
					href="/personas/{agent.id}"
					class="sidebar-nav-item sidebar-persona-item"
					class:active={isAgentActive(agent.id, $page.url.pathname)}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? `${agent.name} (${agent.handle})` : undefined}
				>
					<span class="sidebar-persona-avatar" style="background: {agent.gradient ?? 'var(--gradient)'}">
						{agent.initial ?? (agent.name?.[0] ?? '?').toUpperCase()}
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">
							{agent.name}
							<span class="sidebar-persona-status" class:status-active={agent.status === 'active'} class:status-paused={agent.status === 'paused'}></span>
						</span>
					{/if}
				</a>
			{/each}
			<a
				href="/generator"
				class="sidebar-nav-item sidebar-new-persona"
				onclick={closeSidebar}
				title={sidebarState.collapsed ? 'New Persona' : undefined}
			>
				<span class="sidebar-nav-icon sidebar-new-icon">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				</span>
				{#if !sidebarState.collapsed}
					<span class="sidebar-nav-label">New Persona</span>
				{/if}
			</a>

			<!-- PUBLISH -->
			{#if !sidebarState.collapsed}
				<span class="sidebar-section-label">Publish</span>
			{:else}
				<div class="sidebar-section-divider"></div>
			{/if}
			{#each staticSections.publish as item}
				<a
					href={item.href}
					class="sidebar-nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? item.label : undefined}
				>
					<span class="sidebar-nav-icon">
						{#if item.icon === 'calendar'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
								><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
						{/if}
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">{item.label}</span>
					{/if}
				</a>
			{/each}

			<!-- SETUP -->
			{#if !sidebarState.collapsed}
				<span class="sidebar-section-label">Setup</span>
			{:else}
				<div class="sidebar-section-divider"></div>
			{/if}
			{#each staticSections.setup as item}
				<a
					href={item.href}
					class="sidebar-nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? item.label : undefined}
				>
					<span class="sidebar-nav-icon">
						{#if item.icon === 'bolt'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
						{:else if item.icon === 'settings'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
								><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
						{/if}
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">{item.label}</span>
					{/if}
				</a>
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
				<button class="hamburger-btn" onclick={toggleSidebar} aria-label="Toggle navigation menu">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="3" y1="12" x2="21" y2="12" />
						<line x1="3" y1="6" x2="21" y2="6" />
						<line x1="3" y1="18" x2="21" y2="18" />
					</svg>
				</button>
				<h2 class="portal-header-title">
					{(() => {
						const path = $page.url.pathname;
						if (path.startsWith('/personas/')) {
							const agent = sidebarAgents.find((a: any) => path.startsWith(`/personas/${a.id}`));
							return agent ? agent.name : 'Persona';
						}
						if (path.startsWith('/brand-brief')) return 'Brand Brief';
						if (path.startsWith('/chat')) return 'Agent Chat Portal';
						if (path.startsWith('/settings/overseer')) return 'Hermes Overseer Config';
						if (path.startsWith('/settings')) return 'Settings';
						if (path.startsWith('/generator')) return 'New Persona';
						if (path.startsWith('/calendar')) return 'Calendar';
						if (path === '/dashboard' || path === '/') return 'Dashboard';
						return 'Dashboard';
					})()}
				</h2>
			</div>
			<div class="portal-header-right">
				<!-- Gorgeous Light/Dark Mode Switcher -->
				<button
					class="theme-toggle-btn"
					onclick={toggleTheme}
					aria-label="Toggle theme"
					title="Switch to {themeState.current === 'light' ? 'Dark' : 'Light'} Mode"
				>
					{#if themeState.current === 'light'}
						<!-- Moon Icon -->
						<svg
							class="theme-icon moon-icon"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
						</svg>
					{:else}
						<!-- Sun Icon -->
						<svg
							class="theme-icon sun-icon"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="12" cy="12" r="5" />
							<line x1="12" y1="1" x2="12" y2="3" />
							<line x1="12" y1="21" x2="12" y2="23" />
							<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
							<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
							<line x1="1" y1="12" x2="3" y2="12" />
							<line x1="21" y1="12" x2="23" y2="12" />
							<line x1="4.22" y1="18.36" x2="5.64" y2="19.78" />
							<line x1="18.36" y1="4.22" x2="19.78" y2="5.64" />
						</svg>
					{/if}
				</button>

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
								<span class="user-email">{data.user?.email ?? ''}</span>
							</div>
							<hr class="dropdown-divider" />
							<button class="dropdown-item logout-btn" role="menuitem" onclick={handleLogout}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
									<polyline points="16 17 21 12 16 7" />
									<line x1="21" y1="12" x2="9" y2="12" />
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

<BrandWave />

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
		border-right: 1px solid var(--border);
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
		transition:
			width 0.3s cubic-bezier(0.16, 1, 0.3, 1),
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
		transition:
			opacity 0.2s ease,
			background 0.2s ease,
			color 0.2s ease;
	}

	.sidebar:hover .sidebar-collapse-btn {
		opacity: 1;
	}

	.sidebar-collapse-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	/* ── Client badge ── */
	.sidebar-client {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--bg);
		border: 1px solid var(--border);
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
		transition:
			opacity 0.15s ease,
			stroke 0.15s ease;
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
		background: var(--surface-2);
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
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
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
		border-bottom: 1px solid var(--border);
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
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.hamburger-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	.portal-header-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.theme-toggle-btn {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow: var(--shadow-sm);
	}

	.theme-toggle-btn:hover {
		border-color: var(--border-hover);
		color: var(--accent);
		background: var(--surface-3);
		transform: scale(1.05) rotate(12deg);
		box-shadow: var(--shadow-md);
	}

	.theme-icon {
		transition: transform 0.5s var(--ease-out);
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
		transition:
			border-color 0.2s ease,
			background 0.2s ease;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
	}

	.portal-user-badge:hover {
		border-color: var(--border-hover);
		background: var(--surface-3);
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
		transition:
			background 0.15s ease,
			color 0.15s ease;
		font-family: inherit;
	}

	.dropdown-item:hover {
		background: var(--surface-2);
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

	/* ── Persona sidebar items ── */
	.sidebar-persona-item {
		gap: 10px;
	}

	.sidebar-persona-avatar {
		width: 24px;
		height: 24px;
		border-radius: 7px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.62rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		letter-spacing: -0.01em;
	}

	.sidebar-collapsed .sidebar-persona-avatar {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		font-size: 0.68rem;
	}

	.sidebar-persona-status {
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		margin-left: 4px;
		background: var(--text-dim);
		flex-shrink: 0;
		vertical-align: middle;
	}

	.sidebar-persona-status.status-active {
		background: var(--success);
		box-shadow: 0 0 4px rgba(52, 211, 153, 0.6);
	}

	.sidebar-persona-status.status-paused {
		background: var(--warning);
	}

	.sidebar-new-persona {
		color: var(--text-dim);
		border: 1px dashed var(--border);
		margin-top: 4px;
	}

	.sidebar-new-persona:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.sidebar-new-icon {
		width: 24px;
		height: 24px;
		border-radius: 7px;
		background: var(--surface-2);
		border: 1px dashed var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.sidebar-new-persona:hover .sidebar-new-icon {
		border-color: var(--accent-mid);
		background: var(--accent-soft);
	}

	.sidebar-section-divider {
		height: 1px;
		background: var(--border);
		margin: var(--space-3) 6px;
	}
</style>
