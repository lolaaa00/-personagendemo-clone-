<script lang="ts">
	import StatusBadge from './StatusBadge.svelte';
	import { goto } from '$app/navigation';
	import { showToast } from '$lib/stores/ui.svelte';
	// Using any[] because agents data comes from raw JSON with camelCase fields
	interface Props {
		agents: any[];
	}

	let { agents }: Props = $props();

	type FilterType = 'all' | 'active' | 'paused' | 'pending' | 'top';

	let currentFilter = $state<FilterType>('all');

	let filteredAgents = $derived.by(() => {
		let result = agents.filter((a) => a.status === 'active' || a.is_overseer);
		switch (currentFilter) {
			case 'active':
				return result.filter((a) => a.status === 'active');
			case 'paused':
				return result.filter((a) => a.status === 'paused' || a.status === 'failing');
			case 'pending':
				return result.filter((a) => a.status === 'pending');
			case 'top':
				return result.filter((a) => a.perf >= 70).sort((a, b) => b.perf - a.perf);
			default:
				return result;
		}
	});

	const filters: { label: string; value: FilterType }[] = [
		{ label: 'All', value: 'all' },
		{ label: 'Active', value: 'active' },
		{ label: 'Paused', value: 'paused' },
		{ label: 'Pending', value: 'pending' },
		{ label: 'Top Performers', value: 'top' }
	];

	function trendClass(t: string): string {
		if (t.startsWith('+')) return 'positive';
		if (t.startsWith('-')) return 'negative';
		return 'neutral';
	}

	function perfColor(p: number): string {
		if (p >= 70) return '#22c55e';
		if (p >= 40) return '#f59e0b';
		return '#ef4444';
	}

	function engagementClass(eng: number): string {
		if (eng >= 5) return 'positive';
		if (eng < 3) return 'negative';
		return '';
	}

	async function toggleAgent(agent: any) {
		if (agent.status === 'pending') return;
		const originalActive = agent.active;
		const originalStatus = agent.status;

		agent.active = !agent.active;
		agent.status = agent.active ? 'active' : 'paused';

		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					agentId: agent.id,
					status: agent.status
				})
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || 'Server error');
			}
			showToast(`Status updated to ${agent.status} for ${agent.name}`, 'success');
		} catch (err: any) {
			console.error('[AgentRoster] Failed to toggle status in DB:', err);
			agent.active = originalActive;
			agent.status = originalStatus;
			showToast(err.message || 'Failed to sync status with database', 'error');
		}
	}

	function formatTokens(tokens: number): string {
		if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
		if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
		return String(tokens);
	}
</script>

