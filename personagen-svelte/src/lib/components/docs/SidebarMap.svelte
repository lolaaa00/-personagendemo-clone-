<script lang="ts">
	import DocsDemo from './DocsDemo.svelte';

	/**
	 * A clickable miniature of the real sidebar. Same five groups and the same
	 * labels the layout renders; clicking a group explains what lives there.
	 * Replaces a 360×2250 screenshot that was unreadable at any column width.
	 */
	interface Item {
		label: string;
		href: string;
		blurb: string;
	}
	interface Group {
		label: string;
		blurb: string;
		items: Item[];
	}
	const GROUPS: Group[] = [
		{
			label: 'Network',
			blurb: 'Home base. Persona health, engagement, and what needs you today.',
			items: [{ label: 'Dashboard', href: '/dashboard', blurb: 'KPIs, the persona roster and quick actions.' }]
		},
		{
			label: 'Library',
			blurb: 'Everything your personas have ever made, across all of them.',
			items: [
				{ label: 'All Generations', href: '/generations', blurb: 'Every image and video, filterable by persona, format and date.' },
				{ label: 'My Favorites', href: '/favorites', blurb: 'Anything you hearted, in one place.' },
				{ label: 'Trash', href: '/trash', blurb: 'Deleted items, restorable for a while.' }
			]
		},
		{
			label: 'Publish',
			blurb: 'Where drafts become live posts.',
			items: [
				{ label: 'Review Queue', href: '/review', blurb: 'Approve, edit or reject what was generated.' },
				{ label: 'Calendar', href: '/calendar', blurb: 'Scheduled posts by day, week or month.' }
			]
		},
		{
			label: 'Setup',
			blurb: 'The things you configure once.',
			items: [
				{ label: 'Brand Brief', href: '/brand-brief', blurb: 'What your brand is — every persona writes from it.' },
				{ label: 'Docs', href: '/guides', blurb: 'This page.' },
				{ label: 'Developer API', href: '/developer', blurb: 'Keys for driving PersonaGen from your own code.' },
				{ label: 'Billing', href: '/billing', blurb: 'Your wallet, what things cost, and top-ups.' },
				{ label: 'Settings', href: '/settings', blurb: 'Provider keys, Zernio, theme, team.' },
				{ label: 'Model Manager', href: '/models', blurb: 'Platform administrators only: which AI models run, and at what price.' }
			]
		},
		{
			label: 'Personas',
			blurb: 'One entry per character. Each opens that persona’s own page.',
			items: [
				{ label: 'Lexi Connor', href: '#', blurb: 'A persona: profile, content, connections, studio.' },
				{ label: 'New Persona', href: '/generator', blurb: 'Create another character from a brief.' }
			]
		}
	];

	let openGroup = $state(GROUPS[0].label);
	let hovered = $state<Item | null>(null);
	let group = $derived(GROUPS.find((g) => g.label === openGroup) ?? GROUPS[0]);
</script>

<DocsDemo title="The sidebar, group by group" hint="Click a group heading, hover an item.">
	<div class="sm">
		<nav class="sm-side" aria-label="Miniature sidebar">
			<div class="sm-logo">PersonaGen</div>
			{#each GROUPS as g (g.label)}
				<button
					type="button"
					class="sm-group"
					class:open={g.label === openGroup}
					aria-expanded={g.label === openGroup}
					onclick={() => {
						openGroup = g.label;
						hovered = null;
					}}
				>
					{g.label}
				</button>
				{#if g.label === openGroup}
					<ul class="sm-items">
						{#each g.items as it (it.label)}
							<li>
								<button
									type="button"
									class="sm-item"
									class:active={hovered === it}
									onmouseenter={() => (hovered = it)}
									onfocus={() => (hovered = it)}
									onclick={() => (hovered = it)}
								>
									{it.label}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/each}
		</nav>
		<div class="sm-explain" aria-live="polite">
			{#if hovered}
				<span class="sm-eyebrow">{group.label} → {hovered.label}</span>
				<p>{hovered.blurb}</p>
				{#if hovered.href !== '#'}
					<!-- Plain in-app paths from the map above; nothing here is a route param. -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="sm-go" href={hovered.href}>Open {hovered.label} →</a>
				{/if}
			{:else}
				<span class="sm-eyebrow">{group.label}</span>
				<p>{group.blurb}</p>
				<p class="sm-dim">
					{group.items.length === 1 ? 'One page' : `${group.items.length} pages`}: {group.items
						.map((i) => i.label)
						.join(' · ')}
				</p>
			{/if}
		</div>
	</div>
</DocsDemo>

<style>
	.sm {
		display: grid;
		grid-template-columns: 200px 1fr;
		gap: 1rem;
		min-height: 260px;
	}
	.sm-side {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2, var(--bg));
		padding: 0.6rem 0.5rem;
		display: grid;
		align-content: start;
		gap: 0.15rem;
	}
	.sm-logo {
		font-family: var(--font-display);
		font-weight: 700;
		padding: 0.2rem 0.5rem 0.6rem;
		font-size: var(--text-md);
	}
	.sm-group {
		text-align: left;
		background: none;
		border: 0;
		padding: 0.4rem 0.5rem 0.2rem;
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		cursor: pointer;
		border-radius: 6px;
	}
	.sm-group:hover,
	.sm-group.open {
		color: var(--accent-text);
	}
	.sm-items {
		list-style: none;
		margin: 0 0 0.3rem;
		padding: 0;
		display: grid;
		gap: 0.1rem;
	}
	.sm-item {
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
		font: inherit;
		font-size: var(--text-base);
		color: var(--text);
		cursor: pointer;
	}
	.sm-item:hover,
	.sm-item.active {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.sm-explain {
		padding: 0.5rem 0.25rem;
		font-size: var(--text-base);
		line-height: var(--leading-normal);
	}
	.sm-explain p {
		margin: 0.35rem 0 0;
	}
	.sm-eyebrow {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent-text);
	}
	.sm-dim {
		color: var(--text-dim);
		font-size: var(--text-sm);
	}
	.sm-go {
		display: inline-block;
		margin-top: 0.6rem;
		font-weight: 600;
		color: var(--accent-text);
	}
	/* Container, not viewport: see DocsDemo .demo-body. */
	@container (max-width: 560px) {
		.sm {
			grid-template-columns: 1fr;
		}
	}
</style>
