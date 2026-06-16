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
		volume: string;
		growth: string;
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
			description: 'Minimalist skincare routines achieving translucent, dewy finish',
			volume: '24.2K',
			growth: '+340%'
		},
		{
			id: 't2',
			name: 'AI Fashion Lookbooks',
			momentum: 'rising',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 88,
			hashtags: ['#aifashion', '#lookbook', '#ootd', '#styleai'],
			description: 'AI-generated outfit combinations and virtual try-on content',
			volume: '18.5K',
			growth: '+210%'
		},
		{
			id: 't3',
			name: 'Protein Coffee (Proffee)',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Fitness',
			matchScore: 85,
			hashtags: ['#proffee', '#proteincoffee', '#fitfuel', '#gymlife'],
			description: 'High-protein iced coffee recipes replacing pre-workouts',
			volume: '40.5K',
			growth: '+525%'
		},
		{
			id: 't4',
			name: 'Quiet Luxury',
			momentum: 'stable',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 78,
			hashtags: ['#quietluxury', '#oldmoney', '#stealth wealth', '#minimal'],
			description: 'Understated designer pieces, no logos, premium fabrics',
			volume: '12.1K',
			growth: '+15%'
		},
		{
			id: 't5',
			name: 'Cortisol-Conscious Fitness',
			momentum: 'rising',
			platform: 'YouTube',
			niche: 'Fitness',
			matchScore: 90,
			hashtags: ['#cortisol', '#stressrelief', '#lowimpact', '#hormonehealth'],
			description: 'Low-impact workouts optimized for hormonal balance',
			volume: '33.1K',
			growth: '+122%'
		},
		{
			id: 't6',
			name: 'De-influencing',
			momentum: 'falling',
			platform: 'TikTok',
			niche: 'Lifestyle',
			matchScore: 62,
			hashtags: ['#deinfluencing', '#dontbuy', '#honest review'],
			description: 'Counter-trend calling out overhyped products',
			volume: '590',
			growth: '-12%'
		},
		{
			id: 't7',
			name: 'Mob Wife Aesthetic',
			momentum: 'stable',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 71,
			hashtags: ['#mobwife', '#aesthetic', '#faux fur', '#maximalism'],
			description: 'Bold furs, gold jewelry, dramatic makeup — anti-minimalism',
			volume: '3.1M',
			growth: '+8%'
		},
		{
			id: 't8',
			name: 'Walking Pad Workouts',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Fitness',
			matchScore: 94,
			hashtags: ['#walkingpad', '#deskworkout', '#10ksteps', '#wfh'],
			description: 'Under-desk treadmill content for remote workers',
			volume: '92.4K',
			growth: '+688%'
		},
		{
			id: 't9',
			name: 'Sunset Blush Placement',
			momentum: 'rising',
			platform: 'Instagram',
			niche: 'Beauty',
			matchScore: 83,
			hashtags: ['#sunsetblush', '#blushtrend', '#makeuptutorial'],
			description: 'Draping blush upward toward temples for a sun-kissed glow',
			volume: '14.8K',
			growth: '+224%'
		},
		{
			id: 't10',
			name: 'Digital Detox Content',
			momentum: 'stable',
			platform: 'YouTube',
			niche: 'Lifestyle',
			matchScore: 67,
			hashtags: ['#digitaldetox', '#touchgrass', '#mindfulness', '#offline'],
			description: 'Vlogs and guides about reducing screen time intentionally',
			volume: '8.2K',
			growth: '+5%'
		}
	];

	let trends = $state<Trend[]>([...SAMPLE_TRENDS]);
	let searchTrend = $state('');
	let timeRange = $state('2 Years');
	const TIME_RANGES = ['3 Months', '6 Months', '1 Year', '2 Years', '5 Years'];

	let selectedAgent = $derived(data.agents.find((a: Agent) => a.id === selectedAgentId));

	let filteredTrends = $derived.by(() => {
		let result = trends;
		if (selectedAgentId && selectedAgent) {
			const agentNiche = selectedAgent.niche.toLowerCase();
			result = trends.filter((t) => {
				const tNiche = t.niche.toLowerCase();
				return (
					tNiche.includes(agentNiche) ||
					agentNiche.includes(tNiche) ||
					agentNiche.includes('lifestyle') ||
					agentNiche.includes('beauty') ||
					tNiche === 'lifestyle'
				);
			});
		}
		if (searchTrend.trim()) {
			const query = searchTrend.toLowerCase();
			result = result.filter(
				(t) =>
					t.name.toLowerCase().includes(query) ||
					t.description.toLowerCase().includes(query) ||
					t.hashtags.some((tag) => tag.toLowerCase().includes(query))
			);
		}
		return result;
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

	function getTrendChartPath(trendId: string, momentum: string): { linePath: string; fillPath: string } {
		const pointsCount = 15;
		const width = 300;
		const height = 100;
		const points: { x: number; y: number }[] = [];

		let seed = 0;
		for (let i = 0; i < trendId.length; i++) {
			seed += trendId.charCodeAt(i);
		}

		for (let i = 0; i < pointsCount; i++) {
			const x = (i / (pointsCount - 1)) * width;
			let y = 50;
			const rand = Math.sin(i * 1.5 + seed) * 7;

			if (momentum === 'rising') {
				const progress = i / (pointsCount - 1);
				const curve = Math.pow(progress, 4) * 60;
				y = 80 - curve + rand;
			} else if (momentum === 'falling') {
				const progress = i / (pointsCount - 1);
				const curve = Math.pow(progress, 3) * 60;
				y = 20 + curve + rand;
			} else {
				y = 55 + Math.sin(i * 2.5 + seed) * 12;
			}

			y = Math.max(12, Math.min(88, y));
			points.push({ x, y });
		}

		let linePath = `M ${points[0].x} ${points[0].y}`;
		for (let i = 1; i < points.length; i++) {
			linePath += ` L ${points[i].x} ${points[i].y}`;
		}

		const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

		return { linePath, fillPath };
	}

	function getXAxisLabels(range: string): { start: string; end: string } {
		switch (range) {
			case '3 Months':
				return { start: 'Mar 2026', end: 'Jun 2026' };
			case '6 Months':
				return { start: 'Dec 2025', end: 'Jun 2026' };
			case '1 Year':
				return { start: 'Jun 2025', end: 'Jun 2026' };
			case '2 Years':
				return { start: '2025', end: '2026' };
			case '5 Years':
				return { start: '2021', end: '2026' };
			default:
				return { start: '2025', end: '2026' };
		}
	}
</script>

<svelte:head>
	<title>Scout Intelligence — PersonaGen</title>
</svelte:head>

<section class="page">
	<!-- Exploding Topics style header -->
	<div class="exploding-header">
		<h1>Discover Exploding Topics</h1>
		
		<div class="exploding-filter-bar">
			<span class="filter-label">FILTER BY:</span>
			
			<div class="select-wrapper">
				<select class="exploding-select" bind:value={timeRange}>
					{#each TIME_RANGES as range}
						<option value={range}>{range}</option>
					{/each}
				</select>
			</div>

			<div class="select-wrapper">
				<select class="exploding-select" bind:value={selectedAgentId}>
					<option value="">All Categories</option>
					{#each data.agents as agent}
						<option value={agent.id}>{agent.name} — {agent.niche}</option>
					{/each}
				</select>
			</div>

			<div class="search-wrapper">
				<svg class="search-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
				<input type="text" class="exploding-search-input" placeholder="Search Trends" bind:value={searchTrend} />
				<span class="pro-badge">PRO</span>
			</div>

			<button class="refresh-circle-btn" onclick={refreshTrends} disabled={refreshing} title="Refresh Trends">
				<svg
					class="refresh-icon-svg"
					class:spinning={refreshing}
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="23 4 23 10 17 10" />
					<polyline points="1 20 1 14 7 14" />
					<path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
				</svg>
			</button>
		</div>
	</div>

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
			{@const chart = getTrendChartPath(trend.id, trend.momentum)}
			{@const labels = getXAxisLabels(timeRange)}
			<div class="trend-card">
				<div class="trend-card-body">
					<div class="trend-card-header-row">
						<h3 class="trend-card-title">{trend.name}</h3>
						
						<div class="trend-card-stats">
							<div class="stat-group">
								<span class="stat-num volume">{trend.volume}</span>
								<span class="stat-lbl">Volume</span>
							</div>
							<div class="stat-group">
								<span class="stat-num growth" style="color: {trend.momentum === 'rising' ? 'var(--success)' : trend.momentum === 'falling' ? 'var(--error)' : 'var(--warning)'}">
									{trend.growth}
								</span>
								<span class="stat-lbl">Growth</span>
							</div>
						</div>
					</div>

					<!-- SVG Chart Block -->
					<div class="trend-chart-container">
						<svg class="trend-svg" viewBox="0 0 300 100" preserveAspectRatio="none">
							<defs>
								<linearGradient id="chartGrad-{trend.id}" x1="0%" y1="0%" x2="0%" y2="100%">
									<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18" />
									<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0" />
								</linearGradient>
							</defs>
							<!-- Grid Lines -->
							<line x1="0" y1="25" x2="300" y2="25" stroke="var(--border-strong)" stroke-dasharray="2,3" stroke-width="0.7"></line>
							<line x1="0" y1="50" x2="300" y2="50" stroke="var(--border-strong)" stroke-dasharray="2,3" stroke-width="0.7"></line>
							<line x1="0" y1="75" x2="300" y2="75" stroke="var(--border-strong)" stroke-dasharray="2,3" stroke-width="0.7"></line>
							
							<!-- Area path under line -->
							<path d={chart.fillPath} fill="url(#chartGrad-{trend.id})"></path>
							
							<!-- Smooth trend line -->
							<path d={chart.linePath} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
						</svg>
						
						<!-- X-Axis Labels -->
						<div class="chart-axis-labels">
							<span>{labels.start}</span>
							<span>{labels.end}</span>
						</div>
					</div>

					<p class="trend-card-description">{trend.description}</p>

					<!-- Badges, Niche Match & Action Section -->
					<div class="trend-card-footer">
						<div class="meta-row">
							<span class="platform-pill" style="--p-color: {getPlatformColor(trend.platform)}">
								{trend.platform}
							</span>
							<span class="niche-pill">{trend.niche}</span>
							<span class="match-pill" style="color: {trend.matchScore >= 80 ? 'var(--success)' : trend.matchScore >= 60 ? 'var(--warning)' : 'var(--error)'}">
								{trend.matchScore}% Match
							</span>
						</div>

						<div class="hashtags-row">
							{#each trend.hashtags.slice(0, 3) as tag}
								<span class="hashtag-tag">{tag}</span>
							{/each}
						</div>

						<button
							class="exploding-action-btn"
							disabled={generatingTrendId === trend.id || !selectedAgentId}
							onclick={() => generateContent(trend)}
						>
							{#if generatingTrendId === trend.id}
								<span class="action-spinner"></span>
								Generating…
							{:else}
								<span>Generate Content</span>
								<svg class="arrow-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
									<line x1="5" y1="12" x2="19" y2="12"></line>
									<polyline points="12 5 19 12 12 19"></polyline>
								</svg>
							{/if}
						</button>
					</div>
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

	/* ── Exploding Topics Header & Filter Bar ── */
	.exploding-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.exploding-header h1 {
		font-family: var(--font-display);
		font-size: 2.2rem;
		font-weight: 800;
		color: var(--text);
		margin: 0 0 1.75rem 0;
		letter-spacing: -0.02em;
	}

	.exploding-filter-bar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.5rem 1rem;
		box-shadow: var(--shadow-sm);
		flex-wrap: wrap;
	}

	.filter-label {
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-dim);
		letter-spacing: 0.05em;
		margin-right: 0.25rem;
	}

	.select-wrapper {
		position: relative;
	}

	.exploding-select {
		appearance: none;
		background: var(--bg);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-xs);
		padding: 0.4rem 2rem 0.4rem 0.75rem;
		font-family: var(--font-body);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
		min-width: 130px;
		transition: all 0.2s ease;
	}

	.exploding-select:hover {
		border-color: var(--accent-mid);
	}

	.select-wrapper::after {
		content: "";
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-20%);
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-top: 5px solid var(--text-muted);
		pointer-events: none;
	}

	.search-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon-svg {
		position: absolute;
		left: 0.75rem;
		color: var(--text-dim);
		pointer-events: none;
	}

	.exploding-search-input {
		background: var(--bg) !important;
		border: 1px solid var(--border-strong) !important;
		border-radius: var(--radius-xs) !important;
		padding: 0.4rem 3.5rem 0.4rem 2.25rem !important;
		font-family: var(--font-body);
		font-size: 0.82rem;
		color: var(--text);
		width: 200px;
		transition: all 0.2s ease;
		outline: none;
		box-shadow: none !important;
	}

	.exploding-search-input:focus {
		border-color: var(--accent) !important;
		width: 240px;
	}

	.pro-badge {
		position: absolute;
		right: 0.5rem;
		background: #2563eb;
		color: #ffffff;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 800;
		padding: 1.5px 5px;
		border-radius: 3px;
		letter-spacing: 0.05em;
		pointer-events: none;
	}

	.refresh-circle-btn {
		background: var(--bg);
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
		border-radius: var(--radius-xs);
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.refresh-circle-btn:hover:not(:disabled) {
		color: var(--accent);
		border-color: var(--accent-mid);
	}

	.refresh-circle-btn:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	.refresh-icon-svg.spinning {
		animation: spin 0.8s linear infinite;
	}

	/* ── Stats Bar ── */
	.stats-bar {
		display: flex;
		gap: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 2.5rem;
		box-shadow: var(--shadow-sm);
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
		font-weight: 800;
		font-family: var(--font-mono);
		color: var(--text);
	}

	.stat-label {
		font-size: 0.65rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		font-weight: 700;
		margin-top: 0.25rem;
	}

	/* ── Trend Grid ── */
	.trends-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--gap-lg);
		margin-bottom: 3rem;
	}

	/* ── Exploding Topics Card ── */
	.trend-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		transition: border-color 0.25s, box-shadow 0.25s, transform 0.2s;
		box-shadow: var(--shadow-sm);
	}

	.trend-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-4px);
		box-shadow: var(--shadow-md);
	}

	.trend-card-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.trend-card-header-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.trend-card-title {
		font-family: var(--font-body);
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
		line-height: 1.3;
		flex: 1;
	}

	.trend-card-stats {
		display: flex;
		gap: 1rem;
		flex-shrink: 0;
	}

	.stat-group {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.stat-num {
		font-family: var(--font-mono);
		font-size: 0.95rem;
		font-weight: 700;
	}

	.stat-num.volume {
		color: #2563eb;
	}

	.stat-lbl {
		font-family: var(--font-body);
		font-size: 0.65rem;
		color: var(--text-dim);
		margin-top: 0.15rem;
	}

	/* ── SVG Chart Section ── */
	.trend-chart-container {
		position: relative;
		height: 110px;
		background: rgba(0, 0, 0, 0.02);
		border-radius: var(--radius-xs);
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.04);
		padding: 4px 0 0 0;
	}

	.trend-svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	.chart-axis-labels {
		position: absolute;
		bottom: 4px;
		left: 8px;
		right: 8px;
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-dim);
		pointer-events: none;
		font-weight: 600;
	}

	.trend-card-description {
		font-family: var(--font-body);
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		min-height: 2.85rem;
	}

	/* ── Footer Elements ── */
	.trend-card-footer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: auto;
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}

	.meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.platform-pill {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		color: #ffffff;
		background: var(--p-color);
		padding: 2.5px 8px;
		border-radius: var(--radius-xs);
		text-transform: capitalize;
	}

	.niche-pill {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--surface-2);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: var(--radius-xs);
	}

	.match-pill {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		font-weight: 700;
		background: var(--surface-2);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: var(--radius-xs);
	}

	.hashtags-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.hashtag-tag {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 6px;
		border-radius: 3px;
	}

	/* ── Premium Link Action Button ── */
	.exploding-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--accent-soft);
		color: var(--accent);
		border: none;
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.6rem 1.25rem;
		border-radius: var(--radius-xs);
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		width: 100%;
	}

	.exploding-action-btn:hover:not(:disabled) {
		background: var(--accent-mid);
		color: #ffffff;
		transform: translateY(-1px);
	}

	.exploding-action-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.arrow-icon {
		transition: transform 0.2s ease;
	}

	.exploding-action-btn:hover:not(:disabled) .arrow-icon {
		transform: translateX(3px);
	}

	/* ── Hashtag Cloud ── */
	.hashtag-cloud-section {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
		box-shadow: var(--shadow-sm);
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
		padding: 0.35rem 0.85rem;
		border-radius: var(--radius-xs);
		background: var(--accent-soft);
		transition: background 0.2s, transform 0.15s;
		cursor: default;
		white-space: nowrap;
	}

	.cloud-tag:hover {
		background: var(--accent-mid);
		color: #ffffff;
		transform: scale(1.05);
	}

	/* ── Action Spinners ── */
	.action-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(124, 106, 237, 0.3);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Responsive breakpoints ── */
	@media (max-width: 1150px) {
		.trends-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 768px) {
		.page {
			padding: 1.25rem;
		}

		.exploding-header h1 {
			font-size: 1.8rem;
		}

		.exploding-filter-bar {
			width: 100%;
			flex-direction: column;
			align-items: stretch;
		}

		.exploding-select,
		.exploding-search-input,
		.refresh-circle-btn {
			width: 100% !important;
		}

		.stats-bar {
			flex-wrap: wrap;
		}

		.stat-item {
			flex: 1 1 calc(50% - 1px);
			border-bottom: 1px solid var(--border);
		}

		.stat-item:nth-child(even) {
			border-right: none;
		}

		.trends-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
