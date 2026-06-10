<script lang="ts">
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
					handle: status.handle || '@connected'
				});
			}
		}

		const avgEngRate = connectedCount > 0 ? parseFloat((totalEngRate / connectedCount).toFixed(1)) : 0.0;

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
		<span class="stats-icon">📈</span>
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
				<div class="stat-progress-track">
					<div 
						class="stat-progress-bar followers-progress" 
						style="width: {Math.min(100, (stats.followersRaw / 250000) * 100)}%"
					></div>
				</div>
			</div>

			<div class="stat-box">
				<span class="stat-label">Average Engagement Rate</span>
				<div class="stat-val-wrap">
					<span class="stat-value">{stats.engagementRate.toFixed(1)}%</span>
					<span class="computed-badge">Computed</span>
				</div>
				<div class="stat-progress-track">
					<div 
						class="stat-progress-bar engagement-progress" 
						style="width: {Math.min(100, (stats.engagementRate / 10) * 100)}%"
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
							<span class="plat-bullet" style="background-color: {platform.color};"></span>
							<span class="plat-name">{platform.name}</span>
							<span class="plat-handle">{platform.handle}</span>
						</div>
						<div class="plat-metrics">
							<div class="plat-metric">
								<span class="plat-metric-label">Followers:</span>
								<span class="plat-metric-val">
									{platform.followers >= 1000 ? (platform.followers / 1000).toFixed(1) + 'K' : platform.followers}
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
			⚡ These parameters dynamically aggregate platform-level metadata inside <strong>Agent Settings</strong>. Manual entry is restricted to maintain data authenticity.
		</p>
	{:else}
		<div class="empty-stats-state">
			<div class="empty-icon">🔗</div>
			<h5>No Channels Connected Yet</h5>
			<p>
				Link one or more social media channels above. Once connected, audience reach and engagement rates will instantly calculate and sync.
			</p>
		</div>
	{/if}
</div>

<style>
	.stats-card-container {
		margin-top: 2rem;
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(124, 106, 237, 0.15);
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
		border-color: rgba(124, 106, 237, 0.3);
		box-shadow: 0 12px 40px rgba(124, 106, 237, 0.05);
	}

	.stats-glow-spot {
		position: absolute;
		top: -20%;
		right: -10%;
		width: 180px;
		height: 180px;
		background: radial-gradient(circle, rgba(124, 106, 237, 0.12) 0%, transparent 70%);
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
		font-size: 1.25rem;
		line-height: 1;
		background: rgba(124, 106, 237, 0.1);
		padding: 0.5rem;
		border-radius: 8px;
		border: 1px solid rgba(124, 106, 237, 0.2);
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
	}

	.live-badge {
		font-size: 10px;
		font-weight: 600;
		color: var(--success);
		background: rgba(16, 185, 129, 0.1);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid rgba(16, 185, 129, 0.15);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.computed-badge {
		font-size: 10px;
		font-weight: 600;
		color: var(--accent-light);
		background: rgba(124, 106, 237, 0.1);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid rgba(124, 106, 237, 0.15);
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

	.stat-progress-bar {
		height: 100%;
		border-radius: 2px;
		transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
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
	}

	.plat-divider {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.1);
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
		font-size: 1.75rem;
		margin-bottom: 0.25rem;
		animation: pulse-icon 2s infinite ease-in-out;
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
		0%, 100% {
			transform: scale(1);
			opacity: 0.8;
		}
		50% {
			transform: scale(1.08);
			opacity: 1;
		}
	}
</style>
