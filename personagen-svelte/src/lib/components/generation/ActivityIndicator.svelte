<script lang="ts">
	/**
	 * Global "something is generating" indicator, mounted once in the layout.
	 *
	 * Generations are detached server-side jobs — they keep running after you leave
	 * the page that started them. Without a global surface, navigating away made an
	 * in-flight (and already paid-for) generation invisible. This keeps every
	 * running job visible from anywhere, and keeps failures on screen until the
	 * user actually acknowledges them, instead of flashing past in a 4s toast.
	 */
	import { generations, progressOf, finishGeneration } from '$lib/stores/generations.svelte';

	let open = $state(false);
	let now = $state(Date.now());

	let active = $derived(generations.filter((g) => !g.done));
	let failed = $derived(generations.filter((g) => g.done && g.error));
	let visible = $derived(active.length > 0 || failed.length > 0);

	$effect(() => {
		if (!visible) return;
		const t = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(t);
	});
</script>

{#if visible}
	<div class="ai-wrap">
		{#if open}
			<div class="ai-panel">
				<header>
					<strong>Generation activity</strong>
					<button onclick={() => (open = false)} aria-label="Collapse">✕</button>
				</header>

				{#each active as job (job.id)}
					<div class="ai-row">
						<span class="ai-spin"></span>
						<div class="ai-main">
							<span class="ai-label">{job.label}</span>
							<div class="ai-bar">
								<div class="ai-fill" style="width:{Math.round(progressOf(job, now) * 100)}%"></div>
							</div>
						</div>
						<span class="ai-time">{Math.round((now - job.startedAt) / 1000)}s</span>
					</div>
				{/each}

				{#each failed as job (job.id)}
					<div class="ai-row err">
						<span class="ai-x">!</span>
						<div class="ai-main">
							<span class="ai-label">{job.label} failed</span>
							<span class="ai-err">{job.error}</span>
						</div>
						<button class="ai-dismiss" onclick={() => finishGeneration(job.id)}>Dismiss</button>
					</div>
				{/each}
			</div>
		{/if}

		<button class="ai-pill" class:has-err={failed.length > 0} onclick={() => (open = !open)}>
			{#if active.length}
				<span class="ai-spin"></span>
				{active.length} generating
			{:else}
				<span class="ai-x">!</span>
				{failed.length} failed
			{/if}
		</button>
	</div>
{/if}

<style>
	.ai-wrap {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 900;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
	}
	.ai-pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e8f0);
		box-shadow: 0 8px 26px rgba(15, 18, 32, 0.16);
		border-radius: 999px;
		padding: 0.5rem 0.9rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		color: var(--text, #14172b);
	}
	.ai-pill.has-err {
		border-color: #fecaca;
		color: #991b1b;
	}
	.ai-panel {
		width: min(360px, calc(100vw - 2rem));
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 14px;
		box-shadow: 0 16px 44px rgba(15, 18, 32, 0.2);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: 60vh;
		overflow-y: auto;
	}
	.ai-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.85rem;
	}
	.ai-panel header button {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--muted, #6b7280);
	}
	.ai-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.ai-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.ai-label {
		font-size: 0.78rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ai-err {
		font-size: 0.7rem;
		color: #991b1b;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.ai-bar {
		height: 5px;
		background: var(--surface-2, #eef0f6);
		border-radius: 999px;
		overflow: hidden;
	}
	.ai-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent, #7c6aed), var(--cyan, #22d3ee));
		transition: width 0.5s ease-out;
	}
	.ai-time {
		font-size: 0.7rem;
		color: var(--muted, #6b7280);
		font-variant-numeric: tabular-nums;
	}
	.ai-spin {
		width: 13px;
		height: 13px;
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
	.ai-x {
		width: 15px;
		height: 15px;
		flex: none;
		border-radius: 50%;
		background: #dc2626;
		color: #fff;
		font-size: 0.68rem;
		font-weight: 800;
		display: grid;
		place-items: center;
	}
	.ai-dismiss {
		font-size: 0.7rem;
		background: none;
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 8px;
		padding: 0.2rem 0.45rem;
		cursor: pointer;
		color: var(--muted, #6b7280);
	}
</style>
