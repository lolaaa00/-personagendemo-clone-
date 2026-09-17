<script lang="ts">
	import KPIGrid from '$lib/components/dashboard/KPIGrid.svelte';
	import AgentRoster from '$lib/components/agents/AgentRoster.svelte';
	import SparkChart from '$lib/components/dashboard/SparkChart.svelte';
	import PlatformBars from '$lib/components/dashboard/PlatformBars.svelte';
	import AnalyticsPanel from '$lib/components/dashboard/AnalyticsPanel.svelte';
	import PageShell from '$lib/components/ui/PageShell.svelte';

	let { data } = $props();

	let creatorAgents = $derived(data.agents.filter((a) => !a.is_overseer));
</script>


<svelte:head>
	<meta
		name="description"
		content="PersonaGen dashboard — status, engagement and spend for every persona you run."
	/>
</svelte:head>

<PageShell
	title="Dashboard"
	width="wide"
	description="Status, engagement and spend for every persona you run."
>
	<div class="dashboard-page">

	<!-- KPI Grid -->
	<KPIGrid agents={data.agents} postsThisWeek={data.postsThisWeek} />

	{#if creatorAgents.length === 0}
		<div class="onboarding-card">
			<div class="onboarding-header">
				<h3>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
						<path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
						<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
						<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
					</svg>
					Welcome to PersonaGen! Let's initialize your Persona Roster
				</h3>
				<p>Create your first persona and connect it to a platform to start publishing.</p>
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
					<p>Connect your persona to Instagram, TikTok, YouTube, and 12 more platforms via Zernio's hosted OAuth on the Connections tab.</p>
					<span class="step-note">Unlocks once your first persona exists</span>
				</div>
				<div class="step-box">
					<div class="step-num">3</div>
					<h4>Configure API Keys</h4>
					<p>Ensure your AI, Zernio, and Supabase connections are operational under system settings.</p>
					<a href="/settings" class="step-link">Manage Environment →</a>
				</div>
			</div>
		</div>
	{/if}

	<!-- Quick Actions -->
	<div class="quick-actions">
		<a href="/calendar" class="btn-primary">
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M8 2v4" />
				<path d="M16 2v4" />
				<rect width="18" height="18" x="3" y="4" rx="2" />
				<path d="M3 10h18" />
				<path d="M12 14v4" />
				<path d="M10 16h4" />
			</svg>
			New Post
		</a>
		<a href="/generator" class="btn-ghost">
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M9.94 14.06 3 21" />
				<path d="M14 4.5 15.5 8l3.5 1.5-3.5 1.5L14 14.5 12.5 11 9 9.5 12.5 8 14 4.5z" />
				<path d="M5 3v4" />
				<path d="M3 5h4" />
				<path d="M19 17v4" />
				<path d="M17 19h4" />
			</svg>
			Create Persona
		</a>
	</div>

	<!-- Agent Roster Table -->
	<div class="roster-section">
		<AgentRoster agents={data.agents} />
	</div>

	<!-- Charts Row -->
	<div class="dash-chart-row">
		{#if data.sparkData.length > 0}
			<SparkChart sparkData={data.sparkData} agents={data.sparkAgents} />
		{:else}
			<div class="dash-chart-card">
				<h4>Engagement Trend (7 Days)</h4>
				<div class="chart-empty">
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
					<p>No engagement data yet</p>
					<span>
						Engagement trends appear here once your personas publish posts and analytics sync back
						from connected platforms.
					</span>
				</div>
			</div>
		{/if}
		<PlatformBars platforms={data.platformData} />
	</div>

	<!-- Analytics Section -->
	<div class="analytics-section">
		<AnalyticsPanel agents={creatorAgents} seat={(data as any).seat} />
	</div>
</PageShell>

<style>
	.dashboard-page {
		max-width: 100%;
	}

	/* Onboarding Card styling */
	.onboarding-card {
		background: linear-gradient(135deg, var(--surface), var(--surface-2));
		backdrop-filter: blur(12px);
		border: 1px solid var(--accent-mid);
		border-radius: var(--radius);
		padding: 2rem;
		margin-top: 1.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
	}

	.onboarding-header h3 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 0.5rem 0;
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.onboarding-header h3 svg {
		flex-shrink: 0;
		color: var(--accent-text);
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
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
	}

	.step-num {
		position: absolute;
		top: 1rem;
		right: 1rem;
		font-size: 1.75rem;
		font-weight: 900;
		font-family: var(--font-mono);
		color: color-mix(in srgb, var(--accent) 22%, transparent);
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
		color: var(--accent-text);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		transition: color 0.2s;
	}

	.step-link:hover:not(.disabled) {
		color: var(--accent);
		text-decoration: underline;
	}

	.step-note {
		font-size: var(--text-sm);
		color: var(--text-dim);
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
		min-height: 44px;
		border-radius: var(--radius-sm);
		background: var(--gradient-cta);
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
		min-height: 44px;
		border-radius: var(--radius-sm);
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

	/* Sparkline empty-state card (matches SparkChart's card shell) */
	.dash-chart-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.75rem 1.75rem 1.5rem;
		overflow: hidden;
	}

	.dash-chart-card h4 {
		font-size: 0.8rem;
		font-weight: 700;
		margin-bottom: 1.25rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.dash-chart-card h4::before {
		content: '';
		display: inline-block;
		width: 3px;
		height: 14px;
		border-radius: 2px;
		background: var(--gradient-subtle);
		flex-shrink: 0;
	}

	.chart-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 2.5rem 1.5rem;
		gap: 0.4rem;
		color: var(--text-dim);
	}

	.chart-empty svg {
		opacity: 0.4;
		margin-bottom: 0.35rem;
	}

	.chart-empty p {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-muted);
		margin: 0;
	}

	.chart-empty span {
		font-size: 0.75rem;
		color: var(--text-dim);
		line-height: 1.5;
		max-width: 340px;
	}

	/* Analytics section */
	.analytics-section {
		margin-top: 1.25rem;
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
