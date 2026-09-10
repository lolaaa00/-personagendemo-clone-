<script lang="ts">
	import DocsDemo from './DocsDemo.svelte';

	/**
	 * A post's life as a clickable stepper. Same labels the feed shows; the
	 * explanation for each is the rule the status-glossary guide states in
	 * prose — here you can see where each one sits on the line.
	 */
	interface Stage {
		id: string;
		label: string;
		who: 'system' | 'you' | 'platform';
		text: string;
		branch?: boolean;
	}
	const STAGES: Stage[] = [
		{ id: 'generating', label: 'Generating', who: 'system', text: 'Being created right now. Do nothing — it appears when ready.' },
		{ id: 'draft', label: 'Draft', who: 'you', text: 'Waiting for you in the Review Queue. Nothing goes out until you approve, edit or reject it.' },
		{ id: 'scheduled', label: 'Scheduled', who: 'system', text: 'Approved with a time slot. Publishes itself; move or cancel it from the Calendar until then.' },
		{ id: 'publishing', label: 'Publishing…', who: 'platform', text: 'Sent; waiting for the platform to confirm. Flips within minutes.' },
		{ id: 'published', label: 'Published', who: 'platform', text: 'Confirmed live on every account it was aimed at. "View live post" opens the real thing.' }
	];
	const OFFRAMPS: Stage[] = [
		{ id: 'rejected', label: 'Rejected', who: 'you', text: 'You said no in review. A new draft replaces it.', branch: true },
		{ id: 'partial', label: 'Partial', who: 'platform', text: 'Live on some platforms, failed on others — open the post to see which one missed and why.', branch: true },
		{ id: 'failed', label: 'Failed', who: 'platform', text: 'Did not go out. The exact reason is written on the post; fix that and retry.', branch: true }
	];
	const WHO = { system: 'Automatic', you: 'Needs you', platform: 'The platform' } as const;

	let current = $state<Stage>(STAGES[1]);
	let idx = $derived(STAGES.findIndex((s) => s.id === current.id));
</script>

<DocsDemo title="A post’s life, label by label" hint="Click any label.">
	<div class="pl">
		<ol class="pl-line" aria-label="Main path">
			{#each STAGES as s, i (s.id)}
				<li class="pl-node" class:done={idx > i} class:now={current.id === s.id}>
					<button type="button" class="pl-btn" onclick={() => (current = s)} aria-pressed={current.id === s.id}>
						<span class="pl-dot" aria-hidden="true"></span>
						<span class="pl-label">{s.label}</span>
					</button>
				</li>
			{/each}
		</ol>
		<div class="pl-offramps" aria-label="Off-ramps">
			<span class="pl-offramps-title">Can also end up as:</span>
			{#each OFFRAMPS as s (s.id)}
				<button
					type="button"
					class="pl-chip"
					class:now={current.id === s.id}
					data-id={s.id}
					onclick={() => (current = s)}
					aria-pressed={current.id === s.id}>{s.label}</button
				>
			{/each}
		</div>
		<div class="pl-explain" aria-live="polite" data-who={current.who}>
			<span class="pl-who">{WHO[current.who]}</span>
			<b>{current.label}</b> — {current.text}
		</div>
	</div>
</DocsDemo>

<style>
	.pl {
		display: grid;
		gap: 0.8rem;
	}
	.pl-line {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		position: relative;
	}
	.pl-line::before {
		content: '';
		position: absolute;
		left: 10%;
		right: 10%;
		top: 9px;
		height: 2px;
		background: var(--border-strong);
	}
	.pl-node {
		position: relative;
		text-align: center;
	}
	.pl-btn {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		cursor: pointer;
		display: grid;
		justify-items: center;
		gap: 0.35rem;
		width: 100%;
		color: var(--text-dim);
	}
	.pl-dot {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid var(--border-strong);
		background: var(--surface);
		transition:
			background 0.15s,
			border-color 0.15s,
			transform 0.15s;
	}
	.pl-node.done .pl-dot {
		background: var(--accent);
		border-color: var(--accent);
	}
	.pl-node.now .pl-dot {
		border-color: var(--accent);
		box-shadow: 0 0 0 4px var(--accent-soft);
		transform: scale(1.15);
	}
	.pl-node.now .pl-btn {
		color: var(--text);
	}
	.pl-label {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.pl-offramps {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.pl-offramps-title {
		font-size: var(--text-xs);
		color: var(--text-dim);
		margin-right: 0.2rem;
	}
	.pl-chip {
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 700;
		cursor: pointer;
		color: var(--text-muted);
	}
	.pl-chip[data-id='failed'].now {
		background: var(--error-soft);
		border-color: var(--error);
		color: var(--error-text);
	}
	.pl-chip[data-id='partial'].now {
		background: var(--warning-soft);
		border-color: var(--warning);
		color: var(--warning-text);
	}
	.pl-chip[data-id='rejected'].now {
		background: var(--surface-2, var(--bg));
		border-color: var(--text-dim);
		color: var(--text);
	}
	.pl-explain {
		padding: 0.7rem 0.8rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2, var(--bg));
		border-left: 3px solid var(--border-strong);
		font-size: var(--text-base);
		line-height: var(--leading-normal);
	}
	.pl-explain[data-who='you'] {
		border-left-color: var(--warning);
	}
	.pl-explain[data-who='system'] {
		border-left-color: var(--accent);
	}
	.pl-explain[data-who='platform'] {
		border-left-color: var(--cyan);
	}
	.pl-who {
		display: block;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		margin-bottom: 0.2rem;
	}
	@media (max-width: 640px) {
		.pl-line {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.pl-label {
			font-size: var(--text-xs);
		}
	}
</style>
