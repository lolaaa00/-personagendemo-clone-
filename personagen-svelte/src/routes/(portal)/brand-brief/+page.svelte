<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { browser } from '$app/environment';
	import { BrandBrief } from '$lib/services/api';

	const LS_KEY = 'personagen_brand_brief';

	type TabKey = 'overview' | 'products' | 'visual' | 'voice' | 'audience' | 'competitors';

	const TABS: { key: TabKey; label: string; icon: string }[] = [
		{ key: 'overview', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
		{ key: 'products', label: 'Products & UGC', icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z' },
		{ key: 'visual', label: 'Visual Identity', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01' },
		{ key: 'voice', label: 'Voice & Tone', icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
		{ key: 'audience', label: 'Target Audience', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
		{ key: 'competitors', label: 'Competitors', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' }
	];

	const COMM_STYLES = ['Casual', 'Professional', 'Bold', 'Minimal'];

	let activeTab = $state<TabKey>('overview');

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
		} catch { /* ignore */ }
	});

	function saveAll() {
		if (!browser) return;
		const now = new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
		lastSaved = now;
		localStorage.setItem(LS_KEY, JSON.stringify({
			brandName, tagline, mission,
			primaryColor, secondaryColor, logoUrl, fontPrimary, fontSecondary,
			traits, commStyle, samplePost,
			demographics, interests, platforms, painPoints,
			competitors, products, ugcGuidelines, storeUrl, lastSaved: now, version
		}));
		showToast('Brand brief saved', 'success');
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
				traits = d.traits || traits;
				commStyle = d.commStyle || commStyle;
				demographics = d.demographics || demographics;
				interests = d.interests || interests;
				platforms = d.platforms || platforms;
				painPoints = d.painPoints || painPoints;
				products = d.products || products;
				
				saveAll();
				showToast(`Successfully scraped ${brandName}! Imported ${products.length} products with photos.`, 'success');
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
		if (e.key === 'Enter') { e.preventDefault(); addTrait(); }
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
		samplePost || `Hey ${brandName || 'there'}! ✨ ${tagline || 'Check this out'} — we're all about ${traits.length > 0 ? traits.slice(0, 3).join(', ') : 'being awesome'}. #brand`
	);
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
					v{version} {lastSaved ? `— Last saved: ${lastSaved}` : '— Not saved yet'}
				</span>
				<button class="action-btn" onclick={exportBrief}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
					Export
				</button>
				<button class="action-btn primary" onclick={saveAll}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
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
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={tab.icon}/></svg>
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
						<svg class="scrape-badge-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
						<span class="scrape-card-title">Firecrawl E-Commerce Scraper</span>
					</div>
					<p class="scrape-card-desc">
						Crawl any brand store (e.g. <code>honeyforx.com</code>) to automatically extract brand voice details, mission statement, demographics, and active physical product listings with photo references.
					</p>
					<div class="scrape-form">
						<input type="text" bind:value={storeUrl} class="scrape-input" placeholder="e.g. honeyforx.com" />
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
						<input id="brandName" type="text" bind:value={brandName} placeholder="e.g. PersonaGen" />
					</div>
					<div class="field">
						<div class="label-row">
							<label for="tagline">Tagline</label>
							<button class="enrich-btn" onclick={() => extendField('Tagline', tagline, (v) => tagline = v)} disabled={extending['Tagline']}>
								{#if extending['Tagline']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Extend
								{/if}
							</button>
						</div>
						<input id="tagline" type="text" bind:value={tagline} placeholder="e.g. AI Personas That Actually Convert" />
					</div>
					<div class="field">
						<div class="label-row">
							<label for="mission">Mission Statement</label>
							<button class="enrich-btn" onclick={() => extendField('Mission Statement', mission, (v) => mission = v)} disabled={extending['Mission Statement']}>
								{#if extending['Mission Statement']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea id="mission" bind:value={mission} placeholder="What is the core purpose and mission of this brand? What problem does it solve and for whom?" rows="5"></textarea>
					</div>
				</div>
			</div>

		{:else if activeTab === 'products'}
			<div class="panel" style="animation: fadeUp 0.25s var(--ease-out);">
				<h3>Active Store Products</h3>
				<p class="panel-desc">Products scraped from your e-commerce store with physical reference photos for UGC generation.</p>

				<div class="products-grid">
					{#each products as prod}
						<div class="product-card">
							<div class="product-photo-wrap">
								{#if prod.photoUrl}
									<img src={prod.photoUrl} alt={prod.name} class="product-photo" />
								{:else}
									<div class="product-photo-fallback">
										<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
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
							<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
							<span>No products active. Use the <strong>Firecrawl Scraper</strong> on the Overview tab to crawl your site and load product photos instantly.</span>
						</div>
					{/if}
				</div>

				<div class="ugc-presets-section">
					<div class="divider-line"></div>
					<div class="ugc-presets-header">
						<h4>DTC UGC Meta-Prompt Presets</h4>
						<p class="presets-desc">Select an E-Commerce script style below to auto-populate your video format guidelines.</p>
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
							<button class="enrich-btn" onclick={() => extendField('UGC Guidelines', ugcGuidelines, (v) => ugcGuidelines = v)} disabled={extending['UGC Guidelines']}>
								{#if extending['UGC Guidelines']}
									<div class="enrich-spinner"></div>
									Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea id="ugcGuidelines" bind:value={ugcGuidelines} placeholder="Choose a preset above or write custom UGC guidelines for your content here..." rows="8"></textarea>
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

					<div class="gradient-preview-bar" style="background: linear-gradient(135deg, {primaryColor}, {secondaryColor})">
						<span>Brand Gradient Preview</span>
					</div>

					<div class="field">
						<label for="logoUrl">Logo URL</label>
						<input id="logoUrl" type="url" bind:value={logoUrl} placeholder="https://example.com/logo.svg" />
					</div>

					<div class="font-row">
						<div class="field">
							<label for="fontPrimary">Primary Font</label>
							<input id="fontPrimary" type="text" bind:value={fontPrimary} placeholder="e.g. Inter, Playfair Display" />
						</div>
						<div class="field">
							<label for="fontSecondary">Secondary Font</label>
							<input id="fontSecondary" type="text" bind:value={fontSecondary} placeholder="e.g. IBM Plex Mono" />
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
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
								<button class="tag-add-btn" onclick={addTrait} disabled={!traitInput.trim()}>Add</button>
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
						<textarea id="samplePost" bind:value={samplePost} placeholder="Write a sample post in this brand's voice… (leave empty for auto-generated preview)" rows="3"></textarea>
					</div>

					<div class="preview-card">
						<span class="preview-label">Post Preview</span>
						<div class="preview-body">
							<div class="preview-avatar" style="background: linear-gradient(135deg, {primaryColor}, {secondaryColor})">
								{brandName ? brandName.charAt(0).toUpperCase() : 'P'}
							</div>
							<div class="preview-content">
								<span class="preview-name">{brandName || 'Brand'} <span class="preview-handle">@{brandName ? brandName.toLowerCase().replace(/\s/g, '') : 'brand'}</span></span>
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
							<button class="enrich-btn" onclick={() => extendField('Demographics', demographics, (v) => demographics = v)} disabled={extending['Demographics']}>
								{#if extending['Demographics']}
									<div class="enrich-spinner"></div>Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea id="demographics" bind:value={demographics} placeholder="Age range, gender, location, income level, education, occupation…" rows="4"></textarea>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="interests">Interests & Behaviors</label>
							<button class="enrich-btn" onclick={() => extendField('Interests & Behaviors', interests, (v) => interests = v)} disabled={extending['Interests & Behaviors']}>
								{#if extending['Interests & Behaviors']}
									<div class="enrich-spinner"></div>Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea id="interests" bind:value={interests} placeholder="Hobbies, media consumption, purchasing behaviors, lifestyle preferences…" rows="4"></textarea>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="platforms">Primary Platforms</label>
							<button class="enrich-btn" onclick={() => extendField('Primary Platforms', platforms, (v) => platforms = v)} disabled={extending['Primary Platforms']}>
								{#if extending['Primary Platforms']}
									<div class="enrich-spinner"></div>Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea id="platforms" bind:value={platforms} placeholder="Where does the audience spend time? TikTok, Instagram, YouTube, LinkedIn…" rows="3"></textarea>
					</div>
					<div class="field">
						<div class="label-row">
							<label for="painPoints">Pain Points</label>
							<button class="enrich-btn" onclick={() => extendField('Pain Points', painPoints, (v) => painPoints = v)} disabled={extending['Pain Points']}>
								{#if extending['Pain Points']}
									<div class="enrich-spinner"></div>Enriching...
								{:else}
									✨ AI Enrich
								{/if}
							</button>
						</div>
						<textarea id="painPoints" bind:value={painPoints} placeholder="What problems does this audience face that the brand solves?" rows="4"></textarea>
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
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
									<textarea bind:value={comp.notes} placeholder="Strengths, weaknesses, positioning, content strategy…" rows="3"></textarea>
								</div>
							</div>
						</div>
					{/each}

					{#if competitors.length === 0}
						<div class="empty-state">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
							<span>No competitors added yet</span>
						</div>
					{/if}

					<button class="add-comp-btn" onclick={addCompetitor}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
						Add Competitor
					</button>
				</div>
			</div>
		{/if}
	</div>
</section>

<style>
	.page { padding: 2rem; max-width: 960px; margin: 0 auto; }

	.page-header { margin-bottom: 1.5rem; }
	.header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
	.page-header h1 { font-size: var(--text-3xl); background: var(--gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
	.subtitle { color: var(--text-muted); font-size: var(--text-base); margin-top: 0.25rem; }

	.header-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }

	.version-badge {
		font-size: var(--text-xs); color: var(--text-dim); font-family: var(--font-mono);
		padding: 6px 12px; background: var(--surface-2); border: 1px solid var(--border);
		border-radius: var(--radius-full); white-space: nowrap;
	}

	.action-btn {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 8px 16px; border-radius: var(--radius-xs);
		border: 1px solid var(--border-strong); background: transparent;
		color: var(--text-muted); font-size: 0.78rem; cursor: pointer;
		font-family: var(--font-body); font-weight: 600;
		transition: border-color 0.2s, color 0.2s, transform 0.2s, box-shadow 0.2s;
	}
	.action-btn:hover { border-color: var(--accent-mid); color: var(--text); }
	.action-btn.primary {
		background: var(--gradient-subtle); border-color: transparent; color: #fff;
	}
	.action-btn.primary:hover { transform: translateY(-1px); box-shadow: var(--shadow-accent); }

	/* Tabs */
	.tabs {
		display: flex; gap: 0.25rem; border-bottom: 1px solid var(--border);
		margin-bottom: 1.5rem; overflow-x: auto; padding-bottom: 0;
	}
	.tab-btn {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 0.75rem 1rem; border: none; background: none;
		color: var(--text-dim); font-size: 0.82rem; cursor: pointer;
		font-family: var(--font-body); font-weight: 600; white-space: nowrap;
		border-bottom: 2px solid transparent; margin-bottom: -1px;
		transition: color 0.2s, border-color 0.2s;
	}
	.tab-btn:hover { color: var(--text-muted); }
	.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

	/* Panels */
	.panel {
		background: var(--surface); border: 1px solid var(--border);
		border-radius: var(--radius); padding: 1.75rem;
	}
	.panel h3 { font-size: var(--text-xl); font-family: var(--font-display); margin-bottom: 0.25rem; }
	.panel-desc { color: var(--text-muted); font-size: var(--text-base); margin-bottom: 1.5rem; }

	.form-stack { display: flex; flex-direction: column; gap: 1.25rem; }
	.field { display: flex; flex-direction: column; }
	.field label { margin-bottom: 0.35rem; }

	/* Colors */
	.color-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
	.color-field { display: flex; flex-direction: column; }
	.color-field label { margin-bottom: 0.35rem; font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: var(--tracking-wider); color: var(--text-dim); }

	.color-input-wrap {
		display: flex; align-items: center; gap: 0.5rem;
		background: var(--surface-2); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 6px 10px;
	}
	.color-picker { width: 32px; height: 32px; border: none; cursor: pointer; background: none; padding: 0; }
	.color-hex {
		border: none !important; background: transparent !important;
		box-shadow: none !important; font-family: var(--font-mono);
		font-size: 0.82rem; width: 90px; padding: 4px !important;
	}
	.color-preview { width: 24px; height: 24px; border-radius: var(--radius-xs); flex-shrink: 0; }

	.gradient-preview-bar {
		height: 40px; border-radius: var(--radius-sm);
		display: flex; align-items: center; justify-content: center;
		font-size: var(--text-xs); color: #fff; font-weight: 600;
		text-transform: uppercase; letter-spacing: var(--tracking-wider);
		text-shadow: 0 1px 3px rgba(0,0,0,0.3);
	}

	.font-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }

	/* Tags */
	.tag-input-wrap {
		background: var(--surface-2); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 0.75rem;
	}
	.tags-list { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.5rem; }
	.tag {
		display: inline-flex; align-items: center; gap: 4px;
		padding: 4px 10px; border-radius: var(--radius-full);
		background: var(--accent-soft); border: 1px solid var(--accent-mid);
		color: var(--accent); font-size: 0.75rem; font-weight: 600;
	}
	.tag-remove {
		display: flex; background: none; border: none; cursor: pointer; color: var(--accent);
		padding: 0; opacity: 0.6; transition: opacity 0.2s;
	}
	.tag-remove:hover { opacity: 1; }

	.tag-add-row { display: flex; gap: 0.5rem; }
	.tag-input {
		flex: 1; border: none !important; background: transparent !important;
		box-shadow: none !important; padding: 6px 0 !important; font-size: 0.85rem;
	}
	.tag-add-btn {
		padding: 4px 14px; border-radius: var(--radius-xs);
		background: var(--accent-soft); border: 1px solid var(--accent-mid);
		color: var(--accent); font-size: 0.75rem; cursor: pointer;
		font-family: var(--font-body); font-weight: 600;
		transition: background 0.2s;
	}
	.tag-add-btn:hover { background: var(--accent-mid); }
	.tag-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	/* Radio cards */
	.radio-group { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
	.radio-card {
		display: flex; align-items: center; justify-content: center;
		padding: 0.75rem; border-radius: var(--radius-sm);
		background: var(--surface-2); border: 1px solid var(--border);
		cursor: pointer; transition: border-color 0.2s, background 0.2s;
	}
	.radio-card:hover { border-color: var(--border-hover); }
	.radio-card.selected { border-color: var(--accent); background: var(--accent-soft); }
	.radio-card input { display: none; }
	.radio-label { font-size: 0.82rem; font-weight: 600; color: var(--text-muted); }
	.radio-card.selected .radio-label { color: var(--accent); }

	/* Preview */
	.preview-card {
		background: var(--surface-2); border: 1px solid var(--border);
		border-radius: var(--radius-sm); overflow: hidden;
	}
	.preview-label {
		display: block; padding: 0.5rem 1rem; font-size: var(--text-xs);
		color: var(--text-dim); font-weight: 700; text-transform: uppercase;
		letter-spacing: var(--tracking-wider); border-bottom: 1px solid var(--border);
	}
	.preview-body { display: flex; gap: 0.75rem; padding: 1rem; }
	.preview-avatar {
		width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		font-size: 0.85rem; font-weight: 700; color: #fff;
	}
	.preview-content { flex: 1; }
	.preview-name { font-size: 0.85rem; font-weight: 700; }
	.preview-handle { color: var(--text-dim); font-weight: 400; font-size: 0.8rem; }
	.preview-text { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.35rem; line-height: 1.5; }

	/* Competitors */
	.competitors-list { display: flex; flex-direction: column; gap: 0.75rem; }

	.competitor-card {
		background: var(--surface-2); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 1rem;
		transition: border-color 0.2s;
	}
	.competitor-card:hover { border-color: var(--border-hover); }

	.comp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
	.comp-num { font-size: var(--text-xs); color: var(--accent); font-family: var(--font-mono); font-weight: 700; }
	.comp-remove {
		display: flex; background: none; border: none; cursor: pointer;
		color: var(--text-dim); padding: 4px; border-radius: 4px;
		transition: color 0.2s, background 0.2s;
	}
	.comp-remove:hover { color: var(--error); background: var(--error-soft); }

	.comp-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
	.comp-fields .full { grid-column: span 2; }

	.empty-state {
		display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
		padding: 2.5rem 1rem; color: var(--text-dim); font-size: var(--text-sm);
	}

	.add-comp-btn {
		display: inline-flex; align-items: center; justify-content: center; gap: 6px;
		padding: 10px; border-radius: var(--radius-sm);
		border: 1px dashed var(--border-strong); background: transparent;
		color: var(--text-muted); font-size: 0.82rem; cursor: pointer;
		font-family: var(--font-body); font-weight: 600;
		transition: border-color 0.2s, color 0.2s, background 0.2s;
	}
	.add-comp-btn:hover { border-color: var(--accent-mid); color: var(--accent); background: var(--accent-soft); }

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
		0% { box-shadow: 0 0 10px rgba(234, 179, 8, 0.02); }
		100% { box-shadow: 0 0 25px rgba(234, 179, 8, 0.1); }
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
		transition: transform 0.2s, background 0.2s;
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
		transition: background 0.2s, transform 0.2s;
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
		transition: border-color 0.2s, transform 0.2s;
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
		transition: border-color 0.2s, background 0.2s, transform 0.2s;
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
		to { transform: rotate(360deg); }
	}

	@media (max-width: 640px) {
		.page { padding: 1rem; }
		.header-top { flex-direction: column; }
		.tabs { gap: 0; }
		.tab-btn { padding: 0.6rem 0.65rem; font-size: 0.72rem; }
		.tab-btn span { display: none; }
		.color-row { grid-template-columns: 1fr; }
		.font-row { grid-template-columns: 1fr; }
		.radio-group { grid-template-columns: repeat(2, 1fr); }
		.comp-fields { grid-template-columns: 1fr; }
		.comp-fields .full { grid-column: span 1; }
		.panel { padding: 1.25rem; }
	}
</style>
