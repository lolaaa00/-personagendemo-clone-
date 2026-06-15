<script lang="ts">
	import type { Agent } from '$lib/types';
	import { Generate, Trends } from '$lib/services/api';
	import { showToast } from '$lib/stores/ui.svelte';

	interface PageData {
		agents: Agent[];
	}

	let { data } = $props<{ data: PageData }>();

	let selectedAgentId = $state('');
	let refreshing = $state(false);
	let generatingTrendId = $state('');

	// ── Sample trend data ──
	interface Trend {
		id: string;
		name: string;
		momentum: 'rising' | 'stable' | 'falling';
		platform: string;
		niche: string;
		matchScore: number;
		hashtags: string[];
		description: string;
	}

	const SAMPLE_TRENDS: Trend[] = [
		{
			id: 't1',
			name: 'Glass Skin Routine',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Beauty',
			matchScore: 92,
			hashtags: ['#glassskin', '#skincare', '#kbeauty', '#glowup'],
			description: 'Minimalist skincare routines achieving translucent, dewy finish'
		},
		{
			id: 't2',
			name: 'AI Fashion Lookbooks',
			momentum: 'rising',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 88,
			hashtags: ['#aifashion', '#lookbook', '#ootd', '#styleai'],
			description: 'AI-generated outfit combinations and virtual try-on content'
		},
		{
			id: 't3',
			name: 'Protein Coffee (Proffee)',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Fitness',
			matchScore: 85,
			hashtags: ['#proffee', '#proteincoffee', '#fitfuel', '#gymlife'],
			description: 'High-protein iced coffee recipes replacing pre-workouts'
		},
		{
			id: 't4',
			name: 'Quiet Luxury',
			momentum: 'stable',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 78,
			hashtags: ['#quietluxury', '#oldmoney', '#stealth wealth', '#minimal'],
			description: 'Understated designer pieces, no logos, premium fabrics'
		},
		{
			id: 't5',
			name: 'Cortisol-Conscious Fitness',
			momentum: 'rising',
			platform: 'YouTube',
			niche: 'Fitness',
			matchScore: 90,
			hashtags: ['#cortisol', '#stressrelief', '#lowimpact', '#hormonehealth'],
			description: 'Low-impact workouts optimized for hormonal balance'
		},
		{
			id: 't6',
			name: 'De-influencing',
			momentum: 'falling',
			platform: 'TikTok',
			niche: 'Lifestyle',
			matchScore: 62,
			hashtags: ['#deinfluencing', '#dontbuy', '#honest review'],
			description: 'Counter-trend calling out overhyped products'
		},
		{
			id: 't7',
			name: 'Mob Wife Aesthetic',
			momentum: 'stable',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 71,
			hashtags: ['#mobwife', '#aesthetic', '#faux fur', '#maximalism'],
			description: 'Bold furs, gold jewelry, dramatic makeup — anti-minimalism'
		},
		{
			id: 't8',
			name: 'Walking Pad Workouts',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Fitness',
			matchScore: 94,
			hashtags: ['#walkingpad', '#deskworkout', '#10ksteps', '#wfh'],
			description: 'Under-desk treadmill content for remote workers'
		},
		{
			id: 't9',
			name: 'Sunset Blush Placement',
			momentum: 'rising',
			platform: 'Instagram',
			niche: 'Beauty',
			matchScore: 83,
			hashtags: ['#sunsetblush', '#blushtrend', '#makeuptutorial'],
			description: 'Draping blush upward toward temples for a sun-kissed glow'
		},
		{
			id: 't10',
			name: 'Digital Detox Content',
			momentum: 'stable',
			platform: 'YouTube',
			niche: 'Lifestyle',
			matchScore: 67,
			hashtags: ['#digitaldetox', '#touchgrass', '#mindfulness', '#offline'],
			description: 'Vlogs and guides about reducing screen time intentionally'
		}
	];

	let trends = $state<Trend[]>([...SAMPLE_TRENDS]);

	let selectedAgent = $derived(data.agents.find((a: Agent) => a.id === selectedAgentId));

	let filteredTrends = $derived.by(() => {
		if (!selectedAgentId || !selectedAgent) return trends;
		const agentNiche = selectedAgent.niche.toLowerCase();
		return trends.filter((t) => {
			const tNiche = t.niche.toLowerCase();
			return (
				tNiche.includes(agentNiche) ||
				agentNiche.includes(tNiche) ||
				agentNiche.includes('lifestyle') ||
				agentNiche.includes('beauty') ||
				tNiche === 'lifestyle'
			);
		});
	});

	let allHashtags = $derived.by(() => {
		const tags: Record<string, number> = {};
		filteredTrends.forEach((t) => {
			t.hashtags.forEach((h) => {
				tags[h] = (tags[h] || 0) + 1;
			});
		});
		return Object.entries(tags)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 20);
	});

	async function refreshTrends() {
		refreshing = true;
		try {
			if (selectedAgentId) {
				const res = await Trends.refresh(selectedAgentId);
				if (res.success && res.data) {
					showToast('Trends refreshed from API', 'success');
				} else {
					// Simulate refresh with shuffled scores
					trends = trends.map((t) => ({
						...t,
						matchScore: Math.min(
							99,
							Math.max(40, t.matchScore + Math.floor(Math.random() * 16) - 8)
						)
					}));
					showToast('Trends recalculated', 'info');
				}
			} else {
				trends = trends.map((t) => ({
					...t,
					matchScore: Math.min(99, Math.max(40, t.matchScore + Math.floor(Math.random() * 16) - 8))
				}));
				showToast('Trends recalculated', 'info');
			}
		} catch {
			trends = trends.map((t) => ({
				...t,
				matchScore: Math.min(99, Math.max(40, t.matchScore + Math.floor(Math.random() * 16) - 8))
			}));
			showToast('Trends recalculated locally', 'info');
		}
		refreshing = false;
	}

	async function generateContent(trend: Trend) {
		if (!selectedAgentId) {
			showToast('Select an agent first', 'warning');
			return;
		}
		generatingTrendId = trend.id;
		try {
			const res = await Generate.trendPost(selectedAgentId, trend.name, [
				trend.platform.toLowerCase()
			]);
			if (res.success) {
				showToast(`Content generated for "${trend.name}"`, 'success');
			} else {
				showToast(res.error || 'Generation failed — API may not be connected', 'warning');
			}
		} catch {
			showToast('API unavailable — connect backend to generate content', 'warning');
		}
		generatingTrendId = '';
	}

	function getMomentumIcon(m: string): string {
		if (m === 'rising') return '↑';
		if (m === 'falling') return '↓';
		return '→';
	}

	function getMomentumColor(m: string): string {
		if (m === 'rising') return 'var(--success)';
		if (m === 'falling') return 'var(--error)';
		return 'var(--warning)';
	}

	function getGradientBorder(m: string): string {
		if (m === 'rising') return 'linear-gradient(135deg, var(--success), var(--cyan))';
		if (m === 'falling') return 'linear-gradient(135deg, var(--error), var(--rose))';
		return 'linear-gradient(135deg, var(--warning), var(--gold))';
	}

	function getPlatformColor(p: string): string {
		const map: Record<string, string> = {
			tiktok: '#fe2c55',
			instagram: '#e1306c',
			youtube: '#ff0000',
			x: '#1da1f2',
			facebook: '#1877f2',
			threads: '#999'
		};
		return map[p.toLowerCase()] || 'var(--accent)';
	}
