<script lang="ts">
	interface KPI {
		icon: string;
		value: string;
		label: string;
		color: string;
		subtitle?: string;
	}

	interface Props {
		agents: any[];
	}

	let { agents }: Props = $props();

	let kpis = $derived.by<KPI[]>(() => {
		const activeCount = agents.filter(
			(a) => a.active && a.status !== 'pending'
		).length;
		const totalCount = agents.length;
		const connectedCount = agents.filter(
			(a) => (a.connectionCount || 0) > 0
		).length;

		// Avg engagement
		let avgEngText = '—';
		if (agents.length) {
			const avgEng =
				agents.reduce((s, a) => s + (a.engagementRate || 0), 0) / agents.length;
			avgEngText = avgEng > 0 ? avgEng.toFixed(1) + '%' : '—';
		}

		// Posts this week (simulated: 3 per active agent)
		const postsText = String(activeCount * 3);

		// Total reach
		let reachText = '—';
		if (agents.length) {
			const totalFollowers = agents.reduce((s, a) => {
				const f = String(a.followers || '0')
					.replace(/[Kk]/g, '000')
					.replace(/[Mm]/g, '000000')
					.replace(/\./g, '');
				return s + (parseInt(f) || 0);
			}, 0);
			if (totalFollowers >= 1000000)
				reachText = (totalFollowers / 1000000).toFixed(1) + 'M';
			else if (totalFollowers >= 1000)
				reachText = (totalFollowers / 1000).toFixed(1) + 'K';
			else reachText = String(totalFollowers);
		}

		return [
			{
				icon: 'agents',
				value: String(activeCount),
				label: 'Active Agents',
				color: '#6366f1',
				subtitle: `${connectedCount} of ${totalCount} connected`
			},
			{
				icon: 'engagement',
				value: avgEngText,
				label: 'Avg Engagement',
				color: '#22d3ee'
			},
			{
				icon: 'posts',
				value: postsText,
				label: 'Posts This Week',
				color: '#34d399'
			},
			{
				icon: 'reach',
				value: reachText,
				label: 'Total Reach',
				color: '#f472b6'
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
		background: rgba(255, 255, 255, 0.04);
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
