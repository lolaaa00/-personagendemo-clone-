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

<div class="gp gp-{variant}" class:failed={!!job.error} aria-live="polite">
	{#if job.error}
		<div class="gp-head">
			<span class="gp-icon err" aria-hidden="true">!</span>
			<span class="gp-label">{job.label} failed</span>
		</div>
		<p class="gp-err" title={job.error} role="alert">{job.error}</p>
		<div class="gp-actions">
			{#if onRetry}<button class="gp-btn" onclick={onRetry}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
					Retry
				</button>{/if}
			{#if onDismiss}<button class="gp-btn ghost" onclick={onDismiss}>Dismiss</button>{/if}
		</div>
	{:else}
		<div class="gp-head">
			<span class="gp-spinner" aria-hidden="true"></span>
			<span class="gp-label">{job.label}</span>
			<span class="gp-time">{elapsed}s</span>
		</div>
		<div
			class="gp-bar"
			role="progressbar"
			aria-valuenow={pct}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuetext="{pct}% — {elapsed} seconds elapsed"
			aria-label="{job.label} progress"
		>
			<div class="gp-fill" style="transform:scaleX({pct / 100})"></div>
		</div>
		<p class="gp-note">Generating — this keeps running if you navigate away.</p>
	{/if}
</div>

<style>
	.gp {
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
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
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(2px);
	}
	.gp.failed {
		border-color: color-mix(in srgb, var(--error) 40%, transparent);
		background: var(--error-soft);
	}
	.gp-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.gp-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.gp-time {
		font-size: 0.72rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.gp-spinner {
		width: 14px;
		height: 14px;
		flex: none;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
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
		background: var(--error);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 800;
		display: grid;
		place-items: center;
	}
	.gp-bar {
		height: 6px;
		border-radius: 999px;
		background: var(--surface-2);
		overflow: hidden;
	}
	/* Full-width fill driven by scaleX — animating `width` would relayout the bar
	   on every one of the 400ms ticks; a transform stays on the compositor. */
	.gp-fill {
		width: 100%;
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent), var(--cyan));
		transform-origin: left center;
		transition: transform 0.25s ease-out;
	}
	.gp-note {
		margin: 0;
		font-size: 0.7rem;
		color: var(--muted);
	}
	.gp-err {
		margin: 0;
		font-size: 0.74rem;
		color: var(--error-text);
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 44px;
		min-width: 44px;
		font-size: 0.74rem;
		font-weight: 600;
		padding: 0.28rem 0.6rem;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid var(--accent);
		background: var(--accent);
		color: #fff;
	}
	.gp-btn.ghost {
		background: transparent;
		color: var(--muted);
		border-color: var(--border);
	}
</style>
