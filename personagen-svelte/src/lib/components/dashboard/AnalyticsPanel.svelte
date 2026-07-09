<script lang="ts">
	import AnalyticsChart from './AnalyticsChart.svelte';

	interface Props {
		agents: any[];
	}

	let { agents }: Props = $props();

	interface AnalyticsData {
		totals: { views: number; likes: number; comments: number; shares: number; posts: number };
		engagementRate: number;
		byPlatform: Record<string, { posts: number; views: number; likes: number }>;
		series: Array<{ id: string; published_at: string | null; views: number; likes: number }>;
	}

	let selectedId = $state<string | null>(null);
	let effectiveId = $derived(selectedId ?? (agents.length ? agents[0].id : null));
	let loading = $state(false);
	let error = $state<string | null>(null);
	let analytics = $state<AnalyticsData | null>(null);

	const platformColors: Record<string, string> = {
		instagram: 'linear-gradient(90deg,#833ab4,#e1306c)',
		tiktok: 'linear-gradient(90deg,#25f4ee,#fe2c55)',
		x: 'linear-gradient(90deg,#1da1f2,#0d8bd9)',
		twitter: 'linear-gradient(90deg,#1da1f2,#0d8bd9)',
		linkedin: 'linear-gradient(90deg,#0077b5,#00a0dc)',
		youtube: 'linear-gradient(90deg,#ff0000,#cc0000)',
		threads: 'linear-gradient(90deg,#000,#333)'
	};
	const defaultPlatformColor = 'linear-gradient(90deg,#6366f1,#818cf8)';

	async function loadAnalytics(agentId: string) {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/analytics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agent_id: agentId })
			});
			const body = await res.json();
			if (!res.ok || !body.success) {
				throw new Error(body.error || 'Failed to load analytics');
			}
			analytics = body.data;
		} catch (err: any) {
			analytics = null;
			error = err.message || 'Failed to load analytics';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (effectiveId) {
			loadAnalytics(effectiveId);
		}
	});

	function formatNum(v: number): string {
		if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
		return String(v);
	}

	// Aggregate the per-post series into daily buckets for the chart
	let chartSeries = $derived.by(() => {
		if (!analytics?.series?.length) return [];
		const byDay = new Map<string, { views: number; likes: number }>();
		for (const pt of analytics.series) {
			if (!pt.published_at) continue;
			const day = String(pt.published_at).split('T')[0];
			const cur = byDay.get(day) ?? { views: 0, likes: 0 };
			cur.views += pt.views || 0;
			cur.likes += pt.likes || 0;
			byDay.set(day, cur);
		}
		return [...byDay.entries()]
			.map(([date, v]) => ({ date, ...v }))
			.sort((a, b) => a.date.localeCompare(b.date));
	});

	let platformRows = $derived.by(() => {
		if (!analytics) return [];
		const entries = Object.entries(analytics.byPlatform);
		if (entries.length === 0) return [];
		const totalViews = entries.reduce((s, [, v]) => s + v.views, 0);
		const totalPosts = entries.reduce((s, [, v]) => s + v.posts, 0);
		return entries
			.map(([key, v]) => {
				// Share by views when views exist; otherwise by post count
				const pct =
					totalViews > 0
						? Math.round((v.views / totalViews) * 100)
						: totalPosts > 0
							? Math.round((v.posts / totalPosts) * 100)
							: 0;
				const name =
					key === 'x' ? 'Twitter/X' : key.charAt(0).toUpperCase() + key.slice(1);
				return {
					name,
					pct,
					views: v.views,
					posts: v.posts,
					color: platformColors[key] ?? defaultPlatformColor
				};
			})
			.sort((a, b) => b.pct - a.pct);
	});

	let stats = $derived.by(() => {
		if (!analytics) return [];
		const t = analytics.totals;
		return [
			{ label: 'Published Posts', value: formatNum(t.posts), color: '#6366f1' },
			{ label: 'Views', value: formatNum(t.views), color: '#22d3ee' },
			{ label: 'Likes', value: formatNum(t.likes), color: '#f472b6' },
			{ label: 'Comments', value: formatNum(t.comments), color: '#34d399' },
			{ label: 'Shares', value: formatNum(t.shares), color: '#fbbf24' },
			{
				label: 'Engagement Rate',
				value: analytics.totals.views > 0 ? analytics.engagementRate + '%' : '—',
				color: '#818cf8'
			}
		];
	});

	let selectedAgent = $derived(agents.find((a) => a.id === effectiveId));
</script>

