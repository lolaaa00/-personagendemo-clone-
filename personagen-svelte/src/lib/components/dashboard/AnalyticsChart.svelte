<script lang="ts">
	interface Point {
		date: string;
		views: number;
		likes: number;
	}

	interface Props {
		series: Point[];
	}

	let { series }: Props = $props();

	const W = 720;
	const H = 240;
	const PAD_L = 52;
	const PAD_R = 20;
	const PAD_T = 16;
	const PAD_B = 30;

	// Palette validated against the dark portal surface (#0e0e16):
	// indigo + emerald-600 pass lightness, chroma, CVD-separation, and contrast checks.
	const VIEWS_COLOR = '#6366f1';
	const LIKES_COLOR = '#059669';

	const chartW = W - PAD_L - PAD_R;
	const chartH = H - PAD_T - PAD_B;

	let hoverIdx = $state<number | null>(null);

	let times = $derived(series.map((p) => new Date(p.date + 'T00:00:00Z').getTime()));
	let t0 = $derived(times.length ? Math.min(...times) : 0);
	let t1 = $derived(times.length ? Math.max(...times) : 1);

	let maxVal = $derived.by(() => {
		const m = Math.max(1, ...series.map((p) => Math.max(p.views, p.likes)));
		return m * 1.1;
	});

	function scaleX(i: number): number {
		if (t1 === t0) return PAD_L + chartW / 2;
		return PAD_L + ((times[i] - t0) / (t1 - t0)) * chartW;
	}

	function scaleY(v: number): number {
		return H - PAD_B - (v / maxVal) * chartH;
	}

	function formatNum(v: number): string {
		if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
		return String(Math.round(v));
	}

	function formatDate(dateStr: string): string {
		const d = new Date(dateStr + 'T00:00:00Z');
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
	}

	let gridSteps = $derived.by(() => {
		const steps = 4;
		return Array.from({ length: steps + 1 }, (_, i) => {
			const v = (i / steps) * maxVal;
			return { y: scaleY(v), label: formatNum(v) };
		});
	});

	let seriesData = $derived.by(() => {
		const build = (key: 'views' | 'likes', color: string, name: string) => {
			const points = series.map((p, i) => ({ x: scaleX(i), y: scaleY(p[key]), v: p[key] }));
			const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
			const areaPath = [
				...points.map((p) => `${p.x},${p.y}`),
				`${points[points.length - 1]?.x ?? PAD_L},${H - PAD_B}`,
				`${points[0]?.x ?? PAD_L},${H - PAD_B}`
			].join(' ');
			return { points, linePoints, areaPath, color, name };
		};
		return [build('views', VIEWS_COLOR, 'Views'), build('likes', LIKES_COLOR, 'Likes')];
	});

	// X-axis labels: first, middle, and last dates (deduplicated for short series)
	let xLabels = $derived.by(() => {
		if (series.length === 0) return [];
		const idxs = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
		return idxs.map((i) => ({ x: scaleX(i), label: formatDate(series[i].date) }));
	});

	function handleMove(e: MouseEvent) {
		if (series.length === 0) return;
		const svg = e.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const px = ((e.clientX - rect.left) / rect.width) * W;
		let best = 0;
		let bestDist = Infinity;
		for (let i = 0; i < series.length; i++) {
			const d = Math.abs(scaleX(i) - px);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		hoverIdx = best;
	}

	function handleLeave() {
		hoverIdx = null;
	}

	let tooltip = $derived.by(() => {
		if (hoverIdx === null || !series[hoverIdx]) return null;
		const p = series[hoverIdx];
		const x = scaleX(hoverIdx);
		return {
			x,
			p,
			// Flip the tooltip to the left side when near the right edge
			flip: x > W - 150,
			leftPct: (x / W) * 100
		};
	});
</script>

<div class="analytics-chart">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<svg
		viewBox="0 0 {W} {H}"
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Views and likes over time"
		onmousemove={handleMove}
		onmouseleave={handleLeave}
	>
		<defs>
			<linearGradient id="analyticsAreaViews" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={VIEWS_COLOR} stop-opacity="0.16" />
				<stop offset="100%" stop-color={VIEWS_COLOR} stop-opacity="0" />
			</linearGradient>
		</defs>

		<!-- Grid lines & Y-axis labels -->
		{#each gridSteps as step, i}
			<line
				x1={PAD_L}
				y1={step.y}
				x2={W - PAD_R}
				y2={step.y}
				stroke="rgba(255,255,255,0.06)"
				stroke-width="1"
				stroke-dasharray={i === 0 ? 'none' : '3,4'}
			/>
			<text
				x={PAD_L - 8}
				y={step.y + 4}
				fill="rgba(255,255,255,0.35)"
				font-size="10"
				font-weight="500"
				text-anchor="end"
				font-family="var(--font-mono, monospace)"
			>
				{step.label}
			</text>
		{/each}

		<!-- Crosshair -->
		{#if tooltip}
			<line
				x1={tooltip.x}
				y1={PAD_T}
				x2={tooltip.x}
				y2={H - PAD_B}
				stroke="rgba(255,255,255,0.18)"
				stroke-width="1"
				stroke-dasharray="2,3"
			/>
		{/if}

		<!-- Series -->
		{#each seriesData as s, si}
			{#if series.length > 1}
				{#if si === 0}
					<polygon points={s.areaPath} fill="url(#analyticsAreaViews)" />
				{/if}
				<polyline
					points={s.linePoints}
					fill="none"
					stroke={s.color}
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					opacity="0.9"
				/>
			{/if}
			{#each s.points as pt, pi}
				<circle
					cx={pt.x}
					cy={pt.y}
					r={hoverIdx === pi ? 5 : 3.5}
					fill={s.color}
					opacity="0.9"
					stroke="rgba(0,0,0,0.3)"
					stroke-width="1"
				/>
			{/each}
		{/each}

		<!-- X-axis date labels -->
		{#each xLabels as lbl}
			<text
				x={lbl.x}
				y={H - 8}
				fill="rgba(255,255,255,0.35)"
				font-size="10"
				font-weight="500"
				text-anchor="middle"
				font-family="var(--font-body, sans-serif)"
			>
				{lbl.label}
			</text>
		{/each}
	</svg>

	{#if tooltip}
		<div
			class="chart-tooltip"
			class:flip={tooltip.flip}
			style="left: {tooltip.leftPct}%"
			role="status"
		>
			<span class="tip-date">{formatDate(tooltip.p.date)}</span>
			<span class="tip-row"><i style="background: {VIEWS_COLOR}"></i>Views {formatNum(tooltip.p.views)}</span>
			<span class="tip-row"><i style="background: {LIKES_COLOR}"></i>Likes {formatNum(tooltip.p.likes)}</span>
		</div>
	{/if}
</div>

<div class="chart-legend">
	<span><i style="background: {VIEWS_COLOR}"></i>Views</span>
	<span><i style="background: {LIKES_COLOR}"></i>Likes</span>
</div>

<style>
	.analytics-chart {
		width: 100%;
		aspect-ratio: 3 / 1;
		overflow: visible;
		position: relative;
	}

	.analytics-chart svg {
		width: 100%;
		height: 100%;
		overflow: visible;
		display: block;
	}

	.chart-tooltip {
		position: absolute;
		top: 0;
		transform: translateX(10px);
		background: rgba(10, 10, 18, 0.92);
		border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.12));
		border-radius: var(--radius-sm, 8px);
		padding: 0.5rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 3px;
		pointer-events: none;
		z-index: 5;
		white-space: nowrap;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.chart-tooltip.flip {
		transform: translateX(calc(-100% - 10px));
	}

	.tip-date {
		font-size: 0.68rem;
		color: var(--text-dim);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.tip-row {
		font-size: 0.75rem;
		color: var(--text, #fff);
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono, monospace);
	}

	.tip-row i,
	.chart-legend i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
		flex-shrink: 0;
	}

	.chart-legend {
		display: flex;
		gap: 1.25rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
		flex-wrap: wrap;
	}

	.chart-legend span {
		font-size: 0.78rem;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 500;
	}

	.chart-legend i {
		width: 10px;
		height: 10px;
		box-shadow: 0 0 6px currentColor;
	}
</style>
