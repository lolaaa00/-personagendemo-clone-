<script lang="ts">
	import AnalyticsChart from './AnalyticsChart.svelte';
	import type { SeatCapabilities } from '$lib/seat';
	import { platformLabel, platformColor } from '$lib/platforms';

	interface Props {
		agents: any[];
		/** What this seat may do. Analytics is manager-and-above on the server. */
		seat?: SeatCapabilities;
	}

	let { agents, seat }: Props = $props();

	// Ask only when the answer can be yes. /api/analytics is manager+, so a
	// creator or viewer used to fire a 403 into the console on every dashboard
	// visit and get "Failed to load analytics" — an error that blamed the
	// network for a permission rule. Now the panel says what it is and why.
	let allowed = $derived(seat ? seat.canSeeSpend : true);

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

	// Names and colours come from $lib/platforms — the one list the dashboard's
	// Platform Distribution card and every persona page already use (audit
	// UI-003). This panel kept its own: a hard-coded "Twitter/X" in the old
	// Twitter blue, and raw keys title-cased into "Tiktok", "Linkedin",
	// "Youtube" and "Googlebusiness".

	async function loadAnalytics(agentId: string) {
		if (!allowed) return;
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
		if (effectiveId && allowed) {
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
				return {
					name: platformLabel(key),
					pct,
					views: v.views,
					posts: v.posts,
					color: platformColor(key)
				};
			})
			.sort((a, b) => b.pct - a.pct);
	});

	let stats = $derived.by(() => {
		if (!analytics) return [];
		const t = analytics.totals;
		// Stat tiles are TEXT, so they use the AA `-text` token variants — the raw brand
		// hues sit between 1.7:1 and 2.8:1 on the white card. Tokens also mean these
		// repaint when the brand theme changes.
		return [
			{ label: 'Published Posts', value: formatNum(t.posts), color: 'var(--accent-text)' },
			{ label: 'Views', value: formatNum(t.views), color: 'var(--cyan-text)' },
			{ label: 'Likes', value: formatNum(t.likes), color: 'var(--rose-text)' },
			{ label: 'Comments', value: formatNum(t.comments), color: 'var(--success-text)' },
			{ label: 'Shares', value: formatNum(t.shares), color: 'var(--warning-text)' },
			{
				label: 'Engagement Rate',
				value: analytics.totals.views > 0 ? analytics.engagementRate + '%' : '—',
				color: 'var(--info-text)'
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

	{#if !allowed}
		<div class="panel-empty" role="status">
			<svg
				aria-hidden="true"
				width="28"
				height="28"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z" />
				<path d="M9 12l2 2 4-4" />
			</svg>
			<p>Performance is a {seat?.label ?? 'Manager'}-seat view</p>
			<span
				>Your {seat?.label ?? 'current'} seat can see the work but not the numbers behind it. Ask a
				workspace admin for a Manager seat to see views, likes and spend.</span
			>
		</div>
	{:else if agents.length === 0}
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
		<div class="panel-empty subtle" role="status" aria-live="polite">
			<p>Loading analytics…</p>
		</div>
	{:else if error}
		<div class="panel-empty" role="alert">
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
								<!-- Redundant visual of the label + figures below it, so it is not
								     announced a second time. -->
								<div class="platform-track" aria-hidden="true">
									<div
										class="platform-fill"
										style="--platform-pct: {Math.max(0, Math.min(100, row.pct)) /
											100}; background: {row.color}"
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
		position: relative;
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

	/* The pill reads ~26px tall. Rather than inflating the design, the hit area is grown
	   to 44px with an overlay child so the tap target clears the minimum. */
	.agent-tab::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 44px;
		transform: translateY(-50%);
	}

	.agent-tab:hover {
		color: var(--text-muted);
		border-color: var(--border-strong);
	}

	.agent-tab.active {
		border-color: var(--accent-mid);
		/* raw --accent is 4.08:1 on the tinted pill — under AA for this 12px label. */
		color: var(--accent-text);
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
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
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

	/* Animating `width` relayouts every frame; scaleX composites instead. The fill has no
	   children and `.platform-val` is a grid sibling, so no text is squashed. */
	.platform-fill {
		width: 100%;
		height: 14px;
		border-radius: 6px;
		transform-origin: left center;
		transform: scaleX(var(--platform-pct, 0));
		transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow: 0 0 8px rgba(255, 255, 255, 0.06);
	}

	@media (prefers-reduced-motion: reduce) {
		.platform-fill {
			transition: none;
		}
	}

	.platform-val {
		grid-column: 2;
		font-size: 0.7rem;
		color: var(--text-dim);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
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
		/* `-text` variant: raw --rose is 4.59:1 on the white card, the error token is 6.5:1. */
		color: var(--error-text) !important;
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
