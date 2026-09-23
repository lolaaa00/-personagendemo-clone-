<script lang="ts">
	import { platformProfileUrl } from '$lib/platforms';

	interface PlatformStatus {
		connected: boolean;
		handle?: string;
		verified?: boolean;
		lastSync?: string;
		followers?: number;
		engagement_rate?: number;
	}

	interface Props {
		platformStatuses: Record<string, PlatformStatus>;
		platformMetrics: Record<string, { followers: number; engagement: number }>;
		platforms: readonly { key: string; name: string; color: string }[];
	}

	let { platformStatuses, platformMetrics, platforms }: Props = $props();

	// Compute followers & engagement rate dynamically from active connections
	const stats = $derived.by(() => {
		let totalFollowers = 0;
		let totalEngRate = 0;
		let connectedCount = 0;
		const activePlatformsList: Array<{
			key: string;
			name: string;
			color: string;
			followers: number;
			engagement: number;
			handle: string;
			url: string | null;
		}> = [];

		for (const p of platforms) {
			const status = platformStatuses[p.key];
			if (status?.connected) {
				const fallback = platformMetrics[p.key];
				const followers = status.followers ?? fallback?.followers ?? 0;
				const engagement = status.engagement_rate ?? fallback?.engagement ?? 0;

				totalFollowers += followers;
				totalEngRate += engagement;
				connectedCount++;
				activePlatformsList.push({
					key: p.key,
					name: p.name,
					color: p.color,
					followers,
					engagement,
					handle: status.handle || '@connected',
					url: platformProfileUrl(p.key, status.handle)
				});
			}
		}

		const avgEngRate =
			connectedCount > 0 ? parseFloat((totalEngRate / connectedCount).toFixed(1)) : 0.0;

		let followersStr = '0';
		if (totalFollowers >= 1000000) {
			followersStr = (totalFollowers / 1000000).toFixed(1) + 'M';
		} else if (totalFollowers >= 1000) {
			followersStr = (totalFollowers / 1000).toFixed(1) + 'K';
		} else {
			followersStr = String(totalFollowers);
		}

		return {
			followers: followersStr,
			followersRaw: totalFollowers,
			engagementRate: avgEngRate,
			connectedCount,
			activePlatforms: activePlatformsList
		};
	});
</script>

