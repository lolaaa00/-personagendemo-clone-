<script lang="ts">
	import type { PlatformData } from '$lib/types/agent';

	interface Props {
		platforms: PlatformData[];
	}

	let { platforms }: Props = $props();
</script>

<div class="dash-chart-card">
	<h4>Platform Distribution</h4>
	<div class="platform-bars">
		{#each platforms as platform}
			<div class="plat-bar-row">
				<span class="plat-bar-label">{platform.name}</span>
				<div class="plat-bar-track">
					<div
						class="plat-bar-fill"
						style="width: {platform.pct}%; background: {platform.color}"
					></div>
				</div>
				<span class="plat-bar-val">{platform.pct}%</span>
			</div>
		{/each}
	</div>
</div>

<style>
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

	.plat-bar-fill {
		height: 14px;
		border-radius: 6px;
		transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow: 0 0 8px rgba(255, 255, 255, 0.06);
	}

	.plat-bar-val {
		font-size: 0.82rem;
		color: var(--text-dim);
		font-weight: 700;
		text-align: right;
		font-family: var(--font-mono);
	}
</style>
