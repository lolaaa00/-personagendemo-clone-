<script lang="ts">
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
	import { onMount } from 'svelte';

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
		};
	}>();

	// Profile — email comes from auth session; name + notification preferences
	// are persisted in Supabase user metadata (localStorage is only a cache).
	let profileEmail = $derived(data.user?.email ?? '');
	let profileName = $state(
		data.profile?.displayName || data.user?.email?.split('@')[0] || 'Account'
	);
	let profileSaving = $state(false);

	// Notifications
	let emailAlerts = $state(data.profile?.preferences?.emailAlerts ?? true);
	let pushNotifications = $state(data.profile?.preferences?.pushNotifications ?? false);
	let weeklyReports = $state(data.profile?.preferences?.weeklyReports ?? true);

	// ── Brand Theme: which brand brief's colors dress the app ────────────────
	// Opt-in and reversible. The Brand Brief editor no longer hijacks the
	// palette while you type, so this select is the ONLY place the app takes
	// on a brand's colors.
	let brandBriefs = $state<Array<{ id: string; name: string; updated_at: string }>>([]);
	let brandThemeChoice = $state<string>(
		data.profile?.preferences?.brandThemeBriefId ?? brandThemeState.briefId ?? ''
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

	type ApiKeyProvider = 'zernio' | 'gemini' | 'openrouter' | 'firecrawl' | 'kie_ai' | 'fal_ai';

	const providerConfigs: Array<{
		provider: ApiKeyProvider;
		label: string;
		description: string;
		optional?: boolean;
		placeholder: string;
	}> = [
		{
			provider: 'zernio',
			label: 'Zernio',
			description: 'Publishing, connections, and analytics for all 15 platforms. Billed per connected account (2 free).',
			placeholder: 'Paste your Zernio API key'
		},
		{
			provider: 'gemini',
			label: 'Gemini',
			description: 'Google Gemini for persona/chat generation — used if no OpenRouter key is set below.',
			optional: true,
			placeholder: 'Paste your Gemini API key'
		},
		{
			provider: 'openrouter',
			label: 'OpenRouter',
			description: 'Optional model routing for persona/chat generation through OpenRouter.',
			placeholder: 'Paste your OpenRouter API key'
		},
		{
			provider: 'firecrawl',
			label: 'Firecrawl',
			description: 'Storefront scraping and JS-rendered page extraction.',
			placeholder: 'Paste your Firecrawl API key'
		},
		{
			provider: 'kie_ai',
			label: 'Kie AI',
			description: 'Optional video/image generation provider for creative assets.',
			optional: true,
			placeholder: 'Paste your Kie AI API key'
		},
		{
			provider: 'fal_ai',
			label: 'Fal AI',
			description: 'Optional fast media generation provider for images/video workflows.',
			optional: true,
			placeholder: 'Paste your Fal AI API key'
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
		const warning = assignedCount
			? `Delete this key? ${assignedCount} persona${assignedCount === 1 ? '' : 's'} will revert to the default Zernio key and need their social accounts reconnected.`
			: 'Delete this Zernio key?';
		if (!confirm(warning)) return;

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
		if (
			!confirm(
				`Move ${agent.name} to ${newKeyId ? `key "${zernioKeys.find((k) => k.id === newKeyId)?.label || 'selected'}"` : 'the default Zernio key'}? Its connected social accounts must be reconnected under that key.`
			)
		) {
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

	// Server metadata is the source of truth; localStorage only fills gaps for
	// values that were never persisted server-side (pre-migration installs).
	onMount(() => {
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
		loadBrandBriefs();
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

<svelte:head>
	<title>Settings — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<h1>Settings</h1>
		<p class="subtitle">Manage your profile, notifications, API keys, and account.</p>
	</header>

	<div class="settings-grid">
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
						<span class="readonly-badge">
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
								><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path
									d="M7 11V7a5 5 0 0110 0v4"
								/></svg
							>
							Read-only
						</span>
					</div>
				</div>
				<button class="save-btn" onclick={saveProfile} disabled={profileSaving}>
					{#if profileSaving}
						<span class="spinner"></span> Saving…
					{:else}
						Save Profile
					{/if}
				</button>
			</div>
		</div>

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
				<div class="provider-key-list">
					{#each providerConfigs as config}
						{@const savedKey = getSavedKey(config.provider)}
						<div class="provider-key-row">
							<div class="provider-key-header">
								<div>
									<strong>{config.label}{config.optional ? ' (Optional)' : ''}</strong>
									<span>{config.description}</span>
								</div>
								{#if savedKey}
									<span class="status-pill" aria-live="polite" class:valid={savedKey.status === 'valid'} class:error={savedKey.status === 'invalid' || savedKey.status === 'error'}>
										<span class="sr-only">{config.label} key status: </span>{savedKey.status}
									</span>
								{:else if apiKeysLoading}
									<span class="status-pill" aria-live="polite"
										><span class="sr-only">{config.label} key status: </span>loading</span
									>
								{:else}
									<span class="status-pill" aria-live="polite"
										><span class="sr-only">{config.label} key status: </span>not saved</span
									>
								{/if}
							</div>

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
									placeholder={savedKey ? 'Paste a new key to replace the saved one' : config.placeholder}
									autocomplete="off"
									aria-invalid={savedKey?.last_error ? 'true' : undefined}
									aria-describedby={savedKey?.last_error
										? `${config.provider}-api-key-error`
										: undefined}
								/>
							</div>

							<div class="provider-actions">
								<button class="save-btn" onclick={() => saveProviderKey(config.provider)} disabled={apiKeySaving[config.provider] || !apiKeyInputs[config.provider]?.trim()}>
									{#if apiKeySaving[config.provider]}
										<span class="spinner"></span> Saving…
									{:else}
										Save Key
									{/if}
								</button>
								<button class="secondary-btn" onclick={() => testProviderKey(config.provider)} disabled={apiKeyTesting[config.provider] || !savedKey}>
									{#if apiKeyTesting[config.provider]}
										<span class="spinner"></span> Testing…
									{:else}
										Test Connection
									{/if}
								</button>
								<button class="danger-inline-btn" onclick={() => deleteProviderKey(config.provider)} disabled={apiKeyDeleting[config.provider] || !savedKey}>
									{#if apiKeyDeleting[config.provider]}
										<span class="spinner"></span> Deleting…
									{:else}
										Delete Key
									{/if}
								</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Zernio Key Manager. id anchors the "add another key" redirect from the
		     persona Connections tab's slot meter (/settings#zernio-keys). -->
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
				<p class="key-hint">
					Add extra Zernio accounts (one per persona email) and assign them to personas. Each key is
					a separate Zernio account with its own <strong>2 free connected-account slots</strong> and
					its own bill. Personas without an assignment use the default Zernio key above. Moving a
					persona to a different key requires reconnecting its social accounts under that key.
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
				<span class="coming-soon-badge">Coming Soon</span>
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
						<p class="billing-title">Subscription management is on the way</p>
						<p class="billing-desc">
							Billing, plan upgrades, and invoice history will be available here soon.
							Your current access is fully active — no action needed.
						</p>
					</div>
				</div>
			</div>
		</div>

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
	</div>
</section>

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
	.page {
		padding: 2rem;
		max-width: 1000px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 2rem;
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

	.settings-grid {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
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
		min-width: 0;
	}

	.assign-agent strong {
		font-size: var(--text-sm);
		white-space: nowrap;
	}

	.assign-agent span {
		font-size: var(--text-xs);
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.assign-select {
		flex-shrink: 0;
		max-width: 55%;
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
