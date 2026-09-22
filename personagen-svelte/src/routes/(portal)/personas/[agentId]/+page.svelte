<script lang="ts">
	import { FULL_ACCESS, seatBlockedReason, type SeatCapabilities } from '$lib/seat';
	import { personaStatusFill } from '$lib/status-color';
	import { dialog } from '$lib/actions/dialog';
	import { syncParam, readParam } from '$lib/url-state';
	import { onMount, onDestroy, tick } from 'svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import { goto, invalidateAll, beforeNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { slide } from 'svelte/transition';
	import { Accounts, Autopilot, Posts, BrandBrief, parseJsonResponse } from '$lib/services/api';
	import AgentConnectionStats from '$lib/components/agents/AgentConnectionStats.svelte';
	import { PRICING_MATRIX } from '$lib/pricing';
	// Money on this screen is what the customer pays, not what the provider
	// charges us: quote() applies the live markup and renders in the viewer's
	// own currency, the same numbers the sidebar wallet pill shows.
	import { quote, pricingContext } from '$lib/stores/pricing.svelte';
	import { countLabel, plural } from '$lib/plural';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import CalendarView from '$lib/components/calendar/CalendarView.svelte';
	import ManualDeleteNotice from '$lib/components/feed/ManualDeleteNotice.svelte';
	import SelectionToolbar from '$lib/components/ui/SelectionToolbar.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { getPostDisplay } from '$lib/components/feed/postDisplay';
	import {
		STUDIO_TEMPLATES,
		STUDIO_SURFACES,
		PIPELINE_META,
		PIPELINE_USD,
		type StudioTemplate,
		type StudioSurface,
		type StudioIntent
	} from '$lib/studio-templates';
	import type { AutonomyLevel } from '$lib/types';
	import { AUTONOMY_LABELS } from '$lib/types';
	import {
		PLATFORMS as PLATFORM_REGISTRY,
		platformLabel,
		platformProfileUrl
	} from '$lib/platforms';
	import GenerationComposer from '$lib/components/generation/GenerationComposer.svelte';
	import type { ComposerSpec } from '$lib/components/generation/types';
	import { NICHE_OPTIONS, stripLeadingAvatarName } from '$lib/persona-profile';
	import TraitPicker from '$lib/components/persona/TraitPicker.svelte';
	import {
		BIO_PLATFORM_KEYS,
		bioLimit,
		coerceHandleCandidates,
		mergeHandleCandidates,
		sanitizeHandle,
		handleCompatNote,
		type HandleCandidate
	} from '$lib/persona-identity';
	import { readPersonaProfile } from '$lib/persona-profile-store';
	import { readPersonaProfileV2 } from '$lib/persona-contract';
	import LifeDetails from '$lib/components/personas/LifeDetails.svelte';
	import { buildLifeDetails } from '$lib/components/personas/life-details';
	import StaleNotices from '$lib/components/personas/StaleNotices.svelte';
	import { staleWarnings, type StaleWarning } from '$lib/components/personas/stale-state';
	import ViewerPanel, { hasStatedAudience } from '$lib/components/personas/ViewerPanel.svelte';
	import { sampleViewerPanel } from '$lib/persona-contract/panel';
	import { confirmDeletePosts } from '$lib/confirm-preview';
	import { confirmAction } from '$lib/stores/confirm.svelte';
	import MediaPreviewModal from '$lib/components/generation/MediaPreviewModal.svelte';
	import PageShell from '$lib/components/ui/PageShell.svelte';
	import { refreshCredits } from '$lib/credits-refresh';
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
	// Tracks which agent's data is currently loaded into `agent`/the editable
	// fields below, so the resync effect (further down) can tell "navigated to
	// a different persona" apart from "same persona's data merely refreshed."
	let loadedAgentId: string | null = data.agent?.id ?? null;

	// ── Tab state ──────────────────────────────────────────────────
	// Two top-level tabs, each with lenses (view-switcher pattern from the review
	// queue). Legacy ?tab= values map onto tab+lens so every old deep link still
	// lands exactly where it used to:
	//   profile → Profile·Overview      connections → Profile·Connections
	//   feed → Content·Posts   assets → Content·Assets   calendar → Content·Calendar
	function initialTab(): 'feed' | 'calendar' | 'profile' | 'connections' | 'studio' {
		// 'posts' guards against any stray write of the new lens name.
		const t = $page.url.searchParams.get('tab');
		if (t === 'studio') return 'studio';
		// Legacy ?tab=assets links land on the Feed tab in assets view — the
		// Assets tab was merged into Feed as a view toggle. Profile is the
		// default landing tab; Feed/Calendar/Connections require an explicit ?tab.
		if (t === 'feed' || t === 'assets' || t === 'posts') return 'feed';
		if (t === 'calendar') return 'calendar';
		if (t === 'connections') return 'connections';
		return 'profile';
	}
	const legacyTab = initialTab();
	let activeTab = $state<'profile' | 'content' | 'studio'>(
		legacyTab === 'studio'
			? 'studio'
			: legacyTab === 'feed' || legacyTab === 'calendar'
				? 'content'
				: 'profile'
	);
	let profileView = $state<'overview' | 'connections'>(
		legacyTab === 'connections' ? 'connections' : 'overview'
	);
	// The page already *read* ?tab= on load but never wrote it, so switching tabs
	// left the URL stale and Back/refresh/share all snapped to Profile.
	// The URL keeps the LEGACY vocabulary (profile/connections/feed/assets/calendar)
	// even though the UI is now two tabs with lenses — existing shared links and
	// bookmarks keep meaning exactly what they meant.
	$effect(() =>
		syncParam(
			'tab',
			activeTab === 'studio'
				? 'studio'
				: activeTab === 'profile'
					? profileView === 'connections'
						? 'connections'
						: 'profile'
					: feedView === 'posts'
						? 'feed' // legacy name for the posts lens — initialTab() only knows this one
						: feedView,
			'profile'
		)
	);
	// Content tab renders one dataset through three lenses: the post mosaic, the
	// flat grid of every generated visual (former Assets tab), or the calendar
	// (former Calendar tab).
	let feedView = $state<'posts' | 'assets' | 'calendar'>(
		$page.url.searchParams.get('tab') === 'assets'
			? 'assets'
			: legacyTab === 'calendar'
				? 'calendar'
				: 'posts'
	);

	// ── Profile layout: an OPTIONAL alternate arrangement ──────────────────
	// Classic stays the default and is byte-for-byte what it always was. Bento
	// re-places the very same <details> sections into a grid — no section is
	// rewritten, no state is duplicated, and every control behaves identically in
	// both. The switch is purely where the boxes sit.
	type ProfileLayout = 'classic' | 'bento';
	let profileLayout = $state<ProfileLayout>(
		readParam('layout', ['classic', 'bento'] as const, 'classic')
	);
	$effect(() => syncParam('layout', profileLayout, 'classic'));

	// ── Feed state ─────────────────────────────────────────────────
	let feedPosts = $state<any[]>([]);

	// Graduation signal: enough clean published posts + no recent failures →
	// safe to promote this persona from Semi (review phase) to Fully Autonomous.
	const GRADUATION_TARGET = 21; // ≈ 3/day × 7-day clean streak
	let publishedCleanCount = $derived(feedPosts.filter((p: any) => p.status === 'published').length);
	let recentFailedCount = $derived(
		feedPosts.filter((p: any) => p.status === 'failed' || p.status === 'partial').length
	);
	let graduationEligible = $derived(
		publishedCleanCount >= GRADUATION_TARGET && recentFailedCount === 0
	);
	// Hero "Posts" must reflect what's ACTUALLY live on the platform — published (or
	// partial = live on ≥1 platform) — NOT every internal row. Counting drafts/scheduled
	// as "Posts" claimed "8 posts" for a persona whose connected account had 0. Pending
	// work is surfaced separately as "Queued" so nothing is hidden.
	/** True once loadFeed() has actually answered for THIS persona. Until then
	 *  `feedPosts` is an empty array that means "not fetched", not "none". */
	let feedLoaded = $state(false);


	// The server's count query is the baseline, so the hero is right on every tab
	// — the feed is only fetched on Content/Studio, and deriving the count from it
	// made a persona with three published posts report "0 POSTS" everywhere else.
	// Once the feed IS loaded it takes over, so approving or deleting a post
	// updates the stat immediately instead of waiting for a reload.
	let postedCount = $derived(
		feedLoaded
			? feedPosts.filter((p: any) => p.status === 'published').length
			: (data.postCounts?.published ?? 0)
	);
	let queuedCount = $derived(
		feedLoaded
			? feedPosts.filter((p: any) => p.status === 'draft' || p.status === 'scheduled').length
			: (data.postCounts?.queued ?? 0)
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
	let generatingKitStage = $state<
		'full_body' | 'side_profiles' | 'face_closeup' | 'feature_grid' | null
	>(null);
	let editSupervisorId = $state<string | null>(agent?.supervisor_agent_id ?? null);
	let editRuntimeOwner = $state<'svelte-gemini' | 'hermes-daemon' | 'hermes-orchestrated'>(
		agent?.runtime_owner ?? 'svelte-gemini'
	);

	// ── Extended persona profile (personas_profile JSONB, falling back to the
	// legacy agents.market JSON string) ───────────────────────────────────
	function parsePersonaProfile(agent: any): Record<string, any> {
		return readPersonaProfile(agent);
	}
	let personaProfile = $state<Record<string, any>>(parsePersonaProfile(agent));

	// ── Life details (READ-ONLY) ──────────────────────────────────────────
	// Persona Model v2 gives a creator a life the wizard never asks for — where
	// they live, what they do, who they live with — and the sampler fills it in.
	// This derives display rows straight from the stored record (a v1 blob is
	// upgraded in memory by readPersonaProfileV2 and legitimately yields none),
	// so the section is a view of the profile and has no path back into it.
	// An empty array means the section is not mounted at all.
	let lifeDetailGroups = $derived(buildLifeDetails(readPersonaProfileV2(agent)));

	// ── Stale notices (READ-ONLY) ─────────────────────────────────────────
	// What is on this page that no longer matches the persona it belongs to: a
	// portrait job that failed or died, reference photos that never arrived, a
	// voice cast for a different gender. `staleWarnings` keys every warning on
	// evidence some code path actually WROTE, so an untouched persona yields `[]`
	// and the strip is not mounted at all.
	let staleNotices = $derived(staleWarnings(agent));

	/**
	 * Runs a stale notice's fix (audit UX-007: the notice said "generate them
	 * again" and offered nothing to click).
	 *
	 * Every branch goes through the SAME entry point the page's own buttons use,
	 * so a retry is confirmed and priced exactly like the first attempt, and the
	 * reference-kit order gate still applies. Nothing here spends directly.
	 */
	async function runStaleAction(warning: StaleWarning) {
		const action = warning.action;
		if (!action) return;
		if (action.kind === 'regenerate-portrait') {
			requestGenerateAvatar();
			return;
		}
		if (action.kind === 'regenerate-kit-stage') {
			const stage = action.stage;
			// Only the four stages the kit route accepts can be retried there. The
			// character sheet comes out of the portrait job, so its retry is that.
			if (stage === 'full_body' || (KIT_STAGE_ORDER as readonly string[]).includes(stage)) {
				requestGenerateKitStage(stage as KitStage);
			} else {
				requestGenerateAvatar();
			}
			return;
		}
		if (action.kind === 'recast-voice') {
			// The voice picker lives in the Profile tab, inside the collapsed
			// Automation section — so open both, then hand it focus. Pointing the
			// user at a control they would still have to hunt for is the defect
			// this closes, not a fix for it.
			activeTab = 'profile';
			profileView = 'overview';
			await tick();
			const select = document.getElementById('p-voice') as HTMLSelectElement | null;
			const section = select?.closest('details');
			if (section && !section.open) section.open = true;
			await tick();
			select?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			select?.focus({ preventScroll: true });
		}
	}

	// ── Viewer panel (READ-ONLY) ──────────────────────────────────────────
	// The audience is stored as a bracket; nobody writes a post for a bracket.
	// `sampleViewerPanel` turns it into a handful of concrete viewers, seeded on
	// the agent id so the panel is the same on every render rather than
	// reshuffling under the reader. Sampled from the persona's own market so the
	// places and jobs belong to the same world as the creator's.
	//
	// The sampler never returns an empty panel — an audience of nothing still
	// yields five strangers — so the gate is on the INPUT: a persona that has
	// never stated an audience gets `[]` here and no section is mounted.
	let personaProfileV2 = $derived(readPersonaProfileV2(agent));
	let viewerPanel = $derived(
		hasStatedAudience(personaProfileV2?.audience)
			? sampleViewerPanel(String(agent?.id ?? ''), personaProfileV2?.audience, {
					market: personaProfileV2?.creator?.market
				})
			: []
	);
	// Multi-brand: which of the user's brand briefs this persona generates for.
	// `savedBrandBriefId` mirrors what's actually persisted so the Brand card can
	// show an unsaved-change indicator and confirm precisely on apply.
	let selectedBrandBriefId = $state<string>(agent?.brand_brief_id ?? '');
	let savedBrandBriefId = $state<string>(agent?.brand_brief_id ?? '');
	let savingBrand = $state(false);
	let brandDirty = $derived(selectedBrandBriefId !== savedBrandBriefId);
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
	// Sanitized on load: strips any leading fictional name from avatars generated
	// before the "name the audience" bug fix, so existing personas read clean.
	let ppTargetAvatar = $state<string>(stripLeadingAvatarName(personaProfile.targetAvatar));
	// Appearance / wardrobe "dynamic variables" — the influencer's configurable look
	// (clothing, colors, hair, eyes, headwear, styling). Feeds the profile-picture
	// prompt; filled by "Generate for brand".
	let ppAppearance = $state<Record<string, string>>({ ...(personaProfile.appearance ?? {}) });
	// Voice profile inferred from the persona's NAME (nationality + accent + gender,
	// e.g. "Jenny Tran" → female Vietnamese-American). Recorded for observability;
	// the closest catalog voice gets pinned. Filled by "Generate for brand".
	let ppVoiceProfile = $state<Record<string, string>>({ ...(personaProfile.voiceProfile ?? {}) });

	// ── Platform Identity Kit ───────────────────────────────────────────────
	// The persona's public-facing identity: per-platform bios, username
	// candidates (availability confirmed MANUALLY — mark taken, confirm the one
	// that registered), display name. Copy-paste only: no platform lets us push
	// profile fields via API, so the kit is the setup source of truth.
	let ppBios = $state<Record<string, string>>({ ...(personaProfile.bios ?? {}) });
	let ppHandleCandidates = $state<HandleCandidate[]>(
		coerceHandleCandidates(personaProfile.handleCandidates)
	);
	let ppConfirmedHandles = $state<Record<string, string>>({
		...(personaProfile.confirmedHandles ?? {})
	});
	let ppDisplayName = $state<string>(personaProfile.displayName ?? '');
	// Platform selected in the kit dropdown — shared by the hero strip and the
	// Profile-tab card so both always show the same platform's bio.
	let kitPlatform = $state<string>('tiktok');
	// Manual "add my own" candidate input (for when every generated one is taken).
	let newHandleInput = $state('');

	const PERSONA_ARCHETYPES = [
		'The Creator',
		'The Expert / Authority',
		'The Relatable Friend',
		'The Aspirational',
		'The Storyteller',
		'The Activist / Advocate',
		'The Entertainer',
		'The Educator',
		'The Disruptor',
		'The Community Builder'
	];
	const CONTENT_FOCUS_OPTIONS = [
		'Education & How-Tos',
		'Entertainment & Humor',
		'Lifestyle & Aesthetic',
		'Product Reviews & UGC',
		'Inspiration & Motivation',
		'Behind-the-Scenes',
		'News & Commentary',
		'Tutorials & Demos',
		'Personal Journey'
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
	// What this plan includes. The server refuses a RAISE above the ceiling
	// (api/agents/config) and ONLY a raise — a persona already above it stays
	// saveable, including from the twenty other fields this form sends on every
	// save. Mirror that exactly, or an unrelated edit starts failing for no
	// visible reason.
	const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
		advisor: 0,
		semi_autonomous: 1,
		fully_autonomous: 2
	};
	const AUTONOMY_CEILING_LABEL: Record<AutonomyLevel, string> = {
		advisor: 'Advisor',
		semi_autonomous: 'Semi-autonomous',
		fully_autonomous: 'Fully autonomous'
	};
	// The SAVED level, not the in-flight one: the server compares against what is
	// in the database.
	let savedAutonomy = $derived((agent?.autonomy_level ?? 'advisor') as AutonomyLevel);
	let autonomyCeiling = $derived(
		(data?.entitlements?.maxAutonomy ?? 'fully_autonomous') as AutonomyLevel
	);
	/** A reason this level is out of reach, or null when it is allowed. */
	function autonomyBlockedReason(level: AutonomyLevel): string | null {
		if (AUTONOMY_RANK[level] <= AUTONOMY_RANK[autonomyCeiling]) return null;
		if (AUTONOMY_RANK[level] <= AUTONOMY_RANK[savedAutonomy]) return null;
		return `${AUTONOMY_CEILING_LABEL[level]} is not included in the ${data?.entitlements?.plan ?? 'free'} plan.`;
	}
	// {@const} may only be the immediate child of a block, and these sit inside a
	// plain <div>, so they are derived here instead.
	let semiBlocked = $derived(autonomyBlockedReason('semi_autonomous'));
	let fullyBlocked = $derived(autonomyBlockedReason('fully_autonomous'));
	/**
	 * Why Cinematic is out of reach, or null. The server refuses it BEFORE the
	 * preview branch, so a cinematic Studio template would otherwise resolve into
	 * an error pane with a Retry that can never succeed.
	 */
	let cinematicBlocked = $derived(
		data?.entitlements?.cinematic === false
			? `Cinematic video is not included in the ${data?.entitlements?.plan ?? 'free'} plan.`
			: null
	);

	// Switching to Fully Autonomous means posts publish WITHOUT review — gate it
	// behind an explicit confirm, reverting the select when the user backs out.
	let prevAutonomyLevel: AutonomyLevel = agent?.autonomy_level ?? 'advisor';
	async function handleAutonomyChange() {
		if (autonomyLevel === 'fully_autonomous' && prevAutonomyLevel !== 'fully_autonomous') {
			const ok = await confirmAction({
				title: `Switch ${agent?.name ?? 'this persona'} to Fully Autonomous?`,
				body:
					'The autopilot will generate AND publish posts unattended. Nothing waits for ' +
					'your review first. You can drop back to Semi at any time.',
				warning: 'Posts go live without you seeing them.',
				confirmLabel: 'Switch to Fully Autonomous',
				cancelLabel: 'Keep current level',
				tone: 'danger'
			});
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
		const avgEngRate =
			connectedCount > 0 ? parseFloat((totalEngRate / connectedCount).toFixed(1)) : 0;
		let followersStr = '0';
		if (totalFollowers >= 1_000_000) followersStr = (totalFollowers / 1_000_000).toFixed(1) + 'M';
		else if (totalFollowers >= 1000) followersStr = (totalFollowers / 1000).toFixed(1) + 'K';
		else followersStr = String(totalFollowers);
		return {
			followers: followersStr,
			followersRaw: totalFollowers,
			engagementRate: avgEngRate,
			connectedCount
		};
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
		// A pending kit auto-save still belongs to the PREVIOUS persona — flush it
		// against that persona's id before the state below is re-seeded, so the
		// last keystrokes land instead of being cancelled into the void.
		flushPendingKitSave(loadedAgentId ?? undefined);
		kitSaveState = 'idle';
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
		savedBrandBriefId = fresh.brand_brief_id ?? '';

		// Reset persona profile from new agent
		const freshProfile = parsePersonaProfile(fresh);
		personaProfile = freshProfile;
		ppAgeRanges = deriveAgeRanges(freshProfile);
		ppGender = freshProfile.gender ?? (data.inferredGender as '' | 'female' | 'male' | null) ?? '';
		ppArchetype = freshProfile.archetype ?? '';
		ppContentFocus = freshProfile.contentFocus ?? '';
		ppPsychProfile = freshProfile.psychProfile ?? '';
		ppContentAngle = freshProfile.contentAngle ?? '';
		ppTargetAvatar = stripLeadingAvatarName(freshProfile.targetAvatar);
		ppAppearance = { ...(freshProfile.appearance ?? {}) };
		ppVoiceProfile = { ...(freshProfile.voiceProfile ?? {}) };
		ppBios = { ...(freshProfile.bios ?? {}) };
		ppHandleCandidates = coerceHandleCandidates(freshProfile.handleCandidates);
		ppConfirmedHandles = { ...(freshProfile.confirmedHandles ?? {}) };
		ppDisplayName = freshProfile.displayName ?? '';
		newHandleInput = '';

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
		feedLoaded = false;
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
		// generateAllKitStages bails (without its finally-reset) the moment the
		// agent id changes, so the flag must be cleared HERE or every kit button
		// stays disabled forever after switching personas mid-"Generate all".
		generatingAllKit = false;

		// Any open modal was staged against the PREVIOUS persona. Left open, its
		// confirm action (approved prompt, restored history image) would apply
		// persona A's payload to persona B — including via browser Back/Forward.
		composerOpen = false;
		composerSpec = null;
		onComposerConfirm = () => {};
		restoreOpen = false;
		kitRestoreStage = null;
		kitRestoreImages = [];
		kitRestoreAll = []; // cached library is per-persona — must not carry over
		kitRestoreMode = 'stage';
	});

	// ── Tab init effects ───────────────────────────────────────────
	$effect(() => {
		// Every Content lens (posts / assets / calendar) derives from the same posts
		// data — and Studio reads it too, for template preview thumbnails.
		if ((activeTab === 'content' || activeTab === 'studio') && agent?.id) loadFeed();
	});

	$effect(() => {
		if (activeTab === 'profile' && profileView === 'connections' && agent?.id) checkStatuses();
	});

	$effect(() => {
		if (activeTab === 'profile' && profileView === 'overview') loadVoiceCatalog();
	});

	// ── UGC voice picker ───────────────────────────────────────────
	let voiceCatalog = $state<
		Array<{
			name: string;
			label: string;
			gender: 'male' | 'female';
			style: string;
			accent?: string;
		}>
	>([]);
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
				feedLoaded = true;
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
	// Confirmed before it runs — this spends one generation PER empty slot, so it must
	// follow the same confirm-before-spend rule as every other generate action.
	let fillingDrafts = $state(false);
	let confirmDraftsOpen = $state(false);
	async function fillDraftsNow() {
		if (!agent?.id || fillingDrafts) return;
		confirmDraftsOpen = false;
		fillingDrafts = true;
		// `agent` is live state — capture the id so a persona switch mid-poll can't
		// make loadFeed() below poll (and toast about) the WRONG persona's feed.
		const requestAgentId = agent.id;
		const jobId = kitJobId(requestAgentId, 'drafts');
		// Set when we stop watching without the job being over (navigation/persona
		// switch): the server run continues, so the store entry must survive too.
		let abandoned = false;
		try {
			const res = await Autopilot.generateNow(requestAgentId);
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
				agentId: requestAgentId,
				label: 'Autopilot drafts'
			});
			showToast('Generating drafts — they appear in the feed as each one finishes', 'info');

			const deadline = Date.now() + 6 * 60 * 1000;
			let sawAny = false;
			while (Date.now() < deadline) {
				await sleep(5000);
				if (agent?.id !== requestAgentId || pageDestroyed) {
					abandoned = true;
					break;
				}
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
			if (!abandoned) finishGeneration(jobId);
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

	// ── Hydration gate for the Studio action chrome ─────────────────
	// This page's SSR paints the Studio controls (Output toggle, template Use
	// buttons, Plan a campaign) seconds before the — large — client bundle
	// hydrates and attaches their handlers. In that window a click is silently
	// eaten: the toggle looks live, does nothing, and reads as broken (verified
	// with a real browser — early clicks on "Review draft"/"Use" vanish; the
	// same clicks work after hydration). Render them disabled until the page
	// can actually respond, so a too-early click shows a disabled control
	// instead of lying.
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	// ── Hero scroll-fade ────────────────────────────────────────────
	// The identity hero sits directly above the sticky tab-nav. As the user
	// scrolls into a long tab, fade + lift the hero out so the sticky nav docks
	// cleanly at the top instead of the hero smearing behind its backdrop blur.
	let heroEl = $state<HTMLElement | null>(null);
	let scrollParent: HTMLElement | null = null;
	let heroFade = $state(0); // 0 = fully visible, 1 = fully hidden
	function updateHeroFade() {
		if (!scrollParent || !heroEl) return;
		// Fully faded a touch before the hero fully scrolls away, so the handoff
		// to the sticky nav feels intentional rather than abruptly clipped.
		const fadeOver = Math.max(1, heroEl.offsetHeight * 0.8);
		heroFade = Math.min(1, Math.max(0, scrollParent.scrollTop / fadeOver));
	}

	onMount(() => {
		// The persona page scrolls inside the portal content column, not the window.
		scrollParent = heroEl?.closest('.portal-content') ?? null;
		if (scrollParent) {
			scrollParent.addEventListener('scroll', updateHeroFade, { passive: true });
			updateHeroFade();
		}

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

	/**
	 * Post generation always confirms now. The server resolves the real pipeline
	 * (Director model, image/video models, product + character refs, per-step cost)
	 * and the user approves or edits it before anything is spent — so the old
	 * "skip the composer" shortcut is gone deliberately: it existed to skip a form
	 * that was only a guess, and this one isn't.
	 */
	// ── Studio: template gallery → prefilled composer ──────────────────────
	// A template is nothing but a baseBody for the same generate-post endpoint;
	// the composer's preview echoes topic/scene back as editable fields and
	// resolves real prompt/models/cost server-side. Same approval, same budget
	// tracking, same draft output as every other generate action.
	// Browse axis is the SURFACE (what the output looks like), not the old genre
	// category — "what's the difference between text, image and video?" is the
	// question the grid must answer structurally. Intent (brand vs channel) is a
	// section split rather than a filter so the 20/80 shape of a healthy account
	// is visible every time the tab opens.
	let studioSurface = $state<StudioSurface | 'all'>('all');
	let studioTemplates = $derived(
		studioSurface === 'all'
			? STUDIO_TEMPLATES
			: STUDIO_TEMPLATES.filter((t) => t.surface === studioSurface)
	);
	/** Shelves for one intent: [surfaceDef, templates[]] pairs, empty shelves dropped. */
	function studioShelves(intent: StudioIntent) {
		return STUDIO_SURFACES.map(
			(s) => [s, studioTemplates.filter((t) => t.intent === intent && t.surface === s.id)] as const
		).filter(([, list]) => list.length > 0);
	}
	// Where Studio output goes. 'review' → draft in the review queue (default);
	// 'asset' → standalone media that skips the queue and lives in Assets.
	// Both pin a DRAFT server-side — Studio never publishes directly.
	let studioDeliver = $state<'review' | 'asset'>('review');
	// Real generations as template previews: any post tagged with a template id
	// becomes that card's thumbnail — the honest version of stock example clips.
	let studioPreviews = $derived.by(() => {
		const byTemplate = new Map<string, { url: string; type: 'image' | 'video' }>();
		for (const r of feedPosts) {
			try {
				const c = JSON.parse(r.content);
				const id = c?.studio?.template;
				const url = c?.poster_url || c?.media_url;
				if (id && url && !byTemplate.has(id)) {
					byTemplate.set(id, { url, type: c?.media_type === 'video' ? 'video' : 'image' });
				}
			} catch {
				/* non-JSON content rows have no studio tag */
			}
		}
		return byTemplate;
	});
	// Rotating placeholder pool: one entry from [sample, ...samples] picked per
	// template PER PAGE VIEW — the shelf reads fresh on every visit instead of
	// repeating the same 37 lines forever. Map-cached so the pick is stable
	// within a view (tiles don't reshuffle on every rerender).
	const studioSamplePick = new Map<string, { idx: number; text: string }>();
	function studioSample(t: StudioTemplate): { idx: number; text: string } {
		let pick = studioSamplePick.get(t.id);
		if (!pick) {
			const pool = [t.sample, ...(t.samples ?? [])];
			const idx = Math.floor(Math.random() * pool.length);
			pick = { idx, text: pool[idx] };
			studioSamplePick.set(t.id, pick);
		}
		return pick;
	}
	// Typographic tiles show a card ACTUALLY produced by the $0 renderer (via
	// /api/studio/card-sample) — the placeholder IS the expected output. A host
	// that can't render (no ffmpeg/font) 404s → tile falls back to the styled
	// text sample. Reassigned, not mutated, so the fallback is reactive.
	let studioCardUnavailable = $state<ReadonlySet<string>>(new Set());
	function markStudioCardUnavailable(id: string) {
		studioCardUnavailable = new Set([...studioCardUnavailable, id]);
	}
	function useStudioTemplate(t: StudioTemplate) {
		if (!agent?.id) return;
		askToGenerate(
			{
				endpoint: `/api/agent/${agent.id}/generate-post`,
				baseBody: { ...t.baseBody, studio_template: t.id, deliver: studioDeliver },
				title: `${t.title} — ${agent.name}`,
				subtitle:
					studioDeliver === 'asset'
						? 'Template scaffold filled in below. Edit anything before approving. Output is saved as a standalone asset — it will not enter the review queue.'
						: 'Template scaffold filled in below. Edit anything — topic, scene, product, schedule — before approving. Output lands as a draft in the review queue.',
				confirmLabel: 'Approve & generate'
			},
			(body) => generatePostNow(body)
		);
	}

	function requestGeneratePost(dateStr?: string | null) {
		if (!agent?.id) return;
		// Toolbar buttons pass a MouseEvent; only the Calendar tab passes a date,
		// which prefills the composer's schedule for that day.
		const scheduledDate = typeof dateStr === 'string' ? dateStr : null;
		askToGenerate(
			{
				endpoint: `/api/agent/${agent.id}/generate-post`,
				...(scheduledDate ? { baseBody: { scheduled_date: scheduledDate } } : {}),
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
	// Apply just the brand-kit choice. Persists through the normal profile save
	// (so any other in-progress edits go with it) and confirms precisely with the
	// brand's name — or that the persona now runs with NO brand brief.
	async function applyBrandKit() {
		if (savingBrand || !brandDirty) return;
		savingBrand = true;
		const chosen = brandBriefs.find((b) => b.id === selectedBrandBriefId);
		const msg = selectedBrandBriefId
			? `Brand brief applied — this persona now creates for “${chosen?.name ?? 'the selected brand'}”.`
			: 'Brand brief cleared — this persona now generates with no brand context.';
		try {
			await saveProfile(msg);
		} finally {
			savingBrand = false;
		}
	}

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
				// Voice: record the inferred profile (nationality/accent from the name)
				// and pin the closest catalog voice. Explicit gender stays authoritative;
				// it's only filled here when it was blank (inferred from the name).
				if (d.voiceProfile && typeof d.voiceProfile === 'object')
					ppVoiceProfile = { ...d.voiceProfile };
				// Adopt the resolved (name-driven) gender — corrects a mis-set gender in place so
				// the generated face, voice, and reference-kit prompts all realign to the real
				// identity (fixes "Ratio Ramadan was Female → woman's-face regen + female voice").
				if (d.gender === 'male' || d.gender === 'female') ppGender = d.gender;
				if (d.voice) selectedVoice = d.voice;
				if (d.voiceMatch === 'fallback' && d.voiceProfile?.accent) {
					showToast(
						`No ${d.voiceProfile.accent} accent in the voice catalog yet — pinned the closest match. Add one via UGC_EXTRA_VOICES to upgrade.`,
						'warning'
					);
				}
				// Identity kit rides the same button, generated AFTER the profile so
				// its prompt sees the fresh niche/angle. Non-fatal: a kit failure
				// still saves the profile (the kit has its own regenerate button).
				try {
					const kit = await BrandBrief.generateIdentityKit(agent.id, selectedBrandBriefId || null);
					if (kit.success && kit.data) applyIdentityKit(kit.data);
				} catch {
					/* profile save below still proceeds */
				}
				// Persist immediately. Generation used to only FILL the form and rely on a
				// separate manual Save — so leaving the page lost everything and the user
				// had to re-generate on every visit. Auto-saving makes it durable.
				await saveProfile('Persona profile generated and saved');
			} else {
				showToast(res.error || 'Generation failed', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Generation failed', 'error');
		} finally {
			generatingProfile = false;
		}
	}

	// ── Platform Identity Kit actions ──────────────────────────────────────
	/**
	 * Merges a generated kit into the form state. Bios overwrite per platform
	 * (regenerate means refresh); handle candidates MERGE so the user's manual
	 * taken/confirmed marks survive a re-roll.
	 */
	function applyIdentityKit(d: {
		displayName?: string;
		handleCandidates?: HandleCandidate[];
		bios?: Record<string, string>;
	}) {
		if (d.displayName) ppDisplayName = d.displayName;
		if (Array.isArray(d.handleCandidates) && d.handleCandidates.length) {
			ppHandleCandidates = mergeHandleCandidates(ppHandleCandidates, d.handleCandidates);
		}
		if (d.bios && typeof d.bios === 'object') ppBios = { ...ppBios, ...d.bios };
	}

	// ── Kit auto-save ───────────────────────────────────────────────────────
	// Per-platform identity work must NEVER be lost by switching platform, tab,
	// or persona without hitting Save — so kit edits persist on their own,
	// debounced. Scoped to the personaProfile payload (the market JSON, which is
	// stored wholesale); agents-table fields still go through the Save button.
	let kitSaveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let kitSaveTimer: ReturnType<typeof setTimeout> | null = null;

	async function saveIdentityKit(forAgentId?: string): Promise<boolean> {
		const id = forAgentId ?? agent?.id;
		if (!id) return false;
		kitSaveState = 'saving';
		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				// keepalive lets a save fired during pagehide/unload finish instead of
				// being aborted with the document. The payload is well under the 64KB
				// keepalive ceiling.
				keepalive: true,
				body: JSON.stringify({ agentId: id, personaProfile: currentPersonaProfile() })
			});
			const d = await parseJsonResponse<any>(res);
			if (!d.success) throw new Error(d.error || 'Save failed');
			kitSaveState = 'saved';
			return true;
		} catch (e: any) {
			kitSaveState = 'error';
			showToast('Identity kit save failed: ' + (e.message || 'unknown'), 'error');
			return false;
		}
	}

	function queueKitSave() {
		if (kitSaveTimer) clearTimeout(kitSaveTimer);
		kitSaveState = 'saving';
		kitSaveTimer = setTimeout(() => {
			kitSaveTimer = null;
			void saveIdentityKit();
		}, 1200);
	}

	// Fires a pending debounced save NOW (payload built synchronously from the
	// current state) — called before persona resync re-seeds the form and on
	// page destroy, so the last keystrokes always land.
	function flushPendingKitSave(forAgentId?: string) {
		if (!kitSaveTimer) return;
		clearTimeout(kitSaveTimer);
		kitSaveTimer = null;
		void saveIdentityKit(forAgentId);
	}

	// The debounce is 1200ms, so any exit inside that window used to drop the last
	// edits silently — a reload mid-debounce aborted the in-flight POST outright.
	// Every way out of this page now flushes first:
	//   beforeNavigate  → SvelteKit client navigation (tab, persona, sidebar link)
	//   pagehide        → reload, back/forward, tab close, external navigation
	//   visibilitychange→ mobile backgrounding, which may never fire pagehide
	beforeNavigate(() => flushPendingKitSave());
	onMount(() => {
		const flush = () => flushPendingKitSave();
		const onHidden = () => {
			if (document.visibilityState === 'hidden') flushPendingKitSave();
		};
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', onHidden);
		return () => {
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', onHidden);
		};
	});

	// ── Kit generation — LEAN, scoped calls ─────────────────────────────────
	// 'bio'     → ONLY the selected platform's bio (seconds-fast; the all-13
	//             single call overflowed token caps and hit the LLM deadline).
	// 'base'    → display name + username candidates only.
	// 'starter' → base + bios for connected platforms (server-resolved) or a
	//             starter trio. Used by first-run CTAs and the brand chain.
	let generatingKit = $state(false);
	let generatingKitBase = $state(false);
	let generatingKitBio = $state(false);
	let kitBusy = $derived(generatingKit || generatingKitBase || generatingKitBio);

	async function generateKit(scope: 'starter' | 'base' | 'bio') {
		if (!agent?.id || kitBusy) return;
		const opts =
			scope === 'base'
				? { platforms: [] as string[], includeBase: true }
				: scope === 'bio'
					? // First bio ever also brings the base along so one click fills the card.
						{ platforms: [kitPlatform], includeBase: ppHandleCandidates.length === 0 }
					: undefined;
		if (scope === 'starter') generatingKit = true;
		else if (scope === 'base') generatingKitBase = true;
		else generatingKitBio = true;
		try {
			const res = await BrandBrief.generateIdentityKit(
				agent.id,
				selectedBrandBriefId || null,
				opts
			);
			if (res.success && res.data) {
				applyIdentityKit(res.data);
				await saveIdentityKit();
				showToast(
					scope === 'bio'
						? `${platformLabel(kitPlatform)} bio generated and saved`
						: scope === 'base'
							? 'Username ideas generated and saved'
							: 'Starter identity kit generated and saved',
					'success'
				);
			} else {
				showToast(res.error || 'Identity kit generation failed', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Identity kit generation failed', 'error');
		} finally {
			generatingKit = false;
			generatingKitBase = false;
			generatingKitBio = false;
		}
	}

	// Manual availability loop: ✗ marks a candidate as taken on the platforms the
	// user tried (toggles back to untried), "Use" confirms it as the handle for
	// the currently selected platform. Every mutation queues the auto-save.
	function toggleCandidateTaken(handle: string) {
		ppHandleCandidates = ppHandleCandidates.map((c) =>
			c.handle === handle ? { ...c, status: c.status === 'taken' ? 'untried' : 'taken' } : c
		);
		queueKitSave();
	}

	function useCandidateFor(handle: string, platform: string) {
		ppConfirmedHandles = { ...ppConfirmedHandles, [platform]: handle };
		ppHandleCandidates = ppHandleCandidates.map((c) =>
			c.handle === handle ? { ...c, status: 'confirmed' } : c
		);
		queueKitSave();
	}

	// Sanitizes live and prunes the key when cleared, so saved JSON never
	// carries empty/illegal confirmed handles.
	function setConfirmedHandle(platform: string, raw: string) {
		const h = sanitizeHandle(raw);
		const next = { ...ppConfirmedHandles };
		if (h) next[platform] = h;
		else delete next[platform];
		ppConfirmedHandles = next;
		queueKitSave();
	}

	function addOwnHandle() {
		const h = sanitizeHandle(newHandleInput);
		if (!h) {
			showToast(
				'Usernames: lowercase letters, digits, underscores (periods where allowed)',
				'warning'
			);
			return;
		}
		if (!ppHandleCandidates.some((c) => c.handle === h)) {
			ppHandleCandidates = [...ppHandleCandidates, { handle: h, status: 'untried' }];
			queueKitSave();
		}
		newHandleInput = '';
	}

	/**
	 * Drops a username candidate. Previously the list was append-only — a bad
	 * suggestion could only be marked "taken", never removed. A candidate that is
	 * already confirmed on a platform is kept in confirmedHandles; only the
	 * suggestion row goes away.
	 */
	function removeHandleCandidate(handle: string) {
		ppHandleCandidates = ppHandleCandidates.filter((c) => c.handle !== handle);
		queueKitSave();
	}

	async function copyKitText(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			showToast(`${label} copied`, 'success');
		} catch {
			showToast('Copy failed — select the text and copy manually', 'error');
		}
	}

	// Profile picture for manual upload during platform signup. fetch→blob keeps
	// the download working cross-origin (a bare <a download> is ignored there);
	// if the host blocks CORS reads, fall back to opening the image to save-as.
	async function downloadAvatar() {
		if (!characterRef) return;
		try {
			const res = await fetch(characterRef);
			if (!res.ok) throw new Error(String(res.status));
			const blob = await res.blob();
			const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
			const base = (editHandle || editName || 'persona')
				.replace(/[^a-z0-9_-]+/gi, '-')
				.toLowerCase();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${base}-profile-picture.${ext}`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch {
			window.open(characterRef, '_blank');
			showToast('Opened the image in a new tab — right-click to save it', 'info');
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
				await saveProfile('Appearance read from photo and saved');
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
	interface SkillItem {
		id: string;
		name: string;
		md: string;
	}
	interface ToolItem {
		id: string;
		kind: string;
		label: string;
		config: string;
	}
	function parseSkills(raw: string): SkillItem[] {
		try {
			const j = JSON.parse(raw);
			if (Array.isArray(j)) return j.filter((s) => s && s.name);
		} catch {
			/* legacy plain text */
		}
		return raw.trim() ? [{ id: 'legacy', name: 'Legacy notes', md: raw }] : [];
	}
	function parseTools(raw: string): ToolItem[] {
		try {
			const j = JSON.parse(raw);
			if (Array.isArray(j)) return j.filter((t) => t && t.label);
		} catch {
			/* legacy plain text */
		}
		return raw.trim() ? [{ id: 'legacy', kind: 'other', label: 'Legacy notes', config: raw }] : [];
	}
	let skillsList = $state<SkillItem[]>(parseSkills(agent?.skills ?? ''));
	let toolsList = $state<ToolItem[]>(parseTools(agent?.tools ?? ''));
	let editingSkill = $state<SkillItem | null>(null);
	let editingTool = $state<ToolItem | null>(null);
	const TOOL_KINDS = ['posting', 'analytics', 'mcp', 'api', 'automation', 'other'];

	function saveSkill() {
		if (!editingSkill) return;
		if (!editingSkill.name.trim()) {
			showToast('Skill needs a name', 'warning');
			return;
		}
		const i = skillsList.findIndex((s) => s.id === editingSkill!.id);
		skillsList =
			i >= 0
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
		if (!editingTool.label.trim()) {
			showToast('Integration needs a label', 'warning');
			return;
		}
		const i = toolsList.findIndex((t) => t.id === editingTool!.id);
		toolsList =
			i >= 0
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

	/**
	 * What actually happened to the row, in the words of the row itself.
	 *
	 * This used to toast "Post generated!" whenever the status was anything but
	 * 'published' — which is exactly the case where generate-post held the post
	 * as a draft because this persona is not fully autonomous. Nothing told the
	 * user it was waiting for them, so nothing sent them to /review to find it.
	 */
	function postOutcomeMessage(status: string | null | undefined): string {
		if (status === 'published') return 'Post generated and published!';
		if (status === 'scheduled') return 'Post generated and scheduled.';
		return 'Post generated — held as a draft in the review queue. Approve it there to publish.';
	}

	async function generatePostNow(approved: Record<string, unknown> = {}) {
		// Re-entrancy guard — same rule as generateAvatar(): a second approve while
		// the first is polling would double-spend.
		if (!agent?.id || generatingPost) return;
		generatingPost = true;
		try {
			// The composer already resolved and confirmed the full payload with the
			// server, so send exactly what the user approved — no client-side
			// re-derivation that could disagree with what they saw.
			const body: Record<string, unknown> = { ...approved };

			// "My own words": a batch of typeset cards. Its own endpoint, because it
			// never calls a model — one row per quote, rendered on our servers, $0.
			const ownWords = Array.isArray(body.card_texts) && body.card_texts.length > 0;
			const res = await fetch(
				ownWords ? `/api/agent/${agent.id}/cards` : `/api/agent/${agent.id}/generate-post`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				}
			);
			const result = await parseJsonResponse<any>(res);
			if (!res.ok || !result.success) {
				showToast(result?.error || 'Failed to generate post', 'error');
				return;
			}
			if (ownWords) {
				const requestAgentId = agent.id;
				const ids: string[] = Array.isArray(result.post_ids) ? result.post_ids : [];
				const skipped: Array<{ text: string; reason: string }> = Array.isArray(result.skipped)
					? result.skipped
					: [];
				if (skipped.length)
					showToast(
						`${skipped.length} ${skipped.length === 1 ? 'quote' : 'quotes'} skipped — ${skipped[0].reason}`,
						'warning'
					);
				if (ids.length === 0) return;
				showToast(
					`Creating ${ids.length} ${ids.length === 1 ? 'card' : 'cards'} — they appear in the feed as each one finishes`,
					'info'
				);
				// The rows already exist as 'generating'; watch them land rather than
				// polling a hundred ids one by one.
				const deadline = Date.now() + 10 * 60_000;
				while (Date.now() < deadline) {
					await sleep(4000);
					if (pageDestroyed || agent?.id !== requestAgentId) return;
					await loadFeed();
					if (!feedPosts.some((p: any) => ids.includes(p.id) && p.status === 'generating')) break;
				}
				const failed = feedPosts.filter((p: any) => ids.includes(p.id) && p.status === 'failed').length;
				showToast(
					failed
						? `${ids.length - failed} of ${ids.length} cards ready — ${failed} failed (the reason is on each post)`
						: `${ids.length} ${ids.length === 1 ? 'card is' : 'cards are'} ready in the review queue`,
					failed ? 'warning' : 'success'
				);
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
					showToast(postOutcomeMessage(status), 'success');
					await loadFeed();
					return;
				}
				showToast(
					'Still generating after 10 minutes — it may finish in the background. Check the feed shortly.',
					'warning'
				);
			} else {
				// Legacy synchronous completion (pre-migration fallback). The response
				// says which of the three endings happened — read it rather than
				// assuming the happy one.
				showToast(
					postOutcomeMessage(
						result?.draft ? 'draft' : result?.published ? 'published' : 'scheduled'
					),
					'success'
				);
				await loadFeed();
			}
		} catch (err) {
			showToast('Error: ' + (err as Error).message, 'error');
		} finally {
			generatingPost = false;
			// The wallet may have moved; the pill is loaded by the layout and would
			// otherwise keep showing the pre-generation number until a navigation.
			void refreshCredits();
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
				feedPosts = feedPosts.map((p: any) =>
					p.id === post.id ? { ...p, content: serialized } : p
				);
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
		// This is the per-card trash can (and the drawer's delete). It used to fire
		// straight into Posts.delete with no prompt and no undo — one stray click
		// on a scrolling feed and the post was gone for good.
		if (!(await confirmDeletePosts([post]))) return;
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
					showToast(
						`Removed from ${teardown.unpublished.join(', ')} and moved to Trash`,
						'success'
					);
				} else {
					showToast('Moved to Trash — restorable for 30 days', 'success');
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

	// ── Post manageability: multi-select + bulk delete + media enlarge ───────
	let selectedPostIds = $state<string[]>([]);
	let bulkDeletingPosts = $state(false);
	let postMediaLightbox = $state<{ url: string; label: string; poster: string | null } | null>(
		null
	);

	function togglePostSelected(id: string) {
		selectedPostIds = selectedPostIds.includes(id)
			? selectedPostIds.filter((p) => p !== id)
			: [...selectedPostIds, id];
	}
	function selectAllPosts() {
		selectedPostIds = groupedPosts.map((p: any) => p.id);
	}
	function clearPostSelection() {
		selectedPostIds = [];
	}

	/** Opens a post's media full-size. Videos play in the lightbox. */
	function openPostMedia(post: any) {
		try {
			const c = typeof post.content === 'string' ? JSON.parse(post.content) : post.content;
			const url = c?.media_url || c?.mediaUrl;
			if (!url) {
				showToast('This post has no media yet', 'info');
				return;
			}
			postMediaLightbox = {
				url,
				label: c?.topic || c?.caption?.slice(0, 80) || 'Post media',
				poster: c?.poster_url || null
			};
		} catch {
			showToast('This post has no media yet', 'info');
		}
	}

	async function deleteSelectedPosts() {
		const ids = [...selectedPostIds];
		if (ids.length === 0 || bulkDeletingPosts) return;
		const targets = feedPosts.filter((p: any) => ids.includes(p.id));
		if (!(await confirmDeletePosts(targets.length ? targets : ids.map((id) => ({ id }))))) return;
		bulkDeletingPosts = true;
		try {
			const res = await Posts.deleteMany(ids);
			if (!res.success) {
				showToast(res.error || 'Failed to delete posts', 'error');
				return;
			}
			feedPosts = feedPosts.filter((p: any) => !ids.includes(p.id));
			if (modalPost && ids.includes(modalPost.id)) modalPost = null;
			selectedPostIds = [];
			if (res.teardown?.manualDeletion?.length)
				manualDeleteNotice = res.teardown.manualDeletion as any;
			const deleted = res.deleted ?? ids.length;
			showToast(
				deleted < ids.length
					? `Moved ${deleted} of ${ids.length} to Trash — the rest could not be found`
					: `Moved ${countLabel(deleted, 'post')} to Trash — restorable for 30 days`,
				deleted < ids.length ? 'warning' : 'success'
			);
		} catch (err) {
			showToast('Error deleting posts: ' + (err as Error).message, 'error');
		} finally {
			bulkDeletingPosts = false;
		}
	}

	async function handleApprovePost(post: any) {
		if (!post?.id) return;
		approvingPostId = post.id;
		try {
			const res = await Posts.update(post.id, { status: 'scheduled' });
			if (res.success) {
				feedPosts = feedPosts.map((p: any) =>
					p.id === post.id ? { ...p, status: 'scheduled' } : p
				);
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

	// ── Favorites (persona heart + per-post hearts) ────────────────────────
	let togglingAgentFavorite = $state(false);

	async function toggleAgentFavorite() {
		if (!agent?.id || togglingAgentFavorite) return;
		togglingAgentFavorite = true;
		const next = !agent.is_favorite;
		agent = { ...agent, is_favorite: next };
		try {
			const res = await fetch(`/api/agent/${agent.id}/favorite`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: next })
			});
			const d = await parseJsonResponse<any>(res);
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			// Sidebar and My Favorites read this flag from the server roster.
			void invalidateAll();
		} catch (err) {
			agent = { ...agent, is_favorite: !next };
			showToast('Could not update favorite: ' + (err as Error).message, 'error');
		} finally {
			togglingAgentFavorite = false;
		}
	}

	async function togglePostFavorite(post: any) {
		const next = !post.is_favorite;
		feedPosts = feedPosts.map((p: any) => (p.id === post.id ? { ...p, is_favorite: next } : p));
		if (modalPost?.id === post.id) modalPost = { ...modalPost, is_favorite: next };
		const res = await Posts.favorite(post.id, next);
		if (!res.success) {
			feedPosts = feedPosts.map((p: any) => (p.id === post.id ? { ...p, is_favorite: !next } : p));
			if (modalPost?.id === post.id) modalPost = { ...modalPost, is_favorite: !next };
			showToast(res.error || 'Could not update favorite', 'error');
		}
	}

	let mediaTypeFilter = $state<'all' | 'video' | 'image'>('all');

	let filteredPosts = $derived(
		feedPosts.filter((p: any) => {
			// In-flight and failed generations have no media YET, but they are exactly
			// what the user wants to see after clicking Generate — the old blanket
			// "no media => hide" rule silently swallowed them, so the feed looked
			// unchanged until the job finished. PostCard renders these as a progress
			// (or failure) card instead.
			const inFlight = p.status === 'generating' || p.status === 'failed';
			const display = getPostDisplay(p);
			if (!inFlight && !display.mediaUrl) return false;
			// A failed row with NO media is a dead generation — pure noise in the
			// default feed. Keep it out of every view except an explicit "Failed"
			// filter, where the user is deliberately triaging errors. (Publish-fails
			// keep their media, so they stay visible as real, recoverable content.)
			const isGenFailed = p.status === 'failed' && !display.mediaUrl;
			if (isGenFailed && feedFilter !== 'failed') return false;
			if (feedFilter !== 'all' && p.status !== feedFilter) return false;
			// The media-type filter can't apply to a post whose media doesn't exist yet.
			if (inFlight) return true;
			if (mediaTypeFilter !== 'all') {
				const isVideo =
					display.mediaType === 'video' ||
					/\.(mp4|mov|webm|m4v)(\?|$)/i.test(display.mediaUrl ?? '');
				if (mediaTypeFilter === 'video' ? !isVideo : isVideo) return false;
			}
			if (platformFilter !== 'all') {
				const plats = (p.platforms ?? []).map((x: string) => x.toLowerCase());
				if (!plats.includes(platformFilter)) return false;
			}
			return true;
		})
	);

	// Media type of a post for grouping/congruence. In-flight + failed rows have
	// no media yet, so they're 'pending' and float to the top of the mosaic.
	function postMediaType(p: any): 'pending' | 'image' | 'video' {
		if (p.status === 'generating' || p.status === 'failed') return 'pending';
		const d = getPostDisplay(p);
		if (!d.mediaUrl) return 'pending';
		const isVideo = d.mediaType === 'video' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(d.mediaUrl ?? '');
		return isVideo ? 'video' : 'image';
	}

	// The mosaic renders this: same set as filteredPosts, but grouped by media
	// type (pending → images → videos) so the grid reads as congruent bands
	// instead of interleaving short image tiles with tall video tiles. Array.sort
	// is stable, so date order is preserved WITHIN each group.
	let groupedPosts = $derived.by(() => {
		const rank = { pending: 0, image: 1, video: 2 } as const;
		return [...filteredPosts].sort((a, b) => rank[postMediaType(a)] - rank[postMediaType(b)]);
	});

	// Dead generations hidden from the default view — surfaced only as a count so
	// the user knows they exist and can jump to them via the Failed filter.
	let genFailedCount = $derived(
		feedPosts.filter((p: any) => p.status === 'failed' && !getPostDisplay(p).mediaUrl).length
	);

	// ── Assets: every generated visual for this persona in one grid ──
	// Lives inside the Feed tab as an alternate view (feedView toggle) — same
	// posts data, different lens.
	interface AssetItem {
		url: string;
		type: 'image' | 'video';
		label: string;
		/** Poster still for video assets — without it a video tile renders blank. */
		poster?: string | null;
		/**
		 * Where this asset lives, so "delete" can do the right thing: a post asset
		 * means deleting that post, a kit asset unpins it from the reference kit,
		 * and the avatar is cleared back to the gradient fallback.
		 */
		source: 'post' | 'kit' | 'avatar';
		postId?: string | null;
		stage?: string | null;
	}
	// ── Calendar tab: this persona's posts in the shared calendar shape ──
	let calendarPosts = $derived(
		feedPosts
			.map((r: any) => ({
				id: r.id,
				agentId: r.agent_id ?? agent?.id ?? '',
				agentName: agent?.name ?? 'Persona',
				text: r.content,
				platforms: r.platforms ?? [],
				// Place by schedule; posts published without one fall back to their
				// publish/creation date so nothing vanishes from the calendar.
				date: r.scheduled_date || String(r.published_at || r.created_at || '').slice(0, 10),
				time: r.scheduled_time ? String(r.scheduled_time).slice(0, 5) : '10:00',
				status: r.status,
				publication_results: r.publication_results ?? null,
				analytics: r.analytics ?? null
			}))
			// In-flight generations have no meaningful slot yet — the feed shows them.
			.filter((p: any) => !!p.date && p.status !== 'generating')
	);

	/** Calendar events → the ORIGINAL feed row, which the drawer/mutations expect. */
	function feedRowFor(p: { id: string }) {
		return feedPosts.find((r: any) => r.id === p.id) ?? null;
	}

	let assetItems = $derived.by(() => {
		const seen = new Set<string>();
		const items: AssetItem[] = [];
		const add = (
			url: string | null | undefined,
			type: 'image' | 'video',
			label: string,
			poster: string | null,
			source: AssetItem['source'],
			extra: { postId?: string | null; stage?: string | null } = {}
		) => {
			if (!url || typeof url !== 'string' || seen.has(url)) return;
			seen.add(url);
			items.push({
				url,
				type,
				label,
				poster: poster ?? null,
				source,
				postId: extra.postId ?? null,
				stage: extra.stage ?? null
			});
		};
		for (const p of feedPosts) {
			try {
				const c = JSON.parse(p.content);
				const isVideo = c.media_type === 'video';
				add(
					c.media_url || c.mediaUrl,
					isVideo ? 'video' : 'image',
					// "Asset only" Studio output IS the promised destination of that
					// toggle — name it so the grid shows the toggle actually worked.
					c.studio?.standalone === true ? 'Studio asset' : 'Post media',
					isVideo ? c.poster_url : null,
					'post',
					{ postId: p.id }
				);
				add(c.poster_url, 'image', 'Poster still', null, 'post', { postId: p.id });
				if (Array.isArray(c.storyboard)) {
					for (const s of c.storyboard)
						add(s, 'image', 'Storyboard still', null, 'post', { postId: p.id });
				}
			} catch {
				/* non-JSON content has no assets */
			}
		}
		add(characterRef, 'image', 'Profile picture', null, 'avatar');
		for (const [k, v] of Object.entries(referenceKit ?? {})) {
			// The kit doubles as the async-job board: alongside the stage URLs it
			// carries `<stage>_status` markers ('generating' / 'failed: …'),
			// `<stage>_history` pools, `<key>_started_at` ISO timestamps and a
			// numeric `rev` counter — none of which are images.
			if (
				k === 'rev' ||
				k.endsWith('_status') ||
				k.endsWith('_history') ||
				k.endsWith('_started_at')
			)
				continue;
			// Belt-and-braces for bookkeeping keys that don't exist yet: only a
			// URL-shaped string can be a tile; anything else renders as a broken <img>.
			if (typeof v !== 'string' || !/^https?:\/\//.test(v)) continue;
			add(v, 'image', `Reference kit — ${k.replace(/_/g, ' ')}`, null, 'kit', {
				stage: k
			});
		}
		return items;
	});

	// ── Asset manageability: multi-select + delete ───────────────────────────
	let selectedAssetUrls = $state<string[]>([]);
	let deletingAssets = $state(false);

	function toggleAssetSelected(url: string) {
		selectedAssetUrls = selectedAssetUrls.includes(url)
			? selectedAssetUrls.filter((u) => u !== url)
			: [...selectedAssetUrls, url];
	}
	function selectAllAssets() {
		selectedAssetUrls = assetItems.map((a) => a.url);
	}
	function clearAssetSelection() {
		selectedAssetUrls = [];
	}

	/**
	 * Deletes any mix of assets. Post media can't be removed without its post, so
	 * that is spelled out in the confirmation rather than done silently. Kit
	 * images are unpinned (and dropped from that stage's history); the bucket
	 * object survives so a published post never loses its media.
	 */
	async function deleteAssets(items: AssetItem[]) {
		if (items.length === 0 || deletingAssets) return;
		const postIds = [
			...new Set(
				items.filter((i) => i.source === 'post' && i.postId).map((i) => i.postId as string)
			)
		];
		const kitItems = items.filter((i) => i.source === 'kit');
		const avatarItems = items.filter((i) => i.source === 'avatar');

		const lines: string[] = [];
		if (postIds.length)
			lines.push(`${countLabel(postIds.length, 'post')} (trashed along with the media)`);
		if (kitItems.length)
			lines.push(
				`${countLabel(kitItems.length, 'reference photo')} (unpinned from the kit; still restorable from your library)`
			);
		if (avatarItems.length) lines.push('the profile picture (cleared back to the gradient)');
		const hasPosts = postIds.length > 0;
		const ok = await confirmAction({
			title: `Delete ${countLabel(items.length, 'asset')}?`,
			body: lines.join(' · '),
			warning: hasPosts
				? `${countLabel(postIds.length, 'post')} ${plural(postIds.length, 'goes', 'go')} to Trash with their media — restorable for 30 days. Reference photos and the avatar are unpinned immediately.`
				: 'Reference photos are unpinned from the kit; the underlying file is kept so no published post loses its media.',
			preview: items.slice(0, 4).map((i) => ({
				image: i.url,
				label:
					i.source === 'post'
						? 'Post media'
						: i.source === 'avatar'
							? 'Profile picture'
							: `Reference photo${i.stage ? ` — ${i.stage}` : ''}`,
				meta: i.source === 'post' ? 'The post is trashed along with it' : null
			})),
			confirmLabel: 'Delete',
			tone: hasPosts ? 'danger' : 'caution'
		});
		if (!ok) return;

		deletingAssets = true;
		try {
			let removed = 0;
			if (postIds.length) {
				const res = await Posts.deleteMany(postIds);
				if (res.success) {
					removed += res.deleted ?? postIds.length;
					feedPosts = feedPosts.filter((p: any) => !postIds.includes(p.id));
					const manual = res.teardown?.manualDeletion;
					if (Array.isArray(manual) && manual.length > 0) manualDeleteNotice = manual as any;
				} else {
					showToast(res.error || 'Failed to delete posts', 'error');
				}
			}
			if (kitItems.length || avatarItems.length) {
				const payload = [
					...kitItems.map((i) => ({ kind: 'kit', stage: i.stage, url: i.url })),
					...avatarItems.map((i) => ({ kind: 'avatar', url: i.url }))
				];
				const res = await fetch(`/api/agent/${agent.id}/delete-assets`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ items: payload })
				});
				const result = await res.json();
				if (res.ok && result.success) {
					if (result.kit) referenceKit = result.kit;
					if (result.avatarCleared) characterRef = null;
					removed += payload.length;
				} else {
					showToast(result.error || 'Failed to delete reference photos', 'error');
				}
			}
			selectedAssetUrls = [];
			if (removed > 0) showToast(`Deleted ${countLabel(removed, 'asset')}`, 'success');
		} catch (err) {
			showToast((err as Error).message || 'Delete failed', 'error');
		} finally {
			deletingAssets = false;
		}
	}

	function deleteSelectedAssets() {
		void deleteAssets(assetItems.filter((a) => selectedAssetUrls.includes(a.url)));
	}

	/** Removes one past image from a kit stage's restore history. */
	async function deleteKitHistoryImage(stage: string, url: string) {
		const ok = await confirmAction({
			title: 'Remove this photo from the restore history?',
			body: "You won't be able to roll this stage back to it afterwards.",
			preview: [{ image: url, label: `Reference photo — ${stage}` }],
			confirmLabel: 'Remove',
			tone: 'caution'
		});
		if (!ok) return;
		try {
			const res = await fetch(`/api/agent/${agent.id}/delete-assets`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: [{ kind: 'kit', stage, url }] })
			});
			const result = await res.json();
			if (res.ok && result.success) {
				if (result.kit) referenceKit = result.kit;
				showToast('Photo removed from history', 'success');
			} else {
				showToast(result.error || 'Could not remove that photo', 'error');
			}
		} catch (err) {
			showToast((err as Error).message || 'Could not remove that photo', 'error');
		}
	}
	let assetLightbox = $state<AssetItem | null>(null);
	// Play the lightbox clip imperatively on mount (inside the tap's activation
	// window) and swallow a blocked-autoplay rejection — unmuted `autoplay` on a
	// just-mounted element is often refused on mobile; `controls` remain as the
	// manual fallback. See the same pattern in PostCard.
	function playOnMount(node: HTMLVideoElement) {
		node.play?.().catch(() => {});
	}

	// ── Profile save ───────────────────────────────────────────────
	// ── Generation cost tracking ────────────────────────────────────────────
	// Per-provider spend (estimates from the generation_events ledger).
	// The ledger stores RAW PROVIDER USD; every render of it below goes through
	// quote() so the screen shows what the wallet actually charges. When metering
	// is off the wallet debits nothing, so a "Spend" label would claim a charge
	// that never happened — read from the same primed context quote() uses.
	const metered = $derived(Boolean(pricingContext().metered));
	// The avatar/reference helper copy prices a Nano Banana 2 image call. It used
	// to print the provider's $0.08 flat, which is a third of what the call is
	// actually billed at — quote() puts the customer's number on the customer's
	// screen. Matches the fal image row in PRICING_MATRIX.
	const NANO_IMAGE_USD = 0.08;
	let agentSpend = $state<{
		total: number;
		byProvider: Record<string, number>;
		byOperation: Record<string, number>;
	} | null>(null);
	// /api/agent/[id]/spend is manager-and-above. Asking anyway put a 403 in the
	// console on every visit by a creator or viewer seat; the panel below now
	// says whose view this is instead of silently showing nothing.
	const seat = $derived(((data as any).seat ?? FULL_ACCESS) as SeatCapabilities);
	async function loadSpend(agentId: string) {
		if (!seat.canSeeSpend) return;
		try {
			const res = await fetch(`/api/agent/${agentId}/spend`);
			const d = await parseJsonResponse<any>(res);
			if (d.success) agentSpend = d;
		} catch {
			/* analytics only — never block the page */
		}
	}
	// Plain variable on purpose: `agent = { ...agent }` spreads (optimistic
	// updates all over this file) retrigger the effect without the id changing —
	// only a real persona switch should refetch spend.
	let spendLoadedForId: string | null = null;
	$effect(() => {
		const id = agent?.id;
		if (!id || id === spendLoadedForId || !seat.canSeeSpend) return;
		spendLoadedForId = id;
		loadSpend(id);
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

	// Single source for the market-JSON payload — shared by the full profile
	// save and the identity-kit auto-save so the two can never drift. The market
	// column is stored WHOLESALE from this object: any new pp* field must be
	// added here (and to the resync effect) or it silently drops on save.
	function currentPersonaProfile() {
		return {
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
			appearance: ppAppearance,
			voiceProfile: ppVoiceProfile,
			bios: ppBios,
			handleCandidates: ppHandleCandidates,
			confirmedHandles: ppConfirmedHandles,
			displayName: ppDisplayName
		};
	}

	async function saveProfile(successMessage?: string): Promise<boolean> {
		if (!agent?.id) return false;
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
			personaProfile: currentPersonaProfile()
		};
		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const d = await parseJsonResponse<any>(res);
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
			// Update local agent state optimistically. personas_profile is the
			// profile's only home (readPersonaProfile prefers it and accepts the v1
			// form); `market` is a market string again since P0.6 and is not touched.
			agent = {
				...agent,
				name: editName,
				handle: editHandle,
				status: editStatus,
				niche: editNiche,
				gradient: editGradient,
				initial: editInitial,
				personas_profile: payload.personaProfile,
				soul: soulText,
				skills: skillsText,
				tools: toolsText,
				timezone,
				posts_per_day: postsPerDay,
				active_hours_start: activeHoursStart,
				active_hours_end: activeHoursEnd,
				autonomy_level: autonomyLevel,
				rss_url: rssUrl,
				rss_active: rssActive,
				ugc_voice: selectedVoice,
				brand_brief_id: selectedBrandBriefId || null
			};
			// The brand pin is now persisted — clear the unsaved-change indicator and
			// let the composer re-pull products for the new pin on next open.
			savedBrandBriefId = selectedBrandBriefId;
			// …then re-fetch layout data so the sidebar roster + header (which read
			// server-loaded sidebarAgents) reflect the new name/avatar immediately.
			await invalidateAll();
			showToast(successMessage ?? `Profile saved for ${editName}`, 'success');
			return true;
		} catch (err: any) {
			showToast('Failed to save: ' + err.message, 'error');
			return false;
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
		const requestAgentId = agent.id;
		kitRestoreLoadingAll = true;
		try {
			// Reuse the profile-picture history endpoint — it lists every image in
			// the user's library, exactly the fallback pool for any stage.
			const res = await fetch(`/api/agent/${requestAgentId}/restore-avatar`);
			const d = await res.json().catch(() => ({}));
			// A persona switch mid-fetch already cleared this cache in the resync
			// effect — a late response must not refill it with the OLD persona's
			// library (the length-guard above would then pin it forever).
			if (agent?.id !== requestAgentId) return;
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

	// ── Post Now: publish a draft/scheduled post immediately, overriding schedule ──
	// Reuses the publish-post endpoint with NO platforms → the server targets the
	// post's own connected platforms (or all connected). Does not touch the
	// scheduler; the post simply lands as published/partial/failed.
	let postingNowId = $state<string | null>(null);
	async function postNow(post: any) {
		if (!agent?.id || postingNowId) return;
		postingNowId = post.id;
		try {
			const res = await fetch(`/api/agent/${agent.id}/publish-post`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ postId: post.id })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok || !d.success) throw new Error(d.error || 'Post now failed');
			showToast(
				d.status === 'published'
					? 'Posted live!'
					: d.status === 'partial'
						? 'Posted to some platforms — open for details'
						: `Post ${d.status}`,
				d.status === 'failed' ? 'error' : 'success'
			);
			modalPost = null;
			await loadFeed();
		} catch (e) {
			showToast('Post now failed: ' + (e as Error).message, 'error');
		} finally {
			postingNowId = null;
		}
	}

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
				// Keep the polled kit too: regenerating the avatar deletes the derived
				// stages server-side (side_profiles/face_closeup/feature_grid), so
				// avatarUrl alone would leave stale ✓ thumbnails on screen.
				d = { character_ref: state.avatarUrl, reference_kit: state.kit };
			}
			// The user may have switched personas while this request was in flight —
			// the server already persisted the result under requestAgentId regardless,
			// but only apply it to in-memory state if we're still looking at that persona.
			if (agent?.id === requestAgentId) {
				characterRef = d.character_ref;
				if (d.reference_kit) referenceKit = d.reference_kit;
				agent = { ...agent, ugc_character_ref: d.character_ref, ugc_reference_kit: referenceKit };
				await invalidateAll(); // refresh sidebar/header avatar
				showToast('Profile picture generated', 'success');
			} else {
				showToast(`Profile picture generated for ${requestAgentName}`, 'success');
			}
			finishGeneration(jobId);
		} catch (err: any) {
			if (err.message === 'cancelled') {
				// Navigation only stopped OUR polling — the job is still running
				// server-side, so the entry stays in the store and the global activity
				// indicator keeps showing it (startGeneration de-dupes by id if a new
				// poll starts for the same key later).
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
		scrollParent?.removeEventListener('scroll', updateHeroFade);
		// Leaving the page with a kit edit still debouncing — save it now.
		flushPendingKitSave();
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
				// Same as generateAvatar(): the server job survives our navigation —
				// leave the entry so the activity indicator keeps showing it.
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
	// Declared here, after every flag it reads: the stale-notice retry button is
	// disabled while ANY portrait or kit generation is in flight, so a second
	// click cannot start a second paid job behind the first.
	let staleActionBusy = $derived(generatingAvatar || generatingKitStage !== null || generatingAllKit);
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
		// Personas do NOT go to Trash — this really is permanent, so it earns the
		// type-to-confirm that an everyday post delete does not.
		const confirmed = await confirmAction({
			title: `Permanently delete ${agent.name}?`,
			body:
				'The persona, its brand brief, its connections and every post it ever made are ' +
				'removed. There is no Trash and no restore for a persona.',
			warning: 'There is no undo for this.',
			preview: [
				{
					image: characterRef || null,
					gradient: agent.gradient || null,
					initial: agent.initial || agent.name?.charAt(0) || null,
					label: agent.name,
					meta: agent.handle ? `@${agent.handle}` : (agent.niche ?? null)
				}
			],
			confirmLabel: 'Delete persona',
			tone: 'danger',
			typeToConfirm: agent.name
		});
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
					showToast(d.note || `Opening ${platformLabel(platform)} authorization…`, 'info');
					window.open(d.redirect_url, '_blank', 'noopener');
				}
				await checkStatuses();
			} else {
				// A raw "Failed to fetch" means the request was dropped at the network
				// level (the server took too long, usually reaching Zernio) — turn it
				// into something actionable rather than a cryptic browser string.
				const isNetworkDrop = /failed to fetch|load failed|networkerror|timed out/i.test(
					res.error || ''
				);
				showToast(
					isNetworkDrop
						? `Couldn't reach the server to start the ${platformLabel(platform)} connection — try again in a moment.`
						: res.error || `Failed to connect ${platform}`,
					'error'
				);
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

	const getStatusColor = personaStatusFill;
</script>

{#if !agent}
	<div class="no-agent">
		<p>Persona not found.</p>
		<a href="/dashboard" class="btn-primary">Back to Dashboard</a>
	</div>
{:else}
	<PageShell title={agent.name} width="wide" bare>
	<div class="persona-page">
		<!-- ── Hero header ─────────────────────────────────────────── -->
		<!-- Compact identity header — the banner image was removed on request:
	     the character photo shows ONCE (avatar), not stretched behind the name. -->
		<header
			class="persona-hero"
			bind:this={heroEl}
			style="opacity: {1 - heroFade}; transform: translateY({(-heroFade * 16).toFixed(
				1
			)}px); pointer-events: {heroFade > 0.98 ? 'none' : 'auto'};"
			aria-hidden={heroFade > 0.98}
		>
			<div class="hero-row">
				{#if agent.ugc_character_ref}
					<!-- Clickable → enlarge (same lightbox as the profile-picture/kit thumbnails),
				     so every photo instance can be enlarged. -->
					<button
						type="button"
						class="hero-avatar hero-avatar-btn"
						onclick={() =>
							openPreview(agent.ugc_character_ref, 'Profile picture', requestGenerateAvatar)}
						aria-label="Enlarge {agent.name}'s profile picture"
					>
						<img src={agent.ugc_character_ref} alt="" width="80" height="80" />
					</button>
				{:else}
					<div class="hero-avatar" style={`background: ${agent.gradient}`}>
						{agent.initial ?? agent.name?.[0]?.toUpperCase() ?? '?'}
					</div>
				{/if}
				<div class="hero-info">
					<div class="hero-name-row">
						<h1 class="hero-name">{agent.name}</h1>
						<span class="hero-handle">{agent.handle}</span>
						<span
							class="hero-status-dot"
							style="background: {getStatusColor(agent.status)}"
							title={agent.status}
							aria-hidden="true"
						></span>
						<span class="sr-only">Status: {agent.status}</span>
						<button
							type="button"
							class="hero-fav-btn"
							class:faved={agent.is_favorite}
							title={agent.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
							aria-label={agent.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
							aria-pressed={Boolean(agent.is_favorite)}
							disabled={togglingAgentFavorite}
							onclick={toggleAgentFavorite}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill={agent.is_favorite ? 'currentColor' : 'none'}
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><path
									d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
								/></svg
							>
						</button>
					</div>
					<div class="hero-meta">
						<span class="hero-niche">{agent.niche}</span>
						<span class="hero-sep">·</span>
						<span class="hero-autonomy"
							>{AUTONOMY_LABELS[agent.autonomy_level as AutonomyLevel]?.label ??
								agent.autonomy_level}</span
						>
						{#if computedMetrics.connectedCount > 0}
							<span class="hero-sep">·</span>
							<span class="hero-connections"
								>{countLabel(computedMetrics.connectedCount, 'platform')} connected</span
							>
						{/if}
					</div>
				</div>
				<div class="hero-stats">
					<div class="stat-chip" title="Posts the platform confirmed went live">
						<span class="stat-val">{postedCount}</span>
						<span class="stat-label">Published</span>
					</div>
					{#if queuedCount > 0}
						<div class="stat-chip stat-chip-queued" title="Drafts + scheduled — not yet published">
							<span class="stat-val">{queuedCount}</span>
							<span class="stat-label">Queued</span>
						</div>
					{/if}
					{#if generationCost > 0}
						<!-- Retail, not provider cost. The old 4-vs-2 decimal dance existed because a
						     sub-cent provider estimate rendered as "$0.00"; a quote is charged in whole
						     credits (1 credit = 1 cent), so it can never round away to nothing. -->
						<div class="stat-chip stat-chip-spend">
							<span class="stat-val">{quote(generationCost)}</span>
							<span class="stat-label">{metered ? 'Spend' : 'Est. spend'}</span>
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

			<!-- Identity strip: the persona's public-facing bio, per platform. Fills
		     the formerly-blank hero and gives one-click copy for manual profile
		     setup — no platform accepts bio/avatar updates via API, so copy-paste
		     IS the publish path for profile fields. -->
			<div class="hero-identity">
				<select class="kit-select" bind:value={kitPlatform} aria-label="Platform for bio">
					{#each BIO_PLATFORM_KEYS as k (k)}
						<option value={k}>{platformLabel(k)}</option>
					{/each}
				</select>
				{#if ppBios[kitPlatform]}
					<p class="hero-bio" title={ppBios[kitPlatform]}>{ppBios[kitPlatform]}</p>
					<button
						type="button"
						class="kit-copy-btn"
						onclick={() => copyKitText(ppBios[kitPlatform], `${platformLabel(kitPlatform)} bio`)}
						><svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><rect x="9" y="9" width="12" height="12" rx="2" /><path
								d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
							/></svg
						> Copy bio</button
					>
				{:else}
					<p class="hero-bio hero-bio-empty">No {platformLabel(kitPlatform)} bio yet.</p>
					<!-- First-ever generation seeds the whole starter kit; after that the
				     CTA only generates the SELECTED platform's bio — small, fast calls
				     that can't time out or touch other platforms' work. -->
					<button
						type="button"
						class="kit-copy-btn"
						onclick={() =>
							generateKit(
								ppHandleCandidates.length === 0 && Object.keys(ppBios).length === 0
									? 'starter'
									: 'bio'
							)}
						disabled={kitBusy}
						>{#if kitBusy}Generating…{:else}<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><path
									d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
								/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
							>
							{ppHandleCandidates.length === 0 && Object.keys(ppBios).length === 0
								? 'Generate identity kit'
								: `Generate ${platformLabel(kitPlatform)} bio`}{/if}</button
					>
				{/if}
				{#if ppConfirmedHandles[kitPlatform]}
					<button
						type="button"
						class="hero-handle-chip"
						title="Confirmed {platformLabel(kitPlatform)} username — click to copy"
						onclick={() => copyKitText(ppConfirmedHandles[kitPlatform], 'Username')}
						>@{ppConfirmedHandles[kitPlatform]}</button
					>
				{/if}
			</div>
		</header>

		<!-- ── Tab nav ────────────────────────────────────────────── -->
		<!-- Sticky so identity stays visible while scrolling a long tab (fixes the
	     class of confusion where you lose track of which persona you're on). -->
		<nav class="tab-nav">
			<div class="tab-nav-identity" title="{agent.name} ({agent.handle})">
				{#if agent.ugc_character_ref}
					<button
						type="button"
						class="tab-nav-avatar tab-nav-avatar-btn"
						onclick={() =>
							openPreview(agent.ugc_character_ref, 'Profile picture', requestGenerateAvatar)}
						aria-label="Enlarge profile picture"
					>
						<img src={agent.ugc_character_ref} alt="" width="26" height="26" />
					</button>
				{:else}
					<span class="tab-nav-avatar" style={`background: ${agent.gradient}`}>
						{agent.initial ?? agent.name?.[0]?.toUpperCase() ?? '?'}
					</span>
				{/if}
				<span class="tab-nav-name">{agent.name}</span>
			</div>
			<div class="tab-nav-buttons">
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'profile'}
					aria-current={activeTab === 'profile' ? 'true' : undefined}
					onclick={() => (activeTab = 'profile')}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" /></svg
					>
					Profile
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'content'}
					aria-current={activeTab === 'content' ? 'true' : undefined}
					onclick={() => (activeTab = 'content')}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg
					>
					Content
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'studio'}
					aria-current={activeTab === 'studio' ? 'true' : undefined}
					onclick={() => (activeTab = 'studio')}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z" /><path
							d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"
						/></svg
					>
					Studio
				</button>
			</div>
		</nav>

		<!-- ── Tab content ────────────────────────────────────────── -->
		<div class="tab-body">
			<!-- Stale notices: what on this page no longer matches the persona.
			     Mounted here — first thing in the tab body, above every section and
			     below the sticky nav — because these are the one thing on the page
			     that must not need scrolling or a disclosure to be seen, and
			     because a failed portrait or a miscast voice is just as relevant
			     while writing content as while editing the profile. Renders
			     absolutely nothing when there is nothing wrong. -->
			<StaleNotices warnings={staleNotices} onAction={runStaleAction} busy={staleActionBusy} />
			{#if activeTab === 'profile'}
				<!-- Lens switcher shared by both Profile lenses — mirrors the Content
			     tab's toggle so switching feels identical everywhere. -->
				<div class="feed-view-toggle profile-lens" role="group" aria-label="Profile view">
					<button
						type="button"
						class="view-toggle-btn"
						class:active={profileView === 'overview'}
						aria-pressed={profileView === 'overview'}
						onclick={() => (profileView = 'overview')}
					>
						Profile
					</button>
					<button
						type="button"
						class="view-toggle-btn"
						class:active={profileView === 'connections'}
						aria-pressed={profileView === 'connections'}
						onclick={() => (profileView = 'connections')}
					>
						Connections{#if computedMetrics.connectedCount > 0}&nbsp;({computedMetrics.connectedCount}){/if}
					</button>
				</div>
				{#if profileView === 'overview'}
					<!-- Optional layout switch. Default is Classic; nothing changes unless
					     you press this. -->
					<button
						type="button"
						class="layout-switch"
						class:on={profileLayout === 'bento'}
						aria-pressed={profileLayout === 'bento'}
						title={profileLayout === 'bento'
							? 'Back to the classic stacked layout'
							: 'Try the bento layout — same sections, arranged in a grid'}
						onclick={() => (profileLayout = profileLayout === 'bento' ? 'classic' : 'bento')}
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
							aria-hidden="true"
							><rect x="3" y="3" width="8" height="12" rx="1" /><rect
								x="13"
								y="3"
								width="8"
								height="6"
								rx="1"
							/><rect x="13" y="11" width="8" height="10" rx="1" /><rect
								x="3"
								y="17"
								width="8"
								height="4"
								rx="1"
							/></svg
						>
						{profileLayout === 'bento' ? 'Classic view' : 'Bento view'}
					</button>
				{/if}
			{/if}

			<!-- CONTENT TAB -->
			{#if activeTab === 'content'}
				<div class="feed-tab">
					<!-- Toolbar -->
					<div class="feed-toolbar">
						<!-- One dataset, three lenses: post mosaic, flat assets grid, or calendar. -->
						<div class="feed-view-toggle" role="group" aria-label="Content view">
							<button
								type="button"
								class="view-toggle-btn"
								class:active={feedView === 'posts'}
								aria-pressed={feedView === 'posts'}
								onclick={() => (feedView = 'posts')}
							>
								Posts
							</button>
							<button
								type="button"
								class="view-toggle-btn"
								class:active={feedView === 'assets'}
								aria-pressed={feedView === 'assets'}
								onclick={() => (feedView = 'assets')}
							>
								Assets{#if assetItems.length > 0}&nbsp;({assetItems.length}){/if}
							</button>
							<button
								type="button"
								class="view-toggle-btn"
								class:active={feedView === 'calendar'}
								aria-pressed={feedView === 'calendar'}
								onclick={() => (feedView = 'calendar')}
							>
								Calendar
							</button>
						</div>
						{#if feedView === 'posts'}
							<div class="feed-filters">
								{#if genFailedCount > 0 && feedFilter !== 'failed'}
									<!-- Errors are hidden from the default view; this is the only
							     nudge that they exist and need a look. -->
									<button
										type="button"
										class="filter-alert"
										onclick={() => (feedFilter = 'failed')}
										title="{countLabel(genFailedCount, 'failed generation')} {plural(
											genFailedCount,
											'is',
											'are'
										)} hidden from this view — click to review"
									>
										<span class="filter-alert-dot" aria-hidden="true"></span>
										{genFailedCount} failed
									</button>
								{/if}
								<select
									class="filter-select"
									aria-label="Filter posts by status"
									bind:value={feedFilter}
								>
									<option value="all">All statuses</option>
									<option value="published">Published</option>
									<option value="scheduled">Scheduled</option>
									<option value="publishing">Publishing</option>
									<option value="draft">Draft</option>
									<option value="partial">Partial</option>
									<option value="failed"
										>Failed{genFailedCount > 0 ? ` (${genFailedCount})` : ''}</option
									>
								</select>
								<select
									class="filter-select"
									aria-label="Filter posts by media type"
									bind:value={mediaTypeFilter}
								>
									<option value="all">Images + videos</option>
									<option value="video">Videos only</option>
									<option value="image">Images only</option>
								</select>
								<select
									class="filter-select"
									aria-label="Filter posts by platform"
									bind:value={platformFilter}
								>
									<option value="all">All platforms</option>
									{#each PLATFORMS as p}
										<option value={p.key}>{p.name}</option>
									{/each}
								</select>
							</div>
						{/if}
						<div class="feed-actions">
							<button
								type="button"
								class="btn-generate"
								onclick={() => requestGeneratePost()}
								disabled={generatingPost || feedLoading}
							>
								{#if generatingPost}
									<span class="spinner-sm" aria-hidden="true"></span> Generating…
								{:else}
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path
											d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
										/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
									>
									Generate Now
								{/if}
							</button>
							<button
								type="button"
								class="btn-sync"
								onclick={() => (confirmDraftsOpen = true)}
								disabled={fillingDrafts || feedLoading}
								title="Top up this persona's review queue: autopilot fills the empty future slots with drafts"
							>
								{#if fillingDrafts}
									<span class="spinner-sm" aria-hidden="true"></span> Filling drafts…
								{:else}
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path
											d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
										/></svg
									>
									Generate Drafts
								{/if}
							</button>
							<button
								type="button"
								class="btn-sync"
								onclick={syncFeed}
								disabled={syncingFeed || feedLoading}
							>
								{#if syncingFeed}
									<span class="spinner-sm" aria-hidden="true"></span> Syncing…
								{:else}
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" /></svg
									>
									Sync Feed
								{/if}
							</button>
						</div>
					</div>

					{#if feedView === 'posts'}
						{#if feedLoading}
							<div class="feed-loading" role="status" aria-live="polite">
								<span class="spinner-lg" aria-hidden="true"></span>
								<p>Loading posts…</p>
							</div>
						{:else if filteredPosts.length === 0}
							<div class="feed-empty">
								<span class="empty-icon"
									><svg
										width="40"
										height="40"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></svg
									></span
								>
								<h2>No posts yet</h2>
								<p>
									{feedFilter !== 'all' || platformFilter !== 'all'
										? 'No posts match these filters.'
										: 'Generate your first post — drafts save even without a connected platform.'}
								</p>
								{#if feedFilter === 'all' && platformFilter === 'all'}
									<div class="feed-empty-actions">
										<button
											type="button"
											class="btn-generate"
											onclick={() => requestGeneratePost()}
											disabled={generatingPost}
										>
											{#if generatingPost}Generating…{:else}<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path
														d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
													/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
												> Generate First Post{/if}
										</button>
										<button
											type="button"
											class="btn-sync"
											onclick={() => {
												activeTab = 'profile';
												profileView = 'connections';
											}}
										>
											Manage Connections
										</button>
									</div>
								{/if}
							</div>
						{:else}
							<SelectionToolbar
								total={groupedPosts.length}
								selectedCount={selectedPostIds.length}
								noun="post"
								busy={bulkDeletingPosts}
								onSelectAll={selectAllPosts}
								onClear={clearPostSelection}
								onDelete={deleteSelectedPosts}
							/>
							<div class="post-mosaic">
								{#each groupedPosts as post (post.id)}
									<PostCard
										{post}
										onOpen={(p) => (modalPost = p)}
										onPublishFallback={openPublishFallback}
										selectable
										selected={selectedPostIds.includes(post.id)}
										onToggleSelect={(p) => togglePostSelected(p.id)}
										onDelete={handleDeletePost}
										onEnlarge={openPostMedia}
										onToggleFavorite={togglePostFavorite}
									/>
								{/each}
							</div>
						{/if}
					{/if}

					{#if feedView === 'assets'}
						<!-- Assets view: every generated visual in one flat grid (former Assets tab). -->
						{#if feedLoading && assetItems.length === 0}
							<div class="feed-loading" role="status" aria-live="polite">
								<span class="spinner" aria-hidden="true"></span> Loading assets…
							</div>
						{:else if assetItems.length === 0}
							<div class="feed-empty">
								<span class="empty-icon"
									><svg
										width="40"
										height="40"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><rect x="3" y="3" width="18" height="18" rx="2" /><circle
											cx="8.5"
											cy="8.5"
											r="1.5"
										/><path d="M21 15l-5-5L5 21" /></svg
									></span
								>
								<h2>No assets yet</h2>
								<p>
									Every image and video generated for this persona will collect here — post media,
									poster stills, storyboards, the profile picture, and the reference kit.
								</p>
							</div>
						{:else}
							<SelectionToolbar
								total={assetItems.length}
								selectedCount={selectedAssetUrls.length}
								noun="asset"
								busy={deletingAssets}
								onSelectAll={selectAllAssets}
								onClear={clearAssetSelection}
								onDelete={deleteSelectedAssets}
							/>
							<div class="assets-grid">
								{#each assetItems as asset (asset.url)}
									<div class="asset-cell" class:selected={selectedAssetUrls.includes(asset.url)}>
										<button
											type="button"
											class="asset-tile"
											onclick={() => (assetLightbox = asset)}
											aria-label="View {asset.label}"
										>
											{#if asset.type === 'video'}
												<!-- Static preview only (the real clip plays in the lightbox on tap), so
											     show the poster as a plain lazy <img> — no <video preload> per tile,
											     which otherwise fired a metadata range request for every clip on load.
											     Fall back to a no-preload <video> only when a poster is missing. -->
												{#if asset.poster}
													<img src={asset.poster} loading="lazy" width="400" height="400" alt="" />
												{:else}
													<video src={asset.url} muted playsinline preload="none"></video>
												{/if}
												<span class="asset-video-badge"
													><svg
														width="10"
														height="10"
														viewBox="0 0 24 24"
														fill="currentColor"
														aria-hidden="true"><path d="M8 5v14l11-7z" /></svg
													><span class="sr-only">Video</span></span
												>
											{:else}
												<img src={asset.url} loading="lazy" width="400" height="400" alt="" />
											{/if}
											<span class="asset-label">{asset.label}</span>
										</button>
										<label class="asset-select" title="Select for bulk actions">
											<input
												type="checkbox"
												checked={selectedAssetUrls.includes(asset.url)}
												onchange={() => toggleAssetSelected(asset.url)}
												aria-label="Select {asset.label}"
											/>
										</label>
										<button
											type="button"
											class="asset-del"
											title={asset.source === 'post'
												? 'Delete the post this media belongs to'
												: asset.source === 'avatar'
													? 'Clear the profile picture'
													: 'Remove from the reference kit'}
											aria-label="Delete {asset.label}"
											disabled={deletingAssets}
											onclick={() => deleteAssets([asset])}
										>
											<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.2"
												stroke-linecap="round"
												aria-hidden="true"
												><path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 01-2 2H9a2 2 0 01-2-2V6h12" /></svg
											>
										</button>
									</div>
								{/each}
							</div>
						{/if}
					{/if}

					{#if feedView === 'calendar'}
						<!-- Calendar lens (former Calendar tab) — same posts, placed in time. -->
						{#if feedLoading && calendarPosts.length === 0}
							<div class="feed-loading" role="status" aria-live="polite">
								<span class="spinner-lg" aria-hidden="true"></span>
								<p>Loading posts…</p>
							</div>
						{:else}
							<CalendarView
								posts={calendarPosts}
								onOpenPost={(p) => (modalPost = feedRowFor(p))}
								onApprove={async (p) => {
									const row = feedRowFor(p);
									if (row) await handleApprovePost(row);
								}}
								onGenerateForDate={(d) => requestGeneratePost(d)}
							/>
						{/if}
					{/if}
				</div>

				<!-- PROFILE TAB · Overview lens -->
			{:else if activeTab === 'profile' && profileView === 'overview'}
				<div class="profile-tab" class:bento={profileLayout === 'bento'}>
					<!-- Brand section: which of the user's brand briefs this persona
				     generates for. One client can run several brands (Just Kids
				     Honey, HoneyX Manly Plus…) — every asset this persona makes is
				     grounded in the brief selected here. -->
					<details class="profile-section" open>
						<summary class="section-summary">
							<div class="section-header">
								<h2 class="section-title">Brand Brief</h2>
								<p class="section-desc">
									Choose the brand brief this persona creates content for — its products, voice, and
									audience ground every asset. Selection is opt-in: with <strong>None</strong> selected,
									the persona generates with no brand brief (no brand is applied automatically).
								</p>
							</div>
							<svg
								class="section-chevron"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
							>
						</summary>
						<div class="fields-grid">
							<div class="field-group col-span-2">
								<label for="p-brief">Brand Brief</label>
								<div class="brand-kit-row">
									<select id="p-brief" bind:value={selectedBrandBriefId}>
										<option value="">— None (no brand brief) —</option>
										{#each brandBriefs as b (b.id)}
											<option value={b.id}>{b.name}</option>
										{/each}
									</select>
									<button
										type="button"
										class="btn-primary btn-apply-brand"
										onclick={applyBrandKit}
										disabled={!brandDirty || savingBrand}
										title={brandDirty
											? 'Save this brand-kit choice'
											: 'No unsaved brand-kit change'}
									>
										{savingBrand ? 'Applying…' : brandDirty ? 'Apply brand brief' : 'Applied'}
									</button>
								</div>
								{#if brandBriefs.length === 0}
									<p class="field-hint">
										No brand briefs saved yet — create one in <a href="/brand-brief">Brand Brief</a
										>, then select it here.
									</p>
								{:else if brandDirty}
									<p class="field-hint brand-dirty-hint">
										Unsaved change — click <strong>Apply brand brief</strong> to confirm.
									</p>
								{:else}
									<p class="field-hint">
										{savedBrandBriefId
											? `Applied: this persona creates for “${brandBriefs.find((b) => b.id === savedBrandBriefId)?.name ?? 'the selected brand'}”.`
											: 'No brand brief applied — content generates without brand context.'}
										Manage briefs in <a href="/brand-brief">Brand Brief</a>.
									</p>
								{/if}
							</div>
						</div>
					</details>

					<!-- Persona Profile — above Identity: these fields feed generation prompts -->
					<details class="profile-section">
						<!-- starts collapsed: Brand Brief is the only section open by default -->
						<summary class="section-summary">
							<div class="section-header">
								<div class="label-row">
									<h2 class="section-title">Persona Profile</h2>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											generatePersonaProfile();
										}}
										disabled={generatingProfile}
										title="Generate a unique profile tailored to the selected brand and this persona's gender"
									>
										{#if generatingProfile}Generating…{:else}<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path
													d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
												/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
											> Generate for brand{/if}
									</button>
								</div>
								<p class="section-desc">
									Psychological depth and content strategy — these feed directly into content
									generation prompts. “Generate for brand” fills a unique, brand-tailored profile
									(aligned to this persona's gender) and saves it automatically — review and tweak
									anytime.
								</p>
							</div>
							<svg
								class="section-chevron"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
							>
						</summary>

						<div class="fields-grid">
							<!-- Identity fields, moved up into the profile: the NAME stays constant;
						     NICHE (and everything below) is filled by "Generate for brand". -->
							<div class="field-group">
								<label for="p-name">Persona Name</label>
								<input
									id="p-name"
									type="text"
									bind:value={editName}
									placeholder="e.g. Veronica Active"
								/>
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
								<span class="field-label" id="pp-age-label">Target Age Range</span>
								<div class="age-chips" role="group" aria-labelledby="pp-age-label">
									<button
										type="button"
										class="age-chip age-chip-all"
										class:selected={ppAgeRanges.length === AGE_RANGES.length}
										aria-pressed={ppAgeRanges.length === AGE_RANGES.length}
										onclick={toggleAllAgeRanges}>All ages</button
									>
									{#each AGE_RANGES as r}
										<button
											type="button"
											class="age-chip"
											class:selected={ppAgeRanges.includes(r.key)}
											aria-pressed={ppAgeRanges.includes(r.key)}
											onclick={() => toggleAgeRange(r.key)}>{r.key}</button
										>
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
								<p class="field-hint">
									Drives the generated character's appearance and default voice.
								</p>
							</div>

							<div class="field-group">
								<label for="pp-archetype">Persona Archetype</label>
								<select id="pp-archetype" bind:value={ppArchetype}>
									<!-- Off-list legacy / wizard-typed value: keep it selectable so it is
									     visible and survives a save instead of rendering as a blank select. -->
									{#if ppArchetype && !(PERSONA_ARCHETYPES as readonly string[]).includes(ppArchetype)}
										<option value={ppArchetype}>{ppArchetype}</option>
									{/if}
									<option value="">— Select archetype —</option>
									{#each PERSONA_ARCHETYPES as a}
										<option value={a}>{a}</option>
									{/each}
								</select>
								<p class="field-hint">
									Defines the persona's role and audience relationship style.
								</p>
							</div>

							<div class="field-group">
								<label for="pp-focus">Content Focus</label>
								<select id="pp-focus" bind:value={ppContentFocus}>
									{#if ppContentFocus && !(CONTENT_FOCUS_OPTIONS as readonly string[]).includes(ppContentFocus)}
										<option value={ppContentFocus}>{ppContentFocus}</option>
									{/if}
									<option value="">— Select focus —</option>
									{#each CONTENT_FOCUS_OPTIONS as f}
										<option value={f}>{f}</option>
									{/each}
								</select>
								<p class="field-hint">Primary category of content this persona produces.</p>
							</div>

							<div class="field-group col-span-2">
								<label for="pp-target">Target Avatar</label>
								<input
									id="pp-target"
									type="text"
									bind:value={ppTargetAvatar}
									placeholder="e.g. Working moms 28-42, fitness-curious, short on time"
								/>
								<p class="field-hint">
									One-liner describing the ideal audience member this persona speaks to.
								</p>
							</div>

							<div class="field-group col-span-2">
								<label for="pp-psych">Psychology Profile</label>
								<textarea
									id="pp-psych"
									bind:value={ppPsychProfile}
									rows="4"
									placeholder="Describe audience psychology — motivations, fears, desires, pain points, identity hooks…"
								>
								</textarea>
								<p class="field-hint">
									Used to tune tone, hooks, and emotional framing in generated content.
								</p>
							</div>

							<div class="field-group col-span-2">
								<label for="pp-angle">Content Angle / POV</label>
								<textarea
									id="pp-angle"
									bind:value={ppContentAngle}
									rows="3"
									placeholder="e.g. 'Real results, no fluff' — direct, relatable transformations told in first person…"
								>
								</textarea>
								<p class="field-hint">
									The unique angle or point of view that differentiates this persona's content.
								</p>
							</div>

							<div class="field-group col-span-2">
								<div class="label-row">
									<span class="field-label">Appearance &amp; Wardrobe</span>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={readAppearanceFromPhoto}
										disabled={readingAppearance || !characterRef}
										title="Read the wardrobe, hair, eyes, etc. from the current profile picture so they match the real character"
									>
										{#if readingAppearance}Reading…{:else}<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path
													d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
												/><circle cx="12" cy="13" r="3" /></svg
											> Read from photo{/if}
									</button>
								</div>
								<p class="field-hint" style="margin: 0 0 0.6rem;">
									Dynamic look variables — clothing, colors, hair, eyes, headwear, styling. They
									feed the profile-picture generation so the face and outfit match. Fill them from
									the brand (“Generate for brand”) or read them from the current photo (“Read from
									photo”).
								</p>
								<TraitPicker bind:appearance={ppAppearance} />
							</div>
						</div>
					</details>

					<!-- Life details: what the system already knows about this person.
				     Read-only, collapsed, and mounted ONLY when there is something to
				     say — `lifeDetailGroups` is empty for any persona that has never
				     been through the sampler, and then this whole block, header
				     included, does not exist. Zero new required inputs: nothing here
				     is ever asked of the user. -->
					{#if lifeDetailGroups.length}
						<details class="profile-section">
							<summary class="section-summary">
								<div class="section-header">
									<h2 class="section-title">Life details</h2>
									<p class="section-desc">
										The everyday facts behind this persona — where they live, what they do, who they
										live with. Filled in for you; shown here so you can see what the generator is
										working from.
									</p>
								</div>
								<svg
									class="section-chevron"
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
								>
							</summary>
							<LifeDetails groups={lifeDetailGroups} />
						</details>
					{/if}

					<!-- Viewer panel: the audience bracket as a handful of concrete
				     people. Sits directly after Life details — that section says who
				     this persona IS, this one says who they are talking to, and the
				     pair reads as one thought. Collapsed, read-only, and mounted
				     ONLY when the persona actually states an audience the sampler
				     can narrow on; otherwise the whole block, header included, does
				     not exist. -->
					{#if viewerPanel.length}
						<details class="profile-section">
							<summary class="section-summary">
								<div class="section-header">
									<h2 class="section-title">Who they’re talking to</h2>
									<p class="section-desc">
										Your audience settings, turned into a few specific people. Not real, not saved —
										a way to picture who a post lands with instead of writing for a demographic.
									</p>
								</div>
								<svg
									class="section-chevron"
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
								>
							</summary>
							<ViewerPanel viewers={viewerPanel} />
						</details>
					{/if}

					<!-- Platform Identity Kit: the persona's public-facing profile per
				     platform. Copy-paste tooling by design — no platform (nor Zernio)
				     accepts profile-field updates via API; availability of a username
				     is confirmed manually at signup. -->
					<details class="profile-section">
						<summary class="section-summary">
							<div class="section-header">
								<div class="label-row">
									<h2 class="section-title">Platform Identity Kit</h2>
									<span
										class="kit-save-state"
										class:error={kitSaveState === 'error'}
										role="status"
										aria-live="polite"
									>
										{#if kitSaveState === 'saving'}
											Saving…
										{:else if kitSaveState === 'saved'}
											Saved <svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg
											>
										{:else if kitSaveState === 'error'}
											Save failed
										{/if}
									</span>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											generateKit('starter');
										}}
										disabled={kitBusy}
										title="One small call: display name + username candidates + bios for this persona's connected platforms (or a TikTok/Instagram/YouTube starter set)"
									>
										{#if generatingKit}Generating…{:else}<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path
													d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
												/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
											>
											{ppHandleCandidates.length || Object.keys(ppBios).length
												? 'Regenerate'
												: 'Generate'} starter kit{/if}
									</button>
								</div>
								<p class="section-desc">
									What goes ON the platform profile — display name, username, bio, picture.
									Platforms don't allow profile edits via API, so copy-paste these during account
									setup. Every edit here <strong>saves automatically per platform</strong> — switch platforms
									freely, nothing is lost. Usernames: try the top candidate at signup; if it's taken,
									mark it as taken and try the next; “Use” records the winner for the selected platform.
									Connecting the account later shows the real username as ground truth.
								</p>
							</div>
							<svg
								class="section-chevron"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
							>
						</summary>

						<div class="fields-grid">
							<div class="field-group">
								<label for="kit-display">Display Name</label>
								<div class="kit-inline">
									<input
										id="kit-display"
										type="text"
										value={ppDisplayName}
										oninput={(e) => {
											ppDisplayName = e.currentTarget.value;
											queueKitSave();
										}}
										placeholder="e.g. Jenny Tran ✨"
										maxlength="40"
									/>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={() => copyKitText(ppDisplayName, 'Display name')}
										disabled={!ppDisplayName}
										title="Copy display name"
										aria-label="Copy display name"
										><svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
											><rect x="9" y="9" width="12" height="12" rx="2" /><path
												d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
											/></svg
										></button
									>
								</div>
								<p class="field-hint">
									The profile “name” line (TikTok nickname, Instagram name) — looser rules than the
									username; spaces, caps, and an emoji are fine.
								</p>
							</div>

							<div class="field-group">
								<span class="field-label">Profile Picture</span>
								{#if characterRef}
									<div class="kit-avatar-row">
										<!-- Enlargeable like every other image in the app. -->
										<button
											type="button"
											class="kit-avatar-zoom"
											onclick={() =>
												characterRef &&
												openPreview(characterRef, 'Profile picture', requestGenerateAvatar)}
											title="Click to enlarge"
											aria-label="Enlarge profile picture"
										>
											<img
												class="kit-avatar-thumb"
												src={characterRef}
												alt=""
												width="52"
												height="52"
												loading="lazy"
											/>
										</button>
										<button type="button" class="btn-sync btn-xs" onclick={downloadAvatar}>
											<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path
													d="M7 10l5 5 5-5"
												/><path d="M12 15V3" /></svg
											>
											Download for upload
										</button>
									</div>
									<p class="field-hint">
										Upload this same image on every platform so the persona is recognizable at a
										glance.
									</p>
								{:else}
									<p class="field-hint">
										No generated photo yet — create one in Character &amp; Visuals below; it becomes
										the profile picture everywhere.
									</p>
								{/if}
							</div>

							<div class="field-group col-span-2">
								<div class="label-row">
									<span class="field-label">Username Candidates</span>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={() => generateKit('base')}
										disabled={kitBusy}
										title="Generate 10 fresh username candidates + display name — your taken/confirmed marks are kept"
									>
										{#if generatingKitBase}Generating…{:else}<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path
													d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
												/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
											> More ideas{/if}
									</button>
								</div>
								<p class="field-hint" style="margin: 0 0 0.6rem;">
									One handle everywhere: candidates are ≤15 chars, letters/digits/underscores, so
									they fit every platform (X is the strictest). Confirmations apply to
									<strong>{platformLabel(kitPlatform)}</strong> — switch the platform in the bio picker
									below.
								</p>
								{#if ppHandleCandidates.length === 0}
									<p class="field-hint">
										No candidates yet — hit “More ideas” or the starter kit above.
									</p>
								{:else}
									<div class="kit-candidates">
										{#each ppHandleCandidates as c (c.handle)}
											<div
												class="kit-candidate"
												class:taken={c.status === 'taken'}
												class:confirmed={c.status === 'confirmed'}
											>
												<span class="kit-candidate-handle">@{c.handle}</span>
												{#if handleCompatNote(c.handle)}
													<span class="kit-compat">{handleCompatNote(c.handle)}</span>
												{/if}
												{#if c.status === 'confirmed'}
													<span class="kit-confirmed-badge"
														><svg
															width="12"
															height="12"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2.5"
															stroke-linecap="round"
															stroke-linejoin="round"
															aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg
														> in use</span
													>
												{:else if c.status === 'taken'}
													<span class="kit-taken-badge">taken</span>
												{/if}
												<span class="kit-candidate-actions">
													<button
														type="button"
														title="Copy username"
														aria-label="Copy username @{c.handle}"
														onclick={() => copyKitText(c.handle, 'Username')}
														><svg
															width="13"
															height="13"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
															aria-hidden="true"
															><rect x="9" y="9" width="12" height="12" rx="2" /><path
																d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
															/></svg
														></button
													>
													<button
														type="button"
														title={c.status === 'taken'
															? 'Un-mark — it was available after all'
															: 'Mark as taken (tried it, unavailable)'}
														aria-label={c.status === 'taken'
															? `Un-mark @${c.handle} as taken`
															: `Mark @${c.handle} as taken`}
														onclick={() => toggleCandidateTaken(c.handle)}
														>{#if c.status === 'taken'}<svg
																width="13"
																height="13"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
																aria-hidden="true"
																><path d="M9 14L4 9l5-5" /><path
																	d="M4 9h11a5 5 0 0 1 0 10h-4"
																/></svg
															>{:else}<svg
																width="13"
																height="13"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
																aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
															>{/if}</button
													>
													<button
														type="button"
														class="kit-use-btn"
														title="This one registered — record it as the {platformLabel(
															kitPlatform
														)} username"
														disabled={c.status === 'taken'}
														onclick={() => useCandidateFor(c.handle, kitPlatform)}>Use</button
													>
													<button
														type="button"
														class="kit-del-btn"
														title="Remove this candidate from the list"
														aria-label="Remove @{c.handle}"
														onclick={() => removeHandleCandidate(c.handle)}
														><svg
															width="13"
															height="13"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
															aria-hidden="true"
															><path
																d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h12"
															/></svg
														></button
													>
												</span>
											</div>
										{/each}
									</div>
								{/if}
								<div class="kit-inline kit-add-row">
									<input
										type="text"
										bind:value={newHandleInput}
										placeholder="add your own — e.g. jennytranglow"
										aria-label="Add a username candidate"
										onkeydown={(e) => e.key === 'Enter' && addOwnHandle()}
									/>
									<button type="button" class="btn-sync btn-xs" onclick={addOwnHandle}>+ Add</button
									>
								</div>
							</div>

							<div class="field-group col-span-2">
								<div class="label-row">
									<label for="kit-bio">Bio — per platform</label>
									<span class="kit-bio-controls">
										<select
											class="kit-select"
											bind:value={kitPlatform}
											aria-label="Platform for bio"
										>
											{#each BIO_PLATFORM_KEYS as k (k)}
												<option value={k}>{platformLabel(k)}</option>
											{/each}
										</select>
										<!-- Generates ONLY the selected platform's bio — a small, fast call
									     that can't clobber other platforms' bios. -->
										<button
											type="button"
											class="btn-sync btn-xs"
											onclick={() => generateKit('bio')}
											disabled={kitBusy}
											title="Generate the {platformLabel(
												kitPlatform
											)} bio only — other platforms' bios are untouched"
										>
											{#if generatingKitBio}Generating…{:else}<svg
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path
														d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
													/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
												>
												{ppBios[kitPlatform] ? 'Regenerate' : 'Generate'}
												{platformLabel(kitPlatform)} bio{/if}
										</button>
									</span>
								</div>
								<textarea
									id="kit-bio"
									rows="4"
									value={ppBios[kitPlatform] ?? ''}
									aria-describedby="kit-bio-count"
									aria-invalid={(ppBios[kitPlatform] ?? '').length >
										(bioLimit(kitPlatform) ?? Infinity)}
									oninput={(e) => {
										ppBios = { ...ppBios, [kitPlatform]: e.currentTarget.value };
										queueKitSave();
									}}
									placeholder={`No ${platformLabel(kitPlatform)} bio yet — generate one or write your own`}
								></textarea>
								<div class="kit-bio-meta">
									<span
										id="kit-bio-count"
										class="kit-bio-count tabular-nums"
										class:over={(ppBios[kitPlatform] ?? '').length >
											(bioLimit(kitPlatform) ?? Infinity)}
										aria-live="polite"
									>
										{(ppBios[kitPlatform] ?? '').length}/{bioLimit(kitPlatform)}
										{#if (ppBios[kitPlatform] ?? '').length > (bioLimit(kitPlatform) ?? Infinity)}
											— over {platformLabel(kitPlatform)}'s limit, trim before pasting
										{/if}
									</span>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={() =>
											copyKitText(ppBios[kitPlatform] ?? '', `${platformLabel(kitPlatform)} bio`)}
										disabled={!ppBios[kitPlatform]}
										><svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
											><rect x="9" y="9" width="12" height="12" rx="2" /><path
												d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
											/></svg
										> Copy bio</button
									>
								</div>
								<div class="kit-inline kit-confirmed-row">
									<span class="kit-at">@</span>
									<input
										type="text"
										value={ppConfirmedHandles[kitPlatform] ?? ''}
										oninput={(e) => setConfirmedHandle(kitPlatform, e.currentTarget.value)}
										placeholder="confirmed username on {platformLabel(kitPlatform)}"
										aria-label="Confirmed username on {platformLabel(kitPlatform)}"
									/>
									{#if platformStatuses[kitPlatform]?.connected && platformStatuses[kitPlatform]?.handle}
										<span
											class="kit-connected-chip"
											class:mismatch={!!ppConfirmedHandles[kitPlatform] &&
												sanitizeHandle(platformStatuses[kitPlatform].handle) !==
													ppConfirmedHandles[kitPlatform]}
											title="Live username from the connected account (Zernio sync)"
										>
											connected as @{platformStatuses[kitPlatform].handle}
										</span>
									{/if}
								</div>
								<p class="field-hint">
									Bio and username save automatically per platform as you type. The confirmed
									username is what you actually registered on {platformLabel(kitPlatform)}; once the
									account is connected, the live handle shows next to it as ground truth.
								</p>
							</div>
						</div>
					</details>

					<!-- Identity section -->
					<details class="profile-section">
						<summary class="section-summary">
							<div class="section-header">
								<h2 class="section-title">Character & Visuals</h2>
								<p class="section-desc">
									The persona's generated face and multi-angle reference kit, plus its personality,
									skills, and tools. Name, niche, and appearance now live in the Persona Profile
									above.
								</p>
							</div>
							<svg
								class="section-chevron"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
							>
						</summary>

						<div class="fields-grid">
							<div class="field-group col-span-2">
								<span class="field-label">Profile Picture</span>
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
										aria-label={characterRef ? 'Enlarge profile picture' : undefined}
										onclick={() =>
											characterRef &&
											openPreview(characterRef, 'Profile picture', requestGenerateAvatar)}
										onkeydown={(e) =>
											(e.key === 'Enter' || e.key === ' ') &&
											characterRef &&
											(e.preventDefault(),
											openPreview(characterRef, 'Profile picture', requestGenerateAvatar))}
									>
										{#if characterRef}
											<img src={characterRef} alt="" width="96" height="96" />
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
												<span class="spinner-sm" aria-hidden="true"></span> Generating…
											{:else}
												<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path
														d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
													/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
												>
												{characterRef ? 'Regenerate' : 'Generate'} Profile Picture
											{/if}
										</button>
										<label
											class="btn-sync file-upload-btn"
											class:disabled={generatingAvatar}
											aria-disabled={generatingAvatar}
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
												aria-hidden="true"
												><path
													d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
												/><circle cx="12" cy="13" r="3" /></svg
											>
											Upload Reference Photo
											<input
												type="file"
												accept="image/*"
												onchange={onReferenceFileChange}
												disabled={generatingAvatar}
												hidden
											/>
										</label>
										<button
											type="button"
											class="btn-sync"
											onclick={openRestore}
											disabled={generatingAvatar}
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
												aria-hidden="true"
												><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path
													d="M12 7v5l3 2"
												/></svg
											>
											Restore from history
										</button>
										{#if characterRef}
											<button
												type="button"
												class="btn-sync danger"
												onclick={() =>
													deleteAssets([
														{
															url: characterRef!,
															type: 'image',
															label: 'Profile picture',
															poster: null,
															source: 'avatar'
														}
													])}
												disabled={deletingAssets || generatingAvatar}
												title="Clear the profile picture — the image stays in your library and can be restored"
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
													aria-hidden="true"
													><path
														d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h12"
													/></svg
												>
												Remove photo
											</button>
										{:else}
											<p class="field-hint">
												No photo yet — falls back to the gradient below until generated.
											</p>
										{/if}
										<p class="field-hint">
											~{quote(NANO_IMAGE_USD)} per generation (Nano Banana 2 image call). Restore re-pins
											a past image free.
										</p>
									</div>
								</div>

								{#if referencePreviewUrl}
									<div class="reference-preview-row">
										<img
											src={referencePreviewUrl}
											alt="Reference upload preview"
											class="reference-preview-thumb"
											width="96"
											height="96"
										/>
										<div class="avatar-gen-actions">
											<button
												type="button"
												class="btn-generate"
												onclick={generateAvatarFromReference}
												disabled={generatingAvatar}
											>
												{#if generatingAvatar}
													<span class="spinner-sm" aria-hidden="true"></span> Generating (sheet + hero
													shot, ~30-60s)…
												{:else}
													<svg
														width="14"
														height="14"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"
														><path
															d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
														/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
													>
													Generate Character Sheet From This Photo
												{/if}
											</button>
											<button
												type="button"
												class="btn-clear-reference"
												onclick={clearReferenceFile}
												disabled={generatingAvatar}
											>
												Cancel
											</button>
											<p class="field-hint">
												Generates a full turnaround/reference sheet (multiple angles + detail
												close-ups) from this photo, then pins it as the profile picture. ~{quote(
													NANO_IMAGE_USD * 2
												)} (2 Nano Banana 2 calls).
											</p>
										</div>
									</div>
								{/if}
							</div>

							{#if referenceKit.full_body}
								<div class="field-group col-span-2">
									<div class="label-row">
										<span class="field-label">Reference Kit</span>
										{#if missingKitStages.length > 0}
											<button
												type="button"
												class="btn-sync btn-xs"
												onclick={() => generateAllKitStages(false)}
												disabled={generatingKitStage !== null || generatingAllKit}
											>
												{#if generatingAllKit}
													<span class="spinner-sm" aria-hidden="true"></span> Building kit…
												{:else}
													<svg
														width="13"
														height="13"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg
													>
													Generate all remaining ({missingKitStages.length})
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
													<span class="spinner-sm" aria-hidden="true"></span> Rebuilding kit…
												{:else}
													<svg
														width="13"
														height="13"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"
														><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg
													>
													Regenerate reference kit
												{/if}
											</button>
										{/if}
									</div>
									<p class="section-desc" style="margin-bottom: 0.75rem;">
										Each stage builds on the previous one — generate them in order (or use Generate
										all). Every stage can be regenerated independently — ~{quote(NANO_IMAGE_USD)} per
										stage (one Nano Banana 2 call).
										{#if generatingKitStage || generatingAllKit}
											Generating — takes a minute or two per stage.
										{/if}
									</p>
									<div class="kit-stage-row">
										{#if referenceKit.sheet}
											<!-- Stage 0: the turnaround/character sheet generated WITH the
										     profile picture — the hidden identity anchor behind stages 2-4.
										     View/restore only: a new sheet only comes from regenerating
										     the profile picture itself. -->
											<div class="kit-stage">
												<span class="kit-stage-label"
													>0. Character sheet <svg
														width="11"
														height="11"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="3"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg
													><span class="sr-only">(generated)</span></span
												>
												<img
													src={referenceKit.sheet}
													alt="Character turnaround sheet — click to enlarge"
													class="kit-stage-thumb clickable wide"
													width="200"
													height="120"
													loading="lazy"
													role="button"
													tabindex="0"
													onclick={() => openPreview(referenceKit.sheet, '0. Character sheet')}
													onkeydown={(e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault();
															openPreview(referenceKit.sheet, '0. Character sheet');
														}
													}}
												/>
												<div class="kit-stage-actions">
													<button
														type="button"
														class="btn-sync kit-stage-generate"
														onclick={() => openKitRestore('sheet')}
														disabled={generatingAvatar ||
															generatingKitStage !== null ||
															generatingAllKit}
														title="Restore a previous character sheet — from this stage's history or your image library"
													>
														<svg
															width="13"
															height="13"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
															aria-hidden="true"
															><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path
																d="M12 7v5l3 2"
															/></svg
														>
														Restore
													</button>
													<button
														type="button"
														class="btn-sync kit-stage-generate danger"
														onclick={() =>
															deleteAssets([
																{
																	url: referenceKit.sheet,
																	type: 'image',
																	label: '0. Character sheet',
																	poster: null,
																	source: 'kit',
																	stage: 'sheet'
																}
															])}
														disabled={deletingAssets ||
															generatingAvatar ||
															generatingKitStage !== null ||
															generatingAllKit}
														title="Remove this character sheet from the kit"
													>
														<svg
															width="13"
															height="13"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
															aria-hidden="true"
															><path
																d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h12"
															/></svg
														>
														Delete
													</button>
												</div>
												<span class="field-hint">Regenerates with the profile picture</span>
											</div>
										{/if}
										<div class="kit-stage">
											<span class="kit-stage-label"
												>1. Full body <svg
													width="11"
													height="11"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="3"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg
												><span class="sr-only">(generated)</span></span
											>
											<img
												src={referenceKit.full_body}
												alt="Full body reference — click to enlarge"
												class="kit-stage-thumb clickable"
												width="120"
												height="120"
												loading="lazy"
												role="button"
												tabindex="0"
												onclick={() =>
													openPreview(referenceKit.full_body, '1. Full body', () =>
														requestGenerateKitStage('full_body')
													)}
												onkeydown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														openPreview(referenceKit.full_body, '1. Full body', () =>
															requestGenerateKitStage('full_body')
														);
													}
												}}
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
													disabled={generatingKitStage !== null ||
														generatingAllKit ||
														generatingAvatar}
													title="Regenerate just the full-body shot from the profile picture — opens a composer to review and edit"
												>
													{#if generatingKitStage === 'full_body'}
														<span class="spinner-sm" aria-hidden="true"></span> Generating…
													{:else}
														<svg
															width="13"
															height="13"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
															aria-hidden="true"
															><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg
														>
														Regenerate
													{/if}
												</button>
												<button
													type="button"
													class="btn-sync kit-stage-generate"
													onclick={() => openKitRestore('full_body')}
													disabled={generatingAvatar ||
														generatingKitStage !== null ||
														generatingAllKit}
													title="Restore a previous full-body — from this stage's history or your image library"
												>
													<svg
														width="13"
														height="13"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"
														><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path
															d="M12 7v5l3 2"
														/></svg
													>
													Restore
												</button>
												<button
													type="button"
													class="btn-sync kit-stage-generate danger"
													onclick={() =>
														deleteAssets([
															{
																url: referenceKit.full_body,
																type: 'image',
																label: '1. Full body',
																poster: null,
																source: 'kit',
																stage: 'full_body'
															}
														])}
													disabled={deletingAssets ||
														generatingKitStage !== null ||
														generatingAllKit ||
														generatingAvatar}
													title="Remove this full-body reference from the kit"
												>
													<svg
														width="13"
														height="13"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"
														><path
															d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h12"
														/></svg
													>
													Delete
												</button>
											</div>
										</div>
										{#each [{ key: 'side_profiles' as const, n: 2, label: 'Side profiles', alt: 'Side profile composite', wide: true }, { key: 'face_closeup' as const, n: 3, label: 'Facial close-up', alt: 'Facial close-up', wide: false }, { key: 'feature_grid' as const, n: 4, label: 'Feature grid', alt: 'Feature grid', wide: false }] as st (st.key)}
											{@const blocked = kitStageBlockedReason(st.key)}
											<div class="kit-stage">
												<span class="kit-stage-label"
													>{st.n}. {st.label}{#if referenceKit[st.key]}
														<svg
															width="11"
															height="11"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="3"
															stroke-linecap="round"
															stroke-linejoin="round"
															aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg
														><span class="sr-only">(generated)</span>{/if}</span
												>
												{#if referenceKit[st.key]}
													<img
														src={referenceKit[st.key]}
														alt="{st.alt} — click to enlarge"
														class="kit-stage-thumb clickable{st.wide ? ' wide' : ''}"
														width={st.wide ? 200 : 120}
														height="120"
														loading="lazy"
														role="button"
														tabindex="0"
														onclick={() =>
															openPreview(referenceKit[st.key], st.label, () =>
																requestGenerateKitStage(st.key)
															)}
														onkeydown={(e) => {
															if (e.key === 'Enter' || e.key === ' ') {
																e.preventDefault();
																openPreview(referenceKit[st.key], st.label, () =>
																	requestGenerateKitStage(st.key)
																);
															}
														}}
													/>
												{/if}
												<div class="kit-stage-actions">
													<button
														type="button"
														class="btn-sync kit-stage-generate"
														onclick={() => requestGenerateKitStage(st.key)}
														disabled={generatingKitStage !== null ||
															generatingAllKit ||
															blocked !== null}
														title={blocked ?? undefined}
													>
														{#if generatingKitStage === st.key}
															<span class="spinner-sm" aria-hidden="true"></span> Generating…
														{:else if referenceKit[st.key]}
															<svg
																width="13"
																height="13"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
																aria-hidden="true"
																><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg
															>
															Regenerate
														{:else}
															Generate
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
															<svg
																width="13"
																height="13"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
																aria-hidden="true"
																><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path
																	d="M12 7v5l3 2"
																/></svg
															>
															Restore
														</button>
														<button
															type="button"
															class="btn-sync kit-stage-generate danger"
															onclick={() =>
																deleteAssets([
																	{
																		url: referenceKit[st.key],
																		type: 'image',
																		label: st.label,
																		poster: null,
																		source: 'kit',
																		stage: st.key
																	}
																])}
															disabled={deletingAssets ||
																generatingKitStage !== null ||
																generatingAllKit}
															title="Remove this {st.label.toLowerCase()} from the kit"
														>
															<svg
																width="13"
																height="13"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
																aria-hidden="true"
																><path
																	d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h12"
																/></svg
															>
															Delete
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
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={enrichSoul}
										disabled={enrichingSoul}
									>
										{#if enrichingSoul}Enriching…{:else}<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path
													d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
												/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
											> AI Enrich{/if}
									</button>
								</div>
								<textarea
									id="p-soul"
									bind:value={soulText}
									rows="6"
									placeholder="Define your persona's personality, voice, and behavioral directives…"
								></textarea>
							</div>

							<div class="field-group col-span-2">
								<div class="label-row">
									<span class="field-label">Skills &amp; Capabilities</span>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={() => (editingSkill = { id: `s${Date.now()}`, name: '', md: '' })}
										>+ Add skill</button
									>
								</div>
								{#if skillsList.length === 0}
									<p class="field-hint">
										No skills defined yet — each skill is a markdown playbook the persona follows.
									</p>
								{:else}
									<div class="item-chips">
										{#each skillsList as s (s.id)}
											<span class="item-chip-wrap">
												<button
													type="button"
													class="item-chip"
													onclick={() => (editingSkill = { ...s })}
												>
													<svg
														width="13"
														height="13"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"
														><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path
															d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
														/></svg
													>
													{s.name}
												</button>
												<!-- Row-level delete: previously you had to open the editor to remove one. -->
												<button
													type="button"
													class="item-chip-del"
													title="Delete skill"
													aria-label="Delete skill {s.name}"
													onclick={() =>
														void confirmAction({
															title: `Delete the skill "${s.name}"?`,
															body: 'The persona stops using it on new posts.',
															confirmLabel: 'Delete skill',
															tone: 'caution'
														}).then((ok) => ok && deleteSkill(s.id))}
													><svg
														width="11"
														height="11"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2.5"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
													></button
												>
											</span>
										{/each}
									</div>
								{/if}
							</div>

							<div class="field-group col-span-2">
								<div class="label-row">
									<span class="field-label">Tools &amp; Integrations</span>
									<button
										type="button"
										class="btn-sync btn-xs"
										onclick={() =>
											(editingTool = {
												id: `t${Date.now()}`,
												kind: 'posting',
												label: '',
												config: ''
											})}>+ Add integration</button
									>
								</div>
								{#if toolsList.length === 0}
									<p class="field-hint">
										Connect intents — posting targets, analytics, MCP servers, API calls this
										persona uses.
									</p>
								{:else}
									<div class="item-chips">
										{#each toolsList as t (t.id)}
											<span class="item-chip-wrap">
												<button
													type="button"
													class="item-chip"
													onclick={() => (editingTool = { ...t })}
												>
													<svg
														width="13"
														height="13"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"
														><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path
															d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"
														/></svg
													>
													{t.label} <span class="chip-kind">{t.kind}</span>
												</button>
												<button
													type="button"
													class="item-chip-del"
													title="Delete integration"
													aria-label="Delete integration {t.label}"
													onclick={() =>
														void confirmAction({
															title: `Delete the integration "${t.label}"?`,
															body: 'The persona loses access to it on new posts.',
															confirmLabel: 'Delete integration',
															tone: 'caution'
														}).then((ok) => ok && deleteTool(t.id))}
													><svg
														width="11"
														height="11"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2.5"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
													></button
												>
											</span>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</details>

					{#if editingSkill}
						<div
							class="gen-confirm-overlay"
							role="dialog"
							aria-modal="true"
							aria-label="Edit skill"
							tabindex="-1"
							use:dialog={{ onClose: () => (editingSkill = null) }}
						>
							<div class="gen-confirm editor-modal">
								<h3>
									{skillsList.some((s) => s.id === editingSkill?.id) ? 'Edit skill' : 'New skill'}
								</h3>
								<div class="field-group">
									<label for="skill-name">Skill name</label>
									<input
										id="skill-name"
										type="text"
										bind:value={editingSkill.name}
										placeholder="e.g. Hook writing for Reels"
									/>
								</div>
								<div class="field-group">
									<label for="skill-md">Playbook (markdown)</label>
									<textarea
										id="skill-md"
										class="mono"
										rows="12"
										bind:value={editingSkill.md}
										placeholder="## When to use&#10;- …&#10;&#10;## Steps&#10;1. …"
									></textarea>
								</div>
								<div class="gc-actions">
									{#if skillsList.some((s) => s.id === editingSkill?.id)}
										<button
											type="button"
											class="btn-danger-ghost"
											onclick={() => deleteSkill(editingSkill!.id)}>Delete</button
										>
									{/if}
									<button type="button" class="btn-sync" onclick={() => (editingSkill = null)}
										>Cancel</button
									>
									<button type="button" class="btn-generate" onclick={saveSkill}>Save skill</button>
								</div>
							</div>
						</div>
					{/if}

					{#if editingTool}
						<div
							class="gen-confirm-overlay"
							role="dialog"
							aria-modal="true"
							aria-label="Edit integration"
							tabindex="-1"
							use:dialog={{ onClose: () => (editingTool = null) }}
						>
							<div class="gen-confirm editor-modal">
								<h3>
									{toolsList.some((t) => t.id === editingTool?.id)
										? 'Edit integration'
										: 'New integration'}
								</h3>
								<div class="field-group">
									<label for="tool-kind">Type</label>
									<select id="tool-kind" bind:value={editingTool.kind}>
										{#each TOOL_KINDS as k}<option value={k}>{k}</option>{/each}
									</select>
								</div>
								<div class="field-group">
									<label for="tool-label">Label</label>
									<input
										id="tool-label"
										type="text"
										bind:value={editingTool.label}
										placeholder="e.g. Instagram via Zernio, Analytics webhook"
									/>
								</div>
								<div class="field-group">
									<label for="tool-config">Configuration / intent</label>
									<textarea
										id="tool-config"
										class="mono"
										rows="8"
										bind:value={editingTool.config}
										placeholder={'{ "endpoint": "…", "notes": "what this persona uses it for" }'}
									></textarea>
								</div>
								<div class="gc-actions">
									{#if toolsList.some((t) => t.id === editingTool?.id)}
										<button
											type="button"
											class="btn-danger-ghost"
											onclick={() => deleteTool(editingTool!.id)}>Delete</button
										>
									{/if}
									<button type="button" class="btn-sync" onclick={() => (editingTool = null)}
										>Cancel</button
									>
									<button type="button" class="btn-generate" onclick={saveTool}
										>Save integration</button
									>
								</div>
							</div>
						</div>
					{/if}

					<!-- Persona Profile section -->
					<!-- Automation section -->
					<details class="profile-section">
						<summary class="section-summary">
							<div class="section-header">
								<h2 class="section-title">Automation</h2>
								<p class="section-desc">Posting schedule and content sourcing mode.</p>
							</div>
							<svg
								class="section-chevron"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
							>
						</summary>

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
											<option value={v.name}
												>{v.label} · {v.gender === 'male' ? '♂' : '♀'}{v.accent
													? ` · ${v.accent}`
													: ''} · {v.style}</option
											>
										{:else}
											<option value={selectedVoice}>{selectedVoice}</option>
										{/each}
									</select>
									<button
										type="button"
										class="btn-sync"
										onclick={previewVoice}
										disabled={previewingVoice}
									>
										{#if previewingVoice}Playing…{:else}<svg
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="currentColor"
												aria-hidden="true"><path d="M8 5v14l11-7z" /></svg
											> Preview{/if}
									</button>
								</div>
								<p class="field-hint">
									The video's spoken voice — pin one that matches this persona's on-camera
									character.
									{#if ppVoiceProfile?.nationality || ppVoiceProfile?.accent}
										Inferred from the name: {[
											ppVoiceProfile.nationality,
											ppVoiceProfile.accent && `${ppVoiceProfile.accent} accent`
										]
											.filter(Boolean)
											.join(' · ')}.
									{/if}
								</p>
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
									<option
										value="semi_autonomous"
										disabled={semiBlocked !== null}
										title={semiBlocked ?? undefined}
									>
										Semi — drafts for review{semiBlocked ? ' — not in your plan' : ''}
									</option>
									<option
										value="fully_autonomous"
										disabled={fullyBlocked !== null}
										title={fullyBlocked ?? undefined}
									>
										Fully — publishes unattended{fullyBlocked ? ' — not in your plan' : ''}
									</option>
								</select>
								<p class="field-hint">
									{#if autonomyLevel === 'fully_autonomous'}
										Publishing without review — drop back to Semi if quality slips.
									{:else if graduationEligible}
										<svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
											><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path
												d="M22 4L12 14.01l-3-3"
											/></svg
										>
										Eligible to graduate: {countLabel(publishedCleanCount, 'clean published post')}.
										Switch to Fully when confident.
									{:else}
										Ready for Fully at ~21 clean published posts — you make the switch; it never
										happens on its own ({publishedCleanCount} so far, {countLabel(recentFailedCount, 'recent failure')}).
									{/if}
								</p>
								{#if fullyBlocked}
									<p class="field-hint">{fullyBlocked} <a href="/billing">Compare plans</a></p>
								{/if}
							</div>

							<div class="field-group col-span-2">
								<span class="field-label" id="content-source-label">Content Source</span>
								<div class="source-cards" role="group" aria-labelledby="content-source-label">
									<button
										type="button"
										class="autonomy-card"
										class:selected={!rssActive}
										aria-pressed={!rssActive}
										onclick={() => (rssActive = false)}
									>
										<div class="autonomy-radio" aria-hidden="true">
											<div class="radio-outer">
												{#if !rssActive}<div class="radio-inner"></div>{/if}
											</div>
										</div>
										<span class="autonomy-icon"
											><svg
												width="16"
												height="16"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path
													d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z"
												/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" /></svg
											></span
										>
										<span class="autonomy-label">Dynamic Generation</span>
										<p class="autonomy-desc">
											Original content from niche, trends, and persona directives.
										</p>
									</button>
									<button
										type="button"
										class="autonomy-card"
										class:selected={rssActive}
										aria-pressed={rssActive}
										onclick={() => (rssActive = true)}
									>
										<div class="autonomy-radio" aria-hidden="true">
											<div class="radio-outer">
												{#if rssActive}<div class="radio-inner"></div>{/if}
											</div>
										</div>
										<span class="autonomy-icon"
											><svg
												width="16"
												height="16"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path
													d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"
												/><path d="M18 14h-8" /><path d="M15 18h-5" /><path
													d="M10 6h8v4h-8V6Z"
												/></svg
											></span
										>
										<span class="autonomy-label">RSS Auto-Repurpose</span>
										<p class="autonomy-desc">
											Monitor an RSS feed and spin items in the persona's voice.
										</p>
									</button>
								</div>
								{#if rssActive}
									<div style="margin-top: 1rem;" transition:slide={{ duration: 250 }}>
										<label class="field-label" for="p-rss-url">RSS feed URL</label>
										<input
											id="p-rss-url"
											type="url"
											class="field-input"
											placeholder="https://example.com/feed.xml"
											autocomplete="url"
											bind:value={rssUrl}
											style="width: 100%; margin-bottom: 0.5rem;"
										/>
										<p class="field-hint">
											Last polled: {rssLastPolledAt
												? new Date(rssLastPolledAt).toLocaleString()
												: 'Never'}
										</p>
									</div>
								{/if}
							</div>
						</div>
					</details>

					<!-- Spend & Pricing section — manager seats and above only. -->
					{#if !seat.canSeeSpend}
						<div class="profile-section seat-locked" role="status">
							<div class="section-header">
								<h2 class="section-title">Spend &amp; Pricing</h2>
								<p class="section-desc">
									{seatBlockedReason(seat, 'manager')}
								</p>
							</div>
						</div>
					{:else}
					<details class="profile-section">
						<summary class="section-summary">
							<div class="section-header">
								<h2 class="section-title">Spend &amp; Pricing</h2>
								<p class="section-desc">
									What this persona's generations {metered ? 'have cost you' : 'would cost you'},
									split by provider — plus the rate card behind the numbers. Every figure here is
									what you pay, in your own currency, not what the provider bills us.
								</p>
							</div>
							<svg
								class="section-chevron"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
							>
						</summary>

						{#if agentSpend && agentSpend.total > 0}
							<div class="spend-chips">
								<div class="spend-chip spend-total">
									<span class="spend-label">Total</span>
									<span class="spend-val tabular-nums">{quote(agentSpend.total)}</span>
								</div>
								{#each Object.entries(agentSpend.byProvider) as [prov, amt]}
									<div class="spend-chip">
										<span class="spend-label">{prov}</span>
										<span class="spend-val tabular-nums">{quote(amt)}</span>
									</div>
								{/each}
								{#each Object.entries(agentSpend.byOperation) as [op, amt]}
									<div class="spend-chip spend-op">
										<span class="spend-label">{op}</span>
										<span class="spend-val tabular-nums">{quote(amt)}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="field-hint">
								No tracked generation spend yet — the ledger starts recording with the next
								generation.
							</p>
						{/if}

						<details class="pricing-details">
							<summary>Rate card (estimated {metered ? 'charge' : 'cost'} per call)</summary>
							<div class="pricing-table-wrap">
								<table class="pricing-table">
									<thead
										><tr><th>Provider</th><th>Operation</th><th>Model</th><th>Your rate</th></tr
										></thead
									>
									<tbody>
										{#each PRICING_MATRIX as row}
											<tr>
												<td>{row.provider}</td>
												<td>{row.operation}</td>
												<td>{row.model}</td>
												<!-- Quoted, like the totals above — a rate card that itemised provider
												     cost under a retail total would never add up. Rows priced per-account
												     rather than per-call carry a note instead of a number. -->
												<td class="tabular-nums">{row.note ?? quote(row.usd)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</details>
					</details>
					{/if}

					<!-- Save + Danger zone -->
					<div class="profile-footer">
						<button type="button" class="btn-save" onclick={() => saveProfile()} disabled={saving}>
							{#if saving}<span class="spinner-sm" aria-hidden="true"></span> Saving…{:else}Save
								Profile{/if}
						</button>
					</div>

					<div class="danger-zone">
						<h3>Danger Zone</h3>
						<p>Permanently delete this persona and all associated data. This cannot be undone.</p>
						<!-- Owner only: deleting a persona outright stays with the workspace owner
						     (seat.ts). Disabled with the reason, never a 403 after the click. -->
						<button
							type="button"
							class="btn-danger"
							disabled={!seat.canDeletePersona}
							title={seatBlockedReason(seat, 'owner') ?? undefined}
							onclick={deleteAgent}>Delete Persona</button
						>
					</div>
				</div>

				<!-- PROFILE TAB · Connections lens -->
			{:else if activeTab === 'profile' && profileView === 'connections'}
				<div class="connections-tab">
					{#if statusLoading}
						<div class="feed-loading" role="status" aria-live="polite">
							<span class="spinner-lg" aria-hidden="true"></span>
							<p>Checking connections…</p>
						</div>
					{:else}
						<!-- Summary bar -->
						<div class="conn-summary">
							<span class="conn-count-badge tabular-nums"
								>{computedMetrics.connectedCount} / {PLATFORMS.length}</span
							>
							<span class="conn-count-label">Active connections</span>
							<div class="conn-quick-links">
								{#each PLATFORMS as p}
									{#if !platformStatuses[p.key]?.connected}
										<!-- Every platform connects the same way: a Zernio hosted-OAuth
									     link filed under this persona's profile. -->
										<button
											type="button"
											class="btn-connect-inline"
											disabled={connectingPlatform === p.key || !seat.canManageConnections}
											title={seatBlockedReason(seat, 'manager') ?? `Connect ${p.name} via Zernio`}
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
								<div
									class="meter-track"
									role="img"
									aria-label="{countLabel(
										accountMeter.total,
										'account'
									)} connected, {accountMeter.freeUsed} of 2 free used"
								>
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
										<span class="meter-good"
											>{accountMeter.freeRemaining} free {plural(
												accountMeter.freeRemaining,
												'slot'
											)} left</span
										>
									{:else}
										<span class="meter-bill"
											><strong>${accountMeter.monthlyCostUsd}</strong>/mo · {accountMeter.billable} billable</span
										>
									{/if}
								</div>
								<p class="meter-note">
									{#if accountMeter.freeRemaining > 0}
										Your first 2 connected accounts are free. The next account adds
										<strong>${accountMeter.nextAccountCostUsd}/mo</strong>.
									{:else}
										Each additional account is
										<strong>${accountMeter.nextAccountCostUsd}/mo</strong>. Manage billing on your
										<a
											href={connectHub?.url ?? 'https://zernio.com/dashboard'}
											target="_blank"
											rel="noopener">Zernio dashboard</a
										>
										— or add another Zernio key in the
										<a href="/settings#zernio-keys">Key Manager</a> (every key is a separate Zernio account
										with 2 more free slots).
									{/if}
									{#if !accountMeter.hasAnalyticsAccess}
										<br /><span class="meter-warn"
											>Live follower &amp; engagement stats need analytics enabled on your Zernio
											key.</span
										>
									{/if}
								</p>
							</div>
						{/if}

						{#if computedMetrics.connectedCount === 0}
							<div class="conn-empty">
								<span
									><svg
										width="28"
										height="28"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path
											d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"
										/></svg
									></span
								>
								<p>No platforms connected. Use the buttons above to link your first account.</p>
							</div>
						{:else}
							<div class="platforms-grid">
								{#each PLATFORMS.filter((p) => platformStatuses[p.key]?.connected) as platform}
									{@const status = platformStatuses[platform.key]}
									<div class="platform-card" style="--platform-color: {platform.color}">
										<div class="platform-card-header">
											<!-- Platform icon -->
											<div class="platform-icon">
												{#if platform.key === 'tiktok'}
													<svg
														width="22"
														height="22"
														viewBox="0 0 24 24"
														fill="none"
														aria-hidden="true"
														><path
															d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.89a8.1 8.1 0 004.77 1.54V7.01a4.85 4.85 0 01-1-.32z"
															fill={platform.color}
														/></svg
													>
												{:else if platform.key === 'instagram'}
													<svg
														width="22"
														height="22"
														viewBox="0 0 24 24"
														fill="none"
														aria-hidden="true"
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
													<svg
														width="22"
														height="22"
														viewBox="0 0 24 24"
														fill="none"
														aria-hidden="true"
														><path
															d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29.94 29.94 0 001 12a29.94 29.94 0 00.46 5.58 2.78 2.78 0 001.94 2C5.12 20 12 20 12 20s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29.94 29.94 0 0023 12a29.94 29.94 0 00-.46-5.58z"
															fill={platform.color}
														/><path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="#fff" /></svg
													>
												{:else if platform.key === 'facebook'}
													<svg
														width="22"
														height="22"
														viewBox="0 0 24 24"
														fill="none"
														aria-hidden="true"
														><path
															d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.875V12h3.328l-.532 3.47h-2.796v8.384C19.612 22.954 24 17.99 24 12z"
															fill={platform.color}
														/></svg
													>
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
												aria-expanded={!collapsedPlatforms[platform.key]}
												aria-label="{collapsedPlatforms[platform.key]
													? 'Show'
													: 'Hide'} {platform.name} details"
												onclick={() =>
													(collapsedPlatforms[platform.key] = !collapsedPlatforms[platform.key])}
												style="transform: rotate({collapsedPlatforms[platform.key]
													? '180deg'
													: '0deg'})"
											>
												<svg
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg
												>
											</button>
										</div>

										{#if !collapsedPlatforms[platform.key]}
											<div class="platform-body" transition:slide={{ duration: 200 }}>
												<div class="handle-row">
													{#if platformProfileUrl(platform.key, status?.handle)}
														<a
															class="platform-handle platform-handle-link"
															href={platformProfileUrl(platform.key, status?.handle)}
															target="_blank"
															rel="noopener noreferrer"
															title="Open {platform.name} profile in a new tab">{status?.handle}</a
														>
													{:else}
														<span class="platform-handle">{status?.handle ?? '@connected'}</span>
													{/if}
													{#if status?.verified}
														<svg
															width="14"
															height="14"
															viewBox="0 0 24 24"
															fill="none"
															stroke="var(--cyan)"
															stroke-width="2"
															role="img"
															aria-label="Verified account"
															><path
																d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 12c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
															/></svg
														>
													{/if}
													{#if status?.handle}
														{@const isMain = agent.handle === status.handle}
														<button
															type="button"
															class="btn-star"
															title={isMain ? 'Main handle' : 'Set as main handle'}
															aria-label={isMain
																? `@${status.handle} is the main handle`
																: `Set @${status.handle} as the main handle`}
															aria-pressed={isMain}
															onclick={() => setMainHandle(status.handle!)}
														>
															<svg
																width="14"
																height="14"
																viewBox="0 0 24 24"
																fill={isMain ? 'var(--warning)' : 'none'}
																stroke={isMain ? 'var(--warning)' : 'var(--text-dim)'}
																stroke-width="2"
																stroke-linecap="round"
																stroke-linejoin="round"
																aria-hidden="true"
																><polygon
																	points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
																/></svg
															>
														</button>
													{/if}
												</div>
												<span class="last-sync">Last sync: {formatSyncTime(status?.lastSync)}</span>
												{#if (status?.followers ?? 0) > 0 || (status?.engagement_rate ?? 0) > 0}
													<div class="platform-stats">
														{#if status?.followers}
															<span class="stat-badge tabular-nums"
																><svg
																	width="11"
																	height="11"
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="2"
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	aria-hidden="true"
																	><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle
																		cx="9"
																		cy="7"
																		r="4"
																	/><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path
																		d="M16 3.13a4 4 0 0 1 0 7.75"
																	/></svg
																>
																{status.followers >= 1000
																	? (status.followers / 1000).toFixed(1) + 'K'
																	: status.followers} followers</span
															>
														{/if}
														{#if status?.engagement_rate}
															<span class="stat-badge tabular-nums"
																><svg
																	width="11"
																	height="11"
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="2"
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	aria-hidden="true"
																	><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg
																>
																{status.engagement_rate}% eng</span
															>
														{/if}
													</div>
												{/if}
												<button
													type="button"
													class="btn-disconnect"
													aria-label="Disconnect {platform.name}"
													disabled={!seat.canManageConnections}
													title={seatBlockedReason(seat, 'manager') ?? undefined}
													onclick={() => disconnectPlatform(platform.key)}
												>
													<svg
														width="12"
														height="12"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														aria-hidden="true"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg
													>
													Disconnect
												</button>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						<AgentConnectionStats {platformStatuses} {platformMetrics} platforms={PLATFORMS} />
					{/if}
				</div>

				<!-- STUDIO TAB — template gallery. Every card is a prefilled composer
		     request; nothing generates without the same confirm-before-spend
		     approval every other generate action gets. -->
			{:else if activeTab === 'studio'}
				<div class="studio-tab">
					<div class="studio-head">
						<div>
							<h2 class="studio-title">Studio</h2>
							<p class="studio-sub">
								Pick an archetype — the scaffold opens prefilled with an editable topic and scene,
								already aimed at {agent.name}'s voice and the applied brand brief. For bulk
								generation across a week or a month, plan a campaign.
							</p>
							<p class="studio-payer">
								{#if agent.workspace_id && data.credits?.paid_by}
									Generating here draws on <strong>{data.credits.paid_by}</strong>'s wallet — the
									balance in the sidebar, funded by the workspace owner.
								{:else if data.credits?.paid_by}
									This persona is yours alone, so generating here draws on
									<strong>your own wallet</strong> — not the {data.credits.paid_by} balance shown
									in the sidebar.
								{:else}
									Generating here draws on <strong>your wallet</strong> — the balance in the sidebar.
								{/if}
								<a href="/billing">What costs what</a>
							</p>
						</div>
						<div class="studio-head-actions">
							<button
								type="button"
								class="studio-campaign-btn"
								title="Bulk-generate a content mix onto the calendar — drafts for your review"
								disabled={!hydrated}
								onclick={() => goto('/calendar?campaign=1')}
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
									aria-hidden="true"
									><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path
										d="M8 2v4"
									/><path d="M3 10h18" /><path d="M8 14h.01" /><path d="M12 14h.01" /><path
										d="M16 14h.01"
									/></svg
								>
								Plan a campaign
							</button>
							<div
								class="studio-deliver"
								role="radiogroup"
								aria-label="Output destination"
								aria-describedby="studio-deliver-hint"
							>
								<span class="studio-deliver-label" id="studio-deliver-label">Output</span>
								<button
									type="button"
									class="view-toggle-btn"
									role="radio"
									aria-checked={studioDeliver === 'review'}
									class:active={studioDeliver === 'review'}
									disabled={!hydrated}
									onclick={() => (studioDeliver = 'review')}
								>
									Review draft
								</button>
								<button
									type="button"
									class="view-toggle-btn"
									role="radio"
									aria-checked={studioDeliver === 'asset'}
									class:active={studioDeliver === 'asset'}
									disabled={!hydrated}
									onclick={() => (studioDeliver = 'asset')}
								>
									Asset only
								</button>
							</div>
							<!-- The control states its own consequence — the destination is the
					     toggle's entire meaning, so it lives ON the control, not in prose
					     three lines away. Delivered posts wear a matching chip. -->
							<p class="studio-deliver-hint" id="studio-deliver-hint" aria-live="polite">
								{#if studioDeliver === 'asset'}
									→ Saved to <strong>Content → Assets</strong> with an <strong>asset</strong> chip. Skips
									the review queue entirely.
								{:else}
									→ Lands in the <strong>Review Queue</strong> as a draft on this persona; publishes only
									after you approve it.
								{/if}
							</p>
						</div>
					</div>
					<!-- Format filter: the axis a user actually thinks in (text / photo /
				     video / cinematic), replacing the old genre chips. -->
					<div class="feed-view-toggle studio-cats" role="group" aria-label="Output format">
						<button
							type="button"
							class="view-toggle-btn"
							class:active={studioSurface === 'all'}
							aria-pressed={studioSurface === 'all'}
							onclick={() => (studioSurface = 'all')}
						>
							All formats
						</button>
						{#each STUDIO_SURFACES as s (s.id)}
							<button
								type="button"
								class="view-toggle-btn"
								class:active={studioSurface === s.id}
								aria-pressed={studioSurface === s.id}
								title={s.hint}
								onclick={() => (studioSurface = s.id)}
							>
								{s.label}
							</button>
						{/each}
					</div>

					<!-- Intent split: channel content leads because it IS the job — a real
				     account is ~80% this. Brand promos sit below, clearly labelled, so
				     the healthy shape of an account is readable from the layout itself. -->
					{#each [['channel', 'Channel content', 'The ~80% — what the account is followed for between promos'], ['brand', 'Brand & product', 'The ~20% — promos, spaced out so they land']] as [intent, heading, hint] (intent)}
						{#if studioShelves(intent as StudioIntent).length > 0}
							<section class="studio-intent studio-intent-{intent}" aria-label={heading}>
								<div class="studio-intent-head">
									<h3 class="studio-intent-title">{heading}</h3>
									<span class="studio-intent-hint">{hint}</span>
								</div>
								{#each studioShelves(intent as StudioIntent) as [shelf, list] (shelf.id)}
									<div class="studio-shelf">
										<div class="studio-shelf-head">
											<span class="studio-shelf-label">{shelf.label}</span>
											<span class="studio-shelf-hint">{shelf.hint}</span>
										</div>
										<div class="studio-rail" role="list">
											{#each list as t (t.id)}
												{@const preview = studioPreviews.get(t.id)}
												{@const meta = PIPELINE_META[t.pipeline]}
												{@const pipelineUsd = PIPELINE_USD[t.pipeline]}
												<div class="studio-tile studio-sf-{t.surface}" role="listitem">
													<!-- The tile's face is the OUTPUT: a real prior generation
												     when one exists, else the template's sample line styled
												     like the asset it produces — never a blank card. -->
													<div class="studio-face">
														{#if t.framing === 'selfie'}
															<!-- The realism register a social feed runs on — flagged so
														     the selfie share of the catalog is visible at a glance. -->
															<span class="studio-framing">Front-cam</span>
														{/if}
														{#if preview}
															<img
																class="studio-face-img"
																src={preview.url}
																alt="Your latest {t.title} generation"
																loading="lazy"
															/>
															{#if t.surface === 'motion' || t.surface === 'cinematic'}
																<span class="studio-play" aria-hidden="true">
																	<svg
																		width="22"
																		height="22"
																		viewBox="0 0 24 24"
																		fill="currentColor"
																		aria-hidden="true"><path d="M8 5v14l11-7z" /></svg
																	>
																</span>
															{/if}
															<span class="studio-tried">Yours</span>
														{:else if t.surface === 'typographic'}
															<!-- The preview is a REAL render from the $0 card pipeline —
														     what you browse is what a generation produces. Falls back
														     to the styled sample line when the host can't render. -->
															{#if !studioCardUnavailable.has(t.id)}
																<img
																	class="studio-face-img"
																	src="/api/studio/card-sample/{t.id}/{studioSample(t).idx}"
																	alt="Sample {t.title} card, rendered by the free card pipeline"
																	loading="lazy"
																	onerror={() => markStudioCardUnavailable(t.id)}
																/>
															{:else}
																<span class="studio-face-quote">{studioSample(t).text}</span>
															{/if}
														{:else}
															<span class="studio-face-sample">
																{#if t.surface === 'motion' || t.surface === 'cinematic'}
																	<svg
																		width="20"
																		height="20"
																		viewBox="0 0 24 24"
																		fill="none"
																		stroke="currentColor"
																		stroke-width="1.6"
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		aria-hidden="true"
																		><rect x="2" y="5" width="14" height="14" rx="2" /><path
																			d="M22 8l-6 4 6 4V8z"
																		/></svg
																	>
																{:else}
																	<svg
																		width="20"
																		height="20"
																		viewBox="0 0 24 24"
																		fill="none"
																		stroke="currentColor"
																		stroke-width="1.6"
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		aria-hidden="true"
																		><rect x="3" y="3" width="18" height="18" rx="2" /><circle
																			cx="8.5"
																			cy="8.5"
																			r="1.5"
																		/><path d="M21 15l-5-5L5 21" /></svg
																	>
																{/if}
																<em>{studioSample(t).text}</em>
															</span>
														{/if}
													</div>
													<div class="studio-tile-body">
														<div class="studio-tile-top">
															<h4 class="studio-tile-title">{t.title}</h4>
															<span class="studio-format studio-fmt-{t.surface}">
																{t.surface === 'typographic'
																	? 'TEXT'
																	: t.surface === 'photo'
																		? 'IMAGE'
																		: 'VIDEO'}
															</span>
														</div>
														<p class="studio-tile-tag">{t.tagline}</p>
														<div class="studio-tile-meta">
															<!-- PIPELINE_META.usd is the raw provider string ("~$0.81"); this tile
															     is a pre-spend decision, so it quotes PIPELINE_USD — which now
															     includes the writing every post pays for — through quote(), the
															     same path as the charge itself. No format is free: a text card is
															     the cheapest by an order of magnitude, and it still costs. -->
															<span
																class="studio-cost"
																title={metered
																	? t.pipeline === 'Text card'
																		? 'Estimated charge for this generation — no media, only the writing, charged to your balance'
																		: 'Estimated charge for this generation, writing included'
																	: 'Estimated generation cost, writing included'}
																>{quote(pipelineUsd)}</span
															>
															<span class="studio-time" title="Typical generation time"
																>{meta.time}</span
															>
															<button
																type="button"
																class="btn-generate studio-use"
																disabled={generatingPost ||
																	!hydrated ||
																	(t.baseBody?.media === 'cinematic' && cinematicBlocked !== null)}
																title={t.baseBody?.media === 'cinematic'
																	? (cinematicBlocked ?? undefined)
																	: undefined}
																onclick={() => useStudioTemplate(t)}
															>
																Use
															</button>
														</div>
													</div>
												</div>
											{/each}
										</div>
									</div>
								{/each}
							</section>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Post drawer + delete notice + media lightbox live at PAGE level, not inside a
     tab branch. They used to be mounted only inside the Feed branch, so the
     Calendar lens set `modalPost` on click and nothing appeared — the drawer
     didn't exist in that subtree. Any tab can now open a post. -->
	<PostDrawer
		post={modalPost}
		onClose={() => (modalPost = null)}
		onDelete={handleDeletePost}
		onApprove={handleApprovePost}
		onSaveText={handleSaveText}
		onRefined={(p) => {
			modalPost = p;
			void loadFeed();
		}}
		{characterRef}
		onPublishFallback={(p) => {
			modalPost = null;
			openPublishFallback(p);
		}}
		onPostNow={postNow}
		posting={postingNowId === modalPost?.id}
		approving={approvingPostId === modalPost?.id}
		deleting={deletingPostId === modalPost?.id}
	/>
	{#if manualDeleteNotice}
		<ManualDeleteNotice entries={manualDeleteNotice} onClose={() => (manualDeleteNotice = null)} />
	{/if}
	<ImageLightbox
		url={postMediaLightbox?.url ?? null}
		label={postMediaLightbox?.label ?? ''}
		poster={postMediaLightbox?.poster ?? null}
		onClose={() => (postMediaLightbox = null)}
	/>

	<!-- Confirm-before-generate: resolves the REAL payload server-side, shows it
     editable, and only runs what the user approved. Used by every generate action. -->
	<GenerationComposer
		open={composerOpen}
		spec={composerSpec}
		{cinematicBlocked}
		autonomyLevel={savedAutonomy}
		onClose={() => (composerOpen = false)}
		onConfirm={(body) => onComposerConfirm(body)}
		onGoToConnections={() => {
			composerOpen = false;
			activeTab = 'profile';
			profileView = 'connections';
		}}
	/>

	<!-- Confirm-before-spend for the autopilot draft top-up — it generates one post per
     empty review slot, so it must be approved like every other generate action. -->
	{#if confirmDraftsOpen}
		<div class="lightbox-backdrop" onclick={() => (confirmDraftsOpen = false)} role="presentation">
			<div
				class="confirm-card"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Generate drafts"
				tabindex="-1"
				use:dialog={{ onClose: () => (confirmDraftsOpen = false) }}
			>
				<h3>Generate drafts for {agent?.name}?</h3>
				<p>
					This fills the empty upcoming slots in the review queue with autopilot drafts — about
					<strong>{postsPerDay}/day</strong> across active hours — and spends one generation
					<strong>per draft</strong>. Nothing publishes: each lands in the
					<a href="/review">review queue</a> for your approval.
				</p>
				<div class="confirm-actions">
					<button type="button" class="btn-cancel" onclick={() => (confirmDraftsOpen = false)}
						>Cancel</button
					>
					<button type="button" class="btn-generate" onclick={fillDraftsNow}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path
								d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
							/></svg
						>
						Generate drafts
					</button>
				</div>
			</div>
		</div>
	{/if}

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
			<div
				class="lightbox-content"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label={assetLightbox.label}
				tabindex="-1"
				use:dialog={{ onClose: () => (assetLightbox = null) }}
			>
				{#if assetLightbox.type === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={assetLightbox.url}
						poster={assetLightbox.poster || undefined}
						controls
						playsinline
						use:playOnMount
					></video>
				{:else}
					<img src={assetLightbox.url} alt={assetLightbox.label} width="920" height="920" />
				{/if}
				<div class="lightbox-bar">
					<span>{assetLightbox.label}</span>
					<a href={assetLightbox.url} target="_blank" rel="noopener noreferrer"
						>Open original<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path
								d="M15 3h6v6"
							/><path d="M10 14L21 3" /></svg
						><span class="sr-only">(opens in a new tab)</span></a
					>
					<button type="button" onclick={() => (assetLightbox = null)}>Close</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Reference-kit / profile-picture preview is rendered by <MediaPreviewModal>
     above. A second hand-rolled lightbox used to live here bound to the same
     previewOpen flag, so both mounted at once — two stacked dialogs for one
     click. MediaPreviewModal already carries Open original + Regenerate, so the
     duplicate was removed rather than the shared component. -->

	<!-- Restore-from-history picker: every past generated image, click to re-pin
     as this persona's profile picture. Nothing here is ever deleted. -->
	{#if restoreOpen}
		<div class="lightbox-backdrop" onclick={() => (restoreOpen = false)} role="presentation">
			<div
				class="restore-modal"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Restore profile picture"
				tabindex="-1"
				use:dialog={{ onClose: () => (restoreOpen = false) }}
			>
				<div class="restore-head">
					<div>
						<h3>Restore a profile picture</h3>
						<p>
							Every image ever generated for your account — click one to make it {agent?.name}'s
							face. Nothing is deleted.
						</p>
					</div>
					<button
						type="button"
						class="restore-close"
						onclick={() => (restoreOpen = false)}
						aria-label="Close"
						><svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
						></button
					>
				</div>
				{#if restoreLoading}
					<div class="feed-loading" role="status" aria-live="polite">
						<span class="spinner" aria-hidden="true"></span> Loading your image history…
					</div>
				{:else if restoreImages.length === 0}
					<p class="field-hint" style="padding: 2rem; text-align: center;">
						No stored images found yet.
					</p>
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
								<img src={img.url} loading="lazy" width="200" height="200" alt="Generated image" />
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
			<div
				class="restore-modal"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Restore reference-kit stage"
				tabindex="-1"
				use:dialog={{ onClose: () => (kitRestoreStage = null) }}
			>
				<div class="restore-head">
					<div>
						<h3>Restore {KIT_STAGE_RESTORE_LABELS[kitRestoreStage] ?? kitRestoreStage}</h3>
						<p>
							Re-pin a past image for this stage — from {agent?.name}'s past
							{(KIT_STAGE_RESTORE_LABELS[kitRestoreStage] ?? kitRestoreStage).toLowerCase()} generations,
							or from your full image library. Nothing is deleted.
						</p>
					</div>
					<button
						type="button"
						class="restore-close"
						onclick={() => (kitRestoreStage = null)}
						aria-label="Close"
						><svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
						></button
					>
				</div>
				<div class="restore-tabs" role="group" aria-label="Restore source">
					<button
						type="button"
						class="restore-tab"
						class:on={kitRestoreMode === 'stage'}
						aria-pressed={kitRestoreMode === 'stage'}
						onclick={() => setKitRestoreMode('stage')}
						>This stage ({kitRestoreImages.length})</button
					>
					<button
						type="button"
						class="restore-tab"
						class:on={kitRestoreMode === 'all'}
						aria-pressed={kitRestoreMode === 'all'}
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
								<div class="restore-cell">
									<button
										type="button"
										class="restore-tile"
										class:current={url === referenceKit[kitRestoreStage]}
										onclick={() => restoreKitStage(url)}
										disabled={kitRestoringUrl !== null}
									>
										<img src={url} loading="lazy" width="200" height="200" alt="Past generation" />
										{#if url === referenceKit[kitRestoreStage]}
											<span class="restore-badge">Current</span>
										{:else if kitRestoringUrl === url}
											<span class="restore-badge">Restoring…</span>
										{/if}
									</button>
									<!-- Prune a past generation you never want offered again. -->
									<button
										type="button"
										class="restore-del"
										title="Remove from this stage's history"
										aria-label="Remove this photo from history"
										disabled={kitRestoringUrl !== null}
										onclick={() => kitRestoreStage && deleteKitHistoryImage(kitRestoreStage, url)}
									>
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
										>
									</button>
								</div>
							{/each}
						</div>
					{/if}
				{:else if kitRestoreLoadingAll}
					<div class="feed-loading" role="status" aria-live="polite">
						<span class="spinner" aria-hidden="true"></span> Loading your image library…
					</div>
				{:else if kitRestoreAll.length === 0}
					<p class="field-hint" style="padding: 2rem; text-align: center;">
						No stored images found yet.
					</p>
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
								<img src={img.url} loading="lazy" width="200" height="200" alt="Library image" />
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
				aria-modal="true"
				aria-label="Publish to a connected platform"
				tabindex="-1"
				use:dialog={{ onClose: () => (publishFallbackPost = null) }}
			>
				<div class="restore-head">
					<div>
						<h3>Publish to a connected platform</h3>
						<p>
							This post's media is ready — only publishing failed. Pick where to send it. Only
							connected, compatible platforms are shown, and nothing auto-retries.
						</p>
					</div>
					<button
						type="button"
						class="restore-close"
						onclick={() => (publishFallbackPost = null)}
						aria-label="Close"
						><svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
						></button
					>
				</div>
				{#if publishFallbackLoading}
					<div class="feed-loading" role="status" aria-live="polite">
						<span class="spinner" aria-hidden="true"></span> Checking your connections…
					</div>
				{:else if publishFallbackOptions.length === 0}
					<div class="pubfb-empty">
						<p>No connected account can accept this post yet — connect a platform first.</p>
						<button
							type="button"
							class="btn-sync"
							onclick={() => {
								publishFallbackPost = null;
								activeTab = 'profile';
								profileView = 'connections';
							}}
							>Go to Connections <svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg
							></button
						>
					</div>
				{:else}
					<div class="pubfb-chips">
						{#each publishFallbackOptions as p}
							<button
								type="button"
								class="pubfb-chip"
								class:on={publishFallbackSelected.includes(p)}
								aria-pressed={publishFallbackSelected.includes(p)}
								onclick={() => togglePublishFallback(p)}>{p}</button
							>
						{/each}
					</div>
					<div class="pubfb-actions">
						<button
							type="button"
							class="btn-primary-cta"
							disabled={publishFallbackPublishing || publishFallbackSelected.length === 0 || !seat.canPublish}
							title={seatBlockedReason(seat, 'manager') ?? undefined}
							onclick={confirmPublishFallback}
						>
							{#if publishFallbackPublishing}
								<span class="spinner-sm" aria-hidden="true"></span> Publishing…
							{:else}
								Publish now
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</PageShell>
{/if}

<style>
	/* ── Restore-from-history modal ── */
	.restore-modal {
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		width: min(920px, 94vw);
		max-height: 86dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		z-index: var(--z-overlay);
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
		/* Visual dot stays small; the tap target is a full 44×44 (§2). */
		width: 30px;
		height: 30px;
		border-radius: 999px;
		cursor: pointer;
		flex-shrink: 0;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.restore-close::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
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
		min-height: 44px;
	}
	.restore-tab.on {
		background: var(--accent-mid);
		border-color: var(--accent);
		color: var(--text);
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
		transition:
			border-color 0.15s ease,
			transform 0.15s ease;
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
		transition:
			background 0.15s,
			border-color 0.15s;
		min-height: 44px;
	}
	.pubfb-chip.on {
		background: var(--accent-mid);
		border-color: var(--accent);
		color: var(--text);
	}
	.pubfb-actions {
		display: flex;
		justify-content: flex-end;
	}
	.btn-primary-cta {
		background: var(--gradient-cta);
		border: 1px solid transparent;
		color: #fff;
		border-radius: 10px;
		padding: 0.55rem 1.1rem;
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 44px;
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

	/* ── Page ──
	   Was capped at 900px, which on a wide monitor left the whole profile as a
	   narrow column stranded in the middle with ~800px of nothing either side.
	   It now fills the portal content area in BOTH views. Readability is
	   protected where it actually matters — the prose measure below — rather
	   than by starving the whole page of width. */
	/* ── Feed view toggle (Posts | Assets) ── */
	.feed-view-toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}

	/* Same switcher, rendered above the Profile lenses (outside any toolbar). */
	.profile-lens {
		margin-bottom: var(--space-4);
	}

	/* ── Studio tab ─────────────────────────────────────────────── */
	.studio-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
		margin-bottom: var(--space-4);
	}
	.studio-deliver {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		background: var(--surface);
		flex-shrink: 0;
	}
	.studio-head-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
		max-width: 340px;
	}
	.studio-campaign-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.studio-campaign-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.studio-deliver-hint {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-dim);
		text-align: right;
	}
	.studio-deliver-hint strong {
		color: var(--text);
		font-weight: 600;
	}
	@media (max-width: 720px) {
		.studio-head-actions {
			align-items: flex-start;
			max-width: none;
		}
		.studio-deliver-hint {
			text-align: left;
		}
	}
	.studio-deliver-label {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-dim);
		padding: 0 var(--space-1);
	}
	.studio-title {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		margin-bottom: var(--space-1);
	}
	.studio-sub {
		color: var(--muted);
		font-size: 0.85rem;
		max-width: 62ch;
		line-height: 1.55;
	}
	.studio-cats {
		margin-bottom: var(--space-5);
	}

	/* ── Intent sections: channel (the 80%) leads, brand (the 20%) follows ── */
	.studio-intent {
		margin-bottom: var(--space-6);
	}
	.studio-intent-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-bottom: var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border);
	}
	.studio-intent-title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
	}
	.studio-intent-hint {
		color: var(--text-dim);
		font-size: 0.78rem;
	}
	.studio-intent-brand .studio-intent-title {
		color: var(--gold);
	}

	/* ── Shelves: one row per output format, horizontally scrollable ── */
	.studio-shelf {
		margin-bottom: var(--space-4);
	}
	.studio-shelf-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.studio-shelf-label {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--accent-text);
	}
	.studio-shelf-hint {
		color: var(--text-dim);
		font-size: 0.74rem;
	}
	.studio-rail {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 236px;
		gap: var(--space-3);
		overflow-x: auto;
		padding-bottom: var(--space-2);
		scroll-snap-type: x proximity;
		/* Rail scrolls inside itself — the page must never pan sideways. */
		max-width: 100%;
	}
	.studio-rail::-webkit-scrollbar {
		height: 6px;
	}
	.studio-rail::-webkit-scrollbar-thumb {
		background: var(--border-strong);
		border-radius: var(--radius-full);
	}

	/* ── Tiles: the face IS the output ── */
	.studio-tile {
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		scroll-snap-align: start;
		transition:
			border-color 0.15s ease,
			transform 0.15s ease;
	}
	.studio-tile:hover {
		border-color: var(--accent-mid);
		transform: translateY(-2px);
	}
	.studio-face {
		position: relative;
		height: 132px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
		background: var(--surface-2);
	}
	/* Typographic tiles render their sample AS the asset — type on a brand field. */
	.studio-sf-typographic .studio-face {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent) 14%, var(--surface-2)),
			color-mix(in srgb, var(--cyan) 10%, var(--surface-2))
		);
	}
	.studio-face-quote {
		font-family: var(--font-display);
		font-size: 0.95rem;
		line-height: 1.35;
		text-align: center;
		color: var(--text);
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.studio-face-sample {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		text-align: center;
		color: var(--text-dim);
		font-size: 0.78rem;
		line-height: 1.4;
	}
	.studio-face-sample em {
		font-style: italic;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.studio-face-img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.studio-play {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, #000 45%, transparent);
		color: #fff;
	}
	.studio-framing {
		position: absolute;
		top: var(--space-2);
		left: var(--space-2);
		z-index: 1;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--accent-text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		padding: 2px 7px;
	}
	.studio-tried {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 1;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--success-text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		padding: 2px 8px;
	}
	.studio-tile-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		flex: 1;
	}
	.studio-tile-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.studio-tile-title {
		font-family: var(--font-display);
		font-size: var(--text-base);
	}
	/* Format badge: TEXT / IMAGE / VIDEO — colour + label, never colour alone. */
	.studio-format {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		border-radius: var(--radius-full);
		padding: 2px 7px;
		flex-shrink: 0;
	}
	.studio-fmt-typographic {
		color: var(--accent-text);
		background: var(--accent-soft);
	}
	.studio-fmt-photo {
		color: var(--success-text);
		background: var(--success-soft);
	}
	.studio-fmt-motion,
	.studio-fmt-cinematic {
		color: var(--rose-text);
		background: var(--rose-soft);
	}
	.studio-tile-tag {
		color: var(--muted);
		font-size: 0.76rem;
		line-height: 1.4;
		flex: 1;
	}
	.studio-tile-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.studio-payer {
		margin: var(--space-3) 0 0;
		max-width: 62ch;
		font-size: var(--text-base);
		line-height: var(--leading-normal);
		color: var(--text-muted);
	}
	.studio-payer a {
		color: var(--accent-text);
	}
	.studio-cost,
	.studio-time {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-dim);
	}
	.studio-use {
		margin-left: auto;
		min-height: 36px;
		padding-block: 0.35rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.studio-tile {
			transition: none;
		}
	}

	.view-toggle-btn {
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		min-height: 44px;
	}

	.view-toggle-btn.active {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	/* Pre-hydration (and mid-generation) gate: a dimmed control with a progress
	   cursor, instead of a live-looking button that silently eats the click. */
	.view-toggle-btn:disabled,
	.studio-campaign-btn:disabled {
		opacity: 0.55;
		cursor: progress;
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

	/* ── Asset management overlays (select + delete) ── */
	.asset-cell {
		position: relative;
		display: block;
	}
	.asset-cell .asset-tile {
		width: 100%;
	}
	.asset-cell.selected .asset-tile {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent) inset;
	}
	.asset-select {
		position: absolute;
		top: 6px;
		left: 6px;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		background: rgba(12, 16, 30, 0.72);
		backdrop-filter: blur(4px);
		cursor: pointer;
	}
	/* Chip stays 24px; the tap target underneath is a full 44×44 (§2). */
	.asset-select::after,
	.asset-del::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}
	.asset-select input {
		width: 14px;
		height: 14px;
		margin: 0;
		cursor: pointer;
		accent-color: var(--accent);
	}
	.asset-del {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 3;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(12, 16, 30, 0.72);
		backdrop-filter: blur(4px);
		color: #fff;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.asset-cell:hover .asset-del,
	.asset-cell:focus-within .asset-del,
	.asset-cell.selected .asset-del {
		opacity: 1;
	}
	.asset-del:hover:not(:disabled) {
		border-color: var(--error);
		color: color-mix(in srgb, var(--error) 55%, #fff);
	}
	.asset-del:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	/* Destructive variant of the kit/avatar action buttons. */
	.btn-sync.danger:not(:disabled) {
		color: var(--error-text);
		border-color: color-mix(in srgb, var(--error) 40%, transparent);
	}
	.btn-sync.danger:hover:not(:disabled) {
		border-color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	/* Restore-picker tiles get a prune (close) control. */
	.restore-cell {
		position: relative;
	}
	.restore-cell .restore-tile {
		width: 100%;
	}
	.restore-del {
		position: absolute;
		top: 4px;
		right: 4px;
		z-index: 3;
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(12, 16, 30, 0.75);
		color: #fff;
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s ease;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	/* Chip stays 22px; the tap target underneath is a full 44×44 (§2). */
	.restore-del::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}
	.restore-cell:hover .restore-del,
	.restore-cell:focus-within .restore-del {
		opacity: 1;
	}
	.restore-del:hover:not(:disabled) {
		border-color: var(--error);
		color: color-mix(in srgb, var(--error) 55%, #fff);
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
		transition:
			border-color 0.15s ease,
			transform 0.15s ease;
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
		z-index: var(--z-modal);
		padding: 1.5rem;
	}

	.confirm-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 1.4rem 1.5rem;
		max-width: min(440px, 94vw);
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
	}
	.confirm-card h3 {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
		color: var(--text);
	}
	.confirm-card p {
		margin: 0 0 1.2rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--muted);
	}
	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}
	.btn-cancel {
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 8px;
		padding: 0.55rem 1rem;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
	}

	.lightbox-content {
		max-width: min(920px, 94vw);
		max-height: 90dvh;
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
		max-height: calc(90dvh - 52px);
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
		color: var(--accent-text);
		text-decoration: none;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 44px;
	}

	.lightbox-bar button {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text-muted);
		padding: 0.3rem 0.8rem;
		font-size: 0.72rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 44px;
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
		/* opacity + transform are driven per-scroll-frame (see updateHeroFade) —
		   hint the compositor so the fade stays smooth. */
		will-change: opacity, transform;
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
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
		border: 3px solid var(--surface);
	}

	/* Avatar images double as enlarge triggers — reset the button chrome so they
	   look identical to the non-clickable variant, just with a pointer + zoom hint. */
	.hero-avatar-btn,
	.tab-nav-avatar-btn {
		padding: 0;
		background: none;
		font: inherit;
		cursor: zoom-in;
	}

	/* The 26px nav avatar keeps its size; its tap target reaches 44×44 (§2). */
	.tab-nav-avatar-btn {
		position: relative;
	}
	.tab-nav-avatar-btn::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
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

	.hero-fav-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	/* 44px tap area without growing the 30px chip. */
	.hero-fav-btn::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		min-width: 44px;
		min-height: 44px;
	}

	.hero-fav-btn:hover:not(:disabled) {
		color: var(--rose, #e84393);
		border-color: color-mix(in srgb, var(--rose, #e84393) 45%, transparent);
		transform: scale(1.08);
	}

	.hero-fav-btn.faved {
		color: var(--rose, #e84393);
		border-color: color-mix(in srgb, var(--rose, #e84393) 50%, transparent);
		background: color-mix(in srgb, var(--rose, #e84393) 10%, transparent);
	}

	.hero-fav-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.hero-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		color: var(--text-muted);
		flex-wrap: wrap;
	}

	.hero-sep {
		color: var(--border-strong);
	}
	.hero-niche {
		color: var(--accent-text);
		font-weight: 600;
	}

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
		border-color: color-mix(in srgb, var(--warning) 35%, transparent);
		background: color-mix(in srgb, var(--warning) 6%, transparent);
	}

	.stat-chip-spend .stat-val {
		color: var(--warning-text);
	}

	/* Queued = drafts + scheduled, not yet published — muted so it reads as pending. */
	.stat-chip-queued .stat-val {
		color: var(--muted);
	}

	.stat-val {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
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
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 44px;
	}
	.age-chip:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}
	.age-chip.selected {
		background: var(--accent-mid);
		border-color: var(--accent-mid);
		color: var(--text);
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

	.age-slider-group input[type='range'] {
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
		z-index: var(--z-header);
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
		color: var(--accent-text);
		font-weight: 600;
	}

	.tab-badge {
		/* Darkened so the white count stays AA-legible on the light-mode green too. */
		background: color-mix(in srgb, var(--success) 80%, #000);
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		border-radius: 999px;
		padding: 1px 6px;
		min-width: 18px;
		text-align: center;
	}

	/* ── Feed ── */
	.feed-tab {
	}

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
		align-items: center;
		gap: 0.5rem;
	}

	/* Quiet-but-present alert: errors are hidden by default, so this is the only
	   signal they exist. Click jumps to the Failed filter. */
	.filter-alert {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.42rem 0.7rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--error) 45%, transparent);
		background: color-mix(in srgb, var(--error) 12%, transparent);
		color: var(--error-text);
		font-size: 0.78rem;
		font-weight: 600;
		font-family: var(--font-body);
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s ease;
		min-height: 44px;
	}
	.filter-alert:hover {
		background: color-mix(in srgb, var(--error) 20%, transparent);
	}
	.filter-alert-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--error);
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--error) 60%, transparent);
		animation: filter-alert-pulse 2s ease-out infinite;
	}
	@keyframes filter-alert-pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--error) 55%, transparent);
		}
		70% {
			box-shadow: 0 0 0 6px color-mix(in srgb, var(--error) 0%, transparent);
		}
		100% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--error) 0%, transparent);
		}
	}

	.filter-select {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.45rem 0.75rem;
		color: var(--text);
		/* 1rem keeps iOS from force-zooming when the select is focused (§8). */
		font-size: 1rem;
		font-family: var(--font-body);
		cursor: pointer;
		outline: none;
		min-height: 44px;
	}

	.feed-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-generate {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--gradient-cta);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
		min-height: 44px;
	}

	.btn-generate:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}
	.btn-generate:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

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
		min-height: 44px;
	}

	.btn-sync:hover:not(:disabled) {
		border-color: var(--accent-mid);
		color: var(--text);
	}
	.btn-sync:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.feed-empty-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.feed-loading,
	.feed-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		color: var(--text-dim);
		text-align: center;
		gap: 0.75rem;
	}

	.feed-empty .empty-icon {
		color: var(--text-dim);
		line-height: 0;
	}
	.feed-empty h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		margin: 0;
	}
	.feed-empty p {
		font-size: 0.82rem;
		max-width: 340px;
		margin: 0;
	}

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

	/* ── Bento: OPTIONAL alternate placement of the same six sections ───────
	   Uses multi-column, not grid, and that choice is the whole trick.

	   CSS Grid cannot do masonry. Its rows are uniform, so a short tile beside a
	   tall one parks at the top of the row (align-items:start) and leaves the
	   rest of that row empty underneath it — measured at up to 1676px of dead
	   space with these sections. `grid-auto-flow: dense` does not help: it
	   backfills empty CELLS, never the slack inside an occupied row. Since these
	   tiles collapse and expand constantly, every grid arrangement is wrong in
	   some state.

	   Multi-column packs items vertically and reflows as heights change, so no
	   collapse combination can leave a void. The cost is reading order: columns
	   run top-to-bottom then across, rather than left-to-right. For six
	   independent cards that is a fair trade for never showing a hole. */
	.profile-tab.bento {
		display: block;
		column-count: 3;
		column-gap: 1.25rem;
	}

	.profile-tab.bento .profile-section {
		/* Keep a card whole — without this a section can be split down the middle
		   across two columns. */
		break-inside: avoid;
		-webkit-column-break-inside: avoid;
		width: 100%;
		margin: 0 0 1.25rem;
	}

	@media (max-width: 1500px) {
		.profile-tab.bento {
			column-count: 2;
		}
	}

	@media (max-width: 1100px) {
		.profile-tab.bento {
			column-count: 1;
		}
	}

	.layout-switch {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 36px;
		padding: 0.4rem 0.75rem;
		margin-left: 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full, 999px);
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.layout-switch:hover {
		color: var(--text);
		border-color: var(--border-hover);
	}

	.layout-switch.on {
		background: var(--accent-soft);
		border-color: var(--accent-mid, var(--accent));
		color: var(--accent);
	}

	.layout-switch:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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

	/* Collapsible sections: each .profile-section is a <details>; the summary is
	   the always-visible header + a chevron, the body shows only when open. All
	   inputs keep working — <details> just hides the subtree, it doesn't unmount. */
	.section-summary {
		list-style: none;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		cursor: pointer;
		margin-bottom: 0;
	}
	.section-summary::-webkit-details-marker {
		display: none;
	}
	.section-summary > .section-header {
		margin-bottom: 0;
		flex: 1;
		min-width: 0;
	}
	/* Restore the header→body gap only when the section is actually open. */
	.profile-section[open] > .section-summary {
		margin-bottom: 1.5rem;
	}
	.section-chevron {
		flex-shrink: 0;
		margin-top: 0.15rem;
		color: var(--text-dim);
		transition: transform 0.2s ease;
	}
	.profile-section[open] > .section-summary .section-chevron {
		transform: rotate(180deg);
	}
	.section-summary:hover .section-chevron {
		color: var(--text);
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
		/* The old 900px page cap kept these readable by accident. Now that the
		   page fills the screen, cap the text itself — a description running the
		   full width of a 2560px monitor is unreadable however wide the card is. */
		max-width: 90ch;
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

	.col-span-2 {
		grid-column: span 2;
	}

	/* `.field-label` is the same treatment for group captions that have no single
	   control to point a <label for> at (chip groups, media pickers, chip lists). */
	.field-group label,
	.field-group .field-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}

	.field-group input[type='text'],
	.field-group input[type='url'],
	.field-group select,
	.field-input,
	.field-group textarea {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.7rem 0.9rem;
		color: var(--text);
		font-family: var(--font-body);
		/* 1rem minimum — anything smaller makes iOS Safari zoom on focus (§8). */
		font-size: 1rem;
		outline: none;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
	}

	.field-group input:focus,
	.field-group select:focus,
	.field-group textarea:focus,
	.field-input:focus {
		border-color: var(--accent-mid);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.field-group [aria-invalid='true'] {
		border-color: var(--error);
	}

	.field-group textarea {
		resize: vertical;
	}

	.field-hint {
		font-size: 0.72rem;
		color: var(--text-dim);
		margin: 0;
	}

	/* Brand-kit selector + inline apply button. */
	.brand-kit-row {
		display: flex;
		gap: 0.5rem;
		align-items: stretch;
	}

	.brand-kit-row select {
		flex: 1;
		min-width: 0;
	}

	.btn-apply-brand {
		flex-shrink: 0;
		white-space: nowrap;
		padding: 0 1rem;
	}

	.btn-apply-brand:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.brand-dirty-hint {
		color: var(--accent-text);
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
		color: var(--accent-text);
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
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
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
		transition:
			border-color 0.15s ease,
			transform 0.15s ease;
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
		gap: 0.35rem;
		text-align: center;
		font-size: 0.75rem;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		color: var(--text-muted);
		transition:
			border-color 0.15s,
			color 0.15s;
		min-height: 44px;
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
		transition:
			transform 0.15s ease,
			border-color 0.15s ease,
			box-shadow 0.15s ease;
		outline: none;
	}

	.gradient-swatch.selected {
		border-color: var(--accent);
		box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 40%, transparent);
	}

	.gradient-swatch:hover {
		transform: scale(1.1);
	}

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

	.slider-row input[type='range'] {
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

	.autonomy-cards,
	.source-cards {
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

	.autonomy-radio {
		grid-column: 1;
		grid-row: 1 / 3;
		align-self: center;
	}

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

	.autonomy-card.selected .radio-outer {
		border-color: var(--accent);
	}

	.radio-inner {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
	}

	.autonomy-icon {
		grid-column: 2;
		grid-row: 1;
		display: inline-flex;
		align-items: center;
		color: var(--text-muted);
	}
	.autonomy-label {
		grid-column: 3;
		grid-row: 1;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
	}
	.autonomy-desc {
		grid-column: 2 / 4;
		grid-row: 2;
		font-size: 0.75rem;
		color: var(--text-dim);
		margin: 0;
		line-height: 1.4;
	}

	/* ── Confirm + editor modals / structured skills & tools ── */
	.gen-confirm-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: var(--z-modal);
		padding: 1rem;
	}
	.gen-confirm {
		width: min(480px, 100%);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 1.25rem 1.4rem;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
		max-height: 90dvh;
		overflow-y: auto;
	}
	.gen-confirm h3 {
		margin: 0 0 0.9rem;
	}
	.editor-modal {
		width: min(620px, 100%);
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.gc-rows {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		margin-bottom: 1rem;
	}
	.gc-row {
		display: flex;
		gap: 0.75rem;
		font-size: var(--text-sm);
	}
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
	.gc-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}
	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.4rem;
	}
	/* Dense inline action buttons: the pill stays compact, but a centred 44×44
	   pseudo-element gives it a real tap target (§2). */
	.btn-xs {
		padding: 0.3rem 0.7rem;
		font-size: var(--text-xs);
		position: relative;
		min-height: 0;
		gap: 0.3rem;
	}
	.btn-xs::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 44px;
		transform: translateY(-50%);
	}
	.item-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.item-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.85rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: border-color 0.15s ease;
		min-height: 44px;
	}
	.item-chip:hover {
		border-color: var(--accent-mid);
	}
	.chip-kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 1px 6px;
	}
	.editor-modal .mono {
		font-family: var(--font-mono, monospace);
		font-size: 1rem;
	}
	.opt {
		font-weight: 400;
		color: var(--text-dim);
		font-size: var(--text-xs);
	}
	.composer-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.9rem;
	}
	/* Inside the generate/editor modal these paired fields hit ~150px each on a
	   phone — stack them. */
	@media (max-width: 640px) {
		.composer-grid-2 {
			grid-template-columns: 1fr;
		}
	}
	.composer-advanced summary {
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin: 0.25rem 0 0.75rem;
	}
	.composer-advanced .field-group {
		margin-bottom: 0.75rem;
	}
	.btn-danger-ghost {
		margin-right: auto;
		padding: 0.5rem 0.9rem;
		border-radius: 9px;
		border: 1px solid var(--danger);
		color: var(--error-text);
		background: transparent;
		font-size: var(--text-sm);
		cursor: pointer;
		min-height: 44px;
	}

	/* A section this seat may not open: same frame, no disclosure affordance,
	   and copy that names the seat instead of showing an empty panel. */
	.seat-locked {
		padding: var(--space-5);
		opacity: 0.85;
	}
	.seat-locked .section-desc {
		margin-top: var(--space-2);
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
		border: 1px solid var(--border);
		min-width: 84px;
	}
	.spend-chip.spend-total {
		border-color: var(--accent-mid);
	}
	.spend-chip.spend-op {
		opacity: 0.75;
	}
	.spend-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
	}
	.spend-val {
		font-family: var(--font-mono, monospace);
		font-weight: 700;
		font-size: var(--text-sm);
	}
	.pricing-details summary {
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin-bottom: 0.5rem;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.pricing-table-wrap {
		overflow-x: auto;
	}
	.pricing-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-xs);
	}
	.pricing-table th,
	.pricing-table td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--border);
	}
	.pricing-table th {
		color: var(--text-dim);
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
		background: var(--gradient-cta);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.65rem 1.5rem;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s ease;
		min-height: 44px;
	}

	.btn-save:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.danger-zone {
		background: color-mix(in srgb, var(--danger) 4%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
		border-radius: var(--radius-md);
		padding: 1.25rem 1.5rem;
	}

	.danger-zone h3 {
		color: var(--error-text);
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
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		color: var(--error-text);
		border-radius: var(--radius-sm);
		padding: 0.6rem 1.1rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 44px;
	}

	.btn-danger:hover {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		border-color: color-mix(in srgb, var(--danger) 50%, transparent);
	}

	/* ── Connections ── */
	.connections-tab {
	}

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
		color: var(--accent-text);
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
		border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
		background: color-mix(in srgb, var(--warning) 5%, var(--surface));
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
		background: var(--surface-2);
		border: 1px solid var(--border);
	}
	.meter-pip.filled.free {
		background: var(--success);
		border-color: var(--success);
	}
	.meter-pip.filled.billable {
		background: var(--warning);
		border-color: var(--warning);
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
		font-variant-numeric: tabular-nums;
	}
	.meter-stats strong {
		color: var(--text);
	}
	.meter-good {
		color: var(--success-text);
		font-weight: 600;
	}
	.meter-bill strong {
		color: var(--warning-text);
	}
	.meter-note {
		font-size: 0.74rem;
		color: var(--text-muted);
		margin: 0.5rem 0 0;
		line-height: 1.5;
	}
	.meter-note a {
		color: var(--accent-text);
		text-decoration: underline;
	}
	.meter-warn {
		color: var(--warning-text);
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
		position: relative;
	}
	/* Compact pill, full-size tap target (§2). */
	.btn-connect-inline::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 44px;
		transform: translateY(-50%);
	}

	.btn-connect-inline:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent-text);
		background: var(--accent-soft);
	}

	.btn-connect-inline:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

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

	.conn-empty span {
		display: inline-flex;
		line-height: 0;
	}

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
		background: rgba(255, 255, 255, 0.04);
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

	.conn-badge.error {
		color: var(--error-text);
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
	}
	.conn-badge.warn {
		color: var(--warning-text);
		background: color-mix(in srgb, var(--warning) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
	}

	.btn-collapse {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		padding: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			color 0.15s ease,
			transform 0.2s ease;
		min-width: 44px;
		min-height: 44px;
	}

	.btn-collapse:hover {
		color: var(--text);
	}

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

	/* Connected handles link out to the live profile. Keep the resting look
	   identical to the plain span, reveal affordance (accent + underline) on hover. */
	.platform-handle-link {
		text-decoration: none;
		transition: color 0.15s ease;
		cursor: pointer;
	}

	.platform-handle-link:hover {
		color: var(--accent-text);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.platform-handle-link:focus-visible {
		outline: 2px solid var(--accent-mid);
		outline-offset: 2px;
		border-radius: 4px;
	}

	.btn-star {
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.15s ease;
		min-width: 44px;
		min-height: 44px;
	}

	.btn-star:hover {
		transform: scale(1.2);
	}

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
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 11px;
		background: var(--surface-2);
		color: var(--text-dim);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid var(--border);
		font-weight: 500;
	}

	.btn-disconnect {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--error-text);
		background: color-mix(in srgb, var(--error) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
		border-radius: 6px;
		padding: 0.35rem 0.75rem;
		cursor: pointer;
		transition: all 0.15s ease;
		align-self: flex-start;
		margin-top: 0.25rem;
		min-height: 44px;
	}

	.btn-disconnect:hover {
		background: color-mix(in srgb, var(--error) 12%, transparent);
		border-color: color-mix(in srgb, var(--error) 45%, transparent);
	}

	/* ── Spinners ── */
	.spinner-sm {
		display: inline-block;
		width: 12px;
		height: 12px;
		/* currentColor so the spinner is visible in BOTH the white-on-gradient
		   buttons and the muted-on-surface ones (it was invisible in the latter). */
		border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
		border-top-color: currentColor;
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

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--gradient-cta);
		color: #fff;
		padding: 0.65rem 1.5rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.88rem;
		text-decoration: none;
		margin-top: 1rem;
		min-height: 44px;
	}

	/* ── Platform Identity Kit ── */
	/* Hero strip: one compact row under the identity — select · bio · copy · handle. */
	.hero-identity {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 1.5rem;
		border-top: 1px solid var(--border);
		background: var(--bg);
	}

	.kit-select {
		flex-shrink: 0;
		/* The page's base field styles stretch selects to 100% — the kit picker is
		   an inline control, not a form field. */
		width: auto;
		max-width: 220px;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.35rem 0.6rem;
		/* 1rem minimum — anything smaller makes iOS Safari zoom on focus (§8). */
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
	}

	.hero-bio {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-muted);
		/* Bios can be long (YouTube allows 1000 chars) — clamp; full text lives in the Profile tab. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: pre-line;
	}

	.hero-bio-empty {
		font-style: italic;
		color: var(--text-dim);
	}

	.kit-copy-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		background: var(--surface);
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.35rem 0.75rem;
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 44px;
	}
	.kit-copy-btn:hover:not(:disabled) {
		border-color: var(--accent-mid);
		color: var(--text);
	}
	.kit-copy-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.hero-handle-chip {
		flex-shrink: 0;
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		color: var(--accent-text);
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
	}

	/* Profile-tab card widgets */
	/* Auto-save status — quiet confirmation that per-platform edits persist. */
	.kit-save-state {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--success-text);
		margin-left: auto;
		margin-right: 0.6rem;
	}
	.kit-save-state.error {
		color: var(--error-text);
	}

	.kit-bio-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.kit-inline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.kit-inline input {
		flex: 1;
		min-width: 0;
	}

	.kit-add-row {
		margin-top: 0.6rem;
	}

	.kit-avatar-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.kit-avatar-thumb {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--border);
	}

	.kit-candidates {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.kit-candidate {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.7rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 0.85rem;
	}

	.kit-candidate.taken .kit-candidate-handle {
		text-decoration: line-through;
		color: var(--text-dim);
	}

	.kit-candidate.confirmed {
		border-color: color-mix(in srgb, var(--success) 50%, transparent);
	}

	.kit-candidate-handle {
		font-weight: 600;
		color: var(--text);
		font-family: var(--font-mono, monospace);
	}

	.kit-compat {
		font-size: 0.7rem;
		color: var(--warning-text);
	}

	.kit-confirmed-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--success-text);
	}

	/* "taken" was signalled by strike-through + colour alone — this spells it out (§10). */
	.kit-taken-badge {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.kit-candidate-actions {
		margin-left: auto;
		display: flex;
		gap: 0.3rem;
	}

	.kit-candidate-actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--surface);
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0.55rem;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s ease;
		min-width: 44px;
		min-height: 44px;
	}
	.kit-candidate-actions button:hover:not(:disabled) {
		border-color: var(--accent-mid);
		color: var(--text);
	}
	.kit-candidate-actions button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.kit-use-btn {
		font-weight: 600;
	}
	.kit-candidate-actions .kit-del-btn:hover:not(:disabled) {
		border-color: var(--error);
		color: var(--error-text);
	}

	/* Enlarge affordance for the identity-kit avatar thumb. */
	.kit-avatar-zoom {
		padding: 0;
		border: none;
		background: none;
		cursor: zoom-in;
		line-height: 0;
		border-radius: 50%;
	}
	.kit-avatar-zoom:hover .kit-avatar-thumb {
		border-color: var(--accent);
	}

	/* Chip rows (skills / tools) get an inline delete without opening the editor. */
	.item-chip-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.item-chip-del {
		position: relative;
		margin-left: -0.35rem;
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-muted);
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	/* Chip stays 22px; the tap target underneath is a full 44×44 (§2). Anchored to
	   the button's left edge so it grows into the gap, never over the chip itself. */
	.item-chip-del::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		width: 44px;
		height: 44px;
		transform: translateY(-50%);
	}
	.item-chip-wrap:hover .item-chip-del,
	.item-chip-wrap:focus-within .item-chip-del {
		opacity: 1;
	}
	.item-chip-del:hover {
		border-color: var(--error);
		color: var(--error-text);
	}

	.kit-bio-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.4rem;
	}

	.kit-bio-count {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	/* Over the platform's limit — the ONE thing that must not be missed before pasting. */
	.kit-bio-count.over {
		color: var(--error-text);
		font-weight: 700;
	}

	.kit-confirmed-row {
		margin-top: 0.6rem;
	}

	.kit-at {
		color: var(--text-dim);
		font-weight: 700;
	}

	.kit-connected-chip {
		flex-shrink: 0;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--success-text);
		border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
	}
	/* Confirmed handle disagrees with the live connected account — surface it. */
	.kit-connected-chip.mismatch {
		color: var(--warning-text);
		border-color: color-mix(in srgb, var(--warning) 50%, transparent);
	}

	/* ── Mobile ── */
	@media (max-width: 640px) {
		.persona-hero {
			gap: 1rem;
		}
		.hero-stats {
			display: none;
		}
		.hero-identity {
			flex-wrap: wrap;
			padding: 0.65rem 1rem;
		}
		.hero-bio {
			flex-basis: 100%;
			order: 3;
		}
		.fields-grid {
			grid-template-columns: 1fr;
		}
		.col-span-2 {
			grid-column: span 1;
		}
		.platforms-grid {
			grid-template-columns: 1fr;
		}
		.feed-toolbar {
			flex-direction: column;
			align-items: stretch;
		}
		.feed-actions {
			justify-content: flex-end;
		}
		.tab-nav-name {
			display: none;
		}
		.post-mosaic {
			grid-template-columns: 1fr;
		}
	}
</style>
