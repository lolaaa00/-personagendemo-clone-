<script lang="ts">
	import type { ContentStrategy } from '$lib/content-strategy';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { syncParam, readParam } from '$lib/url-state';

	let { data } = $props<{
		data: {
			brief: Record<string, any> | null;
			briefId: string | null;
			briefName: string | null;
		};
	}>();

	// ─── Brand-brief context ───────────────────────────────────────────────
	// The wizard used to live inside a tab of the brief editor and read the
	// editor's in-memory state directly. On its own route it re-reads the same
	// brief: localStorage first (the editor mirrors the *active* brief there on
	// every save/switch), server payload as the cold-start fallback.
	const LS_KEY = 'personagen_brand_brief';

	let currentBriefId = $state<string | null>(data.briefId ?? null);
	let brandName = $state('');
	let tagline = $state('');
	let mission = $state('');
	let demographics = $state('');
	let interests = $state('');
	let briefCompetitors = $state<Array<{ url?: string }>>([]);
	let briefProducts = $state<Array<{ name?: string }>>([]);

	function adoptBrief(d: Record<string, any> | null) {
		if (!d) return;
		brandName = d.brandName || '';
		tagline = d.tagline || '';
		mission = d.mission || '';
		demographics = d.demographics || '';
		interests = d.interests || '';
		briefCompetitors = Array.isArray(d.competitors) ? d.competitors : [];
		briefProducts = Array.isArray(d.products) ? d.products : [];
	}

	// ─── Intel Wizard State & Logic ───
	const INTEL_STORAGE_KEY = 'personagen_intel_wizard_merged';

	const INTEL_STEPS = [
		{ id: 1, label: 'Brand Discovery' },
		{ id: 2, label: 'Competitor Analysis' },
		{ id: 3, label: 'Content Audit' },
		{ id: 4, label: 'Audience Mapping' },
		{ id: 5, label: 'Strategy Generation' },
		{ id: 6, label: 'Results' }
	];

	const INTEL_INDUSTRIES = [
		'Technology',
		'Finance',
		'Healthcare',
		'Education',
		'E-Commerce',
		'Real Estate',
		'Food & Beverage',
		'Fashion',
		'Fitness & Wellness',
		'Entertainment',
		'SaaS',
		'Marketing',
		'Travel',
		'Automotive',
		'Other'
	];

	const INTEL_PLATFORMS_LIST = [
		{ id: 'youtube', label: 'YouTube' },
		{ id: 'tiktok', label: 'TikTok' },
		{ id: 'instagram', label: 'Instagram' },
		{ id: 'x', label: 'X / Twitter' },
		{ id: 'linkedin', label: 'LinkedIn' }
	];

	const INTEL_CONTENT_TYPES_LIST = [
		'Blog Posts',
		'Social Posts',
		'Videos',
		'Podcasts',
		'Newsletters',
		'Case Studies',
		'Infographics',
		'Webinars',
		'Stories/Reels'
	];

	const INTEL_LOCATIONS = [
		'Sydney',
		'Melbourne',
		'Brisbane',
		'Perth',
		'Adelaide',
		'Gold Coast',
		'Canberra',
		'Hobart',
		'Darwin',
		'National (AU)',
		'United States',
		'United Kingdom',
		'Global'
	];

	const INTEL_INTEREST_SUGGESTIONS = [
		'AI & Technology',
		'Entrepreneurship',
		'Fitness',
		'Fashion',
		'Cooking',
		'Gaming',
		'Travel',
		'Photography',
		'Music',
		'Finance',
		'Sustainability',
		'Self-improvement',
		'Parenting'
	];

	let intelCurrentStep = $state(1);
	let intelGenerating = $state(false);

	let intelCompanyName = $state('');
	let intelIndustry = $state('');
	let intelTargetAudience = $state('');
	// Which brief (id + brand name) the wizard was last seeded from. Wizard
	// state persists in localStorage ACROSS briefs, so without this marker a
	// brand switch keeps showing the previous brand's data (the "HoneyX data
	// inside an Akhu Apothecary brief" bug).
	let intelSeedKey = $state('');

	interface IntelCompetitor {
		url: string;
		platform: string;
	}
	let intelCompetitors = $state<IntelCompetitor[]>([{ url: '', platform: 'youtube' }]);

	let intelExistingContent = $state('');
	let intelContentTypes = $state<string[]>([]);

	let intelAgeMin = $state(18);
	let intelAgeMax = $state(44);
	let intelInterests = $state<string[]>([]);
	let intelInterestInput = $state('');
	let intelLocations = $state<string[]>(['Sydney']);

	type IntelStrategyResults = ContentStrategy;
	let intelStrategyResults = $state<IntelStrategyResults | null>(null);
	let intelError = $state<string | null>(null);
	let intelSaved = $state(false);

	// Infer the wizard's industry pick from the brief's own text — deterministic
	// keyword mapping onto the INTEL_INDUSTRIES options, E-Commerce as the
	// fallback for any scraped store.
	function inferIntelIndustry(): string {
		const text =
			`${mission} ${interests} ${demographics} ${tagline} ${brandName} ${briefProducts.map((p) => p.name ?? '').join(' ')}`.toLowerCase();
		const rules: [RegExp, string][] = [
			[/wellness|health|supplement|herbal|apothecary|fitness|gym|yoga/, 'Fitness & Wellness'],
			[/fashion|apparel|clothing|garment|streetwear|jewelr/, 'Fashion'],
			[/food|beverage|coffee|tea|snack|drink|restaurant/, 'Food & Beverage'],
			[/software|saas|tech|app\b|ai\b/, 'Technology'],
			[/finance|invest|bank|crypto/, 'Finance'],
			[/travel|tour|hotel/, 'Travel'],
			[/real estate|property|realty/, 'Real Estate'],
			[/game|gaming|music|film|entertainment/, 'Entertainment'],
			[/education|course|tutor|learning/, 'Education'],
			[/car\b|automotive|vehicle|motor/, 'Automotive']
		];
		for (const [re, label] of rules) if (re.test(text)) return label;
		return briefProducts.length > 0 ? 'E-Commerce' : '';
	}

	// Seed brand-brief data into the wizard. In the old tabbed version this ran
	// every time the Intel tab was opened; entering the route is that same
	// moment, so it runs once on mount — after restoring saved wizard state, so
	// the seed marker can decide whether the restored state belongs to this brand.
	function seedFromBrief() {
		// Re-seed EVERY brief-derived field when the active brief (or its
		// brand) changes — fill-if-empty is not enough, because restored
		// localStorage state from the previous brand is never empty.
		const seedKey = `${currentBriefId || 'local'}::${brandName}`;
		if (brandName && intelSeedKey !== seedKey) {
			intelSeedKey = seedKey;
			intelCompanyName = brandName;
			intelIndustry = inferIntelIndustry() || intelIndustry;
			intelTargetAudience = demographics || '';
			intelInterests = (interests || '')
				.split(/[,;|]+/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0 && s.length < 50);
			intelCompetitors = briefCompetitors
				.filter((c) => (c.url ?? '').trim())
				.slice(0, 5)
				.map((c) => ({ url: c.url as string, platform: 'instagram' }));
			if (intelCompetitors.length === 0) intelCompetitors = [{ url: '', platform: 'youtube' }];
			intelCurrentStep = 1;
			intelStrategyResults = null;
		}
		if (brandName && !intelCompanyName) intelCompanyName = brandName;
		// Pre-populate target audience from brief
		if (demographics && !intelTargetAudience) intelTargetAudience = demographics;
		// Pre-populate interests from brief
		if (interests) {
			const briefInterests = interests
				.split(/[,;|]+/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0 && s.length < 50);
			for (const interest of briefInterests) {
				if (!intelInterests.includes(interest)) {
					intelInterests = [...intelInterests, interest];
				}
			}
		}
		// Pre-populate competitors from brief
		if (briefCompetitors.length > 0 && intelCompetitors.every((c) => !c.url.trim())) {
			intelCompetitors = briefCompetitors
				.filter((c) => (c.url ?? '').trim())
				.slice(0, 5)
				.map((c) => ({ url: c.url as string, platform: 'instagram' }));
			if (intelCompetitors.length === 0) intelCompetitors = [{ url: '', platform: 'youtube' }];
		}
	}

	function saveIntelToStorage() {
		if (!browser) return;
		const data = {
			intelCurrentStep,
			intelSeedKey,
			intelCompanyName,
			intelIndustry,
			intelTargetAudience,
			intelCompetitors,
			intelExistingContent,
			intelContentTypes,
			intelAgeMin,
			intelAgeMax,
			intelInterests,
			intelLocations,
			// The report is persisted too, so `?step=6` survives a reload the
			// same way every other step does.
			intelStrategyResults
		};
		localStorage.setItem(INTEL_STORAGE_KEY, JSON.stringify(data));
	}

	function loadIntelFromStorage() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(INTEL_STORAGE_KEY);
			if (!raw) return;
			const data = JSON.parse(raw);
			if (data.intelStrategyResults) intelStrategyResults = data.intelStrategyResults;
			if (data.intelCurrentStep)
				intelCurrentStep = Math.min(data.intelCurrentStep, intelStrategyResults ? 6 : 5);
			if (data.intelSeedKey) intelSeedKey = data.intelSeedKey;
			if (data.intelCompanyName) intelCompanyName = data.intelCompanyName;
			if (data.intelIndustry) intelIndustry = data.intelIndustry;
			if (data.intelTargetAudience) intelTargetAudience = data.intelTargetAudience;
			if (data.intelCompetitors) intelCompetitors = data.intelCompetitors;
			if (data.intelExistingContent) intelExistingContent = data.intelExistingContent;
			if (data.intelContentTypes) intelContentTypes = data.intelContentTypes;
			if (data.intelAgeMin != null) intelAgeMin = data.intelAgeMin;
			if (data.intelAgeMax != null) intelAgeMax = data.intelAgeMax;
			if (data.intelInterests) intelInterests = data.intelInterests;
			if (data.intelLocations) intelLocations = data.intelLocations;
		} catch {
			/* ignore */
		}
	}

	let intelStep1Valid = $derived(intelCompanyName.trim().length > 0 && intelIndustry.length > 0);
	let intelStep2Valid = $derived(intelCompetitors.some((c) => c.url.trim().length > 0));
	let intelStep3Valid = $derived(
		intelExistingContent.trim().length > 0 || intelContentTypes.length > 0
	);
	let intelStep4Valid = $derived(intelLocations.length > 0);

	function canIntelProceed(step: number): boolean {
		switch (step) {
			case 1:
				return intelStep1Valid;
			case 2:
				return intelStep2Valid;
			case 3:
				return intelStep3Valid;
			case 4:
				return intelStep4Valid;
			case 5:
				return true;
			default:
				return false;
		}
	}

	// ─── Step ⇄ URL ────────────────────────────────────────────────────────
	// `?step=N` is the wizard's progress. `hydrated` gates the writer effect so
	// the default `1` can't blow away the incoming param before we've read it.
	const STEP_PARAMS = ['1', '2', '3', '4', '5', '6'] as const;
	let hydrated = $state(false);

	/** Highest step actually reachable with the state we have restored. */
	function reachableStep(requested: number): number {
		if (requested >= 6) return intelStrategyResults ? 6 : reachableStep(5);
		let allowed = 1;
		for (let s = 1; s < requested; s++) {
			if (!canIntelProceed(s)) break;
			allowed = s + 1;
		}
		return allowed;
	}

	onMount(() => {
		// Brief context: the editor's localStorage mirror is the active brief;
		// the server payload covers a cold browser.
		try {
			const saved = browser ? localStorage.getItem(LS_KEY) : null;
			if (saved) adoptBrief(JSON.parse(saved));
			else adoptBrief(data.brief);
		} catch {
			adoptBrief(data.brief);
		}

		loadIntelFromStorage();
		seedFromBrief();

		const requested = Number(readParam('step', STEP_PARAMS, '1'));
		intelCurrentStep = reachableStep(requested);
		hydrated = true;
	});

	$effect(() => {
		if (!hydrated) return;
		syncParam('step', String(intelCurrentStep), '1');
	});

	$effect(() => {
		if (browser && hydrated) saveIntelToStorage();
	});

	function nextIntelStep() {
		if (intelCurrentStep < 6 && canIntelProceed(intelCurrentStep)) {
			intelCurrentStep++;
		}
	}

	function prevIntelStep() {
		if (intelCurrentStep > 1) {
			intelCurrentStep--;
		}
	}

	function goToIntelStep(step: number) {
		if (step <= intelCurrentStep || (step <= 5 && canIntelProceed(step - 1))) {
			intelCurrentStep = step;
		}
	}

	function addIntelCompetitor() {
		if (intelCompetitors.length < 5) {
			intelCompetitors = [...intelCompetitors, { url: '', platform: 'youtube' }];
		}
	}

	function removeIntelCompetitor(index: number) {
		if (intelCompetitors.length > 1) {
			intelCompetitors = intelCompetitors.filter((_, i) => i !== index);
		}
	}

	function toggleIntelContentType(ct: string) {
		if (intelContentTypes.includes(ct)) {
			intelContentTypes = intelContentTypes.filter((c) => c !== ct);
		} else {
			intelContentTypes = [...intelContentTypes, ct];
		}
	}

	function addIntelInterest(tag: string) {
		const trimmed = tag.trim();
		if (trimmed && !intelInterests.includes(trimmed)) {
			intelInterests = [...intelInterests, trimmed];
			intelInterestInput = '';
		}
	}

	function removeIntelInterest(tag: string) {
		intelInterests = intelInterests.filter((i) => i !== tag);
	}

	function handleIntelInterestKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && intelInterestInput.trim()) {
			e.preventDefault();
			addIntelInterest(intelInterestInput);
		}
	}

	function toggleIntelLocation(loc: string) {
		if (intelLocations.includes(loc)) {
			intelLocations = intelLocations.filter((l) => l !== loc);
		} else {
			intelLocations = [...intelLocations, loc];
		}
	}

	/**
	 * Ask the server to build the plan from the brief and these answers.
	 *
	 * What this replaced: a local function that returned the same hardcoded
	 * object every time — four fixed pillars, a fixed Mon-Sun schedule, fixed
	 * platform scores, and a "Growth Targets" table whose `current` column
	 * invented the user's own follower count and engagement rate. Steps 2-4 were
	 * collected and never read. Nothing was saved. The spinner was a setTimeout.
	 */
	async function generateIntelStrategy() {
		intelGenerating = true;
		intelError = null;
		try {
			const res = await fetch('/api/engine', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'build_content_strategy',
					brief_id: currentBriefId || undefined,
					answers: {
						companyName: intelCompanyName,
						industry: intelIndustry,
						targetAudience: intelTargetAudience,
						competitors: intelCompetitors,
						existingContent: intelExistingContent,
						contentTypes: intelContentTypes,
						ageMin: intelAgeMin,
						ageMax: intelAgeMax,
						interests: intelInterests,
						locations: intelLocations
					}
				})
			});
			const body = await res.json();
			if (!res.ok || !body.success) throw new Error(body.error || `Couldn't build the plan (HTTP ${res.status}).`);
			intelStrategyResults = body.data as ContentStrategy;
			intelSaved = body.saved !== false;
			intelCurrentStep = 6;
			if (!intelSaved) intelError = 'Built, but it could not be saved to your brief. Copy anything you need before leaving.';
		} catch (err: any) {
			intelError = err?.message || 'Something went wrong building the plan.';
		} finally {
			intelGenerating = false;
		}
	}

	function startIntelOver() {
		intelCurrentStep = 1;
		intelCompanyName = brandName || '';
		intelIndustry = '';
		intelTargetAudience = '';
		intelCompetitors = [{ url: '', platform: 'youtube' }];
		intelExistingContent = '';
		intelContentTypes = [];
		intelAgeMin = 18;
		intelAgeMax = 44;
		intelInterests = [];
		intelInterestInput = '';
		intelLocations = ['Sydney'];
		intelStrategyResults = null;
		if (browser) localStorage.removeItem(INTEL_STORAGE_KEY);
	}

