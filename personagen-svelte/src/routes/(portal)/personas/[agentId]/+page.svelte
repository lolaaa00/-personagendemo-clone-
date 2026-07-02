<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { slide } from 'svelte/transition';
	import { Accounts, Posts } from '$lib/services/api';
	import AgentConnectionStats from '$lib/components/agents/AgentConnectionStats.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import ManualDeleteNotice from '$lib/components/feed/ManualDeleteNotice.svelte';
	import { getPostDisplay } from '$lib/components/feed/postDisplay';
	import type { AutonomyLevel } from '$lib/types';
	import { AUTONOMY_LABELS } from '$lib/types';

	let { data }: { data: any } = $props();

	let agent = $state<any>(data.agent ?? null);
	let supervisors = $derived(data.supervisors ?? []);
	// Tracks which agent's data is currently loaded into `agent`/the editable
	// fields below, so the resync effect (further down) can tell "navigated to
	// a different persona" apart from "same persona's data merely refreshed."
	let loadedAgentId: string | null = data.agent?.id ?? null;

	// ── Tab state ──────────────────────────────────────────────────
	function initialTab(): 'feed' | 'profile' | 'connections' | 'assets' {
		const t = $page.url.searchParams.get('tab');
		return t === 'profile' || t === 'connections' || t === 'assets' ? t : 'feed';
	}
	let activeTab = $state<'feed' | 'profile' | 'connections' | 'assets'>(initialTab());

	// ── Feed state ─────────────────────────────────────────────────
	let feedPosts = $state<any[]>([]);
	let feedLoading = $state(false);
	let syncingFeed = $state(false);
	let generatingPost = $state(false);
	let feedFilter = $state<'all' | 'published' | 'scheduled' | 'draft' | 'failed' | 'partial'>('all');
	let platformFilter = $state<'all' | 'tiktok' | 'instagram' | 'youtube' | 'facebook'>('all');
	let modalPost = $state<any | null>(null);
	let deletingPostId = $state<string | null>(null);
	let approvingPostId = $state<string | null>(null);
	let manualDeleteNotice = $state<Array<{ platform: string; permalink: string | null }> | null>(
		null
	);

	// ── Profile / config state ─────────────────────────────────────
	let saving = $state(false);

	// Identity
	let editName = $state(agent?.name ?? '');
	let editHandle = $state(agent?.handle ?? '');
	let editStatus = $state<'active' | 'paused' | 'pending'>(agent?.status ?? 'active');
	let editNiche = $state(agent?.niche ?? '');
	let editInitial = $state(agent?.initial ?? '');
	let editGradient = $state(agent?.gradient ?? 'linear-gradient(135deg, #7C3AED, #4F46E5)');
	let characterRef = $state<string | null>(agent?.ugc_character_ref ?? null);
	let generatingAvatar = $state(false);
	let referenceKit = $state<Record<string, string>>(agent?.ugc_reference_kit ?? {});
	let generatingKitStage = $state<'side_profiles' | 'face_closeup' | 'feature_grid' | null>(null);
	let editSupervisorId = $state<string | null>(agent?.supervisor_agent_id ?? null);
	let editRuntimeOwner = $state<'svelte-gemini' | 'hermes-daemon' | 'hermes-orchestrated'>(
		agent?.runtime_owner ?? 'svelte-gemini'
	);

	// Soul / Skills / Tools
	let soulText = $state(agent?.soul ?? '');
	let skillsText = $state(agent?.skills ?? '');
	let toolsText = $state(agent?.tools ?? '');

	// Automation
	let timezone = $state(agent?.timezone ?? 'Australia/Sydney');
	let postsPerDay = $state(agent?.posts_per_day ?? 3);
	let activeHoursStart = $state(agent?.active_hours_start ?? 8);
	let activeHoursEnd = $state(agent?.active_hours_end ?? 22);
	let autonomyLevel = $state<AutonomyLevel>(agent?.autonomy_level ?? 'advisor');
	let selectedVoice = $state(agent?.ugc_voice ?? 'Adam');
	let rssUrl = $state(agent?.rss_url ?? '');
	let rssActive = $state(agent?.rss_active ?? false);
	let rssLastPolledAt = $state<string | null>(agent?.rss_last_polled_at ?? null);

	// ── Connections state ──────────────────────────────────────────
	// Full connectable set (matches the connections table CHECK constraint and
	// Zernio's supported platforms) — not just Composio's narrower subset, so
	// a Zernio-only connection (x, threads) still shows up here.
	const PLATFORMS = [
		{ key: 'tiktok', name: 'TikTok', color: '#fe2c55' },
		{ key: 'instagram', name: 'Instagram', color: '#e1306c' },
		{ key: 'youtube', name: 'YouTube', color: '#ff0000' },
		{ key: 'facebook', name: 'Facebook', color: '#1877f2' },
		{ key: 'x', name: 'X', color: '#000000' },
		{ key: 'threads', name: 'Threads', color: '#000000' }
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
	let statusLoading = $state(false);
	let connectingPlatform = $state('');
	let collapsedPlatforms = $state<Record<string, boolean>>({});

	const platformMetrics: Record<string, { followers: number; engagement: number }> = {
		tiktok: { followers: 0, engagement: 0 },
		instagram: { followers: 0, engagement: 0 },
		youtube: { followers: 0, engagement: 0 },
		facebook: { followers: 0, engagement: 0 }
	};

	const computedMetrics = $derived.by(() => {
		let totalFollowers = 0;
		let totalEngRate = 0;
		let connectedCount = 0;
		for (const p of PLATFORMS) {
			const status = platformStatuses[p.key];
			if (status?.connected) {
				totalFollowers += status.followers ?? 0;
				totalEngRate += status.engagement_rate ?? 0;
				connectedCount++;
			}
		}
		const avgEngRate = connectedCount > 0 ? parseFloat((totalEngRate / connectedCount).toFixed(1)) : 0;
		let followersStr = '0';
		if (totalFollowers >= 1_000_000) followersStr = (totalFollowers / 1_000_000).toFixed(1) + 'M';
		else if (totalFollowers >= 1000) followersStr = (totalFollowers / 1000).toFixed(1) + 'K';
		else followersStr = String(totalFollowers);
		return { followers: followersStr, followersRaw: totalFollowers, engagementRate: avgEngRate, connectedCount };
	});

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

	const autonomyKeys: AutonomyLevel[] = ['advisor', 'semi_autonomous', 'fully_autonomous'];

	const GRADIENT_PRESETS = [
		{ name: 'Purple Sunset', gradient: 'linear-gradient(135deg, #7C3AED, #4F46E5)' },
		{ name: 'Ocean Cyan', gradient: 'linear-gradient(135deg, #06B6D4, #3B82F6)' },
		{ name: 'Autumn Gold', gradient: 'linear-gradient(135deg, #F59E0B, #EF4444)' },
		{ name: 'Forest Emerald', gradient: 'linear-gradient(135deg, #10B981, #059669)' },
		{ name: 'Cosmic Magenta', gradient: 'linear-gradient(135deg, #EC4899, #8B5CF6)' }
	];

	// ── Resync when navigating to a different persona ──────────────
	// SvelteKit reuses this component instance across /personas/[agentId] →
	// /personas/[otherId] navigations (same route, only the param changes), so
	// `agent` and the editable fields below — all seeded once at mount — would
	// otherwise keep showing the previous persona while the URL/sidebar already
	// point at the new one. Re-seed everything when `data.agent` (reactive,
	// re-fetched by +page.server.ts on every navigation) resolves to a new id.
	// Guarded by `loadedAgentId` so this does NOT clobber in-progress edits or
	// the optimistic local updates in saveProfile()/setMainHandle() whenever
	// `data.agent` merely revalidates for the SAME persona.
	$effect(() => {
		const fresh = data.agent;
		if (!fresh || fresh.id === loadedAgentId) return;
		loadedAgentId = fresh.id;

		agent = fresh;

		editName = fresh.name ?? '';
		editHandle = fresh.handle ?? '';
		editStatus = fresh.status ?? 'active';
		editNiche = fresh.niche ?? '';
		editInitial = fresh.initial ?? '';
		editGradient = fresh.gradient ?? 'linear-gradient(135deg, #7C3AED, #4F46E5)';
		characterRef = fresh.ugc_character_ref ?? null;
		referenceKit = fresh.ugc_reference_kit ?? {};
		editSupervisorId = fresh.supervisor_agent_id ?? null;
		editRuntimeOwner = fresh.runtime_owner ?? 'svelte-gemini';

		soulText = fresh.soul ?? '';
		skillsText = fresh.skills ?? '';
		toolsText = fresh.tools ?? '';

		timezone = fresh.timezone ?? 'Australia/Sydney';
		postsPerDay = fresh.posts_per_day ?? 3;
		activeHoursStart = fresh.active_hours_start ?? 8;
		activeHoursEnd = fresh.active_hours_end ?? 22;
		autonomyLevel = fresh.autonomy_level ?? 'advisor';
		rssUrl = fresh.rss_url ?? '';
		rssActive = fresh.rss_active ?? false;
		rssLastPolledAt = fresh.rss_last_polled_at ?? null;
		selectedVoice = fresh.ugc_voice ?? 'Adam';

		// Feed/Connections data belongs to the previous persona — drop it so
		// stale posts or a stale open modal can't linger under the new identity.
		feedPosts = [];
		modalPost = null;
		manualDeleteNotice = null;
		platformStatuses = {};
		assetLightbox = null;

		// A staged (not-yet-submitted) reference-photo upload or in-flight kit-stage
		// spinner also belongs to the previous persona — otherwise switching personas
		// mid-upload would silently apply persona A's staged photo to persona B, or
		// show a "generating" spinner attributed to the wrong persona.
		if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
		referenceFile = null;
		referencePreviewUrl = null;
		generatingKitStage = null;
		generatingAvatar = false;
	});

	// ── Tab init effects ───────────────────────────────────────────
	$effect(() => {
		// Assets tab derives its grid from the same posts data as the feed.
		if ((activeTab === 'feed' || activeTab === 'assets') && agent?.id) loadFeed();
	});

	$effect(() => {
		if (activeTab === 'connections' && agent?.id) checkStatuses();
	});

	$effect(() => {
		if (activeTab === 'profile') loadVoiceCatalog();
	});

	// ── UGC voice picker ───────────────────────────────────────────
	let voiceCatalog = $state<Array<{ name: string; label: string; gender: 'male' | 'female'; style: string }>>([]);
	let previewingVoice = $state(false);
	let previewAudio: HTMLAudioElement | null = null;

	async function loadVoiceCatalog() {
		if (voiceCatalog.length > 0) return;
		try {
			const res = await fetch('/api/voices');
			const d = await res.json();
			if (d.success) voiceCatalog = d.voices;
		} catch (err) {
			console.error('[Voices] Failed to load catalog:', err);
		}
	}

	async function previewVoice() {
		if (previewingVoice) return;
		previewingVoice = true;
		try {
			const res = await fetch('/api/voices', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ voice: selectedVoice })
			});
			const d = await res.json();
			if (!d.success) throw new Error(d.error || 'Preview failed');
			if (!previewAudio) previewAudio = new Audio();
			previewAudio.src = d.audio_url;
			await previewAudio.play();
		} catch (err: any) {
			showToast('Voice preview failed: ' + err.message, 'error');
		} finally {
			previewingVoice = false;
		}
	}

	// ── Feed functions ─────────────────────────────────────────────
	async function loadFeed() {
		if (!agent?.id) return;
		feedLoading = true;
		try {
			const res = await fetch('/api/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'list', agent_id: agent.id })
			});
			const result = await res.json();
			if (result.success) {
				feedPosts = (result.data || []).sort(
					(a: any, b: any) =>
						new Date(b.published_at || b.created_at).getTime() -
						new Date(a.published_at || a.created_at).getTime()
				);
			} else {
				showToast('Failed to load feed: ' + result.error, 'error');
			}
		} catch (err) {
			showToast('Error loading feed: ' + (err as Error).message, 'error');
		} finally {
			feedLoading = false;
		}
	}

	async function syncFeed() {
		// There is no separate server-side "sync" step — posts are always
		// written straight to the DB by generation/publishing. This button
		// used to POST to a since-removed /api/agent/[agentId]/sync route
		// (always 404'd); a real refetch of this persona's posts is what
		// "sync" actually means here. loadFeed() already reports its own
		// success/failure via toast, so no need to duplicate that here.
		if (!agent?.id) return;
		syncingFeed = true;
		await loadFeed();
		syncingFeed = false;
	}

	async function generatePostNow() {
		if (!agent?.id) return;
		generatingPost = true;
		try {
			const res = await fetch(`/api/agent/${agent.id}/generate-post`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			const result = await res.json();
			if (res.ok && result.success) {
				showToast('Post generated and published!', 'success');
				await loadFeed();
			} else {
				showToast(result.error || 'Failed to generate post', 'error');
			}
		} catch (err) {
			showToast('Error: ' + (err as Error).message, 'error');
		} finally {
			generatingPost = false;
		}
	}

	async function handleDeletePost(post: any) {
		if (!post?.id) return;
		deletingPostId = post.id;
		try {
			const res = await Posts.delete(post.id);
			if (res.success) {
				const teardown = (res as any).teardown as
					| {
							unpublished: string[];
							manualDeletion: Array<{ platform: string; permalink: string | null }>;
							errors: string[];
					  }
					| undefined;

				feedPosts = feedPosts.filter((p: any) => p.id !== post.id);
				if (modalPost?.id === post.id) modalPost = null;

				if (teardown?.unpublished?.length) {
					showToast(`Removed from ${teardown.unpublished.join(', ')} and deleted locally`, 'success');
				} else {
					showToast('Post deleted', 'success');
				}

				if (teardown?.manualDeletion?.length) {
					manualDeleteNotice = teardown.manualDeletion;
				}
			} else {
				showToast(res.error || 'Failed to delete post', 'error');
			}
		} catch (err) {
			showToast('Error deleting post: ' + (err as Error).message, 'error');
		} finally {
			deletingPostId = null;
		}
	}

	async function handleApprovePost(post: any) {
		if (!post?.id) return;
		approvingPostId = post.id;
		try {
			const res = await Posts.update(post.id, { status: 'scheduled' });
			if (res.success) {
				feedPosts = feedPosts.map((p: any) => (p.id === post.id ? { ...p, status: 'scheduled' } : p));
				if (modalPost?.id === post.id) modalPost = { ...modalPost, status: 'scheduled' };
				showToast('Approved — will auto-publish at its scheduled time', 'success');
			} else {
				showToast(res.error || 'Failed to approve', 'error');
			}
		} catch (err) {
			showToast('Error approving post: ' + (err as Error).message, 'error');
		} finally {
			approvingPostId = null;
		}
	}

	let filteredPosts = $derived(feedPosts.filter((p: any) => {
		// The mosaic is a media grid — a post with no real image/video (a
		// generation that never completed, or corrupted content) has nothing
		// to show here and would just render as a broken-looking card.
		if (!getPostDisplay(p).mediaUrl) return false;
		if (feedFilter !== 'all' && p.status !== feedFilter) return false;
		if (platformFilter !== 'all') {
			const plats = (p.platforms ?? []).map((x: string) => x.toLowerCase());
			if (!plats.includes(platformFilter)) return false;
		}
		return true;
	}));

	// ── Assets: every generated visual for this persona in one grid ──
	interface AssetItem {
		url: string;
		type: 'image' | 'video';
		label: string;
	}
	let assetItems = $derived.by(() => {
		const seen = new Set<string>();
		const items: AssetItem[] = [];
		const add = (url: string | null | undefined, type: 'image' | 'video', label: string) => {
			if (!url || typeof url !== 'string' || seen.has(url)) return;
			seen.add(url);
			items.push({ url, type, label });
		};
		for (const p of feedPosts) {
			try {
				const c = JSON.parse(p.content);
				add(c.media_url || c.mediaUrl, c.media_type === 'video' ? 'video' : 'image', 'Post media');
				add(c.poster_url, 'image', 'Poster still');
				if (Array.isArray(c.storyboard)) {
					for (const s of c.storyboard) add(s, 'image', 'Storyboard still');
				}
			} catch {
				/* non-JSON content has no assets */
			}
		}
		add(characterRef, 'image', 'Profile picture');
		for (const [k, v] of Object.entries(referenceKit ?? {})) {
			add(v as string, 'image', `Reference kit — ${k.replace(/_/g, ' ')}`);
		}
		return items;
	});
	let assetLightbox = $state<AssetItem | null>(null);

	// ── Profile save ───────────────────────────────────────────────
	async function saveProfile() {
		if (!agent?.id) return;
		saving = true;
		const payload = {
			agentId: agent.id,
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
			ugcVoice: selectedVoice,
			name: editName,
			handle: editHandle,
			status: editStatus,
			niche: editNiche,
			gradient: editGradient,
			initial: editInitial,
			followers: agent.followers,
			engagementRate: agent.engagement_rate,
			supervisorAgentId: editSupervisorId,
			runtimeOwner: editRuntimeOwner
		};
		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			// Update local agent state
			agent = { ...agent, name: editName, handle: editHandle, status: editStatus, niche: editNiche, gradient: editGradient, initial: editInitial, soul: soulText, skills: skillsText, tools: toolsText, timezone, posts_per_day: postsPerDay, active_hours_start: activeHoursStart, active_hours_end: activeHoursEnd, autonomy_level: autonomyLevel, rss_url: rssUrl, rss_active: rssActive, ugc_voice: selectedVoice };
			showToast(`Profile saved for ${editName}`, 'success');
		} catch (err: any) {
			showToast('Failed to save: ' + err.message, 'error');
		} finally {
			saving = false;
		}
	}

	async function generateAvatar() {
		if (!agent?.id || generatingAvatar) return;
		const requestAgentId = agent.id;
		const requestAgentName = agent.name;
		generatingAvatar = true;
		try {
			const res = await fetch(`/api/agent/${requestAgentId}/generate-avatar`, { method: 'POST' });
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			// The user may have switched personas while this request was in flight —
			// the server already persisted the result under requestAgentId regardless,
			// but only apply it to in-memory state if we're still looking at that persona.
			if (agent?.id === requestAgentId) {
				characterRef = d.character_ref;
				agent = { ...agent, ugc_character_ref: d.character_ref };
				showToast('Profile picture generated', 'success');
			} else {
				showToast(`Profile picture generated for ${requestAgentName}`, 'success');
			}
		} catch (err: any) {
			showToast('Failed to generate profile picture: ' + err.message, 'error');
		} finally {
			if (agent?.id === requestAgentId) generatingAvatar = false;
		}
	}

	// ── Reference-photo upload → character sheet ──────────────────
	let referenceFile = $state<File | null>(null);
	let referencePreviewUrl = $state<string | null>(null);

	function onReferenceFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
		referenceFile = file;
		referencePreviewUrl = URL.createObjectURL(file);
	}

	function clearReferenceFile() {
		if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
		referenceFile = null;
		referencePreviewUrl = null;
	}

	async function generateAvatarFromReference() {
		if (!agent?.id || !referenceFile || generatingAvatar) return;
		const requestAgentId = agent.id;
		const requestAgentName = agent.name;
		generatingAvatar = true;
		try {
			const form = new FormData();
			form.append('reference', referenceFile);
			const res = await fetch(`/api/agent/${requestAgentId}/generate-avatar`, {
				method: 'POST',
				body: form
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			// Same in-flight-persona-switch guard as generateAvatar() above — the
			// server already persisted this under requestAgentId either way.
			if (agent?.id === requestAgentId) {
				characterRef = d.character_ref;
				referenceKit = d.reference_kit ?? referenceKit;
				agent = { ...agent, ugc_character_ref: d.character_ref, ugc_reference_kit: referenceKit };
				clearReferenceFile();
				showToast('Character sheet generated from your reference photo', 'success');
			} else {
				showToast(`Character sheet generated for ${requestAgentName}`, 'success');
			}
		} catch (err: any) {
			showToast('Failed to generate from reference photo: ' + err.message, 'error');
		} finally {
			if (agent?.id === requestAgentId) generatingAvatar = false;
		}
	}

	async function generateKitStage(stage: 'side_profiles' | 'face_closeup' | 'feature_grid') {
		if (!agent?.id || generatingKitStage) return;
		const requestAgentId = agent.id;
		generatingKitStage = stage;
		try {
			const res = await fetch(`/api/agent/${requestAgentId}/generate-reference-kit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stage })
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			const stageLabels: Record<string, string> = {
				side_profiles: 'Side-profile composite generated',
				face_closeup: 'Facial close-up generated',
				feature_grid: 'Feature grid generated'
			};
			// Same in-flight-persona-switch guard as generateAvatar()/generateAvatarFromReference()
			// above — the server already persisted this under requestAgentId either way.
			if (agent?.id === requestAgentId) {
				referenceKit = { ...referenceKit, [stage]: d[stage] };
				agent = { ...agent, ugc_reference_kit: referenceKit };
				showToast(stageLabels[stage], 'success');
			} else {
				showToast(`${stageLabels[stage]} for a different persona`, 'success');
			}
		} catch (err: any) {
			showToast(`Failed to generate: ${err.message}`, 'error');
		} finally {
			if (agent?.id === requestAgentId) generatingKitStage = null;
		}
	}

	async function deleteAgent() {
		if (!agent?.id) return;
		const confirmed = confirm(`Permanently delete "${agent.name}"? This cannot be undone.`);
		if (!confirmed) return;
		try {
			const res = await fetch('/api/agents/config', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentId: agent.id })
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to delete');
			showToast(`Deleted ${agent.name}`, 'success');
			goto('/dashboard');
		} catch (err: any) {
			showToast(err.message, 'error');
		}
	}

	// ── Connection functions ───────────────────────────────────────
	async function checkStatuses() {
		if (!agent?.id) return;
		statusLoading = true;
		try {
			const res = await Accounts.checkStatus(agent.id);
			if (res.success && res.data) {
				platformStatuses = res.data as Record<string, PlatformStatus>;
			} else {
				platformStatuses = {};
				PLATFORMS.forEach(p => { platformStatuses[p.key] = { connected: false }; });
			}
		} catch {
			platformStatuses = {};
			PLATFORMS.forEach(p => { platformStatuses[p.key] = { connected: false }; });
		}
		statusLoading = false;
	}

	async function connectPlatform(platform: string) {
		if (!agent?.id) return;
		const status = platformStatuses[platform];
		if (status?.configured === false) { showToast(`${platform} is not configured`, 'warning'); return; }
		connectingPlatform = platform;
		try {
			const res = await Accounts.initConnection(agent.id, platform);
			if (res.success) {
				showToast(`Connection initiated for ${platform}`, 'success');
				const redirectUrl = (res.data as any)?.redirect_url;
				if (redirectUrl) { showToast(`Opening ${platform} auth…`, 'info'); window.open(redirectUrl, '_blank'); }
				await checkStatuses();
			} else {
				showToast(res.error || `Failed to connect ${platform}`, 'error');
			}
		} catch {
			showToast(`Unable to reach API — ${platform} unavailable`, 'warning');
		}
		connectingPlatform = '';
	}

	async function disconnectPlatform(platform: string) {
		if (!agent?.id) return;
		try {
			const res = await Accounts.disconnect(agent.id, platform);
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
		if (!agent?.id) return;
		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentId: agent.id, handle })
			});
			const d = await res.json();
			if (res.ok && d.success) {
				agent = { ...agent, handle };
				editHandle = handle;
				showToast(`Main handle set to ${handle}`, 'success');
			} else {
				showToast(d.error || 'Failed to update handle', 'error');
			}
		} catch {
			showToast('Error updating handle', 'error');
		}
	}

	function formatSyncTime(iso?: string): string {
		if (!iso) return 'Never';
		const d = new Date(iso);
		const now = new Date();
		const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
		if (diffMin < 1) return 'Just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return `${Math.floor(diffHr / 24)}d ago`;
	}

	function formatHour(h: number): string {
		const ampm = h >= 12 ? 'PM' : 'AM';
		const hour = h % 12 || 12;
		return `${hour}:00 ${ampm}`;
	}

	function getStatusColor(s: string) {
		if (s === 'active') return 'var(--success)';
		if (s === 'paused') return 'var(--warning)';
		return 'var(--text-dim)';
	}
</script>

<svelte:head>
	<title>{agent?.name ?? 'Persona'} — PersonaGen</title>
</svelte:head>

{#if !agent}
	<div class="no-agent">
		<p>Agent not found.</p>
		<a href="/dashboard" class="btn-primary">Back to Dashboard</a>
	</div>
{:else}
<div class="persona-page">
	<!-- ── Hero header ─────────────────────────────────────────── -->
	<header class="persona-hero">
		<div class="hero-avatar" style={agent.ugc_character_ref ? '' : `background: ${agent.gradient}`}>
			{#if agent.ugc_character_ref}
				<img src={agent.ugc_character_ref} alt={agent.name} />
			{:else}
				{agent.initial ?? agent.name?.[0]?.toUpperCase() ?? '?'}
			{/if}
		</div>
		<div class="hero-info">
			<div class="hero-name-row">
				<h1 class="hero-name">{agent.name}</h1>
				<span class="hero-handle">{agent.handle}</span>
				<span class="hero-status-dot" style="background: {getStatusColor(agent.status)}" title={agent.status}></span>
			</div>
			<div class="hero-meta">
				<span class="hero-niche">{agent.niche}</span>
				<span class="hero-sep">·</span>
				<span class="hero-autonomy">{AUTONOMY_LABELS[agent.autonomy_level as AutonomyLevel]?.label ?? agent.autonomy_level}</span>
				{#if computedMetrics.connectedCount > 0}
					<span class="hero-sep">·</span>
					<span class="hero-connections">{computedMetrics.connectedCount} platform{computedMetrics.connectedCount !== 1 ? 's' : ''} connected</span>
				{/if}
			</div>
		</div>
		<div class="hero-stats">
			<div class="stat-chip">
				<span class="stat-val">{feedPosts.length}</span>
				<span class="stat-label">Posts</span>
			</div>
			{#if computedMetrics.followersRaw > 0}
				<div class="stat-chip">
					<span class="stat-val">{computedMetrics.followers}</span>
					<span class="stat-label">Followers</span>
				</div>
				<div class="stat-chip">
					<span class="stat-val">{computedMetrics.engagementRate}%</span>
					<span class="stat-label">Engagement</span>
				</div>
			{/if}
		</div>
	</header>

	<!-- ── Tab nav ────────────────────────────────────────────── -->
	<!-- Sticky so identity stays visible while scrolling a long tab (fixes the
	     class of confusion where you lose track of which persona you're on). -->
	<nav class="tab-nav">
		<div class="tab-nav-identity" title="{agent.name} ({agent.handle})">
			<span class="tab-nav-avatar" style={agent.ugc_character_ref ? '' : `background: ${agent.gradient}`}>
				{#if agent.ugc_character_ref}
					<img src={agent.ugc_character_ref} alt={agent.name} />
				{:else}
					{agent.initial ?? agent.name?.[0]?.toUpperCase() ?? '?'}
				{/if}
			</span>
			<span class="tab-nav-name">{agent.name}</span>
		</div>
		<div class="tab-nav-buttons">
			<button class="tab-btn" class:active={activeTab === 'feed'} onclick={() => (activeTab = 'feed')}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
				Feed
			</button>
			<button class="tab-btn" class:active={activeTab === 'profile'} onclick={() => (activeTab = 'profile')}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
				Profile
			</button>
			<button class="tab-btn" class:active={activeTab === 'connections'} onclick={() => (activeTab = 'connections')}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
				Connections
				{#if computedMetrics.connectedCount > 0}
					<span class="tab-badge">{computedMetrics.connectedCount}</span>
				{/if}
			</button>
			<button class="tab-btn" class:active={activeTab === 'assets'} onclick={() => (activeTab = 'assets')}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
				Assets
			</button>
		</div>
	</nav>

	<!-- ── Tab content ────────────────────────────────────────── -->
	<div class="tab-body">

		<!-- FEED TAB -->
		{#if activeTab === 'feed'}
			<div class="feed-tab">
				<!-- Toolbar -->
				<div class="feed-toolbar">
					<div class="feed-filters">
						<select class="filter-select" bind:value={feedFilter}>
							<option value="all">All statuses</option>
							<option value="published">Published</option>
							<option value="scheduled">Scheduled</option>
							<option value="draft">Draft</option>
							<option value="partial">Partial</option>
							<option value="failed">Failed</option>
						</select>
						<select class="filter-select" bind:value={platformFilter}>
							<option value="all">All platforms</option>
							<option value="instagram">Instagram</option>
							<option value="tiktok">TikTok</option>
							<option value="youtube">YouTube</option>
							<option value="facebook">Facebook</option>
						</select>
					</div>
					<div class="feed-actions">
						<button class="btn-generate" onclick={generatePostNow} disabled={generatingPost || feedLoading}>
							{#if generatingPost}
								<span class="spinner-sm"></span> Generating…
							{:else}
								✨ Generate Now
							{/if}
						</button>
						<button class="btn-sync" onclick={syncFeed} disabled={syncingFeed || feedLoading}>
							{#if syncingFeed}
								<span class="spinner-sm"></span> Syncing…
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>
								Sync Feed
							{/if}
						</button>
					</div>
				</div>

				{#if feedLoading}
					<div class="feed-loading">
						<span class="spinner-lg"></span>
						<p>Loading posts…</p>
					</div>
				{:else if filteredPosts.length === 0}
					<div class="feed-empty">
						<span class="empty-icon">📱</span>
						<h3>No posts yet</h3>
						<p>{feedFilter !== 'all' || platformFilter !== 'all' ? 'No posts match these filters.' : 'Connect platforms and generate your first post.'}</p>
						{#if feedFilter === 'all' && platformFilter === 'all'}
							<div class="feed-empty-actions">
								<button class="btn-generate" onclick={generatePostNow} disabled={generatingPost}>
									{generatingPost ? 'Generating…' : '✨ Generate First Post'}
								</button>
								<button type="button" class="btn-sync" onclick={() => (activeTab = 'connections')}>
									Manage Connections
								</button>
							</div>
						{/if}
					</div>
				{:else}
					<div class="post-mosaic">
						{#each filteredPosts as post (post.id)}
							<PostCard {post} onOpen={(p) => (modalPost = p)} />
						{/each}
					</div>
				{/if}
			</div>

			<PostDrawer
				post={modalPost}
				onClose={() => (modalPost = null)}
				onDelete={handleDeletePost}
				onApprove={handleApprovePost}
				approving={approvingPostId === modalPost?.id}
				deleting={deletingPostId === modalPost?.id}
			/>
			{#if manualDeleteNotice}
				<ManualDeleteNotice entries={manualDeleteNotice} onClose={() => (manualDeleteNotice = null)} />
			{/if}

		<!-- PROFILE TAB -->
		{:else if activeTab === 'profile'}
			<div class="profile-tab">
				<!-- Identity section -->
				<section class="profile-section">
					<div class="section-header">
						<h2 class="section-title">Identity</h2>
						<p class="section-desc">Core presentation — name, personality, capabilities, and visual theme.</p>
					</div>

					<div class="fields-grid">
						<div class="field-group">
							<label for="p-name">Agent Name</label>
							<input id="p-name" type="text" bind:value={editName} placeholder="e.g. Veronica Active" />
						</div>
						<div class="field-group">
							<label for="p-handle">Handle</label>
							<input id="p-handle" type="text" bind:value={editHandle} placeholder="e.g. @veronica_ai" />
						</div>
						<div class="field-group">
							<label for="p-niche">Niche</label>
							<input id="p-niche" type="text" bind:value={editNiche} placeholder="e.g. Beauty & Wellness" />
						</div>
						<div class="field-group">
							<label for="p-initial">Avatar Initial</label>
							<input id="p-initial" type="text" maxlength="2" bind:value={editInitial} placeholder="e.g. V" />
						</div>
						<div class="field-group col-span-2">
							<label>Status</label>
							<div class="status-row">
								{#each ['active', 'paused', 'pending'] as s}
									<button
										type="button"
										class="status-btn"
										class:selected={editStatus === s}
										onclick={() => (editStatus = s as any)}
									>
										<span class="status-dot-sm" style="background: {getStatusColor(s)}"></span>
										{s}
									</button>
								{/each}
							</div>
						</div>

						<div class="field-group col-span-2">
							<label>Profile Picture</label>
							<p class="section-desc" style="margin-bottom: 0.75rem;">
								The AI-generated character used to keep this persona's face consistent across its
								spokesperson videos — used as the profile picture everywhere once generated.
							</p>
							<div class="avatar-gen-row">
								<div class="avatar-gen-preview" style={characterRef ? '' : `background: ${editGradient}`}>
									{#if characterRef}
										<img src={characterRef} alt={editName} />
									{:else}
										{editInitial || editName?.[0]?.toUpperCase() || '?'}
									{/if}
								</div>
								<div class="avatar-gen-actions">
									<button
										type="button"
										class="btn-sync"
										onclick={generateAvatar}
										disabled={generatingAvatar}
									>
										{#if generatingAvatar}
											<span class="spinner-sm"></span> Generating…
										{:else}
											✨ {characterRef ? 'Regenerate' : 'Generate'} Profile Picture
										{/if}
									</button>
									<label class="btn-sync file-upload-btn" class:disabled={generatingAvatar} aria-disabled={generatingAvatar}>
										📷 Upload Reference Photo
										<input
											type="file"
											accept="image/*"
											onchange={onReferenceFileChange}
											disabled={generatingAvatar}
											hidden
										/>
									</label>
									{#if !characterRef}
										<p class="field-hint">No photo yet — falls back to the gradient below until generated.</p>
									{/if}
									<p class="field-hint">~$0.08 per generation (Nano Banana 2 image call).</p>
								</div>
							</div>

							{#if referencePreviewUrl}
								<div class="reference-preview-row">
									<img src={referencePreviewUrl} alt="Reference upload preview" class="reference-preview-thumb" />
									<div class="avatar-gen-actions">
										<button
											type="button"
											class="btn-generate"
											onclick={generateAvatarFromReference}
											disabled={generatingAvatar}
										>
											{#if generatingAvatar}
												<span class="spinner-sm"></span> Generating (sheet + hero shot, ~30-60s)…
											{:else}
												✨ Generate Character Sheet From This Photo
											{/if}
										</button>
										<button type="button" class="btn-clear-reference" onclick={clearReferenceFile} disabled={generatingAvatar}>
											Cancel
										</button>
										<p class="field-hint">
											Generates a full turnaround/reference sheet (multiple angles + detail close-ups) from this
											photo, then pins it as the profile picture. ~$0.16 (2 Nano Banana 2 calls).
										</p>
									</div>
								</div>
							{/if}
						</div>

						{#if referenceKit.full_body}
							<div class="field-group col-span-2">
								<label>Reference Kit</label>
								<p class="section-desc" style="margin-bottom: 0.75rem;">
									{#if referenceKit.sheet}
										Once you're happy with the profile picture above, generate the rest of the
										consistency kit — side profiles, then a facial close-up. Each stage below is
										~$0.08 (one Nano Banana 2 call).
									{:else}
										This profile picture was generated from scratch, so there's no character sheet to
										build the rest of the kit from. Upload a reference photo above to unlock side
										profiles and facial close-ups for stronger face consistency in cinematic videos.
									{/if}
								</p>
								<div class="kit-stage-row">
									<div class="kit-stage">
										<span class="kit-stage-label">1. Full body</span>
										<img src={referenceKit.full_body} alt="Full body reference" class="kit-stage-thumb" />
									</div>
									<div class="kit-stage">
										<span class="kit-stage-label">2. Side profiles</span>
										{#if referenceKit.side_profiles}
											<img src={referenceKit.side_profiles} alt="Side profile composite" class="kit-stage-thumb wide" />
										{:else if referenceKit.sheet}
											<button
												type="button"
												class="btn-sync kit-stage-generate"
												onclick={() => generateKitStage('side_profiles')}
												disabled={generatingKitStage !== null}
											>
												{#if generatingKitStage === 'side_profiles'}
													<span class="spinner-sm"></span> Generating…
												{:else}
													Generate
												{/if}
											</button>
										{:else}
											<span class="kit-stage-locked">Upload a reference photo to unlock (needs a character sheet)</span>
										{/if}
									</div>
									<div class="kit-stage">
										<span class="kit-stage-label">3. Facial close-up</span>
										{#if referenceKit.face_closeup}
											<img src={referenceKit.face_closeup} alt="Facial close-up" class="kit-stage-thumb" />
										{:else if referenceKit.side_profiles}
											<button
												type="button"
												class="btn-sync kit-stage-generate"
												onclick={() => generateKitStage('face_closeup')}
												disabled={generatingKitStage !== null}
											>
												{#if generatingKitStage === 'face_closeup'}
													<span class="spinner-sm"></span> Generating…
												{:else}
													Generate
												{/if}
											</button>
										{:else}
											<span class="kit-stage-locked">Generate side profiles first</span>
										{/if}
									</div>
									<div class="kit-stage">
										<span class="kit-stage-label">4. Feature grid</span>
										{#if referenceKit.feature_grid}
											<img src={referenceKit.feature_grid} alt="Feature grid" class="kit-stage-thumb" />
										{:else if referenceKit.face_closeup}
											<button
												type="button"
												class="btn-sync kit-stage-generate"
												onclick={() => generateKitStage('feature_grid')}
												disabled={generatingKitStage !== null}
											>
												{#if generatingKitStage === 'feature_grid'}
													<span class="spinner-sm"></span> Generating…
												{:else}
													Generate
												{/if}
											</button>
										{:else}
											<span class="kit-stage-locked">Generate facial close-up first</span>
										{/if}
									</div>
								</div>
							</div>
						{/if}

						<div class="field-group col-span-2">
							<label>Avatar Gradient (fallback)</label>
							<div class="gradient-row">
								{#each GRADIENT_PRESETS as preset}
									<button
										type="button"
										class="gradient-swatch"
										class:selected={editGradient === preset.gradient}
										style="background: {preset.gradient}"
										title={preset.name}
										onclick={() => (editGradient = preset.gradient)}
									></button>
								{/each}
								<div class="gradient-preview" style="background: {editGradient}">
									{editInitial || editName?.[0]?.toUpperCase() || '?'}
								</div>
							</div>
						</div>

						<div class="field-group col-span-2">
							<label for="p-soul">Soul / Personality</label>
							<textarea id="p-soul" bind:value={soulText} rows="6" placeholder="Define your agent's personality, voice, and behavioral directives…"></textarea>
						</div>
						<div class="field-group col-span-2">
							<label for="p-skills">Skills & Capabilities</label>
							<textarea id="p-skills" bind:value={skillsText} rows="5" placeholder="Define skills, content capabilities, and learning loops…"></textarea>
						</div>
						<div class="field-group col-span-2">
							<label for="p-tools">Tools & Integrations</label>
							<textarea id="p-tools" bind:value={toolsText} rows="4" placeholder="Configure platforms, integrations, and capability layers…"></textarea>
						</div>

						<div class="field-group">
							<label for="p-supervisor">Supervisor (Overseer)</label>
							<select id="p-supervisor" bind:value={editSupervisorId}>
								<option value={null}>None — Standalone</option>
								{#each supervisors as sup}
									<option value={sup.id}>{sup.name} ({sup.handle})</option>
								{/each}
							</select>
						</div>
						<div class="field-group">
							<label for="p-runtime">Runtime Owner</label>
							<select id="p-runtime" bind:value={editRuntimeOwner}>
								<option value="svelte-gemini">Svelte UI Runtime</option>
								{#if agent?.is_overseer}
									<option value="hermes-daemon">Hermes Daemon</option>
								{/if}
								<option value="hermes-orchestrated">Hermes Orchestrated</option>
							</select>
						</div>
					</div>
				</section>

				<!-- Automation section -->
				<section class="profile-section">
					<div class="section-header">
						<h2 class="section-title">Automation</h2>
						<p class="section-desc">Schedule, autonomy level, and content sourcing mode.</p>
					</div>

					<div class="fields-grid">
						<div class="field-group">
							<label for="p-tz">Timezone</label>
							<select id="p-tz" bind:value={timezone}>
								{#each timezones as tz}
									<option value={tz.value}>{tz.label}</option>
								{/each}
							</select>
						</div>
						<div class="field-group">
							<label for="p-voice">UGC Voice</label>
							<div class="voice-picker-row">
								<select id="p-voice" bind:value={selectedVoice}>
									{#each voiceCatalog as v}
										<option value={v.name}>{v.label} · {v.gender === 'male' ? '♂' : '♀'} · {v.style}</option>
									{:else}
										<option value={selectedVoice}>{selectedVoice}</option>
									{/each}
								</select>
								<button type="button" class="btn-sync" onclick={previewVoice} disabled={previewingVoice}>
									{previewingVoice ? '…' : '▶ Preview'}
								</button>
							</div>
							<p class="field-hint">The video's spoken voice — pin one that matches this persona's on-camera character.</p>
						</div>
						<div class="field-group">
							<label for="p-ppd">Posts Per Day: <strong>{postsPerDay}</strong></label>
							<div class="slider-row">
								<span class="slider-cap">1</span>
								<input id="p-ppd" type="range" min="1" max="10" step="1" bind:value={postsPerDay} />
								<span class="slider-cap">10</span>
							</div>
						</div>
						<div class="field-group col-span-2">
							<label>Active Hours</label>
							<div class="hours-row">
								<div class="hour-pick">
									<span class="hour-label">Start</span>
									<select bind:value={activeHoursStart}>
										{#each Array.from({ length: 24 }, (_, i) => i) as h}
											<option value={h}>{formatHour(h)}</option>
										{/each}
									</select>
								</div>
								<span class="hour-arrow">→</span>
								<div class="hour-pick">
									<span class="hour-label">End</span>
									<select bind:value={activeHoursEnd}>
										{#each Array.from({ length: 24 }, (_, i) => i) as h}
											<option value={h}>{formatHour(h)}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>

						<div class="field-group col-span-2">
							<label>Autonomy Level</label>
							<div class="autonomy-cards">
								{#each autonomyKeys as level}
									{@const meta = AUTONOMY_LABELS[level]}
									<button
										class="autonomy-card"
										class:selected={autonomyLevel === level}
										onclick={() => (autonomyLevel = level)}
									>
										<div class="autonomy-radio">
											<div class="radio-outer">{#if autonomyLevel === level}<div class="radio-inner"></div>{/if}</div>
										</div>
										<span class="autonomy-icon">{meta.icon}</span>
										<span class="autonomy-label">{meta.label}</span>
										<p class="autonomy-desc">{meta.description}</p>
									</button>
								{/each}
							</div>
						</div>

						<div class="field-group col-span-2">
							<label>Content Source</label>
							<div class="source-cards">
								<button type="button" class="autonomy-card" class:selected={!rssActive} onclick={() => (rssActive = false)}>
									<div class="autonomy-radio"><div class="radio-outer">{#if !rssActive}<div class="radio-inner"></div>{/if}</div></div>
									<span class="autonomy-icon">✨</span>
									<span class="autonomy-label">Dynamic Generation</span>
									<p class="autonomy-desc">Original content from niche, trends, and persona directives.</p>
								</button>
								<button type="button" class="autonomy-card" class:selected={rssActive} onclick={() => (rssActive = true)}>
									<div class="autonomy-radio"><div class="radio-outer">{#if rssActive}<div class="radio-inner"></div>{/if}</div></div>
									<span class="autonomy-icon">📰</span>
									<span class="autonomy-label">RSS Auto-Repurpose</span>
									<p class="autonomy-desc">Monitor an RSS feed and spin items in the agent's voice.</p>
								</button>
							</div>
							{#if rssActive}
								<div style="margin-top: 1rem;" transition:slide={{ duration: 250 }}>
									<input
										type="url"
										class="field-input"
										placeholder="https://example.com/feed.xml"
										bind:value={rssUrl}
										style="width: 100%; margin-bottom: 0.5rem;"
									/>
									<p class="field-hint">Last polled: {rssLastPolledAt ? new Date(rssLastPolledAt).toLocaleString() : 'Never'}</p>
								</div>
							{/if}
						</div>
					</div>
				</section>

				<!-- Save + Danger zone -->
				<div class="profile-footer">
					<button class="btn-save" onclick={saveProfile} disabled={saving}>
						{#if saving}<span class="spinner-sm"></span> Saving…{:else}Save Profile{/if}
					</button>
				</div>

				<div class="danger-zone">
					<h4>Danger Zone</h4>
					<p>Permanently delete this agent and all associated data. This cannot be undone.</p>
					<button type="button" class="btn-danger" onclick={deleteAgent}>Delete Agent</button>
				</div>
			</div>

		<!-- CONNECTIONS TAB -->
		{:else if activeTab === 'connections'}
			<div class="connections-tab">
				{#if statusLoading}
					<div class="feed-loading"><span class="spinner-lg"></span><p>Checking connections…</p></div>
				{:else}
					<!-- Summary bar -->
					<div class="conn-summary">
						<span class="conn-count-badge">{computedMetrics.connectedCount} / {PLATFORMS.length}</span>
						<span class="conn-count-label">Active connections</span>
						<div class="conn-quick-links">
							{#each PLATFORMS as p}
								{#if !platformStatuses[p.key]?.connected}
									<button
										type="button"
										class="btn-connect-inline"
										disabled={connectingPlatform === p.key || platformStatuses[p.key]?.configured === false}
										onclick={() => connectPlatform(p.key)}
									>
										{connectingPlatform === p.key ? 'Connecting…' : `+ ${p.name}`}
									</button>
								{/if}
							{/each}
						</div>
					</div>

					{#if computedMetrics.connectedCount === 0}
						<div class="conn-empty">
							<span>🔌</span>
							<p>No platforms connected. Use the buttons above to link your first account.</p>
						</div>
					{:else}
						<div class="platforms-grid">
							{#each PLATFORMS.filter(p => platformStatuses[p.key]?.connected) as platform}
								{@const status = platformStatuses[platform.key]}
								<div class="platform-card" style="--platform-color: {platform.color}">
									<div class="platform-card-header">
										<!-- Platform icon -->
										<div class="platform-icon">
											{#if platform.key === 'tiktok'}
												<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.89a8.1 8.1 0 004.77 1.54V7.01a4.85 4.85 0 01-1-.32z" fill={platform.color}/></svg>
											{:else if platform.key === 'instagram'}
												<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke={platform.color} stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke={platform.color} stroke-width="1.8"/><circle cx="17.5" cy="6.5" r="1.5" fill={platform.color}/></svg>
											{:else if platform.key === 'youtube'}
												<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29.94 29.94 0 001 12a29.94 29.94 0 00.46 5.58 2.78 2.78 0 001.94 2C5.12 20 12 20 12 20s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29.94 29.94 0 0023 12a29.94 29.94 0 00-.46-5.58z" fill={platform.color}/><path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="#fff"/></svg>
											{:else if platform.key === 'facebook'}
												<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.875V12h3.328l-.532 3.47h-2.796v8.384C19.612 22.954 24 17.99 24 12z" fill={platform.color}/></svg>
											{/if}
										</div>
										<div class="platform-name-block">
											<span class="platform-name">{platform.name}</span>
											{#if status?.status === 'reauth_required'}
												<span class="conn-badge error">Reconnect</span>
											{:else if status?.status === 'provider_unavailable'}
												<span class="conn-badge warn">Stale</span>
											{/if}
										</div>
										<button
											type="button"
											class="btn-collapse"
											onclick={() => (collapsedPlatforms[platform.key] = !collapsedPlatforms[platform.key])}
											style="transform: rotate({collapsedPlatforms[platform.key] ? '180deg' : '0deg'})"
										>
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
										</button>
									</div>

									{#if !collapsedPlatforms[platform.key]}
										<div class="platform-body" transition:slide={{ duration: 200 }}>
											<div class="handle-row">
												<span class="platform-handle">{status?.handle ?? '@connected'}</span>
												{#if status?.verified}
													<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 12c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
												{/if}
												{#if status?.handle}
													{@const isMain = agent.handle === status.handle}
													<button
														type="button"
														class="btn-star"
														title={isMain ? 'Main handle' : 'Set as main handle'}
														onclick={() => setMainHandle(status.handle!)}
													>
														<svg width="14" height="14" viewBox="0 0 24 24" fill={isMain ? '#F59E0B' : 'none'} stroke={isMain ? '#F59E0B' : 'var(--text-dim)'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
													</button>
												{/if}
											</div>
											<span class="last-sync">Last sync: {formatSyncTime(status?.lastSync)}</span>
											{#if (status?.followers ?? 0) > 0 || (status?.engagement_rate ?? 0) > 0}
												<div class="platform-stats">
													{#if status?.followers}
														<span class="stat-badge">👥 {status.followers >= 1000 ? (status.followers / 1000).toFixed(1) + 'K' : status.followers} followers</span>
													{/if}
													{#if status?.engagement_rate}
														<span class="stat-badge">⚡ {status.engagement_rate}% eng</span>
													{/if}
												</div>
											{/if}
											<button class="btn-disconnect" onclick={() => disconnectPlatform(platform.key)}>
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
												Disconnect
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<AgentConnectionStats
						{platformStatuses}
						{platformMetrics}
						platforms={PLATFORMS}
					/>
				{/if}
			</div>

		<!-- ASSETS TAB -->
		{:else if activeTab === 'assets'}
			<div class="assets-tab">
				{#if feedLoading && assetItems.length === 0}
					<div class="feed-loading"><span class="spinner"></span> Loading assets…</div>
				{:else if assetItems.length === 0}
					<div class="feed-empty">
						<span class="empty-icon">🖼</span>
						<h3>No assets yet</h3>
						<p>Every image and video generated for this persona will collect here — post media, poster stills, storyboards, the profile picture, and the reference kit.</p>
					</div>
				{:else}
					<p class="assets-count">{assetItems.length} generated asset{assetItems.length === 1 ? '' : 's'}</p>
					<div class="assets-grid">
						{#each assetItems as asset (asset.url)}
							<button type="button" class="asset-tile" onclick={() => (assetLightbox = asset)} aria-label="View {asset.label}">
								{#if asset.type === 'video'}
									<video src={asset.url} muted playsinline preload="metadata"></video>
									<span class="asset-video-badge">▶</span>
								{:else}
									<img src={asset.url} loading="lazy" alt={asset.label} />
								{/if}
								<span class="asset-label">{asset.label}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if assetLightbox}
	<div class="lightbox-backdrop" onclick={() => (assetLightbox = null)} role="presentation">
		<div class="lightbox-content" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={assetLightbox.label}>
			{#if assetLightbox.type === 'video'}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={assetLightbox.url} controls autoplay playsinline></video>
			{:else}
				<img src={assetLightbox.url} alt={assetLightbox.label} />
			{/if}
			<div class="lightbox-bar">
				<span>{assetLightbox.label}</span>
				<a href={assetLightbox.url} target="_blank" rel="noopener noreferrer">Open original ↗</a>
				<button type="button" onclick={() => (assetLightbox = null)}>Close</button>
			</div>
		</div>
	</div>
{/if}
{/if}

<style>
	/* ── Page ── */
	.persona-page {
		max-width: 900px;
		margin: 0 auto;
	}

	/* ── Assets tab ── */
	.assets-count {
		font-size: 0.78rem;
		color: var(--text-dim);
		margin: 0 0 0.75rem;
	}

	.assets-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.75rem;
	}

	.asset-tile {
		position: relative;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--surface);
		cursor: pointer;
		aspect-ratio: 1;
		transition: border-color 0.15s ease, transform 0.15s ease;
	}

	.asset-tile:hover {
		border-color: var(--accent-mid);
		transform: translateY(-2px);
	}

	.asset-tile img,
	.asset-tile video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.asset-video-badge {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		font-size: 10px;
		border-radius: 999px;
		pointer-events: none;
	}

	.asset-label {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 1rem 0.5rem 0.35rem;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
		color: #fff;
		font-size: 0.62rem;
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}

	.lightbox-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(10, 14, 26, 0.88);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1100;
		padding: 1.5rem;
	}

	.lightbox-content {
		max-width: min(920px, 94vw);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--surface);
		border: 1px solid var(--border-strong);
	}

	.lightbox-content img,
	.lightbox-content video {
		max-width: 100%;
		max-height: calc(90vh - 52px);
		object-fit: contain;
		background: #000;
	}

	.lightbox-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.lightbox-bar span {
		flex: 1;
		font-weight: 600;
	}

	.lightbox-bar a {
		color: var(--accent);
		text-decoration: none;
		font-weight: 600;
	}

	.lightbox-bar button {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text-muted);
		padding: 0.3rem 0.8rem;
		font-size: 0.72rem;
		cursor: pointer;
	}

	.no-agent {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-dim);
	}

	/* ── Hero ── */
	.persona-hero {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 1.75rem 2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.hero-avatar {
		width: 64px;
		height: 64px;
		border-radius: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0,0,0,0.25);
	}

	.hero-avatar img,
	.tab-nav-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.hero-info {
		flex: 1;
		min-width: 0;
	}

	.hero-name-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.4rem;
	}

	.hero-name {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
	}

	.hero-handle {
		font-size: 0.85rem;
		color: var(--text-dim);
		font-family: var(--font-mono);
	}

	.hero-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.hero-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		color: var(--text-muted);
		flex-wrap: wrap;
	}

	.hero-sep { color: var(--border-strong); }
	.hero-niche { color: var(--accent); font-weight: 600; }

	.hero-stats {
		display: flex;
		gap: 1rem;
		flex-shrink: 0;
	}

	.stat-chip {
		display: flex;
		flex-direction: column;
		align-items: center;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.5rem 1rem;
		min-width: 60px;
	}

	.stat-val {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
	}

	.stat-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		font-weight: 600;
	}

	/* ── Tabs ── */
	.tab-nav {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 5px;
		margin-bottom: 1.5rem;
		position: sticky;
		top: 0;
		z-index: 20;
		backdrop-filter: blur(16px) saturate(180%);
		-webkit-backdrop-filter: blur(16px) saturate(180%);
	}

	.tab-nav-identity {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-left: 0.35rem;
		flex-shrink: 0;
		min-width: 0;
	}

	.tab-nav-avatar {
		width: 26px;
		height: 26px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		overflow: hidden;
	}

	.tab-nav-name {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 140px;
	}

	.tab-nav-buttons {
		display: flex;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}

	.tab-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 0.55rem 1rem;
		border-radius: 9px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		position: relative;
	}

	.tab-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	.tab-btn.active {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}

	.tab-badge {
		background: var(--success);
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		border-radius: 999px;
		padding: 1px 6px;
		min-width: 18px;
		text-align: center;
	}

	/* ── Feed ── */
	.feed-tab {}

	.feed-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.feed-filters {
		display: flex;
		gap: 0.5rem;
	}

	.filter-select {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.45rem 0.75rem;
		color: var(--text);
		font-size: 0.8rem;
		font-family: var(--font-body);
		cursor: pointer;
		outline: none;
	}

	.feed-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-generate {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--gradient);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s ease, transform 0.15s ease;
	}

	.btn-generate:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
	.btn-generate:disabled { opacity: 0.6; cursor: not-allowed; }

	.btn-sync {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface);
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-sync:hover:not(:disabled) { border-color: var(--accent-mid); color: var(--text); }
	.btn-sync:disabled { opacity: 0.6; cursor: not-allowed; }

	.feed-empty-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.feed-loading, .feed-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		color: var(--text-dim);
		text-align: center;
		gap: 0.75rem;
	}

	.feed-empty .empty-icon { font-size: 2.5rem; }
	.feed-empty h3 { font-size: 1rem; font-weight: 600; color: var(--text); margin: 0; }
	.feed-empty p { font-size: 0.82rem; max-width: 340px; margin: 0; }

	.post-mosaic {
		columns: 280px;
		column-gap: 1rem;
	}

	/* ── Profile ── */
	.profile-tab {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.profile-section {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1.75rem;
	}

	.section-header {
		margin-bottom: 1.5rem;
	}

	.section-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text);
		margin: 0 0 0.25rem;
	}

	.section-desc {
		font-size: 0.8rem;
		color: var(--text-dim);
		margin: 0;
	}

	.fields-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.col-span-2 { grid-column: span 2; }

	.field-group label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}

	.field-group input[type="text"],
	.field-group input[type="url"],
	.field-group select,
	.field-input,
	.field-group textarea {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.7rem 0.9rem;
		color: var(--text);
		font-family: var(--font-body);
		font-size: 0.85rem;
		outline: none;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
		width: 100%;
		box-sizing: border-box;
	}

	.field-group input:focus,
	.field-group select:focus,
	.field-group textarea:focus,
	.field-input:focus {
		border-color: var(--accent-mid);
		box-shadow: 0 0 0 3px rgba(124, 106, 237, 0.08);
	}

	.field-group textarea { resize: vertical; }

	.field-hint {
		font-size: 0.72rem;
		color: var(--text-dim);
		margin: 0;
	}

	.voice-picker-row {
		display: flex;
		gap: 0.5rem;
	}

	.voice-picker-row select {
		flex: 1;
		min-width: 0;
	}

	.status-row {
		display: flex;
		gap: 0.5rem;
	}

	.status-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.6rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text-dim);
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		text-transform: capitalize;
	}

	.status-btn.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 700;
	}

	.status-dot-sm {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.avatar-gen-row {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		flex-wrap: wrap;
	}

	.avatar-gen-preview {
		width: 96px;
		height: 96px;
		border-radius: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		overflow: hidden;
		border: 1px solid var(--border);
	}

	.avatar-gen-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.avatar-gen-actions {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-start;
	}

	.file-upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
	}

	.file-upload-btn.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		pointer-events: none;
	}

	.reference-preview-row {
		display: flex;
		align-items: flex-start;
		gap: 1.25rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--border);
	}

	.reference-preview-thumb {
		width: 96px;
		height: 96px;
		border-radius: 12px;
		object-fit: cover;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}

	.btn-clear-reference {
		background: none;
		border: none;
		color: var(--text-dim);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.2rem 0;
		text-decoration: underline;
	}

	.btn-clear-reference:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.kit-stage-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.kit-stage {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.kit-stage-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.kit-stage-thumb {
		width: 120px;
		height: 120px;
		border-radius: 12px;
		object-fit: cover;
		border: 1px solid var(--border);
	}

	.kit-stage-thumb.wide {
		width: 200px;
	}

	.kit-stage-generate {
		width: 120px;
		height: 120px;
		border-radius: 12px;
		border: 1px dashed var(--border-strong);
		background: var(--surface-2);
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		font-size: 0.78rem;
	}

	.kit-stage-locked {
		width: 120px;
		height: 120px;
		border-radius: 12px;
		border: 1px dashed var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		font-size: 0.68rem;
		color: var(--text-dim);
		padding: 0.5rem;
	}

	.gradient-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.gradient-swatch {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		border: 3px solid transparent;
		cursor: pointer;
		transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
		outline: none;
	}

	.gradient-swatch.selected {
		border-color: var(--accent);
		box-shadow: 0 0 10px rgba(124, 106, 237, 0.4);
	}

	.gradient-swatch:hover { transform: scale(1.1); }

	.gradient-preview {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85rem;
		font-weight: 800;
		color: #fff;
		margin-left: auto;
	}

	.slider-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.slider-cap {
		font-size: 0.75rem;
		color: var(--text-dim);
		font-weight: 600;
		flex-shrink: 0;
	}

	.slider-row input[type="range"] {
		flex: 1;
		accent-color: var(--accent);
	}

	.hours-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.hour-pick {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		flex: 1;
	}

	.hour-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		font-weight: 700;
	}

	.hour-arrow {
		color: var(--text-dim);
		font-size: 1.1rem;
		margin-top: 18px;
	}

	.autonomy-cards, .source-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem;
	}

	.autonomy-card {
		display: grid;
		grid-template-columns: auto auto 1fr;
		grid-template-rows: auto auto;
		gap: 0.3rem 0.6rem;
		align-items: start;
		padding: 1rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.autonomy-card.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.autonomy-radio { grid-column: 1; grid-row: 1 / 3; align-self: center; }

	.radio-outer {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid var(--border-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s ease;
	}

	.autonomy-card.selected .radio-outer { border-color: var(--accent); }

	.radio-inner {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
	}

	.autonomy-icon { grid-column: 2; grid-row: 1; font-size: 1rem; }
	.autonomy-label { grid-column: 3; grid-row: 1; font-size: 0.85rem; font-weight: 600; color: var(--text); }
	.autonomy-desc { grid-column: 2 / 4; grid-row: 2; font-size: 0.75rem; color: var(--text-dim); margin: 0; line-height: 1.4; }

	.profile-footer {
		display: flex;
		justify-content: flex-end;
	}

	.btn-save {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--gradient);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.65rem 1.5rem;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s ease;
	}

	.btn-save:disabled { opacity: 0.6; cursor: not-allowed; }

	.danger-zone {
		background: rgba(239, 68, 68, 0.04);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: var(--radius-md);
		padding: 1.25rem 1.5rem;
	}

	.danger-zone h4 {
		color: var(--error);
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 0.35rem;
	}

	.danger-zone p {
		font-size: 0.78rem;
		color: var(--text-dim);
		margin: 0 0 1rem;
	}

	.btn-danger {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
		border-radius: var(--radius-sm);
		padding: 0.6rem 1.1rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-danger:hover {
		background: rgba(239, 68, 68, 0.15);
		border-color: rgba(239, 68, 68, 0.5);
	}

	/* ── Connections ── */
	.connections-tab {}

	.conn-summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.75rem 1.25rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.conn-count-badge {
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 11px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 999px;
	}

	.conn-count-label {
		font-size: 0.82rem;
		color: var(--text-muted);
		font-weight: 500;
	}

	.conn-quick-links {
		display: flex;
		gap: 0.4rem;
		margin-left: auto;
		flex-wrap: wrap;
	}

	.btn-connect-inline {
		font-size: 11px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 6px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-connect-inline:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.btn-connect-inline:disabled { opacity: 0.5; cursor: not-allowed; }

	.conn-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 2rem;
		border: 1px dashed var(--border);
		border-radius: var(--radius-md);
		color: var(--text-dim);
		text-align: center;
		font-size: 0.85rem;
	}

	.conn-empty span { font-size: 1.75rem; }

	.platforms-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.platform-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.platform-card-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.1rem;
		border-bottom: 1px solid var(--border);
	}

	.platform-icon {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: rgba(255,255,255,0.04);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.platform-name-block {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.platform-name {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text);
	}

	.conn-badge {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: 999px;
	}

	.conn-badge.error { color: var(--error); background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); }
	.conn-badge.warn { color: var(--warning); background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); }

	.btn-collapse {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		padding: 4px;
		display: flex;
		align-items: center;
		transition: color 0.15s ease, transform 0.2s ease;
	}

	.btn-collapse:hover { color: var(--text); }

	.platform-body {
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.handle-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.platform-handle {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text);
		font-family: var(--font-mono);
	}

	.btn-star {
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px;
		display: inline-flex;
		align-items: center;
		transition: transform 0.15s ease;
	}

	.btn-star:hover { transform: scale(1.2); }

	.last-sync {
		font-size: 0.72rem;
		color: var(--text-dim);
	}

	.platform-stats {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.stat-badge {
		font-size: 11px;
		background: rgba(255,255,255,0.04);
		color: var(--text-dim);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid rgba(255,255,255,0.08);
		font-weight: 500;
	}

	.btn-disconnect {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--error);
		background: rgba(239,68,68,0.06);
		border: 1px solid rgba(239,68,68,0.25);
		border-radius: 6px;
		padding: 0.35rem 0.75rem;
		cursor: pointer;
		transition: all 0.15s ease;
		align-self: flex-start;
		margin-top: 0.25rem;
	}

	.btn-disconnect:hover {
		background: rgba(239,68,68,0.12);
		border-color: rgba(239,68,68,0.45);
	}

	/* ── Spinners ── */
	.spinner-sm {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	.spinner-lg {
		display: block;
		width: 2rem;
		height: 2rem;
		border: 3px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		margin-bottom: 0.75rem;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.btn-primary {
		display: inline-block;
		background: var(--gradient);
		color: #fff;
		padding: 0.65rem 1.5rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.88rem;
		text-decoration: none;
		margin-top: 1rem;
	}

	/* ── Mobile ── */
	@media (max-width: 640px) {
		.persona-hero { gap: 1rem; }
		.hero-stats { display: none; }
		.fields-grid { grid-template-columns: 1fr; }
		.col-span-2 { grid-column: span 1; }
		.platforms-grid { grid-template-columns: 1fr; }
		.feed-toolbar { flex-direction: column; align-items: stretch; }
		.feed-actions { justify-content: flex-end; }
		.tab-nav-name { display: none; }
		.post-mosaic { columns: 1; }
	}
</style>
