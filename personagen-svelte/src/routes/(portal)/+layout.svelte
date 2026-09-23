<script lang="ts">
	import { thumbUrl, restoreOriginal } from '$lib/image-url';
	import { page } from '$app/stores';
	import { goto, afterNavigate, beforeNavigate } from '$app/navigation';
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
	import { onMount, tick, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { primePricing } from '$lib/stores/pricing.svelte';
	import { invalidateAll } from '$app/navigation';
	import BrandWave from '$lib/components/shared/BrandWave.svelte';
	import PersonaProjectsModal from '$lib/components/shared/PersonaProjectsModal.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { dialog } from '$lib/actions/dialog';

	let { children, data } = $props();

	// Every screen that quotes a generation reads this — primed from the same
	// server data the wallet pill uses, so a quote and the wallet can't disagree.
	$effect.pre(() => {
		// In the browser the zone is the browser's, whatever the cookie said at
		// render time: a stale cookie otherwise kept every in-app navigation in
		// the old zone until a hard reload (round-5 re-audit).
		let browserZone: string | undefined;
		try {
			browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
		} catch {
			browserZone = undefined;
		}
		primePricing({ ...((data as any)?.pricing ?? {}), ...(browserZone ? { timeZone: browserZone } : {}) });
	});
	// …and on the SERVER, where effects never run. Primed only in the browser,
	// every price rendered before hydration was the provider's cost in USD: a
	// re-audit saw a text post at "$0.03" beside a ₱7,518.00 wallet for up to
	// four seconds, and a JS-off page kept it. The root layout resets the store
	// first on every server render, so this cannot leak between requests.
	if (!browser)
		primePricing(untrack(() => (data as { pricing?: Parameters<typeof primePricing>[0] })?.pricing));

	onMount(() => {
		initializeThemeAndColors();
		// (The viewer's `tz` cookie is written by the root layout, on every route.)
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
	let badgeText = $derived((data as { badgeLabel?: string }).badgeLabel ?? 'Personal account');
	/** The wallet for the collapsed rail's compact balance. */
	let walletMini = $derived(
		(
			data as {
				credits?: {
					balance: number;
					billing_mode: string;
					label: string | null;
					paid_by: string | null;
					formatted: string;
					compact: string;
				} | null;
			}
		).credits ?? null
	);
	/**
	 * Arrived from a password-recovery link (/api/auth/reset → callback →
	 * ?reset=1). The recovery email used to promise "you'll land on your profile,
	 * where you can set a new password" — and Profile had no password field, so
	 * a re-audit could not finish a reset at all. The same dialog that makes a
	 * provisioned account set its first password now finishes a reset.
	 */
	// A writable derived: it follows the URL, and clearRecoveryParam() sets it
	// false after history.replaceState — which the page store does not observe.
	let recoveryMode = $derived($page.url.searchParams.get('reset') === '1');
	let recoveryDismissed = $state(false);
	let showPasswordGate = $derived(mustChangePassword || (recoveryMode && !recoveryDismissed));
	// Focus, the Tab trap and Escape come from `use:dialog` on the gate itself.
	// It declared aria-modal without any of them: a re-audit tabbed out of the
	// dialog into the sidebar behind it on the third Tab.

	/** A recovery is optional; the provisioned-account gate is not. */
	async function dismissRecovery() {
		recoveryDismissed = true;
		clearRecoveryParam();
		// Focus lands where "change it later" points — the Password card when it
		// is on this page — never on <body> (round-2 re-audit).
		await tick();
		const card = document.getElementById('password');
		if (card) {
			if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
			card.focus();
		} else mainContentEl?.focus();
	}

	// Errors belong IN the dialog, next to the field: a mismatch used to surface
	// only as a corner toast behind the modal, and focus dropped to <body>.
	let pwError = $state('');
	let pwErrorField = $state<'new' | 'confirm' | null>(null);
	let pwNewEl = $state<HTMLInputElement | null>(null);
	let pwConfirmEl = $state<HTMLInputElement | null>(null);
	function pwFail(message: string, field: 'new' | 'confirm') {
		pwError = message;
		pwErrorField = field;
		(field === 'new' ? pwNewEl : pwConfirmEl)?.focus();
	}

	/** Drop ?reset=1 so a reload or a shared link does not reopen the dialog. */
	function clearRecoveryParam() {
		const url = new URL(window.location.href);
		if (!url.searchParams.has('reset')) return;
		url.searchParams.delete('reset');
		history.replaceState(history.state, '', url.pathname + url.search + url.hash);
		recoveryMode = false;
	}
	// Admin console entry — only rendered for workspace owners / admin seats.
	let isPlatformAdmin = $derived(Boolean((data as any).isPlatformAdmin));
	let isWorkspaceAdmin = $derived(Boolean((data as any).isWorkspaceAdmin) || isPlatformAdmin);
	let pwNew = $state('');
	let pwConfirm = $state('');
	let pwSaving = $state(false);

	async function submitPasswordChange(e: SubmitEvent) {
		e.preventDefault();
		pwError = '';
		pwErrorField = null;
		if (pwNew.length < 8) return pwFail('Use at least 8 characters.', 'new');
		if (pwNew !== pwConfirm) return pwFail('The two passwords do not match.', 'confirm');
		pwSaving = true;
		try {
			const res = await fetch('/api/settings/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPassword: pwNew, confirmPassword: pwConfirm })
			});
			const result = await res.json();
			if (!result.success) {
				pwFail(result.error || 'The password could not be changed. Try again.', 'new');
				return;
			}
			showToast(
				recoveryMode ? 'Password changed. Use it the next time you sign in.' : 'Password updated — welcome aboard',
				'success'
			);
			pwNew = '';
			pwConfirm = '';
			clearRecoveryParam();
			await invalidateAll();
		} catch {
			pwFail('Could not reach the server — check your connection and try again.', 'new');
		} finally {
			pwSaving = false;
		}
	}

	let userDropdownOpen = $state(false);
	let userMenuTrigger = $state<HTMLButtonElement | null>(null);

	// a11y: on SPA navigation the focus ring is otherwise stranded on the previous
	// page's link, so screen readers keep announcing the old context.
	let mainContentEl: HTMLElement | null = $state(null);

	/**
	 * The portal scrolls `.portal-content`, not the window — so SvelteKit's own
	 * scroll handling (top of page on navigate, restore on back) never touched
	 * it, and every route opened wherever the previous one had been scrolled to.
	 * A re-audit followed the setup checklist on a phone: "Add key" opened
	 * Settings 1,156px down, on the wrong card. Now: a new page starts at the
	 * top, a #hash lands on its target, and Back/Forward restore where you were.
	 */
	// Plain record, deliberately not reactive: nothing renders from it.
	const scrollMemory: Record<string, number> = {};
	beforeNavigate((nav) => {
		if (mainContentEl && nav.from) scrollMemory[nav.from.url.href] = mainContentEl.scrollTop;
	});

	afterNavigate((nav) => {
		const el = mainContentEl;
		if (el && nav.type !== 'enter') {
			const hash = nav.to?.url.hash ?? '';
			const target = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
			const remembered = nav.to ? scrollMemory[nav.to.url.href] : undefined;
			if (nav.type === 'popstate' && remembered !== undefined) {
				// After the page has laid out, or the restore lands short/long of
				// where the reader was (re-audit: 1468 restored for 964).
				// Tries again while the page fills in: WebKit at 320 laid out late and a
				// single assignment left the reader at the top (round-8 re-audit).
				// The reader may move before the page settles — a Tab, a wheel, a touch —
				// and a retry that fired after that yanked them back and left focus
				// off-screen (round-9 re-audit). Their first input ends the restore.
				let cancelled = false;
				const cancel = () => { cancelled = true; };
				for (const t of ['wheel', 'keydown', 'pointerdown', 'touchstart']) window.addEventListener(t, cancel, { capture: true, once: true, passive: true });
				setTimeout(() => { for (const t of ['wheel', 'keydown', 'pointerdown', 'touchstart']) window.removeEventListener(t, cancel, { capture: true }); }, 10000);
				const restore = () => {
					if (cancelled) return;
					if (el.scrollHeight - el.clientHeight >= remembered) el.scrollTop = remembered;
				};
				requestAnimationFrame(() => requestAnimationFrame(restore));
				// Up to 5s: WebKit at 320 grew the dashboard past the remembered offset
				// only after the KPI cards loaded (round-8 re-audit, still 0 at 1.8s).
				for (const ms of [120, 400, 900, 1800, 3000, 5000]) setTimeout(() => { if (Math.abs(el.scrollTop - remembered) > 2) restore(); }, ms);
				// And whenever the page grows (data-driven sections filling in): the
				// dashboard at 320 in WebKit could not hold the offset until then.
				if (typeof ResizeObserver !== 'undefined') {
					const ro = new ResizeObserver(() => {
						if (cancelled) { ro.disconnect(); return; }
						if (Math.abs(el.scrollTop - remembered) > 2) restore();
						if (Math.abs(el.scrollTop - remembered) <= 2) ro.disconnect();
					});
					for (const child of Array.from(el.children)) ro.observe(child);
					setTimeout(() => ro.disconnect(), 10000);
				}
			} else if (target) target.scrollIntoView({ block: 'start' });
			else if (hash.length > 1) {
				// A #hash with no element of that id is the PAGE's to resolve (e.g.
				// /guides#zernio-key opens that guide and scrolls to it). Resetting
				// here undid it: the guide opened 1,313px below the fold on phones.
			} else if (nav.from?.url.pathname !== nav.to?.url.pathname) el.scrollTop = 0;
		}
		if (nav.type === 'enter') return; // initial load — leave focus at document start
		// A same-page #hash move (the guides' Next/Previous) keeps the reader's
		// focus where it is; moving it to <main> overrode keepFocus (round-6).
		if (nav.from?.url.pathname === nav.to?.url.pathname && (nav.to?.url.hash ?? '').length > 1) return;
		mainContentEl?.focus({ preventScroll: true });
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

	let hamburgerBtn = $state<HTMLButtonElement | null>(null);
	let sidebarEl = $state<HTMLElement | null>(null);

	/**
	 * The hamburger opened the drawer and left focus on itself, BEHIND the
	 * overlay — a keyboard user had to tab through the whole page to reach the
	 * navigation that just appeared. Opening now moves focus to the first link
	 * in the drawer; closing (Escape, or the button again) returns it here.
	 */
	async function openDrawerFromButton() {
		const opening = !sidebarState.open;
		toggleSidebar();
		if (!opening) return;
		await tick();
		sidebarEl?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
	}

	/**
	 * The page behind the open drawer is `inert` (see portal-main), so the
	 * hamburger cannot take focus until that attribute is gone — hence the tick.
	 */
	async function closeDrawerToButton() {
		closeSidebar();
		await tick();
		hamburgerBtn?.focus();
	}

	/**
	 * The drawer is a modal surface only at phone widths. Keyed on the same
	 * 768px breakpoint as the CSS, so a drawer left open while the window
	 * widens can never leave the desktop page inert.
	 */
	let narrowViewport = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 768px)');
		const sync = () => (narrowViewport = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});
	let drawerModal = $derived(sidebarState.open && narrowViewport);

	/**
	 * "More below" cue for the rail. On a short laptop screen the rail scrolls,
	 * and nothing said so: a client audit judged Settings and Docs absent from
	 * the product because nothing above the fold showed more navigation existed.
	 */
	let navEl = $state<HTMLElement | null>(null);
	let navMoreBelow = $state(false);
	function measureNav() {
		const n = navEl;
		navMoreBelow = !!n && n.scrollTop + n.clientHeight < n.scrollHeight - 4;
	}
	$effect(() => {
		const n = navEl;
		if (!n) return;
		const ro = new ResizeObserver(measureNav);
		ro.observe(n);
		const mo = new MutationObserver(measureNav);
		mo.observe(n, { childList: true, subtree: true });
		n.addEventListener('scroll', measureNav, { passive: true });
		measureNav();
		return () => {
			ro.disconnect();
			mo.disconnect();
			n.removeEventListener('scroll', measureNav);
		};
	});

	function isAgentActive(agentId: string, pathname: string): boolean {
		return pathname.startsWith(`/personas/${agentId}`);
	}
</script>

<svelte:window
	onclick={closeUserDropdown}
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		if (userDropdownOpen) {
			closeUserDropdown();
			// Focus goes back to what opened it, not to the top of the document.
			userMenuTrigger?.focus();
			return;
		}
		// The mobile drawer is a modal surface over the page: Escape dismisses
		// it and hands focus back to the button that opened it (audit re-test N5).
		if (sidebarState.open) void closeDrawerToButton();
	}}
