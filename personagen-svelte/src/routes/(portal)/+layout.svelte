<script lang="ts">
	import { thumbUrl, restoreOriginal } from '$lib/image-url';
	import { page } from '$app/stores';
	import { goto, afterNavigate } from '$app/navigation';
	import {
		sidebarState,
		toggleSidebar,
		toggleSidebarCollapse,
		closeSidebar,
		themeState,
		toggleTheme,
		initializeThemeAndColors,
		showToast
	} from '$lib/stores/ui.svelte';
	import { onMount } from 'svelte';
	import { primePricing } from '$lib/stores/pricing.svelte';
	import { invalidateAll } from '$app/navigation';
	import BrandWave from '$lib/components/shared/BrandWave.svelte';
	import PersonaProjectsModal from '$lib/components/shared/PersonaProjectsModal.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	let { children, data } = $props();

	// Every screen that quotes a generation reads this — primed from the same
	// server data the wallet pill uses, so a quote and the wallet can't disagree.
	$effect.pre(() => {
		primePricing((data as any)?.pricing);
	});

	onMount(() => {
		initializeThemeAndColors();
	});

	// ── Pending workspace invites — "you've been invited" banner ────────────
	// This is exactly the moment a brand-new, otherwise-blank account needs to
	// see it: nothing else on the page has content yet to compete for attention.
	let pendingInvites = $derived((data as any).pendingInvites ?? []);
	let invitesBusy = $state<Record<string, boolean>>({});

	async function respondToInvite(invite: { id: string; token: string }, accept: boolean) {
		invitesBusy = { ...invitesBusy, [invite.id]: true };
		try {
			const res = await fetch(`/api/workspaces/invites/${invite.token}/${accept ? 'accept' : 'decline'}`, {
				method: 'POST'
			});
			const result = await res.json();
			if (!result.success) throw new Error(result.error || 'Something went wrong');

			showToast(
				accept ? `Joined ${result.workspace?.name ?? 'the workspace'}` : 'Invite declined',
				'success'
			);
			await invalidateAll();
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			invitesBusy = { ...invitesBusy, [invite.id]: false };
		}
	}

	// ── Forced first-login password change ───────────────────────────────────
	// Provisioned team accounts all start on one shared starter password; this
	// blocks the whole portal until they've set their own.
	let mustChangePassword = $derived(Boolean((data as any).mustChangePassword));
	// Admin console entry — only rendered for workspace owners / admin seats.
	let isPlatformAdmin = $derived(Boolean((data as any).isPlatformAdmin));
	let isWorkspaceAdmin = $derived(Boolean((data as any).isWorkspaceAdmin) || isPlatformAdmin);
	let pwNew = $state('');
	let pwConfirm = $state('');
	let pwSaving = $state(false);

	async function submitPasswordChange(e: SubmitEvent) {
		e.preventDefault();
		pwSaving = true;
		try {
			const res = await fetch('/api/settings/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPassword: pwNew, confirmPassword: pwConfirm })
			});
			const result = await res.json();
			if (!result.success) throw new Error(result.error || 'Failed to change password');
			showToast('Password updated — welcome aboard', 'success');
			pwNew = '';
			pwConfirm = '';
			await invalidateAll();
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			pwSaving = false;
		}
	}

	let userDropdownOpen = $state(false);
	let userMenuTrigger = $state<HTMLButtonElement | null>(null);

	// a11y: on SPA navigation the focus ring is otherwise stranded on the previous
	// page's link, so screen readers keep announcing the old context.
	let mainContentEl: HTMLElement | null = $state(null);

	afterNavigate((nav) => {
		if (nav.type === 'enter') return; // initial load — leave focus at document start
		mainContentEl?.focus();
	});

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
		library: [
			{ href: '/generations', label: 'All Generations', icon: 'gallery' },
			{ href: '/favorites', label: 'My Favorites', icon: 'heart' },
			{ href: '/trash', label: 'Trash', icon: 'trash' }
		],
		publish: [
			{ href: '/review', label: 'Review Queue', icon: 'check' },
			{ href: '/calendar', label: 'Calendar', icon: 'calendar' }
		],
		setup: [
			{ href: '/brand-brief', label: 'Brand Brief', icon: 'bolt' },
			{ href: '/models', label: 'Model Manager', icon: 'sliders' },
			{ href: '/guides', label: 'Docs', icon: 'book' },
			{ href: '/developer', label: 'Developer API', icon: 'code' },
			// Billing was reachable only through the sidebar credit pill, which is
			// hidden when the sidebar is collapsed and absent entirely when credits
			// mode is off — so a shipped Stripe checkout, plan picker and ledger
			// had no dependable way in.
			{ href: '/billing', label: 'Billing', icon: 'card' },
			{ href: '/settings', label: 'Settings', icon: 'settings' }
		]
	};

	let sidebarAgents = $derived((data as any).sidebarAgents ?? []);
	let personaGroups = $derived((data as any).personaGroups ?? []);

	let personaSearch = $state('');
	let projectsModalOpen = $state(false);

	// Collapsed project sections (session-scoped; searching overrides collapse so
	// matches are never hidden behind a folded header).
	let collapsedGroups = $state<string[]>([]);

	function toggleGroupCollapsed(groupId: string) {
		collapsedGroups = collapsedGroups.includes(groupId)
			? collapsedGroups.filter((id) => id !== groupId)
			: [...collapsedGroups, groupId];
	}

	let filteredSidebarAgents = $derived.by(() => {
		const query = personaSearch.trim().toLowerCase();
		const list = query
			? sidebarAgents.filter((agent: any) => (agent.name ?? '').toLowerCase().includes(query))
			: [...sidebarAgents];
		// Sort: active personas first, then alphabetical by name.
		return list.sort((a: any, b: any) => {
			const aActive = a.status === 'active' ? 0 : 1;
			const bActive = b.status === 'active' ? 0 : 1;
			if (aActive !== bActive) return aActive - bActive;
			return (a.name ?? '').localeCompare(b.name ?? '');
		});
	});

	// Grouped rail: projects (with their matching members) first, then ungrouped.
	// A project with zero matches disappears while searching but stays visible
	// (empty) otherwise, so a freshly created project has somewhere to exist.
	let groupedSidebar = $derived.by(() => {
		const searching = personaSearch.trim().length > 0;
		const sections = personaGroups
			.map((group: any) => ({
				group,
				members: filteredSidebarAgents.filter((a: any) => a.group_id === group.id)
			}))
			.filter((s: any) => !searching || s.members.length > 0);
		const groupIds = new Set(personaGroups.map((g: any) => g.id));
		const ungrouped = filteredSidebarAgents.filter(
			(a: any) => !a.group_id || !groupIds.has(a.group_id)
		);
		return { sections, ungrouped };
	});

	function isActive(href: string, pathname: string): boolean {
		const baseHref = href.split('?')[0];
		if (baseHref === '/dashboard') return pathname === '/dashboard' || pathname === '/';
		return pathname.startsWith(baseHref);
	}

	function isAgentActive(agentId: string, pathname: string): boolean {
		return pathname.startsWith(`/personas/${agentId}`);
	}