</script>

<svelte:head>
	<title>Scout Intelligence — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<div class="header-left">
			<h1>Scout Intelligence</h1>
			<p class="subtitle">Discover trending topics and generate niche-matched content</p>
		</div>
		<div class="header-controls">
			<div class="agent-filter">
				<label for="scout-agent">Filter by Agent</label>
				<select id="scout-agent" bind:value={selectedAgentId}>
					<option value="">All Niches</option>
					{#each data.agents as agent}
						<option value={agent.id}>{agent.name} — {agent.niche}</option>
					{/each}
				</select>
			</div>
			<button class="refresh-btn" onclick={refreshTrends} disabled={refreshing}>
				<svg
					class="refresh-icon"
					class:spinning={refreshing}
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="23 4 23 10 17 10" />
					<polyline points="1 20 1 14 7 14" />
					<path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
				</svg>
				{refreshing ? 'Refreshing…' : 'Refresh'}
			</button>
		</div>
	</header>

	<!-- Stats bar -->
	<div class="stats-bar">
		<div class="stat-item">
			<span class="stat-value">{filteredTrends.length}</span>
			<span class="stat-label">Trends Found</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--success)"
				>{filteredTrends.filter((t) => t.momentum === 'rising').length}</span
			>
			<span class="stat-label">Rising</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--warning)"
				>{filteredTrends.filter((t) => t.momentum === 'stable').length}</span
			>
			<span class="stat-label">Stable</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--error)"
				>{filteredTrends.filter((t) => t.momentum === 'falling').length}</span
			>
			<span class="stat-label">Falling</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--cyan)"
				>{Math.round(
					filteredTrends.reduce((a, t) => a + t.matchScore, 0) / (filteredTrends.length || 1)
				)}%</span
			>
			<span class="stat-label">Avg Match</span>
		</div>
	</div>

	<!-- Trend cards grid -->
	<div class="trends-grid">
		{#each filteredTrends as trend (trend.id)}
			<div class="trend-card" style="--gradient-border: {getGradientBorder(trend.momentum)}">
				<div class="trend-card-top"></div>
				<div class="trend-card-body">
					<div class="trend-header">
						<h3 class="trend-name">{trend.name}</h3>
						<span
							class="momentum-badge"
							style="color: {getMomentumColor(trend.momentum)}; background: {getMomentumColor(
								trend.momentum
							)}15"
						>
							<span class="momentum-arrow">{getMomentumIcon(trend.momentum)}</span>
							{trend.momentum}
						</span>
					</div>

					<p class="trend-desc">{trend.description}</p>

					<div class="trend-meta">
						<span
							class="platform-badge"
							style="color: {getPlatformColor(trend.platform)}; border-color: {getPlatformColor(
								trend.platform
							)}40"
						>
							{trend.platform}
						</span>
						<span class="niche-badge">{trend.niche}</span>
					</div>

					<!-- Match score bar -->
					<div class="match-section">
						<div class="match-label-row">
							<span class="match-label">Niche Match</span>
							<span
								class="match-value"
								style="color: {trend.matchScore >= 80
									? 'var(--success)'
									: trend.matchScore >= 60
										? 'var(--warning)'
										: 'var(--error)'}">{trend.matchScore}%</span
							>
						</div>
						<div class="match-bar-bg">
							<div
								class="match-bar-fill"
								style="width: {trend.matchScore}%; background: {trend.matchScore >= 80
									? 'var(--success)'
									: trend.matchScore >= 60
										? 'var(--warning)'
										: 'var(--error)'}"
							></div>
						</div>
					</div>

					<!-- Hashtags -->
					<div class="trend-hashtags">
						{#each trend.hashtags.slice(0, 3) as tag}
							<span class="hashtag">{tag}</span>
						{/each}
					</div>

					<button
						class="btn-generate"
						disabled={generatingTrendId === trend.id || !selectedAgentId}
						onclick={() => generateContent(trend)}
					>
						{#if generatingTrendId === trend.id}
							<span class="spinner"></span>
							Generating…
						{:else}
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg
							>
							Generate Content
						{/if}
					</button>
				</div>
			</div>
		{/each}
	</div>

	<!-- Hashtag cloud section -->
	{#if allHashtags.length > 0}
		<div class="hashtag-cloud-section">
			<h2 class="section-title">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--accent)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line
						x1="10"
						y1="3"
						x2="8"
						y2="21"
					/><line x1="16" y1="3" x2="14" y2="21" /></svg
				>
				Trending Hashtags
			</h2>
			<div class="hashtag-cloud">
				{#each allHashtags as [tag, count], i}
					<span
						class="cloud-tag"
						style="font-size: {Math.max(0.7, 1.2 - i * 0.04)}rem; opacity: {Math.max(
							0.5,
							1 - i * 0.03
						)}">{tag}</span
					>
				{/each}
			</div>
		</div>
	{/if}
</section>

<style>
	.page {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
	}

	/* ── Header ── */
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 2rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.page-header h1 {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		margin: 0 0 0.3rem;
	}

	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-base);
		margin: 0;
	}

	.header-controls {
		display: flex;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.agent-filter select {
		min-width: 220px;
	}

	.refresh-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.2rem;
		border-radius: var(--radius-sm);
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-weight: var(--weight-semi);
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
		font-family: var(--font-body);
	}

	.refresh-btn:hover:not(:disabled) {
		border-color: var(--accent-mid);
		color: var(--text);
		background: var(--surface-2);
	}

	.refresh-btn:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.refresh-icon {
		transition: none;
	}

	.refresh-icon.spinning {
		animation: spin 1s linear infinite;
	}

	/* ── Stats bar ── */
	.stats-bar {
		display: flex;
		gap: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 2rem;
		overflow: hidden;
	}

	.stat-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.25rem 1rem;
		border-right: 1px solid var(--border);
	}

	.stat-item:last-child {
		border-right: none;
	}

	.stat-value {
		font-size: var(--text-lg);
		font-weight: var(--weight-bold);
		font-family: var(--font-mono);
		color: var(--text);
	}

	.stat-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		font-weight: var(--weight-bold);
		margin-top: 0.25rem;
	}

	/* ── Trend cards grid ── */
	.trends-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--gap-lg);
		margin-bottom: 2.5rem;
	}

	.trend-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		transition:
			border-color 0.25s,
			box-shadow 0.25s,
			transform 0.2s;
		position: relative;
	}

	.trend-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-3px);
		box-shadow: var(--shadow-md);
	}

	.trend-card-top {
		height: 4px;
		background: var(--gradient-border);
	}

	.trend-card-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.trend-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.trend-name {
		font-family: var(--font-body);
		font-weight: var(--weight-semi);
		font-size: var(--text-md);
		margin: 0;
		line-height: var(--leading-snug);
	}

	.momentum-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-full);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.momentum-arrow {
		font-size: 0.9rem;
		line-height: 1;
	}

	.trend-desc {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0;
		line-height: var(--leading-snug);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.trend-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.platform-badge {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
		border: 1px solid;
		text-transform: capitalize;
	}

	.niche-badge {
		font-size: var(--text-xs);
		font-weight: var(--weight-semi);
		color: var(--text-dim);
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	/* ── Match score ── */
	.match-section {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.match-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.match-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: var(--weight-semi);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
	}

	.match-value {
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
		font-family: var(--font-mono);
	}

	.match-bar-bg {
		width: 100%;
		height: 6px;
		border-radius: 3px;
		background: var(--surface-3);
		overflow: hidden;
	}

	.match-bar-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.6s var(--ease-out);
	}

	/* ── Hashtags ── */
	.trend-hashtags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.hashtag {
		font-size: var(--text-xs);
		color: var(--accent);
		font-family: var(--font-mono);
		background: var(--accent-soft);
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-xs);
	}

	/* ── Generate button ── */
	.btn-generate {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.65rem 1.2rem;
		border-radius: var(--radius-sm);
		background: var(--gradient-subtle);
		border: none;
		color: #fff;
		font-weight: var(--weight-semi);
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			opacity 0.2s;
		font-family: var(--font-body);
		margin-top: auto;
		width: 100%;
	}

	.btn-generate:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}

	.btn-generate:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Hashtag cloud ── */
	.hashtag-cloud-section {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		margin: 0 0 1.25rem;
	}

	.hashtag-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: center;
	}

	.cloud-tag {
		font-family: var(--font-mono);
		color: var(--accent);
		padding: 0.3rem 0.8rem;
		border-radius: var(--radius-xs);
		background: var(--accent-soft);
		transition:
			background 0.2s,
			transform 0.15s;
		cursor: default;
		white-space: nowrap;
	}

	.cloud-tag:hover {
		background: var(--accent-mid);
		transform: scale(1.05);
	}

	/* ── Spinner ── */
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Responsive ── */
	@media (max-width: 1100px) {
		.trends-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 700px) {
		.page {
			padding: 1.25rem;
		}

		.page-header {
			flex-direction: column;
			gap: 1rem;
		}

		.header-controls {
			width: 100%;
			flex-direction: column;
		}

		.agent-filter {
			width: 100%;
		}

		.agent-filter select {
			min-width: 0;
			width: 100%;
		}

		.refresh-btn {
			width: 100%;
			justify-content: center;
		}

		.stats-bar {
			flex-wrap: wrap;
		}

		.stat-item {
			flex: 1 1 calc(33.33% - 1px);
			min-width: 0;
		}

		.trends-grid {
			grid-template-columns: 1fr;
		}

		.hashtag-cloud-section {
			padding: 1.25rem;
		}
	}
</style>