/>

<!-- While the password dialog is up, EVERYTHING behind it is inert — not just
     trapped by focus handling: a screen reader's virtual cursor walked the
     sidebar and page behind the modal (re-audit). -->
<a href="#main-content" class="skip-link" inert={showPasswordGate || drawerModal}>Skip to main content</a>

<div class="portal-layout" class:sidebar-collapsed={sidebarState.collapsed} inert={showPasswordGate}>
	<!-- Sidebar overlay (mobile) -->
	{#if sidebarState.open}
		<button class="sidebar-overlay" onclick={closeSidebar} aria-label="Close sidebar" tabindex="-1"
		></button>
	{/if}

	<!-- Sidebar -->
	<aside
		class="sidebar"
		id="portal-sidebar"
		class:open={sidebarState.open}
		aria-label="Sidebar"
		bind:this={sidebarEl}
	>
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
			<!-- Phone drawer only: a way out that is inside the drawer, since the
			     page behind it (hamburger included) is inert while it is open. -->
			<button
				type="button"
				class="sidebar-close-btn"
				onclick={closeDrawerToButton}
				aria-label="Close navigation"
			>
				<svg
					aria-hidden="true"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg
				>
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
		<nav class="sidebar-nav" aria-label="Main navigation" bind:this={navEl}>
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
			<!-- PERSONAS — deliberately LAST in the rail. A client audit (UX-006) found
			     the persona list pushing primary navigation out of view. Measured: the
			     non-persona items need ~630px, and a 1440x900 laptop gives the rail 575px,
			     so no amount of flex tuning lets both sit above the fold. With every
			     primary destination ABOVE the list, the list can no longer push any of
			     them away at any height; it takes the space that is left, and scrolls
			     inside itself. -->
			<div class="sidebar-personas" class:has-rows={sidebarAgents.length > 0}>
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
					<!-- New persona lives in this header row in the expanded rail: as its
					     own full-width row it cost 36px of the space the persona list needs
					     on a laptop screen. The collapsed icon rail keeps the full item. -->
					<a
						href="/generator"
						class="sidebar-projects-btn sidebar-new-btn"
						class:active={isActive('/generator', $page.url.pathname)}
						aria-current={isActive('/generator', $page.url.pathname) ? 'page' : undefined}
						onclick={closeSidebar}
						aria-label="New persona"
						title="New persona"
					>
						<svg
							aria-hidden="true"
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
						>
					</a>
				</div>
			{:else}
				<div class="sidebar-section-divider"></div>
			{/if}
			{#if !sidebarState.collapsed && sidebarAgents.length > 8}
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
			{#if sidebarState.collapsed}
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
			{/if}
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

			<!-- Only the ROWS scroll. The label, search and New Persona sit outside the
			     bounded area: when they were inside it, they filled the whole 11rem floor
			     and a client re-audit measured 0 of 6 personas visible at every height from
			     600 to 1200px. Not rendered at all for an account with no personas, so an
			     empty list reserves no space. -->
			{#if sidebarAgents.length > 0}
			<div class="sidebar-persona-rows" class:has-more={navMoreBelow && !sidebarState.collapsed}>
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
			{/if}
			</div>
		</nav>
		{#if navMoreBelow}
				<!-- Visual only: a keyboard or screen-reader user meets the rest of the
				     list by moving through it; this tells a sighted user it is there. -->
				<div class="sidebar-more-cue" aria-hidden="true">
					<span
						><svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg
						>More below — scroll</span
					>
				</div>
		{/if}

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
					<span class="sidebar-plan-label" title={badgeText}>{badgeText}</span>
					{#if (data as any).credits}
						{@const wallet = (data as any).credits as {
							balance: number;
							billing_mode: string;
							paid_by: string | null;
							label: string | null;
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
								: `${wallet.usd} of generation credit${wallet.currency !== 'USD' ? ` (shown in ${wallet.currency})` : ''}${wallet.paid_by ? ` — the ${wallet.paid_by} wallet, which pays for what your personas generate here` : ' — your wallet, which pays for everything you generate here'}`}
						>
							<!-- A member spends from the workspace owner's wallet, so naming it
							     is not decoration: an unlabelled shared balance is how someone
							     concludes their own credits are being drained. A solo account's pill
							     says "Your wallet" for the same reason: "Balance" names no wallet at
							     all (audit ENH-006). -->
							<span class="credit-pill-label">{wallet.label ?? wallet.paid_by ?? 'Your wallet'}</span>
							<span class="credit-pill-amount">{unmetered ? '∞' : wallet.formatted}</span>
						</a>
					{/if}
				</div>
			{:else if walletMini}
				<!-- The collapsed rail keeps a balance on screen: collapsing it used to
				     remove the wallet entirely while the Studio still said "the balance
				     in the sidebar" (round-2 re-audit). -->
				{@const wallet = walletMini}
				{@const unmetered = wallet.billing_mode === 'unmetered'}
				<a
					href={resolve('/(portal)/billing')}
					class="credit-mini"
					class:low={wallet.balance <= 0 && !unmetered}
					aria-label="{wallet.label ?? wallet.paid_by ?? 'Your wallet'}: {unmetered ? 'complimentary' : wallet.formatted}"
					title="{wallet.label ?? wallet.paid_by ?? 'Your wallet'}: {unmetered ? 'complimentary' : wallet.formatted}"
				>
					{unmetered ? '∞' : wallet.compact}
				</a>
			{/if}
		</div>
	</aside>

	<!-- Main area -->
	<div class="portal-main" inert={drawerModal}>
		<!-- Header -->
		<header class="portal-header">
			<div class="portal-header-left">
				<button
					class="hamburger-btn"
					bind:this={hamburgerBtn}
					onclick={openDrawerFromButton}
					aria-label="Navigation menu"
					aria-expanded={sidebarState.open}
					aria-controls="portal-sidebar"
				>
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

				<!-- Focus leaving the trigger-plus-panel, by Tab OR Shift+Tab, closes the
				     panel; the panel's own handler only saw focus leave forwards. -->
				<div
					class="portal-user-badge-container"
					onfocusout={(e) => {
						if (!userDropdownOpen) return;
						const next = e.relatedTarget as Node | null;
						if (next && !(e.currentTarget as HTMLElement).contains(next)) closeUserDropdown();
					}}
				>
					<button
						class="portal-user-badge"
						onclick={toggleUserDropdown}
						aria-expanded={userDropdownOpen}
						aria-controls="user-account-panel"
						aria-label="Account: {data.user?.email ?? 'signed in'}"
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
						<!-- A disclosure, not an ARIA menu. role="menu" promised arrow-key
						     navigation this never had, for a panel holding one address and
						     one button. It closes when focus leaves it, so it can no longer be
						     left open behind the page (re-audit N12). -->
						<div class="user-dropdown-menu glass-card" id="user-account-panel">
							<div class="user-dropdown-info">
								<span class="user-email">{data.user?.email ?? ''}</span>
							</div>
							<hr class="dropdown-divider" />
							<button class="dropdown-item logout-btn" onclick={handleLogout}>
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

{#if showPasswordGate}
	<!-- Escape closes a RECOVERY (the user's choice, same as "Not now"); the
	     provisioned starter-password gate has no exit, so it takes no onClose. -->
	<div
		class="pw-gate"
		role="dialog"
		aria-modal="true"
		aria-labelledby="pw-gate-title"
		aria-describedby="pw-gate-desc"
		tabindex="-1"
		use:dialog={{
			onClose: mustChangePassword ? undefined : dismissRecovery,
			initialFocus: 'input[type="password"]'
		}}
	>
		<form class="pw-gate-card" onsubmit={submitPasswordChange} novalidate>
			{#if mustChangePassword}
				<h2 id="pw-gate-title">Set your password</h2>
				<p id="pw-gate-desc">
					You're on a shared starter password. Pick your own to continue — you'll use it for every
					login from here on.
				</p>
			{:else}
				<h2 id="pw-gate-title">Choose a new password</h2>
				<p id="pw-gate-desc">
					Your reset link worked and you're signed in. Pick a new password — at least 8 characters —
					and use it the next time you sign in.
				</p>
			{/if}
			<label class="pw-gate-field">
				New password
				<input
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
					bind:this={pwNewEl}
					bind:value={pwNew}
					aria-invalid={pwErrorField === 'new' ? 'true' : undefined}
					aria-describedby={pwErrorField === 'new' ? 'pw-gate-error' : undefined}
				/>
			</label>
			<label class="pw-gate-field">
				Confirm password
				<input
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
					bind:this={pwConfirmEl}
					bind:value={pwConfirm}
					aria-invalid={pwErrorField === 'confirm' ? 'true' : undefined}
					aria-describedby={pwErrorField === 'confirm' ? 'pw-gate-error' : undefined}
				/>
			</label>
			{#if pwError}
				<p class="pw-gate-error" id="pw-gate-error" role="alert">{pwError}</p>
			{/if}
			<button type="submit" class="pw-gate-btn" disabled={pwSaving || !pwNew || !pwConfirm}>
				{pwSaving ? 'Saving…' : 'Save password'}
			</button>
			{#if !mustChangePassword}
				<!-- A recovery is the user's choice, so it has an exit; the provisioned
				     starter-password gate above deliberately does not. -->
				<button type="button" class="pw-gate-later" onclick={dismissRecovery}>
					Not now — change it later in Settings → Profile
				</button>
			{/if}
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

	.sidebar:hover .sidebar-collapse-btn,
	.sidebar:focus-within .sidebar-collapse-btn,
	.sidebar-collapse-btn:focus-visible {
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

	/* The persona list is LAST in the rail (see the markup), so it cannot push
	   any primary destination out of view. It takes whatever height the nav
	   above leaves and never reserves any of its own: the previous
	   `min-height: 11rem` sat on the whole block, so its label, search field and
	   New Persona link consumed the floor and a re-audit measured 0 of 6 persona
	   rows visible at every height from 600 to 1200px.

	   Only .sidebar-persona-rows scrolls. Its floor (about three rows) applies
	   only when there are personas to show — the rows element is not rendered
	   for an empty account. On a rail too short for the nav plus three rows the
	   whole .sidebar-nav scrolls, and what falls below the fold is then the tail
	   of the persona list, never a destination. */
	.sidebar-personas {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1 1 auto;
		/* Never 0: the platform role's block (Manage projects, New persona; no
		   rows) measured 0px tall at 1280x600 (round-8 re-audit). */
		min-height: 2.25rem;
		overflow: hidden;
	}
	/* A FLOOR, only when there are rows to show. With min-height 0 the block was
	   squeezed to 42px at 1440x900 and its rows spilled out underneath the
	   account footer (measured: rows box top 832px, footer top 811px). Nine rem
	   holds the header plus about three rows; below that the whole rail scrolls
	   rather than this block collapsing. A brand-new account has no rows, and the
	   floor on its empty block pushed Billing and Settings off a 1366x657 rail. */
	.sidebar-personas.has-rows {
		min-height: 9rem;
	}

	/* Zero layout height and sticky to the scrollport's bottom edge: it overlays
	   the last visible rows instead of adding a row of its own. */
	.sidebar-more-cue {
		position: sticky;
		bottom: 0;
		height: 0;
		flex: 0 0 0;
		pointer-events: none;
		z-index: 1;
	}
	.sidebar-more-cue span {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 34px;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 4px;
		padding-bottom: 3px;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-dim);
		background: linear-gradient(to bottom, transparent, var(--surface) 55%);
	}

	.sidebar-close-btn {
		display: none;
	}
	.sidebar-persona-rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1 1 auto;
		min-height: 0;
		/* Room under the last visible row for the sticky cue, so it never sits
		   on a persona's name (1366x657: the only visible row — round-4). */
		scroll-padding-bottom: 34px;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}

	/* A mouse does not need a 44px target the way a finger does. Tightening the
	   rail's items on fine pointers only (WCAG 2.5.8 asks for 24px; this keeps 36)
	   returns roughly 90px of height to the persona list on a laptop, and the
	   touch drawer keeps its full 44px targets. */
	@media (pointer: fine) and (min-width: 769px) {
		.sidebar-nav .sidebar-nav-item {
			min-height: 32px;
			padding-top: 5px;
			padding-bottom: 5px;
		}
		/* 33px per label x4 was 132px of the rail spent on four words. */
		.sidebar-nav .sidebar-section-label {
			padding-top: var(--space-2);
			padding-bottom: 2px;
		}
		.sidebar-nav .sidebar-group-head {
			min-height: 28px;
			padding-top: 3px;
			padding-bottom: 3px;
		}
	}
	/* On a laptop-height screen the non-persona rail alone measured 557 of the
	   599px available at 1440x900. Tightening the rail a step further on short
	   screens (30px targets — WCAG 2.5.8 asks for 24) leaves room for every
	   destination AND about three persona rows without scrolling. */
	@media (pointer: fine) and (min-width: 769px) and (max-height: 1000px) {
		.sidebar-nav .sidebar-nav-item {
			min-height: 30px;
			padding-top: 4px;
			padding-bottom: 4px;
		}
		.sidebar-nav .sidebar-section-label {
			padding-top: var(--space-2);
			padding-bottom: 2px;
		}
	}
	/* Laptop heights (1440x900 and below): the chrome above and below the nav
	   gives way before any destination does. The client badge repeats the
	   account name the header already shows (54px); the brand, padding and
	   footer tighten (about 50px more). */
	@media (min-width: 769px) and (max-height: 900px) {
		.sidebar {
			padding-top: var(--space-3);
			padding-bottom: var(--space-3);
		}
		.sidebar-brand {
			margin-bottom: var(--space-2);
			min-height: 36px;
		}
		.sidebar-logo-link {
			min-height: 36px;
		}
		.sidebar-logo {
			width: 32px;
			height: 32px;
		}
		.sidebar-client {
			display: none;
		}
		.sidebar-bottom {
			padding-top: var(--space-2);
		}
	}
	@media (pointer: fine) and (min-width: 769px) and (max-height: 900px) {
		.sidebar-bottom .sidebar-nav-item {
			min-height: 30px;
			padding-top: 4px;
			padding-bottom: 4px;
		}
	}
	/* Short screens (a 1366x768 laptop gives the page ~657px): 28px rows (WCAG
	   2.5.8 asks for 24) and slimmer group labels keep all eleven destinations
	   above the fold with room left for persona rows. */
	@media (pointer: fine) and (min-width: 769px) and (max-height: 800px) {
		.sidebar-nav .sidebar-nav-item,
		.sidebar-bottom .sidebar-nav-item {
			min-height: 28px;
			padding-top: 3px;
			padding-bottom: 3px;
		}
		.sidebar-nav .sidebar-section-label {
			padding-top: 5px;
			padding-bottom: 1px;
		}
		.sidebar-plan-badge {
			padding: 6px 10px;
		}
		/* At 768 tall an owner saw one persona row (re-audit). The group labels
		   become hairline dividers — their text stays in the accessibility tree
		   (font-size 0, not display:none) — returning ~70px to the persona list. */
		.sidebar-nav .sidebar-section-label {
			font-size: 0;
			padding: 0;
			margin: 5px 10px;
			height: 1px;
			background: var(--border);
		}
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
		color: var(--accent-text);
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
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-dim);
		letter-spacing: 0.04em;
	}

	.credit-mini {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 32px;
		margin-top: var(--space-2);
		padding: 4px 2px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--success-text);
		font-size: 0.66rem;
		font-weight: 700;
		text-decoration: none;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
	}
	.credit-mini.low {
		color: var(--error-text);
	}
	.credit-mini:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
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
		color: var(--accent-text);
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
		/* The CTA gradient is the one built for white text (7:1); accent→rose
		   carried the initial at 4.08 light / 2.65 dark (round-4 sweep). */
		background: var(--gradient-cta);
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
		background: var(--accent-dark);
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
	.pw-gate-later {
		margin-top: var(--space-2);
		padding: var(--space-2);
		border: none;
		background: none;
		color: var(--text-muted);
		font-size: var(--text-base);
		text-decoration: underline;
		cursor: pointer;
	}
	.pw-gate-error {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--error-text);
	}

	.pw-gate-btn {
		margin-top: 0.25rem;
		border: none;
		border-radius: 8px;
		padding: 0.65rem 1rem;
		font-size: 0.95rem;
		font-weight: 600;
		background: var(--accent-dark);
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

		/* Off-canvas is not hidden: translated off-screen, the closed drawer's
		   ~21 links stayed in the Tab order ahead of every page, focus landing
		   on nothing visible. visibility:hidden removes them from the Tab order
		   and the accessibility tree; the delay lets the slide-out finish first. */
		.sidebar:not(.open) {
			visibility: hidden;
			transition:
				transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
				visibility 0s linear 0.3s;
		}

		.sidebar-close-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 44px;
			height: 44px;
			margin-right: -8px;
			border: none;
			border-radius: 8px;
			background: transparent;
			color: var(--text-muted);
			cursor: pointer;
			flex-shrink: 0;
		}
		.sidebar-close-btn:hover {
			background: var(--surface-2);
			color: var(--text);
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
		color: var(--accent-text);
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
		color: var(--accent-text);
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
		/* Its own line under the role label, never beside it: side by side, the
		   label wrapped onto four lines and the pill still overflowed. */
		flex: 1 1 100%;
		min-width: 0;
		max-width: 100%;
		justify-content: space-between;
		margin-left: 0;
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
	/* The name truncates; the AMOUNT never does. A re-audit found the named pill
	   ("UX Audit Co ₱7,518.00") running 10–17px past its card at every width, the
	   amount clipped to "₱7,518." — the one part of the pill that matters. */
	.sidebar-plan-label {
		flex: 1 1 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.credit-pill-label {
		color: var(--text-muted);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.credit-pill-amount {
		font-weight: 600;
		color: var(--success-text);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	.credit-pill.low .credit-pill-amount {
		color: var(--error-text);
	}
	/* Under $3.00: amber, before the wall, the nudge to top up while a run still fits. */
	.credit-pill.warn .credit-pill-amount {
		color: var(--warning-text);
	}
	.sidebar-persona-rows.has-more::after {
		content: '';
		flex: 0 0 30px;
	}
	/* The cue sits BELOW the scrolling nav, in its own 22px: never over a row
	   (round-6 re-audit) and never below the fold (round-7 re-audit, when it
	   sat at the end of the scrolled content). */
	.sidebar-more-cue {
		position: static;
		height: 22px;
		flex: 0 0 22px;
		margin-top: -2px;
	}
	.sidebar-more-cue span {
		position: static;
		height: 22px;
		align-items: center;
		background: none;
	}
	.sidebar-persona-rows.has-more::after {
		display: none;
	}
	/* Collapsed rail: the cue stays (a collapsed nav can still have more
	   below); only its chevron shows. */
	.sidebar-collapsed .sidebar-more-cue span {
		font-size: 0;
		gap: 0;
	}
</style>