<div class="analytics-panel">
	<div class="panel-header">
		<h4>Performance Analytics</h4>
		{#if agents.length > 0}
			<div class="agent-tabs" role="tablist" aria-label="Select persona">
				{#each agents as agent (agent.id)}
					<button
						class="agent-tab"
						class:active={effectiveId === agent.id}
						role="tab"
						aria-selected={effectiveId === agent.id}
						onclick={() => (selectedId = agent.id)}
					>
						{agent.name}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if agents.length === 0}
		<div class="panel-empty">
			<svg
				aria-hidden="true"
				width="28"
				height="28"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path d="M3 3v18h18" />
				<path d="M7 14l4-4 3 3 5-6" />
			</svg>
			<p>No analytics yet</p>
			<span>Create a persona and connect social accounts to start collecting performance data.</span>
		</div>
	{:else if loading}
		<div class="panel-empty subtle">
			<p>Loading analytics…</p>
		</div>
	{:else if error}
		<div class="panel-empty">
			<p class="error-text">Couldn't load analytics</p>
			<span>{error}</span>
		</div>
	{:else if analytics && analytics.totals.posts === 0}
		<div class="panel-empty">
			<svg
				aria-hidden="true"
				width="28"
				height="28"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path d="M3 3v18h18" />
				<path d="M7 14l4-4 3 3 5-6" />
			</svg>
			<p>No published posts yet{selectedAgent ? ` for ${selectedAgent.name}` : ''}</p>
			<span>
				Analytics appear here once this persona publishes posts to connected platforms and
				engagement data syncs back.
			</span>
		</div>
	{:else if analytics}
		<div class="stats-row">
			{#each stats as stat}
				<div class="stat-tile">
					<span class="stat-value" style="--stat-color: {stat.color}">{stat.value}</span>
					<span class="stat-label">{stat.label}</span>
				</div>
			{/each}
		</div>

		<div class="panel-grid">
			<div class="panel-chart">
				<h5>Views & Likes Over Time</h5>
				{#if chartSeries.length > 0}
					<AnalyticsChart series={chartSeries} />
				{:else}
					<div class="panel-empty subtle">
						<p>No time-series data yet</p>
						<span>Published posts have no engagement metrics recorded so far.</span>
					</div>
				{/if}
			</div>

			<div class="panel-platforms">
				<h5>By Platform</h5>
				{#if platformRows.length > 0}
					<div class="platform-rows">
						{#each platformRows as row (row.name)}
							<div class="platform-row">
								<span class="platform-label">{row.name}</span>
								<div class="platform-track">
									<div
										class="platform-fill"
										style="width: {row.pct}%; background: {row.color}"
									></div>
								</div>
								<span class="platform-val">
									{formatNum(row.views)} views · {row.posts}
									{row.posts === 1 ? 'post' : 'posts'}
								</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="panel-empty subtle">
						<p>No platform data yet</p>
						<span>Platform breakdown appears once posts are tagged with target platforms.</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.analytics-panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.75rem 1.75rem 1.5rem;
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}

	.panel-header h4 {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
	}

	.panel-header h4::before {
		content: '';
		display: inline-block;
		width: 3px;
		height: 14px;
		border-radius: 2px;
		background: var(--gradient-subtle);
		flex-shrink: 0;
	}

	.agent-tabs {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.agent-tab {
		padding: 5px 14px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-family: var(--font-body);
	}

	.agent-tab:hover {
		color: var(--text-muted);
		border-color: var(--border-strong);
	}

	.agent-tab.active {
		border-color: var(--accent-mid);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.stats-row {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.stat-tile {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		font-family: var(--font-display);
		color: var(--stat-color, var(--text));
		line-height: 1.2;
	}

	.stat-label {
		font-size: 0.65rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 600;
	}

	.panel-grid {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 1.5rem;
	}

	.panel-chart h5,
	.panel-platforms h5 {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0 0 0.85rem 0;
	}

	.platform-rows {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.platform-row {
		display: grid;
		grid-template-columns: 80px 1fr;
		grid-template-rows: auto auto;
		align-items: center;
		column-gap: 0.75rem;
		row-gap: 2px;
	}

	.platform-label {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.platform-track {
		width: 100%;
		background: var(--surface-2);
		border-radius: 6px;
		height: 14px;
		position: relative;
		overflow: hidden;
	}

	.platform-fill {
		height: 14px;
		border-radius: 6px;
		transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow: 0 0 8px rgba(255, 255, 255, 0.06);
	}

	.platform-val {
		grid-column: 2;
		font-size: 0.7rem;
		color: var(--text-dim);
		font-family: var(--font-mono);
	}

	.panel-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 2.5rem 1.5rem;
		gap: 0.4rem;
		color: var(--text-dim);
	}

	.panel-empty svg {
		opacity: 0.4;
		margin-bottom: 0.35rem;
	}

	.panel-empty p {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-muted);
		margin: 0;
	}

	.panel-empty span {
		font-size: 0.75rem;
		color: var(--text-dim);
		line-height: 1.5;
		max-width: 380px;
	}

	.panel-empty.subtle {
		padding: 1.75rem 1rem;
	}

	.error-text {
		color: var(--rose, #f43f5e) !important;
	}

	@media (max-width: 1024px) {
		.stats-row {
			grid-template-columns: repeat(3, 1fr);
		}

		.panel-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 480px) {
		.stats-row {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
