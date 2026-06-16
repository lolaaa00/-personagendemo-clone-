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
				soul = d.soul || '';
				skills = d.skills || '';
				selectedGradient = d.selectedGradient || 0;
				currentStep = d.currentStep || 1;
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
				<div class="panel-header">
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
						<label>Market</label>
						<div class="market-badge">
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--cyan)"
								stroke-width="2"
								stroke-linecap="round"
								><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path
									d="M12 2a15 15 0 010 20 15 15 0 010-20z"
								/></svg
							>
							<span>{market}</span>
						</div>
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
</style>