</script>

<svelte:window
	onclick={closeUserDropdown}
	onkeydown={(e) => {
		if (e.key !== 'Escape' || !userDropdownOpen) return;
		closeUserDropdown();
		// Focus goes back to what opened it, not to the top of the document.
		userMenuTrigger?.focus();
	}}
/>

<a href="#main-content" class="skip-link">Skip to main content</a>

<div class="portal-layout" class:sidebar-collapsed={sidebarState.collapsed}>
	<!-- Sidebar overlay (mobile) -->
	{#if sidebarState.open}
		<button class="sidebar-overlay" onclick={closeSidebar} aria-label="Close sidebar" tabindex="-1"
		></button>
	{/if}

	<!-- Sidebar -->
	<aside class="sidebar" class:open={sidebarState.open} aria-label="Sidebar">
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
					aria-hidden="true"
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
		<nav class="sidebar-nav" aria-label="Main navigation">
			<!-- NETWORK -->
			{#if !sidebarState.collapsed}
				<span class="sidebar-section-label">Network</span>
			{/if}
			{#each staticSections.network as item}
				<a
					href={item.href}
					class="sidebar-nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? item.label : undefined}
					aria-label={sidebarState.collapsed ? item.label : undefined}
				>
					<span class="sidebar-nav-icon">
						{#if item.icon === 'grid'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><rect x="3" y="3" width="7" height="7" rx="1" /><rect
									x="14"
									y="3"
									width="7"
									height="7"
									rx="1"
								/><rect x="3" y="14" width="7" height="7" rx="1" /><rect
									x="14"
									y="14"
									width="7"
									height="7"
									rx="1"
								/></svg
							>
						{/if}
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">{item.label}</span>
					{/if}
				</a>
			{/each}

			<!-- LIBRARY -->
			{#if !sidebarState.collapsed}
				<span class="sidebar-section-label">Library</span>
			{:else}
				<div class="sidebar-section-divider"></div>
			{/if}
			{#each staticSections.library as item}
				<a
					href={item.href}
					class="sidebar-nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? item.label : undefined}
					aria-label={sidebarState.collapsed ? item.label : undefined}
				>
					<span class="sidebar-nav-icon">
						{#if item.icon === 'gallery'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><rect x="3" y="3" width="18" height="18" rx="2" /><circle
									cx="8.5"
									cy="8.5"
									r="1.5"
								/><path d="M21 15l-5-5L5 21" /></svg
							>
						{:else if item.icon === 'trash'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M3 6h18" /><path
									d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
								/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg
							>
						{:else if item.icon === 'heart'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path
									d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
								/></svg
							>
						{/if}
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">{item.label}</span>
					{/if}
				</a>
			{/each}

			<!-- PERSONAS -->
			<div class="sidebar-personas">
			{#if !sidebarState.collapsed}
				<div class="sidebar-section-row">
					<span class="sidebar-section-label">Personas</span>
					<button
						type="button"
						class="sidebar-projects-btn"
						onclick={() => (projectsModalOpen = true)}
						aria-label="Manage projects"
						title="Manage projects"
					>
						<svg
							aria-hidden="true"
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path
								d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
							/><line x1="12" y1="10" x2="12" y2="16" /><line x1="9" y1="13" x2="15" y2="13" /></svg
						>
					</button>
				</div>
			{:else}
				<div class="sidebar-section-divider"></div>
			{/if}
			{#if !sidebarState.collapsed && sidebarAgents.length > 4}
				<div class="sidebar-persona-search">
					<svg
						aria-hidden="true"
						class="sidebar-persona-search-icon"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
					>
					<input
						type="search"
						class="sidebar-persona-search-input"
						placeholder="Search personas..."
						bind:value={personaSearch}
						aria-label="Search personas"
					/>
				</div>
			{/if}
			<a
				href="/generator"
				class="sidebar-nav-item sidebar-new-persona"
				class:active={isActive('/generator', $page.url.pathname)}
				aria-current={isActive('/generator', $page.url.pathname) ? 'page' : undefined}
				onclick={closeSidebar}
				title={sidebarState.collapsed ? 'New Persona' : undefined}
				aria-label={sidebarState.collapsed ? 'New Persona' : undefined}
			>
				<span class="sidebar-nav-icon sidebar-new-icon">
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
					>
				</span>
				{#if !sidebarState.collapsed}
					<span class="sidebar-nav-label">New Persona</span>
				{/if}
			</a>
			{#snippet personaItem(agent: any)}
				<a
					href="/personas/{agent.id}"
					class="sidebar-nav-item sidebar-persona-item"
					class:active={isAgentActive(agent.id, $page.url.pathname)}
					aria-current={isAgentActive(agent.id, $page.url.pathname) ? 'page' : undefined}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? agent.name : undefined}
					aria-label={sidebarState.collapsed ? agent.name : undefined}
				>
					<span
						class="sidebar-persona-avatar"
						style={agent.ugc_character_ref
							? ''
							: `background: ${agent.gradient ?? 'var(--gradient)'}`}
					>
						{#if agent.ugc_character_ref}
							<!-- decorative: the persona name is announced by the link label beside it -->
							<!-- 64px covers the 28px box at 2x DPR; these were pulling the full
							     1.5MB original for a 24px avatar, on every portal page. -->
							<img
								src={thumbUrl(agent.ugc_character_ref, 64)}
								onerror={(e) => restoreOriginal(e, agent.ugc_character_ref)}
								alt=""
								width="28"
								height="28"
								loading="lazy"
								decoding="async"
							/>
						{:else}
							{agent.initial ?? (agent.name?.[0] ?? '?').toUpperCase()}
						{/if}
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">
							{agent.name}
							<span
								class="sidebar-persona-status"
								class:status-active={agent.status === 'active'}
								class:status-paused={agent.status === 'paused'}
							></span>
							<!-- the dot encodes status by colour alone — name it for AT -->
							{#if agent.status === 'active' || agent.status === 'paused'}
								<span class="sr-only">({agent.status === 'active' ? 'Active' : 'Paused'})</span>
							{/if}
						</span>
					{/if}
				</a>
			{/snippet}

			{#if sidebarState.collapsed}
				<!-- Icon rail: groups add nothing at 28px wide — flat list. -->
				{#each filteredSidebarAgents as agent (agent.id)}
					{@render personaItem(agent)}
				{/each}
			{:else}
				<!-- Projects first, each a collapsible section; searching overrides collapse. -->
				{#each groupedSidebar.sections as section (section.group.id)}
					{@const folded = collapsedGroups.includes(section.group.id) && !personaSearch.trim()}
					<button
						type="button"
						class="sidebar-group-head"
						aria-expanded={!folded}
						onclick={() => toggleGroupCollapsed(section.group.id)}
					>
						<svg
							aria-hidden="true"
							class="sidebar-group-chevron"
							class:folded
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg
						>
						<span class="sidebar-group-name">{section.group.name}</span>
						<span class="sidebar-group-count">{section.members.length}</span>
					</button>
					{#if !folded}
						{#each section.members as agent (agent.id)}
							{@render personaItem(agent)}
						{/each}
						{#if section.members.length === 0}
							<div class="sidebar-persona-empty">No personas in this project yet.</div>
						{/if}
					{/if}
				{/each}
				{#if groupedSidebar.sections.length > 0 && groupedSidebar.ungrouped.length > 0}
					{@const ungroupedFolded = collapsedGroups.includes('__ungrouped__') && !personaSearch.trim()}
					<button
						type="button"
						class="sidebar-group-head"
						aria-expanded={!ungroupedFolded}
						onclick={() => toggleGroupCollapsed('__ungrouped__')}
					>
						<svg
							aria-hidden="true"
							class="sidebar-group-chevron"
							class:folded={ungroupedFolded}
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg
						>
						<span class="sidebar-group-name">Ungrouped</span>
						<span class="sidebar-group-count">{groupedSidebar.ungrouped.length}</span>
					</button>
					{#if !ungroupedFolded}
						{#each groupedSidebar.ungrouped as agent (agent.id)}
							{@render personaItem(agent)}
						{/each}
					{/if}
				{:else}
					{#each groupedSidebar.ungrouped as agent (agent.id)}
						{@render personaItem(agent)}
					{/each}
				{/if}
				{#if filteredSidebarAgents.length === 0 && personaSearch.trim()}
					<div class="sidebar-persona-empty">No personas match "{personaSearch}"</div>
				{/if}
			{/if}
			</div>
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
					aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? item.label : undefined}
					aria-label={sidebarState.collapsed ? item.label : undefined}
				>
					<span class="sidebar-nav-icon">
						{#if item.icon === 'calendar'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line
									x1="16"
									y1="2"
									x2="16"
									y2="6"
								/><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg
							>
						{:else if item.icon === 'check'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M9 11l3 3L22 4" /><path
									d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
								/></svg
							>
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
			{#each staticSections.setup.filter((i) => i.href !== '/models') as item}
				<a
					href={item.href}
					class="sidebar-nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? item.label : undefined}
					aria-label={sidebarState.collapsed ? item.label : undefined}
				>
					<span class="sidebar-nav-icon">
						{#if item.icon === 'sliders'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line
									x1="12"
									y1="21"
									x2="12"
									y2="12"
								/><line x1="12" y1="8" x2="12" y2="3" /><line
									x1="20"
									y1="21"
									x2="20"
									y2="16"
								/><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line
									x1="9"
									y1="8"
									x2="15"
									y2="8"
								/><line x1="17" y1="16" x2="23" y2="16" /></svg
							>
						{:else if item.icon === 'bolt'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg
							>
						{:else if item.icon === 'code'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"><polyline points="16 18 22 12 16 6" /><polyline
									points="8 6 2 12 8 18"
								/></svg
							>
						{:else if item.icon === 'book'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path
									d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
								/></svg
							>
						{:else if item.icon === 'card'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg
							>
						{:else if item.icon === 'settings'}
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><circle cx="12" cy="12" r="3" /><path
									d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
								/></svg
							>
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
			{#if isWorkspaceAdmin}
				<a
					href="/admin"
					class="sidebar-nav-item admin-nav-item"
					class:active={isActive('/admin', $page.url.pathname)}
					aria-current={isActive('/admin', $page.url.pathname) ? 'page' : undefined}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? 'Admin Console' : undefined}
					aria-label={sidebarState.collapsed ? 'Admin Console' : undefined}
				>
					<span class="sidebar-nav-icon">
						<svg
							aria-hidden="true"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg
						>
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">Admin Console</span>
					{/if}
				</a>
			{/if}
			{#if isPlatformAdmin}
				<!-- Platform-level tooling lives under the console, not in the user's Setup group. -->
				<a
					href="/models"
					class="sidebar-nav-item admin-nav-item"
					class:active={isActive('/models', $page.url.pathname)}
					aria-current={isActive('/models', $page.url.pathname) ? 'page' : undefined}
					onclick={closeSidebar}
					title={sidebarState.collapsed ? 'Model Manager (platform)' : undefined}
					aria-label={sidebarState.collapsed ? 'Model Manager (platform)' : undefined}
				>
					<span class="sidebar-nav-icon">
						<svg
							aria-hidden="true"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg
						>
					</span>
					{#if !sidebarState.collapsed}
						<span class="sidebar-nav-label">Model Manager</span>
					{/if}
				</a>
			{/if}
			{#if !sidebarState.collapsed}
				<div class="sidebar-plan-badge">
					<span class="sidebar-plan-dot"></span>
					<span>{(data as any).badgeLabel ?? 'Personal account'}</span>
					{#if (data as any).credits}
						{@const wallet = (data as any).credits as {
							balance: number;
							billing_mode: string;
							paid_by: string | null;
							currency: string;
							formatted: string;
							usd: string;
						}}
						{@const unmetered = wallet.billing_mode === 'unmetered'}
						<a
							href="/billing"
							class="credit-pill"
							class:low={wallet.balance <= 0 && !unmetered}
							class:warn={wallet.balance > 0 && wallet.balance < 300 && !unmetered}
							title={unmetered
								? 'Complimentary account — generations are not charged'
								: `${wallet.usd} of generation credit${wallet.currency !== 'USD' ? ` (shown in ${wallet.currency})` : ''}${wallet.paid_by ? ` — the ${wallet.paid_by} wallet, which pays for everything you generate here` : ''}`}
						>
							<!-- A member spends from the workspace owner's wallet, so naming it
							     is not decoration: an unlabelled shared balance is how someone
							     concludes their own credits are being drained. -->
							<span class="credit-pill-label">{wallet.paid_by ?? 'Balance'}</span>
							<span class="credit-pill-amount">{unmetered ? '∞' : wallet.formatted}</span>
						</a>
					{/if}
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
						aria-hidden="true"
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
				<!-- Deliberately NOT a heading. This shell chrome renders above every page's
				     own <h1>, so as an <h2> it put a level-2 heading before the level-1 on
				     all six portal pages. .portal-header-title sets font/size/weight/colour
				     explicitly, so a <div> is pixel-identical. -->
				<div class="portal-header-title">
					{(() => {
						const path = $page.url.pathname;
						if (path.startsWith('/personas/')) {
							const agent = sidebarAgents.find((a: any) => path.startsWith(`/personas/${a.id}`));
							return agent ? agent.name : 'Persona';
						}
						// One name for this feature. The h1 and <title> say "Content Plan";
						// the topbar and the /brand-brief link said "Intel Wizard", so two
						// names for one thing were visible on screen simultaneously.
						if (path.startsWith('/brand-brief/intel')) return 'Content Plan';
						if (path.startsWith('/brand-brief')) return 'Brand Brief';
						if (path.startsWith('/settings')) return 'Settings';
						if (path.startsWith('/generator')) return 'New Persona';
						if (path.startsWith('/generations')) return 'All Generations';
						if (path.startsWith('/models')) return 'Model Manager';
						if (path.startsWith('/guides')) return 'Docs';
						if (path.startsWith('/developer')) return 'Developer API';
						if (path.startsWith('/admin')) return 'Admin Console';
						if (path.startsWith('/favorites')) return 'My Favorites';
						if (path.startsWith('/trash')) return 'Trash';
						if (path.startsWith('/review')) return 'Review Queue';
						if (path.startsWith('/calendar')) return 'Calendar';
						if (path.startsWith('/billing')) return 'Billing';
						if (path === '/dashboard' || path === '/') return 'Dashboard';
						// Never claim to be the dashboard. /billing fell through to this
						// line, so the money page's topbar read "Dashboard" while the
						// sidebar highlighted Billing and its h1 was a currency amount —
						// the page named itself nowhere. Any route added later would have
						// inherited the same lie; this derives a name from the path.
						return (path.split('/').filter(Boolean)[0] ?? 'PersonaGen')
							.replace(/-/g, ' ')
							.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
					})()}
				</div>
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
							aria-hidden="true"
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
							aria-hidden="true"
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
						bind:this={userMenuTrigger}
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
								<svg
									aria-hidden="true"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
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
		<main class="portal-content" id="main-content" tabindex="-1" bind:this={mainContentEl}>
			{#each pendingInvites as invite (invite.id)}
				<div class="invite-banner" role="alert">
					<div class="invite-banner-text">
						<strong>You've been invited</strong> to join
						<strong>{invite.workspaces?.name ?? 'a workspace'}</strong>
						as {invite.role}.
					</div>
					<div class="invite-banner-actions">
						<button
							type="button"
							class="invite-banner-btn accept"
							disabled={invitesBusy[invite.id]}
							onclick={() => respondToInvite(invite, true)}
						>
							{invitesBusy[invite.id] ? '…' : 'Accept'}
						</button>
						<button
							type="button"
							class="invite-banner-btn decline"
							disabled={invitesBusy[invite.id]}
							onclick={() => respondToInvite(invite, false)}
						>
							Decline
						</button>
					</div>
				</div>
			{/each}
			{@render children()}
		</main>
	</div>
</div>

{#if mustChangePassword}
	<div class="pw-gate" role="dialog" aria-modal="true" aria-labelledby="pw-gate-title">
		<form class="pw-gate-card" onsubmit={submitPasswordChange}>
			<h2 id="pw-gate-title">Set your password</h2>
			<p>
				You're on a shared starter password. Pick your own to continue — you'll use it for every
				login from here on.
			</p>
			<label class="pw-gate-field">
				New password
				<input
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
					bind:value={pwNew}
				/>
			</label>
			<label class="pw-gate-field">
				Confirm password
				<input
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
					bind:value={pwConfirm}
				/>
			</label>
			<button type="submit" class="pw-gate-btn" disabled={pwSaving || !pwNew || !pwConfirm}>
				{pwSaving ? 'Saving…' : 'Save password'}
			</button>
		</form>
	</div>
{/if}

<PersonaProjectsModal
	open={projectsModalOpen}
	onClose={() => (projectsModalOpen = false)}
	groups={personaGroups}
	personas={sidebarAgents}
/>

<!-- One confirmation dialog for the whole portal. Every destructive action
     routes through confirmAction() in $lib/stores/confirm. -->
<ConfirmDialog />

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
		min-height: 44px;
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
		box-shadow: 0 0 20px color-mix(in srgb, var(--accent) 30%, transparent);
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
		position: relative;
		transition:
			opacity 0.2s ease,
			background 0.2s ease,
			color 0.2s ease;
	}

	/* The chevron is deliberately a small 28px affordance; expand only the hit area
	   so it clears the 44px touch-target minimum without growing visually. */
	.sidebar-collapse-btn::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}

	.sidebar:hover .sidebar-collapse-btn {
		opacity: 1;
	}

	/* Touch devices have no hover, so the hover-reveal above never fires — on a
	   touch tablet (769–1024px, where the sidebar is still a fixed column) that
	   left the only collapse control invisible. Show it outright there. */
	@media (hover: none) {
		.sidebar-collapse-btn {
			opacity: 1;
		}
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
		box-shadow: 0 0 6px color-mix(in srgb, var(--success) 50%, transparent);
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

	/* The persona list gets its own bounded scroll so it cannot push Publish and
	   Setup out of the sidebar — see the note in the markup. It shrinks before
	   the fixed sections do, and never grows past a third of the rail. */
	.sidebar-personas {
		display: flex;
		flex-direction: column;
		gap: 2px;
		/* GROW into whatever the fixed sections leave, with a real floor.
		
		   This was `flex: 0 1 auto; min-height: 0`, which reads as "shrink me to
		   nothing before anything else gives" — and since Network, Library,
		   Publish and Setup do not shrink, the persona list absorbed the entire
		   overflow and collapsed to a single row with scroll arrows. That is worse
		   than the problem it was fixing: the point was to stop the persona list
		   burying Publish and Setup, not to crush it.
		
		   `flex: 1 1 auto` makes it the section that takes the slack, and the
		   min-height keeps roughly five personas visible on a laptop before it
		   starts scrolling inside itself. Publish and Setup still stay anchored
		   below it, because it can no longer grow past the space it is given. */
		flex: 1 1 auto;
		min-height: 11rem;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
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
		min-height: 44px;
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
		min-width: 44px;
	}

	.sidebar-nav-item:hover {
		/* was rgba(255,255,255,.04) — invisible on the light theme's pale surface */
		background: color-mix(in srgb, var(--text) 5%, transparent);
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
		/* Was `box-shadow: 0 0 0 2px var(--accent-mid)` with `outline: none`.
		   --accent-mid is `color-mix(… 22%, transparent)`, so the ring rendered at
		   22% alpha against the sidebar and measured as fully transparent: the
		   rule existed, matched, and drew nothing. A keyboard user could not see
		   where they were in the primary navigation of any screen in the product.
		   A focus indicator has to clear 3:1 against its own background, so this
		   uses the accent at full strength, inset so it is not clipped by the
		   sidebar edge and stays visible over the active-item background. */
		outline: 2px solid var(--accent);
		outline-offset: -2px;
		box-shadow: none;
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
		box-shadow: 0 0 6px color-mix(in srgb, var(--success) 50%, transparent);
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
		width: 44px;
		height: 44px;
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
		width: 44px;
		height: 44px;
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
		min-height: 44px;
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
		z-index: var(--z-nav);
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
		min-height: 44px;
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
		color: var(--error-text);
	}

	/* ── Content ── */
	.portal-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: var(--space-8);
	}

	/* Programmatic focus target for the skip link and post-navigation focus move —
	   it must not paint a ring for mouse users. */
	.portal-content:focus {
		outline: none;
	}

	.invite-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
		background: var(--accent-soft);
		border: 1px solid var(--border-hover);
		border-radius: 12px;
		padding: 0.9rem 1.2rem;
		margin-bottom: var(--space-6);
	}
	.invite-banner-text {
		color: var(--text);
		font-size: 0.94rem;
	}
	.invite-banner-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.invite-banner-btn {
		border: none;
		border-radius: 8px;
		padding: 0.45rem 1rem;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}
	.invite-banner-btn.accept {
		background: var(--accent);
		color: #fff;
	}
	.invite-banner-btn.accept:hover:not(:disabled) {
		background: var(--accent-dark);
	}
	.invite-banner-btn.decline {
		background: var(--surface);
		color: var(--text-muted);
		border: 1px solid var(--border);
	}
	.invite-banner-btn.decline:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.invite-banner-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	/* Admin console entry — visually distinct from the normal nav so it reads as
	   elevated access, not another page. */
	.admin-nav-item {
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		margin-bottom: 0.5rem;
		color: var(--accent-text);
	}
	.admin-nav-item:hover {
		border-color: var(--accent);
	}

	/* ── Forced first-login password change (blocks the whole portal) ── */
	.pw-gate {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--bg) 55%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	.pw-gate-card {
		width: min(400px, calc(100vw - 2rem));
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		padding: 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
	}
	.pw-gate-card h2 {
		font-size: 1.25rem;
		color: var(--text);
	}
	.pw-gate-card p {
		font-size: 0.9rem;
		color: var(--text-muted);
		line-height: 1.45;
	}
	.pw-gate-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.pw-gate-field input {
		padding: 0.55rem 0.7rem;
		font-size: 0.95rem;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		color: var(--text);
	}
	.pw-gate-field input:focus {
		border-color: var(--accent);
	}
	.pw-gate-btn {
		margin-top: 0.25rem;
		border: none;
		border-radius: 8px;
		padding: 0.65rem 1rem;
		font-size: 0.95rem;
		font-weight: 600;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
	}
	.pw-gate-btn:hover:not(:disabled) {
		background: var(--accent-dark);
	}
	.pw-gate-btn:disabled {
		opacity: 0.6;
		cursor: default;
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
			min-width: 44px;
			justify-content: center;
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
		overflow: hidden;
	}

	.sidebar-persona-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
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
		box-shadow: 0 0 4px color-mix(in srgb, var(--success) 60%, transparent);
	}

	.sidebar-persona-status.status-paused {
		background: var(--warning);
	}

	.sidebar-persona-search {
		position: relative;
		display: flex;
		align-items: center;
		margin: 2px 0 6px;
	}

	.sidebar-persona-search-icon {
		position: absolute;
		left: 9px;
		color: var(--text-dim);
		opacity: 0.6;
		pointer-events: none;
		flex-shrink: 0;
	}

	.sidebar-persona-search-input {
		width: 100%;
		padding: 6px 10px 6px 28px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		/* must stay >=16px — iOS Safari force-zooms the viewport on smaller inputs */
		font-size: 1rem;
		font-family: inherit;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}

	.sidebar-persona-search-input::placeholder {
		color: var(--text-dim);
	}

	.sidebar-persona-search-input:focus {
		border-color: var(--accent);
		background: var(--surface);
	}

	.sidebar-persona-search-input::-webkit-search-cancel-button {
		cursor: pointer;
	}

	.sidebar-persona-empty {
		padding: var(--space-2) 12px;
		font-size: 0.76rem;
		color: var(--text-dim);
		white-space: normal;
		line-height: 1.4;
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

	/* ── Section row with an action (Personas + manage projects) ── */
	.sidebar-section-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-right: 6px;
	}

	.sidebar-projects-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background 0.15s ease,
			border-color 0.15s ease;
	}

	/* 44px tap area without growing the 24px chip. */
	.sidebar-projects-btn::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		min-width: 44px;
		min-height: 44px;
	}

	.sidebar-projects-btn:hover {
		color: var(--accent);
		background: var(--accent-soft);
		border-color: color-mix(in srgb, var(--accent) 25%, transparent);
	}

	/* ── Project group headers in the personas rail ── */
	.sidebar-group-head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-height: 34px;
		padding: 4px 10px;
		margin-top: 2px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: var(--text-dim);
		font-family: inherit;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		text-align: left;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}

	.sidebar-group-head:not(.is-static):hover {
		color: var(--text);
		background: color-mix(in srgb, var(--text) 5%, transparent);
	}

	.sidebar-group-head.is-static {
		cursor: default;
	}

	.sidebar-group-chevron {
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}

	.sidebar-group-chevron.folded {
		transform: rotate(-90deg);
	}

	.sidebar-group-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.sidebar-group-count {
		margin-left: auto;
		font-size: 0.62rem;
		font-weight: 700;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	/* Wallet pill beside the account badge — "Credits $20.00" in the visitor's
	   currency (only when credits mode ≠ off). */
	.credit-pill {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.14);
		white-space: nowrap;
		text-decoration: none;
		color: inherit;
	}
	.credit-pill:hover {
		border-color: rgba(255, 255, 255, 0.3);
	}
	.credit-pill-label {
		color: var(--text-muted);
	}
	.credit-pill-amount {
		font-weight: 600;
		color: var(--success-text);
		font-variant-numeric: tabular-nums;
	}
	.credit-pill.low .credit-pill-amount {
		color: var(--error-text);
	}
	/* Under $3.00: amber, before the wall, the nudge to top up while a run still fits. */
	.credit-pill.warn .credit-pill-amount {
		color: var(--warning-text);
	}
</style>
