<script lang="ts">
	import { page } from '$app/stores';
	import { showToast, updateBrandColors, triggerBrandTransform } from '$lib/stores/ui.svelte';
	import { browser } from '$app/environment';
	import { BrandBrief } from '$lib/services/api';

	const LS_KEY = 'personagen_brand_brief';

	type TabKey = 'overview' | 'products' | 'visual' | 'voice' | 'audience' | 'competitors' | 'intel';

	const TABS: { key: TabKey; label: string; icon: string }[] = [
		{
			key: 'overview',
			label: 'Overview',
			icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4'
		},
		{
			key: 'products',
			label: 'Products & UGC',
			icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z'
		},
		{
			key: 'visual',
			label: 'Visual Identity',
			icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01'
		},
		{
			key: 'voice',
			label: 'Voice & Tone',
			icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z'
		},
		{
			key: 'audience',
			label: 'Target Audience',
			icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z'
		},
		{
			key: 'competitors',
			label: 'Competitors',
			icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
		},
		{
			key: 'intel',
			label: 'Intel Wizard',
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		}
	];

	const COMM_STYLES = ['Casual', 'Professional', 'Bold', 'Minimal'];

	let activeTab = $state<TabKey>('overview');

	// Auto-select tab from query param
	$effect(() => {
		const tabParam = $page.url.searchParams.get('tab') as TabKey;
		if (tabParam && TABS.some((t) => t.key === tabParam)) {
			activeTab = tabParam;
		}
	});

	// Overview
	let brandName = $state('');
	let tagline = $state('');
	let mission = $state('');

	// Visual Identity
	let primaryColor = $state('#7c6aed');
	let secondaryColor = $state('#22d3ee');
	let logoUrl = $state('');
	let fontPrimary = $state('');
	let fontSecondary = $state('');

	// Voice & Tone
	let traits = $state<string[]>([]);
	let traitInput = $state('');
	let commStyle = $state('Professional');
	let samplePost = $state('');

	// Target Audience
	let demographics = $state('');
	let interests = $state('');
	let platforms = $state('');
	let painPoints = $state('');

	// Competitors
	interface Competitor {
		id: string;
		name: string;
		url: string;
		notes: string;
	}
	let competitors = $state<Competitor[]>([]);

	// Products & UGC Guidelines (Connected to Scraper and Content Forge)
	interface Product {
		id: string;
		name: string;
		description: string;
		price: string;
		photoUrl: string;
	}
	let products = $state<Product[]>([]);
	let ugcGuidelines = $state('');

	// Scraper & AI Enrich controls
	let storeUrl = $state('honeyforx.com');
	let scraping = $state(false);
	let extending = $state<Record<string, boolean>>({});

	// Meta
	let lastSaved = $state('');
	let version = $state('1.0');

	// Load from localStorage
	$effect(() => {
		if (!browser) return;
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) {
				const d = JSON.parse(saved);
				brandName = d.brandName || '';
				tagline = d.tagline || '';
				mission = d.mission || '';
				primaryColor = d.primaryColor || '#7c6aed';
				secondaryColor = d.secondaryColor || '#22d3ee';
				logoUrl = d.logoUrl || '';
				fontPrimary = d.fontPrimary || '';
				fontSecondary = d.fontSecondary || '';
				traits = d.traits || [];
				commStyle = d.commStyle || 'Professional';
				samplePost = d.samplePost || '';
				demographics = d.demographics || '';
				interests = d.interests || '';
				platforms = d.platforms || '';
				painPoints = d.painPoints || '';
				competitors = d.competitors || [];
				products = d.products || [];
				ugcGuidelines = d.ugcGuidelines || '';
				storeUrl = d.storeUrl || 'honeyforx.com';
				lastSaved = d.lastSaved || '';
				version = d.version || '1.0';
			}
		} catch {
			/* ignore */
		}
	});

	// Live preview of primary/secondary colors in real-time as they edit
	$effect(() => {
		if (browser) {
			updateBrandColors(primaryColor, secondaryColor);
		}
	});

	function saveAll(e?: MouseEvent, isManualClick = false) {
		if (!browser) return;
		const now = new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
		lastSaved = now;

		// Detect if brand colors are changing compared to what's already saved
		let colorsChanged = false;
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) {
				const d = JSON.parse(saved);
				if (d.primaryColor !== primaryColor || d.secondaryColor !== secondaryColor) {
					colorsChanged = true;
				}
			} else {
				if (primaryColor !== '#7c6aed' || secondaryColor !== '#22d3ee') {
					colorsChanged = true;
				}
			}
		} catch {
			colorsChanged = true;
		}

		localStorage.setItem(
			LS_KEY,
			JSON.stringify({
				brandName,
				tagline,
				mission,
				primaryColor,
				secondaryColor,
				logoUrl,
				fontPrimary,
				fontSecondary,
				traits,
				commStyle,
				samplePost,
				demographics,
				interests,
				platforms,
				painPoints,
				competitors,
				products,
				ugcGuidelines,
				storeUrl,
				lastSaved: now,
				version
			})
		);
		showToast('Brand brief saved', 'success');

		// Only trigger magical transition on actual manual save or scrape complete
		// if colors changed, and ONLY ONCE per session.
		const sessionKey = 'personagen_brand_transformed_done';
		const alreadyTransformed = sessionStorage.getItem(sessionKey) === 'true';

		if (colorsChanged && !alreadyTransformed && (isManualClick || e)) {
			const x = e ? e.clientX : window.innerWidth / 2;
			const y = e ? e.clientY : window.innerHeight / 2;
			triggerBrandTransform(x, y, primaryColor, secondaryColor);
			sessionStorage.setItem(sessionKey, 'true');
		} else {
			// Otherwise update values smoothly and quietly
			updateBrandColors(primaryColor, secondaryColor);
		}
	}

	async function runScrape() {
		if (!storeUrl.trim()) {
			showToast('Please enter a store URL', 'error');
			return;
		}
		scraping = true;
		try {
			const res = await BrandBrief.scrapeStore(storeUrl);
			if (res.success && res.data) {
				const d = res.data;
				brandName = d.brandName || brandName;
				tagline = d.tagline || tagline;
				mission = d.mission || mission;
				primaryColor = d.primaryColor || primaryColor;
				secondaryColor = d.secondaryColor || secondaryColor;
				logoUrl = d.logoUrl || logoUrl;
				traits = d.traits || traits;
				commStyle = d.commStyle || commStyle;
				demographics = d.demographics || demographics;
				interests = d.interests || interests;
				platforms = d.platforms || platforms;
				painPoints = d.painPoints || painPoints;
				products = d.products || products;

				saveAll(undefined, true);
				showToast(
					`Successfully scraped ${brandName}! Imported ${products.length} products with photos.`,
					'success'
				);
			} else {
				showToast(res.error || 'Failed to scrape store', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Scrape failed', 'error');
		} finally {
			scraping = false;
		}
	}

	async function extendField(fieldName: string, fieldVal: string, setter: (val: string) => void) {
		if (!fieldVal.trim()) {
			showToast('Please type some brief text first to enrich', 'info');
			return;
		}
		extending = { ...extending, [fieldName]: true };
		try {
			const res = await BrandBrief.extendField(fieldName, fieldVal);
			if (res.success && res.data?.enriched) {
				setter(res.data.enriched);
				saveAll();
				showToast(`${fieldName} enriched by AI!`, 'success');
			} else {
				showToast('AI enrichment failed', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'AI enrichment failed', 'error');
		} finally {
			extending = { ...extending, [fieldName]: false };
		}
	}

	const UGC_PRESETS = [
		{
			id: 'science',
			name: '🔬 Science Breakdown',
			description: 'Deep dive into active ingredients, potency, and premium biohacking benefits.',
			template: `[UGC Format: Science Breakdown]
Hook: "If you're still taking synthetic stamina pills, stop scrolling immediately. This is raw clover honey..."
Visual Direction: Split-screen. Top shows the premium honey jar, bottom shows clear text listing: Raw Clover Honey, Siberian Ginseng, and Royal Jelly.
Talking Points:
1. Explain how Siberian Ginseng stimulates clean daily stamina without any chemical crash.
2. Highlight Royal Jelly as the ultimate biological cell revitalizer.
3. Contrast natural active minerals with synthetic pre-workout chemicals.
CTA: "Squeeze the power of pure vitality. Click below to grab your first 12-pack today."`
		},
		{
			id: 'vlog',
			name: '☀️ Before vs After Vlog',
			description: 'Relatable high-performer routine showing the vitality shift.',
			template: `[UGC Format: Before vs After Vlog]
Hook: "My energy used to crash at 3 PM every single day... until I found this raw honey hack."
Visual Direction: Morning sunlight vlog. B-roll of dragging in the morning, followed by squeezing a single performance pouch into hot tea or straight onto the tongue.
Talking Points:
1. Document the mid-day dip and brain fog associated with traditional coffee.
2. Introduce the pocket-sized Performance pouch as the ultimate desk-drawer hack.
3. Show the post-dose gym session or focus sprint with zero jitters.
CTA: "Stop crashing. Level up your daily routine with pure honey vitality."`
		},
		{
			id: 'asmr',
			name: '🍯 ASMR Taste Test & Squeeze',
			description: 'Premium sensory, dripping honey textures, and close-up crunch sounds.',
			template: `[UGC Format: ASMR Taste Test & Squeeze]
Hook: "Listen to the sound of pure, unadulterated stamina power."
Visual Direction: High-contrast close-ups. Macro shots of golden-amber honey dripping slowly from a spoon. Crisp sound of the pouch tear and squeeze.
Talking Points:
1. No talking, purely focus on the visual gold of the honey consistency.
2. Soft-whisper text on screen describing raw flavor: wildflower sweetness with herbal ginseng undertones.
3. Show the physical spoon drip and swallowing with satisfying ASMR mouth sounds.
CTA: "Satisfy your body and your taste buds. Direct link in bio."`
		}
	];

	function selectPreset(template: string) {
		ugcGuidelines = template;
		saveAll();
		showToast('Preset loaded! Feel free to edit the text.', 'success');
	}

	function exportBrief() {
		showToast('Brand brief exported', 'success');
	}

	// Trait input
	function addTrait() {
		const t = traitInput.trim();
		if (t && !traits.includes(t)) {
			traits = [...traits, t];
			traitInput = '';
		}
	}

	function removeTrait(t: string) {
		traits = traits.filter((x) => x !== t);
	}

	function handleTraitKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTrait();
		}
	}

	// Competitors
	function addCompetitor() {
		competitors = [...competitors, { id: `c${Date.now()}`, name: '', url: '', notes: '' }];
	}

	function removeCompetitor(id: string) {
		competitors = competitors.filter((c) => c.id !== id);
	}

	// Sample post preview
	let previewText = $derived(
		samplePost ||
			`Hey ${brandName || 'there'}! ✨ ${tagline || 'Check this out'} — we're all about ${traits.length > 0 ? traits.slice(0, 3).join(', ') : 'being awesome'}. #brand`
	);

	// ─── Intel Wizard State & Logic ───
	const INTEL_STORAGE_KEY = 'personagen_intel_wizard_merged';

	const INTEL_STEPS = [
		{ id: 1, label: 'Brand Discovery', icon: '🏢' },
		{ id: 2, label: 'Competitor Analysis', icon: '🔍' },
		{ id: 3, label: 'Content Audit', icon: '📋' },
		{ id: 4, label: 'Audience Mapping', icon: '🎯' },
		{ id: 5, label: 'Strategy Generation', icon: '⚡' },
		{ id: 6, label: 'Results', icon: '📊' }
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

	interface IntelStrategyResults {
		pillars: { name: string; description: string; priority: string }[];
		schedule: { day: string; time: string; type: string; platform: string }[];
		platformPriority: { platform: string; score: number; reason: string }[];
		targets: { metric: string; current: string; target30: string; target90: string }[];
	}
	let intelStrategyResults = $state<IntelStrategyResults | null>(null);

	// Synchronize with main Brand Brief state
	$effect(() => {
		if (brandName && !intelCompanyName) {
			intelCompanyName = brandName;
		}
	});

	function saveIntelToStorage() {
		if (!browser) return;
		const data = {
			intelCurrentStep,
			intelCompanyName,
			intelIndustry,
			intelTargetAudience,
			intelCompetitors,
			intelExistingContent,
			intelContentTypes,
			intelAgeMin,
			intelAgeMax,
			intelInterests,
			intelLocations
		};
		localStorage.setItem(INTEL_STORAGE_KEY, JSON.stringify(data));
	}

	function loadIntelFromStorage() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(INTEL_STORAGE_KEY);
			if (!raw) return;
			const data = JSON.parse(raw);
			if (data.intelCurrentStep) intelCurrentStep = Math.min(data.intelCurrentStep, 5);
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

	$effect(() => {
		loadIntelFromStorage();
	});

	$effect(() => {
		if (browser && intelCurrentStep < 6) {
			saveIntelToStorage();
		}
	});

	let intelStep1Valid = $derived(intelCompanyName.trim().length > 0 && intelIndustry.length > 0);
	let intelStep2Valid = $derived(intelCompetitors.some((c) => c.url.trim().length > 0));
	let intelStep3Valid = $derived(intelExistingContent.trim().length > 0 || intelContentTypes.length > 0);
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

	function nextIntelStep() {
		if (intelCurrentStep < 6 && canIntelProceed(intelCurrentStep)) {
			intelCurrentStep++;
			saveIntelToStorage();
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

	function generateIntelStrategyResults(): IntelStrategyResults {
		return {
			pillars: [
				{
					name: 'Educational Authority',
					description: `Deep-dive content establishing ${intelCompanyName || 'your brand'} as the go-to source for ${intelIndustry || 'industry'} knowledge. Focus on data-backed insights, how-to guides, and myth-busting.`,
					priority: 'Primary'
				},
				{
					name: 'Behind-the-Scenes',
					description:
						'Humanize the brand with process reveals, team spotlights, and day-in-the-life content. Builds trust and relatability with your audience.',
					priority: 'Secondary'
				},
				{
					name: 'Community Stories',
					description:
						'User-generated content, testimonials, and audience Q&A sessions. Drives engagement and creates social proof at scale.',
					priority: 'Secondary'
				},
				{
					name: 'Trend Commentary',
					description: `Real-time takes on ${intelIndustry || 'industry'} trends and news. Positions the brand as a thought leader and drives discovery through timely, shareable content.`,
					priority: 'Tertiary'
				}
			],
			schedule: [
				{ day: 'Monday', time: '8:00 AM', type: 'Educational Post', platform: 'Instagram' },
				{ day: 'Tuesday', time: '12:00 PM', type: 'Short-form Video', platform: 'TikTok' },
				{ day: 'Wednesday', time: '9:00 AM', type: 'Thread / Carousel', platform: 'X / Twitter' },
				{ day: 'Thursday', time: '7:00 AM', type: 'BTS Content', platform: 'Instagram' },
				{ day: 'Friday', time: '11:00 AM', type: 'Long-form Video', platform: 'YouTube' },
				{ day: 'Saturday', time: '10:00 AM', type: 'Community Q&A', platform: 'Instagram' },
				{ day: 'Sunday', time: '6:00 PM', type: 'Week Preview', platform: 'X / Twitter' }
			],
			platformPriority: [
				{
					platform: 'Instagram',
					score: 92,
					reason: `Best fit for ${intelTargetAudience || 'your target audience'}. High engagement potential in ${intelIndustry || 'your niche'} with Reels + Carousel format.`
				},
				{
					platform: 'TikTok',
					score: 87,
					reason:
						'Highest organic reach potential. Ideal for short-form educational and trend content targeting 18-34 demo.'
				},
				{
					platform: 'YouTube',
					score: 81,
					reason:
						'Long-form authority building. SEO benefits drive passive discovery. Best for evergreen educational content.'
				},
				{
					platform: 'X / Twitter',
					score: 74,
					reason:
						'Real-time engagement and thought leadership. Thread format works well for breaking down complex topics.'
				},
				{
					platform: 'LinkedIn',
					score: 68,
					reason:
						'Professional credibility builder. Effective for B2B reach and industry networking.'
				}
			],
			targets: [
				{ metric: 'Total Followers', current: '2,400', target30: '3,800', target90: '12,500' },
				{ metric: 'Engagement Rate', current: '2.1%', target30: '4.5%', target90: '6.8%' },
				{ metric: 'Weekly Posts', current: '3', target30: '5', target90: '7' },
				{ metric: 'Avg. Reach / Post', current: '450', target30: '1,200', target90: '4,800' },
				{ metric: 'Content Saves', current: '12/wk', target30: '45/wk', target90: '180/wk' },
				{ metric: 'Brand Mentions', current: '5/mo', target30: '20/mo', target90: '80/mo' }
			]
		};
	}

	async function generateIntelStrategy() {
		intelGenerating = true;
		await new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));
		intelStrategyResults = generateIntelStrategyResults();
		intelGenerating = false;
		intelCurrentStep = 6;
		if (browser) localStorage.removeItem(INTEL_STORAGE_KEY);
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

	function getIntelScoreColor(score: number): string {
		if (score >= 85) return 'var(--success)';
		if (score >= 70) return 'var(--cyan)';
		if (score >= 55) return 'var(--gold)';
		return 'var(--rose)';
	}
</script>

<svelte:head>
	<title>Brand Brief — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<div class="header-top">
			<div>
				<h1>Brand Brief</h1>
				<p class="subtitle">Define your brand identity for AI persona alignment.</p>
			</div>
			<div class="header-actions">
				<span class="version-badge">
					v{version}
					{lastSaved ? `— Last saved: ${lastSaved}` : '— Not saved yet'}
				</span>
				<button class="action-btn" onclick={exportBrief}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg
					>
					Export
				</button>
				<button class="action-btn primary" onclick={(e) => saveAll(e)}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline
							points="17 21 17 13 7 13 7 21"
						/><polyline points="7 3 7 8 15 8" /></svg
					>
					Save
				</button>
			</div>
		</div>
	</header>

	<!-- Tabs -->
	<div class="tabs">
		{#each TABS as tab}
			<button
				class="tab-btn"
				class:active={activeTab === tab.key}
				onclick={() => (activeTab = tab.key)}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"><path d={tab.icon} /></svg
				>
				<span>{tab.label}</span>
			</button>
		{/each}
	</div>

	<!-- Tab Content -->
	<div class="tab-body">
		{#if activeTab === 'overview'}
			<div class="panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<!-- Scraper block -->
				<div class="scrape-card">
					<div class="scrape-card-header">
						<svg
							class="scrape-badge-icon"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg
						>
						<span class="scrape-card-title">Firecrawl E-Commerce Scraper</span>
					</div>
					<p class="scrape-card-desc">
						Crawl any brand store (e.g. <code>honeyforx.com</code>) to automatically extract brand
						voice details, mission statement, demographics, and active physical product listings
						with photo references.
					</p>
					<div class="scrape-form">
						<input
							type="text"
							bind:value={storeUrl}
							class="scrape-input"
							placeholder="e.g. honeyforx.com"
						/>
						<button class="scrape-submit-btn" onclick={runScrape} disabled={scraping}>
							{#if scraping}
								<div class="btn-spinner"></div>
								Scraping Store...
							{:else}
								<span>Scrape & Populate</span>
							{/if}
						</button>
					</div>
				</div>

				<div class="panel-header-row">
					<h3>Brand Overview</h3>
				</div>
				<p class="panel-desc">Core brand positioning and messaging.</p>

				<div class="form-stack">
					<div class="field">
						<label for="brandName">Brand Name</label>
						<input
							id="brandName"
							type="text"
							bind:value={brandName}
							placeholder="e.g. PersonaGen"
						/>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="tagline">Tagline</label>
							<button
								class="enrich-btn"
								onclick={() => extendField('Tagline', tagline, (v) => (tagline = v))}
								disabled={extending['Tagline']}
							>
								{#if extending['Tagline']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Extend
								{/if}
							</button>
						</div>
						<input
							id="tagline"
							type="text"
							bind:value={tagline}
							placeholder="e.g. AI Personas That Actually Convert"
						/>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="mission">Mission Statement</label>
							<button
								class="enrich-btn"
								onclick={() => extendField('Mission Statement', mission, (v) => (mission = v))}
								disabled={extending['Mission Statement']}
							>
								{#if extending['Mission Statement']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea
							id="mission"
							bind:value={mission}
							placeholder="What is the core purpose and mission of this brand? What problem does it solve and for whom?"
							rows="5"
						></textarea>
					</div>
				</div>
			</div>
		{:else if activeTab === 'products'}
			<div class="panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<h3>Active Store Products</h3>
				<p class="panel-desc">
					Products scraped from your e-commerce store with physical reference photos for UGC
					generation.
				</p>

				<div class="products-grid">
					{#each products as prod}
						<div class="product-card">
							<div class="product-photo-wrap">
								{#if prod.photoUrl}
									<img src={prod.photoUrl} alt={prod.name} class="product-photo" />
								{:else}
									<div class="product-photo-fallback">
										<svg
											width="24"
											height="24"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											><rect x="3" y="3" width="18" height="18" rx="2" /><circle
												cx="8.5"
												cy="8.5"
												r="1.5"
											/><polyline points="21 15 16 10 5 21" /></svg
										>
										<span>No Photo</span>
									</div>
								{/if}
								<span class="product-price-badge">{prod.price}</span>
							</div>
							<div class="product-details">
								<h4 class="product-title">{prod.name}</h4>
								<p class="product-desc">{prod.description}</p>
								<div class="product-id-badge">ID: {prod.id}</div>
							</div>
						</div>
					{/each}

					{#if products.length === 0}
						<div class="products-empty">
							<svg
								width="48"
								height="48"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.2"
								opacity="0.3"
								><path
									d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"
								/></svg
							>
							<span
								>No products active. Use the <strong>Firecrawl Scraper</strong> on the Overview tab to
								crawl your site and load product photos instantly.</span
							>
						</div>
					{/if}
				</div>

				<div class="ugc-presets-section">
					<div class="divider-line"></div>
					<div class="ugc-presets-header">
						<h4>DTC UGC Meta-Prompt Presets</h4>
						<p class="presets-desc">
							Select an E-Commerce script style below to auto-populate your video format guidelines.
						</p>
					</div>

					<div class="presets-list">
						{#each UGC_PRESETS as preset}
							<button class="preset-card-btn" onclick={() => selectPreset(preset.template)}>
								<div class="preset-card-name">{preset.name}</div>
								<p class="preset-card-desc">{preset.description}</p>
							</button>
						{/each}
					</div>

					<div class="field mt-6">
						<div class="label-row">
							<label for="ugcGuidelines">UGC Formats & Script Guidelines</label>
							<button
								class="enrich-btn"
								onclick={() =>
									extendField('UGC Guidelines', ugcGuidelines, (v) => (ugcGuidelines = v))}
								disabled={extending['UGC Guidelines']}
							>
								{#if extending['UGC Guidelines']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea
							id="ugcGuidelines"
							bind:value={ugcGuidelines}
							placeholder="Choose a preset above or write custom UGC guidelines for your content here..."
							rows="8"
						></textarea>
					</div>
				</div>
			</div>
		{:else if activeTab === 'visual'}
			<div class="panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<h3>Visual Identity</h3>
				<p class="panel-desc">Colors, typography, and visual assets.</p>

				<div class="form-stack">
					<div class="color-row">
						<div class="color-field">
							<label>Primary Color</label>
							<div class="color-input-wrap">
								<input type="color" bind:value={primaryColor} class="color-picker" />
								<input type="text" bind:value={primaryColor} class="color-hex" />
								<div class="color-preview" style="background: {primaryColor}"></div>
							</div>
						</div>
						<div class="color-field">
							<label>Secondary Color</label>
							<div class="color-input-wrap">
								<input type="color" bind:value={secondaryColor} class="color-picker" />
								<input type="text" bind:value={secondaryColor} class="color-hex" />
								<div class="color-preview" style="background: {secondaryColor}"></div>
							</div>
						</div>
					</div>

					<div
						class="gradient-preview-bar"
						style="background: linear-gradient(135deg, {primaryColor}, {secondaryColor})"
					>
						<span>Brand Gradient Preview</span>
					</div>

					<div class="field">
						<label for="logoUrl">Logo URL</label>
						<div class="logo-input-wrap">
							<input
								id="logoUrl"
								type="url"
								bind:value={logoUrl}
								placeholder="https://example.com/logo.svg"
								style="flex: 1; border: none !important; background: transparent !important; box-shadow: none !important; padding: 4px 0 !important;"
							/>
							{#if logoUrl}
								<div class="logo-preview-badge">
									<img src={logoUrl} alt="Logo Preview" class="logo-badge-img" />
								</div>
							{/if}
						</div>
					</div>

					<div class="font-row">
						<div class="field">
							<label for="fontPrimary">Primary Font</label>
							<input
								id="fontPrimary"
								type="text"
								bind:value={fontPrimary}
								placeholder="e.g. Inter, Playfair Display"
							/>
						</div>
						<div class="field">
							<label for="fontSecondary">Secondary Font</label>
							<input
								id="fontSecondary"
								type="text"
								bind:value={fontSecondary}
								placeholder="e.g. IBM Plex Mono"
							/>
						</div>
					</div>
				</div>
			</div>
		{:else if activeTab === 'voice'}
			<div class="panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<h3>Voice & Tone</h3>
				<p class="panel-desc">How the brand communicates with its audience.</p>

				<div class="form-stack">
					<div class="field">
						<label>Personality Traits</label>
						<div class="tag-input-wrap">
							<div class="tags-list">
								{#each traits as trait}
									<span class="tag">
										{trait}
										<button class="tag-remove" onclick={() => removeTrait(trait)}>
											<svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												stroke-linecap="round"
												><line x1="18" y1="6" x2="6" y2="18" /><line
													x1="6"
													y1="6"
													x2="18"
													y2="18"
												/></svg
											>
										</button>
									</span>
								{/each}
							</div>
							<div class="tag-add-row">
								<input
									type="text"
									bind:value={traitInput}
									onkeydown={handleTraitKeydown}
									placeholder="Type a trait and press Enter…"
									class="tag-input"
								/>
								<button class="tag-add-btn" onclick={addTrait} disabled={!traitInput.trim()}
									>Add</button
								>
							</div>
						</div>
					</div>

					<div class="field">
						<label>Communication Style</label>
						<div class="radio-group">
							{#each COMM_STYLES as style}
								<label class="radio-card" class:selected={commStyle === style}>
									<input type="radio" name="commStyle" value={style} bind:group={commStyle} />
									<span class="radio-label">{style}</span>
								</label>
							{/each}
						</div>
					</div>

					<div class="field">
						<label for="samplePost">Custom Sample Post</label>
						<textarea
							id="samplePost"
							bind:value={samplePost}
							placeholder="Write a sample post in this brand's voice… (leave empty for auto-generated preview)"
							rows="3"
						></textarea>
					</div>

					<div class="preview-card">
						<span class="preview-label">Post Preview</span>
						<div class="preview-body">
							<div
								class="preview-avatar"
								style="background: linear-gradient(135deg, {primaryColor}, {secondaryColor})"
							>
								{brandName ? brandName.charAt(0).toUpperCase() : 'P'}
							</div>
							<div class="preview-content">
								<span class="preview-name"
									>{brandName || 'Brand'}
									<span class="preview-handle"
										>@{brandName ? brandName.toLowerCase().replace(/\s/g, '') : 'brand'}</span
									></span
								>
								<p class="preview-text">{previewText}</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		{:else if activeTab === 'audience'}
			<div class="panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<h3>Target Audience</h3>
				<p class="panel-desc">Who the brand is trying to reach.</p>

				<div class="form-stack">
					<div class="field">
						<div class="label-row">
							<label for="demographics">Demographics</label>
							<button
								class="enrich-btn"
								onclick={() => extendField('Demographics', demographics, (v) => (demographics = v))}
								disabled={extending['Demographics']}
							>
								{#if extending['Demographics']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea
							id="demographics"
							bind:value={demographics}
							placeholder="Age range, gender, location, income level, education, occupation…"
							rows="4"
						></textarea>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="interests">Interests & Behaviors</label>
							<button
								class="enrich-btn"
								onclick={() =>
									extendField('Interests & Behaviors', interests, (v) => (interests = v))}
								disabled={extending['Interests & Behaviors']}
							>
								{#if extending['Interests & Behaviors']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea
							id="interests"
							bind:value={interests}
							placeholder="Hobbies, media consumption, purchasing behaviors, lifestyle preferences…"
							rows="4"
						></textarea>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="platforms">Primary Platforms</label>
							<button
								class="enrich-btn"
								onclick={() => extendField('Primary Platforms', platforms, (v) => (platforms = v))}
								disabled={extending['Primary Platforms']}
							>
								{#if extending['Primary Platforms']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea
							id="platforms"
							bind:value={platforms}
							placeholder="Where does the audience spend time? TikTok, Instagram, YouTube, LinkedIn…"
							rows="3"
						></textarea>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="painPoints">Pain Points</label>
							<button
								class="enrich-btn"
								onclick={() => extendField('Pain Points', painPoints, (v) => (painPoints = v))}
								disabled={extending['Pain Points']}
							>
								{#if extending['Pain Points']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea
							id="painPoints"
							bind:value={painPoints}
							placeholder="What problems does this audience face that the brand solves?"
							rows="4"
						></textarea>
					</div>
				</div>
			</div>
		{:else if activeTab === 'competitors'}
			<div class="panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<h3>Competitor Analysis</h3>
				<p class="panel-desc">Track competitors and identify differentiators.</p>

				<div class="competitors-list">
					{#each competitors as comp, i (comp.id)}
						<div class="competitor-card">
							<div class="comp-header">
								<span class="comp-num">#{i + 1}</span>
								<button class="comp-remove" onclick={() => removeCompetitor(comp.id)}>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										><line x1="18" y1="6" x2="6" y2="18" /><line
											x1="6"
											y1="6"
											x2="18"
											y2="18"
										/></svg
									>
								</button>
							</div>
							<div class="comp-fields">
								<div class="field">
									<label>Name</label>
									<input type="text" bind:value={comp.name} placeholder="Competitor name" />
								</div>
								<div class="field">
									<label>URL</label>
									<input type="url" bind:value={comp.url} placeholder="https://competitor.com" />
								</div>
								<div class="field full">
									<label>Notes</label>
									<textarea
										bind:value={comp.notes}
										placeholder="Strengths, weaknesses, positioning, content strategy…"
										rows="3"
									></textarea>
								</div>
							</div>
						</div>
					{/each}

					{#if competitors.length === 0}
						<div class="empty-state">
							<svg
								width="32"
								height="32"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								opacity="0.3"
								><path
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/></svg
							>
							<span>No competitors added yet</span>
						</div>
					{/if}

					<button class="add-comp-btn" onclick={addCompetitor}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
						>
						Add Competitor
					</button>
				</div>
			</div>
		{:else if activeTab === 'intel'}
			<div class="panel intel-wizard-panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<div class="intel-wizard-header">
					<h3>Content Intelligence & Strategy Wizard</h3>
					<p class="panel-desc">6-step wizard to analyze competitors, map audiences, and generate customized content strategies.</p>
				</div>

				<!-- ─── Progress Steps ─── -->
				<div class="progress-steps">
					{#each INTEL_STEPS as s, i}
						<button
							type="button"
							class="step-dot-group"
							class:active={intelCurrentStep === s.id}
							class:completed={intelCurrentStep > s.id}
							class:disabled={s.id > intelCurrentStep + 1}
							onclick={() => goToIntelStep(s.id)}
							disabled={s.id > intelCurrentStep + 1}
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
										stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
									>
								{:else}
									<span>{s.id}</span>
								{/if}
							</div>
							<span class="step-label">{s.label}</span>
						</button>
						{#if i < INTEL_STEPS.length - 1}
							<div class="step-line" class:filled={intelCurrentStep > s.id}></div>
						{/if}
					{/each}
				</div>

				<!-- ─── Step Content ─── -->
				<div class="step-container">
					<!-- STEP 1: Brand Discovery -->
					{#if intelCurrentStep === 1}
						<div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
							<div class="step-card-header">
								<span class="step-icon">🏢</span>
								<div>
									<h4>Brand Discovery</h4>
									<p>Tell us about your brand and target market</p>
								</div>
							</div>

							<div class="form-fields">
								<div class="field">
									<label for="intel-company-name">Company / Brand Name <span class="req">*</span></label>
									<input
										id="intel-company-name"
										type="text"
										bind:value={intelCompanyName}
										placeholder="e.g. PersonaGen"
									/>
								</div>

								<div class="field">
									<label for="intel-industry-select">Industry <span class="req">*</span></label>
									<select id="intel-industry-select" bind:value={intelIndustry}>
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
							</div>
						</div>

					<!-- STEP 2: Competitor Analysis -->
					{:else if intelCurrentStep === 2}
						<div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
							<div class="step-card-header">
								<span class="step-icon">🔍</span>
								<div>
									<h4>Competitor Analysis</h4>
									<p>Add up to 5 competitor channels to analyze</p>
								</div>
							</div>

							<div class="competitors-list">
								{#each intelCompetitors as comp, i}
									<div class="competitor-row">
										<span class="comp-num">{i + 1}</span>
										<input
											type="url"
											bind:value={comp.url}
											placeholder="https://youtube.com/@competitor"
											class="comp-url"
										/>
										<select bind:value={comp.platform} class="comp-platform">
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
										>
											<svg
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
								<span class="step-icon">📋</span>
								<div>
									<h4>Content Audit</h4>
									<p>Share your existing content for analysis</p>
								</div>
							</div>

							<div class="form-fields">
								<div class="field">
									<label for="intel-existing-content">Existing Content (paste URLs or descriptions)</label>
									<textarea
										id="intel-existing-content"
										bind:value={intelExistingContent}
										placeholder="Paste links to your existing content, or describe what you've been posting. E.g.&#10;&#10;- Instagram: @mybrand (3 posts/week, mostly product photos)&#10;- Blog: mybrand.com/blog (monthly articles)&#10;- YouTube: 2 videos total"
										rows="6"
									></textarea>
								</div>

								<div class="field">
									<label>Content Types You Currently Produce</label>
									<div class="content-type-grid">
										{#each INTEL_CONTENT_TYPES_LIST as ct}
											<button
												type="button"
												class="ct-btn"
												class:active={intelContentTypes.includes(ct)}
												onclick={() => toggleIntelContentType(ct)}
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
								<span class="step-icon">🎯</span>
								<div>
									<h4>Audience Mapping</h4>
									<p>Define your ideal audience demographics and interests</p>
								</div>
							</div>

							<div class="form-fields">
								<div class="field">
									<label>Age Range: {intelAgeMin} — {intelAgeMax}</label>
									<div class="range-group">
										<div class="range-row">
											<span class="range-label">Min</span>
											<input
												type="range"
												min="13"
												max="65"
												bind:value={intelAgeMin}
												class="slider"
												oninput={() => {
													if (intelAgeMin > intelAgeMax) intelAgeMax = intelAgeMin;
												}}
											/>
											<span class="range-val">{intelAgeMin}</span>
										</div>
										<div class="range-row">
											<span class="range-label">Max</span>
											<input
												type="range"
												min="13"
												max="65"
												bind:value={intelAgeMax}
												class="slider"
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
													<button type="button" class="tag-remove" onclick={() => removeIntelInterest(tag)}>×</button>
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
									<div class="suggestions">
										{#each INTEL_INTEREST_SUGGESTIONS.filter((s) => !intelInterests.includes(s)) as sug}
											<button type="button" class="sug-btn" onclick={() => addIntelInterest(sug)}>{sug}</button>
										{/each}
									</div>
								</div>

								<div class="field">
									<label>Locations <span class="req">*</span></label>
									<div class="location-grid">
										{#each INTEL_LOCATIONS as loc}
											<button
												type="button"
												class="loc-btn"
												class:active={intelLocations.includes(loc)}
												onclick={() => toggleIntelLocation(loc)}
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
								<span class="step-icon">⚡</span>
								<div>
									<h4>Strategy Generation</h4>
									<p>Review your inputs and generate a custom strategy</p>
								</div>
							</div>

							<div class="review-grid">
								<div class="review-item">
									<h4>Brand</h4>
									<p><strong>{intelCompanyName || '—'}</strong> • {intelIndustry || '—'}</p>
									{#if intelTargetAudience}
										<p class="review-sub">{intelTargetAudience}</p>
									{/if}
								</div>

								<div class="review-item">
									<h4>Competitors</h4>
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
									<h4>Content Types</h4>
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
									<h4>Audience</h4>
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

							<button type="button" class="generate-btn" onclick={generateIntelStrategy} disabled={intelGenerating}>
								{#if intelGenerating}
									<div class="gen-spinner"></div>
									Generating Strategy...
								{:else}
									<svg
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
									Generate Strategy
								{/if}
							</button>

							{#if intelGenerating}
								<div class="gen-progress" style="animation: fadeUp 0.3s var(--ease-out)">
									<div class="gen-bar"><div class="gen-fill"></div></div>
									<p>Analyzing competitors, mapping audience, building strategy...</p>
								</div>
							{/if}
						</div>

					<!-- STEP 6: Results -->
					{:else if intelCurrentStep === 6 && intelStrategyResults}
						<div class="results-container" style="animation: fadeUp 0.4s var(--ease-out)">
							<div class="results-header-card">
								<div class="results-title">
									<h4>Strategy Report Generated</h4>
									<p>{intelCompanyName} • {intelIndustry}</p>
								</div>
								<button type="button" class="start-over-btn" onclick={startIntelOver}>
									<svg
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
							</div>

							<!-- Content Pillars -->
							<div class="result-section">
								<h4 class="section-title">
									<svg
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
								</h4>
								<div class="pillars-grid">
									{#each intelStrategyResults.pillars as pillar, i}
										<div class="pillar-card" style="animation-delay: {i * 0.08}s">
											<div class="pillar-header">
												<h5>{pillar.name}</h5>
												<span
													class="priority-tag"
													class:primary={pillar.priority === 'Primary'}
													class:secondary={pillar.priority === 'Secondary'}>{pillar.priority}</span
												>
											</div>
											<p>{pillar.description}</p>
										</div>
									{/each}
								</div>
							</div>

							<!-- Posting Schedule -->
							<div class="result-section">
								<h4 class="section-title">
									<svg
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
								</h4>
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

							<!-- Platform Priority -->
							<div class="result-section">
								<h4 class="section-title">
									<svg
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
								</h4>
								<div class="platform-cards">
									{#each intelStrategyResults.platformPriority as plat, i}
										<div class="plat-card" style="animation-delay: {i * 0.06}s">
											<div class="plat-card-header">
												<span class="plat-name">{plat.platform}</span>
												<div class="plat-score-bar">
													<div
														class="plat-score-fill"
														style="width: {plat.score}%; background: {getIntelScoreColor(plat.score)}"
													></div>
												</div>
												<span class="plat-score-num" style="color: {getIntelScoreColor(plat.score)}"
													>{plat.score}</span
												>
											</div>
											<p class="plat-reason">{plat.reason}</p>
										</div>
									{/each}
								</div>
							</div>

							<!-- Growth Targets -->
							<div class="result-section">
								<h4 class="section-title">
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="var(--success)"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line
											x1="6"
											y1="20"
											x2="6"
											y2="16"
										/></svg
									>
									Growth Targets
								</h4>
								<div class="targets-table">
									<div class="table-header targets-header">
										<span>Metric</span><span>Current</span><span>30 Days</span><span>90 Days</span>
									</div>
									{#each intelStrategyResults.targets as target}
										<div class="table-row targets-row">
											<span class="metric-cell">{target.metric}</span>
											<span class="current-cell">{target.current}</span>
											<span class="t30-cell">{target.target30}</span>
											<span class="t90-cell">{target.target90}</span>
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- ─── Navigation Buttons ─── -->
				{#if intelCurrentStep < 6}
					<div class="nav-buttons" style="margin-top: 1.5rem;">
						<button type="button" class="nav-btn back" onclick={prevIntelStep} disabled={intelCurrentStep === 1}>
							<svg
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
							<button type="button" class="nav-btn next" onclick={nextIntelStep} disabled={!canIntelProceed(intelCurrentStep)}>
								Next
								<svg
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
			</div>
		{/if}
	</div>
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

	.version-badge {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-family: var(--font-mono);
		padding: 6px 12px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		white-space: nowrap;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		font-size: 0.78rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		transition:
			border-color 0.2s,
			color 0.2s,
			transform 0.2s,
			box-shadow 0.2s;
	}
	.action-btn:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}
	.action-btn.primary {
		background: var(--gradient-subtle);
		border-color: transparent;
		color: #fff;
	}
	.action-btn.primary:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1.5rem;
		overflow-x: auto;
		padding-bottom: 0;
	}
	.tab-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.75rem 1rem;
		border: none;
		background: none;
		color: var(--text-dim);
		font-size: 0.82rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		white-space: nowrap;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition:
			color 0.2s,
			border-color 0.2s;
	}
	.tab-btn:hover {
		color: var(--text-muted);
	}
	.tab-btn.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}

	/* Panels */
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.75rem;
	}
	.panel h3 {
		font-size: var(--text-xl);
		font-family: var(--font-display);
		margin-bottom: 0.25rem;
	}
	.panel-desc {
		color: var(--text-muted);
		font-size: var(--text-base);
		margin-bottom: 1.5rem;
	}

	.form-stack {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.field {
		display: flex;
		flex-direction: column;
	}
	.field label {
		margin-bottom: 0.35rem;
	}

	/* Colors */
	.color-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem;
	}
	.color-field {
		display: flex;
		flex-direction: column;
	}
	.color-field label {
		margin-bottom: 0.35rem;
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
	}

	.color-input-wrap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 6px 10px;
	}
	.color-picker {
		width: 32px;
		height: 32px;
		border: none;
		cursor: pointer;
		background: none;
		padding: 0;
	}
	.color-hex {
		border: none !important;
		background: transparent !important;
		box-shadow: none !important;
		font-family: var(--font-mono);
		font-size: 0.82rem;
		width: 90px;
		padding: 4px !important;
	}
	.color-preview {
		width: 24px;
		height: 24px;
		border-radius: var(--radius-xs);
		flex-shrink: 0;
	}

	.logo-input-wrap {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 6px 12px;
	}
	.logo-preview-badge {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-xs);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--border-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		flex-shrink: 0;
	}
	.logo-badge-img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		padding: 2px;
	}

	.gradient-preview-bar {
		height: 40px;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--text-xs);
		color: #fff;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.font-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	/* Tags */
	.tag-input-wrap {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.75rem;
	}
	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		color: var(--accent);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.tag-remove {
		display: flex;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--accent);
		padding: 0;
		opacity: 0.6;
		transition: opacity 0.2s;
	}
	.tag-remove:hover {
		opacity: 1;
	}

	.tag-add-row {
		display: flex;
		gap: 0.5rem;
	}
	.tag-input {
		flex: 1;
		border: none !important;
		background: transparent !important;
		box-shadow: none !important;
		padding: 6px 0 !important;
		font-size: 0.85rem;
	}
	.tag-add-btn {
		padding: 4px 14px;
		border-radius: var(--radius-xs);
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		color: var(--accent);
		font-size: 0.75rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		transition: background 0.2s;
	}
	.tag-add-btn:hover {
		background: var(--accent-mid);
	}
	.tag-add-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Radio cards */
	.radio-group {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}
	.radio-card {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		border: 1px solid var(--border);
		cursor: pointer;
		transition:
			border-color 0.2s,
			background 0.2s;
	}
	.radio-card:hover {
		border-color: var(--border-hover);
	}
	.radio-card.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.radio-card input {
		display: none;
	}
	.radio-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.radio-card.selected .radio-label {
		color: var(--accent);
	}

	/* Preview */
	.preview-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.preview-label {
		display: block;
		padding: 0.5rem 1rem;
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		border-bottom: 1px solid var(--border);
	}
	.preview-body {
		display: flex;
		gap: 0.75rem;
		padding: 1rem;
	}
	.preview-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85rem;
		font-weight: 700;
		color: #fff;
	}
	.preview-content {
		flex: 1;
	}
	.preview-name {
		font-size: 0.85rem;
		font-weight: 700;
	}
	.preview-handle {
		color: var(--text-dim);
		font-weight: 400;
		font-size: 0.8rem;
	}
	.preview-text {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-top: 0.35rem;
		line-height: 1.5;
	}

	/* Competitors */
	.competitors-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.competitor-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem;
		transition: border-color 0.2s;
	}
	.competitor-card:hover {
		border-color: var(--border-hover);
	}

	.comp-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.comp-num {
		font-size: var(--text-xs);
		color: var(--accent);
		font-family: var(--font-mono);
		font-weight: 700;
	}
	.comp-remove {
		display: flex;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-dim);
		padding: 4px;
		border-radius: 4px;
		transition:
			color 0.2s,
			background 0.2s;
	}
	.comp-remove:hover {
		color: var(--error);
		background: var(--error-soft);
	}

	.comp-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.comp-fields .full {
		grid-column: span 2;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		color: var(--text-dim);
		font-size: var(--text-sm);
	}

	.add-comp-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 10px;
		border-radius: var(--radius-sm);
		border: 1px dashed var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		font-size: 0.82rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}
	.add-comp-btn:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
		background: var(--accent-soft);
	}

	/* Scrape Card */
	.scrape-card {
		background: linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(249, 115, 22, 0.04));
		border: 1px solid rgba(234, 179, 8, 0.2);
		border-radius: var(--radius-sm);
		padding: 1.5rem;
		margin-bottom: 2rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		animation: pulseGlow 4s ease-in-out infinite alternate;
	}
	@keyframes pulseGlow {
		0% {
			box-shadow: 0 0 10px rgba(234, 179, 8, 0.02);
		}
		100% {
			box-shadow: 0 0 25px rgba(234, 179, 8, 0.1);
		}
	}
	.scrape-card-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.5rem;
	}
	.scrape-badge-icon {
		color: #eab308;
	}
	.scrape-card-title {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text);
		font-family: var(--font-display);
	}
	.scrape-card-desc {
		font-size: 0.82rem;
		color: var(--text-muted);
		line-height: 1.5;
		margin-bottom: 1.25rem;
	}
	.scrape-form {
		display: flex;
		gap: 0.75rem;
	}
	.scrape-input {
		flex: 1;
		background: var(--surface-2) !important;
		border: 1px solid var(--border-strong) !important;
		border-radius: var(--radius-xs) !important;
		padding: 0.75rem 1rem !important;
		font-size: 0.85rem;
		color: var(--text);
	}
	.scrape-submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: #eab308;
		color: #0b0713;
		border: none;
		border-radius: var(--radius-xs);
		padding: 0.75rem 1.5rem;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			transform 0.2s,
			background 0.2s;
	}
	.scrape-submit-btn:hover:not(:disabled) {
		background: #ca8a04;
		transform: translateY(-1px);
	}
	.scrape-submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Label rows and AI Enrich */
	.label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.35rem;
	}
	.label-row label {
		margin-bottom: 0 !important;
	}
	.enrich-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		color: var(--accent);
		border-radius: var(--radius-full);
		padding: 3px 10px;
		font-size: 0.7rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			background 0.2s,
			transform 0.2s;
	}
	.enrich-btn:hover:not(:disabled) {
		background: var(--accent-mid);
		color: #fff;
		transform: translateY(-1px);
	}
	.enrich-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Products Grid */
	.products-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1.25rem;
		margin-bottom: 2rem;
	}
	.product-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition:
			border-color 0.2s,
			transform 0.2s;
	}
	.product-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-2px);
	}
	.product-photo-wrap {
		position: relative;
		height: 180px;
		background: var(--surface-3);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border-bottom: 1px solid var(--border);
	}
	.product-photo {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.product-photo-fallback {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		color: var(--text-dim);
		font-size: 0.8rem;
		background: var(--surface-3);
		width: 100%;
		height: 100%;
	}
	.product-price-badge {
		position: absolute;
		bottom: 0.75rem;
		right: 0.75rem;
		background: rgba(11, 7, 19, 0.85);
		border: 1px solid var(--border-strong);
		backdrop-filter: blur(4px);
		color: #eab308;
		border-radius: var(--radius-xs);
		padding: 4px 10px;
		font-size: 0.75rem;
		font-weight: 700;
		font-family: var(--font-mono);
	}
	.product-details {
		padding: 1rem;
	}
	.product-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text);
		margin-bottom: 0.35rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.product-desc {
		font-size: 0.78rem;
		color: var(--text-muted);
		line-height: 1.4;
		margin-bottom: 0.75rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		height: 2.8em;
	}
	.product-id-badge {
		display: inline-block;
		font-size: 0.65rem;
		color: var(--text-dim);
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		padding: 2px 8px;
		font-family: var(--font-mono);
	}
	.products-empty {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3.5rem 1.5rem;
		background: var(--surface);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--text-dim);
		font-size: 0.82rem;
		text-align: center;
	}

	/* UGC Presets Section */
	.ugc-presets-section {
		margin-top: 2.5rem;
	}
	.divider-line {
		height: 1px;
		background: var(--border);
		margin-bottom: 2rem;
	}
	.ugc-presets-header {
		margin-bottom: 1.25rem;
	}
	.ugc-presets-header h4 {
		font-size: 1.05rem;
		font-family: var(--font-display);
		color: var(--text);
		margin: 0 0 0.25rem 0;
	}
	.presets-desc {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
	}
	.presets-list {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.preset-card-btn {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem;
		text-align: left;
		cursor: pointer;
		font-family: var(--font-body);
		transition:
			border-color 0.2s,
			background 0.2s,
			transform 0.2s;
	}
	.preset-card-btn:hover {
		border-color: var(--accent);
		background: var(--surface-3);
		transform: translateY(-1px);
	}
	.preset-card-name {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text);
		margin-bottom: 0.25rem;
	}
	.preset-card-desc {
		font-size: 0.72rem;
		color: var(--text-muted);
		line-height: 1.35;
		margin: 0;
	}
	.mt-6 {
		margin-top: 1.5rem !important;
	}

	/* Spinners */
	.btn-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(11, 7, 19, 0.3);
		border-top-color: #0b0713;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.enrich-spinner {
		width: 10px;
		height: 10px;
		border: 1.5px solid rgba(124, 106, 237, 0.3);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.scrape-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(11, 7, 19, 0.3);
		border-top-color: #0b0713;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 640px) {
		.page {
			padding: 1rem;
		}
		.header-top {
			flex-direction: column;
		}
		.tabs {
			gap: 0;
		}
		.tab-btn {
			padding: 0.6rem 0.65rem;
			font-size: 0.72rem;
		}
		.tab-btn span {
			display: none;
		}
		.color-row {
			grid-template-columns: 1fr;
		}
		.font-row {
			grid-template-columns: 1fr;
		}
		.radio-group {
			grid-template-columns: repeat(2, 1fr);
		}
		.comp-fields {
			grid-template-columns: 1fr;
		}
		.comp-fields .full {
			grid-column: span 1;
		}
		.panel {
			padding: 1.25rem;
		}
	}

	/* ─── Intel Wizard Merged Styles ─── */
	.intel-wizard-panel {
		animation: fadeUp 0.25s var(--ease-out);
	}

	.intel-wizard-panel .intel-wizard-header {
		margin-bottom: 2rem;
	}

	.intel-wizard-panel .progress-steps {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0;
		margin-bottom: 2.5rem;
		padding: 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow-x: auto;
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
		box-shadow: 0 0 20px rgba(124, 106, 237, 0.2);
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
		font-size: 2rem;
	}

	.intel-wizard-panel .step-card-header h4 {
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
		color: var(--rose);
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
	}

	.intel-wizard-panel .comp-platform {
		width: 140px;
		flex-shrink: 0;
	}

	.intel-wizard-panel .comp-remove {
		width: 32px;
		height: 32px;
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
		box-shadow: 0 0 10px rgba(124, 106, 237, 0.3);
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
		gap: 0.4rem;
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
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: 1rem;
		padding: 0;
		line-height: 1;
		transition: color 0.2s ease;
	}

	.intel-wizard-panel .tag-remove:hover {
		color: var(--error);
	}

	.intel-wizard-panel .tag-input {
		border: none !important;
		background: transparent !important;
		padding: 0.3rem 0.5rem !important;
		font-size: 0.85rem;
		flex: 1;
		min-width: 120px;
		outline: none;
		box-shadow: none !important;
	}

	.intel-wizard-panel .suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.intel-wizard-panel .sug-btn {
		padding: 0.25rem 0.6rem;
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

	.intel-wizard-panel .review-item h4 {
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
		box-shadow: 0 8px 30px rgba(124, 106, 237, 0.3);
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

	.intel-wizard-panel .gen-progress p {
		color: var(--text-dim);
		font-size: 0.82rem;
	}

	.intel-wizard-panel .results-header-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem 2rem;
		margin-bottom: 1.5rem;
	}

	.intel-wizard-panel .results-title h4 {
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

	.intel-wizard-panel .pillar-header h5 {
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
	}
	.intel-wizard-panel .t30-cell {
		color: var(--gold);
		font-weight: 600;
	}
	.intel-wizard-panel .t90-cell {
		color: var(--success);
		font-weight: 600;
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
		height: 6px;
		background: var(--surface-3);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.intel-wizard-panel .plat-score-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width 0.5s var(--ease-out);
	}

	.intel-wizard-panel .plat-score-num {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		font-weight: 700;
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
		margin-top: 2rem;
	}

	.intel-wizard-panel .nav-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
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
</style>
