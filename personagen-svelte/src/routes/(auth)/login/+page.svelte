<script lang="ts">
	import { goto } from '$app/navigation';
	import { showToast, themeState } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let error = $state('');

	async function handleLogin(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password })
			});

			const data: any = await res.json();

			if (!res.ok) {
				error = data.error || 'Invalid credentials';
				loading = false;
				return;
			}

			showToast('Welcome back!', 'success');
			goto('/dashboard');
		} catch {
			error = 'Network error. Please try again.';
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign In — PersonaGen</title>
</svelte:head>

<div class="login-page">
	<!-- Ambient orbs -->
	<div class="login-ambient" aria-hidden="true">
		<div class="login-orb login-orb-1"></div>
		<div class="login-orb login-orb-2"></div>
		<div class="login-orb login-orb-3"></div>
	</div>

	<!-- Grid background -->
	<div class="login-grid" aria-hidden="true"></div>

	<div class="login-container">
		<!-- Brand -->
		<div class="login-brand">
			<div class="login-logo">
				<svg
					aria-hidden="true"
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
				</svg>
			</div>
			<span class="login-wordmark">PersonaGen</span>
		</div>
		<Card dark={themeState.current === 'dark'} class="login-card">
			{#snippet title()}
				<h1>Welcome back</h1>
			{/snippet}

			{#snippet description()}
				<p>Sign in to your portal</p>
			{/snippet}

			<form onsubmit={handleLogin} class="login-form">
				{#if error}
					<div class="login-error" role="alert">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line
								x1="9"
								y1="9"
								x2="15"
								y2="15"
							/>
						</svg>
						{error}
					</div>
				{/if}

				<div class="login-field">
					<label for="email">Email address</label>
					<Input
						id="email"
						type="email"
						bind:value={email}
						placeholder="you@example.com"
						required
						autocomplete="email"
					/>
				</div>

				<div class="login-field">
					<label for="password">Password</label>
					<Input
						id="password"
						type="password"
						bind:value={password}
						placeholder="••••••••"
						required
						autocomplete="current-password"
					/>
				</div>

				<Button type="submit" variant="primary" {loading} class="login-submit">
					Sign In
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
					</svg>
				</Button>
			</form>

			<!-- Signup link -->
			<div class="login-alt">
				<span>Don't have an account?</span>
				<a href="/signup">Sign up</a>
			</div>

			{#snippet footer()}
				<div class="login-footer">
					<span>Managed by PersonaGen</span>
					<span class="login-pulse"></span>
					<span>Portal Active</span>
				</div>
			{/snippet}
		</Card>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg);
		position: relative;
		overflow: hidden;
	}

	/* Ambient background */
	.login-ambient {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 0;
	}

	.login-orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(120px);
	}

	.login-orb-1 {
		width: 600px;
		height: 600px;
		background: var(--accent);
		opacity: 0.06;
		top: -15%;
		left: 20%;
		animation: orb-float-1 20s ease-in-out infinite;
	}

	.login-orb-2 {
		width: 500px;
		height: 500px;
		background: var(--cyan);
		opacity: 0.04;
		bottom: 0;
		right: -5%;
		animation: orb-float-2 25s ease-in-out infinite;
	}

	.login-orb-3 {
		width: 400px;
		height: 400px;
		background: var(--rose);
		opacity: 0.035;
		bottom: 20%;
		left: -10%;
		animation: orb-float-3 18s ease-in-out infinite;
	}

	@keyframes orb-float-1 {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(30px, 20px);
		}
	}

	@keyframes orb-float-2 {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(-20px, -30px);
		}
	}

	@keyframes orb-float-3 {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(20px, -15px);
		}
	}

	.login-grid {
		position: fixed;
		inset: 0;
		background-image: radial-gradient(var(--border-strong) 1px, transparent 1px);
		background-size: 28px 28px;
		pointer-events: none;
		z-index: 0;
		opacity: 0.35;
	}

	/* Container */
	.login-container {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-8);
		width: 100%;
		max-width: 420px;
		padding: var(--space-6);
	}

	/* Brand */
	.login-brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.login-logo {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: var(--gradient);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		box-shadow: 0 0 30px rgba(124, 106, 237, 0.35);
	}

	.login-wordmark {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.5rem;
		background: var(--gradient);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		letter-spacing: var(--tracking-tight);
	}

	/* Form overrides */
	.login-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.login-field {
		display: flex;
		flex-direction: column;
	}

	.login-field label {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		margin-bottom: var(--space-2);
	}

	/* Error */
	.login-error {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-xs);
		background: rgba(239, 68, 68, 0.15);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
		font-size: var(--text-sm);
		font-weight: 500;
		animation: fadeDown 0.3s ease;
	}

	/* Primitives class overrides */
	:global(.login-card) {
		width: 100% !important;
	}

	:global(.login-submit) {
		width: 100% !important;
		margin-top: var(--space-2);
	}

	/* Alt link */
	.login-alt {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-6);
		font-size: var(--text-sm);
		color: var(--text-dim);
	}

	.login-alt a {
		color: var(--accent);
		font-weight: 600;
		transition: color 0.2s ease;
	}

	.login-alt a:hover {
		color: var(--text);
	}

	@keyframes fadeDown {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Footer */
	.login-footer {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 600;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}

	.login-pulse {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success);
		box-shadow: 0 0 8px rgba(52, 211, 153, 0.6);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}
</style>
