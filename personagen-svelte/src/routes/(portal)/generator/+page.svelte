<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { onMount } from 'svelte';
	import { Personas, BrandBrief, type GeneratedPersona } from '$lib/services/api';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	let { data } = $props();

	const LS_KEY = 'personagen_generator_progress';

	// Steps
	let currentStep = $state(1);
	const TOTAL_STEPS = 3;

	// Step 1 — Identity
	let agentName = $state('');
	let niche = $state('');
	let market = $state('Australia'); // optional — can be changed in the profile later
	// Brand-brief-driven generation: the selected brief feeds generation, and the
	// full generated profile + pinned voice are stashed so the created persona is
	// born fully configured (not a bare name/soul shell).
	let selectedBriefId = $state<string>(data.brandBriefs?.[0]?.id ?? '');
	// User-set creative direction — an agreed steer that fine-tunes every generated
	// option to a specific angle (e.g. "a no-nonsense male strength coach").
	let direction = $state('');
	// Brand-kit-informed direction ideas (clickable) so the steer isn't a blank field.
	let directionIdeas = $state<string[]>([]);
	let loadingIdeas = $state(false);
	let generatingPersona = $state(false);
	let generatedProfile = $state<Record<string, any> | null>(null);
	let pinnedVoice = $state('');
	// Vault → 3 brand-tailored options to pick from (replaces the old generic presets).
	let vaultOptions = $state<GeneratedPersona[]>([]);
	let vaultLoading = $state(false);

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
	// Handle was removed as a field; niche + market are generated/optional. Only a
	// name and niche are needed to proceed.
	let step1Valid = $derived(agentName.trim().length >= 2 && niche !== '');
	let step2Valid = $derived(soul.trim().length >= 10 && skills.trim().length >= 10);

	// Handle is auto-derived from the name ("Marcus Fit" → "@marcusfit"); the server
	// falls back to the same rule, this just powers the review preview.
	let displayHandle = $derived(
		'@' + (agentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'persona')
	);

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

	// Vault modal state — now a gallery of 3 freshly-generated, brand-tailored options.
	let showVaultModal = $state(false);

	/** The full persona-profile object (agents.market shape) from a generated persona. */
	function buildProfileFromGenerated(p: GeneratedPersona): Record<string, any> {
		return {
			ageRanges: p.ageRanges ?? [],
			gender: p.gender ?? '',
			archetype: p.archetype ?? '',
			contentFocus: p.contentFocus ?? '',
			psychProfile: p.psychProfile ?? '',
			contentAngle: p.contentAngle ?? '',
			targetAvatar: p.targetAvatar ?? '',
			appearance: p.appearance ?? {},
			voiceProfile: p.voiceProfile ?? {}
		};
	}

	/** Loads a generated persona into the form + stashes its full profile & voice so
	 *  the created agent is born fully configured. */
	function applyGeneratedPersona(p: GeneratedPersona) {
		agentName = p.name;
		if (p.niche) niche = p.niche;
		if (p.soul) soul = p.soul;
		// Derive a skills line from the generated strategy so step 2 is ready to go.
		skills = [
			p.niche ? `Expert in ${p.niche}.` : '',
			p.contentFocus ? `Content focus: ${p.contentFocus}.` : '',
			p.contentAngle ? `Signature angle: ${p.contentAngle}` : ''
		]
			.filter(Boolean)
			.join(' ');
		pinnedVoice = p.voice || '';
		generatedProfile = buildProfileFromGenerated(p);
		selectedGradient = Math.floor(Math.random() * GRADIENT_PRESETS.length);
		saveProgress();
		showVaultModal = false;
		showToast(`✨ Loaded persona: ${p.name}`, 'success');
	}

	/** Fetch brand-kit-informed direction ideas for the user to click. */
	async function suggestDirections() {
		if (loadingIdeas) return;
		loadingIdeas = true;
		try {
			const res = await BrandBrief.suggestDirections(selectedBriefId || null);
			if (res.success && res.data?.directions?.length) {
				directionIdeas = res.data.directions;
			} else {
				showToast(res.error || 'No ideas — check a brand brief exists', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Failed to suggest directions', 'error');
		} finally {
			loadingIdeas = false;
		}
	}

	/** Primary action: generate ONE unique persona for the selected brand and load it. */
	async function generatePersonaForBrand() {
		if (generatingPersona) return;
		generatingPersona = true;
		try {
			const res = await BrandBrief.generateFullPersona(selectedBriefId || null, 1, direction);
			if (res.success && res.data?.personas?.length) {
				applyGeneratedPersona(res.data.personas[0]);
			} else {
				showToast(res.error || 'Generation failed — check a brand brief exists', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Generation failed', 'error');
		} finally {
			generatingPersona = false;
		}
	}

	/** Vault: open the modal so the user can set/confirm the DIRECTION first — it does
	 *  NOT auto-generate, so the 3 options are only produced once the direction is agreed. */
	function openVault() {
		showVaultModal = true;
	}

	/** Generate 3 distinct brand-tailored options fine-tuned to the agreed direction. */
	async function generateVaultOptions() {
		if (vaultLoading) return;
		vaultLoading = true;
		vaultOptions = [];
		try {
			const res = await BrandBrief.generateFullPersona(selectedBriefId || null, 3, direction);
			if (res.success && res.data?.personas) {
				vaultOptions = res.data.personas;
			} else {
				showToast(res.error || 'Generation failed — check a brand brief exists', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Generation failed', 'error');
		} finally {
			vaultLoading = false;
		}
	}
	// Load in-progress draft from localStorage (incl. the stashed generated profile).
	onMount(() => {
		if (!browser) return;
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) {
				const d = JSON.parse(saved);
				agentName = d.agentName || '';
				niche = d.niche || '';
				market = d.market || 'Australia';
				soul = d.soul || '';
				skills = d.skills || '';
				selectedGradient = d.selectedGradient || 0;
				currentStep = d.currentStep || 1;
				selectedBriefId = d.selectedBriefId || selectedBriefId;
				direction = d.direction || '';
				pinnedVoice = d.pinnedVoice || '';
				generatedProfile = d.generatedProfile || null;
			}
		} catch {
			/* ignore */
		}
	});

	// Save to localStorage (persists the generated profile + voice so a refresh
	// mid-flow doesn't lose the generation).
	function saveProgress() {
		if (!browser) return;
		localStorage.setItem(
			LS_KEY,
			JSON.stringify({
				agentName,
				niche,
				market,
				soul,
				skills,
				selectedGradient,
				currentStep,
				selectedBriefId,
				direction,
				pinnedVoice,
				generatedProfile
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

	// Everything the create endpoint needs — including the stashed full profile,
	// pinned voice, and brand link, so the persona is born fully configured.
	function buildCreatePayload() {
		return {
			name: agentName.trim(),
			handle: displayHandle,
			niche,
			platform: 'instagram',
			bio: soul.trim(),
			gradient: GRADIENT_PRESETS[selectedGradient].value,
			initial,
			skills: skills.trim(),
			ugcVoice: pinnedVoice || undefined,
			brandBriefId: selectedBriefId || null,
			personaProfile: generatedProfile || undefined
		};
	}

	async function createPersonaDirect() {
		isCreating = true;
		createError = '';
		try {
			const res = await Personas.createDirect(buildCreatePayload());
			if (res.success) {
				showToast('Persona created successfully!', 'success');
				if (browser) localStorage.removeItem(LS_KEY);
				const newId = (res.data as any)?.id;
				await goto(newId ? `/personas/${newId}` : '/dashboard');
			} else {
				throw new Error(res.error || 'Creation failed');
			}
		} catch (err) {
			createError = (err as Error).message;
			showToast(`Persona creation failed: ${createError}`, 'error');
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
							class="lightning-btn"
							onclick={openVault}
							title="Generate 3 brand-tailored personas to choose from"
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
							Vault · 3 options
						</button>
					</div>
				</div>
				<p class="panel-desc">Pick a brand and generate a unique persona — or fill it in yourself.</p>

				<!-- Primary path: brand-brief-driven generation of a complete, unique persona,
				     fine-tuned to an optional creative direction the user sets first. -->
				<div class="brand-gen-box">
					<div class="brand-gen-fields">
						<div class="field">
							<label for="brand">Brand brief</label>
							<select id="brand" bind:value={selectedBriefId} onchange={saveProgress}>
								{#if !data.brandBriefs?.length}
									<option value="">No brand briefs yet — create one in Brand Brief</option>
								{:else}
									{#each data.brandBriefs as b}
										<option value={b.id}>{b.name}</option>
									{/each}
								{/if}
							</select>
						</div>
						<div class="field">
							<label for="direction">Direction <span class="opt-tag">(optional steer)</span></label>
							<input
								id="direction"
								type="text"
								bind:value={direction}
								oninput={saveProgress}
								placeholder="e.g. a no-nonsense male strength coach for busy dads"
							/>
						</div>
					</div>
					<div class="dir-suggest">
						<button
							type="button"
							class="dir-suggest-btn"
							onclick={suggestDirections}
							disabled={loadingIdeas || !data.brandBriefs?.length}
						>
							{loadingIdeas ? '💡 Thinking…' : '💡 Suggest directions from this brand'}
						</button>
						{#if directionIdeas.length}
							<div class="dir-chips">
								{#each directionIdeas as idea}
									<button
										type="button"
										class="dir-chip"
										class:on={direction === idea}
										onclick={() => {
											direction = idea;
											saveProgress();
										}}>{idea}</button
									>
								{/each}
							</div>
						{/if}
					</div>
					<button
						type="button"
						class="brand-gen-btn"
						onclick={generatePersonaForBrand}
						disabled={generatingPersona || !data.brandBriefs?.length}
					>
						{#if generatingPersona}
							<span class="spinner-sm"></span> Generating…
						{:else}
							✨ Generate persona for this brand
						{/if}
					</button>
				</div>

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
						<label for="market">Market <span class="opt-tag">(optional)</span></label>
						<select id="market" bind:value={market} onchange={saveProgress}>
							{#each MARKETS as m}
								<option value={m}>{m}</option>
							{/each}
						</select>
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

				<!-- Selection Cards for Creation Methods -->
				<div class="creation-methods-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-top: 2rem;">
					<!-- Method 1: DB Only -->
					<div class="method-card glass-card" style="padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; background: var(--surface-2);">
						<div>
							<h4 style="margin: 0; font-size: var(--text-base); font-weight: 700; color: var(--text);">Create Persona Direct</h4>
							<p style="margin: 0.5rem 0 0 0; font-size: var(--text-xs); color: var(--text-dim); line-height: 1.5;">
								Creates a persona directly in the database. Social media channels can be linked manually later using the dashboard.
							</p>
						</div>
						<button
							type="button"
							class="btn-method-action"
							disabled={isCreating || !step1Valid || !step2Valid}
							onclick={createPersonaDirect}
							style="background: var(--gradient-subtle); color: #fff; border: none; padding: 0.75rem; font-size: var(--text-xs); font-weight: 700; border-radius: var(--radius-xs); cursor: pointer; text-align: center; transition: all 0.2s;"
						>
							{#if isCreating}
								Creating...
							{:else}
								👤 Create Persona
							{/if}
						</button>
					</div>

					<!-- Method 2: Account Factory Automation -->
					<div class="method-card glass-card" style="padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; background: var(--surface-2); position: relative;">
						<div>
							<h4 style="margin: 0; font-size: var(--text-base); font-weight: 700; color: var(--text);">Register Automated Account</h4>
							<p style="margin: 0.5rem 0 0 0; font-size: var(--text-xs); color: var(--text-dim); line-height: 1.5;">
								Trigger automated account creation on Instagram, YouTube, etc. using the Account Factory service.
							</p>
						</div>
						<button
							type="button"
							class="btn-method-action"
							disabled={isCreating || !step1Valid || !step2Valid}
							onclick={createPersonaDirect}
							style="background: var(--gradient); color: #fff; border: none; padding: 0.75rem; font-size: var(--text-xs); font-weight: 700; border-radius: var(--radius-xs); cursor: pointer; text-align: center; transition: all 0.2s;"
						>
							{#if isCreating}
								Creating...
							{:else}
								🚀 Create &amp; Connect Later
							{/if}
						</button>
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
			<div></div>
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
							3 unique personas tailored to your selected brand — pick one to load it.
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

			<div class="modal-toolbar vault-direction-bar">
				<span class="vault-brand-label">
					⚡ {data.brandBriefs?.find((b) => b.id === selectedBriefId)?.name ?? 'No brand selected'}
				</span>
				<input
					class="vault-direction-input"
					type="text"
					bind:value={direction}
					placeholder="Direction (optional): steer all 3 options — e.g. 'Gen-Z wellness girl'"
				/>
				<button
					type="button"
					class="randomize-btn"
					onclick={generateVaultOptions}
					disabled={vaultLoading || !data.brandBriefs?.length}
				>
					{vaultLoading
						? 'Generating…'
						: vaultOptions.length
							? '🔄 Regenerate'
							: '✨ Generate 3 options'}
				</button>
			</div>

			<div class="dir-suggest vault-dir-suggest">
				<button
					type="button"
					class="dir-suggest-btn"
					onclick={suggestDirections}
					disabled={loadingIdeas || !data.brandBriefs?.length}
				>
					{loadingIdeas ? '💡 Thinking…' : '💡 Suggest directions'}
				</button>
				{#if directionIdeas.length}
					<div class="dir-chips">
						{#each directionIdeas as idea}
							<button
								type="button"
								class="dir-chip"
								class:on={direction === idea}
								onclick={() => (direction = idea)}>{idea}</button
							>
						{/each}
					</div>
				{/if}
			</div>

			<div class="vault-grid">
				{#if vaultLoading}
					<div
						style="grid-column: span 3; text-align: center; color: var(--text-dim); padding: 3rem 0;"
					>
						<span class="spinner-sm"></span> Generating 3 brand-tailored personas…
					</div>
				{:else}
					{#each vaultOptions as p, i}
						<button type="button" class="persona-card" onclick={() => applyGeneratedPersona(p)}>
							<div
								class="card-avatar-wrap"
								style="background: {GRADIENT_PRESETS[i % GRADIENT_PRESETS.length].value}"
							>
								<span>{p.name.charAt(0)}</span>
							</div>
							<div class="card-info">
								<div class="card-title-row">
									<h4>{p.name}</h4>
									<span class="badge-niche">{p.niche}</span>
								</div>
								<span class="card-handle">{p.archetype || p.gender}</span>
								<p class="card-desc">{p.soul}</p>
								<div class="card-meta">
									{#if p.appearance?.ethnicity}
										<span class="badge-market-mini">🌍 {p.appearance.ethnicity}</span>
									{/if}
									{#if p.gender}<span class="badge-market-mini">{p.gender}</span>{/if}
								</div>
							</div>
						</button>
					{/each}
					{#if !vaultOptions.length}
						<div
							style="grid-column: span 3; text-align: center; color: var(--text-dim); padding: 3rem 0;"
						>
							Set your direction above (optional), then <strong>Generate 3 options</strong> fine-tuned
							to this brand.
						</div>
					{/if}
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

	/* Brand-brief-driven generation (Step 1) */
	.brand-gen-box {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.brand-gen-fields {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.brand-gen-fields .field {
		flex: 1;
		min-width: 200px;
	}
	.brand-gen-btn {
		align-self: flex-start;
		background: var(--gradient, linear-gradient(135deg, #7c6aed, #22d3ee));
		color: #fff;
		border: none;
		border-radius: var(--radius-xs, 8px);
		padding: 0.7rem 1.1rem;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		transition: filter 0.15s ease;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.brand-gen-btn:hover:not(:disabled) {
		filter: brightness(1.08);
	}
	.brand-gen-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.opt-tag {
		font-weight: 400;
		color: var(--text-dim, #9ca3af);
		font-size: 0.72rem;
	}
	.vault-brand-label {
		font-weight: 700;
		font-size: 0.85rem;
		color: var(--text, #14172b);
		white-space: nowrap;
	}
	.vault-direction-bar {
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
	.vault-direction-input {
		flex: 1;
		min-width: 220px;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border, #e6e8f0);
		border-radius: var(--radius-xs, 8px);
		background: var(--surface, #fff);
		color: var(--text, #14172b);
		font-size: 0.8rem;
	}

	/* Brand-kit direction suggestions */
	.dir-suggest {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.vault-dir-suggest {
		margin-bottom: 0.75rem;
	}
	.dir-suggest-btn {
		align-self: flex-start;
		background: transparent;
		border: 1px dashed var(--border, #cbd5e1);
		color: var(--text-dim, #6b7280);
		border-radius: 999px;
		padding: 0.4rem 0.85rem;
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.dir-suggest-btn:hover:not(:disabled) {
		border-color: var(--accent, #7c6aed);
		color: var(--accent, #7c6aed);
	}
	.dir-suggest-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.dir-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.dir-chip {
		background: var(--surface-2, #f3f4f6);
		border: 1px solid var(--border, #e6e8f0);
		color: var(--text, #14172b);
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font-size: 0.74rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}
	.dir-chip:hover {
		border-color: var(--accent, #7c6aed);
	}
	.dir-chip.on {
		background: var(--accent, #7c6aed);
		color: #fff;
		border-color: transparent;
	}
	.spinner-sm {
		display: inline-block;
		width: 13px;
		height: 13px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: gen-spin 0.7s linear infinite;
		vertical-align: -2px;
	}
	@keyframes gen-spin {
		to {
			transform: rotate(360deg);
		}
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
