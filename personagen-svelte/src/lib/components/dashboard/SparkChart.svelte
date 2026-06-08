<script lang="ts">
	interface Props {
		sparkData: number[][];
		agents: any[];
	}

	let { sparkData, agents }: Props = $props();

	const W = 520;
	const H = 200;
	const PAD_L = 48;
	const PAD_R = 16;
	const PAD_T = 16;
	const PAD_B = 28;
	const COLORS = ['#6366f1', '#34d399', '#fbbf24'];
	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	let chartW = W - PAD_L - PAD_R;
	let chartH = H - PAD_T - PAD_B;

	let allVals = $derived(sparkData.flat());
	let minVal = $derived(Math.min(...allVals) - 0.5);
	let maxVal = $derived(Math.max(...allVals) + 0.5);

	function scaleX(i: number): number {
		return PAD_L + (i / 6) * chartW;
	}

	function scaleY(v: number): number {
		return H - PAD_B - ((v - minVal) / (maxVal - minVal)) * chartH;
	}

	let gridSteps = $derived.by(() => {
		const steps = 4;
		return Array.from({ length: steps + 1 }, (_, i) => {
			const v = minVal + (i / steps) * (maxVal - minVal);
			return { v, y: scaleY(v), label: v.toFixed(1) + '%' };
		});
	});

	let seriesData = $derived.by(() =>
		sparkData.map((data, si) => {
			const points = data.map((v, i) => ({ x: scaleX(i), y: scaleY(v), v }));
			const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
			const areaPath = [
				...points.map((p) => `${p.x},${p.y}`),
				`${scaleX(6)},${H - PAD_B}`,
				`${scaleX(0)},${H - PAD_B}`
			].join(' ');
			return { points, linePoints, areaPath, color: COLORS[si], idx: si };
		})
	);

	let legendItems = $derived.by(() =>
		agents.slice(0, 3).map((a, i) => {
			const parts = a.name.split(' ');
			const shortName = parts
				.map((w: string, j: number) => (j === 0 ? w : w.charAt(0) + '.'))
				.join(' ');
			return { name: shortName, color: COLORS[i] };
		})
	);
</script>

<div class="dash-chart-card">
	<h4>Engagement Trend (7 Days)</h4>
	<div class="spark-chart">
		<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
			<!-- Gradient defs -->
			<defs>
				{#each COLORS as color, i}
					<linearGradient id="areaGrad{i}" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color={color} stop-opacity="0.18" />
						<stop offset="100%" stop-color={color} stop-opacity="0.0" />
					</linearGradient>
				{/each}
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

			<!-- Series: area fills, lines, and dots -->
			{#each seriesData as series}
				<polygon points={series.areaPath} fill="url(#areaGrad{series.idx})" />
				<polyline
					points={series.linePoints}
					fill="none"
					stroke={series.color}
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
					opacity="0.9"
				/>
				{#each series.points as pt}
					<circle cx={pt.x} cy={pt.y} r="6" fill={series.color} opacity="0.15" />
					<circle
						cx={pt.x}
						cy={pt.y}
						r="4"
						fill={series.color}
						opacity="0.9"
						stroke="rgba(0,0,0,0.3)"
						stroke-width="1"
					/>
				{/each}
			{/each}

			<!-- Day labels -->
			{#each DAYS as day, i}
				<text
					x={scaleX(i)}
					y={H - 6}
					fill="rgba(255,255,255,0.35)"
					font-size="10"
					font-weight="500"
					text-anchor="middle"
					font-family="var(--font-body, sans-serif)"
				>
					{day}
				</text>
			{/each}
		</svg>
	</div>

	<div class="spark-legend">
		{#each legendItems as item}
			<span>
				<i style="background: {item.color}"></i>
				{item.name}
			</span>
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

	.spark-chart {
		width: 100%;
		aspect-ratio: 2.8 / 1;
		overflow: visible;
		position: relative;
	}

	.spark-chart svg {
		width: 100%;
		height: 100%;
		overflow: visible;
		display: block;
	}

	.spark-legend {
		display: flex;
		gap: 1.25rem;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
		flex-wrap: wrap;
	}

	.spark-legend span {
		font-size: 0.78rem;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 500;
	}

	.spark-legend i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
		box-shadow: 0 0 6px currentColor;
	}
</style>
