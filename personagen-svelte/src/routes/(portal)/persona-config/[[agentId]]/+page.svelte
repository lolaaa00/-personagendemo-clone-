<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { showToast } from '$lib/stores/ui.svelte';
	import type { AutonomyLevel } from '$lib/types';
	import { AUTONOMY_LABELS } from '$lib/types';
	import { Accounts } from '$lib/services/api';
	import AgentConnectionStats from '$lib/components/agents/AgentConnectionStats.svelte';
	import { slide } from 'svelte/transition';

	let { data }: { data: any } = $props();
	let agents = $state<any[]>([]);

	$effect(() => {
		if (data.agents) {
			agents = [...data.agents];
		}
	});

	let selectedAgentId = $state<string | null>(null);
	let activeTab = $state<
		'accounts' | 'soul' | 'skills' | 'tools' | 'heartbeat' | 'autonomy' | 'rss' | 'settings'
	>('accounts');

	// Agent identity settings state
	let editName = $state('');
	let editHandle = $state('');
	let editStatus = $state<'active' | 'paused' | 'pending'>('active');
	let editNiche = $state('');
	let editInitial = $state('');
	let editFollowers = $state('0');
	let editEngagementRate = $state(5.2);
	let editGradient = $state('');
	let editSupervisorId = $state<string | null>(null);
	let editRuntimeOwner = $state<'svelte-gemini' | 'hermes-daemon' | 'hermes-orchestrated'>(
		'svelte-gemini'
	);

	let supervisors = $derived(data.supervisors || []);

	// Dynamic platform-specific metrics mapping
	const platformMetrics: Record<string, { followers: number; engagement: number }> = {
		tiktok: { followers: 120300, engagement: 6.2 },
		instagram: { followers: 24500, engagement: 4.8 },
		youtube: { followers: 50000, engagement: 3.5 },
		facebook: { followers: 15000, engagement: 1.2 }
	};

	// Compute followers & engagement dynamically from platformStatuses
	const computedMetrics = $derived.by(() => {
		let totalFollowers = 0;
		let totalEngRate = 0;
		let connectedCount = 0;

		for (const p of PLATFORMS) {
			const status = platformStatuses[p.key];
			if (status?.connected) {
				const metrics = platformMetrics[p.key];
				const followers = status.followers ?? metrics?.followers ?? 0;
				const engagement = status.engagement_rate ?? metrics?.engagement ?? 0.0;
				totalFollowers += followers;
				totalEngRate += engagement;
				connectedCount++;
			}
		}

		const avgEngRate =
			connectedCount > 0 ? parseFloat((totalEngRate / connectedCount).toFixed(1)) : 0.0;

		let followersStr = '0';
		if (totalFollowers >= 1000000) {
			followersStr = (totalFollowers / 1000000).toFixed(1) + 'M';
		} else if (totalFollowers >= 1000) {
			followersStr = (totalFollowers / 1000).toFixed(1) + 'K';
		} else {
			followersStr = String(totalFollowers);
		}

		return {
			followers: followersStr,
			followersRaw: totalFollowers,
			engagementRate: avgEngRate,
			connectedCount
		};
	});

	// Sync state values automatically to computed dynamic metrics
	$effect(() => {
		if (selectedAgentId) {
			editFollowers = computedMetrics.followers;
			editEngagementRate = computedMetrics.engagementRate;
		}
	});

	$effect(() => {
		const paramAgentId = $page.params.agentId || $page.url.searchParams.get('agentId');
		if (paramAgentId) {
			const agentExists = agents.some((a) => a.id === paramAgentId);
			if (agentExists && selectedAgentId !== paramAgentId) {
				selectAgent(paramAgentId);
			}
		} else if (agents.length > 0 && !selectedAgentId) {
			const activeAgents = agents.filter((a) => a.status === 'active');
			if (activeAgents.length > 0) {
				selectAgent(activeAgents[0].id);
			}
		}
	});

	// Config state
	let soulText = $state('');
	let skillsText = $state('');
	let toolsText = $state('');
	let timezone = $state('Australia/Sydney');
	let postsPerDay = $state(3);
	let activeHoursStart = $state(8);
	let activeHoursEnd = $state(22);
	let autonomyLevel = $state<AutonomyLevel>('advisor');
	let rssUrl = $state('');
	let rssActive = $state(false);
	let rssLastPolledAt = $state<string | null>(null);
	let saving = $state(false);

	const timezones = [
		{ value: 'Australia/Sydney', label: 'Sydney (AEST)' },
		{ value: 'Australia/Melbourne', label: 'Melbourne (AEST)' },
		{ value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
		{ value: 'Australia/Perth', label: 'Perth (AWST)' },
		{ value: 'Australia/Adelaide', label: 'Adelaide (ACST)' },
		{ value: 'Australia/Hobart', label: 'Hobart (AEST)' },
		{ value: 'Australia/Darwin', label: 'Darwin (ACST)' },
		{ value: 'Australia/Canberra', label: 'Canberra (AEST)' }
	];

	const tabs = [
		{ id: 'accounts' as const, label: 'Connected Accounts', icon: '🔗' },
		{ id: 'soul' as const, label: 'Soul', icon: '✦' },
		{ id: 'skills' as const, label: 'Skills', icon: '⚙' },
		{ id: 'tools' as const, label: 'Tools', icon: '🔧' },
		{ id: 'heartbeat' as const, label: 'Heartbeat', icon: '💓' },
		{ id: 'autonomy' as const, label: 'Autonomy', icon: '🤖' },
		{ id: 'rss' as const, label: 'RSS Feed', icon: '📰' },
		{ id: 'settings' as const, label: 'Agent Settings', icon: '⚙️' }
	];

	const autonomyKeys: AutonomyLevel[] = ['advisor', 'semi_autonomous', 'fully_autonomous'];

	let selectedAgent = $derived(agents.find((a: any) => a.id === selectedAgentId));

	function storageKey(agentId: string) {
		return `personagen_agent_config_${agentId}`;
	}

	function loadConfig(agentId: string) {
		const agent = agents.find((a: any) => a.id === agentId);
		if (!agent) return;

		// First try database values loaded in server data
		if (agent.timezone !== undefined) {
			soulText = agent.soul ?? '';
			skillsText = agent.skills ?? '';
			toolsText = agent.tools ?? '';
			timezone = agent.timezone ?? 'Australia/Sydney';
			postsPerDay = agent.posts_per_day ?? 3;
			activeHoursStart = agent.active_hours_start ?? 8;
			activeHoursEnd = agent.active_hours_end ?? 22;
			autonomyLevel = agent.autonomy_level ?? 'advisor';
			rssUrl = agent.rss_url ?? '';
			rssActive = agent.rss_active ?? false;
			rssLastPolledAt = agent.rss_last_polled_at ?? null;

			// Identity settings fields
			editName = agent.name ?? '';
			editHandle = agent.handle ?? '';
			editStatus = agent.status ?? 'active';
			editNiche = agent.niche ?? '';
			editInitial = agent.initial ?? '';
			editFollowers = String(agent.followers ?? '0');
			editEngagementRate =
				parseFloat(agent.engagement_rate as any) || parseFloat(agent.engagementRate as any) || 5.2;
			editGradient = agent.gradient ?? 'linear-gradient(135deg, #7C3AED, #4F46E5)';
			editSupervisorId = agent.supervisor_agent_id ?? null;
			editRuntimeOwner = agent.runtime_owner ?? 'svelte-gemini';

			// Sync local storage cache
			localStorage.setItem(
				storageKey(agentId),
				JSON.stringify({
					soul: soulText,
					skills: skillsText,
					tools: toolsText,
					timezone,
					postsPerDay,
					activeHoursStart,
					activeHoursEnd,
					autonomyLevel,
					rssUrl,
					rssActive,
					rssLastPolledAt
				})
			);
			return;
		}

		// Otherwise fallback to localStorage
		const stored = localStorage.getItem(storageKey(agentId));
		if (stored) {
			try {
				const cfg = JSON.parse(stored);
				soulText = cfg.soul ?? agent.soul ?? '';
				skillsText = cfg.skills ?? agent.skills ?? '';
				toolsText = cfg.tools ?? agent.tools ?? '';
				timezone = cfg.timezone ?? 'Australia/Sydney';
				postsPerDay = cfg.postsPerDay ?? 3;
				activeHoursStart = cfg.activeHoursStart ?? 8;
				activeHoursEnd = cfg.activeHoursEnd ?? 22;
				autonomyLevel = cfg.autonomyLevel ?? 'advisor';
				rssUrl = cfg.rssUrl ?? agent.rss_url ?? '';
				rssActive = cfg.rssActive ?? agent.rss_active ?? false;
				rssLastPolledAt = cfg.rssLastPolledAt ?? agent.rss_last_polled_at ?? null;

				editName = agent.name ?? '';
				editHandle = agent.handle ?? '';
				editStatus = agent.status ?? 'active';
				editNiche = agent.niche ?? '';
				editInitial = agent.initial ?? '';
				editFollowers = String(agent.followers ?? '0');
				editEngagementRate =
					parseFloat(agent.engagement_rate as any) ||
					parseFloat(agent.engagementRate as any) ||
					5.2;
				editGradient = agent.gradient ?? 'linear-gradient(135deg, #7C3AED, #4F46E5)';
				return;
			} catch {
				/* fall through */
			}
		}

		soulText = agent.soul ?? '';
		skillsText = agent.skills ?? '';
		toolsText = agent.tools ?? '';
		timezone = 'Australia/Sydney';
		postsPerDay = 3;
		activeHoursStart = 8;
		activeHoursEnd = 22;
		autonomyLevel = 'advisor';
		rssUrl = agent.rss_url ?? '';
		rssActive = agent.rss_active ?? false;
		rssLastPolledAt = agent.rss_last_polled_at ?? null;

		editName = agent.name ?? '';
		editHandle = agent.handle ?? '';
		editStatus = agent.status ?? 'active';
		editNiche = agent.niche ?? '';
		editInitial = agent.initial ?? '';
		editFollowers = String(agent.followers ?? '0');
		editEngagementRate =
			parseFloat(agent.engagement_rate as any) || parseFloat(agent.engagementRate as any) || 5.2;
		editGradient = agent.gradient ?? 'linear-gradient(135deg, #7C3AED, #4F46E5)';
		editSupervisorId = agent.supervisor_agent_id ?? null;
		editRuntimeOwner = agent.runtime_owner ?? 'svelte-gemini';
	}

	function selectAgent(id: string) {
		selectedAgentId = id;
		activeTab = 'accounts';
		loadConfig(id);
	}

	let statusLoading = $state(false);
	let connectingPlatform = $state('');

	const PLATFORMS = [
		{ key: 'tiktok', name: 'TikTok', color: '#fe2c55' },
		{ key: 'instagram', name: 'Instagram', color: '#e1306c' },
		{ key: 'youtube', name: 'YouTube', color: '#ff0000' },
		{ key: 'facebook', name: 'Facebook', color: '#1877f2' }
	] as const;

	interface PlatformStatus {
		connected: boolean;
		configured?: boolean;
		status?: string;
		handle?: string;
		verified?: boolean;
		lastSync?: string;
		lastError?: string;
		followers?: number;
		engagement_rate?: number;
	}

	let platformStatuses = $state<Record<string, PlatformStatus>>({});
	let collapsedPlatforms = $state<Record<string, boolean>>({});

	const visiblePlatforms = $derived(PLATFORMS);

	$effect(() => {
		if (selectedAgentId) {
			checkStatuses();
			collapsedPlatforms = {};
		} else {
			platformStatuses = {};
			collapsedPlatforms = {};
		}
	});

	async function checkStatuses() {
		if (!selectedAgentId) return;
		statusLoading = true;
		try {
			const res = await Accounts.checkStatus(selectedAgentId);
			if (res.success && res.data) {
				const statusData = res.data as Record<string, PlatformStatus>;
				platformStatuses = statusData;
			} else {
				// API not connected — set all disconnected
				platformStatuses = {};
				PLATFORMS.forEach((p) => {
					platformStatuses[p.key] = { connected: false };
				});
			}
		} catch {
			platformStatuses = {};
			PLATFORMS.forEach((p) => {
				platformStatuses[p.key] = { connected: false };
			});
		}
		statusLoading = false;
	}

	async function connectPlatform(platform: string) {
		if (!selectedAgentId) return;
		const currentStatus = platformStatuses[platform];
		if (currentStatus?.configured === false) {
			showToast(`${platform} is not configured yet`, 'warning');
			return;
		}
		connectingPlatform = platform;
		try {
			const res = await Accounts.initConnection(selectedAgentId, platform);
			if (res.success) {
				showToast(`Connection initiated for ${platform}`, 'success');
				const redirectUrl = (res.data as any)?.redirect_url;
				if (redirectUrl) {
					showToast(`Opening authentication for ${platform}...`, 'info');
					window.open(redirectUrl, '_blank');
				}
				await checkStatuses();
			} else {
				showToast(res.error || `Failed to connect ${platform}`, 'error');
			}
		} catch {
			showToast(`Unable to reach API — ${platform} connection unavailable`, 'warning');
		}
		connectingPlatform = '';
	}

	async function disconnectPlatform(platform: string) {
		if (!selectedAgentId) return;
		try {
			const res = await Accounts.disconnect(selectedAgentId, platform);
			if (res.success) {
				showToast(`Disconnected ${platform}`, 'info');
				platformStatuses[platform] = { connected: false };
			} else {
				showToast(res.error || `Failed to disconnect ${platform}`, 'error');
			}
		} catch {
			showToast('Unable to reach API', 'warning');
		}
	}

	async function setMainHandle(handle: string) {
		if (!selectedAgentId) return;
		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentId: selectedAgentId, handle })
			});
			const data = (await res.json()) as any;
			if (res.ok && data.success) {
				const agent = agents.find((a: any) => a.id === selectedAgentId);
				if (agent) {
					agent.handle = handle;
				}
				editHandle = handle;
				showToast(`Main handle updated to ${handle}`, 'success');
			} else {
				showToast(data.error || 'Failed to update main handle', 'error');
			}
		} catch (err) {
			console.error('Failed to set main handle:', err);
			showToast('Error updating main handle', 'error');
		}
	}

	function formatSyncTime(iso?: string): string {
		if (!iso) return 'Never';
		const d = new Date(iso);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMin = Math.floor(diffMs / 60000);
		if (diffMin < 1) return 'Just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDay = Math.floor(diffHr / 24);
		return `${diffDay}d ago`;
	}

	async function saveCurrentTab() {
		if (!selectedAgentId) return;
		saving = true;

		const payload = {
			agentId: selectedAgentId,
			soulText,
			skillsText,
			toolsText,
			timezone,
			postsPerDay,
			activeHoursStart,
			activeHoursEnd,
			autonomyLevel,
			rssUrl,
			rssActive,
			// Identity settings fields
			name: editName,
			handle: editHandle,
			status: editStatus,
			niche: editNiche,
			gradient: editGradient,
			initial: editInitial,
			followers: editFollowers,
			engagementRate: editEngagementRate,
			supervisorAgentId: editSupervisorId,
			runtimeOwner: editRuntimeOwner
		};

		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = (await res.json()) as any;
			if (!res.ok || !data.success) {
				throw new Error(data.error || 'Server error');
			}

			// Also update agent in local state so the UI reflects it immediately
			const agent = agents.find((a: any) => a.id === selectedAgentId);
			if (agent) {
				agent.soul = soulText;
				agent.skills = skillsText;
				agent.tools = toolsText;
				agent.timezone = timezone;
				agent.posts_per_day = postsPerDay;
				agent.active_hours_start = activeHoursStart;
				agent.active_hours_end = activeHoursEnd;
				agent.autonomy_level = autonomyLevel;
				agent.rss_url = rssUrl;
				agent.rss_active = rssActive;
				// Settings fields
				agent.name = editName;
				agent.handle = editHandle;
				agent.status = editStatus;
				agent.niche = editNiche;
				agent.gradient = editGradient;
				agent.initial = editInitial;
				agent.followers = editFollowers;
				agent.engagement_rate = editEngagementRate;
				agent.engagementRate = editEngagementRate;
				agent.supervisor_agent_id = editSupervisorId;
				agent.runtime_owner = editRuntimeOwner;
			}

			showToast(
				`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} config saved for ${selectedAgent?.name}`,
				'success'
			);
		} catch (err) {
			console.error('Failed to save config:', err);
			// Fallback to localStorage for development bypass/offline
			localStorage.setItem(
				storageKey(selectedAgentId),
				JSON.stringify({
					soul: soulText,
					skills: skillsText,
					tools: toolsText,
					timezone,
					postsPerDay: postsPerDay,
					activeHoursStart: activeHoursStart,
					activeHoursEnd: activeHoursEnd,
					autonomyLevel: autonomyLevel,
					rssUrl,
					rssActive,
					rssLastPolledAt
				})
			);
			showToast(`Saved locally (offline) for ${selectedAgent?.name}`, 'warning');
		} finally {
			saving = false;
		}
	}

	async function deleteAgentPersona() {
		if (!selectedAgentId) return;
		const confirmed = confirm(
			`Are you sure you want to permanently delete "${selectedAgent?.name}"? All database configs and social connection metrics will be completely removed. This action cannot be undone.`
		);
		if (!confirmed) return;

		try {
			const res = await fetch(`/api/agents/config`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentId: selectedAgentId })
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || 'Failed to delete agent');
			}

			showToast(`Successfully deleted agent "${selectedAgent?.name}"`, 'success');

			// Remove from reactive state
			agents = agents.filter((a: any) => a.id !== selectedAgentId);

			// Clear selected agent state and navigate back
			selectedAgentId = null;
			goto('/persona-config');
		} catch (err: any) {
			console.error('Failed to delete agent:', err);
			showToast(err.message || 'Error deleting agent', 'error');
		}
	}

	function formatHour(h: number): string {
		const ampm = h >= 12 ? 'PM' : 'AM';
		const hour = h % 12 || 12;
		return `${hour}:00 ${ampm}`;
	}

	function getStatusColor(status: string): string {
		if (status === 'active') return 'var(--success)';
		if (status === 'paused') return 'var(--warning)';
		return 'var(--text-dim)';
	}
