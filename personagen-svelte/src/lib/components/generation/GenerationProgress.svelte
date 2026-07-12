<script lang="ts">
	/**
	 * The in-progress card shown wherever a generation is running — a feed slot, a
	 * persona tile, or the activity list. It ticks its own clock so the bar keeps
	 * creeping without the parent having to re-render.
	 *
	 * The bar is deliberately asymptotic (see progressOf): fal reports no real
	 * progress, so rather than fake a number that hits 100% and then sits there —
	 * which reads as "frozen" — it decelerates toward 95% and only completes when
	 * the job actually completes.
	 */
	import { progressOf, type GenerationJob } from '$lib/stores/generations.svelte';

	interface Props {
		job: GenerationJob;
		/** 'card' fills a feed slot; 'tile' overlays a small thumbnail. */
		variant?: 'card' | 'tile';
		onRetry?: (() => void) | null;
		onDismiss?: (() => void) | null;
	}

	let { job, variant = 'card', onRetry = null, onDismiss = null }: Props = $props();

	let now = $state(Date.now());
	$effect(() => {
		if (job.error) return; // failed: freeze the clock
		const t = setInterval(() => (now = Date.now()), 400);
		return () => clearInterval(t);
	});

	let pct = $derived(job.error ? 100 : Math.round(progressOf(job, now) * 100));
	let elapsed = $derived(Math.max(0, Math.round((now - job.startedAt) / 1000)));
</script>

<div class="gp gp-{variant}" class:failed={!!job.error}>
	{#if job.error}
		<div class="gp-head">
			<span class="gp-icon err">!</span>
			<span class="gp-label">{job.label} failed</span>
		</div>
		<p class="gp-err" title={job.error}>{job.error}</p>
		<div class="gp-actions">
			{#if onRetry}<button class="gp-btn" onclick={onRetry}>↺ Retry</button>{/if}
			{#if onDismiss}<button class="gp-btn ghost" onclick={onDismiss}>Dismiss</button>{/if}
		</div>
	{:else}
		<div class="gp-head">
			<span class="gp-spinner"></span>
			<span class="gp-label">{job.label}</span>
			<span class="gp-time">{elapsed}s</span>
		</div>
		<div class="gp-bar"><div class="gp-fill" style="width:{pct}%"></div></div>
		<p class="gp-note">Generating — this keeps running if you navigate away.</p>
	{/if}
</div>

<style>
	.gp {
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 12px;
		background: var(--surface, #fff);
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.gp-card {
		aspect-ratio: 4 / 5;
		justify-content: center;
	}
	.gp-tile {
		position: absolute;
		inset: 0;
		justify-content: center;
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(2px);
	}
	.gp.failed {
		border-color: #fecaca;
		background: #fef2f2;
	}
	.gp-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.gp-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text, #14172b);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.gp-time {
		font-size: 0.72rem;
		color: var(--muted, #6b7280);
		font-variant-numeric: tabular-nums;
	}
	.gp-spinner {
		width: 14px;
		height: 14px;
		flex: none;
		border: 2px solid var(--border, #e6e8f0);
		border-top-color: var(--accent, #7c6aed);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.gp-icon.err {
		width: 16px;
		height: 16px;
		flex: none;
		border-radius: 50%;
		background: #dc2626;
		color: #fff;
		font-size: 0.7rem;
		font-weight: 800;
		display: grid;
		place-items: center;
	}
	.gp-bar {
		height: 6px;
		border-radius: 999px;
		background: var(--surface-2, #eef0f6);
		overflow: hidden;
	}
	.gp-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent, #7c6aed), var(--cyan, #22d3ee));
		transition: width 0.4s ease-out;
	}
	.gp-note {
		margin: 0;
		font-size: 0.7rem;
		color: var(--muted, #6b7280);
	}
	.gp-err {
		margin: 0;
		font-size: 0.74rem;
		color: #991b1b;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.gp-actions {
		display: flex;
		gap: 0.4rem;
	}
	.gp-btn {
		font-size: 0.74rem;
		font-weight: 600;
		padding: 0.28rem 0.6rem;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid var(--accent, #7c6aed);
		background: var(--accent, #7c6aed);
		color: #fff;
	}
	.gp-btn.ghost {
		background: transparent;
		color: var(--muted, #6b7280);
		border-color: var(--border, #e6e8f0);
	}
</style>
