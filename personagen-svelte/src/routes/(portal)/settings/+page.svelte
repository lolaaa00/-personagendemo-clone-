<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: { user?: { email?: string } | null } }>();

	// Profile — email comes from auth session; name persisted in localStorage
	let profileEmail = $derived(data.user?.email ?? '');
	let profileName = $state(data.user?.email?.split('@')[0] ?? 'Account');
	let profileSaving = $state(false);

	// Notifications
	let emailAlerts = $state(true);
	let pushNotifications = $state(false);
	let weeklyReports = $state(true);

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
			description: 'Google Gemini for agent/chat generation — used if no OpenRouter key is set below.',
			optional: true,
			placeholder: 'Paste your Gemini API key'
		},
		{
			provider: 'openrouter',
			label: 'OpenRouter',
			description: 'Optional model routing for agent/chat generation through OpenRouter.',
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

	// Danger
	let showDeleteModal = $state(false);
	let deleteConfirmText = $state('');

	// Load from localStorage
	onMount(() => {
		const stored = localStorage.getItem('personagen_settings');
		if (stored) {
			try {
				const s = JSON.parse(stored);
				if (s.profileName) profileName = s.profileName;
				emailAlerts = s.emailAlerts ?? emailAlerts;
				pushNotifications = s.pushNotifications ?? pushNotifications;
				weeklyReports = s.weeklyReports ?? weeklyReports;
			} catch {
				/* ignore */
			}
		}
		loadApiKeys();
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

	function saveProfile() {
		profileSaving = true;
		setTimeout(() => {
			persistSettings();
			profileSaving = false;
			showToast('Profile updated', 'success');
		}, 400);
	}

	function toggleNotification(key: 'emailAlerts' | 'pushNotifications' | 'weeklyReports') {
		if (key === 'emailAlerts') emailAlerts = !emailAlerts;
		else if (key === 'pushNotifications') pushNotifications = !pushNotifications;
		else weeklyReports = !weeklyReports;
		persistSettings();
		showToast('Notification preference saved', 'success');
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

	function confirmDelete() {
		if (deleteConfirmText === 'DELETE') {
			showDeleteModal = false;
			deleteConfirmText = '';
			showToast('Account deletion requested. This is a demo.', 'info');
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
						stroke="var(--accent)"
						stroke-width="2"><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 10-16 0" /></svg
					>
				</div>
				<h3>Profile</h3>
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
					<input id="profile-name" type="text" bind:value={profileName} />
				</div>
				<div class="field">
					<label for="profile-email">Email Address</label>
					<div class="readonly-field">
						<input id="profile-email" type="email" value={profileEmail} readonly />
						<span class="readonly-badge">
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
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
						stroke="var(--cyan)"
						stroke-width="2"
						><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path
							d="M13.73 21a2 2 0 01-3.46 0"
						/></svg
					>
				</div>
				<h3>Notifications</h3>
			</div>
			<div class="card-body">
				<div class="toggle-row">
					<div class="toggle-info">
						<span class="toggle-label">Email Alerts</span>
						<span class="toggle-desc">Receive alerts about agent activity and engagement</span>
					</div>
					<button
						class="toggle"
						class:on={emailAlerts}
						onclick={() => toggleNotification('emailAlerts')}
					>
						<span class="toggle-knob"></span>
					</button>
				</div>
				<div class="toggle-row">
					<div class="toggle-info">
						<span class="toggle-label">Push Notifications</span>
						<span class="toggle-desc">Browser push for real-time engagement events</span>
					</div>
					<button
						class="toggle"
						class:on={pushNotifications}
						onclick={() => toggleNotification('pushNotifications')}
					>
						<span class="toggle-knob"></span>
					</button>
				</div>
				<div class="toggle-row">
					<div class="toggle-info">
						<span class="toggle-label">Weekly Reports</span>
						<span class="toggle-desc">Performance digest every Monday at 9am</span>
					</div>
					<button
						class="toggle"
						class:on={weeklyReports}
						onclick={() => toggleNotification('weeklyReports')}
					>
						<span class="toggle-knob"></span>
					</button>
				</div>
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
						><path
							d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
						/></svg
					>
				</div>
				<h3>Provider API Keys</h3>
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
									<span class="status-pill" class:valid={savedKey.status === 'valid'} class:error={savedKey.status === 'invalid' || savedKey.status === 'error'}>
										{savedKey.status}
									</span>
								{:else if apiKeysLoading}
									<span class="status-pill">loading</span>
								{:else}
									<span class="status-pill">not saved</span>
								{/if}
							</div>

							{#if savedKey}
								<div class="key-display">
									<code class="key-value">{savedKey.masked_value}</code>
								</div>
								{#if savedKey.last_error}
									<p class="key-error">{savedKey.last_error}</p>
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

		<!-- Billing -->
		<div class="settings-card">
			<div class="card-header">
				<div class="card-icon billing-icon">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
						<rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
						<line x1="1" y1="10" x2="23" y2="10" />
					</svg>
				</div>
				<h3>Billing &amp; Plan</h3>
				<span class="coming-soon-badge">Coming Soon</span>
			</div>
			<div class="card-body">
				<div class="billing-coming-soon">
					<div class="billing-icon-wrap">
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
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
						stroke="var(--error)"
						stroke-width="2"
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
				<h3>Danger Zone</h3>
			</div>
			<div class="card-body">
				<p class="danger-text">
					Permanently delete your account and all associated agents, posts, and data. This action
					cannot be undone.
				</p>
				<button class="delete-btn" onclick={() => (showDeleteModal = true)}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
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

<!-- Delete Modal -->
{#if showDeleteModal}
	<div class="modal-overlay" onclick={() => (showDeleteModal = false)} role="dialog">
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--error)"
					stroke-width="2"
					><path
						d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
					/><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg
				>
				<h3>Delete Account</h3>
			</div>
			<p class="modal-text">
				This will permanently delete your account, all agents, posts, connections, and analytics
				data. This action is <strong>irreversible</strong>.
			</p>
			<div class="modal-field">
				<label for="delete-confirm">Type <strong>DELETE</strong> to confirm</label>
				<input
					id="delete-confirm"
					type="text"
					bind:value={deleteConfirmText}
					placeholder="DELETE"
				/>
			</div>
			<div class="modal-actions">
				<button
					class="cancel-btn"
					onclick={() => {
						showDeleteModal = false;
						deleteConfirmText = '';
					}}>Cancel</button
				>
				<button
					class="confirm-delete-btn"
					onclick={confirmDelete}
					disabled={deleteConfirmText !== 'DELETE'}
				>
					Delete My Account
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
		border-color: rgba(239, 68, 68, 0.15);
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
		border-radius: 10px;
	}

	.danger-icon {
		background: var(--error-soft);
	}

	.card-header h3 {
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
		border-radius: 14px;
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
		background: var(--gradient-subtle);
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
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.status-pill.valid {
		border-color: var(--success);
		color: var(--success);
	}

	.status-pill.error {
		border-color: var(--error);
		color: var(--error);
	}

	.key-error {
		margin: -0.35rem 0 1rem;
		font-size: var(--text-xs);
		color: var(--error);
		line-height: 1.5;
	}

	.provider-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.secondary-btn,
	.danger-inline-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.1rem;
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
		border: 1px solid rgba(239, 68, 68, 0.35);
		color: var(--error);
	}

	.danger-inline-btn:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.08);
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
		border-radius: 999px;
		border: 1px solid var(--accent-mid);
		color: var(--accent);
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
		border-radius: 14px;
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
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
		background: var(--error-soft);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: var(--radius-sm);
		color: var(--error);
		font-weight: 600;
		font-size: var(--text-base);
		cursor: pointer;
		transition: background 0.2s ease;
		font-family: var(--font-body);
	}

	.delete-btn:hover {
		background: rgba(239, 68, 68, 0.2);
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

	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
		max-width: 460px;
		width: 100%;
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

	.modal-header h3 {
		font-size: var(--text-lg);
		font-family: var(--font-display);
		color: var(--error);
	}

	.modal-text {
		font-size: var(--text-sm);
		color: var(--text-muted);
		line-height: 1.6;
		margin-bottom: 1.25rem;
	}

	.modal-text strong {
		color: var(--error);
	}

	.modal-field {
		margin-bottom: 1.5rem;
	}

	.modal-field label strong {
		color: var(--error);
		font-family: var(--font-mono);
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.cancel-btn {
		padding: 0.6rem 1.25rem;
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
		padding: 0.6rem 1.25rem;
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
