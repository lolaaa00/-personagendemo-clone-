<script lang="ts">
	import type { Snippet } from 'svelte';
	/**
	 * Frame for a LIVE docs demo — a miniature of the real UI the reader can
	 * click, in place of a screenshot. The badge is the point: a screenshot
	 * goes stale the week after it is taken, a demo built from the same
	 * catalog the app runs on cannot.
	 */
	let {
		title,
		hint = 'Live example — click around, nothing you do here is saved.',
		children
	}: { title: string; hint?: string; children: Snippet } = $props();
</script>

<figure class="demo">
	<figcaption class="demo-head">
		<span class="demo-live" aria-hidden="true"></span>
		<span class="demo-title">{title}</span>
		<span class="demo-hint">{hint}</span>
	</figcaption>
	<div class="demo-body">
		{@render children()}
	</div>
</figure>

<style>
	.demo {
		margin: 0.85rem 0 0.4rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md, 12px);
		background: var(--surface);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}
	.demo-head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem 0.85rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2, var(--bg));
		font-size: var(--text-sm);
	}
	.demo-live {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success);
		box-shadow: 0 0 0 3px var(--success-soft);
		flex: none;
	}
	.demo-title {
		font-weight: 700;
		color: var(--text);
	}
	.demo-hint {
		margin-left: auto;
		color: var(--text-dim);
		font-size: var(--text-xs);
		text-align: right;
	}
	.demo-body {
		padding: 0.9rem;
		/* The demos query THIS width, not the viewport: the docs article column is
		   ~360px on a 1366px laptop while the viewport is far above any phone
		   breakpoint (round-9 re-audit: labels spilled 23–89px past the figure). */
		container-type: inline-size;
	}
	@media (max-width: 640px) {
		.demo-hint {
			display: none;
		}
	}
</style>
