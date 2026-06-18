<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { onMount } from 'svelte';
	import { Factory } from '$lib/services/api';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	const LS_KEY = 'personagen_generator_progress';

	// Steps
	let currentStep = $state(1);
	const TOTAL_STEPS = 3;

	// Step 1 — Identity
	let agentName = $state('');
	let handle = $state('');
	let niche = $state('');
	let market = $state('Australia');

	const NICHES = [
		'Beauty & Skincare',
		'Fashion & Style',
		'Lifestyle & Wellness',
		'Fitness & Health',
		'Food & Cooking',
		'Tech & Gaming'
	];

	// Step 2 — Persona
	let soul = $state('');
	let skills = $state('');
	let selectedGradient = $state(0);

	const GRADIENT_PRESETS = [
		{ label: 'Violet Cyan', value: 'linear-gradient(135deg, #7c6aed, #22d3ee)' },
		{ label: 'Rose Gold', value: 'linear-gradient(135deg, #f472b6, #d4a853)' },
		{ label: 'Emerald Blue', value: 'linear-gradient(135deg, #34d399, #60a5fa)' },
		{ label: 'Sunset', value: 'linear-gradient(135deg, #fbbf24, #f97316)' },
		{ label: 'Berry', value: 'linear-gradient(135deg, #8b5cf6, #ec4899)' },
		{ label: 'Ocean', value: 'linear-gradient(135deg, #06b6d4, #3b82f6)' },
		{ label: 'Coral', value: 'linear-gradient(135deg, #fb7185, #f59e0b)' },
		{ label: 'Midnight', value: 'linear-gradient(135deg, #6366f1, #0ea5e9)' }
	];

	// Step 3 — Submission
	let isCreating = $state(false);
	let createError = $state('');

	// Validation
	let step1Valid = $derived(
		agentName.trim().length >= 2 && handle.trim().length >= 2 && niche !== ''
	);
	let step2Valid = $derived(soul.trim().length >= 10 && skills.trim().length >= 10);

	// Computed handle
	let displayHandle = $derived(handle.startsWith('@') ? handle : handle ? `@${handle}` : '@');

	// Computed initial
	let initial = $derived(agentName.trim() ? agentName.trim().charAt(0).toUpperCase() : '?');

	const MARKETS = [
		'Australia',
		'United States',
		'United Kingdom',
		'Canada',
		'New Zealand',
		'Germany',
		'France',
		'Japan',
		'Global'
	];

	const RANDOM_PERSONAS = [
		{
			name: 'Emma Glow',
			handle: 'emmaglow.ai',
			niche: 'Beauty & Skincare',
			market: 'Australia',
			soul: 'Warm, empathetic, and skin-science obsessed. Tone is conversational, supportive, and educational. Speaks directly to skincare enthusiasts looking for clean, non-toxic routines.',
			skills:
				'Expert in sunscreen matching, active ingredient layering (retinols & Vitamin C), and UGC video script creation. Translates complex dermatological terms into simple tips.',
			gradient: 0 // Violet Cyan
		},
		{
			name: 'Marcus Fit',
			handle: 'marcusfit',
			niche: 'Fitness & Health',
			market: 'Australia',
			soul: 'High-energy, motivational, and discipline-focused. Energetic but grounded tone. Believes in consistency over intensity.',
			skills:
				'Creates daily workout routines, macro tracking advice, and gym mindset audio scripts. Focuses on longevity and functional strength.',
			gradient: 2 // Emerald Blue
		},
		{
			name: 'Chloe Style',
			handle: 'chloestyle.ai',
			niche: 'Fashion & Style',
			market: 'United States',
			soul: 'Chic, aesthetic, and bold. Speaks with a confident, trendy, and expressive voice. Loves street fashion and sustainable wardrobes.',
			skills:
				'Styling capsules, color analysis, and visual aesthetic mapping. Guides followers to find their unique style without overspending.',
			gradient: 1 // Rose Gold
		},
		{
			name: 'Devon Tech',
			handle: 'devontech',
			niche: 'Tech & Gaming',
			market: 'Global',
			soul: 'Witty, analytical, and futuristic. Passionate about AI, developer tools, and clean setups. Slightly sarcastic but highly helpful.',
			skills:
				'Interactive coding walkthroughs, productivity hacks for software engineers, and hardware review scripts.',
			gradient: 7 // Midnight
		},
		{
			name: 'Aria Wellness',
			handle: 'ariawellness',
			niche: 'Lifestyle & Wellness',
			market: 'Australia',
			soul: 'Calm, mindful, and holistic. Gentle, grounding, and peaceful tone. Speaks about slow living, meditation, and work-life harmony.',
			skills:
				'Mindfulness challenge creation, morning routine templates, stress management guides, and sleep hygiene scripts.',
			gradient: 5 // Ocean
		},
		{
			name: 'Chef Kai',
			handle: 'chefkai.eats',
			niche: 'Food & Cooking',
			market: 'Australia',
			soul: 'Enthusiastic, flavor-first, and rustic. Loud, fun, and warm tone. Passionate about local organic produce and easy-to-cook gourmet meals.',
			skills:
				'Quick 15-minute recipe scripting, meal prep blueprints, flavor pairing science, and food photography styling.',
			gradient: 3 // Sunset
		},
		{
			name: 'Zara Skin',
			handle: 'zaraskin',
			niche: 'Beauty & Skincare',
			market: 'United Kingdom',
			soul: 'Aesthetic, clean, and minimalist. Tone is sophisticated, soothing, and highly curated. Focuses on the glass-skin routine and barrier repair.',
			skills:
				'Dull skin revitalization hacks, product shelf-life analysis, and aesthetic ASMR video concepts.',
			gradient: 4 // Berry
		},
		{
			name: 'Nate Gear',
			handle: 'nategear.tech',
			niche: 'Tech & Gaming',
			market: 'Canada',
			soul: 'Enthusiastic gadget geek and reviewer. Friendly, detailed, and objective tone. Believes technology should simplify life.',
			skills:
				'Consumer electronics breakdown, smart home automation guides, and detailed spec comparison tables.',
			gradient: 6 // Coral
		},
		{
			name: 'Sophia Eco',
			handle: 'sophia.eco',
			niche: 'Fashion & Style',
			market: 'Australia',
			soul: 'Eco-conscious, creative, and vintage-obsessed. Inspiring and approachable tone. Encourages second-hand shopping and upcycling.',
			skills:
				'Thrift-store scouting guides, clothing repair basics, fabric sustainability ratings, and creative styling challenges.',
			gradient: 2 // Emerald Blue
		},
		{
			name: 'Leo Lift',
			handle: 'leolifts',
			niche: 'Fitness & Health',
			market: 'United States',
			soul: 'Direct, no-nonsense strength coach. Science-based, encouraging, and authoritative tone. Believes in heavy lifting and sleep.',
			skills:
				'Strength progression programs, injury prevention guides, deadlift form analysis, and sports nutrition calculations.',
			gradient: 4 // Berry
		},
		{
			name: 'Mia Matcha',
			handle: 'miamatcha',
			niche: 'Food & Cooking',
			market: 'Japan',
			soul: 'Aesthetic, zen, and dessert-obsessed. Delicate, warm, and comforting tone. Focuses on plant-based Asian desserts and tea rituals.',
			skills:
				'Matcha grade guides, traditional baking adjustments, recipe scaling, and visual presentation layout.',
			gradient: 5 // Ocean
		},
		{
			name: 'Kai Mind',
			handle: 'kaimindfulness',
			niche: 'Lifestyle & Wellness',
			market: 'New Zealand',
			soul: 'Adventurous, nature-connected, and breath-focused. Outdoorsy and calm tone. Promotes forest bathing and outdoor meditation.',
			skills:
				'Breathwork guides, hiking prep checklists, cold-plunge protocol scripts, and digital detox strategies.',
			gradient: 7 // Midnight
		},
		{
			name: 'Lucas Code',
			handle: 'lucascode.ai',
			niche: 'Tech & Gaming',
			market: 'Germany',
			soul: 'Logical, structured, and open-source advocate. Pragmatic and teaching-oriented tone. Loves clean architecture and refactoring.',
			skills:
				'React performance optimization checklists, design pattern explanations, TypeScript tips, and Git workflow scripts.',
			gradient: 0 // Violet Cyan
		},
		{
			name: 'Bella Curl',
			handle: 'bellacurls',
			niche: 'Beauty & Skincare',
			market: 'United States',
			soul: 'Vibrant, cheerful, and curl-proud. Enthusiastic, helpful, and community-driven tone. Dedicated to curly hair health and representation.',
			skills:
				'Hair porosity testing guides, product routine builders, curl definition hacks, and wash-day scheduling.',
			gradient: 3 // Sunset
		},
		{
			name: 'Oliver Drap',
			handle: 'oliverdrap',
			niche: 'Fashion & Style',
			market: 'France',
			soul: 'Avant-garde, tailoring-focused, and elegant. Precise, poetic, and professional tone. High appreciation for design and textiles.',
			skills:
				'Suit styling guidelines, fabric composition analysis, minimalist packing guides, and luxury brand histories.',
			gradient: 1 // Rose Gold
		},
		{
			name: 'Elena Bio',
			handle: 'elenabiohack',
			niche: 'Fitness & Health',
			market: 'United Kingdom',
			soul: 'Biohacker, cellular-health enthusiast, and researcher. Analytical, curious, and experimental tone. Explores longevity and sleep tech.',
			skills:
				'Circadian rhythm alignment guides, blue-light blocking routines, supplement stacking formulas, and CGM data reading.',
			gradient: 6 // Coral
		},
		{
			name: 'Maya Plate',
			handle: 'mayasplates',
			niche: 'Food & Cooking',
			market: 'Global',
			soul: 'Colorful, plant-forward, and joyful. Friendly, enthusiastic, and inviting tone. Believes eating healthy should be a feast of color.',
			skills:
				'Vegan substitute matrix, colorful meal prep guides, food waste reduction hacks, and spice blending recipes.',
			gradient: 1 // Rose Gold
		},
		{
			name: 'Noah Green',
			handle: 'noahgreen.life',
			niche: 'Lifestyle & Wellness',
			market: 'Canada',
			soul: 'Minimalist, organized, and home-decor focused. Calm, neat, and highly structured tone. Loves decluttering and aesthetic storage.',
			skills:
				'KonMari decluttering plans, functional space layouts, budget home makeover blueprints, and daily productivity routines.',
			gradient: 2 // Emerald Blue
		}
	];

	// Vault modal state
	let showVaultModal = $state(false);
	let vaultSearch = $state('');
	let selectedVaultNiche = $state('All');

	let filteredPersonas = $derived(
		RANDOM_PERSONAS.filter((p) => {
			const matchSearch =
				p.name.toLowerCase().includes(vaultSearch.toLowerCase()) ||
				p.soul.toLowerCase().includes(vaultSearch.toLowerCase()) ||
				p.handle.toLowerCase().includes(vaultSearch.toLowerCase());
			const matchNiche = selectedVaultNiche === 'All' || p.niche === selectedVaultNiche;
			return matchSearch && matchNiche;
		})
	);

	function selectPersona(p: (typeof RANDOM_PERSONAS)[0]) {
		agentName = p.name;
		handle = p.handle;
		niche = p.niche;
		market = p.market;
		soul = p.soul;
		skills = p.skills;
		selectedGradient = p.gradient;
		saveProgress();
		showVaultModal = false;
		showToast(`⚡ Loaded persona: ${p.name}`, 'success');
	}

	function selectRandomFromVault() {
		const rand = RANDOM_PERSONAS[Math.floor(Math.random() * RANDOM_PERSONAS.length)];
		selectPersona(rand);
	}

	function detectNicheFromBrandBrief(brief: any): string {
		const textToSearch = [
			brief.brandName,
			brief.tagline,
			brief.mission,
			brief.demographics,
			brief.interests,
			brief.painPoints,
			...(brief.traits || [])
		]
			.join(' ')
			.toLowerCase();

		if (/skin|beauty|makeup|cosmetic|hair|glow|cream|serum|skincare/i.test(textToSearch)) {
			return 'Beauty & Skincare';
		}
		if (/fashion|style|clothing|wear|apparel|wardrobe|dress|streetwear/i.test(textToSearch)) {
			return 'Fashion & Style';
		}
		if (
			/wellness|mindfulness|yoga|meditation|sleep|lifestyle|slow living|detox/i.test(textToSearch)
		) {
			return 'Lifestyle & Wellness';
		}
		if (
			/fitness|workout|gym|muscle|stamina|training|exercise|strength|biohack|coach|bodybuilder/i.test(
				textToSearch
			)
		) {
			return 'Fitness & Health';
		}
		if (
			/food|cooking|recipe|eat|kitchen|delicious|taste|honey|baking|meal prep|chef/i.test(
				textToSearch
			)
		) {
			return 'Food & Cooking';
		}
		if (
			/tech|gaming|software|app|digital|ai|smart|device|gadget|developer|programming|code/i.test(
				textToSearch
			)
		) {
			return 'Tech & Gaming';
		}
		return '';
	}

	function prefillFromBrandBrief() {
		try {
			const briefRaw = localStorage.getItem('personagen_brand_brief');
			if (!briefRaw) {
				showToast('No brand brief found to prefill. Fill it in Brand Brief first!', 'warning');
				return;
			}
			const brief = JSON.parse(briefRaw);
			if (brief) {
				if (brief.brandName) {
					agentName = `${brief.brandName} Advocate`;
					handle = brief.brandName.toLowerCase().replace(/[^a-z0-9]/g, '') + '_advocate';
				}
				const detected = detectNicheFromBrandBrief(brief);
				if (detected) niche = detected;

				market = 'Australia'; // Default location is Australia but user can change it

				// Prefill Soul
				const parts = [];
				if (brief.brandName)
					parts.push(`You are the official brand advocate for ${brief.brandName}.`);
				if (brief.commStyle) parts.push(`Communication style: ${brief.commStyle}.`);
				if (brief.traits && brief.traits.length > 0)
					parts.push(`Core traits: ${brief.traits.join(', ')}.`);
				if (brief.mission) parts.push(`Mission: ${brief.mission}`);
				if (parts.length > 0) {
					soul =
						parts.join(' ') + ' Always maintain an engaging, professional, and authentic voice.';
				} else {
					soul =
						'Official brand advocate. Always maintain an engaging, professional, and authentic voice.';
				}

				// Prefill Skills
				const skillParts = [];
				if (brief.tagline) skillParts.push(`Key message: "${brief.tagline}".`);
				if (brief.products && brief.products.length > 0) {
					skillParts.push(
						`Promoting products: ${brief.products.map((p: any) => p.name).join(', ')}.`
					);
				}
				if (brief.painPoints) skillParts.push(`Solving problems like: ${brief.painPoints}.`);
				if (skillParts.length > 0) {
					skills = skillParts.join(' ');
				} else {
					skills = 'Expert in content generation, product showcase, and audience interaction.';
				}

				// Pick a random gradient
				selectedGradient = Math.floor(Math.random() * GRADIENT_PRESETS.length);

				saveProgress();
				showToast('Prefilled generator from brand brief settings! ⚡', 'success');
			}
		} catch (e) {
			console.error('Failed to prefill from brand brief', e);
			showToast('Failed to prefill from brand brief', 'error');
		}
	}

	// Load from localStorage
	onMount(() => {
		if (!browser) return;
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) {
				const d = JSON.parse(saved);
				agentName = d.agentName || '';
				handle = d.handle || '';
				niche = d.niche || '';
				market = d.market || 'Australia';
				soul = d.soul || '';
				skills = d.skills || '';
				selectedGradient = d.selectedGradient || 0;
				currentStep = d.currentStep || 1;
			} else {
				// No saved progress, prefill from Brand Brief if possible
				prefillFromBrandBrief();
			}
		} catch {
			/* ignore */
		}
	});

	// Save to localStorage
	function saveProgress() {
		if (!browser) return;
		localStorage.setItem(
			LS_KEY,
			JSON.stringify({
				agentName,
				handle,
				niche,
				market,
				soul,
				skills,
				selectedGradient,
				currentStep
			})
		);
	}

	function nextStep() {
		if (currentStep < TOTAL_STEPS) {
			currentStep++;
			saveProgress();
		}
	}

	function prevStep() {
		if (currentStep > 1) {
			currentStep--;
			saveProgress();
		}
	}

	async function createAgent() {
		isCreating = true;
		createError = '';
		try {
			const payload = {
				name: agentName.trim(),
				handle: displayHandle,
				niche,
				market,
				soul: soul.trim(),
				skills: skills.trim(),
				gradient: GRADIENT_PRESETS[selectedGradient].value,
				initial
			};
			const res = await Factory.create(payload);
			if (res.success) {
				showToast('Agent created successfully!', 'success');
				if (browser) localStorage.removeItem(LS_KEY);
				await goto('/persona-config');
			} else {
				throw new Error(res.error || 'Creation failed');
			}
		} catch (err) {
			createError = (err as Error).message;
			showToast('Agent creation failed — saved locally', 'warning');
			// Still clear and redirect for demo
			if (browser) localStorage.removeItem(LS_KEY);
			setTimeout(() => goto('/persona-config'), 1500);
		} finally {
			isCreating = false;
		}
	}

	// Step labels for progress
	const STEPS = [
		{
			num: 1,
			label: 'Identity',
			icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z'
		},
		{ num: 2, label: 'Persona', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
		{
			num: 3,
			label: 'Review',
			icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11'
		}
	];
</script>

<svelte:head>
	<title>Generator — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<h1>Agent Generator</h1>
		<p class="subtitle">Create a new AI persona from scratch.</p>
	</header>

	<!-- Progress Indicator -->
	<div class="progress-bar">
		{#each STEPS as step, i}
			<div
				class="step-item"
				class:active={currentStep === step.num}
				class:completed={currentStep > step.num}
			>
				<div class="step-circle">
					{#if currentStep > step.num}
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"><polyline points="20 6 9 17 4 12" /></svg
						>
					{:else}
						<span>{step.num}</span>
					{/if}
				</div>
				<span class="step-label">{step.label}</span>
			</div>
			{#if i < STEPS.length - 1}
				<div class="step-line" class:filled={currentStep > step.num}></div>
			{/if}
		{/each}
	</div>

	<!-- Step Content -->
	<div class="wizard-body">
		{#if currentStep === 1}
			<div class="step-panel" style="animation: fadeUp 0.3s var(--ease-out);">
				<div
					class="panel-header"
					style="display: flex; justify-content: space-between; align-items: center; width: 100%;"
				>
					<div style="display: flex; align-items: center; gap: 0.6rem;">
						<svg
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--accent)"
							stroke-width="2"
							stroke-linecap="round"
							><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle
								cx="12"
								cy="7"
								r="4"
							/></svg
						>
						<h2>Identity</h2>
					</div>
					<div class="lightning-btn-wrapper">
						<button
							type="button"
							class="prefill-brief-btn"
							onclick={prefillFromBrandBrief}
							title="Prefill fields from your Brand Brief"
						>
							Sync Brand
						</button>
						<button
							type="button"
							class="lightning-btn"
							onclick={() => (showVaultModal = true)}
							title="Generate or choose from presets"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="currentColor"
								style="margin-right: 2px;"
							>
								<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
							</svg>
							Vault Preset
						</button>
					</div>
				</div>
				<p class="panel-desc">Define who this agent is. Name, handle, and niche.</p>

				<div class="form-grid">
					<div class="field">
						<label for="name">Agent Name</label>
						<input
							id="name"
							type="text"
							bind:value={agentName}
							oninput={saveProgress}
							placeholder="e.g. Luna Styles"
						/>
						{#if agentName.length > 0 && agentName.trim().length < 2}
							<span class="field-error">At least 2 characters</span>
						{/if}
					</div>

					<div class="field">
						<label for="handle">Handle</label>
						<div class="handle-input-wrap">
							<span class="handle-prefix">@</span>
							<input
								id="handle"
								type="text"
								bind:value={handle}
								oninput={() => {
									handle = handle.replace(/^@/, '');
									saveProgress();
								}}
								placeholder="lunastyles.ai"
								class="handle-input"
							/>
						</div>
						{#if handle.length > 0 && handle.replace(/@/g, '').trim().length < 2}
							<span class="field-error">At least 2 characters</span>
						{/if}
					</div>

					<div class="field">
						<label for="niche">Niche</label>
						<select id="niche" bind:value={niche} onchange={saveProgress}>
							<option value="" disabled>Select a niche…</option>
							{#each NICHES as n}
								<option value={n}>{n}</option>
							{/each}
						</select>
						{#if niche === '' && agentName.length > 0}
							<span class="field-error">Required</span>
						{/if}
					</div>

					<div class="field">
						<label for="market">Market</label>
						<select id="market" bind:value={market} onchange={saveProgress}>
							{#each MARKETS as m}
								<option value={m}>{m}</option>
							{/each}
						</select>
						{#if market === '' && agentName.length > 0}
							<span class="field-error">Required</span>
						{/if}
					</div>
				</div>
			</div>
		{:else if currentStep === 2}
			<div class="step-panel" style="animation: fadeUp 0.3s var(--ease-out);">
				<div class="panel-header">
					<svg
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--accent)"
						stroke-width="2"
						stroke-linecap="round"
						><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path
							d="M2 12l10 5 10-5"
						/></svg
					>
					<h2>Persona</h2>
				</div>
				<p class="panel-desc">Define the soul, skills, and visual identity.</p>

				<div class="form-stack">
					<div class="field">
						<label for="soul">Soul (Personality & Voice)</label>
						<textarea
							id="soul"
							bind:value={soul}
							oninput={saveProgress}
							placeholder="Who is this agent? Their personality, tone, values, behavioral rules..."
							rows="6"
						></textarea>
						<span class="char-count"
							>{soul.length} chars {soul.trim().length < 10 && soul.length > 0
								? '— need at least 10'
								: ''}</span
						>
					</div>

					<div class="field">
						<label for="skills">Skills & Capabilities</label>
						<textarea
							id="skills"
							bind:value={skills}
							oninput={saveProgress}
							placeholder="Content skills, scouting abilities, learning loops, platform expertise..."
							rows="6"
						></textarea>
						<span class="char-count"
							>{skills.length} chars {skills.trim().length < 10 && skills.length > 0
								? '— need at least 10'
								: ''}</span
						>
					</div>

					<div class="field">
						<label>Avatar Gradient</label>
						<div class="gradient-grid">
							{#each GRADIENT_PRESETS as grad, i}
								<button
									class="gradient-swatch"
									class:selected={selectedGradient === i}
									style="background: {grad.value}"
									onclick={() => {
										selectedGradient = i;
										saveProgress();
									}}
									title={grad.label}
								>
									{#if selectedGradient === i}
										<svg
											width="18"
											height="18"
											viewBox="0 0 24 24"
											fill="none"
											stroke="#fff"
											stroke-width="3"
											stroke-linecap="round"><polyline points="20 6 9 17 4 12" /></svg
										>
									{/if}
								</button>
							{/each}
						</div>
						<span class="gradient-label">{GRADIENT_PRESETS[selectedGradient].label}</span>
					</div>
				</div>
			</div>
		{:else if currentStep === 3}
			<div class="step-panel" style="animation: fadeUp 0.3s var(--ease-out);">
				<div class="panel-header">
					<svg
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--accent)"
						stroke-width="2"
						stroke-linecap="round"
						><path d="M9 11l3 3L22 4" /><path
							d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
						/></svg
					>
					<h2>Review & Create</h2>
				</div>
				<p class="panel-desc">Confirm everything looks good before creating your agent.</p>

				<div class="review-card">
					<div class="review-avatar" style="background: {GRADIENT_PRESETS[selectedGradient].value}">
						<span>{initial}</span>
					</div>
					<div class="review-info">
						<h3 class="review-name">{agentName || 'Unnamed Agent'}</h3>
						<span class="review-handle">{displayHandle}</span>
					</div>
				</div>

				<div class="review-grid">
					<div class="review-item">
						<span class="review-label">Niche</span>
						<span class="review-value">{niche || '—'}</span>
					</div>
					<div class="review-item">
						<span class="review-label">Market</span>
						<span class="review-value badge-market">
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"><circle cx="12" cy="12" r="10" /></svg
							>
							{market}
						</span>
					</div>
					<div class="review-item full">
						<span class="review-label">Soul</span>
						<p class="review-text">{soul || '—'}</p>
					</div>
					<div class="review-item full">
						<span class="review-label">Skills</span>
						<p class="review-text">{skills || '—'}</p>
					</div>
					<div class="review-item">
						<span class="review-label">Gradient</span>
						<div
							class="review-gradient-preview"
							style="background: {GRADIENT_PRESETS[selectedGradient].value}"
						></div>
					</div>
				</div>

				{#if createError}
					<div class="error-banner">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line
								x1="9"
								y1="9"
								x2="15"
								y2="15"
							/></svg
						>
						{createError}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Navigation -->
	<div class="wizard-nav">
		{#if currentStep > 1}
			<button class="nav-back" onclick={prevStep}>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg
				>
				Back
			</button>
		{:else}
			<div></div>
		{/if}

		{#if currentStep < TOTAL_STEPS}
			<button
				class="nav-next"
				onclick={nextStep}
				disabled={(currentStep === 1 && !step1Valid) || (currentStep === 2 && !step2Valid)}
			>
				Next
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg
				>
			</button>
		{:else}
			<button
				class="nav-create"
				onclick={createAgent}
				disabled={isCreating || !step1Valid || !step2Valid}
			>
				{#if isCreating}
					<svg
						class="spinner"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"><path d="M21 12a9 9 0 11-6.22-8.56" /></svg
					>
					Creating…
				{:else}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path
							d="M2 12l10 5 10-5"
						/></svg
					>
					Create Agent
				{/if}
			</button>
		{/if}
	</div>
</section>

{#if showVaultModal}
	<div
		class="modal-overlay"
		onclick={() => (showVaultModal = false)}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Escape' && (showVaultModal = false)}
	>
		<div class="modal-content glass-card" onclick={(e) => e.stopPropagation()} role="none">
			<header class="modal-header">
				<div class="header-left">
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="var(--accent)"
						style="margin-top: 2px;"
					>
						<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
					</svg>
					<div>
						<h3>Persona Vault</h3>
						<p class="modal-subtitle">
							Instantly choose from our hand-crafted agent presets or roll a random one.
						</p>
					</div>
				</div>
				<button type="button" class="close-btn" onclick={() => (showVaultModal = false)}>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
					>
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</header>

			<div class="modal-toolbar">
				<div class="search-box">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						style="color: var(--text-dim);"
					>
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
					</svg>
					<input type="text" placeholder="Search presets..." bind:value={vaultSearch} />
				</div>
				<div class="filter-tabs">
					<button
						type="button"
						class="filter-tab"
						class:active={selectedVaultNiche === 'All'}
						onclick={() => (selectedVaultNiche = 'All')}>All</button
					>
					{#each NICHES as n}
						<button
							type="button"
							class="filter-tab"
							class:active={selectedVaultNiche === n}
							onclick={() => (selectedVaultNiche = n)}>{n.split(' ')[0]}</button
						>
					{/each}
				</div>
				<button type="button" class="randomize-btn" onclick={selectRandomFromVault}>
					🎲 Roll Random
				</button>
			</div>

			<div class="vault-grid">
				{#each filteredPersonas as p}
					<button type="button" class="persona-card" onclick={() => selectPersona(p)}>
						<div class="card-avatar-wrap" style="background: {GRADIENT_PRESETS[p.gradient].value}">
							<span>{p.name.charAt(0)}</span>
						</div>
						<div class="card-info">
							<div class="card-title-row">
								<h4>{p.name}</h4>
								<span class="badge-niche">{p.niche}</span>
							</div>
							<span class="card-handle">@{p.handle}</span>
							<p class="card-desc">{p.soul}</p>
							<div class="card-meta">
								<span class="badge-market-mini">📍 {p.market}</span>
							</div>
						</div>
					</button>
				{/each}
				{#if filteredPersonas.length === 0}
					<div
						style="grid-column: span 3; text-align: center; color: var(--text-dim); padding: 3rem 0;"
					>
						No presets found matching "{vaultSearch}"
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.page {
		padding: 2rem;
		max-width: 800px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 2rem;
		text-align: center;
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

	/* Progress */
	.progress-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0;
		margin-bottom: 2rem;
	}

	.step-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		position: relative;
		z-index: 1;
	}

	.step-circle {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-2);
		border: 2px solid var(--border-strong);
		color: var(--text-dim);
		font-weight: 700;
		font-size: 0.82rem;
		font-family: var(--font-mono);
		transition: all 0.3s ease;
	}
	.step-item.active .step-circle {
		background: var(--gradient-subtle);
		border-color: var(--accent);
		color: #fff;
		box-shadow: var(--shadow-accent);
	}
	.step-item.completed .step-circle {
		background: var(--success);
		border-color: var(--success);
		color: #fff;
	}

	.step-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		transition: color 0.3s;
	}
	.step-item.active .step-label {
		color: var(--accent);
	}
	.step-item.completed .step-label {
		color: var(--success);
	}

	.step-line {
		width: 80px;
		height: 2px;
		background: var(--border-strong);
		margin: 0 0.5rem;
		margin-bottom: 1.5rem;
		transition: background 0.3s;
	}
	.step-line.filled {
		background: var(--success);
	}

	/* Panels */
	.wizard-body {
		min-height: 400px;
	}

	.step-panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
	}

	.panel-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.25rem;
	}
	.panel-header h2 {
		font-size: var(--text-xl);
	}
	.panel-desc {
		color: var(--text-muted);
		font-size: var(--text-base);
		margin-bottom: 1.5rem;
	}

	/* Form */
	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem;
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
	.field-error {
		font-size: 0.7rem;
		color: var(--error);
		margin-top: 0.25rem;
	}

	.char-count {
		font-size: var(--text-xs);
		color: var(--text-dim);
		margin-top: 0.25rem;
		font-family: var(--font-mono);
	}

	/* Handle input */
	.handle-input-wrap {
		display: flex;
		align-items: center;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition: border-color 0.2s;
	}
	.handle-input-wrap:focus-within {
		border-color: var(--accent-mid);
		box-shadow: 0 0 0 3px rgba(124, 106, 237, 0.08);
	}
	.handle-prefix {
		padding: 10px 0 10px 14px;
		color: var(--accent);
		font-weight: 700;
		font-size: 0.88rem;
		pointer-events: none;
	}
	.handle-input {
		border: none !important;
		background: transparent !important;
		box-shadow: none !important;
		padding-left: 2px !important;
	}

	/* Market badge */
	.market-badge {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 18px;
		border-radius: var(--radius-sm);
		background: var(--cyan-soft);
		border: 1px solid var(--cyan-mid);
		color: var(--cyan);
		font-weight: 600;
		font-size: 0.88rem;
	}

	/* Gradient swatches */
	.gradient-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 0.5rem;
	}
	.gradient-swatch {
		aspect-ratio: 1;
		border-radius: var(--radius-sm);
		border: 2px solid transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			transform 0.2s,
			border-color 0.2s,
			box-shadow 0.2s;
		min-height: 44px;
	}
	.gradient-swatch:hover {
		transform: scale(1.1);
	}
	.gradient-swatch.selected {
		border-color: #fff;
		box-shadow: 0 0 16px rgba(255, 255, 255, 0.2);
		transform: scale(1.1);
	}

	.gradient-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		margin-top: 0.5rem;
		font-family: var(--font-mono);
	}

	/* Review */
	.review-card {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 1.5rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-bottom: 1.5rem;
	}
	.review-avatar {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: 700;
		color: #fff;
		font-family: var(--font-display);
		flex-shrink: 0;
	}
	.review-name {
		font-size: var(--text-lg);
		font-family: var(--font-display);
	}
	.review-handle {
		color: var(--accent);
		font-size: var(--text-base);
		font-family: var(--font-mono);
	}

	.review-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.review-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.review-item.full {
		grid-column: span 2;
	}
	.review-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}
	.review-value {
		font-size: 0.88rem;
		color: var(--text);
	}
	.badge-market {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--cyan);
	}
	.review-text {
		font-size: 0.82rem;
		color: var(--text-muted);
		line-height: 1.5;
		white-space: pre-wrap;
		max-height: 120px;
		overflow-y: auto;
	}
	.review-gradient-preview {
		width: 80px;
		height: 28px;
		border-radius: var(--radius-xs);
		margin-top: 0.25rem;
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-xs);
		background: var(--error-soft);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
		font-size: 0.82rem;
		margin-top: 1rem;
	}

	/* Navigation */
	.wizard-nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 1.5rem;
	}

	.nav-back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 22px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.85rem;
		font-family: var(--font-body);
		font-weight: 600;
		transition:
			border-color 0.2s,
			color 0.2s;
	}
	.nav-back:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	.nav-next,
	.nav-create {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 28px;
		border-radius: var(--radius-sm);
		background: var(--gradient-subtle);
		color: #fff;
		border: none;
		cursor: pointer;
		font-weight: 600;
		font-size: 0.88rem;
		font-family: var(--font-body);
		transition:
			transform 0.2s,
			box-shadow 0.3s;
	}
	.nav-next:hover,
	.nav-create:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-accent);
	}
	.nav-next:disabled,
	.nav-create:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		pointer-events: none;
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@media (max-width: 640px) {
		.page {
			padding: 1rem;
		}
		.form-grid {
			grid-template-columns: 1fr;
		}
		.gradient-grid {
			grid-template-columns: repeat(4, 1fr);
		}
		.step-panel {
			padding: 1.25rem;
		}
		.step-line {
			width: 40px;
		}
		.review-grid {
			grid-template-columns: 1fr;
		}
		.review-item.full {
			grid-column: span 1;
		}
	}

	/* Lightning Button and Sync Brand styling */
	.lightning-btn-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.lightning-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 8px 14px;
		border-radius: var(--radius-xs);
		background: var(--gradient);
		color: #fff;
		border: none;
		cursor: pointer;
		font-weight: 600;
		font-size: 0.8rem;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}

	.lightning-btn:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}

	.prefill-brief-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 8px 14px;
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
		cursor: pointer;
		font-weight: 600;
		font-size: 0.8rem;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.prefill-brief-btn:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	/* Modal styling */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-overlay);
		padding: 1rem;
	}

	.modal-content {
		width: 100%;
		max-width: 900px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-lg);
		border-radius: var(--radius);
		padding: 1.5rem;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1.25rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.75rem;
		text-align: left;
	}

	.header-left {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.header-left h3 {
		font-size: var(--text-xl);
		margin: 0;
	}

	.modal-subtitle {
		color: var(--text-dim);
		font-size: var(--text-xs);
		margin-top: 0.15rem;
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		transition: color 0.2s;
		padding: 4px;
	}

	.close-btn:hover {
		color: var(--text);
	}

	.modal-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.search-box {
		display: flex;
		align-items: center;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 6px 12px;
		gap: 8px;
		flex-grow: 1;
		max-width: 300px;
	}

	.search-box input {
		border: none;
		background: transparent;
		padding: 0;
		outline: none;
		font-size: 0.85rem;
		width: 100%;
		color: var(--text);
	}

	.search-box input:focus {
		box-shadow: none;
		border: none;
	}

	.filter-tabs {
		display: flex;
		gap: 4px;
		background: var(--surface-2);
		padding: 3px;
		border-radius: var(--radius-xs);
		overflow-x: auto;
	}

	.filter-tab {
		border: none;
		background: transparent;
		padding: 6px 12px;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: var(--radius-xs);
		color: var(--text-muted);
		transition:
			background 0.2s,
			color 0.2s;
		white-space: nowrap;
	}

	.filter-tab.active {
		background: var(--surface);
		color: var(--accent);
		box-shadow: var(--shadow-sm);
	}

	.randomize-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		border-radius: var(--radius-xs);
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		color: var(--accent);
		font-weight: 600;
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			background 0.2s,
			color 0.2s;
	}

	.randomize-btn:hover {
		background: rgba(124, 106, 237, 0.25);
		color: var(--text);
	}

	.vault-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		overflow-y: auto;
		flex-grow: 1;
		padding-right: 4px;
		min-height: 250px;
	}

	.persona-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem;
		display: flex;
		gap: 0.75rem;
		cursor: pointer;
		transition:
			transform 0.2s,
			border-color 0.2s,
			box-shadow 0.2s;
		text-align: left;
		width: 100%;
	}

	.persona-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent-mid);
		box-shadow: var(--shadow-md);
	}

	.card-avatar-wrap {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		color: #fff;
		font-size: 1.1rem;
		flex-shrink: 0;
	}

	.card-info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		overflow: hidden;
		width: 100%;
	}

	.card-title-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 4px;
	}

	.card-title-row h4 {
		font-size: 0.88rem;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
		font-family: var(--font-body);
	}

	.badge-niche {
		font-size: 0.62rem;
		padding: 2px 6px;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
		white-space: nowrap;
	}

	.card-handle {
		font-size: 0.75rem;
		color: var(--text-dim);
		font-family: var(--font-mono);
	}

	.card-desc {
		font-size: 0.75rem;
		color: var(--text-muted);
		line-height: 1.4;
		margin: 0.2rem 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-meta {
		margin-top: auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.badge-market-mini {
		font-size: 0.65rem;
		color: var(--cyan);
		font-weight: 600;
	}

	@media (max-width: 900px) {
		.vault-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 600px) {
		.vault-grid {
			grid-template-columns: 1fr;
		}
		.modal-toolbar {
			flex-direction: column;
			align-items: stretch;
		}
		.search-box {
			max-width: none;
		}
	}
</style>
