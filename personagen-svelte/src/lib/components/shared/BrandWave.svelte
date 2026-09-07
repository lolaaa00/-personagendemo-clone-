<script lang="ts">
	import { brandTransformState } from '$lib/stores/ui.svelte';

	interface Particle {
		id: number;
		x: number;
		y: number;
		angle: number;
		speed: number;
		size: number;
		delay: number;
		color: string;
	}

	let particles = $state<Particle[]>([]);

	// Regenerate sparkling particles whenever transform becomes active
	$effect(() => {
		if (brandTransformState.active) {
			const numParticles = 40;
			const arr: Particle[] = [];
			const colors = [
				brandTransformState.primary,
				brandTransformState.secondary,
				'#ffffff',
				'#ffd700', // Gold sparkles
				'#ff69b4' // Rose sparkles
			];

			for (let i = 0; i < numParticles; i++) {
				arr.push({
					id: i,
					x: brandTransformState.x,
					y: brandTransformState.y,
					angle: Math.random() * Math.PI * 2,
					speed: 1.5 + Math.random() * 4,
					size: 4 + Math.random() * 8,
					delay: Math.random() * 200,
					color: colors[Math.floor(Math.random() * colors.length)]
				});
			}
			particles = arr;
		} else {
			particles = [];
		}
	});
</script>

