<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import type { Agent } from '$lib/types';
	import { showToast } from '$lib/stores/ui.svelte';
	import { ChannelDecode, ContentForge, Posts } from '$lib/services/api';

	interface SampleBlueprint {
		id: string;
		channel_name: string;
		channel_url: string;
		platform: string;
		score: number;
		created_at: string;
		layers: any;
	}

	interface PageData {
		agents: Agent[];
		blueprints: SampleBlueprint[];
		allowDemoMode?: boolean;
	}

	let { data } = $props<{ data: PageData }>();

	// ── Core State ──
	let blueprints = $state<SampleBlueprint[]>(data.blueprints);
	let selectedBlueprintId = $state<string>('');
	let activeTab = $state<'layers' | 'forge' | 'sandbox'>('layers');
	let searchQuery = $state('');
	let platformFilter = $state<'all' | 'youtube' | 'tiktok' | 'instagram' | 'x'>('all');

	// Cloned blueprint state for inline editing
	let editableBlueprint = $state<SampleBlueprint | null>(null);
	let isSavingBlueprint = $state(false);
	let isDeletingBlueprint = $state(false);

	// Brand brief context loaded from localStorage
	let products = $state<any[]>([]);
	let ugcGuidelines = $state('');
	let brandName = $state('');

	// ── Forge Post State ──
	let forgeAgentId = $state('');
	let forgeTopic = $state('');
	let forgeProductId = $state('');
	let forgingPost = $state(false);
	let forgedCopy = $state('');
	let forgePlatforms = $state<Record<string, boolean>>({
		tiktok: false,
		instagram: false,
		youtube: false,
		x: false,
		facebook: false,
		threads: false
	});

	// Scheduling State
	let scheduleDate = $state('');
	let scheduleTime = $state('10:00');
	let schedulingPost = $state(false);

	// ── Replication Sandbox State ──
	let sandboxType = $state<'script' | 'titles' | 'thumbnail'>('script');
	let sandboxTopic = $state('');
	let generatingSandbox = $state(false);
	let sandboxResult = $state('');

	// ── Lifecycle & Data Loading ──
	onMount(() => {
		// Load brand brief from localStorage
		const LS_KEY = 'personagen_brand_brief';
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) {
				const d = JSON.parse(saved);
				brandName = d.brandName || '';
				products = d.products || [];
				ugcGuidelines = d.ugcGuidelines || '';
			}
		} catch {
			/* ignore */
		}

		// Pre-select first blueprint if available
		if (blueprints.length > 0) {
			selectBlueprint(blueprints[0].id);
		}

		// Set default date for scheduling (tomorrow)
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		scheduleDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
	});

	// Synchronize editable blueprint copy when ID changes
	$effect(() => {
		if (selectedBlueprintId) {
			const bp = blueprints.find((b: SampleBlueprint) => b.id === selectedBlueprintId);
			if (bp) {
				// Deep clone the layers structure so editing doesn't affect list until saved
				editableBlueprint = {
					...bp,
					layers: JSON.parse(JSON.stringify(bp.layers))
				};
				// Auto-select platforms for forge based on blueprint platform
				resetForgePlatforms(bp.platform);
			} else {
				editableBlueprint = null;
			}
		} else {
			editableBlueprint = null;
		}
	});

	function selectBlueprint(id: string) {
		selectedBlueprintId = id;
		forgedCopy = '';
		sandboxResult = '';
	}

	function resetForgePlatforms(primaryPlatform: string) {
		const plat = primaryPlatform.toLowerCase();
		forgePlatforms = {
			tiktok: plat === 'tiktok',
			instagram: plat === 'instagram',
			youtube: plat === 'youtube',
			x: plat === 'x' || plat === 'twitter',
			facebook: false,
			threads: false
		};
	}

	// ── Filters ──
	let filteredBlueprints = $derived.by(() => {
		return blueprints.filter((bp) => {
			const matchesSearch = bp.channel_name.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesPlatform =
				platformFilter === 'all' || bp.platform.toLowerCase() === platformFilter;
			return matchesSearch && matchesPlatform;
		});
	});

	// ── Edit/Update Blueprint Actions ──
	async function saveBlueprintChanges() {
		if (!editableBlueprint) return;
		isSavingBlueprint = true;

		try {
			const res = await ChannelDecode.updateBlueprint(editableBlueprint.id, {
				layers: editableBlueprint.layers
			});

			if (res.success) {
				// Update our local blueprints state
				blueprints = blueprints.map((b) =>
					b.id === editableBlueprint!.id ? { ...b, layers: editableBlueprint!.layers } : b
				);
				showToast('Blueprint saved successfully', 'success');
			} else {
				showToast(res.error || 'Failed to save blueprint changes', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error saving changes', 'error');
		} finally {
			isSavingBlueprint = false;
		}
	}

	function addFinding(layerIndex: number) {
		if (!editableBlueprint || !editableBlueprint.layers[layerIndex]) return;
		editableBlueprint.layers[layerIndex].findings = [
			...editableBlueprint.layers[layerIndex].findings,
			'New actionable constraint...'
		];
	}

	function removeFinding(layerIndex: number, findingIndex: number) {
		if (!editableBlueprint || !editableBlueprint.layers[layerIndex]) return;
		editableBlueprint.layers[layerIndex].findings = editableBlueprint.layers[
			layerIndex
		].findings.filter((_: any, i: number) => i !== findingIndex);
	}

	async function deleteBlueprint(id: string) {
		if (
			!confirm(
				'Are you sure you want to delete this competitor blueprint? This action is irreversible.'
			)
		) {
			return;
		}

		isDeletingBlueprint = true;
		try {
			const res = await ChannelDecode.deleteBlueprint(id);
			if (res.success) {
				blueprints = blueprints.filter((b) => b.id !== id);
				showToast('Blueprint deleted successfully', 'success');
				// Reset selection
				if (blueprints.length > 0) {
					selectBlueprint(blueprints[0].id);
				} else {
					selectedBlueprintId = '';
				}
			} else {
				showToast(res.error || 'Failed to delete blueprint', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error deleting blueprint', 'error');
		} finally {
			isDeletingBlueprint = false;
		}
	}

	// ── Forge Actions ──
	async function runForgePost() {
		if (!selectedBlueprintId || !forgeTopic.trim()) {
			showToast('Please enter a topic or prompt', 'warning');
			return;
		}

		forgingPost = true;
		forgedCopy = '';

		const selectedProd = products.find((p: any) => p.id === forgeProductId);
		let enrichedTopic = forgeTopic;

		if (selectedProd) {
			enrichedTopic += `\n\nProduct Details:\n- Name: ${selectedProd.name}\n- Price: ${selectedProd.price}\n- Description: ${selectedProd.description}`;
		}
		if (ugcGuidelines) {
			enrichedTopic += `\n\nBrand UGC Guidelines to align formatting:\n${ugcGuidelines}`;
		}

		const activePlatforms = Object.entries(forgePlatforms)
			.filter(([, v]) => v)
			.map(([k]) => k);
		const platformsList = activePlatforms.length > 0 ? activePlatforms : ['instagram'];

		try {
			const agent = data.agents.find((a: Agent) => a.id === forgeAgentId) || data.agents[0];
			const res = await ContentForge.generate(
				selectedBlueprintId,
				enrichedTopic,
				agent?.handle || '@agent',
				platformsList
			);

			if (res.success && res.data) {
				const data = res.data as any;
				forgedCopy = data.content || '';
				showToast('Post content forged successfully!', 'success');
			} else {
				if (data.allowDemoMode) {
					forgedCopy = getMockPostContent(enrichedTopic, selectedProd);
					showToast('Demo post template loaded', 'info');
				} else {
					showToast(`Failed to forge post content: ${res.error || 'Unknown error'}`, 'error');
				}
			}
		} catch (e: any) {
			if (data.allowDemoMode) {
				forgedCopy = getMockPostContent(enrichedTopic, selectedProd);
				showToast('Demo post template loaded', 'info');
			} else {
				showToast(`Failed to forge post content: ${e.message || e}`, 'error');
			}
		} finally {
			forgingPost = false;
		}
	}

	async function scheduleForgedPost() {
		if (!forgeAgentId) {
			showToast('Please select a target agent', 'warning');
			return;
		}
		if (!forgedCopy.trim()) {
			showToast('Please forge post copy first', 'warning');
			return;
		}
		const activePlatforms = Object.entries(forgePlatforms)
			.filter(([, v]) => v)
			.map(([k]) => k);
		if (activePlatforms.length === 0) {
			showToast('Select at least one platform', 'warning');
			return;
		}

		schedulingPost = true;
		try {
			const res = await Posts.create({
				agent_id: forgeAgentId,
				content: forgedCopy,
				platforms: activePlatforms,
				scheduled_date: scheduleDate,
				scheduled_time: scheduleTime + ':00',
				status: 'scheduled'
			});

			if (res.success) {
				showToast('Post scheduled to calendar successfully!', 'success');
			} else {
				showToast(res.error || 'Failed to schedule post', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error scheduling post', 'error');
		} finally {
			schedulingPost = false;
		}
	}

	// ── Sandbox Generators ──
	async function runSandboxGeneration() {
		if (!selectedBlueprintId || !sandboxTopic.trim()) {
			showToast('Please enter a topic', 'warning');
			return;
		}

		generatingSandbox = true;
		sandboxResult = '';

		try {
			const agent = data.agents.find((a: Agent) => a.id === forgeAgentId) || data.agents[0];
			let res;

			if (sandboxType === 'script') {
				res = await ContentForge.script(
					selectedBlueprintId,
					sandboxTopic,
					agent?.handle || '@agent'
				);
			} else if (sandboxType === 'titles') {
				res = await ContentForge.titles(selectedBlueprintId, sandboxTopic);
			} else {
				res = await ContentForge.thumbnailBrief(selectedBlueprintId, sandboxTopic);
			}

			if (res.success && res.data) {
				const d = res.data as any;
				if (sandboxType === 'titles' && d.titles) {
					sandboxResult = d.titles.join('\n\n');
				} else if (sandboxType === 'thumbnail' && d.thumbnailNotes) {
					sandboxResult = d.thumbnailNotes.join('\n\n');
				} else {
					sandboxResult = d.content || '';
				}
				showToast('Creative brief generated!', 'success');
			} else {
				if (data.allowDemoMode) {
					sandboxResult = getMockSandboxContent(sandboxTopic);
					showToast('Demo brief template loaded', 'info');
				} else {
					showToast(`Failed to generate sandbox asset: ${res.error || 'Unknown error'}`, 'error');
				}
			}
		} catch (e: any) {
			if (data.allowDemoMode) {
				sandboxResult = getMockSandboxContent(sandboxTopic);
				showToast('Demo brief template loaded', 'info');
			} else {
				showToast(`Failed to generate sandbox asset: ${e.message || e}`, 'error');
			}
		} finally {
			generatingSandbox = false;
		}
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		showToast('Copied to clipboard!', 'success');
	}

	// ── Mock Helpers ──
	function getMockPostContent(topicText: string, product: any): string {
		const prodName = product?.name || 'HoneyX Manly Plus';
		const prodPrice = product?.price || 'Rs. 2,450';
		const prodDesc = product?.description || "Nature's premium superfood for energy.";
		return `🔥 **${topicText}**\n\nMost health advice tells you to take synthetic pills. But the secret to sustainable stamina is raw, functional fuel from nature.\n\nIntroducing: **${prodName}** (${prodPrice})!\n\n1️⃣ **Ashwagandha & Ginseng active complex**\n2️⃣ **Pure organic wildflower honey base**\n3️⃣ **Zero crashes, zero jitters**\n\n${prodDesc}\n\n👉 Click the link in bio to upgrade your daily performance! #Fitness #Biohacking #Stamina #FunctionalFood #HoneyX`;
	}

	function getMockSandboxContent(topicText: string): string {
		if (sandboxType === 'script') {
			return `[SCENE: Close-up on speaker, animated expression]\n"Stop taking synthetic pre-workouts. Seriously. They spike your cortisol and leave you crashing in an hour."\n\n[VISUAL: Cut to jar of HoneyX with honey dripping]\n"This is raw adaptogenic honey. 100% natural daily stamina, no chemicals, no crashes. Just clean organic energy."\n\n[CTA: Link in bio!]`;
		} else if (sandboxType === 'titles') {
			return `- Why Biohackers Are Swapping Energy Drinks For Adaptogenic Honey\n- I Took Withania Somnifera Honey Every Day for 30 Days (Real Results)\n- The Natural Energy Booster That Actually Works`;
		} else {
			return `**Visual Theme**: Warm amber and dark luxury charcoal colors\n**Composition**: Close up pouch shot in the center surrounded by raw ginseng roots and wildflower blossoms\n**Overlay Text**: "RAW STAMINA ONLY" in high-contrast sans-serif font\n**Lighting**: Soft golden-hour side lighting to accentuate texture`;
		}
	}

	const PLATFORM_COLORS: Record<string, string> = {
		youtube: '#ff0000',
		tiktok: '#fe2c55',
		instagram: '#e1306c',
		x: '#1da1f2',
		facebook: '#1877f2',
		threads: '#999'
	};
</script>

<svelte:head>
	<title>Content Forge — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<div>
			<h1>Content Forge</h1>
			<p class="subtitle">
				Competitor Blueprint Manager: edit strategy frameworks, generate posts, and test creative
				layouts.
			</p>
		</div>
	</header>

	<div class="content-forge-layout">
		<!-- Sidebar: Blueprint list -->
		<aside class="sidebar-panel glass-card">
			<div class="sidebar-header">
				<input
					type="text"
					placeholder="Search blueprints..."
					bind:value={searchQuery}
					class="search-input"
				/>
				<div class="platform-filters">
					<button
						class="filter-tab"
						class:active={platformFilter === 'all'}
						onclick={() => (platformFilter = 'all')}>All</button
					>
					<button
						class="filter-tab"
						class:active={platformFilter === 'youtube'}
						onclick={() => (platformFilter = 'youtube')}>YT</button
					>
					<button
						class="filter-tab"
						class:active={platformFilter === 'tiktok'}
						onclick={() => (platformFilter = 'tiktok')}>TT</button
					>
					<button
						class="filter-tab"
						class:active={platformFilter === 'instagram'}
						onclick={() => (platformFilter = 'instagram')}>IG</button
					>
				</div>
			</div>

			<div class="blueprint-list">
				{#if filteredBlueprints.length === 0}
					<div class="list-empty">No blueprints found</div>
				{:else}
					{#each filteredBlueprints as bp}
						<button
							class="blueprint-card"
							class:active={selectedBlueprintId === bp.id}
							onclick={() => selectBlueprint(bp.id)}
						>
							<div class="bp-card-header">
								<span
									class="bp-score"
									style="color: {bp.score >= 90
										? 'var(--success)'
										: bp.score >= 75
											? 'var(--cyan)'
											: 'var(--gold)'}"
								>
									{bp.score} pts
								</span>
								<span
									class="bp-platform"
									style="color: {PLATFORM_COLORS[bp.platform] || 'var(--text-muted)'}"
								>
									{bp.platform}
								</span>
							</div>
							<div class="bp-name">{bp.channel_name}</div>
							<div class="bp-meta">
								<span>Decoded: {Array.isArray(bp.layers) ? bp.layers.length : 9} layers</span>
							</div>
						</button>
					{/each}
				{/if}
			</div>
		</aside>

		<!-- Main Workspace -->
		<main class="main-panel glass-card">
			{#if !editableBlueprint}
				<div class="workspace-empty">
					<svg
						width="48"
						height="48"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--text-dim)"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
						/>
					</svg>
					<h3>Select Competitor Blueprint</h3>
					<p>
						Choose an analyzed channel blueprint from the sidebar to inspect strategy layers, edit
						guidelines, or forge adaptogenic posts.
					</p>
				</div>
			{:else}
				<!-- Blueprint Workspace Header -->
				<header class="workspace-header">
					<div class="header-details">
						<span
							class="platform-badge"
							style="background: {PLATFORM_COLORS[
								editableBlueprint.platform
							]}20; color: {PLATFORM_COLORS[editableBlueprint.platform]}"
						>
							{editableBlueprint.platform}
						</span>
						<h2>{editableBlueprint.channel_name}</h2>
						{#if editableBlueprint.channel_url}
							<a href={editableBlueprint.channel_url} target="_blank" class="channel-link">
								Visit Channel ↗
							</a>
						{/if}
					</div>
					<div class="header-actions">
						<button
							class="btn-delete-blueprint"
							onclick={() => deleteBlueprint(editableBlueprint!.id)}
							disabled={isDeletingBlueprint}
						>
							Delete Blueprint
						</button>
					</div>
				</header>

				<!-- Tabs -->
				<div class="workspace-tabs">
					<button
						class="tab-btn"
						class:active={activeTab === 'layers'}
						onclick={() => (activeTab = 'layers')}
					>
						🧬 Inspect & Edit Blueprint
					</button>
					<button
						class="tab-btn"
						class:active={activeTab === 'forge'}
						onclick={() => (activeTab = 'forge')}
					>
						✨ Forge Social Post
					</button>
					<button
						class="tab-btn"
						class:active={activeTab === 'sandbox'}
						onclick={() => (activeTab = 'sandbox')}
					>
						🧪 Replication Sandbox
					</button>
				</div>

				<!-- Tab Contents -->
				<div class="tab-content">
					<!-- TAB 1: EDIT LAYERS -->
					{#if activeTab === 'layers'}
						<div class="layers-editor" style="animation: fadeIn 0.2s var(--ease-out)">
							<div class="editor-header">
								<div>
									<h3>Decoded Blueprint Scorecard</h3>
									<p class="subtitle">
										Modify the exact rule layers extracted from this competitor. These constraints
										shape post forging.
									</p>
								</div>
								<button
									class="btn-save-blueprint"
									disabled={isSavingBlueprint}
									onclick={saveBlueprintChanges}
								>
									{#if isSavingBlueprint}
										<span class="spinner"></span> Saving...
									{:else}
										Save Blueprint Changes
									{/if}
								</button>
							</div>

							<div class="layers-scroll-grid">
								{#each editableBlueprint.layers as layer, lIndex}
									<div class="layer-editor-card">
										<div class="layer-card-title">
											<div class="layer-score-tag">{layer.score} pts</div>
											<h4>{layer.title}</h4>
										</div>

										<div class="findings-editor-list">
											{#each layer.findings as finding, fIndex}
												<div class="finding-editor-row">
													<span class="row-num">{fIndex + 1}</span>
													<input
														type="text"
														bind:value={editableBlueprint.layers[lIndex].findings[fIndex]}
														class="finding-input"
													/>
													<button
														class="btn-remove-finding"
														onclick={() => removeFinding(lIndex, fIndex)}
														title="Delete finding"
													>
														×
													</button>
												</div>
											{/each}
											<button class="btn-add-finding" onclick={() => addFinding(lIndex)}>
												+ Add Finding Rule
											</button>
										</div>
									</div>
								{/each}
							</div>
						</div>

						<!-- TAB 2: FORGE POST -->
					{:else if activeTab === 'forge'}
						<div class="forge-post-workspace" style="animation: fadeIn 0.2s var(--ease-out)">
							<div class="forge-grid">
								<!-- Inputs Column -->
								<div class="forge-inputs-column">
									<h3>Post Generator Configuration</h3>
									<p class="subtitle">
										Enter topic guidelines to forge ready-to-publish copies focused on posts.
									</p>

									<div class="field">
										<label for="forge-agent">Target Agent Voice</label>
										<select id="forge-agent" bind:value={forgeAgentId}>
											<option value="">Select agent voice...</option>
											{#each data.agents as agent}
												<option value={agent.id}>{agent.name} ({agent.handle})</option>
											{/each}
										</select>
									</div>

									<div class="field">
										<label for="forge-prompt">Topic / Prompt Context</label>
										<textarea
											id="forge-prompt"
											bind:value={forgeTopic}
											placeholder="e.g. Swapping pre-workout supplement drinks for natural ashwagandha wildflower honey..."
											rows="4"
										></textarea>
									</div>

									<div class="field">
										<label for="forge-product">Focus Product</label>
										<select id="forge-product" bind:value={forgeProductId}>
											<option value="">No Product (General Brand Awareness)</option>
											{#each products as product}
												<option value={product.id}>{product.name} ({product.price})</option>
											{/each}
										</select>
									</div>

									<div class="field">
										<label>Target Platforms</label>
										<div class="platforms-grid">
											{#each Object.keys(forgePlatforms) as key}
												<label
													class="platform-checkbox-label"
													style="--p-color: {PLATFORM_COLORS[key] || 'var(--accent)'}"
												>
													<input type="checkbox" bind:checked={forgePlatforms[key]} />
													<span>{key}</span>
												</label>
											{/each}
										</div>
									</div>

									<button
										class="btn-forge-action"
										disabled={forgingPost || !forgeTopic.trim()}
										onclick={runForgePost}
									>
										{#if forgingPost}
											<span class="spinner"></span> Forging post...
										{:else}
											✨ Forge Post Copy
										{/if}
									</button>
								</div>

								<!-- Outputs / Scheduler Column -->
								<div class="forge-outputs-column">
									<h3>Forged Copy Preview</h3>

									<div class="copy-preview-box">
										{#if forgedCopy}
											<textarea class="copy-textarea" bind:value={forgedCopy}></textarea>
											<div class="copy-box-actions">
												<button
													class="btn-copy-clipboard"
													onclick={() => copyToClipboard(forgedCopy)}
												>
													Copy Text
												</button>
											</div>
										{:else}
											<div class="preview-empty">
												<span>Forged copy will render here...</span>
											</div>
										{/if}
									</div>

									{#if forgedCopy}
										<div
											class="scheduler-section glass-card"
											style="animation: fadeUp 0.3s var(--ease-out)"
										>
											<h4>Schedule directly to Calendar</h4>
											<div class="schedule-fields">
												<div class="field">
													<label for="schedule-date">Date</label>
													<input id="schedule-date" type="date" bind:value={scheduleDate} />
												</div>
												<div class="field">
													<label for="schedule-time">Time</label>
													<input id="schedule-time" type="time" bind:value={scheduleTime} />
												</div>
											</div>
											<button
												class="btn-schedule-action"
												disabled={schedulingPost || !forgeAgentId}
												onclick={scheduleForgedPost}
											>
												{#if schedulingPost}
													<span class="spinner"></span> Scheduling...
												{:else}
													📅 Add to Calendar Schedule
												{/if}
											</button>
										</div>
									{/if}
								</div>
							</div>
						</div>

						<!-- TAB 3: REPLICATION SANDBOX -->
					{:else if activeTab === 'sandbox'}
						<div class="replication-sandbox" style="animation: fadeIn 0.2s var(--ease-out)">
							<div class="sandbox-grid">
								<!-- Settings -->
								<div class="sandbox-settings">
									<h3>Generate Creative Briefs</h3>
									<p class="subtitle">
										Extract specialized formats copying competitor structures (scripts, titles,
										storyboards).
									</p>

									<div class="sandbox-type-selector">
										<button
											class="sandbox-type-btn"
											class:active={sandboxType === 'script'}
											onclick={() => (sandboxType = 'script')}
										>
											<span class="btn-icon">🎬</span>
											<span class="btn-label">Video Script</span>
										</button>
										<button
											class="sandbox-type-btn"
											class:active={sandboxType === 'titles'}
											onclick={() => (sandboxType = 'titles')}
										>
											<span class="btn-icon">💡</span>
											<span class="btn-label">Title Ideas</span>
										</button>
										<button
											class="sandbox-type-btn"
											class:active={sandboxType === 'thumbnail'}
											onclick={() => (sandboxType = 'thumbnail')}
										>
											<span class="btn-icon">🖼️</span>
											<span class="btn-label">Thumbnail Brief</span>
										</button>
									</div>

									<div class="field" style="margin-top: 1rem;">
										<label for="sandbox-prompt">Topic Details / Directives</label>
										<textarea
											id="sandbox-prompt"
											bind:value={sandboxTopic}
											placeholder="Enter detailed directives for the creative asset..."
											rows="5"
										></textarea>
									</div>

									<button
										class="btn-sandbox-action"
										disabled={generatingSandbox || !sandboxTopic.trim()}
										onclick={runSandboxGeneration}
									>
										{#if generatingSandbox}
											<span class="spinner"></span> Generating...
										{:else}
											⚡ Generate Brief / Script
										{/if}
									</button>
								</div>

								<!-- Display -->
								<div class="sandbox-output">
									<h3>Asset Output</h3>
									<div class="sandbox-output-box">
										{#if sandboxResult}
											<pre class="output-pre">{sandboxResult}</pre>
											<div class="copy-box-actions">
												<button
													class="btn-copy-clipboard"
													onclick={() => copyToClipboard(sandboxResult)}
												>
													Copy Asset Text
												</button>
											</div>
										{:else}
											<div class="preview-empty">
												<span>Asset brief output will appear here...</span>
											</div>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</main>
	</div>
</section>

<style>
	.page {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
		height: calc(100vh - 60px);
		display: flex;
		flex-direction: column;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.page-header h1 {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		margin: 0 0 0.25rem;
	}

	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-sm);
		margin: 0;
	}

	/* Layout grid */
	.content-forge-layout {
		display: grid;
		grid-template-columns: 300px 1fr;
		gap: 1.5rem;
		flex: 1;
		min-height: 0;
	}

	/* Sidebar */
	.sidebar-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		border: 1px solid var(--border);
		overflow: hidden;
	}

	.sidebar-header {
		padding: 1rem;
		border-bottom: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.search-input {
		font-size: var(--text-xs);
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text);
	}

	.platform-filters {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.25rem;
		background: var(--surface-2);
		padding: 2px;
		border-radius: var(--radius-xs);
	}

	.filter-tab {
		border: none;
		background: transparent;
		color: var(--text-dim);
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.35rem 0;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.15s;
		text-transform: uppercase;
	}

	.filter-tab.active {
		background: var(--surface);
		color: var(--accent);
		box-shadow: var(--shadow-sm);
	}

	.blueprint-list {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.list-empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.blueprint-card {
		text-align: left;
		padding: 0.75rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		cursor: pointer;
		transition: all 0.2s;
	}

	.blueprint-card:hover {
		border-color: var(--border-hover);
		background: var(--surface-3);
	}

	.blueprint-card.active {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.bp-card-header {
		display: flex;
		justify-content: space-between;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		margin-bottom: 0.35rem;
	}

	.bp-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--text);
		margin-bottom: 0.2rem;
	}

	.bp-meta {
		font-size: 0.65rem;
		color: var(--text-muted);
	}

	/* Main workspace */
	.main-panel {
		border: 1px solid var(--border);
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.workspace-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 3rem;
		color: var(--text-dim);
	}

	.workspace-empty svg {
		margin-bottom: 1rem;
	}

	.workspace-empty h3 {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--text);
		margin: 0 0 0.5rem;
	}

	.workspace-empty p {
		max-width: 500px;
		font-size: var(--text-sm);
		color: var(--text-muted);
		line-height: 1.5;
	}

	/* Workspace panel active state */
	.workspace-header {
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.header-details {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.platform-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
	}

	.header-details h2 {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		margin: 0;
	}

	.channel-link {
		font-size: var(--text-xs);
		color: var(--accent);
		text-decoration: none;
	}

	.btn-delete-blueprint {
		background: var(--error-soft);
		color: var(--error);
		border: 1px solid rgba(239, 68, 68, 0.2);
		padding: 0.4rem 0.88rem;
		font-size: var(--text-xs);
		font-weight: 600;
		border-radius: var(--radius-xs);
		cursor: pointer;
		transition: background 0.2s;
	}

	.btn-delete-blueprint:hover {
		background: rgba(239, 68, 68, 0.15);
	}

	/* Tabs */
	.workspace-tabs {
		display: flex;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
		padding: 0 1rem;
	}

	.tab-btn {
		border: none;
		background: transparent;
		color: var(--text-muted);
		padding: 1rem 1.25rem;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		position: relative;
		transition: color 0.2s;
	}

	.tab-btn:hover {
		color: var(--text);
	}

	.tab-btn.active {
		color: var(--accent);
	}

	.tab-btn.active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--accent);
	}

	/* Tab content area */
	.tab-content {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
	}

	/* TAB 1: LAYERS EDITOR */
	.layers-editor {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.editor-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1.5rem;
		margin-bottom: 1.25rem;
	}

	.editor-header h3 {
		font-family: var(--font-display);
		font-size: var(--text-md);
		margin: 0 0 0.15rem;
	}

	.btn-save-blueprint {
		background: var(--gradient-subtle);
		color: #fff;
		border: none;
		padding: 0.5rem 1.25rem;
		font-size: var(--text-xs);
		font-weight: 600;
		border-radius: var(--radius-xs);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		box-shadow: var(--shadow-sm);
	}

	.btn-save-blueprint:hover:not(:disabled) {
		box-shadow: var(--shadow-accent);
	}

	.layers-scroll-grid {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.layer-editor-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1.25rem;
	}

	.layer-card-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	.layer-score-tag {
		font-size: 0.65rem;
		font-weight: 700;
		background: var(--accent-soft);
		color: var(--accent);
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
	}

	.layer-card-title h4 {
		font-size: var(--text-sm);
		margin: 0;
	}

	.findings-editor-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.finding-editor-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.row-num {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-muted);
		width: 16px;
		flex-shrink: 0;
	}

	.finding-input {
		flex: 1;
		font-size: var(--text-xs);
		padding: 0.4rem 0.6rem;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}

	.finding-input:focus {
		border-color: var(--accent-mid);
	}

	.btn-remove-finding {
		background: transparent;
		border: none;
		color: var(--text-dim);
		font-size: 1.25rem;
		font-weight: 300;
		cursor: pointer;
		padding: 0 0.35rem;
	}

	.btn-remove-finding:hover {
		color: var(--error);
	}

	.btn-add-finding {
		background: transparent;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-xs);
		color: var(--text-muted);
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 0.4rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-add-finding:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
		background: var(--accent-soft);
	}

	/* TAB 2: FORGE WORKSPACE */
	.forge-post-workspace {
		height: 100%;
	}

	.forge-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
		height: 100%;
	}

	.forge-inputs-column,
	.forge-outputs-column {
		display: flex;
		flex-direction: column;
	}

	.forge-inputs-column h3,
	.forge-outputs-column h3 {
		font-family: var(--font-display);
		font-size: var(--text-md);
		margin: 0 0 0.15rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		margin-top: 1.15rem;
	}

	.field label {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--text-dim);
		margin-bottom: 0.4rem;
	}

	.field select,
	.field textarea,
	.field input {
		font-size: var(--text-xs);
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-family: var(--font-body);
	}

	.field select:focus,
	.field textarea:focus,
	.field input:focus {
		border-color: var(--accent-mid);
		background: var(--surface-3);
	}

	.platforms-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.platform-checkbox-label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.75rem;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--surface-2);
		cursor: pointer;
		font-size: var(--text-xs);
		text-transform: capitalize;
		font-weight: 600;
		transition: all 0.2s;
	}

	.platform-checkbox-label:hover {
		border-color: var(--border-hover);
	}

	.platform-checkbox-label input[type='checkbox'] {
		accent-color: var(--p-color);
	}

	.platform-checkbox-label:has(input:checked) {
		border-color: var(--p-color);
		background: rgba(124, 106, 237, 0.04);
	}

	.btn-forge-action {
		background: var(--gradient-subtle);
		color: #fff;
		border: none;
		margin-top: 1.5rem;
		padding: 0.68rem;
		font-size: var(--text-xs);
		font-weight: 700;
		border-radius: var(--radius-xs);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		box-shadow: var(--shadow-sm);
	}

	.btn-forge-action:hover:not(:disabled) {
		box-shadow: var(--shadow-accent);
	}

	.btn-forge-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Output side */
	.copy-preview-box {
		flex: 1;
		min-height: 220px;
		max-height: 300px;
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		display: flex;
		flex-direction: column;
		margin-top: 1.15rem;
		overflow: hidden;
	}

	.copy-textarea {
		flex: 1;
		width: 100%;
		border: none;
		background: transparent;
		font-size: var(--text-xs);
		color: var(--text);
		padding: 1rem;
		font-family: var(--font-body);
		line-height: 1.6;
		resize: none;
	}

	.copy-textarea:focus {
		outline: none;
	}

	.copy-box-actions {
		display: flex;
		justify-content: flex-end;
		padding: 0.5rem;
		background: var(--surface-3);
		border-top: 1px solid var(--border);
	}

	.btn-copy-clipboard {
		background: var(--surface);
		border: 1px solid var(--border-strong);
		padding: 0.35rem 0.75rem;
		font-size: 0.68rem;
		font-weight: 700;
		border-radius: var(--radius-xs);
		cursor: pointer;
		color: var(--text);
		transition: all 0.2s;
	}

	.btn-copy-clipboard:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.preview-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	/* Scheduler */
	.scheduler-section {
		border: 1px solid var(--border);
		margin-top: 1.25rem;
		padding: 1.25rem;
		border-radius: var(--radius-xs);
	}

	.scheduler-section h4 {
		margin: 0 0 0.88rem;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
	}

	.schedule-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.schedule-fields .field {
		margin-top: 0;
	}

	.btn-schedule-action {
		width: 100%;
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 700;
		padding: 0.5rem;
		border-radius: var(--radius-xs);
		cursor: pointer;
		margin-top: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		transition: all 0.2s;
	}

	.btn-schedule-action:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.btn-schedule-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* TAB 3: REPLICATION SANDBOX */
	.replication-sandbox {
		height: 100%;
	}

	.sandbox-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
		height: 100%;
	}

	.sandbox-settings,
	.sandbox-output {
		display: flex;
		flex-direction: column;
	}

	.sandbox-settings h3,
	.sandbox-output h3 {
		font-family: var(--font-display);
		font-size: var(--text-md);
		margin: 0 0 0.15rem;
	}

	.sandbox-type-selector {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-top: 1.15rem;
	}

	.sandbox-type-btn {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 0.75rem;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		transition: all 0.2s;
	}

	.sandbox-type-btn:hover {
		border-color: var(--border-hover);
		background: var(--surface-3);
	}

	.sandbox-type-btn.active {
		border-color: var(--cyan);
		background: var(--cyan-soft);
		color: var(--cyan);
	}

	.btn-icon {
		font-size: 1.25rem;
	}

	.btn-label {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.btn-sandbox-action {
		background: var(--gradient-subtle);
		color: #fff;
		border: none;
		margin-top: 1.5rem;
		padding: 0.68rem;
		font-size: var(--text-xs);
		font-weight: 700;
		border-radius: var(--radius-xs);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		box-shadow: var(--shadow-sm);
	}

	.btn-sandbox-action:hover:not(:disabled) {
		box-shadow: var(--shadow-accent);
	}

	.btn-sandbox-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.sandbox-output-box {
		flex: 1;
		min-height: 350px;
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		display: flex;
		flex-direction: column;
		margin-top: 1.15rem;
		overflow: hidden;
	}

	.output-pre {
		flex: 1;
		margin: 0;
		padding: 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text);
		line-height: 1.6;
		overflow-y: auto;
		white-space: pre-wrap;
	}

	/* Spinner */
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

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