</script>

<svelte:head>
	<title>Content Plan — PersonaGen</title>
</svelte:head>

<section class="page intel-wizard-panel">
	<header class="page-header">
		<a class="breadcrumb" href="/brand-brief">
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
				><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg
			>
			Brand Brief
		</a>
		<div class="header-top">
			<div>
				<h1>Content Plan</h1>
				<p class="subtitle">
					Six steps that turn {brandName ? `${brandName}'s brand brief` : 'your brand brief'} into
					content pillars, a weekly schedule and a platform order — built from what you tell it, and
					saved back onto the brief. It reports no performance figures, because it measures nothing.
				</p>
			</div>
			<div class="header-actions">
				<a class="action-btn" href="/brand-brief">
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
						><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
					>
					Exit wizard
				</a>
			</div>
		</div>
		<p class="exit-hint">
			Your answers are kept as you go — you can leave and come back to this step at any time.
		</p>
	</header>

	<!-- ─── Progress Steps ─── -->
	<ol class="progress-steps" aria-label="Content intelligence wizard steps">
		{#each INTEL_STEPS as s, i}
			<li class="step-item">
				<button
					type="button"
					class="step-dot-group"
					class:active={intelCurrentStep === s.id}
					class:completed={intelCurrentStep > s.id}
					class:disabled={s.id > intelCurrentStep + 1}
					onclick={() => goToIntelStep(s.id)}
					disabled={s.id > intelCurrentStep + 1}
					aria-current={intelCurrentStep === s.id ? 'step' : undefined}
				>
					<div class="step-dot">
						{#if intelCurrentStep > s.id}
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg
							>
							<span class="sr-only">Completed:</span>
						{:else}
							<span>{s.id}</span>
						{/if}
					</div>
					<span class="step-label">{s.label}</span>
				</button>
			</li>
			{#if i < INTEL_STEPS.length - 1}
				<li class="step-line" class:filled={intelCurrentStep > s.id} aria-hidden="true"></li>
			{/if}
		{/each}
	</ol>

	<!-- ─── Step Content ─── -->
	<div class="step-container">
		<!-- STEP 1: Brand Discovery -->
		{#if intelCurrentStep === 1}
			<div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
				<div class="step-card-header">
					<span class="step-icon">
						<svg
							width="28"
							height="28"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path
								d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"
							/></svg
						>
					</span>
					<div>
						<h3>Brand Discovery</h3>
						<p>Tell us about your brand and target market</p>
					</div>
				</div>

				<div class="form-fields">
					<div class="field">
						<label for="intel-company-name"
							>Company / Brand Name <span class="req" aria-hidden="true">*</span></label
						>
						<input
							id="intel-company-name"
							type="text"
							bind:value={intelCompanyName}
							placeholder="e.g. PersonaGen"
							autocomplete="organization"
							aria-required="true"
							aria-invalid={!intelCompanyName.trim()}
							aria-describedby="intel-step1-hint"
						/>
					</div>

					<div class="field">
						<label for="intel-industry-select"
							>Industry <span class="req" aria-hidden="true">*</span></label
						>
						<select
							id="intel-industry-select"
							bind:value={intelIndustry}
							aria-required="true"
							aria-invalid={!intelIndustry}
							aria-describedby="intel-step1-hint"
						>
							<option value="">Select industry...</option>
							{#each INTEL_INDUSTRIES as ind}
								<option value={ind}>{ind}</option>
							{/each}
						</select>
					</div>

					<div class="field">
						<label for="intel-target-audience">Target Audience</label>
						<textarea
							id="intel-target-audience"
							bind:value={intelTargetAudience}
							placeholder="Describe your ideal customer / audience. E.g. 'Small business owners aged 25-45 in Australia looking to grow their social media presence'"
							rows="4"
						></textarea>
					</div>

					<p class="step-hint" id="intel-step1-hint">
						Fields marked with an asterisk are required before you can continue.
					</p>
				</div>
			</div>

			<!-- STEP 2: Competitor Analysis -->
		{:else if intelCurrentStep === 2}
			<div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
				<div class="step-card-header">
					<span class="step-icon">
						<svg
							width="28"
							height="28"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
						>
					</span>
					<div>
						<h3>Competitor Analysis</h3>
						<p>Add up to 5 competitor channels to analyze</p>
					</div>
				</div>

				<div class="competitors-list">
					{#each intelCompetitors as comp, i}
						<div class="competitor-row">
							<span class="comp-num" aria-hidden="true">{i + 1}</span>
							<label class="sr-only" for="intel-comp-url-{i}">Competitor {i + 1} channel URL</label>
							<input
								id="intel-comp-url-{i}"
								type="url"
								bind:value={comp.url}
								placeholder="https://youtube.com/@competitor"
								class="comp-url"
								autocomplete="url"
							/>
							<label class="sr-only" for="intel-comp-platform-{i}"
								>Competitor {i + 1} platform</label
							>
							<select id="intel-comp-platform-{i}" bind:value={comp.platform} class="comp-platform">
								{#each INTEL_PLATFORMS_LIST as p}
									<option value={p.id}>{p.label}</option>
								{/each}
							</select>
							<button
								type="button"
								class="comp-remove"
								onclick={() => removeIntelCompetitor(i)}
								disabled={intelCompetitors.length <= 1}
								title="Remove"
								aria-label="Remove competitor {i + 1}"
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
									><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
								>
							</button>
						</div>
					{/each}
				</div>

				{#if intelCompetitors.length < 5}
					<button type="button" class="add-comp-btn" onclick={addIntelCompetitor}>
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
							><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
						>
						Add Competitor ({intelCompetitors.length}/5)
					</button>
				{/if}
			</div>

			<!-- STEP 3: Content Audit -->
		{:else if intelCurrentStep === 3}
			<div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
				<div class="step-card-header">
					<span class="step-icon">
						<svg
							width="28"
							height="28"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><rect x="8" y="2" width="8" height="4" rx="1" /><path
								d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"
							/><path d="M9 12h6M9 16h6" /></svg
						>
					</span>
					<div>
						<h3>Content Audit</h3>
						<p>Share your existing content for analysis</p>
					</div>
				</div>

				<div class="form-fields">
					<div class="field">
						<label for="intel-existing-content">Existing Content (paste URLs or descriptions)</label
						>
						<textarea
							id="intel-existing-content"
							bind:value={intelExistingContent}
							placeholder="Paste links to your existing content, or describe what you've been posting. E.g.&#10;&#10;- Instagram: @mybrand (3 posts/week, mostly product photos)&#10;- Blog: mybrand.com/blog (monthly articles)&#10;- YouTube: 2 videos total"
							rows="6"
						></textarea>
					</div>

					<div class="field">
						<label id="intel-content-types-label">Content Types You Currently Produce</label>
						<div class="content-type-grid" role="group" aria-labelledby="intel-content-types-label">
							{#each INTEL_CONTENT_TYPES_LIST as ct}
								<button
									type="button"
									class="ct-btn"
									class:active={intelContentTypes.includes(ct)}
									onclick={() => toggleIntelContentType(ct)}
									aria-pressed={intelContentTypes.includes(ct)}
								>
									{ct}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>

			<!-- STEP 4: Audience Mapping -->
		{:else if intelCurrentStep === 4}
			<div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
				<div class="step-card-header">
					<span class="step-icon">
						<svg
							width="28"
							height="28"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle
								cx="12"
								cy="12"
								r="2"
							/></svg
						>
					</span>
					<div>
						<h3>Audience Mapping</h3>
						<p>Define your ideal audience demographics and interests</p>
					</div>
				</div>

				<div class="form-fields">
					<div class="field">
						<label id="intel-age-range-label" for="intel-age-min"
							>Age Range: {intelAgeMin} — {intelAgeMax}</label
						>
						<div class="range-group">
							<div class="range-row">
								<span class="range-label" id="intel-age-min-label">Min</span>
								<input
									id="intel-age-min"
									type="range"
									min="13"
									max="65"
									bind:value={intelAgeMin}
									class="slider"
									aria-label="Minimum audience age"
									aria-valuetext="{intelAgeMin} years"
									oninput={() => {
										if (intelAgeMin > intelAgeMax) intelAgeMax = intelAgeMin;
									}}
								/>
								<span class="range-val">{intelAgeMin}</span>
							</div>
							<div class="range-row">
								<span class="range-label" id="intel-age-max-label">Max</span>
								<input
									id="intel-age-max"
									type="range"
									min="13"
									max="65"
									bind:value={intelAgeMax}
									class="slider"
									aria-label="Maximum audience age"
									aria-valuetext="{intelAgeMax} years"
									oninput={() => {
										if (intelAgeMax < intelAgeMin) intelAgeMin = intelAgeMax;
									}}
								/>
								<span class="range-val">{intelAgeMax}</span>
							</div>
						</div>
					</div>

					<div class="field">
						<label for="intel-interest-input">Interest Tags</label>
						<div class="tags-input-wrapper">
							<div class="tags-display">
								{#each intelInterests as tag}
									<span class="tag">
										{tag}
										<button
											type="button"
											class="tag-remove"
											aria-label="Remove interest {tag}"
											onclick={() => removeIntelInterest(tag)}
											><svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												stroke-linecap="round"
												aria-hidden="true"
												><line x1="18" y1="6" x2="6" y2="18" /><line
													x1="6"
													y1="6"
													x2="18"
													y2="18"
												/></svg
											></button
										>
									</span>
								{/each}
								<input
									id="intel-interest-input"
									type="text"
									bind:value={intelInterestInput}
									placeholder={intelInterests.length > 0 ? 'Add more...' : 'Type and press Enter'}
									onkeydown={handleIntelInterestKeydown}
									class="tag-input"
								/>
							</div>
						</div>
						<div class="suggestions" role="group" aria-label="Suggested interest tags">
							{#each INTEL_INTEREST_SUGGESTIONS.filter((s) => !intelInterests.includes(s)) as sug}
								<button
									type="button"
									class="sug-btn"
									aria-label="Add interest {sug}"
									onclick={() => addIntelInterest(sug)}>{sug}</button
								>
							{/each}
						</div>
					</div>

					<div class="field">
						<label id="intel-locations-label"
							>Locations <span class="req" aria-hidden="true">*</span></label
						>
						<div class="location-grid" role="group" aria-labelledby="intel-locations-label">
							{#each INTEL_LOCATIONS as loc}
								<button
									type="button"
									class="loc-btn"
									class:active={intelLocations.includes(loc)}
									onclick={() => toggleIntelLocation(loc)}
									aria-pressed={intelLocations.includes(loc)}
								>
									{loc}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>

			<!-- STEP 5: Strategy Generation -->
		{:else if intelCurrentStep === 5}
			<div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
				<div class="step-card-header">
					<span class="step-icon">
						<svg
							width="28"
							height="28"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg
						>
					</span>
					<div>
						<h3>Strategy Generation</h3>
						<p>Review your inputs and generate a custom strategy</p>
					</div>
				</div>

				<div class="review-grid">
					<div class="review-item">
						<h3>Brand</h3>
						<p><strong>{intelCompanyName || '—'}</strong> • {intelIndustry || '—'}</p>
						{#if intelTargetAudience}
							<p class="review-sub">{intelTargetAudience}</p>
						{/if}
					</div>

					<div class="review-item">
						<h3>Competitors</h3>
						{#each intelCompetitors.filter((c) => c.url.trim()) as comp}
							<p class="review-url">
								{comp.url}
								<span class="review-plat"
									>{INTEL_PLATFORMS_LIST.find((p) => p.id === comp.platform)?.label}</span
								>
							</p>
						{/each}
						{#if !intelCompetitors.some((c) => c.url.trim())}
							<p class="review-sub">None added</p>
						{/if}
					</div>

					<div class="review-item">
						<h3>Content Types</h3>
						<div class="review-tags">
							{#each intelContentTypes as ct}
								<span class="review-tag">{ct}</span>
							{/each}
							{#if intelContentTypes.length === 0}
								<span class="review-sub">None selected</span>
							{/if}
						</div>
					</div>

					<div class="review-item">
						<h3>Audience</h3>
						<p>Ages {intelAgeMin}–{intelAgeMax} • {intelLocations.join(', ') || '—'}</p>
						{#if intelInterests.length > 0}
							<div class="review-tags">
								{#each intelInterests as int}
									<span class="review-tag accent">{int}</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<button
					type="button"
					class="generate-btn"
					onclick={generateIntelStrategy}
					disabled={intelGenerating}
					aria-busy={intelGenerating}
				>
					{#if intelGenerating}
						<div class="gen-spinner"></div>
						Building your plan…
					{:else}
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
							><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg
						>
						Build my content plan
					{/if}
				</button>

				<div class="gen-progress-live" role="status" aria-live="polite">
					{#if intelGenerating}
						<div class="gen-progress" style="animation: fadeUp 0.3s var(--ease-out)">
							<div class="gen-bar" aria-hidden="true"><div class="gen-fill"></div></div>
							<p>Reading your brand brief and your answers…</p>
						</div>
					{/if}
				</div>
				{#if intelError}
					<p class="intel-error" role="alert">
						{intelError}
						<button type="button" class="nav-btn back" onclick={generateIntelStrategy}>Try again</button>
					</p>
				{/if}
			</div>

			<!-- STEP 6: Results -->
		{:else if intelCurrentStep === 6 && intelStrategyResults}
			<div class="results-container" style="animation: fadeUp 0.4s var(--ease-out)">
				<div class="results-header-card">
					<div class="results-title">
						<h3>Your content plan</h3>
						<p>
							{intelCompanyName || 'Your brand'} · built {new Date(
								intelStrategyResults.builtAt
							).toLocaleString()}
							{#if intelSaved}· saved to your brand brief{/if}
						</p>
					</div>
					<div class="results-actions">
						<button type="button" class="start-over-btn" onclick={startIntelOver}>
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
								><polyline points="1 4 1 10 7 10" /><path
									d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"
								/></svg
							>
							Start Over
						</button>
						<a class="done-btn" href="/brand-brief">Done — back to Brand Brief</a>
					</div>
				</div>

				<!-- Content Pillars -->
				<div class="result-section">
					<h3 class="section-title">
						<svg
							aria-hidden="true"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--accent)"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><rect x="3" y="3" width="7" height="7" /><rect
								x="14"
								y="3"
								width="7"
								height="7"
							/><rect x="14" y="14" width="7" height="7" /><rect
								x="3"
								y="14"
								width="7"
								height="7"
							/></svg
						>
						Content Pillars
					</h3>
					<div class="pillars-grid">
						{#each intelStrategyResults.pillars as pillar, i}
							<div class="pillar-card" style="animation-delay: {i * 0.08}s">
								<div class="pillar-header">
									<h4>{pillar.name}</h4>
									<span
										class="priority-tag"
										class:primary={pillar.priority === 'Primary'}
										class:secondary={pillar.priority === 'Secondary'}>{pillar.priority}</span
									>
								</div>
								<p>{pillar.description}</p>
								<p class="pillar-from">From {pillar.from}</p>
							</div>
						{/each}
					</div>
				</div>

				<!-- Posting Schedule -->
				<div class="result-section">
					<h3 class="section-title">
						<svg
							aria-hidden="true"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--cyan)"
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
						Posting Schedule
					</h3>
					<div class="table-scroll">
						<div class="schedule-table">
							<div class="table-header">
								<span>Day</span><span>Time</span><span>Content Type</span><span>Platform</span>
							</div>
							{#each intelStrategyResults.schedule as row}
								<div class="table-row">
									<span class="day-cell">{row.day}</span>
									<span class="time-cell">{row.time}</span>
									<span>{row.type}</span>
									<span class="plat-cell">{row.platform}</span>
								</div>
							{/each}
						</div>
					</div>
				</div>

				<!-- Platform Priority -->
				<div class="result-section">
					<h3 class="section-title">
						<svg
							aria-hidden="true"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--gold)"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg
						>
						Platform Priority
					</h3>
					<div class="platform-cards">
						{#each intelStrategyResults.platforms as plat (plat.platform)}
							<div class="plat-card">
								<div class="plat-card-header">
									<span class="plat-rank" aria-hidden="true">{plat.rank}</span>
									<span class="plat-name">{plat.platform}</span>
									{#if !plat.fromYou}
										<span class="plat-default">default</span>
									{/if}
								</div>
								<p class="plat-reason">{plat.why}</p>
							</div>
						{/each}
					</div>
				</div>

				<!-- What the plan asks of you. The section this replaces was a
				     "Growth Targets" table whose Current column invented the
				     user's own followers, engagement rate, reach, saves and
				     mentions. Nothing here is a measurement or a forecast. -->
				<div class="result-section">
					<h3 class="section-title">
						<svg
							aria-hidden="true"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--success)"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path d="M9 11l3 3L22 4" /><path
								d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
							/></svg
						>
						What this plan asks of you
					</h3>
					<div class="commit-row">
						<div class="commit-stat">
							<span class="commit-num">{intelStrategyResults.commitment.postsPerWeek}</span>
							<span class="commit-label">posts a week</span>
						</div>
						<div class="commit-stat">
							<span class="commit-num">{intelStrategyResults.commitment.platforms}</span>
							<span class="commit-label"
								>platform{intelStrategyResults.commitment.platforms === 1 ? '' : 's'}</span
							>
						</div>
						<div class="commit-stat">
							<span class="commit-num">{intelStrategyResults.commitment.formats.length}</span>
							<span class="commit-label">format{intelStrategyResults.commitment.formats.length === 1 ? '' : 's'}</span>
						</div>
					</div>
					<p class="commit-note">
						These are commitments, not predictions. This plan makes no claim about your reach,
						followers or engagement — connect a platform and the dashboard will report those from
						real data.
					</p>
				</div>

				<!-- What it was built from, and what was missing. -->
				<div class="result-section provenance">
					<h3 class="section-title">What this was built from</h3>
					{#if intelStrategyResults.provenance.used.length}
						<p class="prov-line">
							<strong>Used:</strong>
							{intelStrategyResults.provenance.used.join(', ')}.
						</p>
					{/if}
					{#if intelStrategyResults.provenance.missing.length}
						<p class="prov-line prov-missing">
							<strong>Not available:</strong>
							{intelStrategyResults.provenance.missing.join(', ')}. Fill these in on your
							<a href="/brand-brief">brand brief</a> and build the plan again for a sharper result.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- ─── Navigation Buttons ─── -->
	{#if intelCurrentStep < 6}
		<div class="nav-buttons">
			<button
				type="button"
				class="nav-btn back"
				onclick={prevIntelStep}
				disabled={intelCurrentStep === 1}
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
					><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg
				>
				Back
			</button>
			{#if intelCurrentStep < 5}
				<button
					type="button"
					class="nav-btn next"
					onclick={nextIntelStep}
					disabled={!canIntelProceed(intelCurrentStep)}
				>
					Next
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
						><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg
					>
				</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.page {
		padding: 2rem;
		max-width: 960px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}
	.header-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.page-header h1 {
		font-size: var(--text-3xl);
		background: var(--gradient);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-base);
		margin-top: 0.25rem;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* The wizard is a dead end without a way out, so the exit is stated three
	   ways: a breadcrumb, a header button, and a Done link on the report. */
	.breadcrumb {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-dim);
		text-decoration: none;
		transition: color 0.2s;
	}
	.breadcrumb:hover {
		color: var(--accent);
	}

	.exit-hint {
		margin-top: 0.5rem;
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 16px;
		min-height: 44px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		font-size: 0.78rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		text-decoration: none;
		transition:
			border-color 0.2s,
			color 0.2s;
	}
	.action-btn:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	.field {
		display: flex;
		flex-direction: column;
	}

	/* ─── Intel Wizard Styles (moved verbatim from the brand-brief tab) ─── */
	.intel-wizard-panel .progress-steps {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0;
		margin: 0 0 2.5rem;
		padding: 1.5rem;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow-x: auto;
	}

	/* <li> wrappers give the wizard a real list structure for assistive tech;
	   they pass the flex row straight through to the step button. */
	.intel-wizard-panel .step-item {
		display: flex;
		align-items: center;
	}

	.intel-wizard-panel .step-dot-group {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.5rem;
		min-width: 80px;
		transition: opacity 0.2s ease;
	}

	.intel-wizard-panel .step-dot-group.disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.intel-wizard-panel .step-dot {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-dim);
		background: var(--surface-2);
		border: 2px solid var(--border-strong);
		transition: all 0.3s ease;
	}

	.intel-wizard-panel .step-dot-group.active .step-dot {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
		box-shadow: var(--shadow-accent);
	}

	.intel-wizard-panel .step-dot-group.completed .step-dot {
		background: var(--success-soft);
		border-color: var(--success);
		color: var(--success);
	}

	.intel-wizard-panel .step-label {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-dim);
		text-align: center;
		white-space: nowrap;
	}

	.intel-wizard-panel .step-dot-group.active .step-label {
		color: var(--accent);
	}

	.intel-wizard-panel .step-dot-group.completed .step-label {
		color: var(--success);
	}

	.intel-wizard-panel .step-line {
		width: 40px;
		height: 2px;
		background: var(--border-strong);
		flex-shrink: 0;
		margin-bottom: 1.5rem;
		transition: background 0.3s ease;
	}

	.intel-wizard-panel .step-line.filled {
		background: var(--success);
	}

	.intel-wizard-panel .step-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
	}

	.intel-wizard-panel .step-card-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.intel-wizard-panel .step-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}

	.intel-wizard-panel .step-card-header h3 {
		font-family: var(--font-display);
		font-size: 1.3rem;
		color: var(--text);
		margin: 0;
	}

	.intel-wizard-panel .step-card-header p {
		color: var(--text-muted);
		font-size: 0.85rem;
		margin: 0.2rem 0 0;
	}

	.intel-wizard-panel .form-fields {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.intel-wizard-panel .field label {
		margin-bottom: 0.5rem;
	}

	.intel-wizard-panel .req {
		color: var(--rose-text);
	}

	.intel-wizard-panel .step-hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-dim);
	}

	.intel-wizard-panel .competitors-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.intel-wizard-panel .competitor-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.intel-wizard-panel .comp-num {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-soft);
		border-radius: var(--radius-full);
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--accent);
		flex-shrink: 0;
	}

	.intel-wizard-panel .comp-url {
		flex: 1;
		min-width: 0;
	}

	.intel-wizard-panel .comp-platform {
		width: 140px;
		flex-shrink: 0;
	}

	.intel-wizard-panel .comp-remove {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		color: var(--text-dim);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.2s ease;
	}

	.intel-wizard-panel .comp-remove:hover:not(:disabled) {
		border-color: var(--error);
		color: var(--error);
		background: var(--error-soft);
	}

	.intel-wizard-panel .comp-remove:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.intel-wizard-panel .add-comp-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.65rem;
		min-height: 44px;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-dim);
		font-size: 0.82rem;
		cursor: pointer;
		transition: all 0.2s ease;
		width: 100%;
	}

	.intel-wizard-panel .add-comp-btn:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
	}

	.intel-wizard-panel .content-type-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.intel-wizard-panel .ct-btn {
		padding: 0.5rem 1rem;
		min-height: 44px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.intel-wizard-panel .ct-btn:hover {
		border-color: var(--border-hover);
		color: var(--text);
	}

	.intel-wizard-panel .ct-btn.active {
		border-color: var(--accent-mid);
		background: var(--accent-soft);
		color: var(--accent);
	}

	.intel-wizard-panel .range-group {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.intel-wizard-panel .range-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.intel-wizard-panel .range-label {
		font-size: 0.75rem;
		color: var(--text-dim);
		width: 30px;
		flex-shrink: 0;
	}

	.intel-wizard-panel .slider {
		flex: 1;
		min-width: 0;
		-webkit-appearance: none;
		appearance: none;
		height: 6px;
		background: var(--surface-3);
		border-radius: var(--radius-full);
		outline: none;
		border: none;
		padding: 0;
	}

	.intel-wizard-panel .slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
		border: 2px solid var(--bg);
		box-shadow: 0 0 10px var(--accent-mid);
	}

	.intel-wizard-panel .slider::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
		border: 2px solid var(--bg);
	}

	.intel-wizard-panel .range-val {
		font-family: var(--font-mono);
		font-size: 0.82rem;
		color: var(--text);
		width: 30px;
		text-align: right;
		flex-shrink: 0;
	}

	.intel-wizard-panel .tags-input-wrapper {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.intel-wizard-panel .tags-display {
		display: flex;
		flex-wrap: wrap;
		/* 0.75rem so the 44x44 remove targets below bleed into the gap, not
		   into the neighbouring chip. */
		gap: 0.75rem;
		align-items: center;
	}

	.intel-wizard-panel .tag {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		color: var(--accent);
	}

	.intel-wizard-panel .tag-remove {
		position: relative;
		display: inline-flex;
		align-items: center;
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: 1rem;
		padding: 0;
		line-height: 1;
		transition: color 0.2s ease;
	}

	/* Glyph stays 12px; pointer target is 44x44. */
	.intel-wizard-panel .tag-remove::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}

	.intel-wizard-panel .tag-remove:hover {
		color: var(--error);
	}

	.intel-wizard-panel .tag-input {
		border: none !important;
		background: transparent !important;
		padding: 0.3rem 0.5rem !important;
		/* 1rem = 16px: anything smaller makes iOS Safari force-zoom on focus. */
		font-size: 1rem;
		flex: 1;
		min-width: 120px;
		outline: none;
		box-shadow: none !important;
	}

	.intel-wizard-panel .suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	.intel-wizard-panel .sug-btn {
		padding: 0.25rem 0.6rem;
		min-height: 44px;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		color: var(--text-dim);
		font-size: 0.7rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.intel-wizard-panel .sug-btn:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
	}

	.intel-wizard-panel .location-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.intel-wizard-panel .loc-btn {
		padding: 0.5rem 1rem;
		min-height: 44px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.intel-wizard-panel .loc-btn:hover {
		border-color: var(--border-hover);
		color: var(--text);
	}

	.intel-wizard-panel .loc-btn.active {
		border-color: var(--cyan-mid);
		background: var(--cyan-soft);
		color: var(--cyan);
	}

	.intel-wizard-panel .review-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem;
		margin-bottom: 2rem;
	}

	.intel-wizard-panel .review-item {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1.25rem;
	}

	.intel-wizard-panel .review-item h3 {
		font-family: var(--font-display);
		font-size: 0.85rem;
		color: var(--text);
		margin: 0 0 0.5rem;
	}

	.intel-wizard-panel .review-item p {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0 0 0.25rem;
		line-height: 1.5;
	}

	.intel-wizard-panel .review-item p strong {
		color: var(--text);
	}

	.intel-wizard-panel .review-sub {
		font-size: 0.78rem;
		color: var(--text-dim);
	}

	.intel-wizard-panel .review-url {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		word-break: break-all;
	}

	.intel-wizard-panel .review-plat {
		color: var(--accent);
		font-weight: 600;
		margin-left: 0.5rem;
		font-family: var(--font-body);
	}

	.intel-wizard-panel .review-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.intel-wizard-panel .review-tag {
		padding: 0.2rem 0.6rem;
		background: var(--surface-3);
		border-radius: var(--radius-full);
		font-size: 0.72rem;
		color: var(--text-muted);
	}

	.intel-wizard-panel .review-tag.accent {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.intel-wizard-panel .generate-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 1rem;
		background: var(--gradient);
		border: none;
		border-radius: var(--radius-sm);
		color: #fff;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition:
			transform 0.2s ease,
			box-shadow 0.3s ease;
	}

	.intel-wizard-panel .generate-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: var(--shadow-accent);
	}

	.intel-wizard-panel .generate-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.intel-wizard-panel .gen-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.intel-wizard-panel .gen-progress {
		text-align: center;
		margin-top: 1.5rem;
	}

	.intel-wizard-panel .gen-bar {
		width: 100%;
		height: 4px;
		background: var(--surface-3);
		border-radius: var(--radius-full);
		overflow: hidden;
		margin-bottom: 0.75rem;
	}

	.intel-wizard-panel .gen-fill {
		height: 100%;
		width: 40%;
		background: var(--gradient);
		border-radius: var(--radius-full);
		animation: genSlide 1.8s ease-in-out infinite;
	}

	/* The tabbed version referenced this keyframe without ever defining it, so
	   the indeterminate bar sat still. */
	@keyframes genSlide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(250%);
		}
	}

	.intel-wizard-panel .gen-progress p {
		color: var(--text-dim);
		font-size: 0.82rem;
	}

	.intel-wizard-panel .results-header-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem 2rem;
		margin-bottom: 1.5rem;
	}

	.intel-wizard-panel .results-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.intel-wizard-panel .results-title h3 {
		font-family: var(--font-display);
		font-size: 1.4rem;
		color: var(--text);
		margin: 0;
	}

	.intel-wizard-panel .results-title p {
		color: var(--text-muted);
		font-size: 0.85rem;
		margin: 0.2rem 0 0;
	}

	.intel-wizard-panel .start-over-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.2rem;
		min-height: 44px;
		background: transparent;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.intel-wizard-panel .start-over-btn:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
	}

	.intel-wizard-panel .done-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.6rem 1.2rem;
		min-height: 44px;
		background: var(--gradient);
		border: none;
		border-radius: var(--radius-sm);
		color: #fff;
		font-size: 0.82rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			transform 0.2s ease,
			box-shadow 0.3s ease;
	}

	.intel-wizard-panel .done-btn:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}

	.intel-wizard-panel .result-section {
		margin-bottom: 1.5rem;
	}

	.intel-wizard-panel .section-title {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--font-display);
		font-size: 1.1rem;
		color: var(--text);
		margin: 0 0 1rem;
	}

	.intel-wizard-panel .pillars-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 640px) {
		.intel-wizard-panel .review-grid,
		.intel-wizard-panel .pillars-grid {
			grid-template-columns: 1fr;
		}
	}

	.intel-wizard-panel .pillar-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		transition: border-color 0.2s ease;
		animation: fadeUp 0.4s var(--ease-out) both;
	}

	.intel-wizard-panel .pillar-card:hover {
		border-color: var(--border-hover);
	}

	.intel-wizard-panel .pillar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.intel-wizard-panel .pillar-header h4 {
		font-family: var(--font-display);
		font-size: 0.95rem;
		color: var(--text);
		margin: 0;
	}

	.intel-wizard-panel .priority-tag {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
		background: var(--surface-3);
		color: var(--text-dim);
	}

	.intel-wizard-panel .priority-tag.primary {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.intel-wizard-panel .priority-tag.secondary {
		background: var(--cyan-soft);
		color: var(--cyan);
	}

	.intel-wizard-panel .pillar-card p {
		font-size: 0.82rem;
		color: var(--text-muted);
		line-height: 1.6;
		margin: 0;
	}

	/* Wide tables scroll inside their own box rather than pushing the page. */
	.intel-wizard-panel .table-scroll {
		overflow-x: auto;
	}

	.intel-wizard-panel .schedule-table,
	.intel-wizard-panel .targets-table {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.intel-wizard-panel .table-header {
		display: grid;
		grid-template-columns: 1fr 1fr 1.5fr 1fr;
		padding: 0.75rem 1.25rem;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-dim);
	}

	.intel-wizard-panel .targets-header {
		grid-template-columns: 1.5fr 1fr 1fr 1fr;
	}

	.intel-wizard-panel .table-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1.5fr 1fr;
		padding: 0.75rem 1.25rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.82rem;
		color: var(--text-muted);
		transition: background 0.15s ease;
	}

	.intel-wizard-panel .table-row:hover {
		background: var(--surface-2);
	}

	.intel-wizard-panel .table-row:last-child {
		border-bottom: none;
	}

	.intel-wizard-panel .targets-row {
		grid-template-columns: 1.5fr 1fr 1fr 1fr;
	}

	.intel-wizard-panel .day-cell {
		color: var(--text);
		font-weight: 600;
	}
	.intel-wizard-panel .time-cell {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
	}
	.intel-wizard-panel .plat-cell {
		color: var(--accent);
		font-weight: 500;
	}
	.intel-wizard-panel .metric-cell {
		color: var(--text);
		font-weight: 500;
	}
	.intel-wizard-panel .current-cell {
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.intel-wizard-panel .t30-cell {
		color: var(--gold);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.intel-wizard-panel .t90-cell {
		color: var(--success);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.intel-wizard-panel .platform-cards {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.intel-wizard-panel .plat-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem 1.25rem;
		transition: border-color 0.2s ease;
		animation: fadeUp 0.4s var(--ease-out) both;
	}

	.intel-wizard-panel .plat-card:hover {
		border-color: var(--border-hover);
	}

	.intel-wizard-panel .plat-card-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}

	.intel-wizard-panel .plat-name {
		font-weight: 600;
		font-size: 0.88rem;
		color: var(--text);
		min-width: 100px;
	}

	.intel-wizard-panel .plat-score-bar {
		flex: 1;
		min-width: 0;
		height: 6px;
		background: var(--surface-3);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.intel-wizard-panel .plat-score-fill {
		height: 100%;
		/* Full width + scaleX keeps the meter on the compositor: animating `width`
		   forced a layout pass on every frame. */
		width: 100%;
		transform-origin: left center;
		border-radius: var(--radius-full);
		transition: transform 0.25s var(--ease-out);
	}

	.intel-wizard-panel .plat-score-num {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		min-width: 30px;
		text-align: right;
	}

	.intel-wizard-panel .plat-reason {
		font-size: 0.8rem;
		color: var(--text-dim);
		line-height: 1.5;
		margin: 0;
	}

	.intel-wizard-panel .nav-buttons {
		display: flex;
		justify-content: space-between;
		margin-top: 1.5rem;
	}

	.intel-wizard-panel .nav-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		min-height: 44px;
		border-radius: var(--radius-sm);
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.intel-wizard-panel .nav-btn.back {
		background: transparent;
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
	}

	.intel-wizard-panel .nav-btn.back:hover:not(:disabled) {
		border-color: var(--border-hover);
		color: var(--text);
	}

	.intel-wizard-panel .nav-btn.next {
		background: var(--gradient);
		border: none;
		color: #fff;
		margin-left: auto;
	}

	.intel-wizard-panel .nav-btn.next:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}

	.intel-wizard-panel .nav-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.page {
			padding: 1.25rem;
		}

		.intel-wizard-panel .progress-steps {
			padding: 1rem;
			gap: 0;
			justify-content: flex-start;
		}

		.intel-wizard-panel .step-dot-group {
			min-width: 60px;
		}
		.intel-wizard-panel .step-label {
			font-size: 0.6rem;
		}
		.intel-wizard-panel .step-line {
			width: 20px;
		}

		.intel-wizard-panel .step-card {
			padding: 1.5rem;
		}

		.intel-wizard-panel .competitor-row {
			flex-wrap: wrap;
		}

		.intel-wizard-panel .comp-url {
			flex: 1 1 100%;
			order: 2;
		}
		.intel-wizard-panel .comp-platform {
			width: 100%;
			order: 3;
		}
		.intel-wizard-panel .comp-num {
			order: 1;
		}
		.intel-wizard-panel .comp-remove {
			order: 1;
		}

		.intel-wizard-panel .review-grid {
			grid-template-columns: 1fr;
		}
		.intel-wizard-panel .pillars-grid {
			grid-template-columns: 1fr;
		}

		.intel-wizard-panel .table-header,
		.intel-wizard-panel .table-row {
			grid-template-columns: 1fr 1fr;
			gap: 0.25rem;
		}

		.intel-wizard-panel .targets-header,
		.intel-wizard-panel .targets-row {
			grid-template-columns: 1fr 1fr;
		}
	}
	/* ── Content plan results ── */
	.pillar-from {
		margin-top: var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-style: italic;
	}
	.plat-rank {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		color: var(--accent-text);
		font-size: var(--text-xs);
		font-weight: 700;
		flex-shrink: 0;
	}
	.plat-default {
		margin-left: auto;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--border-strong);
		color: var(--text-dim);
		font-size: var(--text-xs);
	}
	.commit-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-6);
	}
	.commit-stat {
		display: flex;
		flex-direction: column;
	}
	.commit-num {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		line-height: 1;
		color: var(--text);
	}
	.commit-label {
		font-size: var(--text-sm);
		color: var(--text-dim);
	}
	.commit-note,
	.prov-line {
		margin-top: var(--space-3);
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--text-muted);
	}
	.prov-missing {
		color: var(--text-dim);
	}
	.intel-error {
		margin: var(--space-4) 0 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		background: var(--error-soft);
		color: var(--error-text);
		font-size: var(--text-base);
	}
</style>
