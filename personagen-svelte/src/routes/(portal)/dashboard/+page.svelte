<script lang="ts">
	import KPIGrid from '$lib/components/dashboard/KPIGrid.svelte';
	import AgentRoster from '$lib/components/agents/AgentRoster.svelte';
	import SparkChart from '$lib/components/dashboard/SparkChart.svelte';
	import PlatformBars from '$lib/components/dashboard/PlatformBars.svelte';

	let { data } = $props();

	let creatorAgents = $derived(data.agents.filter((a) => !a.is_overseer));
</script>


<svelte:head>
	<title>Dashboard — PersonaGen</title>
	<meta
		name="description"
		content="PersonaGen Operations Dashboard — live status, metrics, and health scores for your autonomous creator roster."
	/>
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

	{#if creatorAgents.length === 0}
		<div class="onboarding-card">
			<div class="onboarding-header">
				<h3>🚀 Welcome to PersonaGen! Let's initialize your Agent Network</h3>
				<p>Deploy your first autonomous creator and link them to social platforms to begin operations.</p>
			</div>
			
			<div class="onboarding-steps">
				<div class="step-box">
					<div class="step-num">1</div>
					<h4>Create Persona</h4>
					<p>Design a tailored niche, target audience, and personality. Create it in the database directly or use Account Factory registration.</p>
					<a href="/generator" class="step-link">Configure Persona →</a>
				</div>
				<div class="step-box">
					<div class="step-num">2</div>
					<h4>Link Platforms</h4>
					<p>Connect your persona to Instagram, TikTok, YouTube, or Twitter/X using Composio integration in the agent settings.</p>
					<span class="step-link disabled">Awaiting Agent Creation</span>
				</div>
				<div class="step-box">
					<div class="step-num">3</div>
					<h4>Configure API Keys</h4>
					<p>Ensure Gemini API, Composio, and Supabase connections are operational under system settings.</p>
					<a href="/settings" class="step-link">Manage Environment →</a>
				</div>
			</div>
		</div>
	{/if}

	<!-- Quick Actions -->
	<div class="quick-actions">
		<a href="/calendar" class="btn-primary"> 📅 New Post </a>
		<a href="/generator" class="btn-ghost"> ✨ Create Agent </a>
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
</div>

<style>
	.dashboard-page {
		max-width: 100%;
	}

	/* Onboarding Card styling */
	.onboarding-card {
		background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8));
		backdrop-filter: blur(12px);
		border: 1px solid rgba(99, 102, 241, 0.2);
		border-radius: var(--radius);
		padding: 2rem;
		margin-top: 1.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
	}

	.onboarding-header h3 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 600;
		color: #fff;
		margin: 0 0 0.5rem 0;
	}

	.onboarding-header p {
		font-size: 0.85rem;
		color: var(--text-dim);
		margin: 0 0 1.5rem 0;
	}

	.onboarding-steps {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1.25rem;
	}

	.step-box {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1.25rem;
		position: relative;
		display: flex;
		flex-direction: column;
		transition: transform 0.2s, border-color 0.2s;
	}

	.step-box:hover {
		transform: translateY(-2px);
		border-color: rgba(99, 102, 241, 0.4);
	}

	.step-num {
		position: absolute;
		top: 1rem;
		right: 1rem;
		font-size: 1.75rem;
		font-weight: 900;
		font-family: var(--font-mono);
		color: rgba(99, 102, 241, 0.15);
		line-height: 1;
	}

	.step-box h4 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 0.5rem 0;
	}

	.step-box p {
		font-size: 0.75rem;
		color: var(--text-dim);
		line-height: 1.5;
		margin: 0 0 1.25rem 0;
		flex-grow: 1;
	}

	.step-link {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		transition: color 0.2s;
	}

	.step-link:hover:not(.disabled) {
		color: #818cf8;
	}

	.step-link.disabled {
		color: var(--text-dim);
		cursor: not-allowed;
		opacity: 0.5;
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
