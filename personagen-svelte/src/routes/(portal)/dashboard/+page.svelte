<script lang="ts">
	import KPIGrid from '$lib/components/dashboard/KPIGrid.svelte';
	import AgentRoster from '$lib/components/agents/AgentRoster.svelte';
	import SparkChart from '$lib/components/dashboard/SparkChart.svelte';
	import PlatformBars from '$lib/components/dashboard/PlatformBars.svelte';
	import AnalyticsPanel from '$lib/components/dashboard/AnalyticsPanel.svelte';
	import PageShell from '$lib/components/ui/PageShell.svelte';

	let { data } = $props();

	let creatorAgents = $derived(data.agents.filter((a) => !a.is_overseer));

	// ── Setup checklist (ENH-002) ────────────────────────────────────────
	// The order the docs prescribe, each row checked against real state. It
	// disappears on its own once everything is done.
	//
	// Rebuilt after a client re-audit found four defects in the first version:
	//   · it led with "Add an OpenRouter key — nothing generates without it", a
	//     step nobody can complete since customer generation keys were withdrawn,
	//     so the card could never finish;
	//   · "Connect" linked to /personas, which has no index page (404);
	//   · "Hide" lived only in component state and came back on every visit;
	//   · a workspace SEAT was checked against its own empty rows and told to
	//     write a brief, add a Zernio key and connect accounts that belong to the
	//     owner — while the cards beside it showed the workspace connected.
	// Setup is the account owner's job, so seat members are not shown it (the
	// server sends no `setup` for them); everyone else gets only steps they can
	// actually perform, each with a target that exists.
	const SETUP_HIDE_KEY = 'pg:setup-hidden';
	let setupDismissed = $state(false);
	$effect(() => {
		try {
			setupDismissed = localStorage.getItem(SETUP_HIDE_KEY) === '1';
		} catch {
			/* storage blocked (private window): the card simply shows */
		}
	});
	function dismissSetup() {
		setupDismissed = true;
		try {
			localStorage.setItem(SETUP_HIDE_KEY, '1');
		} catch {
			/* not persisted — it still hides for this visit */
		}
	}
	let firstPersonaId = $derived(creatorAgents[0]?.id ?? null);
	let setupSteps = $derived.by(() => {
		const st = (data as any).setup;
		if (!st) return [];
		const hasPersona = creatorAgents.length > 0;
		return [
			{
				key: 'persona',
				done: hasPersona,
				title: 'Create a persona',
				why: 'The account that posts. You can change everything about it later.',
				href: '/generator',
				cta: 'Create',
				blocked: null as string | null
			},
			{
				key: 'brief',
				done: st.brief,
				title: 'Write a brand brief',
				why: 'What your product is and who it is for — captions are aimed at it.',
				href: '/brand-brief',
				cta: 'Write it',
				blocked: null
			},
			{
				key: 'zernio',
				done: st.zernio,
				title: 'Add your Zernio key',
				why: 'Publishing runs on it, and it is yours: sign in at zernio.com with Google — the free account includes 2 connections — then paste the key here.',
				href: '/settings?section=api-keys',
				cta: 'Add key',
				blocked: null
			},
			{
				key: 'connection',
				done: st.connection,
				title: 'Connect a social account',
				why: 'Where the posts go — connected per persona.',
				href: firstPersonaId ? `/personas/${firstPersonaId}?tab=connections` : '/generator',
				cta: 'Connect',
				blocked: hasPersona ? null : 'Create a persona first — accounts are connected to a persona.'
			},
			{
				key: 'published',
				done: st.published,
				title: 'Publish your first post',
				why: 'Approve a draft in the review queue and let it run.',
				href: '/review',
				cta: 'Open queue',
				blocked: null
			}
		];
	});
	let setupDone = $derived(setupSteps.filter((s) => s.done).length);
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

	{#if setupSteps.length && !setupDismissed}
		<section class="setup-card" aria-labelledby="setup-h">
			<div class="setup-head">
				<h2 id="setup-h">Finish setting up</h2>
				<button type="button" class="setup-dismiss" onclick={dismissSetup}>Hide</button>
			</div>
			<p class="setup-sub">
				{setupDone} of {setupSteps.length} done. Each step is checked against your account, not
				against whether you have visited the page.
			</p>
			<ol class="setup-list">
				{#each setupSteps as st (st.key)}
					<li class="setup-step" class:done={st.done}>
						<span class="setup-mark" aria-hidden="true">{st.done ? '✓' : ''}</span>
						<span class="setup-text">
							<strong>{st.title}</strong>
							<span>{st.why}</span>
						</span>
						{#if !st.done && st.blocked}
							<span class="setup-blocked">{st.blocked}</span>
						{:else if !st.done}
							<a class="setup-go" href={st.href}>{st.cta}</a>
						{:else}
							<span class="setup-ok">Done</span>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<!-- The old "Welcome — initialize your Persona Roster" card used to sit here,
	     repeating the checklist above in static form. It said "Create it in the
	     database directly or use Account Factory registration", and after the
	     2026-09-21 key change it told the same user "there is nothing else to set
	     up" directly under a five-step checklist. One setup surface, driven by
	     real state, is the checklist. -->

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
			Open calendar
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
		<AgentRoster agents={data.agents} seat={(data as any).seat} />
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
	</div>
</PageShell>

<style>
	.dashboard-page {
		max-width: 100%;
	}

	/* Onboarding Card styling */
	.setup-card {
		margin-bottom: var(--space-6);
		padding: var(--space-5);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.setup-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
	}
	.setup-head h2 {
		margin: 0;
		font-size: var(--text-lg);
	}
	.setup-dismiss {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--text-dim);
		cursor: pointer;
		text-decoration: underline;
	}
	.setup-sub {
		margin: var(--space-2) 0 var(--space-4);
		font-size: var(--text-base);
		color: var(--text-muted);
	}
	.setup-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-2);
	}
	.setup-step {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.setup-step.done {
		opacity: 0.68;
	}
	.setup-mark {
		flex: none;
		width: 22px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		color: var(--success-text);
		font-weight: 700;
	}
	.setup-step.done .setup-mark {
		border-color: var(--success-text);
	}
	.setup-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.setup-text span {
		font-size: var(--text-base);
		color: var(--text-muted);
	}
	.setup-go {
		flex: none;
		min-height: 36px;
		display: inline-flex;
		align-items: center;
		padding: 0 var(--space-4);
		border-radius: var(--radius-full);
		background: var(--gradient-cta);
		color: #fff;
		font-size: var(--text-base);
		font-weight: 600;
		text-decoration: none;
	}
	.setup-ok {
		flex: none;
		font-size: var(--text-base);
		color: var(--success-text);
	}
	@media (max-width: 640px) {
		.setup-step {
			flex-wrap: wrap;
		}
		.setup-go {
			width: 100%;
			justify-content: center;
		}
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
	.setup-blocked {
		font-size: var(--text-sm);
		color: var(--text-dim);
		max-width: 16rem;
		text-align: right;
	}
</style>
