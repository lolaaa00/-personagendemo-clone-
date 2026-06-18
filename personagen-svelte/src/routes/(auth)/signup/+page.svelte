<script lang="ts">
	import { goto } from '$app/navigation';
	import { showToast, themeState } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let fullName = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let pin = $state('');
	let loading = $state(false);
	let error = $state('');

	// Password strength calculation
	let passwordStrength = $derived.by(() => {
		if (!password) return { level: 0, label: '', color: '' };

		let score = 0;
		if (password.length >= 6) score++;
		if (password.length >= 10) score++;
		if (/[A-Z]/.test(password)) score++;
		if (/[0-9]/.test(password)) score++;
		if (/[^A-Za-z0-9]/.test(password)) score++;

		if (score <= 1) return { level: 1, label: 'Weak', color: 'var(--error)' };
		if (score <= 3) return { level: 2, label: 'Medium', color: 'var(--warning)' };
		return { level: 3, label: 'Strong', color: 'var(--success)' };
	});

	let passwordsMatch = $derived(!confirmPassword || password === confirmPassword);

	let canSubmit = $derived(
		fullName.trim().length > 0 &&
			email.trim().length > 0 &&
			password.length >= 6 &&
			confirmPassword.length > 0 &&
			password === confirmPassword &&
			!loading
	);

	async function handleSignup(e: SubmitEvent) {
		e.preventDefault();
		error = '';

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			return;
		}

		if (password.length < 6) {
			error = 'Password must be at least 6 characters';
			return;
		}

		loading = true;

		try {
			const res = await fetch('/api/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, full_name: fullName, pin })
			});

			const data: any = await res.json();

			if (!res.ok) {
				error = data.error || 'Signup failed';
				loading = false;
				return;
			}

			showToast('Account created! Welcome to PersonaGen.', 'success');
			goto('/dashboard');
		} catch {
			error = 'Network error. Please try again.';
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign Up — PersonaGen</title>
</svelte:head>

<div class="signup-page">
	<!-- Ambient orbs -->
	<div class="signup-ambient" aria-hidden="true">
		<div class="signup-orb signup-orb-1"></div>
		<div class="signup-orb signup-orb-2"></div>
		<div class="signup-orb signup-orb-3"></div>
	</div>

	<!-- Grid background -->
	<div class="signup-grid" aria-hidden="true"></div>

	<div class="signup-container">
		<!-- Brand -->
		<div class="signup-brand">
			<div class="signup-logo">
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
			<span class="signup-wordmark">PersonaGen</span>
		</div>

		<!-- Card Primitive -->
		<Card dark={themeState.current === 'dark'} class="signup-card">
			{#snippet title()}
				<h1>Create your account</h1>
			{/snippet}

			{#snippet description()}
				<p>Get started with PersonaGen</p>
			{/snippet}

			<form onsubmit={handleSignup} class="signup-form">
				{#if error}
					<div class="signup-error" role="alert">
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

				<div class="signup-field">
					<label for="full-name">Full name</label>
					<Input
						id="full-name"
						type="text"
						bind:value={fullName}
						placeholder="Jane Doe"
						required
						autocomplete="name"
					/>
				</div>

				<div class="signup-field">
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

				<div class="signup-field">
					<label for="password">Password</label>
					<Input
						id="password"
						type="password"
						bind:value={password}
						placeholder="••••••••"
						required
						autocomplete="new-password"
						minlength={6}
					/>
					{#if password}
						<div class="password-strength">
							<div class="strength-bar">
								<div
									class="strength-fill"
									style="width: {(passwordStrength.level / 3) *
										100}%; background: {passwordStrength.color};"
								></div>
							</div>
							<span class="strength-label" style="color: {passwordStrength.color};">
								{passwordStrength.label}
							</span>
						</div>
					{/if}
				</div>

				<div class="signup-field">
					<label for="confirm-password">Confirm password</label>
					<Input
						id="confirm-password"
						type="password"
						bind:value={confirmPassword}
						placeholder="••••••••"
						required
						autocomplete="new-password"
						class={!passwordsMatch ? 'field-error' : ''}
					/>
					{#if !passwordsMatch}
						<span class="field-hint error">Passwords do not match</span>
					{/if}
				</div>

				<div class="signup-field">
					<label for="pin">Admin PIN (Optional)</label>
					<Input id="pin" type="password" bind:value={pin} placeholder="••••" autocomplete="off" />
				</div>

				<Button
					type="submit"
					variant="primary"
					disabled={!canSubmit}
					{loading}
					class="signup-submit"
				>
					Create Account
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

			<div class="signup-alt">
				<span>Already have an account?</span>
				<a href="/login">Sign in</a>
			</div>

			{#snippet footer()}
				<div class="signup-footer">
					<span>Managed by PersonaGen</span>
					<span class="signup-pulse"></span>
					<span>Portal Active</span>
				</div>
			{/snippet}
		</Card>
	</div>
</div>

<style>
	.signup-page {
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
	.signup-ambient {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 0;
	}

	.signup-orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(120px);
	}

	.signup-orb-1 {
		width: 600px;
		height: 600px;
		background: var(--accent);
		opacity: 0.06;
		top: -15%;
		left: 20%;
		animation: orb-float-1 20s ease-in-out infinite;
	}

	.signup-orb-2 {
		width: 500px;
		height: 500px;
		background: var(--cyan);
		opacity: 0.04;
		bottom: 0;
		right: -5%;
		animation: orb-float-2 25s ease-in-out infinite;
	}

	.signup-orb-3 {
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

	.signup-grid {
		position: fixed;
		inset: 0;
		background-image: radial-gradient(var(--border-strong) 1px, transparent 1px);
		background-size: 28px 28px;
		pointer-events: none;
		z-index: 0;
		opacity: 0.35;
	}

	/* Container */
	.signup-container {
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
	.signup-brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.signup-logo {
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

	.signup-wordmark {
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
	.signup-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.signup-field {
		display: flex;
		flex-direction: column;
	}

	.signup-field label {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		margin-bottom: var(--space-2);
	}

	/* Password strength */
	.password-strength {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.strength-bar {
		flex: 1;
		height: 4px;
		border-radius: 2px;
		background: var(--surface-3);
		overflow: hidden;
	}

	.strength-fill {
		height: 100%;
		border-radius: 2px;
		transition:
			width 0.3s ease,
			background 0.3s ease;
	}

	.strength-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		white-space: nowrap;
	}

	/* Field hint */
	.field-hint {
		font-size: var(--text-xs);
		margin-top: var(--space-1);
		font-weight: 500;
	}

	.field-hint.error {
		color: var(--error);
	}

	/* Error */
	.signup-error {
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
	:global(.signup-card) {
		width: 100% !important;
	}

	:global(.signup-submit) {
		width: 100% !important;
		margin-top: var(--space-2);
	}

	:global(.field-error) {
		border-color: rgba(239, 68, 68, 0.4) !important;
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08) !important;
	}

	/* Alt link */
	.signup-alt {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-6);
		font-size: var(--text-sm);
		color: var(--text-dim);
	}

	.signup-alt a {
		color: var(--accent);
		font-weight: 600;
		transition: color 0.2s ease;
	}

	.signup-alt a:hover {
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
	.signup-footer {
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

	.signup-pulse {
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