</script>

<svelte:head>
	<title>Persona Config — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<h1>Persona <span class="grad">Config</span></h1>
		<p class="subtitle">
			Configure your AI agent's personality, skills, tools, schedule, and autonomy level
		</p>
	</header>

	<!-- Agent Selector Grid -->
	<div class="agent-grid">
		{#each agents.filter((a) => a.status === 'active') as agent (agent.id)}
			<button
				class="agent-card"
				class:selected={selectedAgentId === agent.id}
				onclick={() => selectAgent(agent.id)}
			>
				<div class="agent-avatar" style="background: {agent.gradient}">
					<span>{agent.initial}</span>
				</div>
				<div class="agent-info">
					<span class="agent-name">{agent.name}</span>
					<span class="agent-handle">{agent.handle}</span>
				</div>
				<span class="agent-status" style="color: {getStatusColor(agent.status)}">
					<span class="status-dot" style="background: {getStatusColor(agent.status)}"></span>
					{agent.status}
				</span>
			</button>
		{/each}
	</div>

	<!-- Config Editor -->
	{#if selectedAgent}
		<div class="config-editor">
			<!-- Tab Navigation -->
			<nav class="tab-nav">
				{#each tabs as tab (tab.id)}
					<button
						class="tab-btn"
						class:active={activeTab === tab.id}
						onclick={() => (activeTab = tab.id)}
					>
						<span class="tab-icon">{tab.icon}</span>
						{tab.label}
					</button>
				{/each}
			</nav>

			<!-- Tab Content -->
			<div class="tab-content">
				{#if activeTab === 'accounts'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Connected Accounts</h3>
							<p class="panel-desc">
								Manage social platform connections for <strong>{selectedAgent.name}</strong>.
							</p>
						</div>

						{#if statusLoading}
							<div class="loading-bar">
								<div class="loading-bar-inner"></div>
							</div>
						{/if}

						<div
							class="accounts-controls"
							style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background: rgba(255, 255, 255, 0.02); padding: 0.75rem 1.25rem; border-radius: var(--radius); border: 1px solid var(--border); gap: 1rem; flex-wrap: wrap;"
						>
							<div
								style="display: flex; align-items: center; gap: 0.5rem; font-size: var(--text-sm); font-weight: 500; color: var(--text-muted);"
							>
								<span
									style="background: var(--accent-soft); color: var(--accent); font-weight: 700; padding: 2px 8px; border-radius: 20px; font-size: 11px;"
									>{computedMetrics.connectedCount} / {PLATFORMS.length}</span
								>
								<span>Active Connections</span>
							</div>

							<!-- Compact inline connect buttons for disconnected platforms -->
							<div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
								{#each PLATFORMS as platform}
									{@const status = platformStatuses[platform.key]}
									{#if !status?.connected}
										<button
											type="button"
											class="connect-inline-btn"
											disabled={connectingPlatform === platform.key || status?.configured === false}
											onclick={() => connectPlatform(platform.key)}
											style="font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; transition: all 0.2s;"
											onmouseover={(e) => {
												if (!e.currentTarget.disabled) {
													e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
													e.currentTarget.style.borderColor = 'var(--accent)';
													e.currentTarget.style.color = 'var(--text)';
												}
											}}
											onmouseout={(e) => {
												e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
												e.currentTarget.style.borderColor = 'var(--border)';
												e.currentTarget.style.color = 'var(--text-muted)';
											}}
										>
											{#if connectingPlatform === platform.key}
												Connecting…
											{:else}
												+ Connect {platform.name}
											{/if}
										</button>
									{/if}
								{/each}
							</div>
						</div>

						{#if computedMetrics.connectedCount === 0}
							<div style="padding: 2.5rem; text-align: center; border: 1px dashed var(--border); border-radius: var(--radius); background: rgba(255, 255, 255, 0.01); margin-bottom: 1.5rem;">
								<span style="font-size: 24px; display: block; margin-bottom: 0.5rem;">🔌</span>
								<p style="color: var(--text-dim); font-size: var(--text-sm); margin: 0;">No active channel connections. Click one of the connect buttons above to link a platform.</p>
							</div>
						{:else}
							<div class="platforms-grid">
								{#each visiblePlatforms.filter((p) => platformStatuses[p.key]?.connected) as platform}
									{@const status = platformStatuses[platform.key]}
									{@const metrics = platformMetrics[platform.key]}
									{@const isConfigured = status?.configured !== false}
									<div
										class="platform-card"
										class:connected={status?.connected}
										style="--platform-color: {platform.color}"
									>
										<div
											class="platform-header"
											style="display: flex; align-items: center; width: 100%;"
										>
											<div class="platform-icon">
												{#if platform.key === 'tiktok'}
													<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
														><path
															d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.89a8.1 8.1 0 004.77 1.54V7.01a4.85 4.85 0 01-1-.32z"
															fill={platform.color}
														/></svg
													>
												{:else if platform.key === 'instagram'}
													<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
														><rect
															x="2"
															y="2"
															width="20"
															height="20"
															rx="5"
															stroke={platform.color}
															stroke-width="1.8"
														/><circle
															cx="12"
															cy="12"
															r="5"
															stroke={platform.color}
															stroke-width="1.8"
														/><circle cx="17.5" cy="6.5" r="1.5" fill={platform.color} /></svg
													>
												{:else if platform.key === 'youtube'}
													<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
														><path
															d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29.94 29.94 0 001 12a29.94 29.94 0 00.46 5.58 2.78 2.78 0 001.94 2c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29.94 29.94 0 0023 12a29.94 29.94 0 00-.46-5.58z"
															fill={platform.color}
														/><path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="#fff" /></svg
													>
												{:else if platform.key === 'facebook'}
													<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
														><path
															d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.875V12h3.328l-.532 3.47h-2.796v8.384C19.612 22.954 24 17.99 24 12z"
															fill={platform.color}
														/></svg
													>
												{/if}
											</div>
											<div
												class="platform-name-wrap"
												style="display: flex; align-items: center; gap: 0.5rem;"
											>
												<span class="platform-name">{platform.name}</span>
												<span class="status-dot" class:on={status?.connected}></span>
												{#if !isConfigured && !status?.connected}
													<span
														style="font-size: 10px; color: var(--warning); text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08); border-radius: 999px; padding: 2px 7px; font-weight: 700;"
														>Not configured</span
													>
												{:else if status?.status === 'provider_unavailable'}
													<span
														style="font-size: 10px; color: var(--warning); text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08); border-radius: 999px; padding: 2px 7px; font-weight: 700;"
														>Sync stale</span
													>
												{:else if status?.status === 'reauth_required'}
													<span
														style="font-size: 10px; color: var(--error); text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.08); border-radius: 999px; padding: 2px 7px; font-weight: 700;"
														>Reconnect</span
													>
												{/if}
											</div>

											<!-- Platform Header Actions (Collapse + Remove) -->
											<div
												class="platform-header-actions"
												style="margin-left: auto; display: flex; align-items: center; gap: 0.5rem;"
											>
												<!-- Expand/Collapse Button -->
												<button
													type="button"
													onclick={() =>
														(collapsedPlatforms[platform.key] = !collapsedPlatforms[platform.key])}
													style="background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.2s ease, transform 0.2s ease; transform: rotate({collapsedPlatforms[
														platform.key
													]
														? '180deg'
														: '0deg'}); outline: none;"
													title={collapsedPlatforms[platform.key] ? 'Expand' : 'Collapse'}
													onmouseover={(e) => (e.currentTarget.style.color = 'var(--text)')}
													onmouseout={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
												>
													<svg
														width="18"
														height="18"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2.5"
														stroke-linecap="round"
														stroke-linejoin="round"><polyline points="18 15 12 9 6 15" /></svg
													>
												</button>
											</div>
										</div>

										{#if !collapsedPlatforms[platform.key]}
											<div class="platform-body" transition:slide={{ duration: 250 }}>
												{#if status?.connected}
													{@const followers = status?.followers ?? metrics?.followers ?? 0}
													{@const engagement = status?.engagement_rate ?? metrics?.engagement ?? 0.0}
													<div class="connected-info">
														<div
															class="handle-row"
															style="display: flex; align-items: center; gap: 0.5rem;"
														>
															<span class="handle">{status.handle || '@connected'}</span>
															{#if status.verified}
																<svg
																	class="verified-badge"
																	width="16"
																	height="16"
																	viewBox="0 0 24 24"
																	fill="var(--cyan)"
																	><path
																		d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 12c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
																		stroke="var(--cyan)"
																		stroke-width="1.5"
																		fill="none"
																	/><path
																		d="M9 12l2 2 4-4"
																		stroke="var(--cyan)"
																		stroke-width="2"
																		fill="none"
																		stroke-linecap="round"
																		stroke-linejoin="round"
																	/></svg
																>
															{/if}

															<!-- Favorite Star button -->
															{#if status.handle}
																{@const isMain = selectedAgent.handle === status.handle}
																<button
																	type="button"
																	onclick={() => setMainHandle(status.handle!)}
																	style="background: none; border: none; cursor: pointer; padding: 2px; display: inline-flex; align-items: center; justify-content: center; transition: transform 0.2s ease, color 0.2s ease; outline: none; margin-left: 2px;"
																	title={isMain ? 'Main Agent Handle' : 'Set as Main Handle'}
																	onmouseover={(e) =>
																		(e.currentTarget.style.transform = 'scale(1.2)')}
																	onmouseout={(e) => (e.currentTarget.style.transform = 'scale(1)')}
																>
																	{#if isMain}
																		<svg
																			width="16"
																			height="16"
																			viewBox="0 0 24 24"
																			fill="#F59E0B"
																			stroke="#F59E0B"
																			stroke-width="2"
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			style="filter: drop-shadow(0 0 4px rgba(245, 158, 11, 0.6));"
																		>
																			<polygon
																				points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
																			/>
																		</svg>
																	{:else}
																		<svg
																			width="16"
																			height="16"
																			viewBox="0 0 24 24"
																			fill="none"
																			stroke="var(--text-dim)"
																			stroke-width="2"
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			class="star-outline"
																			onmouseover={(e) =>
																				e.currentTarget.setAttribute('stroke', '#F59E0B')}
																			onmouseout={(e) =>
																				e.currentTarget.setAttribute('stroke', 'var(--text-dim)')}
																		>
																			<polygon
																				points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
																			/>
																		</svg>
																	{/if}
																</button>
															{/if}
														</div>
														<span class="sync-time">Last sync: {formatSyncTime(status.lastSync)}</span
														>

														<!-- Individual Platform Stats -->
														<div
															class="platform-stats-badge-row"
															style="display: flex; gap: 0.5rem; margin-top: 0.75rem;"
														>
															<span
																style="font-size: 11px; background: rgba(255,255,255,0.05); color: var(--text-dim); padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,0.08); font-weight: 500;"
															>
																👥 {followers >= 1000
																	? (followers / 1000).toFixed(1) + 'K'
																	: followers} followers
															</span>
															<span
																style="font-size: 11px; background: rgba(255,255,255,0.05); color: var(--text-dim); padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,0.08); font-weight: 500;"
															>
																⚡ {engagement}% eng
															</span>
														</div>
													</div>
													<button
														class="btn-disconnect"
														onclick={() => disconnectPlatform(platform.key)}
													>
														<svg
															width="14"
															height="14"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
															><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg
														>
														Disconnect
													</button>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{:else if activeTab === 'soul'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Soul Definition</h3>
							<p class="panel-desc">
								Define the core personality, voice, values, and behavioral directives for <strong
									>{selectedAgent.name}</strong
								>.
							</p>
						</div>
						<textarea
							class="config-textarea"
							bind:value={soulText}
							placeholder="Define your agent's personality, voice, and behavioral directives..."
							rows="20"
						></textarea>
						<div class="panel-actions">
							<button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
								{#if saving}
									<span class="spinner"></span> Saving…
								{:else}
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path
											d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
										/><polyline points="17 21 17 13 7 13 7 21" /><polyline
											points="7 3 7 8 15 8"
										/></svg
									>
									Save Soul
								{/if}
							</button>
						</div>
					</div>
				{:else if activeTab === 'skills'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Skills & Capabilities</h3>
							<p class="panel-desc">
								Define what <strong>{selectedAgent.name}</strong> can do — content skills, scouting, learning
								loops.
							</p>
						</div>
						<textarea
							class="config-textarea"
							bind:value={skillsText}
							placeholder="Define your agent's skills, capabilities, and learning loop..."
							rows="20"
						></textarea>
						<div class="panel-actions">
							<button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
								{#if saving}
									<span class="spinner"></span> Saving…
								{:else}
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path
											d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
										/><polyline points="17 21 17 13 7 13 7 21" /><polyline
											points="7 3 7 8 15 8"
										/></svg
									>
									Save Skills
								{/if}
							</button>
						</div>
					</div>
				{:else if activeTab === 'tools'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Tool Configuration</h3>
							<p class="panel-desc">
								Configure platforms, integrations, and capability layers for <strong
									>{selectedAgent.name}</strong
								>.
							</p>
						</div>
						<textarea
							class="config-textarea"
							bind:value={toolsText}
							placeholder="Configure connected platforms, integrations, and capabilities..."
							rows="20"
						></textarea>
						<div class="panel-actions">
							<button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
								{#if saving}
									<span class="spinner"></span> Saving…
								{:else}
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path
											d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
										/><polyline points="17 21 17 13 7 13 7 21" /><polyline
											points="7 3 7 8 15 8"
										/></svg
									>
									Save Tools
								{/if}
							</button>
						</div>
					</div>
				{:else if activeTab === 'heartbeat'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Heartbeat Schedule</h3>
							<p class="panel-desc">
								Configure posting schedule, timezone, and active hours for <strong
									>{selectedAgent.name}</strong
								>.
							</p>
						</div>
						<div class="heartbeat-grid">
							<div class="field-group">
								<label for="tz-select">Timezone</label>
								<select id="tz-select" bind:value={timezone}>
									{#each timezones as tz (tz.value)}
										<option value={tz.value}>{tz.label}</option>
									{/each}
								</select>
							</div>

							<div class="field-group">
								<label for="ppd-slider"
									>Posts Per Day: <strong class="accent-val">{postsPerDay}</strong></label
								>
								<div class="slider-wrap">
									<span class="slider-label">1</span>
									<input
										id="ppd-slider"
										type="range"
										min="1"
										max="10"
										step="1"
										bind:value={postsPerDay}
									/>
									<span class="slider-label">10</span>
								</div>
							</div>

							<div class="field-group">
								<label>Active Hours</label>
								<div class="hours-row">
									<div class="hour-input">
										<span class="hour-label">Start</span>
										<select bind:value={activeHoursStart}>
											{#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
												<option value={h}>{formatHour(h)}</option>
											{/each}
										</select>
									</div>
									<span class="hour-sep">→</span>
									<div class="hour-input">
										<span class="hour-label">End</span>
										<select bind:value={activeHoursEnd}>
											{#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
												<option value={h}>{formatHour(h)}</option>
											{/each}
										</select>
									</div>
								</div>
							</div>

							<div class="field-group full-width">
								<label>Schedule Preview</label>
								<div class="schedule-preview">
									<div class="hour-bar">
										{#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
											<div
												class="hour-block"
												class:active-hour={h >= activeHoursStart && h < activeHoursEnd}
												title={formatHour(h)}
											>
												{#if h % 6 === 0}
													<span class="hour-tick">{formatHour(h)}</span>
												{/if}
											</div>
										{/each}
									</div>
									<p class="preview-text">
										{postsPerDay} posts spread across {activeHoursEnd - activeHoursStart}h active
										window in {timezones.find((t) => t.value === timezone)?.label ?? timezone}
									</p>
								</div>
							</div>
						</div>
						<div class="panel-actions">
							<button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
								{#if saving}
									<span class="spinner"></span> Saving…
								{:else}
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path
											d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
										/><polyline points="17 21 17 13 7 13 7 21" /><polyline
											points="7 3 7 8 15 8"
										/></svg
									>
									Save Heartbeat
								{/if}
							</button>
						</div>
					</div>
				{:else if activeTab === 'autonomy'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Autonomy Level</h3>
							<p class="panel-desc">
								Choose how much independence <strong>{selectedAgent.name}</strong> has when creating and
								publishing content.
							</p>
						</div>
						<div class="autonomy-cards">
							{#each autonomyKeys as level (level)}
								{@const meta = AUTONOMY_LABELS[level]}
								<button
									class="autonomy-card"
									class:selected={autonomyLevel === level}
									onclick={() => (autonomyLevel = level)}
								>
									<div class="autonomy-radio">
										<div class="radio-outer">
											{#if autonomyLevel === level}
												<div class="radio-inner"></div>
											{/if}
										</div>
									</div>
									<div class="autonomy-body">
										<span class="autonomy-icon">{meta.icon}</span>
										<span class="autonomy-label">{meta.label}</span>
										<p class="autonomy-desc">{meta.description}</p>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{:else if activeTab === 'rss'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Content Sourcing & Mode Settings</h3>
							<p class="panel-desc">
								Configure how <strong>{selectedAgent.name}</strong> creates posts: autonomously from their
								core persona, or auto-repurposed from an RSS Feed.
							</p>
						</div>

						<div
							class="mode-cards"
							style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; margin-bottom: 2rem;"
						>
							<button
								type="button"
								class="autonomy-card"
								class:selected={!rssActive}
								onclick={() => (rssActive = false)}
							>
								<div class="autonomy-radio">
									<div class="radio-outer">
										{#if !rssActive}
											<div class="radio-inner"></div>
										{/if}
									</div>
								</div>
								<div class="autonomy-body">
									<span class="autonomy-icon">✨</span>
									<span class="autonomy-label">Dynamic Generation</span>
									<p class="autonomy-desc">
										Generate original content from niche concepts, current trends, and core persona
										instructions.
									</p>
								</div>
							</button>

							<button
								type="button"
								class="autonomy-card"
								class:selected={rssActive}
								onclick={() => (rssActive = true)}
							>
								<div class="autonomy-radio">
									<div class="radio-outer">
										{#if rssActive}
											<div class="radio-inner"></div>
										{/if}
									</div>
								</div>
								<div class="autonomy-body">
									<span class="autonomy-icon">📰</span>
									<span class="autonomy-label">RSS Feed Auto-Repurpose</span>
									<p class="autonomy-desc">
										Monitor an RSS feed to automatically spin, customize, and post feed updates in
										this agent's voice.
									</p>
								</div>
							</button>
						</div>

						{#if rssActive}
							<div class="field-group" style="margin-bottom: 1.5rem; animation: fadeIn 0.3s ease;">
								<label for="rss-url-input">RSS Feed URL</label>
								<input
									id="rss-url-input"
									type="url"
									placeholder="https://example.com/feed.xml"
									bind:value={rssUrl}
									style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
									onfocus={(e) => {
										e.currentTarget.style.borderColor = 'var(--accent-mid)';
										e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 106, 237, 0.08)';
									}}
									onblur={(e) => {
										e.currentTarget.style.borderColor = 'var(--border)';
										e.currentTarget.style.boxShadow = 'none';
									}}
								/>
								<p style="font-size: var(--text-xs); color: var(--text-dim); margin-top: 0.5rem;">
									Enter a valid RSS or Atom XML feed URL. The scheduler will check this feed
									periodically and spin new items.
								</p>
							</div>

							<div class="field-group" style="animation: fadeIn 0.3s ease;">
								<label>Scheduler Status</label>
								<div
									style="background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1rem; display: flex; align-items: center; gap: 0.75rem;"
								>
									<span style="font-size: 1.25rem;">⏰</span>
									<div>
										<span
											style="font-size: var(--text-xs); color: var(--text-dim); display: block; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;"
											>Last Polled</span
										>
										<span
											style="font-size: var(--text-sm); font-family: var(--font-mono); color: var(--text);"
										>
											{rssLastPolledAt
												? new Date(rssLastPolledAt).toLocaleString()
												: 'Never polled yet'}
										</span>
									</div>
								</div>
							</div>
						{/if}

						<div class="panel-actions">
							<button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
								{#if saving}
									<span class="spinner"></span> Saving…
								{:else}
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path
											d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
										/><polyline points="17 21 17 13 7 13 7 21" /><polyline
											points="7 3 7 8 15 8"
										/></svg
									>
									Save RSS Config
								{/if}
							</button>
						</div>
					</div>
				{:else if activeTab === 'settings'}
					<div class="tab-panel">
						<div class="panel-header">
							<h3>Agent Identity & Settings</h3>
							<p class="panel-desc">
								Update <strong>{selectedAgent.name}</strong>'s core presentation details such as
								name, niche focus, followers count, and visual theme gradient.
							</p>
						</div>

						<div
							class="settings-grid"
							style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; margin-bottom: 2rem;"
						>
							<div class="field-group">
								<label
									for="agent-name-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em;"
									>Agent Name</label
								>
								<input
									id="agent-name-input"
									type="text"
									placeholder="e.g. Veronica Active"
									bind:value={editName}
									style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
									onfocus={(e) => {
										e.currentTarget.style.borderColor = 'var(--accent-mid)';
										e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 106, 237, 0.08)';
									}}
									onblur={(e) => {
										e.currentTarget.style.borderColor = 'var(--border)';
										e.currentTarget.style.boxShadow = 'none';
									}}
								/>
							</div>

							<div class="field-group">
								<label
									for="agent-handle-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em;"
									>Agent Handle</label
								>
								<input
									id="agent-handle-input"
									type="text"
									placeholder="e.g. @veronica_ai"
									bind:value={editHandle}
									style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
									onfocus={(e) => {
										e.currentTarget.style.borderColor = 'var(--accent-mid)';
										e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 106, 237, 0.08)';
									}}
									onblur={(e) => {
										e.currentTarget.style.borderColor = 'var(--border)';
										e.currentTarget.style.boxShadow = 'none';
									}}
								/>
							</div>

							<div class="field-group" style="grid-column: span 2;">
								<label
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.75rem; letter-spacing: 0.05em;"
									>Agent Status</label
								>
								<div style="display: flex; gap: 0.75rem; width: 100%;">
									{#each ['active', 'paused', 'pending'] as statusOpt}
										<button
											type="button"
											onclick={() => (editStatus = statusOpt as any)}
											style="flex: 1; padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid {editStatus ===
											statusOpt
												? 'var(--accent)'
												: 'var(--border)'}; background: {editStatus === statusOpt
												? 'var(--accent-soft)'
												: 'var(--bg)'}; color: {editStatus === statusOpt
												? 'var(--accent)'
												: 'var(--text-dim)'}; font-size: var(--text-sm); font-weight: 600; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 0.5rem; text-transform: capitalize; outline: none;"
										>
											<span
												class="status-dot"
												style="background: {getStatusColor(
													statusOpt
												)}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"
											></span>
											{statusOpt}
										</button>
									{/each}
								</div>
							</div>

							<div class="field-group">
								<label
									for="agent-niche-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em;"
									>Niche / Market Focus</label
								>
								<input
									id="agent-niche-input"
									type="text"
									placeholder="e.g. AI Art & Style"
									bind:value={editNiche}
									style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
									onfocus={(e) => {
										e.currentTarget.style.borderColor = 'var(--accent-mid)';
										e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 106, 237, 0.08)';
									}}
									onblur={(e) => {
										e.currentTarget.style.borderColor = 'var(--border)';
										e.currentTarget.style.boxShadow = 'none';
									}}
								/>
							</div>

							<div class="field-group">
								<label
									for="agent-initial-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em;"
									>Avatar Initial</label
								>
								<input
									id="agent-initial-input"
									type="text"
									maxlength="2"
									placeholder="e.g. V"
									bind:value={editInitial}
									style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
									onfocus={(e) => {
										e.currentTarget.style.borderColor = 'var(--accent-mid)';
										e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 106, 237, 0.08)';
									}}
									onblur={(e) => {
										e.currentTarget.style.borderColor = 'var(--border)';
										e.currentTarget.style.boxShadow = 'none';
									}}
								/>
							</div>

							<div class="field-group">
								<label
									for="agent-followers-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;"
								>
									Followers Count
									<span
										style="font-size: 10px; color: var(--accent-light); text-transform: none; font-weight: normal; background: rgba(124, 106, 237, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(124, 106, 237, 0.2); display: flex; align-items: center; gap: 4px;"
									>
										🔗 Dynamic Sync
									</span>
								</label>
								<input
									id="agent-followers-input"
									type="text"
									placeholder="0 (Connect accounts)"
									value={editFollowers}
									readonly
									style="width: 100%; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(124, 106, 237, 0.2); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text-dim); font-family: var(--font-body); font-size: var(--text-sm); cursor: not-allowed; outline: none; box-shadow: 0 0 8px rgba(124, 106, 237, 0.03);"
								/>
							</div>

							<div class="field-group">
								<label
									for="agent-engagement-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;"
								>
									Engagement Rate
									<span
										style="font-size: 10px; color: var(--accent-light); text-transform: none; font-weight: normal; background: rgba(124, 106, 237, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(124, 106, 237, 0.2); display: flex; align-items: center; gap: 4px;"
									>
										📈 Auto Calculated
									</span>
								</label>
								<input
									id="agent-engagement-input"
									type="text"
									placeholder="0.0% (Connect accounts)"
									value={editEngagementRate.toFixed(1) + '%'}
									readonly
									style="width: 100%; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(124, 106, 237, 0.2); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text-dim); font-family: var(--font-body); font-size: var(--text-sm); cursor: not-allowed; outline: none; box-shadow: 0 0 8px rgba(124, 106, 237, 0.03);"
								/>
							</div>

							<div class="field-group">
								<label
									for="agent-supervisor-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em;"
									>Supervisor (Overseer)</label
								>
								<select
									id="agent-supervisor-input"
									bind:value={editSupervisorId}
									style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
								>
									<option value={null}>None (Autonomous / Standalone)</option>
									{#each supervisors as supervisor}
										<option value={supervisor.id}>{supervisor.name} ({supervisor.handle})</option>
									{/each}
								</select>
							</div>

							<div class="field-group">
								<label
									for="agent-runtime-owner-input"
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.5rem; letter-spacing: 0.05em;"
									>Runtime Owner</label
								>
								<select
									id="agent-runtime-owner-input"
									bind:value={editRuntimeOwner}
									style="width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; color: var(--text); font-family: var(--font-body); font-size: var(--text-sm); outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;"
								>
									<option value="svelte-gemini">Svelte UI Runtime (Gemini)</option>
									<option value="hermes-daemon">Hermes Daemon Service</option>
									<option value="hermes-orchestrated">Hermes Orchestrated</option>
								</select>
							</div>

							<div class="field-group" style="grid-column: span 2;">
								<label
									style="display: block; font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.75rem; letter-spacing: 0.05em;"
									>Avatar Theme Gradient</label
								>
								<div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
									{#each [{ name: 'Purple Sunset', gradient: 'linear-gradient(135deg, #7C3AED, #4F46E5)' }, { name: 'Ocean Cyan', gradient: 'linear-gradient(135deg, #06B6D4, #3B82F6)' }, { name: 'Autumn Gold', gradient: 'linear-gradient(135deg, #F59E0B, #EF4444)' }, { name: 'Forest Emerald', gradient: 'linear-gradient(135deg, #10B981, #059669)' }, { name: 'Cosmic Magenta', gradient: 'linear-gradient(135deg, #EC4899, #8B5CF6)' }] as preset}
										<button
											type="button"
											onclick={() => (editGradient = preset.gradient)}
											style="width: 44px; height: 44px; border-radius: 12px; background: {preset.gradient}; border: 3px solid {editGradient ===
											preset.gradient
												? 'var(--accent)'
												: 'transparent'}; box-shadow: {editGradient === preset.gradient
												? '0 0 12px rgba(124, 106, 237, 0.4)'
												: 'none'}; cursor: pointer; transition: transform 0.2s ease; outline: none;"
											title={preset.name}
										>
										</button>
									{/each}
									<div
										style="margin-left: auto; display: flex; align-items: center; gap: 0.75rem; background: var(--bg); padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 12px;"
									>
										<div
											style="width: 32px; height: 32px; border-radius: 8px; background: {editGradient}; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: bold; color: white;"
										>
											{editInitial || (editName ? editName.charAt(0).toUpperCase() : '')}
										</div>
										<span
											style="font-size: var(--text-xs); color: var(--text-dim); font-weight: 500;"
											>Theme Preview</span
										>
									</div>
								</div>
							</div>
						</div>

						<div class="panel-actions">
							<button class="save-btn" onclick={saveCurrentTab} disabled={saving}>
								{#if saving}
									<span class="spinner"></span> Saving…
								{:else}
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path
											d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
										/><polyline points="17 21 17 13 7 13 7 21" /><polyline
											points="7 3 7 8 15 8"
										/></svg
									>
									Save Agent Settings
								{/if}
							</button>
						</div>

						<!-- Danger Zone Section -->
						<div
							class="danger-zone-section"
							style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid rgba(239, 68, 68, 0.2);"
						>
							<h4
								style="color: #ef4444; font-size: var(--text-sm); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;"
							>
								⚠️ Danger Zone
							</h4>
							<p style="font-size: var(--text-xs); color: var(--text-dim); margin-bottom: 1.25rem;">
								Permanent deletion of this agent persona. This action is irreversible and will erase
								all connected channel metrics and configuration rules.
							</p>

							<button
								type="button"
								onclick={deleteAgentPersona}
								style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: var(--radius-sm); padding: 0.75rem 1.25rem; font-size: var(--text-xs); font-weight: 600; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 0.5rem;"
								onmouseover={(e) => {
									e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
									e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)';
								}}
								onmouseout={(e) => {
									e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
									e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
								}}
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="3 6 5 6 21 6"></polyline>
									<path
										d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
									></path>
									<line x1="10" y1="11" x2="10" y2="17"></line>
									<line x1="14" y1="11" x2="14" y2="17"></line>
								</svg>
								Delete Agent Persona
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="empty-state">
			<div class="empty-icon">
				<svg
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--text-dim)"
					stroke-width="1.5"
					><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 10-16 0" /><path
						d="M12 12v4m-2-2h4"
						stroke="var(--accent)"
						stroke-width="2"
					/></svg
				>
			</div>
			<h3>Select an Agent</h3>
			<p>
				Choose an agent from the grid above to configure their AI personality, skills, and behavior.
			</p>
		</div>
	{/if}
</section>

<style>
	.page {
		padding: 1.25rem 1.5rem;
		max-width: 1300px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 1.25rem;
	}

	.page-header h1 {
		font-size: 1.75rem;
		font-family: var(--font-display);
		margin-bottom: 0.25rem;
	}

	.grad {
		background: var(--gradient);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* ── Agent Grid ── */
	.agent-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.agent-card {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.85rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			border-color 0.2s ease,
			transform 0.15s ease,
			box-shadow 0.2s ease;
		text-align: left;
		width: 100%;
		color: var(--text);
		font-family: var(--font-body);
	}

	.agent-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.agent-card.selected {
		border-color: var(--accent);
		box-shadow: 0 0 20px rgba(124, 106, 237, 0.15);
		background: var(--surface-2);
	}

	.agent-avatar {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.agent-avatar span {
		color: white;
		font-weight: 700;
		font-size: 0.95rem;
		font-family: var(--font-display);
	}

	.agent-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}

	.agent-name {
		font-weight: 600;
		font-size: var(--text-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.agent-handle {
		font-size: 10px;
		color: var(--text-dim);
		font-family: var(--font-mono);
	}

	.agent-status {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		flex-shrink: 0;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		display: inline-block;
	}

	/* ── Config Editor ── */
	.config-editor {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.tab-nav {
		display: flex;
		border-bottom: 1px solid var(--border);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tab-nav::-webkit-scrollbar {
		display: none;
	}

	.tab-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.65rem 1rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.2s ease,
			border-color 0.2s ease,
			background 0.2s ease;
		font-family: var(--font-body);
	}

	.tab-btn:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.02);
	}

	.tab-btn.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}

	.tab-icon {
		font-size: 1rem;
	}

	.tab-content {
		padding: 0;
	}

	.tab-panel {
		padding: 1.25rem;
	}

	.panel-header {
		margin-bottom: 1rem;
	}

	.panel-header h3 {
		font-size: var(--text-lg);
		font-family: var(--font-display);
		margin-bottom: 0.25rem;
	}

	.panel-desc {
		color: var(--text-muted);
		font-size: var(--text-sm);
		line-height: 1.5;
	}

	.panel-desc strong {
		color: var(--accent);
	}

	.config-textarea {
		width: 100%;
		min-height: 320px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.85rem;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.6;
		resize: vertical;
		outline: none;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	.config-textarea:focus {
		border-color: var(--accent-mid);
		box-shadow: 0 0 0 3px rgba(124, 106, 237, 0.08);
	}

	.panel-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.save-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 1.25rem;
		background: var(--gradient-subtle);
		color: #fff;
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			opacity 0.2s ease;
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

	/* ── Heartbeat ── */
	.heartbeat-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
	}

	.field-group.full-width {
		grid-column: 1 / -1;
	}

	.field-group label {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		margin-bottom: 0.5rem;
	}

	.accent-val {
		color: var(--accent);
		font-size: var(--text-base);
	}

	.slider-wrap {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.slider-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-family: var(--font-mono);
		min-width: 1.5rem;
		text-align: center;
	}

	.slider-wrap input[type='range'] {
		flex: 1;
		height: 6px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--surface-3);
		border-radius: 3px;
		outline: none;
		border: none;
		padding: 0;
	}

	.slider-wrap input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
		border: 2px solid var(--bg);
		box-shadow: 0 0 8px rgba(124, 106, 237, 0.3);
	}

	.slider-wrap input[type='range']::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
		border: 2px solid var(--bg);
	}

	.hours-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.hour-input {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.hour-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.hour-sep {
		color: var(--accent);
		font-size: 1.25rem;
		margin-top: 1rem;
	}

	.schedule-preview {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem;
	}

	.hour-bar {
		display: flex;
		gap: 2px;
		margin-bottom: 0.75rem;
	}

	.hour-block {
		flex: 1;
		height: 28px;
		background: var(--surface-3);
		border-radius: 3px;
		position: relative;
		transition: background 0.2s ease;
	}

	.hour-block.active-hour {
		background: var(--accent-mid);
	}

	.hour-tick {
		position: absolute;
		bottom: -18px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 9px;
		color: var(--text-dim);
		white-space: nowrap;
		font-family: var(--font-mono);
	}

	.preview-text {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin-top: 0.5rem;
	}

	/* ── Autonomy ── */
	.autonomy-cards {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.autonomy-card {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.85rem 1.15rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		width: 100%;
		color: var(--text);
		font-family: var(--font-body);
		transition:
			border-color 0.2s ease,
			background 0.2s ease,
			box-shadow 0.2s ease;
	}

	.autonomy-card:hover {
		border-color: var(--border-hover);
		background: var(--surface-2);
	}

	.autonomy-card.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
		box-shadow: 0 0 20px rgba(124, 106, 237, 0.1);
	}

	.autonomy-radio {
		margin-top: 0.25rem;
		flex-shrink: 0;
	}

	.radio-outer {
		width: 20px;
		height: 20px;
		border: 2px solid var(--border-strong);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.2s ease;
	}

	.autonomy-card.selected .radio-outer {
		border-color: var(--accent);
	}

	.radio-inner {
		width: 10px;
		height: 10px;
		background: var(--accent);
		border-radius: 50%;
		animation: radioIn 0.2s ease;
	}

	@keyframes radioIn {
		from {
			transform: scale(0);
		}
		to {
			transform: scale(1);
		}
	}

	.autonomy-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.autonomy-icon {
		font-size: 1.5rem;
		margin-bottom: 0.25rem;
	}

	.autonomy-label {
		font-weight: 700;
		font-size: var(--text-md);
	}

	.autonomy-desc {
		font-size: var(--text-sm);
		color: var(--text-muted);
		line-height: 1.5;
	}

	/* ── Empty State ── */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.empty-icon {
		margin-bottom: 1.5rem;
		display: flex;
		justify-content: center;
	}

	.empty-state h3 {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		margin-bottom: 0.5rem;
	}

	.empty-state p {
		color: var(--text-muted);
		font-size: var(--text-base);
		max-width: 400px;
		margin: 0 auto;
	}

	/* ── Responsive ── */
	@media (max-width: 768px) {
		.page {
			padding: 1rem;
		}

		.agent-grid {
			grid-template-columns: 1fr;
		}

		.heartbeat-grid {
			grid-template-columns: 1fr;
		}

		.tab-panel {
			padding: 1.25rem;
		}

		.config-textarea {
			min-height: 280px;
		}

		.tab-btn {
			padding: 0.75rem 1rem;
			font-size: var(--text-sm);
		}
	}

	/* ── Platform grid ── */
	.platforms-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
	}

	@media (max-width: 1024px) {
		.platforms-grid {
			grid-template-columns: 1fr;
		}
	}

	.platform-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition:
			border-color 0.25s ease,
			box-shadow 0.25s ease,
			transform 0.2s ease;
		position: relative;
		overflow: hidden;
	}

	.platform-card::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--platform-color);
		opacity: 0.5;
		transition: opacity 0.25s ease;
	}

	.platform-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.platform-card:hover::before {
		opacity: 1;
	}

	.platform-card.connected::before {
		opacity: 1;
	}

	.platform-header {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}

	.platform-icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.platform-icon :global(svg) {
		display: block;
	}

	.platform-name-wrap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.platform-name {
		font-weight: 600;
		font-size: var(--text-md, 1rem);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-dim);
		transition: background 0.2s ease;
	}

	.status-dot.on {
		background: var(--success);
		box-shadow: 0 0 8px rgba(52, 211, 153, 0.5);
	}

	/* ── Platform body ── */
	.platform-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 1;
		justify-content: flex-end;
	}

	.connected-info {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.handle-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.handle {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text);
	}

	.verified-badge {
		flex-shrink: 0;
		display: inline-block;
	}

	.sync-time {
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.disconnected-msg {
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin: 0;
	}

	/* ── Buttons ── */
	.btn-connect {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.6rem 1.2rem;
		border-radius: var(--radius-sm);
		background: var(--warning-soft);
		border: 1px solid rgba(245, 158, 11, 0.25);
		color: var(--warning);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			background 0.2s ease,
			transform 0.15s ease;
		font-family: var(--font-body);
	}

	.btn-connect:hover:not(:disabled) {
		background: rgba(245, 158, 11, 0.2);
		transform: translateY(-1px);
	}

	.btn-connect:disabled {
		opacity: 0.7;
		cursor: wait;
	}

	.btn-disconnect {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
		background: var(--error-soft);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
		font-weight: 600;
		font-size: var(--text-xs);
		cursor: pointer;
		transition: background 0.2s ease;
		font-family: var(--font-body);
	}

	.btn-disconnect:hover {
		background: rgba(239, 68, 68, 0.2);
	}

	/* ── Loading bar ── */
	.loading-bar {
		width: 100%;
		height: 3px;
		background: var(--surface-3);
		border-radius: 2px;
		margin-bottom: 1.5rem;
		overflow: hidden;
	}

	.loading-bar-inner {
		width: 40%;
		height: 100%;
		background: var(--gradient);
		border-radius: 2px;
		animation: loading-slide 1.2s ease-in-out infinite;
	}

	@keyframes loading-slide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(350%);
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