<div class="dash-table-wrap">
	<div class="dash-table-header">
		<h3>Agent Roster</h3>
		<div class="dash-table-filters" role="tablist" aria-label="Filter agents">
			{#each filters as filter}
				<button
					class="dash-filter"
					class:active={currentFilter === filter.value}
					role="tab"
					aria-selected={currentFilter === filter.value}
					onclick={() => (currentFilter = filter.value)}
				>
					{filter.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="dash-table" role="table" aria-label="Agent roster table">
		<!-- Header Row -->
		<div class="dash-row row-header" role="row">
			<span role="columnheader">Agent</span>
			<span role="columnheader">Followers</span>
			<span role="columnheader">Engagement</span>
			<span role="columnheader">Gen Spend</span>
			<span role="columnheader">Performance</span>
			<span role="columnheader">Active</span>
		</div>

		<!-- Agent Rows -->
		{#each filteredAgents as agent (agent.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
			<div
				onclick={() => goto(`/persona-config/${agent.id}`)}
				class="dash-row"
				role="link"
				tabindex="0"
			>
				<div class="dash-agent-cell" role="cell">
					<div class="dash-agent-avatar" style="background: {agent.gradient}">
						{agent.initial}
					</div>
					<div class="dash-agent-info">
						<span class="dash-agent-name" style="display: flex; align-items: center; gap: 0.5rem;">
							{agent.name}
							{#if agent.is_overseer}
								<span
									style="font-size: 9px; background: linear-gradient(135deg, #10B981, #06B6D4); color: white; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase; line-height: 1;"
									>Hermes</span
								>
							{:else if agent.managed_by_overseer}
								<span
									style="font-size: 9px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #10B981; padding: 1px 5px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 2px; line-height: 1;"
									title="Orchestrated and monitored by Hermes"
								>
									🛡️ Managed
								</span>
							{/if}
						</span>
						<span class="dash-agent-niche">
							{agent.handle} · {agent.niche} ·
							<StatusBadge status={agent.status} />
						</span>
					</div>
				</div>
				<span class="dash-cell" role="cell">{agent.followers}</span>
				<span class="dash-cell {engagementClass(agent.engagementRate)}" role="cell">
					{agent.engagementRate}%
				</span>
				<span class="dash-cell token-cost-cell" role="cell">
					{#if agent.total_token_cost !== undefined && agent.total_token_cost !== null && agent.total_token_cost > 0}
						${agent.total_token_cost.toFixed(2)}
						<span class="token-count">({formatTokens(agent.total_token_usage || 0)})</span>
					{:else}
						$0.00 <span class="token-count">(0)</span>
					{/if}
				</span>
				<span class="dash-cell" role="cell">
					<div class="perf-bar-wrap">
						<div class="perf-bar-bg">
							<div
								class="perf-bar"
								style="width: {agent.perf}%; background: {perfColor(agent.perf)}"
							></div>
						</div>
						<span class="perf-val">{agent.perf}</span>
					</div>
				</span>
				<span class="dash-cell" role="cell">
					{#if agent.status === 'pending'}
						<a
							class="agent-connect-cta"
							href="/persona-config/{agent.id}"
							onclick={(e) => e.stopPropagation()}
						>
							Connect →
						</a>
					{:else}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<label
							class="toggle"
							onclick={(e) => {
								e.stopPropagation();
								toggleAgent(agent);
							}}
						>
							<input type="checkbox" checked={agent.active} tabindex="-1" />
							<span class="toggle-track"></span>
							<span class="toggle-thumb"></span>
						</label>
					{/if}
				</span>
			</div>
		{/each}

		{#if filteredAgents.length === 0}
			<div class="dash-empty">
				<p>No agents match this filter.</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.dash-table-wrap {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
	}

	.dash-table-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.dash-table-header h3 {
		font-size: 0.95rem;
		font-weight: 600;
	}

	.dash-table-filters {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.dash-filter {
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

	.dash-filter:hover {
		color: var(--text-muted);
		border-color: var(--border-strong);
	}

	.dash-filter.active {
		border-color: var(--accent-mid);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.dash-row {
		display: grid;
		grid-template-columns: 2.5fr 1fr 1fr 1fr 1.2fr 0.6fr;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.5rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.82rem;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.dash-row:hover:not(.row-header) {
		background: rgba(255, 255, 255, 0.02);
	}

	.dash-row:last-child {
		border-bottom: none;
	}

	.dash-row.row-header {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		font-weight: 700;
		border-bottom: 1px solid var(--border-strong);
		padding-bottom: 0.5rem;
		margin-bottom: 0.25rem;
		cursor: default;
	}

	.dash-agent-cell {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.dash-agent-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 700;
		color: #fff;
		flex-shrink: 0;
	}

	.dash-agent-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.dash-agent-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dash-agent-niche {
		font-size: 0.7rem;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.dash-cell {
		font-size: 0.82rem;
		color: var(--text-muted);
	}

	.dash-cell.positive {
		color: var(--success);
	}

	.dash-cell.negative {
		color: var(--rose);
	}

	.perf-bar-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.perf-bar-bg {
		flex: 1;
		height: 5px;
		background: var(--surface-3);
		border-radius: 3px;
		overflow: hidden;
	}

	.perf-bar {
		height: 5px;
		border-radius: 3px;
		transition: width 0.5s ease;
	}

	.perf-val {
		font-size: 0.7rem;
		min-width: 28px;
		text-align: right;
		color: var(--text-dim);
		font-family: var(--font-mono);
	}

	/* Toggle switch */
	.toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
		width: 36px;
		height: 20px;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-track {
		position: absolute;
		inset: 0;
		border-radius: 10px;
		background: var(--border-strong);
		transition: background 0.2s;
	}

	.toggle input:checked ~ .toggle-track {
		background: var(--accent);
	}

	.toggle-thumb {
		position: absolute;
		left: 2px;
		top: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.2s;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.toggle input:checked ~ .toggle-thumb {
		transform: translateX(16px);
	}

	/* Connect CTA */
	.agent-connect-cta {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border-radius: var(--radius-xs);
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.3);
		color: #f59e0b;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s;
	}

	.agent-connect-cta:hover {
		background: rgba(245, 158, 11, 0.2);
	}

	.dash-empty {
		padding: 2rem;
		text-align: center;
		color: var(--text-dim);
		font-size: 0.85rem;
	}

	@media (max-width: 768px) {
		.dash-row {
			grid-template-columns: 1fr;
			gap: 0.5rem;
			padding: 0.75rem 0.5rem;
		}

		.dash-row.row-header {
			display: none;
		}

		.dash-cell {
			font-size: 0.75rem;
		}

		.dash-table-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	.token-cost-cell {
		color: #f59e0b !important;
		font-family: var(--font-mono);
		font-weight: 500;
	}

	.token-count {
		font-size: 0.7rem;
		color: var(--text-dim);
	}
</style>