{#if brandTransformState.active}
	<div class="brand-transform-overlay">
		<!-- Concentric expanding glowing circles -->
		<div
			class="brand-transform-bubble primary-bubble"
			style="--x: {brandTransformState.x}px; --y: {brandTransformState.y}px; --color: {brandTransformState.primary};"
		></div>
		<div
			class="brand-transform-bubble secondary-bubble"
			style="--x: {brandTransformState.x}px; --y: {brandTransformState.y}px; --color: {brandTransformState.secondary}; animate-delay: 0.15s;"
		></div>

		<!-- Burst Sparkles -->
		{#each particles as p (p.id)}
			<div
				class="magic-sparkle"
				style="
          --x: {p.x}px;
          --y: {p.y}px;
          --dx: {Math.cos(p.angle) * p.speed * 40}px;
          --dy: {Math.sin(p.angle) * p.speed * 40}px;
          --size: {p.size}px;
          --color: {p.color};
          --delay: {p.delay}ms;
        "
			>
				<!-- Sparkle Star Icon -->
				<svg
					viewBox="0 0 24 24"
					fill="currentColor"
					style="width: 100%; height: 100%;"
					aria-hidden="true"
				>
					<path d="M12 0L14.6 9.4L24 12L14.6 14.6L12 24L9.4 14.6L0 12L9.4 9.4L12 0Z" />
				</svg>
			</div>
		{/each}

		<!-- Elegant overlay message card -->
		<div class="magical-toast-card" role="status">
			<div class="magical-toast-icon">
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path d="M12 3v18M5.636 5.636l12.728 12.728M3 12h18M5.636 18.364L18.364 5.636" />
				</svg>
			</div>
			<div class="magical-toast-text">
				<h4>Magical Brand Shift</h4>
				<p>Dynamic color scheme aligned with your Brand Brief!</p>
			</div>
		</div>
	</div>
{/if}

<style>
	.brand-transform-overlay {
		position: fixed;
		inset: 0;
		/* Deliberately the topmost layer in the app: this is a pointer-events:none
		   celebration overlay that must paint over even the toast layer. Expressed
		   relative to the scale (was a bare 999999) — nothing else in the app sits
		   above --z-toast, so the stacking result is unchanged. */
		z-index: var(--z-celebration);
		pointer-events: none;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* ── Wave / Expansion Bubble ── */
	.brand-transform-bubble {
		position: absolute;
		width: 60px;
		height: 60px;
		border-radius: 50%;
		left: var(--x);
		top: var(--y);
		background: radial-gradient(circle, var(--color) 0%, transparent 70%);
		transform: translate(-50%, -50%) scale(0);
		opacity: 0;
		pointer-events: none;
		filter: blur(15px);
	}

	.primary-bubble {
		animation: wave-expand-primary 1.5s cubic-bezier(0.1, 0.8, 0.15, 1) forwards;
	}

	.secondary-bubble {
		animation: wave-expand-secondary 1.5s cubic-bezier(0.1, 0.8, 0.15, 1) 0.15s forwards;
	}

	@keyframes wave-expand-primary {
		0% {
			transform: translate(-50%, -50%) scale(0);
			opacity: 0;
		}
		15% {
			opacity: 0.85;
			filter: blur(5px);
		}
		100% {
			transform: translate(-50%, -50%) scale(50);
			opacity: 0;
			filter: blur(50px);
		}
	}

	@keyframes wave-expand-secondary {
		0% {
			transform: translate(-50%, -50%) scale(0);
			opacity: 0;
		}
		15% {
			opacity: 0.75;
			filter: blur(8px);
		}
		100% {
			transform: translate(-50%, -50%) scale(45);
			opacity: 0;
			filter: blur(60px);
		}
	}

	/* ── Sparkling Particles ── */
	.magic-sparkle {
		position: absolute;
		left: var(--x);
		top: var(--y);
		width: var(--size);
		height: var(--size);
		color: var(--color);
		transform: translate(-50%, -50%);
		opacity: 0;
		animation: sparkle-burst 1.2s cubic-bezier(0.25, 1, 0.5, 1) var(--delay) forwards;
		pointer-events: none;
		filter: drop-shadow(0 0 4px var(--color));
	}

	@keyframes sparkle-burst {
		0% {
			transform: translate(-50%, -50%) translate(0, 0) scale(0.3) rotate(0deg);
			opacity: 0;
		}
		20% {
			opacity: 1;
		}
		100% {
			transform: translate(-50%, -50%) translate(var(--dx), var(--dy)) scale(1.2) rotate(270deg);
			opacity: 0;
		}
	}

	/* ── Magical Celebration Card ── */
	.magical-toast-card {
		background: rgba(255, 255, 255, 0.85);
		border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
		backdrop-filter: blur(20px) saturate(180%);
		-webkit-backdrop-filter: blur(20px) saturate(180%);
		box-shadow:
			0 20px 50px rgba(10, 5, 30, 0.15),
			0 0 30px color-mix(in srgb, var(--accent) 15%, transparent);
		border-radius: 20px;
		padding: 16px 24px;
		display: flex;
		align-items: center;
		gap: 16px;
		max-width: 90%;
		width: 380px;
		animation: magical-toast-anim 1.5s cubic-bezier(0.19, 1, 0.22, 1) forwards;
		pointer-events: auto;
		z-index: var(--z-modal);
	}

	:global([data-theme='dark']) .magical-toast-card {
		background: rgba(15, 12, 28, 0.85);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.5),
			0 0 30px color-mix(in srgb, var(--accent) 20%, transparent);
	}

	.magical-toast-icon {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: linear-gradient(135deg, var(--accent), var(--cyan));
		color: #ffffff;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		animation: pulse-glow 2s infinite;
	}

	.magical-toast-text h4 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		font-family: var(--font-body);
		background: linear-gradient(135deg, var(--accent), var(--cyan));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.magical-toast-text p {
		margin: 4px 0 0 0;
		font-size: 0.8rem;
		color: var(--text-muted);
		font-weight: 500;
	}

	@keyframes magical-toast-anim {
		0% {
			opacity: 0;
			transform: translateY(40px) scale(0.9);
		}
		15%,
		80% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
		100% {
			opacity: 0;
			transform: translateY(-20px) scale(0.95);
		}
	}

	@keyframes pulse-glow {
		0%,
		100% {
			box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 30%, transparent);
		}
		50% {
			box-shadow:
				0 0 20px color-mix(in srgb, var(--accent) 60%, transparent),
				0 0 30px color-mix(in srgb, var(--cyan) 40%, transparent);
		}
	}
</style>
