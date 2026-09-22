<script lang="ts">
	import { parseCompactCount, formatCompactCount } from '$lib/compact-count';

	interface KPI {
		icon: string;
		value: string;
		label: string;
		color: string;
		subtitle?: string;
	}

	interface Props {
		agents: any[];
		postsThisWeek?: number;
	}

	let { agents, postsThisWeek = 0 }: Props = $props();

	let kpis = $derived.by<KPI[]>(() => {
		const activeCount = agents.filter((a) => a.active && a.status !== 'pending').length;
		const totalCount = agents.length;
		const connectedCount = agents.filter(
			(a) => (a.connection_count || a.connectionCount || 0) > 0
		).length;

		// Avg engagement — over the personas the card's own qualifier describes:
		// published posts with stats (`hasMetrics`). Averaging every persona let a
		// stored rate on three personas that had published nothing produce "3.6%"
		// directly above a panel saying "No engagement data yet".
		let avgEngText = '—';
		const measured = agents.filter((a) => a.hasMetrics);
		if (measured.length) {
			const avgEng = measured.reduce((s, a) => s + (a.engagementRate || 0), 0) / measured.length;
			avgEngText = avgEng > 0 ? avgEng.toFixed(1) + '%' : '—';
		}

		// Posts this week (using real database statistics passed from server)
		const postsText = String(postsThisWeek);

		// Total followers across the roster. NOT "reach": reach is impressions,
		// and this is a sum of follower counts that includes paused and pending
		// personas with nothing published.
		let reachText = '—';
		if (agents.length) {
			// See compact-count.ts: the old string surgery counted "13.8K" as 138,000.
			const totalFollowers = agents.reduce((s, a) => s + parseCompactCount(a.followers), 0);
			reachText = formatCompactCount(totalFollowers);
		}

		return [
			{
				icon: 'agents',
				value: String(activeCount),
				label: 'Active Personas',
				// Token variants so the icon chips repaint with the brand theme and stay
				// legible on the light surface (the raw brand hues washed out on white).
				color: 'var(--accent-text)',
				// Each number names its own definition or period (audit ENH-005):
				// "0 Active Personas" beside "2 of 14 connected" read as a
				// contradiction when it was two different facts side by side.
				subtitle: `switched on to generate · ${connectedCount} of ${totalCount} connected`
			},
			{
				icon: 'engagement',
				value: avgEngText,
				label: 'Avg Engagement',
				color: 'var(--cyan-text)',
				subtitle: 'likes ÷ views, published posts with stats'
			},
			{
				icon: 'posts',
				value: postsText,
				label: 'Posts This Week',
				color: 'var(--success-text)',
				subtitle: 'published in the last 7 days'
			},
			{
				icon: 'reach',
				value: reachText,
				label: 'Total Followers',
				color: 'var(--rose-text)',
				subtitle: `across ${totalCount} ${totalCount === 1 ? 'persona' : 'personas'}`
			}
		];
	});
</script>

<div class="dash-kpi-row">
	{#each kpis as kpi}
		<div class="dash-kpi">
			<div class="dash-kpi-icon" style="--kpi-color: {kpi.color}">
				{#if kpi.icon === 'agents'}
					<svg
						aria-hidden="true"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<circle cx="12" cy="8" r="4" />
						<path d="M20 21a8 8 0 10-16 0" />
					</svg>
				{:else if kpi.icon === 'engagement'}
					<svg
						aria-hidden="true"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
					</svg>
				{:else if kpi.icon === 'posts'}
					<svg
						aria-hidden="true"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
						<line x1="16" y1="2" x2="16" y2="6" />
						<line x1="8" y1="2" x2="8" y2="6" />
						<line x1="3" y1="10" x2="21" y2="10" />
					</svg>
				{:else if kpi.icon === 'reach'}
					<svg
						aria-hidden="true"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
						<circle cx="12" cy="12" r="3" />
					</svg>
				{/if}
			</div>
			<div class="dash-kpi-data">
				<span class="dash-kpi-num">{kpi.value}</span>
				<span class="dash-kpi-label">{kpi.label}</span>
				{#if kpi.subtitle}
					<span class="dash-kpi-subtitle">{kpi.subtitle}</span>
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.dash-kpi-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.dash-kpi {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		transition:
			border-color 0.3s,
			transform 0.3s;
	}

	.dash-kpi:hover {
		border-color: var(--border-hover);
		transform: translateY(-2px);
	}

	.dash-kpi-icon {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		/* A flat white alpha is invisible on the light card; tinting with the KPI colour
		   gives the chip a visible shape in both themes. */
		background: color-mix(in srgb, var(--kpi-color, var(--accent)) 12%, transparent);
		color: var(--kpi-color, var(--accent));
		flex-shrink: 0;
	}

	.dash-kpi-data {
		display: flex;
		flex-direction: column;
	}

	.dash-kpi-num {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
		font-family: var(--font-display);
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}

	.dash-kpi-label {
		font-size: 0.72rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 600;
	}

	.dash-kpi-subtitle {
		font-size: 0.65rem;
		color: var(--text-dim);
		margin-top: 2px;
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}

	@media (max-width: 1024px) {
		.dash-kpi-row {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.dash-kpi-row {
			grid-template-columns: 1fr;
			gap: 0.5rem;
		}
	}
</style>
