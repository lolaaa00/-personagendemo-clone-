<script lang="ts">
	import KPIGrid from '$lib/components/dashboard/KPIGrid.svelte';
	import AgentRoster from '$lib/components/agents/AgentRoster.svelte';
	import SparkChart from '$lib/components/dashboard/SparkChart.svelte';
	import PlatformBars from '$lib/components/dashboard/PlatformBars.svelte';
	import AgentChat from '$lib/components/agents/AgentChat.svelte';

	let { data } = $props();

	// Get the first active agent, or fall back to the first agent
	let chatAgent = $derived(
		data.agents.find((a: any) => a.status === 'active') || data.agents[0]
	);
</script>

<svelte:head>
	<title>Dashboard — PersonaGen</title>
	<meta name="description" content="PersonaGen Operations Dashboard — live status, metrics, and health scores for your autonomous creator roster." />
</svelte:head>

<div class="dashboard-page">
	<!-- Section Tag -->
	<span class="section-tag tag-teal">Operations Center</span>
	<h2 class="section-title">Agent Network Health & Status</h2>
	<p class="section-lead">
		Live status, metrics, and health scores for your autonomous creator roster.
	</p>

	<!-- KPI Grid -->
	<KPIGrid agents={data.agents} postsThisWeek={data.postsThisWeek} />

	<!-- Quick Actions -->
	<div class="quick-actions">
		<a href="/calendar" class="btn-primary">
			📅 New Post
		</a>
		<a href="/generator" class="btn-ghost">
			✨ Create Agent
		</a>
	</div>

	<!-- Agent Roster Table -->
	<div class="roster-section">
		<AgentRoster agents={data.agents} />
	</div>

	<!-- Charts Row -->
	<div class="dash-chart-row">
		<SparkChart sparkData={data.sparkData} agents={data.agents} />
		<PlatformBars platforms={data.platformData} />
	</div>

	{#if chatAgent}
		<AgentChat
			agentId={chatAgent.id}
			agentName={chatAgent.name}
			agentGradient={chatAgent.gradient}
			agentInitial={chatAgent.initial}
		/>
	{/if}
</div>

<style>
	.dashboard-page {
		max-width: 100%;
	}

	/* Section tags */
	.section-tag {
		display: inline-block;
		padding: 4px 14px;
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		margin-bottom: 1rem;
	}

	.tag-teal {
		background: var(--cyan-soft);
		color: var(--cyan);
	}

	.section-title {
		font-family: var(--font-display);
		font-size: clamp(1.8rem, 3.5vw, 2.6rem);
		font-weight: 600;
		line-height: 1.2;
		margin-bottom: 0.75rem;
	}

	.section-lead {
		color: var(--text-muted);
		font-size: 0.95rem;
		line-height: 1.7;
		max-width: 640px;
		margin-bottom: 2.5rem;
	}

	/* Quick actions */
	.quick-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1.25rem;
		flex-wrap: wrap;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 0.6rem 1.2rem;
		border-radius: 12px;
		background: linear-gradient(135deg, var(--accent), #6366f1);
		color: #fff;
		font-weight: 600;
		font-size: 0.82rem;
		text-decoration: none;
		border: none;
		cursor: pointer;
		transition:
			transform 0.2s,
			box-shadow 0.3s;
		font-family: var(--font-body);
	}

	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-accent);
	}

	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 0.6rem 1.2rem;
		border-radius: 12px;
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
		font-weight: 600;
		font-size: 0.82rem;
		text-decoration: none;
		cursor: pointer;
		background: transparent;
		transition:
			border-color 0.2s,
			color 0.2s;
		font-family: var(--font-body);
	}

	.btn-ghost:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	/* Roster section */
	.roster-section {
		margin-top: 2rem;
	}

	/* Charts row */
	.dash-chart-row {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 1.25rem;
		margin-top: 2rem;
	}

	@media (max-width: 1024px) {
		.dash-chart-row {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 480px) {
		.quick-actions {
			flex-direction: column;
		}

		.btn-primary,
		.btn-ghost {
			width: 100%;
			justify-content: center;
		}
	}
</style>