<div class="stats-card-container">
	<div class="stats-glow-spot"></div>

	<div class="stats-header">
		<span class="stats-icon">
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
				<polyline points="17 6 23 6 23 12" />
			</svg>
		</span>
		<div class="stats-header-text">
			<h4>Aggregated Reach & Audience Stats</h4>
			<p>Live synchronized performance metrics across all connected accounts.</p>
		</div>
	</div>

	{#if stats.connectedCount > 0}
		<!-- Aggregated Grid -->
		<div class="stats-grid">
			<div class="stat-box">
				<span class="stat-label">Total Followers / Subscribers</span>
				<div class="stat-val-wrap">
					<span class="stat-value">{stats.followers}</span>
					<span class="live-badge">Live Sync</span>
				</div>
				<div class="stat-progress-track" aria-hidden="true">
					<div
						class="stat-progress-bar followers-progress"
						style="--bar-pct: {Math.min(1, stats.followersRaw / 250000)}"
					></div>
				</div>
			</div>

			<div class="stat-box">
				<span class="stat-label">Average Engagement Rate</span>
				<div class="stat-val-wrap">
					<span class="stat-value">{stats.engagementRate.toFixed(1)}%</span>
					<span class="computed-badge">Computed</span>
				</div>
				<div class="stat-progress-track" aria-hidden="true">
					<div
						class="stat-progress-bar engagement-progress"
						style="--bar-pct: {Math.min(1, stats.engagementRate / 10)}"
					></div>
				</div>
			</div>
		</div>

		<!-- Individual Platform Breakdowns in the Stats Component -->
		<div class="breakdown-section">
			<h5>Individual Channel Breakdowns</h5>
			<div class="breakdown-list">
				{#each stats.activePlatforms as platform}
					<div class="breakdown-item" style="--plat-color: {platform.color}">
						<div class="plat-info">
							<span
								class="plat-bullet"
								style="background-color: {platform.color};"
								aria-hidden="true"
							></span>
							<span class="plat-name">{platform.name}</span>
							{#if platform.url}
								<a
									class="plat-handle plat-handle-link"
									href={platform.url}
									target="_blank"
									rel="noopener noreferrer"
									title="Open {platform.name} profile ↗"
								>{platform.handle}</a>
							{:else}
								<span class="plat-handle">{platform.handle}</span>
							{/if}
						</div>
						<div class="plat-metrics">
							<div class="plat-metric">
								<span class="plat-metric-label">Followers:</span>
								<span class="plat-metric-val">
									{platform.followers >= 1000
										? (platform.followers / 1000).toFixed(1) + 'K'
										: platform.followers}
								</span>
							</div>
							<div class="plat-divider">|</div>
							<div class="plat-metric">
								<span class="plat-metric-label">Engagement:</span>
								<span class="plat-metric-val">{platform.engagement}%</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<p class="stats-footer-note">
			⚡ These parameters dynamically aggregate platform-level metadata inside <strong
				>Persona settings</strong
			>. Manual entry is restricted to maintain data authenticity.
		</p>
	{:else}
		<div class="empty-stats-state">
			<div class="empty-icon">
				<svg
					width="28"
					height="28"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
					<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
				</svg>
			</div>
			<h5>No Channels Connected Yet</h5>
			<p>
				Once a social media channel is connected, audience reach and engagement
				rates will instantly calculate and sync.
			</p>
		</div>
	{/if}
</div>

<style>
	.stats-card-container {
		margin-top: 2rem;
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		position: relative;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.stats-card-container:hover {
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		box-shadow: 0 12px 40px color-mix(in srgb, var(--accent) 5%, transparent);
	}

	.stats-glow-spot {
		position: absolute;
		top: -20%;
		right: -10%;
		width: 180px;
		height: 180px;
		background: radial-gradient(
			circle,
			color-mix(in srgb, var(--accent) 12%, transparent) 0%,
			transparent 70%
		);
		border-radius: 50%;
		pointer-events: none;
	}

	.stats-header {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.stats-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		padding: 0.5rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
		flex-shrink: 0;
	}

	.stats-header-text h4 {
		margin: 0 0 0.25rem 0;
		font-size: var(--text-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text);
	}

	.stats-header-text p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.stat-box {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 12px;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: border-color 0.2s ease;
	}

	.stat-box:hover {
		border-color: rgba(255, 255, 255, 0.08);
	}

	.stat-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 500;
	}

	.stat-val-wrap {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 800;
		color: var(--text);
		font-family: var(--font-mono);
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}

	.live-badge {
		font-size: 10px;
		font-weight: 600;
		/* 10px label — needs the AA `-text` variant, the fill hue is only 3.8:1 on white. */
		color: var(--success-text);
		background: color-mix(in srgb, var(--success) 10%, transparent);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--success) 15%, transparent);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.computed-badge {
		font-size: 10px;
		font-weight: 600;
		/* Was --accent-light, which resolves to a 45%-white tint — near-invisible as 10px
		   text on the light card. --accent-text is the AA-checked variant for both themes. */
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.stat-progress-track {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 2px;
		overflow: hidden;
		margin-top: 0.25rem;
	}

	/* scaleX instead of width so the meter animates on the compositor. The bar holds no
	   text — the figure lives in `.stat-value` above it — so nothing gets squashed. */
	.stat-progress-bar {
		width: 100%;
		height: 100%;
		border-radius: 2px;
		transform-origin: left center;
		transform: scaleX(var(--bar-pct, 0));
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		.stat-progress-bar {
			transition: none;
		}
	}

	.followers-progress {
		background: linear-gradient(90deg, var(--accent-mid), var(--cyan));
	}

	.engagement-progress {
		background: linear-gradient(90deg, var(--accent-mid), var(--rose));
	}

	.breakdown-section {
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		padding-top: 1.25rem;
		margin-bottom: 1.25rem;
	}

	.breakdown-section h5 {
		margin: 0 0 0.75rem 0;
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
	}

	.breakdown-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.breakdown-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(255, 255, 255, 0.03);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		transition: all 0.2s ease;
	}

	.breakdown-item:hover {
		background: rgba(255, 255, 255, 0.02);
		border-color: rgba(255, 255, 255, 0.06);
		transform: translateX(2px);
	}

	.plat-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.plat-bullet {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		box-shadow: 0 0 8px var(--plat-color);
	}

	.plat-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text);
	}

	.plat-handle {
		font-size: 11px;
		color: var(--text-dim);
		font-family: var(--font-mono);
	}

	/* Handle links: same muted look until hovered, then adopt the platform's
	   brand color with an underline so it's obviously clickable. */
	.plat-handle-link {
		position: relative;
		text-decoration: none;
		border-radius: 4px;
		transition: color 0.15s ease;
		cursor: pointer;
	}

	/* The handle text is ~14px tall; grow the tap target to 44px without moving the
	   layout. It is the only interactive element in the row, so nothing is occluded. */
	.plat-handle-link::after {
		content: '';
		position: absolute;
		left: -4px;
		right: -4px;
		top: 50%;
		height: 44px;
		transform: translateY(-50%);
	}

	.plat-handle-link:hover {
		color: var(--plat-color, var(--accent));
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.plat-handle-link:focus-visible {
		outline: 2px solid var(--accent-mid);
		outline-offset: 2px;
	}

	.plat-metrics {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.plat-metric {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.plat-metric-label {
		font-size: 11px;
		color: var(--text-dim);
	}

	.plat-metric-val {
		font-size: 11px;
		font-weight: 700;
		color: var(--text);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}

	.plat-divider {
		font-size: 11px;
		color: var(--border-strong);
	}

	.stats-footer-note {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-style: italic;
		margin: 0;
	}

	.empty-stats-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 1.5rem 0;
		gap: 0.5rem;
	}

	.empty-icon {
		display: inline-flex;
		color: var(--accent-text);
		margin-bottom: 0.25rem;
		animation: pulse-icon 2s infinite ease-in-out;
	}

	@media (prefers-reduced-motion: reduce) {
		.empty-icon {
			animation: none;
		}
	}

	.empty-stats-state h5 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text);
	}

	.empty-stats-state p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-dim);
		max-width: 420px;
		line-height: 1.5;
	}

	@keyframes pulse-icon {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.8;
		}
		50% {
			transform: scale(1.08);
			opacity: 1;
		}
	}
</style>
