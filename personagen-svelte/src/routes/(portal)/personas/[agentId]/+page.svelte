<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { slide } from 'svelte/transition';
	import { Accounts, Autopilot, Posts, BrandBrief, parseJsonResponse } from '$lib/services/api';
	import AgentConnectionStats from '$lib/components/agents/AgentConnectionStats.svelte';
	import { PRICING_MATRIX, priceOf } from '$lib/pricing';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import ManualDeleteNotice from '$lib/components/feed/ManualDeleteNotice.svelte';
	import { getPostDisplay } from '$lib/components/feed/postDisplay';
	import type { AutonomyLevel } from '$lib/types';
	import { AUTONOMY_LABELS } from '$lib/types';
	import { PLATFORMS as PLATFORM_REGISTRY, platformLabel } from '$lib/platforms';
	import GenerationComposer from '$lib/components/generation/GenerationComposer.svelte';
	import type { ComposerSpec } from '$lib/components/generation/types';
	import { NICHE_OPTIONS, APPEARANCE_FIELDS } from '$lib/persona-profile';
	import MediaPreviewModal from '$lib/components/generation/MediaPreviewModal.svelte';
	import {
		startGeneration,
		finishGeneration,
		failGeneration,
		kitJobId
	} from '$lib/stores/generations.svelte';

	let { data }: { data: any } = $props();

	// ── Confirm-before-generate ────────────────────────────────────────────
	// Every generate/draft action routes through here. The composer asks the
	// server to RESOLVE the request first (real prompt, real model, real cost),
	// shows it as an editable form, and only then runs it with what was approved.
	let composerSpec = $state<ComposerSpec | null>(null);
	let composerOpen = $state(false);
	let onComposerConfirm: (body: Record<string, unknown>) => void = () => {};

	function askToGenerate(
		spec: ComposerSpec,
		run: (body: Record<string, unknown>) => void | Promise<void>
	) {
		composerSpec = spec;
		onComposerConfirm = (body) => {
			composerOpen = false;
			void run(body);
		};
		composerOpen = true;
	}

	// ── Generated-asset preview (expand + regenerate) ──────────────────────
	let previewUrl = $state<string | null>(null);
	let previewTitle = $state('Generated asset');
	let previewRegenerate = $state<(() => void) | null>(null);
	let previewOpen = $state(false);

	function openPreview(url: string, title: string, regenerate: (() => void) | null = null) {
		previewUrl = url;
		previewTitle = title;
		previewRegenerate = regenerate;
		previewOpen = true;
	}

	let agent = $state<any>(data.agent ?? null);
	let supervisors = $derived(data.supervisors ?? []);
	// Tracks which agent's data is currently loaded into `agent`/the editable
	// fields below, so the resync effect (further down) can tell "navigated to
	// a different persona" apart from "same persona's data merely refreshed."
	let loadedAgentId: string | null = data.agent?.id ?? null;

	// ── Tab state ──────────────────────────────────────────────────
	function initialTab(): 'feed' | 'profile' | 'connections' {
		const t = $page.url.searchParams.get('tab');
		// Legacy ?tab=assets links land on the Feed tab in assets view — the
		// Assets tab was merged into Feed as a view toggle.
		return t === 'profile' || t === 'connections' ? t : 'feed';
	}
	let activeTab = $state<'feed' | 'profile' | 'connections'>(initialTab());
	// Feed tab renders one dataset through two lenses: the post mosaic, or the
	// flat grid of every generated visual (former Assets tab).
	let feedView = $state<'posts' | 'assets'>(
		$page.url.searchParams.get('tab') === 'assets' ? 'assets' : 'posts'
	);

	// ── Feed state ─────────────────────────────────────────────────
	let feedPosts = $state<any[]>([]);

	// Graduation signal: enough clean published posts + no recent failures →
	// safe to promote this persona from Semi (review phase) to Fully Autonomous.
	const GRADUATION_TARGET = 21; // ≈ 3/day × 7-day clean streak
	let publishedCleanCount = $derived(
		feedPosts.filter((p: any) => p.status === 'published').length
	);
	let recentFailedCount = $derived(
		feedPosts.filter((p: any) => p.status === 'failed' || p.status === 'partial').length
	);
	let graduationEligible = $derived(
		publishedCleanCount >= GRADUATION_TARGET && recentFailedCount === 0
	);
	let feedLoading = $state(false);
	let syncingFeed = $state(false);
	let generatingPost = $state(false);
	let feedFilter = $state<
		'all' | 'published' | 'scheduled' | 'publishing' | 'draft' | 'failed' | 'partial'
	>('all');
	// 'all' or any registry platform key — options render from the registry.
	let platformFilter = $state<string>('all');
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
	// Values are stage URLs (string) plus `<stage>_history` pools (string[]), so
	// the type is widened from the old string-only shape.
	let referenceKit = $state<Record<string, any>>(agent?.ugc_reference_kit ?? {});
	let generatingKitStage = $state<'full_body' | 'side_profiles' | 'face_closeup' | 'feature_grid' | null>(
		null
	);
	let editSupervisorId = $state<string | null>(agent?.supervisor_agent_id ?? null);
	let editRuntimeOwner = $state<'svelte-gemini' | 'hermes-daemon' | 'hermes-orchestrated'>(
		agent?.runtime_owner ?? 'svelte-gemini'
	);

	// ── Extended persona profile (stored in agent.market as JSON) ──────────
	function parsePersonaProfile(agent: any): Record<string, any> {
		try {
			if (agent?.market && typeof agent.market === 'string' && agent.market.startsWith('{')) {
				return JSON.parse(agent.market);
			}
		} catch { /* ignore */ }
		return {};
	}
	let personaProfile = $state<Record<string, any>>(parsePersonaProfile(agent));
	// Multi-brand: which of the user's brand briefs this persona generates for.
	let selectedBrandBriefId = $state<string>(agent?.brand_brief_id ?? '');
	let brandBriefs = $derived<Array<{ id: string; name: string }>>(data.brandBriefs ?? []);
	// Age targeting as selectable buckets (multi-select) instead of dual sliders.
	const AGE_RANGES = [
		{ key: '13–17', lo: 13, hi: 17 },
		{ key: '18–24', lo: 18, hi: 24 },
		{ key: '25–34', lo: 25, hi: 34 },
		{ key: '35–44', lo: 35, hi: 44 },
		{ key: '45–54', lo: 45, hi: 54 },
		{ key: '55+', lo: 55, hi: 99 }
	];
	function deriveAgeRanges(p: Record<string, any>): string[] {
		if (Array.isArray(p.ageRanges)) return p.ageRanges;
		// Migrate legacy ageMin/ageMax → the buckets they overlap.
		const { ageMin, ageMax } = p;
		if (typeof ageMin === 'number' && typeof ageMax === 'number') {
			return AGE_RANGES.filter((r) => r.hi >= ageMin && r.lo <= ageMax).map((r) => r.key);
		}
		return [];
	}
	let ppAgeRanges = $state<string[]>(deriveAgeRanges(personaProfile));
	function toggleAgeRange(key: string) {
		ppAgeRanges = ppAgeRanges.includes(key)
			? ppAgeRanges.filter((k) => k !== key)
			: [...ppAgeRanges, key];
	}
	function toggleAllAgeRanges() {
		ppAgeRanges = ppAgeRanges.length === AGE_RANGES.length ? [] : AGE_RANGES.map((r) => r.key);
	}
	// Pre-fill from the explicit field, else the server's inference from the soul
	// text — so the picker shows the gender that will actually be generated,
	// not a blank the user has to notice. Persists only when they Save.
	let ppGender = $state<'' | 'female' | 'male'>(
		personaProfile.gender ?? (data.inferredGender as '' | 'female' | 'male' | null) ?? ''
	);
	let ppArchetype = $state<string>(personaProfile.archetype ?? '');
	let ppContentFocus = $state<string>(personaProfile.contentFocus ?? '');
	let ppPsychProfile = $state<string>(personaProfile.psychProfile ?? '');
	let ppContentAngle = $state<string>(personaProfile.contentAngle ?? '');
	let ppTargetAvatar = $state<string>(personaProfile.targetAvatar ?? '');
	// Appearance / wardrobe "dynamic variables" — the influencer's configurable look
	// (clothing, colors, hair, eyes, headwear, styling). Feeds the profile-picture
	// prompt; filled by "Generate for brand".
	let ppAppearance = $state<Record<string, string>>({ ...(personaProfile.appearance ?? {}) });

	const PERSONA_ARCHETYPES = [
		'The Creator', 'The Expert / Authority', 'The Relatable Friend', 'The Aspirational',
		'The Storyteller', 'The Activist / Advocate', 'The Entertainer', 'The Educator',
		'The Disruptor', 'The Community Builder'
	];
	const CONTENT_FOCUS_OPTIONS = [
		'Education & How-Tos', 'Entertainment & Humor', 'Lifestyle & Aesthetic',
		'Product Reviews & UGC', 'Inspiration & Motivation', 'Behind-the-Scenes',
		'News & Commentary', 'Tutorials & Demos', 'Personal Journey'
	];

	// NICHE_OPTIONS is imported from $lib/persona-profile (single source of truth,
	// shared with the "Generate for brand" generator).
	const STATUS_OPTIONS = ['active', 'paused', 'pending'];

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
	// Switching to Fully Autonomous means posts publish WITHOUT review — gate it
	// behind an explicit confirm (same native confirm pattern as persona delete),
	// reverting the select when the user backs out.
	let prevAutonomyLevel: AutonomyLevel = agent?.autonomy_level ?? 'advisor';
	function handleAutonomyChange() {
		if (autonomyLevel === 'fully_autonomous' && prevAutonomyLevel !== 'fully_autonomous') {
			const ok = confirm(
				`Switch ${agent?.name ?? 'this persona'} to Fully Autonomous?\n\nPosts will publish without review — the autopilot generates AND publishes them unattended. You can drop back to Semi at any time.`
			);
			if (!ok) {
				autonomyLevel = prevAutonomyLevel;
				return;
			}
		}
		prevAutonomyLevel = autonomyLevel;
	}
	let selectedVoice = $state(agent?.ugc_voice ?? 'Adam');
	let rssUrl = $state(agent?.rss_url ?? '');
	let rssActive = $state(agent?.rss_active ?? false);
	let rssLastPolledAt = $state<string | null>(agent?.rss_last_polled_at ?? null);

	// ── Connections state ──────────────────────────────────────────
	// Full connectable set, derived from the single platform registry (which
	// matches the connections table CHECK constraint and Zernio's supported
	// platforms) — adding a platform there makes it appear here automatically.
	const PLATFORMS = Object.values(PLATFORM_REGISTRY).map((p) => ({
		key: p.key,
		name: p.label,
		color: p.color
	}));

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
	// Where accounts get connected (Zernio dashboard), reported by check_status;
	// null = no Zernio key saved yet (UI forwards to Settings instead).
	let connectHub = $state<{ provider: string; url: string } | null>(null);
	// Zernio pay-per-account billing meter — GLOBAL across the key, not per persona
	// (2 free connected accounts, then $6/$3/$1 each by volume). null = no key.
	interface AccountMeter {
		total: number;
		freeUsed: number;
		freeRemaining: number;
		billable: number;
		monthlyCostUsd: number;
		nextAccountCostUsd: number;
		hasAnalyticsAccess: boolean;
	}
	let accountMeter = $state<AccountMeter | null>(null);
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
		{ value: 'Pacific/Midway', label: '(UTC−11) Midway' },
		{ value: 'Pacific/Honolulu', label: '(UTC−10) Hawaii' },
		{ value: 'America/Anchorage', label: '(UTC−09) Alaska' },
		{ value: 'America/Los_Angeles', label: '(UTC−08) Pacific — Los Angeles' },
		{ value: 'America/Denver', label: '(UTC−07) Mountain — Denver' },
		{ value: 'America/Chicago', label: '(UTC−06) Central — Chicago' },
		{ value: 'America/New_York', label: '(UTC−05) Eastern — New York' },
		{ value: 'America/Halifax', label: '(UTC−04) Atlantic — Halifax' },
		{ value: 'America/Sao_Paulo', label: '(UTC−03) São Paulo' },
		{ value: 'Atlantic/Azores', label: '(UTC−01) Azores' },
		{ value: 'Etc/UTC', label: '(UTC+00) UTC' },
		{ value: 'Europe/London', label: '(UTC+00) London' },
		{ value: 'Europe/Paris', label: '(UTC+01) Paris / Berlin / Madrid' },
		{ value: 'Europe/Athens', label: '(UTC+02) Athens / Cairo / Johannesburg' },
		{ value: 'Europe/Moscow', label: '(UTC+03) Moscow / Istanbul' },
		{ value: 'Asia/Dubai', label: '(UTC+04) Dubai' },
		{ value: 'Asia/Karachi', label: '(UTC+05) Karachi' },
		{ value: 'Asia/Kolkata', label: '(UTC+05:30) India' },
		{ value: 'Asia/Dhaka', label: '(UTC+06) Dhaka' },
		{ value: 'Asia/Bangkok', label: '(UTC+07) Bangkok / Jakarta' },
		{ value: 'Asia/Shanghai', label: '(UTC+08) China / Singapore' },
		{ value: 'Asia/Tokyo', label: '(UTC+09) Tokyo / Seoul' },
		{ value: 'Australia/Perth', label: '(UTC+08) Perth' },
		{ value: 'Australia/Darwin', label: '(UTC+09:30) Darwin' },
		{ value: 'Australia/Adelaide', label: '(UTC+09:30) Adelaide' },
		{ value: 'Australia/Brisbane', label: '(UTC+10) Brisbane' },
		{ value: 'Australia/Sydney', label: '(UTC+10) Sydney / Melbourne' },
		{ value: 'Pacific/Auckland', label: '(UTC+12) Auckland' }
	];


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
		selectedBrandBriefId = fresh.brand_brief_id ?? '';

		// Reset persona profile from new agent
		const freshProfile = parsePersonaProfile(fresh);
		personaProfile = freshProfile;
		ppAgeRanges = deriveAgeRanges(freshProfile);
		ppGender = freshProfile.gender ?? (data.inferredGender as '' | 'female' | 'male' | null) ?? '';
		ppArchetype = freshProfile.archetype ?? '';
		ppContentFocus = freshProfile.contentFocus ?? '';
		ppPsychProfile = freshProfile.psychProfile ?? '';
		ppContentAngle = freshProfile.contentAngle ?? '';
		ppTargetAvatar = freshProfile.targetAvatar ?? '';
		ppAppearance = { ...(freshProfile.appearance ?? {}) };

		soulText = fresh.soul ?? '';
		skillsText = fresh.skills ?? '';
		skillsList = parseSkills(fresh.skills ?? '');
		toolsList = parseTools(fresh.tools ?? '');
		toolsText = fresh.tools ?? '';

		timezone = fresh.timezone ?? 'Australia/Sydney';
		postsPerDay = fresh.posts_per_day ?? 3;
		activeHoursStart = fresh.active_hours_start ?? 8;
		activeHoursEnd = fresh.active_hours_end ?? 22;
		autonomyLevel = fresh.autonomy_level ?? 'advisor';
		prevAutonomyLevel = autonomyLevel;
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
		// Both feed views (posts mosaic + assets grid) derive from the same posts data.
		if (activeTab === 'feed' && agent?.id) loadFeed();
	});

	$effect(() => {
		if (activeTab === 'connections' && agent?.id) checkStatuses();
	});

	$effect(() => {
		if (activeTab === 'profile') loadVoiceCatalog();
	});

	// ── UGC voice picker ───────────────────────────────────────────
	let voiceCatalog = $state<Array<{ name: string; label: string; gender: 'male' | 'female'; style: string; accent?: string }>>([]);
	let previewingVoice = $state(false);
	let previewAudio: HTMLAudioElement | null = null;

	async function loadVoiceCatalog() {
		if (voiceCatalog.length > 0) return;
		try {
			const res = await fetch('/api/voices');
			const d = await parseJsonResponse<any>(res);
			if (d.success) voiceCatalog = d.voices;
		} catch (err) {
			console.error('[Voices] Failed to load catalog:', err);
		}
		// Once the catalog is known, silently align the picker to the persona's
		// gender (explicit or inferred) so what's shown matches what the server
		// will generate — no toast, since the user didn't just act.
		alignVoiceToGender(true);
	}

	/**
	 * Persona gender is the source of truth for the voice: a voice whose gender
	 * contradicts the persona's is swapped to the first matching-gender voice,
	 * so the mismatch is fixed BEFORE anything generates (the server enforces
	 * the same rule as the backstop). `silent` skips the toast for on-load
	 * alignment vs. an explicit gender change by the user.
	 */
	function alignVoiceToGender(silent = false) {
		if (ppGender !== 'male' && ppGender !== 'female') return;
		if (voiceCatalog.length === 0) return;
		const current = voiceCatalog.find((v) => v.name === selectedVoice);
		if (current && current.gender === ppGender) return;
		const aligned = voiceCatalog.find((v) => v.gender === ppGender);
		if (aligned) {
			selectedVoice = aligned.name;
			if (!silent) {
				showToast(`Voice switched to ${aligned.label} to match the ${ppGender} persona`, 'info');
			}
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
			const d = await parseJsonResponse<any>(res);
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
			const result = await parseJsonResponse<any>(res);
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

	// ── Autopilot manual top-up: fill this persona's review queue on demand ──
	let fillingDrafts = $state(false);
	async function fillDraftsNow() {
		if (!agent?.id || fillingDrafts) return;
		fillingDrafts = true;
		const jobId = kitJobId(agent.id, 'drafts');
		try {
			const res = await Autopilot.generateNow(agent.id);
			if (!res.success) {
				showToast(res.error || 'Draft generation failed', 'error');
				return;
			}

			// The run is DETACHED: the endpoint 202s immediately and never reports a
			// count. The old code read `data.generated` — always undefined now — so it
			// permanently claimed the runway was full and never refreshed the feed.
			// Instead we surface the job and let the drafts stream into the feed as
			// 'generating' cards, which is what the user actually wants to watch.
			startGeneration({
				id: jobId,
				kind: 'drafts',
				agentId: agent.id,
				label: 'Autopilot drafts'
			});
			showToast('Generating drafts — they appear in the feed as each one finishes', 'info');

			const deadline = Date.now() + 6 * 60 * 1000;
			let sawAny = false;
			while (Date.now() < deadline && !pageDestroyed) {
				await sleep(5000);
				if (pageDestroyed) break;
				await loadFeed();
				const running = feedPosts.some((p: any) => p.status === 'generating');
				if (running) sawAny = true;
				// Done once the drafts we saw have all landed. If nothing ever showed up
				// within the first ~25s, autopilot decided the runway was already full.
				if (sawAny && !running) break;
				if (!sawAny && Date.now() > deadline - 6 * 60 * 1000 + 25_000) {
					showToast('Draft runway is already full — no new drafts needed', 'info');
					break;
				}
			}
		} catch (err) {
			showToast('Draft generation failed: ' + (err as Error).message, 'error');
		} finally {
			finishGeneration(jobId);
			fillingDrafts = false;
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

	// ── Generation composer — every API-bound field is editable before send ──
	let showGenerateConfirm = $state(false);
	let confirmSkipNext = $state(false);
	let skipGenerateConfirm = $state(false);
	onMount(() => {
		skipGenerateConfirm = localStorage.getItem('pg-skip-generate-confirm') === '1';

		// Returning from a provider OAuth flow (Zernio appends ?connected=platform
		// to our callback): confirm, refresh statuses (which auto-imports the new
		// account), and clean the URL.
		const connectedParam = $page.url.searchParams.get('connected');
		if (connectedParam) {
			showToast(`${platformLabel(connectedParam)} connected — importing…`, 'success');
			void checkStatuses();
			const clean = new URL(window.location.href);
			clean.searchParams.delete('connected');
			clean.searchParams.delete('profileId');
			clean.searchParams.delete('accountId');
			clean.searchParams.delete('username');
			history.replaceState({}, '', clean.toString());
		}
	});

	let genTopic = $state('');
	let genScene = $state('');
	let genMedia = $state<'video' | 'image' | 'cinematic'>('video');
	let genProvider = $state<'auto' | 'fal' | 'openrouter'>('auto');
	let genPlatforms = $state<string[]>([]);
	let genProductId = $state('');
	let genProductPhotoUrl = $state('');
	let genCharacterRefUrl = $state('');
	let briefProducts = $state<any[]>([]);
	let briefLoaded = $state(false);

	let genEstimate = $derived.by(() => {
		const llm = 3 * priceOf('openrouter', 'llm');
		if (genMedia === 'image') {
			const img = genProvider === 'openrouter' ? priceOf('openrouter', 'image') : priceOf('fal', 'image', 'nano');
			return { low: +(img + llm).toFixed(2), high: +(img + llm).toFixed(2) };
		}
		if (genMedia === 'cinematic') {
			// fal-exclusive: 3-5 storyboard stills (Nano Banana) + one Kling O3 Pro
			// multi-shot reference video.
			const still = priceOf('fal', 'image', 'nano');
			const vid = priceOf('fal', 'video', 'pro');
			return { low: +(3 * still + vid + llm).toFixed(2), high: +(5 * still + vid + llm).toFixed(2) };
		}
		const img = genProvider === 'openrouter' ? priceOf('openrouter', 'image') : priceOf('fal', 'image', 'nano');
		const vidLow = genProvider === 'openrouter' ? priceOf('openrouter', 'video') : priceOf('fal', 'tts') + priceOf('fal', 'talking_head');
		const vidHigh = genProvider === 'openrouter' ? priceOf('openrouter', 'video') : priceOf('fal', 'video', 'standard');
		return {
			low: +(img + llm + Math.min(vidLow, vidHigh)).toFixed(2),
			high: +(img + llm + Math.max(vidLow, vidHigh)).toFixed(2)
		};
	});

	let connectedKeys = $derived(PLATFORMS.filter((p) => platformStatuses[p.key]?.connected).map((p) => p.key));

	async function openComposer() {
		genPlatforms = [...connectedKeys];
		showGenerateConfirm = true;
		if (!briefLoaded) {
			briefLoaded = true;
			try {
				const res = await BrandBrief.get();
				if (res.success && Array.isArray(res.data?.products)) briefProducts = res.data.products;
			} catch {
				/* composer works without the product list */
			}
		}
	}

	function toggleGenPlatform(key: string) {
		genPlatforms = genPlatforms.includes(key)
			? genPlatforms.filter((k) => k !== key)
			: [...genPlatforms, key];
	}

	/**
	 * Composer "✨ Generate" handler: bundles exactly what the user set in the
	 * dialog and sends it to generatePostNow (which posts it verbatim to
	 * /generate-post). Keys match what that endpoint reads — topic/media/
	 * provider/platforms/scene/product_id/photo/face.
	 */
	async function confirmGenerate() {
		showGenerateConfirm = false;
		await generatePostNow({
			topic: genTopic || undefined,
			media: genMedia,
			provider: genProvider,
			platforms: genPlatforms,
			scene: genScene || undefined,
			product_id: genProductId || undefined,
			product_photo_url: genProductPhotoUrl || undefined,
			character_ref_url: genCharacterRefUrl || undefined
		});
	}

	/**
	 * Post generation always confirms now. The server resolves the real pipeline
	 * (Director model, image/video models, product + character refs, per-step cost)
	 * and the user approves or edits it before anything is spent — so the old
	 * "skip the composer" shortcut is gone deliberately: it existed to skip a form
	 * that was only a guess, and this one isn't.
	 */
	function requestGeneratePost() {
		if (!agent?.id) return;
		askToGenerate(
			{
				endpoint: `/api/agent/${agent.id}/generate-post`,
				title: `Generate a post for ${agent.name}`,
				subtitle: 'Everything below is what will actually be sent. Edit anything before approving.',
				confirmLabel: 'Approve & generate'
			},
			(body) => generatePostNow(body)
		);
	}

	// ── Soul AI enrich ──────────────────────────────────────────────────────
	let enrichingSoul = $state(false);
	async function enrichSoul() {
		if (!soulText.trim()) {
			showToast('Write a line or two first — enrich expands what you give it', 'warning');
			return;
		}
		enrichingSoul = true;
		try {
			const res = await BrandBrief.extendField('Persona Soul / Personality', soulText);
			if (res.success && res.data?.enriched) {
				soulText = res.data.enriched;
				showToast('Soul enriched — review and save', 'success');
			} else {
				showToast(res.error || 'Enrich failed', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Enrich failed', 'error');
		} finally {
			enrichingSoul = false;
		}
	}

	// ── Generate a unique, brand-tailored persona profile ─────────────────
	// From the persona's gender + the selected brand brief, fills every profile
	// field (except gender) with values tailored to that brand and differentiated
	// from every other persona on the account. Populates the form; the user
	// reviews and Saves through the normal saveProfile() flow.
	let generatingProfile = $state(false);
	async function generatePersonaProfile() {
		if (!agent?.id || generatingProfile) return;
		generatingProfile = true;
		try {
			const res = await BrandBrief.generatePersonaProfile(
				agent.id,
				selectedBrandBriefId || null,
				ppGender || ''
			);
			if (res.success && res.data) {
				const d = res.data;
				if (d.niche) editNiche = d.niche;
				if (Array.isArray(d.ageRanges) && d.ageRanges.length) ppAgeRanges = d.ageRanges;
				if (d.archetype) ppArchetype = d.archetype;
				if (d.contentFocus) ppContentFocus = d.contentFocus;
				if (d.targetAvatar) ppTargetAvatar = d.targetAvatar;
				if (d.psychProfile) ppPsychProfile = d.psychProfile;
				if (d.contentAngle) ppContentAngle = d.contentAngle;
				if (d.appearance && typeof d.appearance === 'object')
					ppAppearance = { ...ppAppearance, ...d.appearance };
				// ppGender is intentionally left untouched — it's the input, not generated.
				showToast('Persona profile generated — review and Save', 'success');
			} else {
				showToast(res.error || 'Generation failed', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Generation failed', 'error');
		} finally {
			generatingProfile = false;
		}
	}

	// ── Read appearance from the reference photo (vision) ─────────────────
	// Reads the wardrobe/hair/eyes/etc. from the actual pinned profile picture so
	// the appearance variables match the real character (not invented values).
	let readingAppearance = $state(false);
	async function readAppearanceFromPhoto() {
		if (!characterRef) {
			showToast('Generate or set a profile picture first', 'warning');
			return;
		}
		if (readingAppearance) return;
		readingAppearance = true;
		try {
			const res = await BrandBrief.readAppearanceFromImage(characterRef);
			if (res.success && res.data?.appearance) {
				ppAppearance = { ...ppAppearance, ...res.data.appearance };
				showToast('Appearance read from photo — review and Save', 'success');
			} else {
				showToast(res.error || 'Read failed', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Read failed', 'error');
		} finally {
			readingAppearance = false;
		}
	}

	// ── Skills & Tools: structured editors (stored as JSON in the existing
	//    text columns; legacy plain text becomes a single migratable card) ───
	interface SkillItem { id: string; name: string; md: string }
	interface ToolItem { id: string; kind: string; label: string; config: string }
	function parseSkills(raw: string): SkillItem[] {
		try {
			const j = JSON.parse(raw);
			if (Array.isArray(j)) return j.filter((s) => s && s.name);
		} catch { /* legacy plain text */ }
		return raw.trim() ? [{ id: 'legacy', name: 'Legacy notes', md: raw }] : [];
	}
	function parseTools(raw: string): ToolItem[] {
		try {
			const j = JSON.parse(raw);
			if (Array.isArray(j)) return j.filter((t) => t && t.label);
		} catch { /* legacy plain text */ }
		return raw.trim() ? [{ id: 'legacy', kind: 'other', label: 'Legacy notes', config: raw }] : [];
	}
	let skillsList = $state<SkillItem[]>(parseSkills(agent?.skills ?? ''));
	let toolsList = $state<ToolItem[]>(parseTools(agent?.tools ?? ''));
	let editingSkill = $state<SkillItem | null>(null);
	let editingTool = $state<ToolItem | null>(null);
	const TOOL_KINDS = ['posting', 'analytics', 'mcp', 'api', 'automation', 'other'];

	function saveSkill() {
		if (!editingSkill) return;
		if (!editingSkill.name.trim()) { showToast('Skill needs a name', 'warning'); return; }
		const i = skillsList.findIndex((s) => s.id === editingSkill!.id);
		skillsList = i >= 0
			? skillsList.map((s) => (s.id === editingSkill!.id ? { ...editingSkill! } : s))
			: [...skillsList, { ...editingSkill }];
		skillsText = JSON.stringify(skillsList);
		editingSkill = null;
	}
	function deleteSkill(id: string) {
		skillsList = skillsList.filter((s) => s.id !== id);
		skillsText = JSON.stringify(skillsList);
		editingSkill = null;
	}
	function saveTool() {
		if (!editingTool) return;
		if (!editingTool.label.trim()) { showToast('Integration needs a label', 'warning'); return; }
		const i = toolsList.findIndex((t) => t.id === editingTool!.id);
		toolsList = i >= 0
			? toolsList.map((t) => (t.id === editingTool!.id ? { ...editingTool! } : t))
			: [...toolsList, { ...editingTool }];
		toolsText = JSON.stringify(toolsList);
		editingTool = null;
	}
	function deleteTool(id: string) {
		toolsList = toolsList.filter((t) => t.id !== id);
		toolsText = JSON.stringify(toolsList);
		editingTool = null;
	}

	async function generatePostNow(approved: Record<string, unknown> = {}) {
		if (!agent?.id) return;
		generatingPost = true;
		try {
			// The composer already resolved and confirmed the full payload with the
			// server, so send exactly what the user approved — no client-side
			// re-derivation that could disagree with what they saw.
			const body: Record<string, unknown> = { ...approved };

			const res = await fetch(`/api/agent/${agent.id}/generate-post`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await parseJsonResponse<any>(res);
			if (!res.ok || !result.success) {
				showToast(result?.error || 'Failed to generate post', 'error');
				return;
			}
			if (res.status === 202 && result.post_id) {
				// Async job: the row exists with status 'generating' — poll it.
				showToast('Generation started — this takes a minute or two', 'info');
				const deadline = Date.now() + 10 * 60_000;
				while (Date.now() < deadline) {
					if (pageDestroyed) return;
					await sleep(5000);
					if (pageDestroyed) return;
					let post: any = null;
					try {
						const pres = await fetch('/api/posts', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ action: 'get', id: result.post_id })
						});
						const pd = await parseJsonResponse<any>(pres);
						post = pd?.data ?? pd?.post ?? null;
					} catch {
						continue; // transient — the job runs server-side regardless
					}
					const status = post?.status;
					if (!status || status === 'generating') continue;
					if (status === 'failed') {
						let reason = 'Generation failed';
						try {
							const c = typeof post.content === 'string' ? JSON.parse(post.content) : post.content;
							if (c?.error) reason = c.error;
						} catch {
							/* keep generic reason */
						}
						showToast(reason, 'error');
						return;
					}
					showToast(status === 'published' ? 'Post generated and published!' : 'Post generated!', 'success');
					await loadFeed();
					return;
				}
				showToast(
					'Still generating after 10 minutes — it may finish in the background. Check the feed shortly.',
					'warning'
				);
			} else {
				// Legacy synchronous completion (pre-migration fallback).
				showToast('Post generated and published!', 'success');
				await loadFeed();
			}
		} catch (err) {
			showToast('Error: ' + (err as Error).message, 'error');
		} finally {
			generatingPost = false;
		}
	}

	// Caption editing from the drawer — works at every status (draft → published;
	// note: editing a published post only changes OUR copy, not the live platform).
	async function handleSaveText(post: any, newText: string): Promise<boolean> {
		try {
			let parsed: any = {};
			try {
				parsed = JSON.parse(post.content);
			} catch {
				parsed = { text: String(post.content ?? '') };
			}
			parsed.text = newText;
			const res = await Posts.update(post.id, { content: parsed });
			if (res.success) {
				const serialized = JSON.stringify(parsed);
				feedPosts = feedPosts.map((p: any) => (p.id === post.id ? { ...p, content: serialized } : p));
				if (modalPost?.id === post.id) modalPost = { ...modalPost, content: serialized };
				showToast('Caption updated', 'success');
				return true;
			}
			showToast(res.error || 'Failed to update caption', 'error');
			return false;
		} catch (e: any) {
			showToast(e.message || 'Failed to update caption', 'error');
			return false;
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

	let mediaTypeFilter = $state<'all' | 'video' | 'image'>('all');

	let filteredPosts = $derived(feedPosts.filter((p: any) => {
		// In-flight and failed generations have no media YET, but they are exactly
		// what the user wants to see after clicking Generate — the old blanket
		// "no media => hide" rule silently swallowed them, so the feed looked
		// unchanged until the job finished. PostCard renders these as a progress
		// (or failure) card instead.
		const inFlight = p.status === 'generating' || p.status === 'failed';
		const display = getPostDisplay(p);
		if (!inFlight && !display.mediaUrl) return false;
		if (feedFilter !== 'all' && p.status !== feedFilter) return false;
		// The media-type filter can't apply to a post whose media doesn't exist yet.
		if (inFlight) return true;
		if (mediaTypeFilter !== 'all') {
			const isVideo =
				display.mediaType === 'video' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(display.mediaUrl ?? '');
			if (mediaTypeFilter === 'video' ? !isVideo : isVideo) return false;
		}
		if (platformFilter !== 'all') {
			const plats = (p.platforms ?? []).map((x: string) => x.toLowerCase());
			if (!plats.includes(platformFilter)) return false;
		}
		return true;
	}));

	// ── Assets: every generated visual for this persona in one grid ──
	// Lives inside the Feed tab as an alternate view (feedView toggle) — same
	// posts data, different lens.
	interface AssetItem {
		url: string;
		type: 'image' | 'video';
		label: string;
		/** Poster still for video assets — without it a video tile renders blank. */
		poster?: string | null;
	}
	let assetItems = $derived.by(() => {
		const seen = new Set<string>();
		const items: AssetItem[] = [];
		const add = (
			url: string | null | undefined,
			type: 'image' | 'video',
			label: string,
			poster?: string | null
		) => {
			if (!url || typeof url !== 'string' || seen.has(url)) return;
			seen.add(url);
			items.push({ url, type, label, poster: poster ?? null });
		};
		for (const p of feedPosts) {
			try {
				const c = JSON.parse(p.content);
				const isVideo = c.media_type === 'video';
				add(c.media_url || c.mediaUrl, isVideo ? 'video' : 'image', 'Post media', isVideo ? c.poster_url : null);
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
			// The kit doubles as the async-job board: it carries transient
			// `<stage>_status` keys whose values are 'generating' / 'failed: …',
			// not URLs. Rendering those as <img src> produced broken tiles.
			if (k.endsWith('_status')) continue;
			add(v as string, 'image', `Reference kit — ${k.replace(/_/g, ' ')}`);
		}
		return items;
	});
	let assetLightbox = $state<AssetItem | null>(null);

	// ── Profile save ───────────────────────────────────────────────
	// ── Generation cost tracking ────────────────────────────────────────────
	// Per-provider spend (estimates from the generation_events ledger).
	let agentSpend = $state<{ total: number; byProvider: Record<string, number>; byOperation: Record<string, number> } | null>(null);
	async function loadSpend(agentId: string) {
		try {
			const res = await fetch(`/api/agent/${agentId}/spend`);
			const d = await parseJsonResponse<any>(res);
			if (d.success) agentSpend = d;
		} catch {
			/* analytics only — never block the page */
		}
	}
	$effect(() => {
		if (agent?.id) loadSpend(agent.id);
	});

	let generationCost = $derived.by(() => {
		let total = 0;
		for (const p of feedPosts) {
			if (typeof p.token_cost === 'number' && p.token_cost > 0) {
				total += p.token_cost;
			}
		}
		return total;
	});

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
			runtimeOwner: editRuntimeOwner,
			brandBriefId: selectedBrandBriefId || null,
			personaProfile: {
				ageRanges: ppAgeRanges,
				// Keep numeric min/max derived from the selected buckets so existing
				// generation prompts that read ageMin/ageMax keep working.
				ageMin: ppAgeRanges.length
					? Math.min(...AGE_RANGES.filter((r) => ppAgeRanges.includes(r.key)).map((r) => r.lo))
					: null,
				ageMax: ppAgeRanges.length
					? Math.max(...AGE_RANGES.filter((r) => ppAgeRanges.includes(r.key)).map((r) => r.hi))
					: null,
				gender: ppGender,
				archetype: ppArchetype,
				contentFocus: ppContentFocus,
				psychProfile: ppPsychProfile,
				contentAngle: ppContentAngle,
				targetAvatar: ppTargetAvatar,
				appearance: ppAppearance
			}
		};
		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const d = await parseJsonResponse<any>(res);
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			// Update local agent state optimistically…
			agent = { ...agent, name: editName, handle: editHandle, status: editStatus, niche: editNiche, gradient: editGradient, initial: editInitial, soul: soulText, skills: skillsText, tools: toolsText, timezone, posts_per_day: postsPerDay, active_hours_start: activeHoursStart, active_hours_end: activeHoursEnd, autonomy_level: autonomyLevel, rss_url: rssUrl, rss_active: rssActive, ugc_voice: selectedVoice };
			// …then re-fetch layout data so the sidebar roster + header (which read
			// server-loaded sidebarAgents) reflect the new name/avatar immediately.
			await invalidateAll();
			showToast(`Profile saved for ${editName}`, 'success');
		} catch (err: any) {
			showToast('Failed to save: ' + err.message, 'error');
		} finally {
			saving = false;
		}
	}

	/**
	 * Every avatar generation is confirmed first: the composer resolves the REAL
	 * portrait prompt (and the model it will actually run on) server-side, lets the
	 * user edit it, and only the approved body is sent.
	 */
	// ── Restore profile picture from history ──────────────────────────
	// Every image ever generated is retained in storage; this re-pins one as
	// the persona's face. Non-destructive — only moves the pointer.
	let restoreOpen = $state(false);
	let restoreLoading = $state(false);
	let restoreImages = $state<Array<{ url: string; name: string; createdAt: string | null }>>([]);
	let restoringUrl = $state<string | null>(null);

	async function openRestore() {
		if (!agent?.id) return;
		restoreOpen = true;
		restoreLoading = true;
		restoreImages = [];
		try {
			const res = await fetch(`/api/agent/${agent.id}/restore-avatar`);
			const d = await res.json();
			if (d.success) restoreImages = d.images ?? [];
			else showToast(d.error || 'Failed to load history', 'error');
		} catch (e) {
			showToast('Failed to load history: ' + (e as Error).message, 'error');
		} finally {
			restoreLoading = false;
		}
	}

	async function restoreAvatar(url: string) {
		if (!agent?.id || restoringUrl) return;
		restoringUrl = url;
		try {
			const res = await fetch(`/api/agent/${agent.id}/restore-avatar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to restore');
			characterRef = url;
			agent = { ...agent, ugc_character_ref: url };
			await invalidateAll(); // refresh sidebar/header avatar
			showToast('Profile picture restored', 'success');
			restoreOpen = false;
		} catch (e) {
			showToast('Restore failed: ' + (e as Error).message, 'error');
		} finally {
			restoringUrl = null;
		}
	}

	// ── Restore ONE reference-kit stage from its own history ──────────────
	// Each stage (full body, side profiles, close-up, feature grid, sheet) keeps
	// a `<stage>_history` pool of every version ever generated. This re-pins one
	// of those for that stage only — full body from full-body generations, side
	// profiles from side-profile generations, etc. Fills going forward: images
	// generated before per-stage history existed can't be sorted back by stage.
	const KIT_STAGE_RESTORE_LABELS: Record<string, string> = {
		full_body: 'Full body',
		side_profiles: 'Side profiles',
		face_closeup: 'Facial close-up',
		feature_grid: 'Feature grid',
		sheet: 'Reference sheet'
	};
	let kitRestoreStage = $state<string | null>(null);
	let kitRestoreImages = $state<string[]>([]);
	let kitRestoringUrl = $state<string | null>(null);
	// Fallback: the full image library, so a stage can be restored even when it has
	// no tagged history yet (personas generated before per-stage history existed).
	let kitRestoreMode = $state<'stage' | 'all'>('stage');
	let kitRestoreAll = $state<Array<{ url: string }>>([]);
	let kitRestoreLoadingAll = $state(false);

	function stageHistory(stage: string): string[] {
		const h = referenceKit[`${stage}_history`];
		return Array.isArray(h) ? h : [];
	}

	async function loadKitRestoreLibrary() {
		if (!agent?.id || kitRestoreLoadingAll || kitRestoreAll.length > 0) return;
		kitRestoreLoadingAll = true;
		try {
			// Reuse the profile-picture history endpoint — it lists every image in
			// the user's library, exactly the fallback pool for any stage.
			const res = await fetch(`/api/agent/${agent.id}/restore-avatar`);
			const d = await res.json().catch(() => ({}));
			if (d.success) kitRestoreAll = (d.images ?? []).map((i: any) => ({ url: i.url }));
		} catch {
			/* best-effort */
		} finally {
			kitRestoreLoadingAll = false;
		}
	}

	function openKitRestore(stage: string) {
		kitRestoreStage = stage;
		kitRestoreImages = stageHistory(stage);
		// Prefer the stage's own history; if it's empty/sparse, open straight to the
		// full library so the picker is useful for existing personas immediately.
		kitRestoreMode = kitRestoreImages.length > 1 ? 'stage' : 'all';
		if (kitRestoreMode === 'all') loadKitRestoreLibrary();
	}

	function setKitRestoreMode(mode: 'stage' | 'all') {
		kitRestoreMode = mode;
		if (mode === 'all') loadKitRestoreLibrary();
	}

	async function restoreKitStage(url: string) {
		if (!agent?.id || !kitRestoreStage || kitRestoringUrl) return;
		const stage = kitRestoreStage;
		kitRestoringUrl = url;
		try {
			const res = await fetch(`/api/agent/${agent.id}/restore-kit-stage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stage, url })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to restore');
			referenceKit = d.kit ?? { ...referenceKit, [stage]: url };
			showToast(`${KIT_STAGE_RESTORE_LABELS[stage] ?? stage} restored`, 'success');
			kitRestoreStage = null;
			await invalidateAll(); // full body feeds the sidebar/header avatar
		} catch (e) {
			showToast('Restore failed: ' + (e as Error).message, 'error');
		} finally {
			kitRestoringUrl = null;
		}
	}

	// ── Publish an already-generated post to a connected platform ─────────
	// For posts whose media generated fine but couldn't publish (target platform
	// not connected). The user picks a connected, media-compatible platform —
	// nothing auto-retries.
	let publishFallbackPost = $state<any | null>(null);
	let publishFallbackOptions = $state<string[]>([]);
	let publishFallbackSelected = $state<string[]>([]);
	let publishFallbackLoading = $state(false);
	let publishFallbackPublishing = $state(false);

	async function openPublishFallback(post: any) {
		if (!agent?.id) return;
		publishFallbackPost = post;
		publishFallbackOptions = [];
		publishFallbackSelected = [];
		publishFallbackLoading = true;
		try {
			const res = await fetch(
				`/api/agent/${agent.id}/publish-post?postId=${encodeURIComponent(post.id)}`
			);
			const d = await res.json().catch(() => ({}));
			if (!res.ok || !d.success) throw new Error(d.error || 'Could not load connections');
			publishFallbackOptions = d.connectedPlatforms ?? [];
			publishFallbackSelected = [...publishFallbackOptions]; // default: all compatible connected
		} catch (e) {
			showToast((e as Error).message, 'error');
			publishFallbackPost = null;
		} finally {
			publishFallbackLoading = false;
		}
	}

	function togglePublishFallback(p: string) {
		publishFallbackSelected = publishFallbackSelected.includes(p)
			? publishFallbackSelected.filter((x) => x !== p)
			: [...publishFallbackSelected, p];
	}

	async function confirmPublishFallback() {
		if (!agent?.id || !publishFallbackPost || publishFallbackPublishing) return;
		if (publishFallbackSelected.length === 0) {
			showToast('Pick at least one platform', 'error');
			return;
		}
		publishFallbackPublishing = true;
		try {
			const res = await fetch(`/api/agent/${agent.id}/publish-post`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ postId: publishFallbackPost.id, platforms: publishFallbackSelected })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok || !d.success) throw new Error(d.error || 'Publish failed');
			showToast(d.status === 'published' ? 'Published!' : `Post ${d.status}`, 'success');
			publishFallbackPost = null;
			await loadFeed();
		} catch (e) {
			showToast('Publish failed: ' + (e as Error).message, 'error');
		} finally {
			publishFallbackPublishing = false;
		}
	}

	function requestGenerateAvatar() {
		if (!agent?.id || generatingAvatar) return;
		askToGenerate(
			{
				endpoint: `/api/agent/${agent.id}/generate-avatar`,
				title: `Profile picture for ${agent.name}`,
				subtitle: 'This face is reused as the character reference in every future video.',
				confirmLabel: 'Approve & generate'
			},
			(body) => generateAvatar(body)
		);
	}

	async function generateAvatar(body: Record<string, unknown> = {}) {
		if (!agent?.id || generatingAvatar) return;
		const requestAgentId = agent.id;
		const requestAgentName = agent.name;
		const jobId = kitJobId(requestAgentId, 'profile_status');
		generatingAvatar = true;
		startGeneration({
			id: jobId,
			kind: 'avatar',
			agentId: requestAgentId,
			label: `Profile picture — ${requestAgentName}`
		});
		try {
			const res = await fetch(`/api/agent/${requestAgentId}/generate-avatar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			let d = await parseJsonResponse<any>(res);
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			if (res.status === 202) {
				// Async job — poll until profile_status clears, then read the result.
				showToast('Generating profile picture — takes a minute or two', 'info');
				const state = await pollKitJob(requestAgentId, 'profile_status');
				d = { character_ref: state.avatarUrl };
			}
			// The user may have switched personas while this request was in flight —
			// the server already persisted the result under requestAgentId regardless,
			// but only apply it to in-memory state if we're still looking at that persona.
			if (agent?.id === requestAgentId) {
				characterRef = d.character_ref;
				agent = { ...agent, ugc_character_ref: d.character_ref };
				await invalidateAll(); // refresh sidebar/header avatar
				showToast('Profile picture generated', 'success');
			} else {
				showToast(`Profile picture generated for ${requestAgentName}`, 'success');
			}
			finishGeneration(jobId);
		} catch (err: any) {
			if (err.message === 'cancelled') {
				finishGeneration(jobId);
				return;
			}
			// Keep the failure on screen (activity panel) instead of letting it vanish
			// with a 4s toast — a failed generation still cost time and money.
			failGeneration(jobId, err.message);
			showToast('Failed to generate profile picture: ' + err.message, 'error');
		} finally {
			if (agent?.id === requestAgentId) generatingAvatar = false;
		}
	}

	// ── Async-generation polling (202 job contract) ────────────────────────
	// Generation endpoints respond 202 immediately and run detached (the old
	// in-request flow died at the reverse proxy with HTML 502 pages). Progress
	// is read back via GET generate-reference-kit ({ kit, avatar_url }): a
	// `<stage>_status` of 'generating' means in flight, 'failed: …' carries the
	// error, and a cleared status key means done. Legacy synchronous 200s (env
	// without the 'generating' status migration) are still handled at each call
	// site.
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	let pageDestroyed = false;
	onDestroy(() => {
		pageDestroyed = true;
	});

	async function fetchKitState(agentId: string): Promise<{ kit: any; avatarUrl: string | null }> {
		const res = await fetch(`/api/agent/${agentId}/generate-reference-kit`);
		const d = await parseJsonResponse<any>(res);
		if (!res.ok || !d.success) throw new Error(d.error || `Server error (HTTP ${res.status}).`);
		return { kit: d.kit || {}, avatarUrl: d.avatar_url ?? null };
	}

	/**
	 * Polls the kit-state GET until `statusKey` clears (success) or reads
	 * 'failed: …' (throws with the server's reason). Transient poll errors are
	 * swallowed — the job is running server-side regardless. Throws 'cancelled'
	 * if the user navigated away.
	 */
	async function pollKitJob(
		agentId: string,
		statusKey: string,
		timeoutMs = 5 * 60_000
	): Promise<{ kit: any; avatarUrl: string | null }> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (pageDestroyed) throw new Error('cancelled');
			await sleep(4000);
			if (pageDestroyed) throw new Error('cancelled');
			let state: { kit: any; avatarUrl: string | null };
			try {
				state = await fetchKitState(agentId);
			} catch {
				continue; // transient — keep polling
			}
			const status = state.kit?.[statusKey];
			if (typeof status === 'string' && status.startsWith('failed')) {
				throw new Error(status.replace(/^failed:\s*/, '') || 'Generation failed');
			}
			if (!status) return state;
		}
		throw new Error(
			'Timed out — the generation may still finish in the background. Refresh in a minute.'
		);
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
			let d = await parseJsonResponse<any>(res);
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			if (res.status === 202) {
				showToast('Building the character sheet — takes a minute or two', 'info');
				const state = await pollKitJob(requestAgentId, 'profile_status');
				d = { character_ref: state.avatarUrl, reference_kit: state.kit };
			}
			// Same in-flight-persona-switch guard as generateAvatar() above — the
			// server already persisted this under requestAgentId either way.
			if (agent?.id === requestAgentId) {
				characterRef = d.character_ref;
				referenceKit = d.reference_kit ?? referenceKit;
				agent = { ...agent, ugc_character_ref: d.character_ref, ugc_reference_kit: referenceKit };
				clearReferenceFile();
				await invalidateAll(); // refresh sidebar/header avatar
				showToast('Character sheet generated from your reference photo', 'success');
			} else {
				showToast(`Character sheet generated for ${requestAgentName}`, 'success');
			}
		} catch (err: any) {
			if (err.message === 'cancelled') return;
			showToast('Failed to generate from reference photo: ' + err.message, 'error');
		} finally {
			if (agent?.id === requestAgentId) generatingAvatar = false;
		}
	}

	// full_body is regenerated independently (from the profile picture), so it's NOT
	// part of KIT_STAGE_ORDER (the "generate all downstream" sequence) — but it IS a
	// valid stage with its own composer, hence the widened KitStage.
	const KIT_STAGE_ORDER = ['side_profiles', 'face_closeup', 'feature_grid'] as const;
	type KitStage = 'full_body' | (typeof KIT_STAGE_ORDER)[number];
	const KIT_STAGE_DONE_LABELS: Record<KitStage, string> = {
		full_body: 'Full body regenerated',
		side_profiles: 'Side-profile composite generated',
		face_closeup: 'Facial close-up generated',
		feature_grid: 'Feature grid generated'
	};

	// The server enforces this order (each stage builds on the previous one's
	// output) — gate the buttons on the same rule so a click can never 400.
	function kitStageBlockedReason(stage: KitStage): string | null {
		if (!referenceKit.full_body && !characterRef) return 'Generate a profile picture first';
		if (stage === 'face_closeup' && !referenceKit.side_profiles)
			return 'Needs the side-profile composite first';
		if (stage === 'feature_grid' && !referenceKit.face_closeup)
			return 'Needs the facial close-up first';
		return null;
	}
	let missingKitStages = $derived(KIT_STAGE_ORDER.filter((s) => !referenceKit[s]));

	/** Runs one stage end-to-end (202-poll or legacy sync). Returns the stage URL. */
	async function runKitStage(
		requestAgentId: string,
		stage: KitStage,
		body: Record<string, unknown> = {}
	): Promise<string> {
		const res = await fetch(`/api/agent/${requestAgentId}/generate-reference-kit`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ stage, ...body })
		});
		const d = await parseJsonResponse<any>(res);
		if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
		if (res.status === 202) {
			const state = await pollKitJob(requestAgentId, `${stage}_status`);
			if (!state.kit?.[stage]) throw new Error('Generation finished but returned no image');
			return state.kit[stage];
		}
		return d[stage]; // legacy synchronous completion
	}

	const KIT_STAGE_TITLES: Record<KitStage, string> = {
		full_body: 'Full body',
		side_profiles: 'Side-profile composite',
		face_closeup: 'Facial close-up',
		feature_grid: 'Feature grid'
	};

	/** Confirm first: resolve the stage's real prompt + reference images, let the user edit. */
	function requestGenerateKitStage(stage: KitStage) {
		if (!agent?.id || generatingKitStage) return;
		const blocked = kitStageBlockedReason(stage);
		if (blocked) {
			showToast(blocked, 'warning');
			return;
		}
		askToGenerate(
			{
				endpoint: `/api/agent/${agent.id}/generate-reference-kit`,
				baseBody: { stage },
				title: KIT_STAGE_TITLES[stage],
				subtitle: 'Feeds the video model as a character reference — edit the prompt if needed.',
				confirmLabel: 'Approve & generate'
			},
			(body) => generateKitStage(stage, body)
		);
	}

	async function generateKitStage(stage: KitStage, body: Record<string, unknown> = {}) {
		if (!agent?.id || generatingKitStage) return;
		const blocked = kitStageBlockedReason(stage);
		if (blocked) {
			showToast(blocked, 'warning');
			return;
		}
		const requestAgentId = agent.id;
		const jobId = kitJobId(requestAgentId, `${stage}_status`);
		generatingKitStage = stage;
		startGeneration({
			id: jobId,
			kind: 'kit_stage',
			agentId: requestAgentId,
			label: KIT_STAGE_TITLES[stage]
		});
		try {
			const url = await runKitStage(requestAgentId, stage, body);
			// Same in-flight-persona-switch guard as generateAvatar()/generateAvatarFromReference()
			// above — the server already persisted this under requestAgentId either way.
			if (agent?.id === requestAgentId) {
				referenceKit = { ...referenceKit, [stage]: url };
				agent = { ...agent, ugc_reference_kit: referenceKit };
				showToast(KIT_STAGE_DONE_LABELS[stage], 'success');
			} else {
				showToast(`${KIT_STAGE_DONE_LABELS[stage]} for a different persona`, 'success');
			}
			finishGeneration(jobId);
		} catch (err: any) {
			if (err.message === 'cancelled') {
				finishGeneration(jobId);
				return;
			}
			failGeneration(jobId, err.message);
			showToast(`Failed to generate: ${err.message}`, 'error');
		} finally {
			if (agent?.id === requestAgentId) generatingKitStage = null;
		}
	}

	// One click, whole kit: runs every missing stage sequentially (the order is
	// a hard server-side dependency chain), stopping at the first failure.
	let generatingAllKit = $state(false);
	// force=false → gap-fill only (skip stages that already exist). force=true →
	// re-run every downstream stage in order (the persistent "Regenerate kit").
	async function generateAllKitStages(force = false) {
		if (!agent?.id || generatingKitStage || generatingAllKit) return;
		const requestAgentId = agent.id;
		generatingAllKit = true;
		try {
			for (const stage of KIT_STAGE_ORDER) {
				if (agent?.id !== requestAgentId || pageDestroyed) return;
				if (!force && referenceKit[stage]) continue;
				generatingKitStage = stage;
				const url = await runKitStage(requestAgentId, stage);
				if (agent?.id === requestAgentId) {
					referenceKit = { ...referenceKit, [stage]: url };
					agent = { ...agent, ugc_reference_kit: referenceKit };
				}
			}
			if (agent?.id === requestAgentId) showToast('Reference kit complete', 'success');
		} catch (err: any) {
			if (err.message !== 'cancelled') {
				showToast(`Kit stopped at ${generatingKitStage ?? 'a stage'}: ${err.message}`, 'error');
			}
		} finally {
			if (agent?.id === requestAgentId) {
				generatingKitStage = null;
				generatingAllKit = false;
			}
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
			const d = await parseJsonResponse<any>(res);
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
				connectHub = (res as any).connect_hub ?? null;
				accountMeter = (res as any).meter ?? null;
			} else {
				platformStatuses = {};
				accountMeter = null;
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
		// The server returns a Zernio hosted-OAuth link for the platform, filed under
		// this persona's own Zernio profile, with the dashboard as a last resort so
		// the user is never dead-ended. No key saved → an actionable error toast.
		connectingPlatform = platform;
		try {
			const res = await Accounts.initConnection(agent.id, platform);
			if (res.success) {
				const d = res.data as any;
				if (d?.redirect_url) {
					showToast(
						d.note || `Opening ${platformLabel(platform)} authorization…`,
						'info'
					);
					window.open(d.redirect_url, '_blank', 'noopener');
				}
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
			const d = await parseJsonResponse<any>(res);
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
	<!-- Compact identity header — the banner image was removed on request:
	     the character photo shows ONCE (avatar), not stretched behind the name. -->
	<header class="persona-hero">
		<div class="hero-row">
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
				{#if generationCost > 0}
					<div class="stat-chip stat-chip-spend">
						<span class="stat-val">${generationCost < 0.01 ? generationCost.toFixed(4) : generationCost.toFixed(2)}</span>
						<span class="stat-label">Spend</span>
					</div>
				{/if}
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
		</div>
	</nav>

	<!-- ── Tab content ────────────────────────────────────────── -->
	<div class="tab-body">

		<!-- FEED TAB -->
		{#if activeTab === 'feed'}
			<div class="feed-tab">
				<!-- Toolbar -->
				<div class="feed-toolbar">
					<!-- One dataset, two lenses: the post mosaic or the flat assets grid. -->
					<div class="feed-view-toggle" role="tablist" aria-label="Feed view">
						<button
							type="button"
							class="view-toggle-btn"
							class:active={feedView === 'posts'}
							onclick={() => (feedView = 'posts')}
						>
							Posts
						</button>
						<button
							type="button"
							class="view-toggle-btn"
							class:active={feedView === 'assets'}
							onclick={() => (feedView = 'assets')}
						>
							Assets{#if assetItems.length > 0}&nbsp;({assetItems.length}){/if}
						</button>
					</div>
					{#if feedView === 'posts'}
					<div class="feed-filters">
						<select class="filter-select" bind:value={feedFilter}>
							<option value="all">All statuses</option>
							<option value="published">Published</option>
							<option value="scheduled">Scheduled</option>
							<option value="publishing">Publishing</option>
							<option value="draft">Draft</option>
							<option value="partial">Partial</option>
							<option value="failed">Failed</option>
						</select>
						<select class="filter-select" bind:value={mediaTypeFilter}>
							<option value="all">Images + videos</option>
							<option value="video">Videos only</option>
							<option value="image">Images only</option>
						</select>
						<select class="filter-select" bind:value={platformFilter}>
							<option value="all">All platforms</option>
							{#each PLATFORMS as p}
								<option value={p.key}>{p.name}</option>
							{/each}
						</select>
					</div>
					{/if}
					<div class="feed-actions">
						<button class="btn-generate" onclick={requestGeneratePost} disabled={generatingPost || feedLoading}>
							{#if generatingPost}
								<span class="spinner-sm"></span> Generating…
							{:else}
								✨ Generate Now
							{/if}
						</button>
						<button
							class="btn-sync"
							onclick={fillDraftsNow}
							disabled={fillingDrafts || feedLoading}
							title="Top up this persona's review queue: autopilot fills the empty future slots with drafts"
						>
							{#if fillingDrafts}
								<span class="spinner-sm"></span> Filling drafts…
							{:else}
								📥 Generate Drafts
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

				{#if feedView === 'posts'}
				{#if feedLoading}
					<div class="feed-loading">
						<span class="spinner-lg"></span>
						<p>Loading posts…</p>
					</div>
				{:else if filteredPosts.length === 0}
					<div class="feed-empty">
						<span class="empty-icon">📱</span>
						<h3>No posts yet</h3>
						<p>{feedFilter !== 'all' || platformFilter !== 'all' ? 'No posts match these filters.' : 'Generate your first post — drafts save even without a connected platform.'}</p>
						{#if feedFilter === 'all' && platformFilter === 'all'}
							<div class="feed-empty-actions">
								<button class="btn-generate" onclick={requestGeneratePost} disabled={generatingPost}>
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
							<PostCard {post} onOpen={(p) => (modalPost = p)} onPublishFallback={openPublishFallback} />
						{/each}
					</div>
				{/if}
				{/if}

				{#if feedView === 'assets'}
					<!-- Assets view: every generated visual in one flat grid (former Assets tab). -->
					{#if feedLoading && assetItems.length === 0}
						<div class="feed-loading"><span class="spinner"></span> Loading assets…</div>
					{:else if assetItems.length === 0}
						<div class="feed-empty">
							<span class="empty-icon">🖼</span>
							<h3>No assets yet</h3>
							<p>Every image and video generated for this persona will collect here — post media, poster stills, storyboards, the profile picture, and the reference kit.</p>
						</div>
					{:else}
						<div class="assets-grid">
							{#each assetItems as asset (asset.url)}
								<button type="button" class="asset-tile" onclick={() => (assetLightbox = asset)} aria-label="View {asset.label}">
									{#if asset.type === 'video'}
										<!-- Poster keeps video tiles from rendering blank while unbuffered. -->
										<video src={asset.url} poster={asset.poster || undefined} muted playsinline preload="metadata"></video>
										<span class="asset-video-badge">▶</span>
									{:else}
										<img src={asset.url} loading="lazy" alt={asset.label} />
									{/if}
									<span class="asset-label">{asset.label}</span>
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			</div>


			<PostDrawer
				post={modalPost}
				onClose={() => (modalPost = null)}
				onDelete={handleDeletePost}
				onApprove={handleApprovePost}
				onSaveText={handleSaveText}
				{characterRef}
				onPublishFallback={(p) => {
					modalPost = null;
					openPublishFallback(p);
				}}
				approving={approvingPostId === modalPost?.id}
				deleting={deletingPostId === modalPost?.id}
			/>
			{#if manualDeleteNotice}
				<ManualDeleteNotice entries={manualDeleteNotice} onClose={() => (manualDeleteNotice = null)} />
			{/if}

		<!-- PROFILE TAB -->
		{:else if activeTab === 'profile'}
			<div class="profile-tab">
				<!-- Brand section: which of the user's brand briefs this persona
				     generates for. One client can run several brands (Just Kids
				     Honey, HoneyX Manly Plus…) — every asset this persona makes is
				     grounded in the brief selected here. -->
				<section class="profile-section">
					<div class="section-header">
						<h2 class="section-title">Brand</h2>
						<p class="section-desc">
							The brand brief this persona creates content for — products, voice, and audience all
							come from it.
						</p>
					</div>
					<div class="fields-grid">
						<div class="field-group col-span-2">
							<label for="p-brief">Brand Brief</label>
							<select id="p-brief" bind:value={selectedBrandBriefId}>
								<option value="">— Newest brief (default) —</option>
								{#each brandBriefs as b (b.id)}
									<option value={b.id}>{b.name}</option>
								{/each}
							</select>
							{#if brandBriefs.length === 0}
								<p class="field-hint">
									No brand briefs saved yet — create one in <a href="/brand-brief">Brand Brief</a>, then
									select it here.
								</p>
							{:else}
								<p class="field-hint">
									Save the profile to apply. Manage briefs in <a href="/brand-brief">Brand Brief</a>.
								</p>
							{/if}
						</div>
					</div>
				</section>

				<!-- Persona Profile — above Identity: these fields feed generation prompts -->
				<section class="profile-section">
					<div class="section-header">
						<div class="label-row">
							<h2 class="section-title">Persona Profile</h2>
							<button
								type="button"
								class="btn-sync btn-xs"
								onclick={generatePersonaProfile}
								disabled={generatingProfile}
								title="Generate a unique profile tailored to the selected brand and this persona's gender"
							>
								{generatingProfile ? 'Generating…' : '✨ Generate for brand'}
							</button>
						</div>
						<p class="section-desc">
							Psychological depth and content strategy — these feed directly into content generation
							prompts. “Generate for brand” fills a unique, brand-tailored profile (aligned to this
							persona's gender) that you can review and Save.
						</p>
					</div>

					<div class="fields-grid">
						<!-- Identity fields, moved up into the profile: the NAME stays constant;
						     NICHE (and everything below) is filled by "Generate for brand". -->
						<div class="field-group">
							<label for="p-name">Agent Name</label>
							<input id="p-name" type="text" bind:value={editName} placeholder="e.g. Veronica Active" />
						</div>
						<div class="field-group">
							<label for="p-niche">Niche</label>
							<select id="p-niche" bind:value={editNiche}>
								{#if editNiche && !(NICHE_OPTIONS as readonly string[]).includes(editNiche)}
									<option value={editNiche}>{editNiche}</option>
								{/if}
								<option value="">— Select niche —</option>
								{#each NICHE_OPTIONS as n}
									<option value={n}>{n}</option>
								{/each}
							</select>
						</div>
						<div class="field-group">
							<label for="p-status">Status</label>
							<select id="p-status" bind:value={editStatus}>
								{#each STATUS_OPTIONS as s}
									<option value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
								{/each}
							</select>
						</div>

						<div class="field-group col-span-2">
							<label>Target Age Range</label>
							<div class="age-chips">
								<button
									type="button"
									class="age-chip age-chip-all"
									class:selected={ppAgeRanges.length === AGE_RANGES.length}
									onclick={toggleAllAgeRanges}
								>All ages</button>
								{#each AGE_RANGES as r}
									<button
										type="button"
										class="age-chip"
										class:selected={ppAgeRanges.includes(r.key)}
										onclick={() => toggleAgeRange(r.key)}
									>{r.key}</button>
								{/each}
							</div>
							<p class="field-hint">Select one or more audience age brackets (or all).</p>
						</div>

						<div class="field-group">
							<label for="pp-gender">Gender</label>
							<select id="pp-gender" bind:value={ppGender} onchange={() => alignVoiceToGender()}>
								<option value="">— Select —</option>
								<option value="female">Female</option>
								<option value="male">Male</option>
							</select>
							<p class="field-hint">Drives the generated character's appearance and default voice.</p>
						</div>

						<div class="field-group">
							<label for="pp-archetype">Persona Archetype</label>
							<select id="pp-archetype" bind:value={ppArchetype}>
								<option value="">— Select archetype —</option>
								{#each PERSONA_ARCHETYPES as a}
									<option value={a}>{a}</option>
								{/each}
							</select>
							<p class="field-hint">Defines the persona's role and audience relationship style.</p>
						</div>

						<div class="field-group">
							<label for="pp-focus">Content Focus</label>
							<select id="pp-focus" bind:value={ppContentFocus}>
								<option value="">— Select focus —</option>
								{#each CONTENT_FOCUS_OPTIONS as f}
									<option value={f}>{f}</option>
								{/each}
							</select>
							<p class="field-hint">Primary category of content this persona produces.</p>
						</div>

						<div class="field-group col-span-2">
							<label for="pp-target">Target Avatar</label>
							<input id="pp-target" type="text" bind:value={ppTargetAvatar}
								placeholder="e.g. Working moms 28-42, fitness-curious, short on time" />
							<p class="field-hint">One-liner describing the ideal audience member this persona speaks to.</p>
						</div>

						<div class="field-group col-span-2">
							<label for="pp-psych">Psychology Profile</label>
							<textarea id="pp-psych" bind:value={ppPsychProfile} rows="4"
								placeholder="Describe audience psychology — motivations, fears, desires, pain points, identity hooks…">
							</textarea>
							<p class="field-hint">Used to tune tone, hooks, and emotional framing in generated content.</p>
						</div>

						<div class="field-group col-span-2">
							<label for="pp-angle">Content Angle / POV</label>
							<textarea id="pp-angle" bind:value={ppContentAngle} rows="3"
								placeholder="e.g. 'Real results, no fluff' — direct, relatable transformations told in first person…">
							</textarea>
							<p class="field-hint">The unique angle or point of view that differentiates this persona's content.</p>
						</div>

						<div class="field-group col-span-2">
							<div class="label-row">
								<label>Appearance &amp; Wardrobe</label>
								<button
									type="button"
									class="btn-sync btn-xs"
									onclick={readAppearanceFromPhoto}
									disabled={readingAppearance || !characterRef}
									title="Read the wardrobe, hair, eyes, etc. from the current profile picture so they match the real character"
								>
									{readingAppearance ? 'Reading…' : '📷 Read from photo'}
								</button>
							</div>
							<p class="field-hint" style="margin: 0 0 0.6rem;">
								Dynamic look variables — clothing, colors, hair, eyes, headwear, styling. They feed
								the profile-picture generation so the face and outfit match. Fill them from the brand
								(“Generate for brand”) or read them from the current photo (“Read from photo”).
							</p>
							<div class="appearance-grid">
								{#each APPEARANCE_FIELDS as f (f.key)}
									<label class="appearance-field">
										<span>{f.label}</span>
										<input type="text" bind:value={ppAppearance[f.key]} placeholder={f.placeholder} />
									</label>
								{/each}
							</div>
						</div>
					</div>
				</section>

				<!-- Identity section -->
				<section class="profile-section">
					<div class="section-header">
						<h2 class="section-title">Character & Visuals</h2>
						<p class="section-desc">The persona's generated face and multi-angle reference kit, plus its personality, skills, and tools. Name, niche, and appearance now live in the Persona Profile above.</p>
					</div>

					<div class="fields-grid">
						<div class="field-group col-span-2">
							<label>Profile Picture</label>
							<p class="section-desc" style="margin-bottom: 0.75rem;">
								The AI-generated character used to keep this persona's face consistent across its
								spokesperson videos — used as the profile picture everywhere once generated.
							</p>
							<div class="avatar-gen-row">
								<div
									class="avatar-gen-preview"
									class:clickable={!!characterRef}
									style={characterRef ? '' : `background: ${editGradient}`}
									role={characterRef ? 'button' : undefined}
									tabindex={characterRef ? 0 : undefined}
									onclick={() =>
										characterRef &&
										openPreview(characterRef, 'Profile picture', requestGenerateAvatar)}
									onkeydown={(e) =>
										e.key === 'Enter' &&
										characterRef &&
										openPreview(characterRef, 'Profile picture', requestGenerateAvatar)}
								>
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
										onclick={requestGenerateAvatar}
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
									<button type="button" class="btn-sync" onclick={openRestore} disabled={generatingAvatar}>
										🕑 Restore from history
									</button>
									{#if !characterRef}
										<p class="field-hint">No photo yet — falls back to the gradient below until generated.</p>
									{/if}
									<p class="field-hint">~$0.08 per generation (Nano Banana 2 image call). Restore re-pins a past image free.</p>
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
								<div class="label-row">
									<label>Reference Kit</label>
									{#if missingKitStages.length > 0}
										<button
											type="button"
											class="btn-sync btn-xs"
											onclick={() => generateAllKitStages(false)}
											disabled={generatingKitStage !== null || generatingAllKit}
										>
											{#if generatingAllKit}
												<span class="spinner-sm"></span> Building kit…
											{:else}
												⚡ Generate all remaining ({missingKitStages.length})
											{/if}
										</button>
									{:else}
										<!-- All stages exist — offer a full re-run of the whole kit. -->
										<button
											type="button"
											class="btn-sync btn-xs"
											onclick={() => generateAllKitStages(true)}
											disabled={generatingKitStage !== null || generatingAllKit}
										>
											{#if generatingAllKit}
												<span class="spinner-sm"></span> Rebuilding kit…
											{:else}
												↻ Regenerate reference kit
											{/if}
										</button>
									{/if}
								</div>
								<p class="section-desc" style="margin-bottom: 0.75rem;">
									Each stage builds on the previous one — generate them in order (or use Generate all).
									Every stage can be regenerated independently — ~$0.08 per stage (one Nano Banana 2 call).
									{#if generatingKitStage || generatingAllKit}
										Generating — takes a minute or two per stage.
									{/if}
								</p>
								<div class="kit-stage-row">
									<div class="kit-stage">
										<span class="kit-stage-label">1. Full body ✓</span>
										<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
										<img
											src={referenceKit.full_body}
											alt="Full body reference"
											class="kit-stage-thumb clickable"
											role="button"
											onclick={() =>
												openPreview(referenceKit.full_body, '1. Full body', () =>
													requestGenerateKitStage('full_body')
												)}
										/>
										<!-- Full body regenerates on its OWN — a composer that shows the
										     full-body prompt + the profile picture as the reference, and
										     re-runs just this shot without touching the persona's identity.
										     (The whole identity is regenerated from the Profile Picture card.) -->
										<div class="kit-stage-actions">
											<button
												type="button"
												class="btn-sync kit-stage-generate"
												onclick={() => requestGenerateKitStage('full_body')}
												disabled={generatingKitStage !== null || generatingAllKit || generatingAvatar}
												title="Regenerate just the full-body shot from the profile picture — opens a composer to review and edit"
											>
												{#if generatingKitStage === 'full_body'}
													<span class="spinner-sm"></span> Generating…
												{:else}
													↺ Regenerate
												{/if}
											</button>
											<button
												type="button"
												class="btn-sync kit-stage-generate"
												onclick={() => openKitRestore('full_body')}
												disabled={generatingAvatar || generatingKitStage !== null || generatingAllKit}
												title="Restore a previous full-body — from this stage's history or your image library"
											>
												🕑 Restore
											</button>
										</div>
									</div>
									{#each [{ key: 'side_profiles' as const, n: 2, label: 'Side profiles', alt: 'Side profile composite', wide: true }, { key: 'face_closeup' as const, n: 3, label: 'Facial close-up', alt: 'Facial close-up', wide: false }, { key: 'feature_grid' as const, n: 4, label: 'Feature grid', alt: 'Feature grid', wide: false }] as st (st.key)}
										{@const blocked = kitStageBlockedReason(st.key)}
										<div class="kit-stage">
											<span class="kit-stage-label">{st.n}. {st.label}{referenceKit[st.key] ? ' ✓' : ''}</span>
											{#if referenceKit[st.key]}
												<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
								<img
									src={referenceKit[st.key]}
									alt={st.alt}
									class="kit-stage-thumb clickable{st.wide ? ' wide' : ''}"
									role="button"
									onclick={() =>
										openPreview(referenceKit[st.key], st.label, () => requestGenerateKitStage(st.key))}
								/>
											{/if}
											<div class="kit-stage-actions">
												<button
													type="button"
													class="btn-sync kit-stage-generate"
													onclick={() => requestGenerateKitStage(st.key)}
													disabled={generatingKitStage !== null || generatingAllKit || blocked !== null}
													title={blocked ?? undefined}
												>
													{#if generatingKitStage === st.key}
														<span class="spinner-sm"></span> Generating…
													{:else}
														{referenceKit[st.key] ? '↺ Regenerate' : 'Generate'}
													{/if}
												</button>
												{#if referenceKit[st.key]}
													<button
														type="button"
														class="btn-sync kit-stage-generate"
														onclick={() => openKitRestore(st.key)}
														disabled={generatingKitStage !== null || generatingAllKit}
														title="Restore a previous {st.label.toLowerCase()} — from this stage's history or your image library"
													>
														🕑 Restore
													</button>
												{/if}
											</div>
											{#if blocked && !referenceKit[st.key]}
												<span class="field-hint">{blocked}</span>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<div class="field-group col-span-2">
							<div class="label-row">
								<label for="p-soul">Soul / Personality</label>
								<button type="button" class="btn-sync btn-xs" onclick={enrichSoul} disabled={enrichingSoul}>
									{enrichingSoul ? '…' : '✨ AI Enrich'}
								</button>
							</div>
							<textarea id="p-soul" bind:value={soulText} rows="6" placeholder="Define your agent's personality, voice, and behavioral directives…"></textarea>
						</div>

						<div class="field-group col-span-2">
							<div class="label-row">
								<label>Skills &amp; Capabilities</label>
								<button type="button" class="btn-sync btn-xs" onclick={() => (editingSkill = { id: `s${Date.now()}`, name: '', md: '' })}>+ Add skill</button>
							</div>
							{#if skillsList.length === 0}
								<p class="field-hint">No skills defined yet — each skill is a markdown playbook the persona follows.</p>
							{:else}
								<div class="item-chips">
									{#each skillsList as s (s.id)}
										<button type="button" class="item-chip" onclick={() => (editingSkill = { ...s })}>
											📘 {s.name}
										</button>
									{/each}
								</div>
							{/if}
						</div>

						<div class="field-group col-span-2">
							<div class="label-row">
								<label>Tools &amp; Integrations</label>
								<button type="button" class="btn-sync btn-xs" onclick={() => (editingTool = { id: `t${Date.now()}`, kind: 'posting', label: '', config: '' })}>+ Add integration</button>
							</div>
							{#if toolsList.length === 0}
								<p class="field-hint">Connect intents — posting targets, analytics, MCP servers, API calls this persona uses.</p>
							{:else}
								<div class="item-chips">
									{#each toolsList as t (t.id)}
										<button type="button" class="item-chip" onclick={() => (editingTool = { ...t })}>
											🔌 {t.label} <span class="chip-kind">{t.kind}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>

					</div>
				</section>

				{#if editingSkill}
					<div class="gen-confirm-overlay" role="dialog" aria-modal="true" aria-label="Edit skill">
						<div class="gen-confirm editor-modal">
							<h3>{skillsList.some((s) => s.id === editingSkill?.id) ? 'Edit skill' : 'New skill'}</h3>
							<div class="field-group">
								<label for="skill-name">Skill name</label>
								<input id="skill-name" type="text" bind:value={editingSkill.name} placeholder="e.g. Hook writing for Reels" />
							</div>
							<div class="field-group">
								<label for="skill-md">Playbook (markdown)</label>
								<textarea id="skill-md" class="mono" rows="12" bind:value={editingSkill.md} placeholder="## When to use&#10;- …&#10;&#10;## Steps&#10;1. …"></textarea>
							</div>
							<div class="gc-actions">
								{#if skillsList.some((s) => s.id === editingSkill?.id)}
									<button type="button" class="btn-danger-ghost" onclick={() => deleteSkill(editingSkill!.id)}>Delete</button>
								{/if}
								<button type="button" class="btn-sync" onclick={() => (editingSkill = null)}>Cancel</button>
								<button type="button" class="btn-generate" onclick={saveSkill}>Save skill</button>
							</div>
						</div>
					</div>
				{/if}

				{#if editingTool}
					<div class="gen-confirm-overlay" role="dialog" aria-modal="true" aria-label="Edit integration">
						<div class="gen-confirm editor-modal">
							<h3>{toolsList.some((t) => t.id === editingTool?.id) ? 'Edit integration' : 'New integration'}</h3>
							<div class="field-group">
								<label for="tool-kind">Type</label>
								<select id="tool-kind" bind:value={editingTool.kind}>
									{#each TOOL_KINDS as k}<option value={k}>{k}</option>{/each}
								</select>
							</div>
							<div class="field-group">
								<label for="tool-label">Label</label>
								<input id="tool-label" type="text" bind:value={editingTool.label} placeholder="e.g. Instagram via Zernio, Analytics webhook" />
							</div>
							<div class="field-group">
								<label for="tool-config">Configuration / intent</label>
								<textarea id="tool-config" class="mono" rows="8" bind:value={editingTool.config} placeholder={'{ "endpoint": "…", "notes": "what this persona uses it for" }'}></textarea>
							</div>
							<div class="gc-actions">
								{#if toolsList.some((t) => t.id === editingTool?.id)}
									<button type="button" class="btn-danger-ghost" onclick={() => deleteTool(editingTool!.id)}>Delete</button>
								{/if}
								<button type="button" class="btn-sync" onclick={() => (editingTool = null)}>Cancel</button>
								<button type="button" class="btn-generate" onclick={saveTool}>Save integration</button>
							</div>
						</div>
					</div>
				{/if}

				<!-- Persona Profile section -->
				<!-- Automation section -->
				<section class="profile-section">
					<div class="section-header">
						<h2 class="section-title">Automation</h2>
						<p class="section-desc">Posting schedule and content sourcing mode.</p>
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
										<option value={v.name}>{v.label} · {v.gender === 'male' ? '♂' : '♀'}{v.accent ? ` · ${v.accent}` : ''} · {v.style}</option>
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
							<label for="p-ppd">Posts Per Day</label>
							<input
								id="p-ppd"
								type="number"
								min="1"
								max="10"
								step="1"
								class="field-input"
								bind:value={postsPerDay}
								oninput={() => {
									if (postsPerDay > 10) postsPerDay = 10;
									if (postsPerDay < 1) postsPerDay = 1;
								}}
							/>
							<p class="field-hint">Max 10 per day.</p>
						</div>

						<div class="field-group">
							<label for="p-autonomy">Autonomy</label>
							<select id="p-autonomy" bind:value={autonomyLevel} onchange={handleAutonomyChange}>
								<option value="advisor">Advisor — manual generate only</option>
								<option value="semi_autonomous">Semi — drafts for review</option>
								<option value="fully_autonomous">Fully — publishes unattended</option>
							</select>
							<p class="field-hint">
								{#if autonomyLevel === 'fully_autonomous'}
									Publishing without review — drop back to Semi if quality slips.
								{:else if graduationEligible}
									✅ Eligible to graduate: {publishedCleanCount} clean published posts. Switch to Fully when confident.
								{:else}
									Graduates to Fully after ~21 clean published posts ({publishedCleanCount} so far, {recentFailedCount} recent failure{recentFailedCount === 1 ? '' : 's'}).
								{/if}
							</p>
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

				<!-- Spend & Pricing section -->
				<section class="profile-section">
					<div class="section-header">
						<h2 class="section-title">Spend &amp; Pricing</h2>
						<p class="section-desc">Estimated generation credits used by this persona, split by provider — plus the rate card behind the numbers.</p>
					</div>

					{#if agentSpend && agentSpend.total > 0}
						<div class="spend-chips">
							<div class="spend-chip spend-total">
								<span class="spend-label">Total</span>
								<span class="spend-val">${agentSpend.total.toFixed(2)}</span>
							</div>
							{#each Object.entries(agentSpend.byProvider) as [prov, amt]}
								<div class="spend-chip">
									<span class="spend-label">{prov}</span>
									<span class="spend-val">${amt.toFixed(2)}</span>
								</div>
							{/each}
							{#each Object.entries(agentSpend.byOperation) as [op, amt]}
								<div class="spend-chip spend-op">
									<span class="spend-label">{op}</span>
									<span class="spend-val">${amt.toFixed(2)}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="field-hint">No tracked generation spend yet — the ledger starts recording with the next generation.</p>
					{/if}

					<details class="pricing-details">
						<summary>Rate card (estimated USD per call)</summary>
						<div class="pricing-table-wrap">
							<table class="pricing-table">
								<thead><tr><th>Provider</th><th>Operation</th><th>Model</th><th>Est. cost</th></tr></thead>
								<tbody>
									{#each PRICING_MATRIX as row}
										<tr>
											<td>{row.provider}</td>
											<td>{row.operation}</td>
											<td>{row.model}</td>
											<td>{row.note ?? `$${row.usd}`}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</details>
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
									<!-- Every platform connects the same way: a Zernio hosted-OAuth
									     link filed under this persona's profile. -->
									<button
										type="button"
										class="btn-connect-inline"
										disabled={connectingPlatform === p.key}
										title={`Connect ${p.name} via Zernio`}
										onclick={() => connectPlatform(p.key)}
									>
										{connectingPlatform === p.key ? 'Connecting…' : `+ ${p.name}`}
									</button>
								{/if}
							{/each}
						</div>
					</div>

					<!-- Pay-per-account meter — Zernio bills per connected account across
					     your whole key (2 free, then $6/$3/$1 by volume), NOT per persona
					     and NOT a plan tier. Shown so adding a platform is never a surprise
					     charge. -->
					{#if accountMeter}
						<div class="zernio-meter" class:over-free={accountMeter.billable > 0}>
							<div class="meter-head">
								<span class="meter-title">Zernio accounts</span>
								<span class="meter-sub">across your key · billed per connected account</span>
							</div>
							<div class="meter-track" role="img" aria-label="{accountMeter.total} accounts connected, {accountMeter.freeUsed} of 2 free used">
								{#each Array(Math.min(Math.max(accountMeter.total, 2), 12)) as _, i}
									<span
										class="meter-pip"
										class:free={i < 2}
										class:filled={i < accountMeter.total}
										class:billable={i >= 2 && i < accountMeter.total}
									></span>
								{/each}
								{#if accountMeter.total > 12}
									<span class="meter-overflow">+{accountMeter.total - 12}</span>
								{/if}
							</div>
							<div class="meter-stats">
								<span><strong>{accountMeter.total}</strong> connected</span>
								{#if accountMeter.freeRemaining > 0}
									<span class="meter-good">{accountMeter.freeRemaining} free {accountMeter.freeRemaining === 1 ? 'slot' : 'slots'} left</span>
								{:else}
									<span class="meter-bill"><strong>${accountMeter.monthlyCostUsd}</strong>/mo · {accountMeter.billable} billable</span>
								{/if}
							</div>
							<p class="meter-note">
								{#if accountMeter.freeRemaining > 0}
									Your first 2 connected accounts are free. The next account adds
									<strong>${accountMeter.nextAccountCostUsd}/mo</strong>.
								{:else}
									Each additional account is
									<strong>${accountMeter.nextAccountCostUsd}/mo</strong>. Manage billing on your
									<a href={connectHub?.url ?? 'https://zernio.com/dashboard'} target="_blank" rel="noopener">Zernio dashboard</a>.
								{/if}
								{#if !accountMeter.hasAnalyticsAccess}
									<br /><span class="meter-warn">Live follower &amp; engagement stats need analytics enabled on your Zernio key.</span>
								{/if}
							</p>
						</div>
					{/if}

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

		{/if}
	</div>
</div>

<!-- Confirm-before-generate: resolves the REAL payload server-side, shows it
     editable, and only runs what the user approved. Used by every generate action. -->
<GenerationComposer
	open={composerOpen}
	spec={composerSpec}
	onClose={() => (composerOpen = false)}
	onConfirm={(body) => onComposerConfirm(body)}
	onGoToConnections={() => {
		composerOpen = false;
		activeTab = 'connections';
	}}
/>

<!-- Expand a generated asset full-size, with Regenerate right where the user
     is judging the result. -->
<MediaPreviewModal
	open={previewOpen}
	url={previewUrl}
	title={previewTitle}
	regenerating={generatingAvatar || generatingKitStage !== null}
	onRegenerate={previewRegenerate
		? () => {
				previewOpen = false;
				previewRegenerate?.();
			}
		: null}
	onClose={() => (previewOpen = false)}
/>

{#if assetLightbox}
	<div class="lightbox-backdrop" onclick={() => (assetLightbox = null)} role="presentation">
		<div class="lightbox-content" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={assetLightbox.label}>
			{#if assetLightbox.type === 'video'}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={assetLightbox.url} poster={assetLightbox.poster || undefined} controls autoplay playsinline></video>
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

<!-- Reference-kit / profile-picture preview. openPreview() sets these; without
     this block the thumbnails' click handlers were no-ops (set previewOpen=true
     with nothing rendering it). Mirrors the assets lightbox for consistency,
     plus an optional Regenerate for the stage it came from. -->
{#if previewOpen && previewUrl}
	<div class="lightbox-backdrop" onclick={() => (previewOpen = false)} role="presentation">
		<div class="lightbox-content" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={previewTitle}>
			<img src={previewUrl} alt={previewTitle} />
			<div class="lightbox-bar">
				<span>{previewTitle}</span>
				<a href={previewUrl} target="_blank" rel="noopener noreferrer">Open original ↗</a>
				{#if previewRegenerate}
					<button
						type="button"
						onclick={() => {
							const fn = previewRegenerate;
							previewOpen = false;
							fn?.();
						}}
					>↺ Regenerate</button>
				{/if}
				<button type="button" onclick={() => (previewOpen = false)}>Close</button>
			</div>
		</div>
	</div>
{/if}

<!-- Restore-from-history picker: every past generated image, click to re-pin
     as this persona's profile picture. Nothing here is ever deleted. -->
{#if restoreOpen}
	<div class="lightbox-backdrop" onclick={() => (restoreOpen = false)} role="presentation">
		<div class="restore-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Restore profile picture">
			<div class="restore-head">
				<div>
					<h3>Restore a profile picture</h3>
					<p>Every image ever generated for your account — click one to make it {agent?.name}'s face. Nothing is deleted.</p>
				</div>
				<button type="button" class="restore-close" onclick={() => (restoreOpen = false)} aria-label="Close">✕</button>
			</div>
			{#if restoreLoading}
				<div class="feed-loading"><span class="spinner"></span> Loading your image history…</div>
			{:else if restoreImages.length === 0}
				<p class="field-hint" style="padding: 2rem; text-align: center;">No stored images found yet.</p>
			{:else}
				<div class="restore-grid">
					{#each restoreImages as img (img.url)}
						<button
							type="button"
							class="restore-tile"
							class:current={img.url === characterRef}
							onclick={() => restoreAvatar(img.url)}
							disabled={restoringUrl !== null}
							title={img.createdAt ?? img.name}
						>
							<img src={img.url} loading="lazy" alt="Generated image" />
							{#if img.url === characterRef}
								<span class="restore-badge">Current</span>
							{:else if restoringUrl === img.url}
								<span class="restore-badge">Restoring…</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Per-stage reference-kit restore: past generations of ONE stage (full body,
     side profiles, close-up, feature grid), click to re-pin for that stage. -->
{#if kitRestoreStage}
	<div class="lightbox-backdrop" onclick={() => (kitRestoreStage = null)} role="presentation">
		<div class="restore-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Restore reference-kit stage">
			<div class="restore-head">
				<div>
					<h3>Restore {KIT_STAGE_RESTORE_LABELS[kitRestoreStage] ?? kitRestoreStage}</h3>
					<p>
						Re-pin a past image for this stage — from {agent?.name}'s past
						{(KIT_STAGE_RESTORE_LABELS[kitRestoreStage] ?? kitRestoreStage).toLowerCase()} generations, or
						from your full image library. Nothing is deleted.
					</p>
				</div>
				<button type="button" class="restore-close" onclick={() => (kitRestoreStage = null)} aria-label="Close">✕</button>
			</div>
			<div class="restore-tabs">
				<button
					type="button"
					class="restore-tab"
					class:on={kitRestoreMode === 'stage'}
					onclick={() => setKitRestoreMode('stage')}>This stage ({kitRestoreImages.length})</button
				>
				<button
					type="button"
					class="restore-tab"
					class:on={kitRestoreMode === 'all'}
					onclick={() => setKitRestoreMode('all')}>All images</button
				>
			</div>

			{#if kitRestoreMode === 'stage'}
				{#if kitRestoreImages.length === 0}
					<p class="field-hint" style="padding: 2rem; text-align: center;">
						No tagged history for this stage yet — switch to “All images” to pick from any past
						generation.
					</p>
				{:else}
					<div class="restore-grid">
						{#each kitRestoreImages as url (url)}
							<button
								type="button"
								class="restore-tile"
								class:current={url === referenceKit[kitRestoreStage]}
								onclick={() => restoreKitStage(url)}
								disabled={kitRestoringUrl !== null}
							>
								<img src={url} loading="lazy" alt="Past generation" />
								{#if url === referenceKit[kitRestoreStage]}
									<span class="restore-badge">Current</span>
								{:else if kitRestoringUrl === url}
									<span class="restore-badge">Restoring…</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			{:else if kitRestoreLoadingAll}
				<div class="feed-loading"><span class="spinner"></span> Loading your image library…</div>
			{:else if kitRestoreAll.length === 0}
				<p class="field-hint" style="padding: 2rem; text-align: center;">No stored images found yet.</p>
			{:else}
				<div class="restore-grid">
					{#each kitRestoreAll as img (img.url)}
						<button
							type="button"
							class="restore-tile"
							class:current={img.url === referenceKit[kitRestoreStage]}
							onclick={() => restoreKitStage(img.url)}
							disabled={kitRestoringUrl !== null}
						>
							<img src={img.url} loading="lazy" alt="Library image" />
							{#if img.url === referenceKit[kitRestoreStage]}
								<span class="restore-badge">Current</span>
							{:else if kitRestoringUrl === img.url}
								<span class="restore-badge">Restoring…</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Publish an already-generated post to a connected platform. Media is ready;
     only publishing failed. User picks where — no auto-retry. -->
{#if publishFallbackPost}
	<div class="lightbox-backdrop" onclick={() => (publishFallbackPost = null)} role="presentation">
		<div
			class="restore-modal pubfb-modal"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-label="Publish to a connected platform"
		>
			<div class="restore-head">
				<div>
					<h3>Publish to a connected platform</h3>
					<p>
						This post's media is ready — only publishing failed. Pick where to send it. Only
						connected, compatible platforms are shown, and nothing auto-retries.
					</p>
				</div>
				<button type="button" class="restore-close" onclick={() => (publishFallbackPost = null)} aria-label="Close">✕</button>
			</div>
			{#if publishFallbackLoading}
				<div class="feed-loading"><span class="spinner"></span> Checking your connections…</div>
			{:else if publishFallbackOptions.length === 0}
				<div class="pubfb-empty">
					<p>No connected account can accept this post yet — connect a platform first.</p>
					<button
						type="button"
						class="btn-sync"
						onclick={() => {
							publishFallbackPost = null;
							activeTab = 'connections';
						}}>Go to Connections →</button
					>
				</div>
			{:else}
				<div class="pubfb-chips">
					{#each publishFallbackOptions as p}
						<button
							type="button"
							class="pubfb-chip"
							class:on={publishFallbackSelected.includes(p)}
							onclick={() => togglePublishFallback(p)}>{p}</button
						>
					{/each}
				</div>
				<div class="pubfb-actions">
					<button
						type="button"
						class="btn-primary-cta"
						disabled={publishFallbackPublishing || publishFallbackSelected.length === 0}
						onclick={confirmPublishFallback}
					>
						{#if publishFallbackPublishing}
							<span class="spinner-sm"></span> Publishing…
						{:else}
							Publish now
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
{/if}

<style>
	/* ── Restore-from-history modal ── */
	.restore-modal {
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		width: min(920px, 94vw);
		max-height: 86vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		z-index: 1101;
	}
	.restore-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.3rem;
		border-bottom: 1px solid var(--border);
	}
	.restore-head h3 {
		margin: 0;
		font-size: 1rem;
	}
	.restore-head p {
		margin: 0.25rem 0 0;
		font-size: 0.78rem;
		color: var(--text-dim);
	}
	.restore-close {
		border: none;
		background: var(--surface-2);
		color: var(--text-muted);
		width: 30px;
		height: 30px;
		border-radius: 999px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.restore-tabs {
		display: flex;
		gap: 0.4rem;
		padding: 0.75rem 1.3rem 0;
	}
	.restore-tab {
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-muted);
		border-radius: 999px;
		padding: 0.35rem 0.85rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.restore-tab.on {
		background: var(--accent-mid, #7c6aed);
		border-color: var(--accent-mid, #7c6aed);
		color: #fff;
	}
	.restore-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.6rem;
		padding: 1rem 1.3rem 1.3rem;
		overflow-y: auto;
	}
	.restore-tile {
		position: relative;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 10px;
		overflow: hidden;
		cursor: pointer;
		background: var(--surface-2);
		aspect-ratio: 1;
		transition: border-color 0.15s ease, transform 0.15s ease;
	}
	.restore-tile:hover:not(:disabled) {
		border-color: var(--accent);
		transform: scale(1.03);
	}
	.restore-tile.current {
		border-color: var(--success);
	}
	.restore-tile:disabled {
		cursor: default;
		opacity: 0.85;
	}
	.restore-tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.restore-badge {
		position: absolute;
		bottom: 4px;
		left: 4px;
		right: 4px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		background: rgba(10, 14, 26, 0.78);
		color: #fff;
		padding: 3px 4px;
		border-radius: 4px;
	}

	/* ── Publish-to-connected-platform modal ── */
	.pubfb-modal {
		max-width: 460px;
	}
	.pubfb-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.5rem 0 1rem;
	}
	.pubfb-chip {
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
		border-radius: 999px;
		padding: 0.4rem 0.85rem;
		font-size: 0.85rem;
		text-transform: capitalize;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.pubfb-chip.on {
		background: var(--accent-mid, #7c6aed);
		border-color: var(--accent-mid, #7c6aed);
		color: #fff;
	}
	.pubfb-actions {
		display: flex;
		justify-content: flex-end;
	}
	.btn-primary-cta {
		background: var(--accent-mid, #7c6aed);
		border: 1px solid var(--accent-mid, #7c6aed);
		color: #fff;
		border-radius: 10px;
		padding: 0.55rem 1.1rem;
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.btn-primary-cta:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.pubfb-empty {
		padding: 1rem 0 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
	}
	.pubfb-empty p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	/* ── Page ── */
	.persona-page {
		max-width: 900px;
		margin: 0 auto;
	}

	/* ── Feed view toggle (Posts | Assets) ── */
	.feed-view-toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}

	.view-toggle-btn {
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.view-toggle-btn.active {
		background: var(--accent-soft, rgba(124, 106, 237, 0.12));
		color: var(--accent);
	}

	/* ── Assets view ── */
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
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		margin-bottom: 1.5rem;
		overflow: hidden;
	}

	/* Row that holds avatar + info + stats */
	.hero-row {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 1.25rem 2rem;
		flex-wrap: wrap;
	}

	.hero-avatar {
		width: 80px;
		height: 80px;
		border-radius: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.75rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		overflow: hidden;
		box-shadow: 0 6px 24px rgba(0,0,0,0.4);
		border: 3px solid var(--surface);
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

	.stat-chip-spend {
		border-color: rgba(251, 191, 36, 0.35);
		background: rgba(251, 191, 36, 0.06);
	}

	.stat-chip-spend .stat-val {
		color: #f59e0b;
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

	/* ── Persona Profile section ── */
	.age-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.age-chip {
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
		background: rgba(255, 255, 255, 0.03);
		color: var(--text-dim, #9aa);
		font-size: var(--text-sm, 0.85rem);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.age-chip:hover {
		border-color: var(--accent-mid, #7c6aed);
		color: var(--text, #fff);
	}
	.age-chip.selected {
		background: var(--accent-mid, #7c6aed);
		border-color: var(--accent-mid, #7c6aed);
		color: #fff;
	}
	.age-chip-all {
		font-style: italic;
	}

	.age-range-row {
		display: flex;
		gap: 2rem;
		flex-wrap: wrap;
	}

	.age-slider-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 180px;
	}

	.age-slider-group input[type="range"] {
		flex: 1;
	}

	.age-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		white-space: nowrap;
		min-width: 3rem;
		text-align: right;
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

	/* Uniform asset-style tile grid (the masonry/mosaic columns are retired —
	   cards now match the Assets tab's clean, equal-sized tile look). */
	.post-mosaic {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 1rem;
		align-items: start;
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

	/* Appearance / wardrobe dynamic-variable grid. */
	.appearance-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.6rem 0.75rem;
	}
	.appearance-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.appearance-field span {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text-muted);
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

	.kit-stage-thumb.clickable {
		cursor: zoom-in;
		transition: border-color 0.15s ease, transform 0.15s ease;
	}

	.kit-stage-thumb.clickable:hover {
		border-color: var(--accent);
		transform: scale(1.02);
	}

	.kit-stage-thumb.wide {
		width: 200px;
	}

	.kit-stage-generate {
		border-radius: 8px;
		border: 1px dashed var(--border-strong);
		background: var(--surface-2);
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		font-size: 0.75rem;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		color: var(--text-muted);
		transition: border-color 0.15s, color 0.15s;
	}

	.kit-stage-generate:hover:not(:disabled) {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	/* Regenerate + Restore sit side by side under a generated stage. */
	.kit-stage-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		justify-content: center;
	}

	/* When there is NO image above it, give it the square placeholder look */
	.kit-stage:not(:has(img)) .kit-stage-generate {
		width: 120px;
		height: 120px;
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

	/* ── Confirm + editor modals / structured skills & tools ── */
	.gen-confirm-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 1100;
		padding: 1rem;
	}
	.gen-confirm {
		width: min(480px, 100%);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 1.25rem 1.4rem;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
		max-height: 90vh;
		overflow-y: auto;
	}
	.gen-confirm h3 { margin: 0 0 0.9rem; }
	.editor-modal { width: min(620px, 100%); display: flex; flex-direction: column; gap: 0.9rem; }
	.gc-rows { display: flex; flex-direction: column; gap: 0.55rem; margin-bottom: 1rem; }
	.gc-row { display: flex; gap: 0.75rem; font-size: var(--text-sm); }
	.gc-label {
		flex: 0 0 88px;
		color: var(--text-dim);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding-top: 2px;
	}
	.gc-skip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-xs);
		color: var(--text-dim);
		margin-bottom: 1rem;
		cursor: pointer;
	}
	.gc-actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.4rem;
	}
	.btn-xs { padding: 0.3rem 0.7rem; font-size: var(--text-xs); }
	.item-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.item-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.85rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-2, rgba(255, 255, 255, 0.03));
		color: var(--text);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: border-color 0.15s ease;
	}
	.item-chip:hover { border-color: var(--accent-mid); }
	.chip-kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 1px 6px;
	}
	.editor-modal .mono { font-family: var(--font-mono, monospace); font-size: 0.8rem; }
	.opt { font-weight: 400; color: var(--text-dim); font-size: var(--text-xs); }
	.composer-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
	.composer-advanced summary {
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin: 0.25rem 0 0.75rem;
	}
	.composer-advanced .field-group { margin-bottom: 0.75rem; }
	.btn-danger-ghost {
		margin-right: auto;
		padding: 0.5rem 0.9rem;
		border-radius: 9px;
		border: 1px solid var(--danger, #ef4444);
		color: var(--danger, #ef4444);
		background: transparent;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	/* ── Spend & Pricing ── */
	.spend-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.spend-chip {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.5rem 0.9rem;
		border-radius: 10px;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
		min-width: 84px;
	}
	.spend-chip.spend-total {
		border-color: var(--accent-mid, #7c6aed);
	}
	.spend-chip.spend-op {
		opacity: 0.75;
	}
	.spend-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim, #99a);
	}
	.spend-val {
		font-family: var(--font-mono, monospace);
		font-weight: 700;
		font-size: var(--text-sm, 0.9rem);
	}
	.pricing-details summary {
		cursor: pointer;
		font-size: var(--text-sm, 0.85rem);
		color: var(--text-dim, #99a);
		margin-bottom: 0.5rem;
	}
	.pricing-table-wrap {
		overflow-x: auto;
	}
	.pricing-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-xs, 0.78rem);
	}
	.pricing-table th,
	.pricing-table td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.06));
	}
	.pricing-table th {
		color: var(--text-dim, #99a);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.05em;
	}

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

	/* Pay-per-account meter */
	.zernio-meter {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1.25rem;
		margin-bottom: 1.25rem;
	}
	.zernio-meter.over-free {
		border-color: color-mix(in srgb, #f59e0b 45%, var(--border));
		background: color-mix(in srgb, #f59e0b 5%, var(--surface));
	}
	.meter-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.meter-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text);
	}
	.meter-sub {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.meter-track {
		display: flex;
		gap: 4px;
		margin: 0.6rem 0 0.5rem;
		flex-wrap: wrap;
	}
	.meter-pip {
		width: 22px;
		height: 6px;
		border-radius: 999px;
		background: var(--surface-2, var(--border));
		border: 1px solid var(--border);
	}
	.meter-pip.filled.free {
		background: #10b981;
		border-color: #10b981;
	}
	.meter-pip.filled.billable {
		background: #f59e0b;
		border-color: #f59e0b;
	}
	.meter-overflow {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-muted);
		margin-left: 2px;
	}
	.meter-stats {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.meter-stats strong {
		color: var(--text);
	}
	.meter-good {
		color: #10b981;
		font-weight: 600;
	}
	.meter-bill strong {
		color: #f59e0b;
	}
	.meter-note {
		font-size: 0.74rem;
		color: var(--text-muted);
		margin: 0.5rem 0 0;
		line-height: 1.5;
	}
	.meter-note a {
		color: var(--accent);
		text-decoration: underline;
	}
	.meter-warn {
		color: #f59e0b;
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
		.post-mosaic { grid-template-columns: 1fr; }
	}
</style>
