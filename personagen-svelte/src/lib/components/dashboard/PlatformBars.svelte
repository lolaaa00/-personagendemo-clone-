<script lang="ts">
	import type { PlatformData } from '$lib/types/agent';

	interface Props {
		platforms: PlatformData[];
	}

	let { platforms }: Props = $props();
</script>

<div class="dash-chart-card">
	<h2>Platform Distribution</h2>
	{#if platforms.length === 0}
		<div class="plat-empty">
			<p>No platform data yet</p>
			<span>
				Connect at least one social account to a persona — the share of posts per platform
				appears here once posts start publishing.
			</span>
		</div>
	{:else}
		<div class="platform-bars">
			{#each platforms as platform}
				<!-- The bar is a redundant visual of the adjacent name + percentage text, so it is
				     hidden from assistive tech rather than announced twice. Platform identity never
				     rests on colour alone: the name is always spelled out beside it. -->
				<div class="plat-bar-row">
					<span class="plat-bar-label">{platform.name}</span>
					<div class="plat-bar-track" aria-hidden="true">
						<div
							class="plat-bar-fill"
							style="--plat-pct: {Math.max(0, Math.min(100, platform.pct)) /
								100}; background: {platform.color}"
						></div>
					</div>
					<span class="plat-bar-val">{platform.pct}%</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.dash-chart-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.75rem 1.75rem 1.5rem;
		overflow: hidden;
	}

	.dash-chart-card h2 {
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

	.dash-chart-card h2::before {
		content: '';
		display: inline-block;
		width: 3px;
		height: 14px;
		border-radius: 2px;
		background: var(--gradient-subtle);
		flex-shrink: 0;
	}

	.platform-bars {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.plat-bar-row {
		display: grid;
		grid-template-columns: 80px 1fr 40px;
		align-items: center;
		gap: 0.75rem;
	}

	.plat-bar-label {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.plat-bar-track {
		width: 100%;
		background: var(--surface-2);
		border-radius: 6px;
		height: 14px;
		position: relative;
		overflow: hidden;
	}

	/* Animating `width` relayouts the row every frame; scaleX is composited instead.
	   The fill has no children and the value label is a grid sibling, so nothing is
	   squashed by the scale. */
	.plat-bar-fill {
		width: 100%;
		height: 14px;
		border-radius: 6px;
		transform-origin: left center;
		transform: scaleX(var(--plat-pct, 0));
		transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow: 0 0 8px rgba(255, 255, 255, 0.06);
	}

	@media (prefers-reduced-motion: reduce) {
		.plat-bar-fill {
			transition: none;
		}
	}

	.plat-bar-val {
		font-size: 0.82rem;
		color: var(--text-dim);
		font-weight: 700;
		text-align: right;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}

	.plat-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 1.75rem 1rem;
		gap: 0.4rem;
		color: var(--text-dim);
	}

	.plat-empty p {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-muted);
		margin: 0;
	}

	.plat-empty span {
		font-size: 0.75rem;
		color: var(--text-dim);
		line-height: 1.5;
		max-width: 340px;
	}
</style>
