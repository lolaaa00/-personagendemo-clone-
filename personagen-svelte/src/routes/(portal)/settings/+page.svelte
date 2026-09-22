<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		showToast,
		applyBrandTheme,
		clearBrandTheme,
		brandThemeState,
		brandColorsState,
		triggerBrandTransform,
		DEFAULT_BRAND_PRIMARY,
		DEFAULT_BRAND_SECONDARY
	} from '$lib/stores/ui.svelte';
	import { BrandBrief } from '$lib/services/api';
	import { onMount, untrack } from 'svelte';
	import { dialog } from '$lib/actions/dialog';
	import { syncParam, readParam } from '$lib/url-state';
	import { confirmAction } from '$lib/stores/confirm.svelte';
	import PageShell from '$lib/components/ui/PageShell.svelte';
	import {
		NON_BYOK_PROVIDERS,
		byokReason,
		isByokGated,
		providerByKeyProvider,
		type UserKeyProvider
	} from '$lib/providers';

	let { data } = $props<{
		data: {
			user?: { email?: string } | null;
			profile?: {
				displayName: string;
				preferences: {
					emailAlerts: boolean | null;
					pushNotifications: boolean | null;
					weeklyReports: boolean | null;
					brandThemeBriefId: string | null;
				};
			};
			// From the portal layout load (merged into every page's data). Optional
			// on purpose: a layout that could not resolve a plan must restrict
			// nothing, so every gate below reads `=== false`, never `!`.
			entitlements?: { plan?: string; teams?: boolean; byok?: boolean };
		};
	}>();

	// ── Sub-nav ─────────────────────────────────────────────────────────────
	// Seven always-open cards meant scrolling ~1,800px of unrelated settings to
	// reach the Danger Zone. One section is shown at a time, chosen from a rail,
	// and the choice round-trips through `?section=` so a link or a refresh lands
	// where you were.
	const SECTIONS = [
		{
			key: 'profile',
			label: 'Profile',
			icon: 'M20 21a8 8 0 10-16 0M12 12a4 4 0 100-8 4 4 0 000 8'
		},
		{
			key: 'notifications',
			label: 'Notifications',
			icon: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0'
		},
		{
			key: 'theme',
			label: 'Brand Theme',
			icon: 'M12 2a10 10 0 000 20c1.1 0 2-.9 2-2 0-1.4-1-1.8-1-3 0-.8.7-1.5 1.5-1.5H17a5 5 0 005-5c0-4.9-4.5-8.5-10-8.5z'
		},
		{
			key: 'api-keys',
			label: 'Provider API Keys',
			icon: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'
		},
		{
			key: 'zernio-keys',
			label: 'Zernio Keys',
			icon: 'M5 11h14v10H5zM7 11V7a5 5 0 0110 0v4'
		},
		{
			key: 'team',
			label: 'Team',
			icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'
		},
		{ key: 'billing', label: 'Billing & Plan', icon: 'M2 5h20v14H2zM2 10h20' },
		{
			key: 'danger',
			label: 'Danger Zone',
			icon: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01'
		}
	] as const;

	type SectionKey = (typeof SECTIONS)[number]['key'];
	const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];

	/**
	 * `/settings#zernio-keys` is linked from the persona Connections slot meter.
	 * That anchor used to scroll to an always-rendered card; now it has to pick
	 * the section instead, or the link lands on Profile with nothing to see.
	 */
	function initialSection(): SectionKey {
		if (typeof window !== 'undefined') {
			const hash = window.location.hash.replace('#', '') as SectionKey;
			if (SECTION_KEYS.includes(hash)) return hash;
		}
		return readParam('section', SECTION_KEYS, 'profile');
	}

	let activeSection = $state<SectionKey>(initialSection());
	$effect(() => syncParam('section', activeSection, 'profile'));

	/**
	 * Following `#zernio-keys` while already on /settings is a same-document
	 * navigation — nothing remounts, so `initialSection()` never runs again.
	 * Consume the hash here too, then strip it so it can't fight `?section=`
	 * on a later reload.
	 */
	function consumeHash() {
		const hash = window.location.hash.replace('#', '') as SectionKey;
		if (!SECTION_KEYS.includes(hash)) return;
		activeSection = hash;
		const url = new URL(window.location.href);
		url.hash = '';
		window.history.replaceState({}, '', url.pathname + url.search);
	}

	// Profile — email comes from auth session; name + notification preferences
	// are persisted in Supabase user metadata (localStorage is only a cache).
	//
	// The editable fields below are SEEDED ONCE from `data` on purpose: after a
	// save, the handlers write the server's answer straight into this state and
	// nothing calls invalidateAll(), so `data` never changes while the page is
	// mounted. `untrack` states that intent explicitly (and clears the
	// state_referenced_locally warning) instead of leaving a reader to wonder
	// whether a later `data` update is silently ignored. If a save ever starts
	// invalidating, re-seed these in an $effect keyed on `data.profile`.
	let profileEmail = $derived(data.user?.email ?? '');
	let profileName = $state(
		untrack(() => data.profile?.displayName || data.user?.email?.split('@')[0] || 'Account')
	);
	let profileSaving = $state(false);

	// Notifications
	let emailAlerts = $state(untrack(() => data.profile?.preferences?.emailAlerts ?? true));
	let pushNotifications = $state(
		untrack(() => data.profile?.preferences?.pushNotifications ?? false)
	);
	let weeklyReports = $state(untrack(() => data.profile?.preferences?.weeklyReports ?? true));

	// ── Brand Theme: which brand brief's colors dress the app ────────────────
	// Opt-in and reversible. The Brand Brief editor no longer hijacks the
	// palette while you type, so this select is the ONLY place the app takes
	// on a brand's colors.
	let brandBriefs = $state<Array<{ id: string; name: string; updated_at: string }>>([]);
	let brandThemeChoice = $state<string>(
		untrack(() => data.profile?.preferences?.brandThemeBriefId ?? brandThemeState.briefId ?? '')
	);
	let brandThemeBusy = $state(false);

	async function loadBrandBriefs() {
		try {
			const res = await BrandBrief.list();
			if (res.success && Array.isArray(res.data)) brandBriefs = res.data;
			// A brief chosen on another device (or since deleted) — resolve it
			// against the real list so the select never shows a phantom entry.
			if (brandThemeChoice && !brandBriefs.some((b) => b.id === brandThemeChoice)) {
				brandThemeChoice = '';
				if (brandThemeState.briefId) clearBrandTheme();
			} else if (brandThemeChoice && brandThemeState.briefId !== brandThemeChoice) {
				await applyBriefTheme(brandThemeChoice, null, false);
			}
		} catch {
			/* the picker degrades to "PersonaGen default" only */
		}
	}

	/** Loads a brief's colors and dresses the app in them. */
	async function applyBriefTheme(briefId: string, event: MouseEvent | null, celebrate: boolean) {
		const res = await BrandBrief.getById(briefId);
		if (!res.success || !res.data) {
			showToast(res.error || 'Could not load that brand brief', 'error');
			return false;
		}
		const name = (res as any).name || brandBriefs.find((b) => b.id === briefId)?.name || 'Brand';
		const primary = res.data.primaryColor || DEFAULT_BRAND_PRIMARY;
		const secondary = res.data.secondaryColor || DEFAULT_BRAND_SECONDARY;
		applyBrandTheme(briefId, name, primary, secondary);
		if (celebrate) {
			// The sparkle burst that used to fire unbidden on every brief save —
			// now it only plays when someone deliberately picks a theme.
			const x = event ? event.clientX : window.innerWidth / 2;
			const y = event ? event.clientY : window.innerHeight / 2;
			triggerBrandTransform(x, y, primary, secondary);
		}
		return true;
	}

	async function changeBrandTheme(briefId: string, event: MouseEvent | null) {
		if (brandThemeBusy) return;
		brandThemeBusy = true;
		const previous = brandThemeChoice;
		brandThemeChoice = briefId;
		try {
			if (briefId) {
				const ok = await applyBriefTheme(briefId, event, true);
				if (!ok) {
					brandThemeChoice = previous;
					return;
				}
			} else {
				clearBrandTheme();
			}
			const res = await fetch('/api/settings/profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ preferences: { brandThemeBriefId: briefId || null } })
			});
			const result = await res.json();
			if (!res.ok || !result.success) {
				showToast(result.error || 'Theme applied locally — could not sync to your account', 'warning');
				return;
			}
			showToast(
				briefId
					? `App theme now follows "${brandThemeState.name}"`
					: 'Back to the default PersonaGen theme',
				'success'
			);
		} catch (err) {
			showToast((err as Error).message || 'Failed to update brand theme', 'error');
		} finally {
			brandThemeBusy = false;
		}
	}

	interface ApiKeyMetadata {
		provider: ApiKeyProvider;
		masked_value: string;
		status: 'untested' | 'valid' | 'invalid' | 'error';
		last_error: string | null;
		last_tested_at: string | null;
		updated_at: string | null;
	}

	// The `user_api_keys.provider` values, from the provider catalogue — the same
	// union the server gate reads, so a provider added there cannot be forgotten
	// here (or here and not there).
	type ApiKeyProvider = UserKeyProvider;

	// Keys are grouped by what they're FOR, not by vendor — someone setting the
	// account up thinks "who publishes my posts / who makes my media / who
	// writes the words", not "which SaaS is this".
	type KeyCategory = 'publishing' | 'media' | 'language' | 'research';
	const KEY_CATEGORIES: Array<{ key: KeyCategory; title: string; blurb: string }> = [
		{
			key: 'publishing',
			title: 'Publishing & Distribution',
			blurb: 'Pushes finished posts to the social platforms and reads back analytics.'
		},
		{
			key: 'media',
			title: 'Media Generation',
			blurb: 'Creates the images, video and voiceover your personas post.'
		},
		{
			key: 'language',
			title: 'Language, Reasoning & Routing',
			blurb: 'Writes captions and persona dialogue — and routes media jobs on failover.'
		},
		{
			key: 'research',
			title: 'Research & Scraping',
			blurb: 'Pulls brand and competitor detail in from the live web.'
		}
	];

	// `mark` + `tint` render a monogram identity badge per provider. Deliberately
	// NOT the vendors' real logos: those are trademarked assets we'd have to
	// ship and keep current, and hand-drawing them from memory produces subtly
	// wrong marks. A tinted monogram reads as identity, stays on-brand with the
	// app, and can't be wrong.
	const providerConfigs: Array<{
		provider: ApiKeyProvider;
		label: string;
		description: string;
		optional?: boolean;
		placeholder: string;
		category: KeyCategory;
		mark: string;
		tint: string;
		/** Every place in the platform this key is actually spent — audited from
		 *  the call sites, not from the vendor's marketing. */
		touchpoints: string[];
		/** Set when the provider's real reach crosses its filed category. */
		spans?: string;
		/** Set when nothing in the codebase calls this provider yet. */
		unused?: boolean;
	}> = [
		{
			provider: 'zernio',
			label: 'Zernio',
			description: 'Publishing, connections, and analytics for all 13 platforms. Billed per connected account (2 free).',
			placeholder: 'Paste your Zernio API key',
			category: 'publishing',
			mark: 'Z',
			tint: '#7c3aed',
			touchpoints: [
				'Publishing a post to any connected platform',
				'Scheduled auto-publishing (the scheduler worker)',
				'Connecting / disconnecting social accounts',
				'Reading post analytics back into the dashboard',
				'Per-persona key assignment (Zernio Key Manager)'
			]
		},
		{
			provider: 'fal_ai',
			label: 'Fal AI',
			description: 'The primary media engine — images, video and voiceover for UGC posts.',
			placeholder: 'Paste your Fal AI API key',
			category: 'media',
			mark: 'F',
			tint: '#d946ef',
			touchpoints: [
				'UGC image generation (posts, typographic cards)',
				'Video generation — spokesperson, b-roll and cinematic',
				'Voiceover / text-to-speech on spoken formats',
				'Persona avatar hero shot',
				'Reference-kit stages (full body, angles, close-up)'
			]
		},
		{
			provider: 'openrouter',
			label: 'OpenRouter',
			description: 'Model routing for text — and a full media failover path for images and video.',
			placeholder: 'Paste your OpenRouter API key',
			category: 'language',
			mark: 'OR',
			tint: '#6366f1',
			spans: 'also generates media',
			touchpoints: [
				'Captions, hooks and the Director’s visual prompts',
				'Persona generation and chat',
				'Brand-brief analysis (Intel engine)',
				'Image generation — on failover, or when pinned as provider',
				'Video generation — b-roll failover path'
			]
		},
		{
			provider: 'gemini',
			label: 'Gemini',
			description: 'Google Gemini for text and image understanding — the fallback when no OpenRouter key is set.',
			optional: true,
			placeholder: 'Paste your Gemini API key',
			category: 'language',
			mark: 'G',
			tint: '#4285f4',
			touchpoints: [
				'Captions and persona text (used when OpenRouter is unset)',
				'Vision — reading reference images the model is shown',
				'Brand-brief analysis (Intel engine)'
			]
		},
		{
			provider: 'firecrawl',
			label: 'Firecrawl',
			description: 'Storefront scraping and JS-rendered page extraction for brand briefs.',
			placeholder: 'Paste your Firecrawl API key',
			category: 'research',
			mark: 'FC',
			tint: '#f97316',
			touchpoints: [
				'Scrape & Populate on the Brand Brief page',
				'Competitor and storefront extraction (Intel engine)'
			]
		},
		{
			provider: 'kie_ai',
			label: 'Kie AI',
			description: 'Saved and credential-checked, but no generation path calls it yet — setting it changes nothing today.',
			optional: true,
			placeholder: 'Paste your Kie AI API key',
			category: 'media',
			mark: 'K',
			tint: '#0ea5e9',
			unused: true,
			touchpoints: []
		}
	];

	let apiKeys = $state<ApiKeyMetadata[]>([]);
	let apiKeyInputs = $state<Record<ApiKeyProvider, string>>({
		zernio: '',
		gemini: '',
		openrouter: '',
		firecrawl: '',
		kie_ai: '',
		fal_ai: ''
	});
	let apiKeysLoading = $state(false);
	let apiKeySaving = $state<Record<string, boolean>>({});
	let apiKeyTesting = $state<Record<string, boolean>>({});
	let apiKeyDeleting = $state<Record<string, boolean>>({});

	// ── Zernio Key Manager — extra Zernio accounts, assignable per persona ──
	// Each managed key is a whole separate Zernio account (its own email login,
	// its own 2 free connected-account slots, its own bill). Personas without an
	// assignment use the default Zernio key from the Provider API Keys section.
	interface ZernioManagedKey {
		id: string;
		label: string;
		masked_value: string;
		status: 'untested' | 'valid' | 'invalid' | 'error';
		last_error: string | null;
		last_tested_at: string | null;
		updated_at: string | null;
	}
	interface ZernioAgentLite {
		id: string;
		name: string;
		handle?: string | null;
		zernio_key_id: string | null;
	}

	let zernioKeys = $state<ZernioManagedKey[]>([]);
	let zernioAgents = $state<ZernioAgentLite[]>([]);
	let zernioKeysLoading = $state(false);
	let zernioKeyLabel = $state('');
	let zernioKeyValue = $state('');
	let zernioKeySaving = $state(false);
	let zernioKeyBusy = $state<Record<string, boolean>>({});
	let zernioAssigning = $state<Record<string, boolean>>({});

	async function loadZernioKeys() {
		zernioKeysLoading = true;
		try {
			const res = await fetch('/api/settings/zernio-keys');
			const data = await res.json();
			if (data.success) {
				zernioKeys = data.keys || [];
				zernioAgents = data.agents || [];
			} else {
				showToast(data.error || 'Unable to load Zernio keys', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Unable to load Zernio keys', 'error');
		} finally {
			zernioKeysLoading = false;
		}
	}

	async function saveZernioKey() {
		const label = zernioKeyLabel.trim();
		const apiKey = zernioKeyValue.trim();
		if (!label) {
			showToast('Give the key a label first (e.g. the Zernio account email)', 'warning');
			return;
		}
		if (apiKey.length < 8) {
			showToast('Enter a valid Zernio API key first', 'warning');
			return;
		}
		zernioKeySaving = true;
		try {
			const res = await fetch('/api/settings/zernio-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'save', label, apiKey })
			});
			const data = await res.json();
			if (data.success) {
				zernioKeys = [...zernioKeys.filter((k) => k.id !== data.key.id), data.key].sort((a, b) =>
					a.label.localeCompare(b.label)
				);
				zernioKeyLabel = '';
				zernioKeyValue = '';
				showToast('Zernio key saved securely', 'success');
			} else {
				showToast(data.error || 'Failed to save Zernio key', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Failed to save Zernio key', 'error');
		} finally {
			zernioKeySaving = false;
		}
	}

	async function testZernioKey(id: string) {
		zernioKeyBusy = { ...zernioKeyBusy, [id]: true };
		try {
			const res = await fetch('/api/settings/zernio-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'test', id })
			});
			const data = await res.json();
			if (data.key) {
				zernioKeys = zernioKeys.map((k) => (k.id === id ? data.key : k));
			}
			if (data.success) {
				const m = data.meter;
				showToast(
					m
						? `Key verified — ${m.total} connected account${m.total === 1 ? '' : 's'}, ${m.freeRemaining} free slot${m.freeRemaining === 1 ? '' : 's'} left on this key`
						: 'Key verified',
					'success'
				);
			} else {
				showToast(data.error || 'Zernio key test failed', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Zernio key test failed', 'error');
		} finally {
			zernioKeyBusy = { ...zernioKeyBusy, [id]: false };
		}
	}

	async function deleteZernioKey(id: string) {
		const assignedCount = zernioAgents.filter((a) => a.zernio_key_id === id).length;
		const ok = await confirmAction({
			title: 'Delete this Zernio key?',
			body: assignedCount
				? `${assignedCount} persona${assignedCount === 1 ? '' : 's'} using it revert to the default Zernio key.`
				: 'No personas are using it right now.',
			warning: assignedCount
				? 'Their connected social accounts live under this key and will need reconnecting.'
				: undefined,
			preview: zernioAgents
				.filter((a) => a.zernio_key_id === id)
				.slice(0, 4)
				.map((a) => ({ label: a.name, meta: 'Reverts to the default key' })),
			confirmLabel: 'Delete key',
			tone: assignedCount ? 'danger' : 'caution'
		});
		if (!ok) return;

		zernioKeyBusy = { ...zernioKeyBusy, [id]: true };
		try {
			const res = await fetch('/api/settings/zernio-keys', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			const data = await res.json();
			if (data.success) {
				zernioKeys = zernioKeys.filter((k) => k.id !== id);
				zernioAgents = zernioAgents.map((a) =>
					a.zernio_key_id === id ? { ...a, zernio_key_id: null } : a
				);
				showToast('Zernio key deleted', 'info');
			} else {
				showToast(data.error || 'Failed to delete Zernio key', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Failed to delete Zernio key', 'error');
		} finally {
			zernioKeyBusy = { ...zernioKeyBusy, [id]: false };
		}
	}

	async function assignZernioKey(agent: ZernioAgentLite, select: HTMLSelectElement) {
		const newKeyId = select.value || null;
		if ((agent.zernio_key_id || null) === newKeyId) return;
		// Key = Zernio account, so switching means the persona's connected socials
		// live elsewhere now — make the reconnect cost explicit before committing.
		// The <select> DOM value was changed by the user, not Svelte, so on cancel
		// or failure it must be snapped back to the real assignment by hand.
		const revert = () => (select.value = agent.zernio_key_id || '');
		const targetLabel = newKeyId
			? `key "${zernioKeys.find((k) => k.id === newKeyId)?.label || 'selected'}"`
			: 'the default Zernio key';
		const ok = await confirmAction({
			title: `Move ${agent.name} to ${targetLabel}?`,
			body: 'A Zernio key IS the account, so the persona moves to a different one.',
			warning: 'Its connected social accounts must be reconnected under that key.',
			confirmLabel: 'Move persona',
			tone: 'danger'
		});
		if (!ok) {
			revert();
			return;
		}

		zernioAssigning = { ...zernioAssigning, [agent.id]: true };
		try {
			const res = await fetch('/api/settings/zernio-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'assign', agent_id: agent.id, key_id: newKeyId })
			});
			const data = await res.json();
			if (data.success) {
				zernioAgents = zernioAgents.map((a) =>
					a.id === agent.id ? { ...a, zernio_key_id: newKeyId } : a
				);
				showToast(
					`${agent.name} reassigned — reconnect its platforms on the persona's Connections tab`,
					'success'
				);
			} else {
				revert();
				showToast(data.error || 'Failed to reassign persona', 'error');
			}
		} catch (err) {
			revert();
			showToast((err as Error).message || 'Failed to reassign persona', 'error');
		} finally {
			zernioAssigning = { ...zernioAssigning, [agent.id]: false };
		}
	}

	// Danger
	let showDeleteModal = $state(false);
	let deleteConfirmText = $state('');
	let deleteInProgress = $state(false);

	// ── Team (workspaces & seats) ────────────────────────────────────────────
	interface WorkspaceLite {
		id: string;
		name: string;
		owner_id: string;
	}
	type SeatRole = 'admin' | 'manager' | 'creator' | 'viewer';
	interface MembershipLite {
		workspace_id: string;
		role: SeatRole;
		workspaces?: { id: string; name: string; owner_id: string };
	}
	interface PendingInviteLite {
		id: string;
		email: string;
		workspace_id: string;
		role: SeatRole;
		status: string;
		expires_at: string;
		workspaces?: { name: string };
	}
	interface MemberLite {
		user_id: string;
		role: SeatRole;
		email: string | null;
		spend_limit_usd?: number | null;
	}
	interface PersonaLite {
		id: string;
		name: string;
		handle?: string | null;
		group_id?: string | null;
		persona_groups?: { name: string } | null;
	}

	let ownedWorkspaces = $state<WorkspaceLite[]>([]);
	let memberships = $state<MembershipLite[]>([]);
	let teamLoading = $state(false);
	let newWorkspaceName = $state('');
	let creatingWorkspace = $state(false);

	// POST /api/workspaces refuses with 403 PLAN_FEATURE when the plan has no
	// teams line, so mirror that ONE door: CREATING a shared workspace. Every
	// other team control (invite, re-role, remove, filing personas) hits
	// per-workspace routes the server leaves open, because existing workspaces
	// must keep working for everyone already in them.
	let createWorkspaceBlockedReason = $derived(
		data.entitlements?.teams === false
			? `Shared workspaces are not included in the ${data.entitlements?.plan ?? 'free'} plan. See Billing to compare plans.`
			: null
	);

	// Per-workspace detail, keyed by workspace id — loaded lazily once a
	// workspace exists, since a fresh account usually has exactly one.
	let workspaceMembers = $state<Record<string, MemberLite[]>>({});
	let workspaceInvites = $state<Record<string, PendingInviteLite[]>>({});
	let workspacePersonas = $state<Record<string, { inWorkspace: PersonaLite[]; available: PersonaLite[] }>>({});
	let inviteEmail = $state<Record<string, string>>({});
	let inviteRole = $state<Record<string, SeatRole>>({});
	let lastInviteLink = $state<Record<string, string>>({});
	let teamBusy = $state<Record<string, boolean>>({});
	// Persona-sharing picker: which brand is selected (per workspace) and
	// which available personas are checked, keyed "workspaceId:agentId".
	let brandFilter = $state<Record<string, string>>({});
	let selectedPersonas = $state<Record<string, boolean>>({});
	// Admin-tier memberships get the full management card (see workspaceManagerCard
	// below) instead of the plain "you joined this, here's Leave" row.
	let nonAdminMemberships = $derived(memberships.filter((m) => m.role !== 'admin'));

	async function loadTeam() {
		teamLoading = true;
		try {
			const res = await fetch('/api/workspaces');
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Unable to load team info');
			ownedWorkspaces = data.owned || [];
			memberships = data.memberships || [];
			// An admin-tier seat can manage the workspace (invite/re-role/remove
			// other members, file its own personas in) exactly like the owner can
			// — see workspace_admin_role_migration.sql — so it needs the same
			// detail loaded, not just the plain "you joined this" membership view.
			for (const ws of ownedWorkspaces) {
				await loadWorkspaceDetail(ws.id);
			}
			for (const m of memberships) {
				if (m.role === 'admin') await loadWorkspaceDetail(m.workspace_id);
			}
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamLoading = false;
		}
	}

	async function loadWorkspaceDetail(workspaceId: string) {
		const [membersRes, invitesRes, personasRes] = await Promise.all([
			fetch(`/api/workspaces/${workspaceId}/members`).then((r) => r.json()),
			fetch(`/api/workspaces/${workspaceId}/invites`).then((r) => r.json()),
			fetch(`/api/workspaces/${workspaceId}/personas`).then((r) => r.json())
		]);
		if (membersRes.success) workspaceMembers = { ...workspaceMembers, [workspaceId]: membersRes.members };
		if (invitesRes.success)
			workspaceInvites = {
				...workspaceInvites,
				[workspaceId]: (invitesRes.invites || []).filter((i: any) => i.status === 'pending')
			};
		if (personasRes.success)
			workspacePersonas = {
				...workspacePersonas,
				[workspaceId]: { inWorkspace: personasRes.inWorkspace, available: personasRes.available }
			};
	}

	async function createWorkspace() {
		const name = newWorkspaceName.trim();
		if (!name) {
			showToast('Give the workspace a name first', 'warning');
			return;
		}
		creatingWorkspace = true;
		try {
			const res = await fetch('/api/workspaces', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to create workspace');
			showToast(`Created ${data.workspace.name}`, 'success');
			newWorkspaceName = '';
			await loadTeam();
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			creatingWorkspace = false;
		}
	}

	async function sendInvite(workspaceId: string) {
		const email = (inviteEmail[workspaceId] || '').trim();
		const role = inviteRole[workspaceId] || 'creator';
		if (!email) {
			showToast('Enter an email to invite', 'warning');
			return;
		}
		teamBusy = { ...teamBusy, [`invite-${workspaceId}`]: true };
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to send invite');
			lastInviteLink = { ...lastInviteLink, [workspaceId]: `${location.origin}${data.acceptUrl}` };
			inviteEmail = { ...inviteEmail, [workspaceId]: '' };
			showToast(`Invite created for ${email} — copy the link below and send it to them`, 'success');
			await loadWorkspaceDetail(workspaceId);
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamBusy = { ...teamBusy, [`invite-${workspaceId}`]: false };
		}
	}

	async function revokeInvite(workspaceId: string, inviteId: string) {
		teamBusy = { ...teamBusy, [`revoke-${inviteId}`]: true };
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inviteId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to revoke invite');
			await loadWorkspaceDetail(workspaceId);
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamBusy = { ...teamBusy, [`revoke-${inviteId}`]: false };
		}
	}

	async function changeMemberRole(workspaceId: string, userId: string, role: string) {
		teamBusy = { ...teamBusy, [`role-${userId}`]: true };
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, role })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to update role');
			showToast('Role updated', 'success');
			await loadWorkspaceDetail(workspaceId);
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamBusy = { ...teamBusy, [`role-${userId}`]: false };
		}
	}

	/** Set or clear (empty input) a seat's calendar-month generation cap, in retail USD — the wallet's money (1 credit = 1¢), not raw provider cost. */
	async function saveSpendLimit(workspaceId: string, userId: string, raw: string) {
		const trimmed = raw.trim();
		const value = trimmed === '' ? null : Number(trimmed);
		if (value !== null && (!Number.isFinite(value) || value < 0)) {
			showToast('Spend limit must be a dollar amount (or blank for unlimited)', 'warning');
			return;
		}
		teamBusy = { ...teamBusy, [`limit-${userId}`]: true };
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, spendLimitUsd: value })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to update spend limit');
			showToast(value === null ? 'Spend limit removed' : `Spend limit set to $${value}/month`, 'success');
			await loadWorkspaceDetail(workspaceId);
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamBusy = { ...teamBusy, [`limit-${userId}`]: false };
		}
	}

	async function removeMember(workspaceId: string, userId: string) {
		teamBusy = { ...teamBusy, [`remove-${userId}`]: true };
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to remove member');
			showToast('Removed from workspace', 'success');
			await loadWorkspaceDetail(workspaceId);
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamBusy = { ...teamBusy, [`remove-${userId}`]: false };
		}
	}

	async function toggleWorkspacePersona(workspaceId: string, agentId: string, add: boolean) {
		teamBusy = { ...teamBusy, [`persona-${agentId}`]: true };
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/personas`, {
				method: add ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to update persona');
			await loadWorkspaceDetail(workspaceId);
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamBusy = { ...teamBusy, [`persona-${agentId}`]: false };
		}
	}

	/** Bulk-add every checked persona (see selectedPersonas) into the workspace, like picking several repos to share at once. */
	async function addSelectedPersonas(workspaceId: string, agentIds: string[]) {
		if (agentIds.length === 0) {
			showToast('Select at least one persona first', 'warning');
			return;
		}
		teamBusy = { ...teamBusy, [`bulk-${workspaceId}`]: true };
		let failed = 0;
		for (const agentId of agentIds) {
			try {
				const res = await fetch(`/api/workspaces/${workspaceId}/personas`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ agentId })
				});
				const data = await res.json();
				if (!data.success) failed++;
			} catch {
				failed++;
			}
			selectedPersonas = { ...selectedPersonas, [`${workspaceId}:${agentId}`]: false };
		}
		showToast(
			failed === 0
				? `Added ${agentIds.length} persona${agentIds.length === 1 ? '' : 's'} to the workspace`
				: `Added ${agentIds.length - failed}, ${failed} failed`,
			failed === 0 ? 'success' : 'error'
		);
		await loadWorkspaceDetail(workspaceId);
		teamBusy = { ...teamBusy, [`bulk-${workspaceId}`]: false };
	}

	async function leaveWorkspace(workspaceId: string) {
		teamBusy = { ...teamBusy, [`leave-${workspaceId}`]: true };
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/members`, { method: 'DELETE' });
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Failed to leave workspace');
			showToast('Left workspace', 'success');
			await loadTeam();
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			teamBusy = { ...teamBusy, [`leave-${workspaceId}`]: false };
		}
	}

	// Server metadata is the source of truth; localStorage only fills gaps for
	// values that were never persisted server-side (pre-migration installs).
	onMount(() => {
		consumeHash();
		window.addEventListener('hashchange', consumeHash);

		const stored = localStorage.getItem('personagen_settings');
		if (stored) {
			try {
				const s = JSON.parse(stored);
				if (!data.profile?.displayName && s.profileName) profileName = s.profileName;
				if (data.profile?.preferences?.emailAlerts == null) emailAlerts = s.emailAlerts ?? emailAlerts;
				if (data.profile?.preferences?.pushNotifications == null)
					pushNotifications = s.pushNotifications ?? pushNotifications;
				if (data.profile?.preferences?.weeklyReports == null)
					weeklyReports = s.weeklyReports ?? weeklyReports;
			} catch {
				/* ignore */
			}
		}
		loadApiKeys();
		loadZernioKeys();
		loadTeam();
		loadBrandBriefs();

		return () => window.removeEventListener('hashchange', consumeHash);
	});

	function persistSettings() {
		localStorage.setItem(
			'personagen_settings',
			JSON.stringify({
				profileName,
				emailAlerts,
				pushNotifications,
				weeklyReports
			})
		);
	}

	async function saveProfile() {
		const trimmed = profileName.trim();
		if (!trimmed) {
			showToast('Display name cannot be empty', 'warning');
			return;
		}
		profileSaving = true;
		try {
			const res = await fetch('/api/settings/profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName: trimmed })
			});
			const result = await res.json();
			if (res.ok && result.success) {
				profileName = result.displayName || trimmed;
				persistSettings();
				showToast('Profile updated', 'success');
			} else {
				showToast(result.error || 'Failed to save profile', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Failed to save profile', 'error');
		} finally {
			profileSaving = false;
		}
	}

	// ── Change login email (placeholder → real address) ──────────────────────
	// No mailer on this instance, so instead of a confirm-by-email round trip:
	// type it twice + re-enter the password, applied immediately server-side.
	let showEmailChange = $state(false);
	let newEmail = $state('');
	let confirmNewEmail = $state('');
	let emailChangePassword = $state('');
	let emailChangeSaving = $state(false);

	async function changeEmail() {
		emailChangeSaving = true;
		try {
			const res = await fetch('/api/settings/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					newEmail,
					confirmEmail: confirmNewEmail,
					currentPassword: emailChangePassword
				})
			});
			const result = await res.json();
			if (res.ok && result.success) {
				showEmailChange = false;
				newEmail = '';
				confirmNewEmail = '';
				emailChangePassword = '';
				showToast('Email updated — log out and back in with the new address', 'success');
			} else {
				showToast(result.error || 'Failed to change email', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Failed to change email', 'error');
		} finally {
			emailChangeSaving = false;
		}
	}

	/**
	 * Change password. A client re-audit found no password field anywhere in
	 * Settings or the account menu: a signed-in user could not change their
	 * password at all, and the recovery email pointed at a form that did not
	 * exist. /api/settings/password already existed — this is its missing UI.
	 * No current password is asked for, matching the endpoint: the session proves
	 * who is asking, exactly as it does for the recovery flow.
	 */
	let pwNew = $state('');
	let pwConfirm = $state('');
	let pwSaving = $state(false);
	let pwError = $state('');
	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		pwError = '';
		if (pwNew.length < 8) {
			pwError = 'Use at least 8 characters.';
			return;
		}
		if (pwNew !== pwConfirm) {
			pwError = 'The two passwords do not match.';
			return;
		}
		pwSaving = true;
		try {
			const res = await fetch('/api/settings/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPassword: pwNew, confirmPassword: pwConfirm })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok || !result.success) throw new Error(result.error || 'Could not change the password.');
			pwNew = '';
			pwConfirm = '';
			showToast('Password changed. Use it the next time you sign in.', 'success');
		} catch (err) {
			pwError = (err as Error).message;
		} finally {
			pwSaving = false;
		}
	}

	async function toggleNotification(key: 'emailAlerts' | 'pushNotifications' | 'weeklyReports') {
		// Optimistic flip; revert if the server rejects the update.
		if (key === 'emailAlerts') emailAlerts = !emailAlerts;
		else if (key === 'pushNotifications') pushNotifications = !pushNotifications;
		else weeklyReports = !weeklyReports;
		persistSettings();

		try {
			const res = await fetch('/api/settings/profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					preferences: { emailAlerts, pushNotifications, weeklyReports }
				})
			});
			const result = await res.json();
			if (res.ok && result.success) {
				showToast('Notification preference saved', 'success');
				return;
			}
			showToast(result.error || 'Failed to save preference', 'error');
		} catch (err) {
			showToast((err as Error).message || 'Failed to save preference', 'error');
		}

		// Server rejected — undo the optimistic flip.
		if (key === 'emailAlerts') emailAlerts = !emailAlerts;
		else if (key === 'pushNotifications') pushNotifications = !pushNotifications;
		else weeklyReports = !weeklyReports;
		persistSettings();
	}

	function getSavedKey(provider: ApiKeyProvider) {
		return apiKeys.find((key) => key.provider === provider);
	}

	async function loadApiKeys() {
		apiKeysLoading = true;
		try {
			const res = await fetch('/api/settings/api-keys');
			const data = await res.json();
			if (res.ok && data.success) {
				apiKeys = data.keys || [];
			} else {
				showToast(data.error || 'Unable to load API key settings', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Unable to load API key settings', 'error');
		} finally {
			apiKeysLoading = false;
		}
	}

	// POST /api/settings/api-keys gates `action === 'save'` — and only for the
	// GENERATION providers — with 403 PLAN_FEATURE when the plan has no BYOK
	// line. Which providers those are is NOT restated here: isByokGated() reads
	// the same provider catalogue ($lib/providers) the server route reads, so
	// the client can no longer gate more (or less) than its server.
	// Zernio is how every plan publishes and Firecrawl is how briefs are
	// researched, so neither is ever gated; and because only 'save' is gated,
	// Test Connection and Delete Key stay enabled for every provider — a user
	// keeps, can still test, and can still remove a key they already have.

	/**
	 * WAI-ARIA vertical tabs keyboard model for the Settings sections.
	 *
	 * Arrow Up/Left and Down/Right move to the previous/next section (wrapping),
	 * Home and End jump to the first and last. Activation follows focus: a
	 * section renders synchronously, so there is no cost to selecting on arrow,
	 * and it keeps the single rendered tabpanel matched to the focused tab.
	 */
	function onSectionKeydown(e: KeyboardEvent) {
		const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
		if (!keys.includes(e.key)) return;
		const order = SECTIONS.map((s) => s.key);
		const at = Math.max(0, order.indexOf(activeSection));
		let next = at;
		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (at + 1) % order.length;
		else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (at - 1 + order.length) % order.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = order.length - 1;
		e.preventDefault();
		activeSection = order[next] as typeof activeSection;
		// Focus the newly selected tab after it has become the tabbable one.
		queueMicrotask(() => document.getElementById(`settings-tab-${order[next]}`)?.focus());
	}

	/** A seat in someone else's workspace — the owner's Zernio key publishes their personas. */
	let seatRole = $derived((data as { seat?: { role?: string } }).seat?.role);
	let seatIsMember = $derived(!!seatRole && seatRole !== 'owner');

	/** Providers whose customer keys were withdrawn: they run on ours, included. */
	const includedProviders = NON_BYOK_PROVIDERS.filter((p) => !!p.keyProvider && p.billsToUserKey);
	/** Providers with genuinely no customer key (none issued, or nothing calls them). */
	const noKeyProviders = NON_BYOK_PROVIDERS.filter((p) => !(p.keyProvider && p.billsToUserKey));

	/**
	 * Does this provider still get an editable card?
	 *
	 * Customer BYOK is now Zernio-only: a key that is an identity, not a cost
	 * (providers.ts). The withdrawn providers are explained in the read-only
	 * list below instead of offering a field that would refuse on save.
	 *
	 * The exception is someone who saved a key under the old policy. That key no
	 * longer runs anything — getUserApiKey gates it — but it is still their
	 * secret sitting in our table, and hiding the card would leave them no way
	 * to remove it. They keep the card, and it says what became of the key.
	 */
	function showsKeyField(provider: string): boolean {
		const catalogued = providerByKeyProvider(provider);
		if (!catalogued || catalogued.byok.supported) return true;
		return !!getSavedKey(provider as ApiKeyProvider);
	}

	/** True when this card only exists so its holder can delete a now-inert key. */
	function isRetiredKey(provider: string): boolean {
		const catalogued = providerByKeyProvider(provider);
		return !!catalogued && !catalogued.byok.supported && !!getSavedKey(provider as ApiKeyProvider);
	}

	/** Reason this provider's Save is off, or null. Keyed on the PROVIDER, never
	 *  on the category card — a category mixes gated and ungated providers. */
	function saveKeyBlockedReason(provider: string): string | null {
		// A provider that can never take a customer key says so regardless of plan.
		const catalogued = providerByKeyProvider(provider);
		if (catalogued) {
			const never = byokReason(catalogued);
			if (never) return never;
		}
		if (data.entitlements?.byok !== false) return null;
		if (!isByokGated(provider)) return null;
		return `Your own generation keys are not included in the ${data.entitlements?.plan ?? 'free'} plan. See Billing to compare plans.`;
	}

	async function saveProviderKey(provider: ApiKeyProvider) {
		const input = apiKeyInputs[provider]?.trim() || '';
		if (input.length < 8) {
			showToast('Enter a valid API key first', 'warning');
			return;
		}
		apiKeySaving = { ...apiKeySaving, [provider]: true };
		try {
			const res = await fetch('/api/settings/api-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'save', provider, apiKey: input })
			});
			const data = await res.json();
			if (res.ok && data.success) {
				apiKeys = [...apiKeys.filter((key) => key.provider !== provider), data.key];
				apiKeyInputs = { ...apiKeyInputs, [provider]: '' };
				showToast('API key saved securely', 'success');
			} else {
				showToast(data.error || 'Failed to save API key', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Failed to save API key', 'error');
		} finally {
			apiKeySaving = { ...apiKeySaving, [provider]: false };
		}
	}

	async function testProviderKey(provider: ApiKeyProvider) {
		apiKeyTesting = { ...apiKeyTesting, [provider]: true };
		try {
			const res = await fetch('/api/settings/api-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'test', provider })
			});
			const data = await res.json();
			if (data.key) {
				apiKeys = [...apiKeys.filter((key) => key.provider !== provider), data.key];
			}
			if (res.ok && data.success) {
				showToast('Provider connection verified', 'success');
			} else {
				showToast(data.error || 'API key test failed', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'API key test failed', 'error');
		} finally {
			apiKeyTesting = { ...apiKeyTesting, [provider]: false };
		}
	}

	async function deleteProviderKey(provider: ApiKeyProvider) {
		apiKeyDeleting = { ...apiKeyDeleting, [provider]: true };
		try {
			const res = await fetch('/api/settings/api-keys', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider })
			});
			const data = await res.json();
			if (res.ok && data.success) {
				apiKeys = apiKeys.filter((key) => key.provider !== provider);
				showToast('API key deleted', 'info');
			} else {
				showToast(data.error || 'Failed to delete API key', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Failed to delete API key', 'error');
		} finally {
			apiKeyDeleting = { ...apiKeyDeleting, [provider]: false };
		}
	}

	async function confirmDelete() {
		if (deleteConfirmText !== 'DELETE' || deleteInProgress) return;
		deleteInProgress = true;
		try {
			const res = await fetch('/api/account/delete', { method: 'POST' });
			const result = await res.json();
			if (res.ok && result.success) {
				localStorage.removeItem('personagen_settings');
				if (result.failedSteps?.length) {
					showToast(
						`Account deleted, but some data could not be removed: ${result.failedSteps.join('; ')}`,
						'warning'
					);
				}
				// Session is gone server-side — hard navigation clears all client state.
				window.location.href = '/login';
				return;
			}
			showToast(result.error || 'Failed to delete account', 'error');
			deleteInProgress = false;
		} catch (err) {
			showToast((err as Error).message || 'Failed to delete account', 'error');
			deleteInProgress = false;
		}
	}
</script>

<PageShell
	title="Settings"
	description="Manage your profile, notifications, API keys, and account."
>

	<div class="settings-layout">
		<nav class="settings-nav" aria-label="Settings sections">
			<!-- Roving tabindex REQUIRES arrow-key handling. The first version shipped
			     the tabindex without the handler, which left 7 of 8 sections
			     unreachable by keyboard in every browser — worse than the plain
			     buttons it replaced. onSectionKeydown is the other half. -->
			<ul
				role="tablist"
				aria-orientation="vertical"
				aria-label="Settings sections"
				onkeydown={onSectionKeydown}
			>
				{#each SECTIONS as section (section.key)}
					<li role="presentation">
						<button
							type="button"
							class="nav-item"
							role="tab"
							id="settings-tab-{section.key}"
							aria-selected={activeSection === section.key}
							aria-controls={activeSection === section.key
								? `settings-panel-${section.key}`
								: undefined}
							tabindex={activeSection === section.key ? 0 : -1}
							class:active={activeSection === section.key}
							class:danger={section.key === 'danger'}
							onclick={() => (activeSection = section.key)}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d={section.icon} /></svg
							>
							<span>{section.label}</span>
						</button>
					</li>
				{/each}
			</ul>
		</nav>

		<div
			class="settings-grid"
			role="tabpanel"
			id="settings-panel-{activeSection}"
			aria-labelledby="settings-tab-{activeSection}"
			tabindex="0"
		>
		{#if activeSection === 'profile'}
		<!-- Profile -->
		<div class="settings-card">
			<div class="card-header">
				<div class="card-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--accent-text)"
						stroke-width="2"
						aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 10-16 0" /></svg
					>
				</div>
				<h2>Profile</h2>
			</div>
			<div class="card-body">
				<div class="avatar-row">
					<div class="profile-avatar">
						<span>{(profileName[0] ?? profileEmail[0] ?? 'U').toUpperCase()}</span>
					</div>
					<div class="avatar-info">
						<span class="avatar-name">{profileName}</span>
						<span class="avatar-role">Account Owner</span>
					</div>
				</div>
				<div class="field">
					<label for="profile-name">Display Name</label>
					<input id="profile-name" type="text" autocomplete="name" bind:value={profileName} />
				</div>
				<div class="field">
					<label for="profile-email">Email Address</label>
					<div class="readonly-field">
						<input
							id="profile-email"
							type="email"
							autocomplete="email"
							value={profileEmail}
							readonly
						/>
						<button
							type="button"
							class="secondary-btn"
							onclick={() => (showEmailChange = !showEmailChange)}
						>
							{showEmailChange ? 'Cancel' : 'Change email'}
						</button>
					</div>
				</div>
				{#if showEmailChange}
					<div class="field">
						<label for="new-email">New email address</label>
						<input id="new-email" type="email" autocomplete="off" bind:value={newEmail} placeholder="you@example.com" />
					</div>
					<div class="field">
						<label for="confirm-new-email">Confirm new email</label>
						<input id="confirm-new-email" type="email" autocomplete="off" bind:value={confirmNewEmail} placeholder="you@example.com" />
					</div>
					<div class="field">
						<label for="email-change-password">Current password</label>
						<input
							id="email-change-password"
							type="password"
							autocomplete="current-password"
							bind:value={emailChangePassword}
						/>
					</div>
					<p class="key-hint">
						Your login email changes immediately — no confirmation email is sent. You'll sign in
						with the new address from then on.
					</p>
					<button
						class="save-btn"
						onclick={changeEmail}
						disabled={emailChangeSaving || !newEmail.trim() || !confirmNewEmail.trim() || !emailChangePassword}
					>
						{#if emailChangeSaving}
							<span class="spinner"></span> Updating…
						{:else}
							Update Email
						{/if}
					</button>
				{/if}
				<button class="save-btn" onclick={saveProfile} disabled={profileSaving}>
					{#if profileSaving}
						<span class="spinner"></span> Saving…
					{:else}
						Save Profile
					{/if}
				</button>
			</div>
		</div>

		<div class="settings-card" id="password">
			<div class="card-header">
				<div class="card-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--accent-text)"
						stroke-width="2"
						aria-hidden="true"
						><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg
					>
				</div>
				<h2>Password</h2>
			</div>
			<form class="card-body pw-form" onsubmit={changePassword} novalidate>
				{#if pwError}
					<p class="pw-form-error" role="alert">{pwError}</p>
				{/if}
				<div class="field">
					<label for="pw-new">New password <span class="pw-hint" id="pw-hint">— at least 8 characters</span></label>
					<input
						id="pw-new"
						type="password"
						autocomplete="new-password"
						minlength="8"
						bind:value={pwNew}
					/>
				</div>
				<div class="field">
					<label for="pw-confirm">Confirm new password</label>
					<input
						id="pw-confirm"
						type="password"
						autocomplete="new-password"
						minlength="8"
						bind:value={pwConfirm}
					/>
				</div>
				<button type="submit" class="save-btn" disabled={pwSaving || !pwNew || !pwConfirm}>
					{#if pwSaving}
						<span class="spinner"></span> Saving…
					{:else}
						Change password
					{/if}
				</button>
			</form>
		</div>

		{:else if activeSection === 'notifications'}
		<!-- Notifications -->
		<div class="settings-card">
			<div class="card-header">
				<div class="card-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--cyan-text)"
						stroke-width="2"
						aria-hidden="true"
						><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path
							d="M13.73 21a2 2 0 01-3.46 0"
						/></svg
					>
				</div>
				<h2>Notifications</h2>
			</div>
			<div class="card-body">
				<div class="toggle-row">
					<div class="toggle-info">
						<span class="toggle-label" id="toggle-email-alerts-label">Email Alerts</span>
						<span class="toggle-desc" id="toggle-email-alerts-desc"
							>Receive alerts about persona activity and engagement</span
						>
					</div>
					<button
						class="toggle"
						class:on={emailAlerts}
						type="button"
						role="switch"
						aria-checked={emailAlerts}
						aria-labelledby="toggle-email-alerts-label"
						aria-describedby="toggle-email-alerts-desc"
						onclick={() => toggleNotification('emailAlerts')}
					>
						<span class="toggle-knob"></span>
					</button>
				</div>
				<div class="toggle-row">
					<div class="toggle-info">
						<span class="toggle-label" id="toggle-push-label">Push Notifications</span>
						<span class="toggle-desc" id="toggle-push-desc"
							>Browser push for real-time engagement events</span
						>
					</div>
					<button
						class="toggle"
						class:on={pushNotifications}
						type="button"
						role="switch"
						aria-checked={pushNotifications}
						aria-labelledby="toggle-push-label"
						aria-describedby="toggle-push-desc"
						onclick={() => toggleNotification('pushNotifications')}
					>
						<span class="toggle-knob"></span>
					</button>
				</div>
				<div class="toggle-row">
					<div class="toggle-info">
						<span class="toggle-label" id="toggle-weekly-label">Weekly Reports</span>
						<span class="toggle-desc" id="toggle-weekly-desc"
							>Performance digest every Monday at 9am</span
						>
					</div>
					<button
						class="toggle"
						class:on={weeklyReports}
						type="button"
						role="switch"
						aria-checked={weeklyReports}
						aria-labelledby="toggle-weekly-label"
						aria-describedby="toggle-weekly-desc"
						onclick={() => toggleNotification('weeklyReports')}
					>
						<span class="toggle-knob"></span>
					</button>
				</div>
			</div>
		</div>

		{:else if activeSection === 'theme'}
		<!-- Brand Theme — the app palette follows a brand brief only if asked -->
		<div class="settings-card">
			<div class="card-header">
				<div class="card-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--cyan-text)"
						stroke-width="2"
						aria-hidden="true"
						><circle cx="13.5" cy="6.5" r="2.5" /><circle cx="19" cy="13" r="2.5" /><circle
							cx="6"
							cy="12"
							r="2.5"
						/><circle cx="10" cy="19" r="2.5" /><path
							d="M12 2a10 10 0 000 20c1.1 0 2-.9 2-2 0-1.4-1-1.8-1-3 0-.8.7-1.5 1.5-1.5H17a5 5 0 005-5c0-4.9-4.5-8.5-10-8.5z"
						/></svg
					>
				</div>
				<h2>Brand Theme</h2>
			</div>
			<div class="card-body">
				<p class="card-hint">
					Dress PersonaGen in one of your brand briefs' colors. Off by default — editing or
					scraping a brief no longer changes the app's look on its own.
				</p>
				<div class="field">
					<label for="brand-theme-select">Theme source</label>
					<select
						id="brand-theme-select"
						value={brandThemeChoice}
						disabled={brandThemeBusy}
						onchange={(e) => changeBrandTheme((e.currentTarget as HTMLSelectElement).value, null)}
					>
						<option value="">PersonaGen default</option>
						{#each brandBriefs as b (b.id)}
							<option value={b.id}>{b.name}</option>
						{/each}
					</select>
				</div>
				<div class="brand-theme-preview" aria-live="polite">
					<span
						class="bt-swatch"
						role="img"
						aria-label="Primary colour {brandColorsState.primary}"
						style="background: {brandColorsState.primary}"
					></span>
					<span
						class="bt-swatch"
						role="img"
						aria-label="Secondary colour {brandColorsState.secondary}"
						style="background: {brandColorsState.secondary}"
					></span>
					<span class="bt-current">
						{brandThemeState.briefId
							? `Following "${brandThemeState.name}"`
							: 'Default PersonaGen palette'}
					</span>
					{#if brandThemeState.briefId}
						<button
							type="button"
							class="bt-reset"
							disabled={brandThemeBusy}
							onclick={() => changeBrandTheme('', null)}>Reset to default</button
						>
					{/if}
				</div>
				{#if brandBriefs.length === 0}
					<p class="card-hint" style="margin-top: 0.6rem;">
						No brand briefs saved yet — create one under Brand Brief to use it as a theme.
					</p>
				{/if}
			</div>
		</div>

		{:else if activeSection === 'api-keys'}
		<!-- Provider API Keys -->
		<div class="settings-card">
			<div class="card-header">
				<div class="card-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--gold)"
						stroke-width="2"
						aria-hidden="true"
						><path
							d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
						/></svg
					>
				</div>
				<h2>Provider API Keys</h2>
			</div>
			<div class="card-body">
				<p class="key-hint">
					Store user-owned provider keys securely. Saved keys are encrypted on the server and
					are never shown again after saving.
				</p>
				{#each KEY_CATEGORIES as cat (cat.key)}
					{@const inCat = providerConfigs.filter((c) => c.category === cat.key && showsKeyField(c.provider))}
					{@const setCount = inCat.filter((c) => !!getSavedKey(c.provider)).length}
					{#if inCat.length > 0}
						<section class="key-category">
							<div class="key-category-head">
								<div class="key-category-title">
									<h3>{cat.title}</h3>
									<span class="key-category-count">{setCount}/{inCat.length} set</span>
								</div>
								<span class="key-category-blurb">{cat.blurb}</span>
							</div>

							<div class="key-accordion">
								{#each inCat as config (config.provider)}
									{@const savedKey = getSavedKey(config.provider)}
									{@const saveBlocked = saveKeyBlockedReason(config.provider)}
									{@const state = savedKey
										? savedKey.status === 'valid'
											? 'valid'
											: savedKey.status === 'invalid' || savedKey.status === 'error'
												? 'error'
												: 'saved'
										: apiKeysLoading
											? 'loading'
											: 'unset'}
									<details class="key-item" class:has-key={!!savedKey}>
										<summary class="key-summary">
											<span
												class="key-mark"
												style="--mark-tint: {config.tint}"
												aria-hidden="true">{config.mark}</span
											>
											<span class="key-name">
												{config.label}
												{#if config.spans}<span class="key-spans">{config.spans}</span>{/if}
												{#if config.unused}<span class="key-unused">not wired up</span>
												{:else if config.optional}<span class="key-optional">optional</span>{/if}
											</span>
											<span
												class="key-state key-state-{state}"
												aria-live="polite"
											>
												<span class="sr-only">{config.label} key status: </span>
												{state === 'valid'
													? 'Valid'
													: state === 'error'
														? 'Check key'
														: state === 'saved'
															? 'Saved'
															: state === 'loading'
																? 'Loading'
																: 'Not set'}
											</span>
											<svg
												class="key-chevron"
												aria-hidden="true"
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg
											>
										</summary>

										<div class="key-body">
											{#if isRetiredKey(config.provider)}
												<!-- This card survives only so its owner can remove a secret we
												     no longer use. Leaving it looking active would be the worse
												     kind of wrong: they would believe their key is paying. -->
												<p class="key-retired" role="status">
													<strong>This key is no longer used.</strong> Generation now runs on our
													keys and is charged to your balance, so every post costs the same
													whether or not this is here. Nothing has been deleted — remove it below
													whenever you like.
												</p>
											{/if}
											<p class="key-desc">{config.description}</p>

										<p class="key-help">
											<!-- Opens the guide itself (#id). The old ?provider= link only narrowed
											     the docs index, and the page stripped the parameter before reading
											     it, so it landed on the unfiltered docs home. -->
											<a href="{resolve('/(portal)/guides')}#{config.provider === 'zernio' ? 'zernio-key' : 'all-keys'}">
												Where do I get a {config.label} key?
											</a>
										</p>

										{#if config.touchpoints.length > 0}
											<div class="touchpoints">
												<span class="touchpoints-title">Where this key is used</span>
												<ul class="touchpoints-list">
													{#each config.touchpoints as tp (tp)}
														<li>{tp}</li>
													{/each}
												</ul>
											</div>
										{:else}
											<p class="touchpoints-none">
												No feature in the platform calls this provider yet — a saved key is
												validated but never spent.
											</p>
										{/if}

											{#if savedKey}
												<div class="key-display">
													<code class="key-value">{savedKey.masked_value}</code>
												</div>
												{#if savedKey.last_error}
													<p class="key-error" role="alert" id={`${config.provider}-api-key-error`}>
														{savedKey.last_error}
													</p>
												{/if}
											{/if}

											<div class="field">
												<label for={`${config.provider}-api-key`}>{config.label} API Key</label>
												<input
													id={`${config.provider}-api-key`}
													type="password"
													bind:value={apiKeyInputs[config.provider]}
													placeholder={savedKey
														? 'Paste a new key to replace the saved one'
														: config.placeholder}
													autocomplete="off"
													disabled={saveBlocked !== null}
													title={saveBlocked ?? undefined}
													aria-invalid={savedKey?.last_error ? 'true' : undefined}
													aria-describedby={savedKey?.last_error
														? `${config.provider}-api-key-error`
														: undefined}
												/>
											</div>

											<div class="provider-actions">
												<button
													class="save-btn"
													onclick={() => saveProviderKey(config.provider)}
													disabled={apiKeySaving[config.provider] ||
														!apiKeyInputs[config.provider]?.trim() ||
														saveBlocked !== null}
													title={saveBlocked ?? undefined}
												>
													{#if apiKeySaving[config.provider]}
														<span class="spinner"></span> Saving…
													{:else}
														Save Key
													{/if}
												</button>
												<button
													class="secondary-btn"
													onclick={() => testProviderKey(config.provider)}
													disabled={apiKeyTesting[config.provider] || !savedKey}
												>
													{#if apiKeyTesting[config.provider]}
														<span class="spinner"></span> Testing…
													{:else}
														Test Connection
													{/if}
												</button>
												<button
													class="danger-inline-btn"
													onclick={() => deleteProviderKey(config.provider)}
													disabled={apiKeyDeleting[config.provider] || !savedKey}
												>
													{#if apiKeyDeleting[config.provider]}
														<span class="spinner"></span> Deleting…
													{:else}
														Delete Key
													{/if}
												</button>
											</div>
											{#if saveBlocked}
												<p class="plan-note">{saveBlocked}</p>
											{/if}
										</div>
									</details>
								{/each}
							</div>
						</section>
					{/if}
				{/each}

				<!-- Two different situations, kept apart because they are not the same
				     fact. The generation and research providers DO issue keys — we
				     stopped accepting customers' ones on 2026-09-21, so every run is
				     charged the same way, from the balance. Higgsfield and Kie genuinely
				     have no key to bring. One heading over both said "these providers do
				     not issue customer API keys", which was false for four of them, and
				     repeated the same fifty words under each. -->
				{#if includedProviders.length > 0}
					<section class="key-category">
						<div class="key-category-head">
							<div class="key-category-title">
								<h3>Included — runs on our keys</h3>
								<span class="key-category-count">{includedProviders.length}</span>
							</div>
							<span class="key-category-blurb">
								Images, video, writing and research all run on our keys and are charged to your
								balance, so every post is priced the same way. There is nothing to set up here —
								the one key that is yours to bring is Zernio, above, because it owns your
								publishing.
							</span>
						</div>
						<ul class="key-included-list">
							{#each includedProviders as p (p.id)}
								<li class="key-included">
									<span class="key-mark" style="--mark-tint: #64748b" aria-hidden="true"
										>{p.label.slice(0, 1)}</span
									>
									<span class="key-name">{p.label}</span>
									<span class="key-state key-state-valid">Included</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if noKeyProviders.length > 0}
					<section class="key-category">
						<div class="key-category-head">
							<div class="key-category-title">
								<h3>No key to bring</h3>
								<span class="key-category-count">{noKeyProviders.length}</span>
							</div>
						</div>
						<ul class="key-included-list">
							{#each noKeyProviders as p (p.id)}
								<li class="key-included key-included-reason">
									<span class="key-mark" style="--mark-tint: #64748b" aria-hidden="true"
										>{p.label.slice(0, 1)}</span
									>
									<span class="key-name">{p.label}</span>
									<span class="key-state key-state-unset">Not available</span>
									<p class="plan-note">{byokReason(p)}</p>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		</div>

		{:else if activeSection === 'zernio-keys'}
		<!-- Zernio Key Manager. id anchors the "add another key" redirect from the
		     persona Connections tab's slot meter (/settings#zernio-keys), which
		     `initialSection()` maps onto this section. -->
		<div class="settings-card" id="zernio-keys">
			<div class="card-header">
				<div class="card-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" aria-hidden="true">
						<rect x="3" y="11" width="18" height="10" rx="2" />
						<path d="M7 11V7a5 5 0 0110 0v4" />
					</svg>
				</div>
				<h2>Zernio Key Manager</h2>
			</div>
			<div class="card-body">
				<!-- One answer everywhere (audit UX-005): the Zernio key is the customer's
				     to create. "Provider API Keys above" pointed at a DIFFERENT tab with no
				     link, and a workspace seat was told the key was theirs to set although
				     workspace personas publish through the owner's key. -->
				{#if seatIsMember}
					<p class="key-hint">
						<strong>Your workspace's personas publish through the workspace owner's Zernio key.</strong>
						You don't need one of your own for them. Add a key here only for personas outside the
						workspace.
					</p>
				{:else}
					<p class="key-hint">
						<strong>The first Zernio key is yours to create, and it is free.</strong> Sign in at
						<a href="https://zernio.com" target="_blank" rel="noopener noreferrer">zernio.com</a> with
						Google, copy the API key, and paste it into the Zernio card in
						<button type="button" class="inline-link" onclick={() => (activeSection = 'api-keys')}
							>Provider API Keys</button
						> — that account comes with <strong>2 free connected-account slots</strong>, which is enough to
						publish. Nothing publishes until it is set.
					</p>
				{/if}
				<p class="key-hint">
					This panel is for <em>extra</em> Zernio accounts (one per persona email) assigned to
					specific personas. Each is a separate Zernio account with its own 2 free slots and its own
					bill. Personas without an assignment use your default key — the one in Provider API Keys.
					Moving a persona to a different key requires reconnecting its social accounts under that key.
				</p>

				<div class="provider-key-list">
					{#if zernioKeysLoading && zernioKeys.length === 0}
						<p class="key-hint" aria-live="polite">Loading Zernio keys…</p>
					{:else if zernioKeys.length === 0}
						<p class="key-hint" aria-live="polite">No extra Zernio keys yet — add one below.</p>
					{/if}

					{#each zernioKeys as key (key.id)}
						{@const assigned = zernioAgents.filter((a) => a.zernio_key_id === key.id)}
						<div class="provider-key-row">
							<div class="provider-key-header">
								<div>
									<strong>{key.label}</strong>
									<span>
										{assigned.length
											? `Assigned to ${assigned.map((a) => a.name).join(', ')}`
											: 'Not assigned to any persona yet'}
									</span>
								</div>
								<span
									class="status-pill"
									aria-live="polite"
									class:valid={key.status === 'valid'}
									class:error={key.status === 'invalid' || key.status === 'error'}
								>
									<span class="sr-only">{key.label} status: </span>{key.status}
								</span>
							</div>
							<div class="key-display">
								<code class="key-value">{key.masked_value}</code>
							</div>
							{#if key.last_error}
								<p class="key-error" role="alert">{key.last_error}</p>
							{/if}
							<div class="provider-actions">
								<button
									class="secondary-btn"
									onclick={() => testZernioKey(key.id)}
									disabled={zernioKeyBusy[key.id]}
								>
									{#if zernioKeyBusy[key.id]}
										<span class="spinner"></span> Working…
									{:else}
										Test &amp; Check Slots
									{/if}
								</button>
								<button
									class="danger-inline-btn"
									onclick={() => deleteZernioKey(key.id)}
									disabled={zernioKeyBusy[key.id]}
								>
									Delete Key
								</button>
							</div>
						</div>
					{/each}

					<!-- Add a key -->
					<div class="provider-key-row">
						<div class="provider-key-header">
							<div>
								<strong>Add a Zernio key</strong>
								<span>Label it with the Zernio account email so you can tell keys apart.</span>
							</div>
						</div>
						<div class="field">
							<label for="zernio-key-label">Label</label>
							<input
								id="zernio-key-label"
								type="text"
								bind:value={zernioKeyLabel}
								placeholder="e.g. mia.persona@gmail.com"
								autocomplete="off"
							/>
						</div>
						<div class="field">
							<label for="zernio-key-value">Zernio API Key</label>
							<input
								id="zernio-key-value"
								type="password"
								bind:value={zernioKeyValue}
								placeholder="Paste the Zernio API key for that account"
								autocomplete="off"
							/>
						</div>
						<div class="provider-actions">
							<button
								class="save-btn"
								onclick={saveZernioKey}
								disabled={zernioKeySaving || !zernioKeyLabel.trim() || !zernioKeyValue.trim()}
							>
								{#if zernioKeySaving}
									<span class="spinner"></span> Saving…
								{:else}
									Add Key
								{/if}
							</button>
						</div>
					</div>

					<!-- Persona assignments -->
					{#if zernioAgents.length > 0}
						<div class="provider-key-row">
							<div class="provider-key-header">
								<div>
									<strong>Persona assignments</strong>
									<span>Which Zernio account each persona connects and publishes through.</span>
								</div>
							</div>
							<div class="assign-list">
								{#each zernioAgents as agent (agent.id)}
									<div class="assign-row">
										<div class="assign-agent">
											<strong>{agent.name}</strong>
											{#if agent.handle}<span>{agent.handle}</span>{/if}
										</div>
										<select
											class="assign-select"
											aria-label="Zernio key for {agent.name}"
											value={agent.zernio_key_id || ''}
											disabled={zernioAssigning[agent.id] || zernioKeys.length === 0}
											onchange={(e) => assignZernioKey(agent, e.currentTarget as HTMLSelectElement)}
										>
											<option value="">Default key</option>
											{#each zernioKeys as key (key.id)}
												<option value={key.id}>{key.label}</option>
											{/each}
										</select>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		{:else if activeSection === 'team'}
		<div class="settings-card" id="team">
			<div class="card-header">
				<div class="card-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" aria-hidden="true">
						<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
					</svg>
				</div>
				<h2>Team</h2>
			</div>
			<div class="card-body">
				<p class="key-hint">
					A workspace is a shared home for a brand's personas — invite teammates as
					<strong>viewer</strong> (read-only), <strong>creator</strong> (generate &amp; draft, can't
					publish), <strong>manager</strong> (approve &amp; publish, connections, spend), or
					<strong>admin</strong> (everything a manager can do, plus managing other seats — for a
					developer/agency collaborator running this workspace day-to-day). Personas keep their
					existing owner; filing one into a workspace only widens who can work on it.
				</p>

				{#if teamLoading && ownedWorkspaces.length === 0 && memberships.length === 0}
					<p class="key-hint" aria-live="polite">Loading team info…</p>
				{/if}

				{#snippet workspaceManagerCard(
					ws: { id: string; name: string },
					members: MemberLite[],
					invites: PendingInviteLite[],
					personas: { inWorkspace: PersonaLite[]; available: PersonaLite[] },
					isOwner: boolean
				)}
						<div class="provider-key-row">
							<div class="provider-key-header">
								<div>
									<strong>{ws.name}</strong>
									<span>{isOwner ? 'You own this workspace' : 'You manage this workspace (admin seat)'}</span>
								</div>
							</div>

							<!-- Members -->
							{#if members.length > 0}
								<div class="assign-list">
									{#each members as m (m.user_id)}
										<div class="assign-row member-row">
											<div class="assign-agent member-email">
												<strong>{m.email || 'Pending email'}</strong>
											</div>
											<div class="member-controls">
											<select
												class="assign-select"
												aria-label="Role for {m.email}"
												value={m.role}
												disabled={teamBusy[`role-${m.user_id}`]}
												onchange={(e) =>
													changeMemberRole(ws.id, m.user_id, (e.currentTarget as HTMLSelectElement).value)}
											>
												<option value="viewer">Viewer</option>
												<option value="creator">Creator</option>
												<option value="manager">Manager</option>
												<option value="admin">Admin</option>
											</select>
											<input
												class="spend-limit-input"
												type="number"
												min="0"
												step="1"
												placeholder="$/mo"
												title="Monthly generation cap in retail USD — the same money the wallet shows (1 credit = 1¢), not raw provider cost. Blank means unlimited. Applies on blur/Enter."
												aria-label="Monthly spend limit for {m.email}"
												value={m.spend_limit_usd ?? ''}
												disabled={teamBusy[`limit-${m.user_id}`]}
												onchange={(e) =>
													saveSpendLimit(ws.id, m.user_id, (e.currentTarget as HTMLInputElement).value)}
											/>
											<button
												class="danger-inline-btn"
												onclick={() => removeMember(ws.id, m.user_id)}
												disabled={teamBusy[`remove-${m.user_id}`]}
											>
												Remove
											</button>
											</div>
										</div>
									{/each}
								</div>
							{:else}
								<p class="key-hint">No seats yet — invite someone below.</p>
							{/if}

							<!-- Pending invites -->
							{#if invites.length > 0}
								<div class="assign-list">
									{#each invites as inv (inv.id)}
										<div class="assign-row">
											<div class="assign-agent">
												<strong>{inv.email}</strong>
												<span>invited as {inv.role}</span>
											</div>
											<button
												class="danger-inline-btn"
												onclick={() => revokeInvite(ws.id, inv.id)}
												disabled={teamBusy[`revoke-${inv.id}`]}
											>
												Revoke
											</button>
										</div>
									{/each}
								</div>
							{/if}

							<!-- Invite form -->
							<div class="field">
								<label for="invite-email-{ws.id}">Invite by email</label>
								<input
									id="invite-email-{ws.id}"
									type="email"
									placeholder="teammate@example.com"
									autocomplete="off"
									value={inviteEmail[ws.id] || ''}
									oninput={(e) =>
										(inviteEmail = { ...inviteEmail, [ws.id]: (e.currentTarget as HTMLInputElement).value })}
								/>
							</div>
							<div class="field">
								<label for="invite-role-{ws.id}">Role</label>
								<select
									id="invite-role-{ws.id}"
									value={inviteRole[ws.id] || 'creator'}
									onchange={(e) =>
										(inviteRole = {
											...inviteRole,
											[ws.id]: (e.currentTarget as HTMLSelectElement).value as any
										})}
								>
									<option value="viewer">Viewer — read only</option>
									<option value="creator">Creator — generate &amp; draft</option>
									<option value="manager">Manager — approve &amp; publish</option>
									<option value="admin">Admin — + manage seats (invite/remove teammates)</option>
								</select>
							</div>
							<div class="provider-actions">
								<button
									class="save-btn"
									onclick={() => sendInvite(ws.id)}
									disabled={teamBusy[`invite-${ws.id}`]}
								>
									{#if teamBusy[`invite-${ws.id}`]}
										<span class="spinner"></span> Sending…
									{:else}
										Send Invite
									{/if}
								</button>
							</div>
							{#if lastInviteLink[ws.id]}
								<p class="key-hint">
									Invite link (send it yourself — there's no email sender wired up):
									<br /><code class="key-value">{lastInviteLink[ws.id]}</code>
								</p>
							{/if}

							<!-- Persona assignment -->
							<div class="provider-key-header" style="margin-top: 1rem;">
								<div>
									<strong>Personas in this workspace</strong>
									<span>Every seat above can see and work on these.</span>
								</div>
							</div>
							<div class="assign-list">
								{#each personas.inWorkspace as p (p.id)}
									<div class="assign-row">
										<div class="assign-agent">
											<strong>{p.name}</strong>
											{#if p.handle}<span>{p.handle}</span>{/if}
										</div>
										<button
											class="danger-inline-btn"
											onclick={() => toggleWorkspacePersona(ws.id, p.id, false)}
											disabled={teamBusy[`persona-${p.id}`]}
										>
											Remove
										</button>
									</div>
								{/each}
								{#if personas.available.length > 0}
									{@const brands = Array.from(
										new Set(personas.available.map((p) => p.persona_groups?.name).filter(Boolean))
									) as string[]}
									{@const activeBrand = brandFilter[ws.id] || 'all'}
									{@const filtered = personas.available.filter(
										(p) => activeBrand === 'all' || p.persona_groups?.name === activeBrand
									)}
									{@const filteredIds = filtered.map((p) => p.id)}
									{@const checkedIds = filteredIds.filter((id) => selectedPersonas[`${ws.id}:${id}`])}
									{@const allChecked = filteredIds.length > 0 && checkedIds.length === filteredIds.length}

									<div class="persona-picker-toolbar">
										{#if brands.length > 0}
											<select
												aria-label="Filter available personas by brand"
												value={activeBrand}
												onchange={(e) =>
													(brandFilter = {
														...brandFilter,
														[ws.id]: (e.currentTarget as HTMLSelectElement).value
													})}
											>
												<option value="all">All brands</option>
												{#each brands as b}
													<option value={b}>{b}</option>
												{/each}
											</select>
										{/if}
										<label class="select-all-label">
											<input
												type="checkbox"
												checked={allChecked}
												onchange={(e) => {
													const checked = (e.currentTarget as HTMLInputElement).checked;
													const next = { ...selectedPersonas };
													for (const id of filteredIds) next[`${ws.id}:${id}`] = checked;
													selectedPersonas = next;
												}}
											/>
											Select all{activeBrand !== 'all' ? ` in ${activeBrand}` : ''} ({filteredIds.length})
										</label>
										<button
											class="save-btn"
											onclick={() => addSelectedPersonas(ws.id, checkedIds)}
											disabled={checkedIds.length === 0 || teamBusy[`bulk-${ws.id}`]}
										>
											{#if teamBusy[`bulk-${ws.id}`]}
												<span class="spinner"></span> Adding…
											{:else}
												Add {checkedIds.length || ''} selected
											{/if}
										</button>
									</div>

									{#each filtered as p (p.id)}
										<div class="assign-row">
											<label class="assign-agent" style="cursor: pointer;">
												<input
													type="checkbox"
													checked={!!selectedPersonas[`${ws.id}:${p.id}`]}
													onchange={(e) =>
														(selectedPersonas = {
															...selectedPersonas,
															[`${ws.id}:${p.id}`]: (e.currentTarget as HTMLInputElement).checked
														})}
												/>
												<strong>{p.name}</strong>
												{#if p.persona_groups?.name}<span class="brand-chip">{p.persona_groups.name}</span>{/if}
												{#if p.handle}<span>{p.handle}</span>{/if}
											</label>
											<button
												class="secondary-btn"
												onclick={() => toggleWorkspacePersona(ws.id, p.id, true)}
												disabled={teamBusy[`persona-${p.id}`]}
											>
												Add to workspace
											</button>
										</div>
									{/each}
								{:else if personas.inWorkspace.length === 0}
									<p class="key-hint">You don't have any personas to file into a workspace yet.</p>
								{/if}
							</div>
						</div>
				{/snippet}

				<div class="provider-key-list">
					{#each ownedWorkspaces as ws (ws.id)}
						{@const members = workspaceMembers[ws.id] || []}
						{@const invites = workspaceInvites[ws.id] || []}
						{@const personas = workspacePersonas[ws.id] || { inWorkspace: [], available: [] }}
						{@render workspaceManagerCard(ws, members, invites, personas, true)}
					{/each}

					<!-- Workspaces where this account is an admin seat (not the owner) —
					     same management card, since admin+ can invite/re-role/remove
					     other seats and file its own personas in exactly like the owner. -->
					{#each memberships.filter((m) => m.role === 'admin') as m (m.workspace_id)}
						{@const wsId = m.workspace_id}
						{@const members = workspaceMembers[wsId] || []}
						{@const invites = workspaceInvites[wsId] || []}
						{@const personas = workspacePersonas[wsId] || { inWorkspace: [], available: [] }}
						{@render workspaceManagerCard(
							{ id: wsId, name: m.workspaces?.name ?? 'Workspace' },
							members,
							invites,
							personas,
							false
						)}
					{/each}

					<!-- Create a workspace -->
					<div class="provider-key-row">
						<div class="provider-key-header">
							<div>
								<strong>Create a workspace</strong>
								<span>Name it after the brand — e.g. "HoneyX".</span>
							</div>
						</div>
						<div class="field">
							<label for="new-workspace-name">Workspace name</label>
							<input
								id="new-workspace-name"
								type="text"
								bind:value={newWorkspaceName}
								placeholder="e.g. HoneyX"
								autocomplete="off"
								disabled={createWorkspaceBlockedReason !== null}
								title={createWorkspaceBlockedReason ?? undefined}
							/>
						</div>
						<div class="provider-actions">
							<button
								class="save-btn"
								onclick={createWorkspace}
								disabled={creatingWorkspace ||
									!newWorkspaceName.trim() ||
									createWorkspaceBlockedReason !== null}
								title={createWorkspaceBlockedReason ?? undefined}
							>
								{#if creatingWorkspace}
									<span class="spinner"></span> Creating…
								{:else}
									Create Workspace
								{/if}
							</button>
						</div>
						{#if createWorkspaceBlockedReason}
							<p class="plan-note">{createWorkspaceBlockedReason}</p>
						{/if}
					</div>

					<!-- Memberships in other workspaces (admin-tier ones get the full
					     management card above instead — this is just the plain seats). -->
					{#if nonAdminMemberships.length > 0}
						<div class="provider-key-row">
							<div class="provider-key-header">
								<div>
									<strong>Workspaces you've joined</strong>
									<span>Seats where someone else manages the workspace.</span>
								</div>
							</div>
							<div class="assign-list">
								{#each nonAdminMemberships as m (m.workspace_id)}
									<div class="assign-row">
										<div class="assign-agent">
											<strong>{m.workspaces?.name ?? 'Workspace'}</strong>
											<span>{m.role}</span>
										</div>
										<button
											class="danger-inline-btn"
											onclick={() => leaveWorkspace(m.workspace_id)}
											disabled={teamBusy[`leave-${m.workspace_id}`]}
										>
											Leave
										</button>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		{:else if activeSection === 'billing'}
		<!-- Billing -->
		<div class="settings-card">
			<div class="card-header">
				<div class="card-icon billing-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" stroke-width="2" aria-hidden="true">
						<rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
						<line x1="1" y1="10" x2="23" y2="10" />
					</svg>
				</div>
				<h2>Billing &amp; Plan</h2>
			</div>
			<div class="card-body">
				<div class="billing-coming-soon">
					<div class="billing-icon-wrap">
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
							<path d="M12 2L2 7l10 5 10-5-10-5z" />
							<path d="M2 17l10 5 10-5" />
							<path d="M2 12l10 5 10-5" />
						</svg>
					</div>
					<div class="billing-text">
						<p class="billing-title">Wallet, plans and invoices live on the Billing page</p>
						<p class="billing-desc">
							Your balance is shown as money in your currency, every generation is priced before you
							confirm, purchased credit never expires, and workspace personas draw on the workspace
							owner's wallet.
						</p>
						<a class="btn btn-secondary billing-open" href="/billing">Open Billing</a>
					</div>
				</div>
			</div>
		</div>

		{:else if activeSection === 'danger'}
		<!-- Danger Zone -->
		<div class="settings-card danger-card">
			<div class="card-header">
				<div class="card-icon danger-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--error-text)"
						stroke-width="2"
						aria-hidden="true"
						><path
							d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
						/><line x1="12" y1="9" x2="12" y2="13" /><line
							x1="12"
							y1="17"
							x2="12.01"
							y2="17"
						/></svg
					>
				</div>
				<h2>Danger Zone</h2>
			</div>
			<div class="card-body">
				<p class="danger-text">
					Permanently delete your account and all associated personas, posts, and data. This action
					cannot be undone.
				</p>
				<button class="delete-btn" type="button" onclick={() => (showDeleteModal = true)}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
						><polyline points="3 6 5 6 21 6" /><path
							d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
						/></svg
					>
					Delete Account
				</button>
			</div>
		</div>
		{/if}
		</div>
	</div>
</PageShell>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && showDeleteModal && !deleteInProgress) {
			showDeleteModal = false;
			deleteConfirmText = '';
		}
	}}
/>

<!-- Delete Modal -->
{#if showDeleteModal}
	<div class="modal-overlay">
		<button
			type="button"
			class="modal-backdrop"
			aria-label="Close the delete account dialog"
			onclick={() => (showDeleteModal = false)}
		></button>
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-modal-title"
			aria-describedby="delete-modal-desc"
			tabindex="-1"
			use:dialog={{ onClose: () => (showDeleteModal = false) }}
		>
			<div class="modal-header">
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--error-text)"
					stroke-width="2"
					aria-hidden="true"
					><path
						d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
					/><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg
				>
				<h2 id="delete-modal-title">Delete Account</h2>
			</div>
			<p class="modal-text" id="delete-modal-desc">
				This will permanently delete your account, all personas, posts, connections, and analytics
				data. This action is <strong>irreversible</strong>.
			</p>
			<div class="modal-field">
				<label for="delete-confirm">Type <strong>DELETE</strong> to confirm</label>
				<input
					id="delete-confirm"
					type="text"
					bind:value={deleteConfirmText}
					placeholder="DELETE"
					autocomplete="off"
					autocapitalize="characters"
					aria-describedby="delete-confirm-hint"
				/>
				<p class="sr-only" id="delete-confirm-hint">
					The delete button stays disabled until you type DELETE in capital letters.
				</p>
			</div>
			<div class="modal-actions">
				<button
					class="cancel-btn"
					type="button"
					disabled={deleteInProgress}
					onclick={() => {
						showDeleteModal = false;
						deleteConfirmText = '';
					}}>Cancel</button
				>
				<button
					class="confirm-delete-btn"
					type="button"
					onclick={confirmDelete}
					disabled={deleteConfirmText !== 'DELETE' || deleteInProgress}
				>
					{#if deleteInProgress}
						<span class="spinner"></span> Deleting…
					{:else}
						Delete My Account
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>



	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-base);
	}

	/* Sub-nav rail + one panel. `minmax(0, 1fr)` on the panel column stops a wide
	   child (the masked key <code>, a long select) from blowing the grid past the
	   viewport, which is what would produce a horizontal scrollbar. */
	.settings-layout {
		display: grid;
		grid-template-columns: 232px minmax(0, 1fr);
		gap: 2rem;
		align-items: start;
	}

	.settings-nav {
		position: sticky;
		top: 0;
	}

	.settings-nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		min-height: 44px;
		padding: 0.6rem 0.85rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		font-family: var(--font-body);
		text-align: left;
		cursor: pointer;
		transition:
			background 0.18s ease,
			color 0.18s ease,
			border-color 0.18s ease;
	}

	.nav-item svg {
		flex-shrink: 0;
	}

	.nav-item span {
		min-width: 0;
	}

	.nav-item:hover {
		color: var(--text);
		background: var(--surface-2);
	}

	.nav-item.active {
		color: var(--accent-text);
		background: var(--accent-soft);
		border-color: var(--accent-mid);
	}

	/* Danger Zone stays visually distinct in the rail as well as in the panel,
	   so it never reads as just another settings group. */
	.nav-item.danger {
		color: var(--error-text);
		margin-top: 0.5rem;
		border-top: 1px solid var(--border);
		border-top-left-radius: 0;
		border-top-right-radius: 0;
		padding-top: 0.85rem;
	}

	.nav-item.danger:hover {
		background: color-mix(in srgb, var(--error) 8%, transparent);
	}

	.nav-item.danger.active {
		background: var(--error-soft);
		border-color: color-mix(in srgb, var(--error) 35%, transparent);
		border-top-color: color-mix(in srgb, var(--error) 35%, transparent);
	}

	.nav-item:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.settings-grid {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}

	.settings-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.danger-card {
		border-color: color-mix(in srgb, var(--error) 15%, transparent);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.card-icon {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-soft);
		border-radius: var(--radius-sm);
	}

	.danger-icon {
		background: var(--error-soft);
	}

	.card-header h2 {
		font-size: var(--text-lg);
		font-family: var(--font-display);
	}

	.card-body {
		padding: 1.5rem;
	}

	/* Profile */
	.avatar-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.profile-avatar {
		width: 56px;
		height: 56px;
		border-radius: var(--radius-md);
		background: var(--gradient);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.profile-avatar span {
		color: #fff;
		font-weight: 700;
		font-size: 1.25rem;
		font-family: var(--font-display);
	}

	.avatar-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.avatar-name {
		font-weight: 600;
		font-size: var(--text-md);
	}

	.avatar-role {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.field {
		margin-bottom: 1.25rem;
	}

	.readonly-field {
		position: relative;
	}

	.readonly-field input {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.readonly-badge {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.save-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.5rem;
		min-height: 44px;
		background: var(--gradient-cta);
		color: #fff;
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease;
		font-family: var(--font-body);
	}

	.save-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}

	.save-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Toggles */
	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
	}

	.toggle-row:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.toggle-row:first-child {
		padding-top: 0;
	}

	.toggle-info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.toggle-label {
		font-weight: 600;
		font-size: var(--text-base);
	}

	.toggle-desc {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.toggle {
		width: 48px;
		height: 26px;
		border: none;
		border-radius: 13px;
		background: var(--surface-3);
		cursor: pointer;
		position: relative;
		transition: background 0.25s ease;
		flex-shrink: 0;
		padding: 0;
	}

	/* The visible track stays 48x26; this pseudo-element grows the tap target to
	   48x44 without making the switch look bigger. */
	.toggle::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 44px;
		transform: translateY(-50%);
	}

	.toggle.on {
		background: var(--accent);
	}

	.toggle-knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.25s ease;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.toggle.on .toggle-knob {
		transform: translateX(22px);
	}

	/* API Keys */
	.key-hint {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	/* Why a control above is off — a plan limit, not a fault. Sits under the
	   action row it explains, so the reason is next to the disabled button. */
	.plan-note {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0.6rem 0 0;
		line-height: 1.5;
	}

	/* Brand Theme */
	.card-hint {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0 0 1rem;
		line-height: 1.55;
	}
	.brand-theme-preview {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
	}
	.bt-swatch {
		width: 22px;
		height: 22px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border-strong);
		flex-shrink: 0;
	}
	.bt-current {
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-weight: 600;
	}
	.bt-reset {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 0.35rem 0.75rem;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
		font-family: var(--font-body);
	}
	.bt-reset:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.bt-reset:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.key-display {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}

	.key-value {
		flex: 1;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		background: none;
		border: none;
		padding: 0;
		word-break: break-all;
	}

	.key-help {
		margin: var(--space-2) 0 0;
		font-size: var(--text-base);
	}
	.key-help a {
		color: var(--accent-text);
	}
	.provider-key-row {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 1rem;
		background: var(--bg-card-dark);
	}

	.provider-key-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.provider-key-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.provider-key-header strong {
		display: block;
		font-size: var(--text-base);
		margin-bottom: 0.2rem;
	}

	.provider-key-header span:not(.status-pill) {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-muted);
		line-height: 1.5;
	}

	.status-pill {
		padding: 0.25rem 0.55rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.status-pill.valid {
		border-color: var(--success);
		color: var(--success-text);
	}

	.status-pill.error {
		border-color: var(--error);
		color: var(--error-text);
	}

	.key-error {
		margin: -0.35rem 0 1rem;
		font-size: var(--text-xs);
		color: var(--error-text);
		line-height: 1.5;
	}

	.provider-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	/* Zernio Key Manager — persona ↔ key assignments */
	.assign-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.assign-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0.85rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.assign-agent {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		/* Take the flexible space so the label/email column is the one that grows,
		   not the role <select> — and truncate gracefully instead of forcing the
		   row layout when an email is long. */
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
	}

	.assign-agent strong {
		font-size: var(--text-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.assign-agent span {
		font-size: var(--text-xs);
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Persona-sharing picker — brand filter + select-all, like picking repos to share */
	.persona-picker-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.6rem;
	}

	.select-all-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
		cursor: pointer;
	}

	.brand-chip {
		font-size: var(--text-xs);
		color: var(--accent-text);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
		white-space: nowrap;
	}

	/* Provider keys: grouped by intent, each provider a collapsed accordion row.
	   Native <details>/<summary> so keyboard + screen-reader behaviour is free
	   and no JS state is needed to track what's open. */
	.key-category {
		margin-bottom: 1.4rem;
	}
	.key-category-head {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin-bottom: 0.6rem;
	}
	.key-category-title {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.key-category-head h3 {
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.key-category-count {
		font-size: var(--text-xs);
		color: var(--text-dim, var(--text-muted));
		opacity: 0.8;
	}
	.key-category-blurb {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.key-accordion {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.key-item {
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 10px);
		background: var(--surface);
		overflow: hidden;
		transition: border-color 0.15s ease;
	}
	.key-item[open] {
		border-color: var(--border-hover, var(--border-strong));
	}
	.key-item:hover {
		border-color: var(--border-strong);
	}

	.key-summary {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.6rem 0.8rem;
		cursor: pointer;
		list-style: none;
		/* Comfortable hit target without the old card's bulk. */
		min-height: 44px;
	}
	.key-summary::-webkit-details-marker {
		display: none;
	}
	.key-summary:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.key-mark {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 7px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #fff;
		background: var(--mark-tint);
	}

	.key-name {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text);
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.key-optional {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--text-muted);
		opacity: 0.75;
	}

	/* Status carries a word as well as a colour — colour alone fails for
	   colour-blind users and in high-contrast modes. */
	.key-state {
		flex-shrink: 0;
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 0.12rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-muted);
		white-space: nowrap;
	}
	.key-state-valid {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: #15803d;
	}
	.key-state-error {
		background: color-mix(in srgb, #dc2626 16%, transparent);
		color: #b91c1c;
	}
	.key-state-saved {
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		color: var(--accent-text);
	}
	:global([data-theme='dark']) .key-state-valid {
		color: #4ade80;
	}
	:global([data-theme='dark']) .key-state-error {
		color: #f87171;
	}

	.key-chevron {
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform 0.18s ease;
	}
	.key-item[open] .key-chevron {
		transform: rotate(180deg);
	}

	.key-body {
		padding: 0 0.8rem 0.8rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	.key-desc {
		font-size: var(--text-xs);
		color: var(--text-muted);
		line-height: 1.5;
	}

	/* Audited call sites for the key — so it's obvious what stops working
	   without it, and what it's costing you when it's set. */
	.touchpoints {
		background: var(--surface-2);
		border-radius: 8px;
		padding: 0.6rem 0.75rem;
	}
	.touchpoints-title {
		display: block;
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin-bottom: 0.35rem;
	}
	.touchpoints-list {
		margin: 0;
		padding-left: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.touchpoints-list li {
		font-size: var(--text-xs);
		color: var(--text);
		line-height: 1.45;
	}
	.touchpoints-none {
		font-size: var(--text-xs);
		color: var(--text-muted);
		background: var(--surface-2);
		border-radius: 8px;
		padding: 0.6rem 0.75rem;
		line-height: 1.5;
	}

	.key-spans,
	/* The read-only provider rows. flex-wrap so the status pill drops to its own
	   line on a phone instead of painting over the name (it overlapped "no
	   customer keys" at 320–414px). */
	.inline-link {
		padding: 0;
		border: none;
		background: none;
		color: var(--accent-text);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
	}

	.pw-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: flex-start;
	}
	.pw-form .field {
		width: 100%;
		max-width: 26rem;
	}
	.pw-hint {
		font-weight: 400;
		color: var(--text-dim);
	}
	.pw-form-error {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		color: var(--error-text);
		font-size: var(--text-base);
	}

	.key-included-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.key-included {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 12px);
		background: var(--surface);
		min-width: 0;
	}
	.key-included .key-name {
		flex: 1 1 8rem;
		min-width: 0;
	}
	.key-included .plan-note {
		flex-basis: 100%;
		margin: 0;
	}

	.key-unused {
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	/* Shown on a card that exists only so a key saved under the old BYOK policy
	   can be removed. Notice weight, not error weight: nothing is broken. */
	.key-retired {
		margin: 0 0 var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-base);
		line-height: var(--leading-relaxed);
		color: var(--text-muted);
	}
	.key-spans {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		color: var(--accent-text);
	}
	.key-unused {
		background: var(--surface-2);
		color: var(--text-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.key-chevron {
			transition: none;
		}
	}

	/* Member rows stack: the email gets a full line (never truncated), controls
	   sit beneath it — the settings column is too narrow to fit a long address
	   and three controls on one line. */
	.member-row {
		flex-direction: column;
		align-items: stretch;
		gap: 0.55rem;
	}
	.member-email strong {
		white-space: normal;
		overflow-wrap: anywhere;
		font-size: var(--text-sm);
	}
	.member-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.member-controls .assign-select {
		flex: 1 1 8.5rem;
		min-width: 8.5rem;
		width: auto;
	}

	.spend-limit-input {
		width: 5.5rem;
		padding: 0.35rem 0.5rem;
		font-size: var(--text-sm);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--text);
	}

	.assign-select {
		/* Fixed, consistent width so the role dropdown never balloons across the
		   row — the email column (.assign-agent) is what flexes now. */
		flex: 0 0 auto;
		width: 8.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-card-dark);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--text);
		/* Must stay >=16px — iOS Safari force-zooms a focused control below that. */
		font-size: 1rem;
		font-family: var(--font-body);
		cursor: pointer;
	}

	.assign-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.secondary-btn,
	.danger-inline-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.1rem;
		min-height: 44px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		font-family: var(--font-body);
		transition:
			border-color 0.2s ease,
			color 0.2s ease,
			background 0.2s ease;
	}

	.secondary-btn {
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
	}

	.secondary-btn:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--accent-mid);
		background: var(--accent-soft);
	}

	.danger-inline-btn {
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
		color: var(--error-text);
	}

	.danger-inline-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--error) 8%, transparent);
		border-color: var(--error);
	}

	.secondary-btn:disabled,
	.danger-inline-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Billing */
	.billing-icon {
		background: var(--accent-soft);
	}

	.billing-open {
		align-self: flex-start;
		margin-top: var(--space-3);
	}

	.coming-soon-badge {
		margin-left: auto;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--accent-mid);
		color: var(--accent-text);
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		white-space: nowrap;
	}

	.billing-coming-soon {
		display: flex;
		align-items: flex-start;
		gap: 1.25rem;
		padding: 1.25rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	.billing-icon-wrap {
		width: 52px;
		height: 52px;
		border-radius: var(--radius-md);
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent-text);
		flex-shrink: 0;
	}

	.billing-text {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.billing-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text);
		margin: 0;
	}

	.billing-desc {
		font-size: var(--text-sm);
		color: var(--text-muted);
		line-height: 1.6;
		margin: 0;
	}

	/* Danger */
	.danger-text {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin-bottom: 1.25rem;
		line-height: 1.6;
	}

	.delete-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.5rem;
		min-height: 44px;
		background: var(--error-soft);
		border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
		border-radius: var(--radius-sm);
		color: var(--error-text);
		font-weight: 600;
		font-size: var(--text-base);
		cursor: pointer;
		transition: background 0.2s ease;
		font-family: var(--font-body);
	}

	.delete-btn:hover {
		background: color-mix(in srgb, var(--error) 20%, transparent);
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		padding: 1rem;
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* A real button as the backdrop: dismissing by clicking outside is then
	   keyboard-reachable and needs no click handler on a plain <div>. */
	.modal-backdrop {
		position: absolute;
		inset: 0;
		width: 100%;
		border: none;
		padding: 0;
		background: transparent;
		cursor: default;
	}

	.modal {
		position: relative;
		z-index: 1;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
		max-width: 460px;
		width: 100%;
		max-height: 90dvh;
		overflow-y: auto;
		animation: modalIn 0.25s ease;
	}

	@keyframes modalIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.modal-header h2 {
		font-size: var(--text-lg);
		font-family: var(--font-display);
		color: var(--error-text);
	}

	.modal-text {
		font-size: var(--text-sm);
		color: var(--text-muted);
		line-height: 1.6;
		margin-bottom: 1.25rem;
	}

	.modal-text strong {
		color: var(--error-text);
	}

	.modal-field {
		margin-bottom: 1.5rem;
	}

	.modal-field label strong {
		color: var(--error-text);
		font-family: var(--font-mono);
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.cancel-btn {
		padding: 0.6rem 1.25rem;
		min-height: 44px;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		font-family: var(--font-body);
		transition:
			color 0.2s ease,
			border-color 0.2s ease;
	}

	.cancel-btn:hover {
		color: var(--text);
		border-color: var(--accent-mid);
	}

	.confirm-delete-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.6rem 1.25rem;
		min-height: 44px;
		background: var(--error);
		border: none;
		border-radius: var(--radius-sm);
		color: #fff;
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		font-family: var(--font-body);
		transition: opacity 0.2s ease;
	}

	.confirm-delete-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.confirm-delete-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Below the two-column threshold the rail folds into a wrapping chip row.
	   Wrapping (not overflow-x) is deliberate: a scrolling strip hides sections
	   and is the classic source of a horizontally scrolling page at 375px. */
	@media (max-width: 900px) {
		.settings-layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 1.25rem;
		}

		.settings-nav {
			position: static;
			padding-bottom: 1.25rem;
			border-bottom: 1px solid var(--border);
		}

		.settings-nav ul {
			flex-direction: row;
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		.nav-item {
			width: auto;
			border-color: var(--border);
			background: var(--surface);
		}

		.nav-item.danger {
			margin-top: 0;
			padding-top: 0.6rem;
			border-radius: var(--radius-sm);
			border-color: color-mix(in srgb, var(--error) 35%, transparent);
		}
	}

	@media (max-width: 768px) {
		.page {
			padding: 1rem;
		}

		.toggle-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.key-display {
			flex-direction: column;
			align-items: flex-start;
		}

		.modal-actions {
			flex-direction: column;
		}
	}
</style>
