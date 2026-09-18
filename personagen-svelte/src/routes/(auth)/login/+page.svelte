<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { RETURN_PARAM, safeReturnTo } from '$lib/return-to';
	import { showToast, themeState } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let error = $state('');

	// Email format is checked on blur, independently of the submit error. Both
	// fields previously keyed aria-invalid off `error` alone, which meant a wrong
	// *password* also marked the email invalid, and a malformed address was never
	// flagged at all until submit. Mirrors the signup page's treatment.
	let emailTouched = $state(false);
	let emailMalformed = $derived(
		emailTouched && email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
	);

	// ── Presentation-only state: drives ARIA attributes and focus management ──
	let showPassword = $state(false);
	let emailEl: HTMLInputElement | null = $state(null);
	let passwordEl: HTMLInputElement | null = $state(null);

	// Svelte forbids a dynamic `type` attribute on an input that uses bind:value,
	// so the show/hide toggle is reflected onto the element imperatively.
	$effect(() => {
		if (passwordEl) passwordEl.type = showPassword ? 'text' : 'password';
	});

	// After a failed submit, move focus to the first field the user must correct.
	$effect(() => {
		if (!error) return;
		emailEl?.focus();
	});

	async function handleLogin(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (!email.trim() || !password) {
			error = 'Enter your email and password to sign in.';
			return;
		}
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
			// Return the user to whatever they asked for before being sent here —
			// a deep link, or the page a session expiry interrupted.
			goto(safeReturnTo($page.url.searchParams.get(RETURN_PARAM)) ?? '/dashboard');
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
		<a class="login-brand" href="/" aria-label="PersonaGen home">
			<span class="login-logo" aria-hidden="true">
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
				</svg>
			</span>
			<span class="login-wordmark">PersonaGen</span>
		</a>
		<Card dark={themeState.current === 'dark'} class="login-card">
			{#snippet title()}
				<h1>Welcome back</h1>
			{/snippet}

			{#snippet description()}
				<p>Your personas are waiting.</p>
			{/snippet}

			<form onsubmit={handleLogin} class="login-form" novalidate>
				<p class="login-required-note" id="login-required-note">
					Fields marked <span class="login-req" aria-hidden="true">*</span>
					<span class="sr-only">with an asterisk</span> are required.
				</p>

				<div class="login-field">
					<label for="email">
						Email address <span class="login-req" aria-hidden="true">*</span><span class="sr-only"
							>(required)</span
						>
					</label>
					<input
						id="email"
						class="input-field"
						type="email"
						inputmode="email"
						bind:value={email}
						bind:this={emailEl}
						placeholder="you@example.com"
						required
						aria-required="true"
						autocomplete="email"
						onblur={() => (emailTouched = true)}
						aria-invalid={emailMalformed || error ? 'true' : 'false'}
						aria-describedby={emailMalformed
							? 'login-email-error'
							: error
								? 'login-error'
								: undefined}
					/>
					{#if emailMalformed}
						<span class="field-hint error" id="login-email-error" role="alert">
							“{email.trim()}” is not a valid email address — check for a missing @ or domain.
						</span>
					{/if}
				</div>

				<div class="login-field">
					<label for="password">
						Password <span class="login-req" aria-hidden="true">*</span><span class="sr-only"
							>(required)</span
						>
					</label>
					<div class="login-input-wrap">
						<input
							id="password"
							class="input-field login-input-toggleable"
							type="password"
							bind:value={password}
							bind:this={passwordEl}
							placeholder="••••••••"
							required
							aria-required="true"
							autocomplete="current-password"
							aria-invalid={error ? 'true' : 'false'}
							aria-describedby={error ? 'login-password-help login-error' : 'login-password-help'}
						/>
						<button
							type="button"
							class="login-pw-toggle"
							aria-pressed={showPassword}
							aria-controls="password"
							aria-label={showPassword ? 'Hide password' : 'Show password'}
							onclick={() => (showPassword = !showPassword)}
						>
							{#if showPassword}
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
									<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
									<path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
									<line x1="2" y1="2" x2="22" y2="22" />
								</svg>
							{:else}
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
									<circle cx="12" cy="12" r="3" />
								</svg>
							{/if}
						</button>
					</div>
					<p class="login-hint" id="login-password-help">
						Passwords are case-sensitive.
					</p>
				</div>

				{#if error}
					<div class="login-error" id="login-error" role="alert">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line
								x1="9"
								y1="9"
								x2="15"
								y2="15"
							/>
						</svg>
						<span class="login-error-body">
							<strong class="login-error-message">{error}</strong>
							<span class="login-error-help">
								Re-enter your email address and password — passwords are case-sensitive — then try
								again. If the problem continues, create an account or contact your administrator.
							</span>
						</span>
					</div>
				{/if}

				<Button type="submit" variant="primary" {loading} class="login-submit">
					{loading ? 'Signing in…' : 'Sign In'}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
					</svg>
				</Button>

				<p class="sr-only" role="status" aria-live="polite">
					{loading ? 'Signing in, please wait…' : ''}
				</p>
			</form>

			<!-- Signup link -->
			<div class="login-alt">
				<span>Don't have an account?</span>
				<a href="/signup">Sign up</a>
			</div>

			{#snippet footer()}
				<ul class="login-footer" aria-label="What you get">
					<li>No credit card to start</li>
					<li>Verified publishing</li>
					<li>You own what it makes</li>
				</ul>
			{/snippet}
		</Card>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		align-items: flex-start;
		padding-top: clamp(1.5rem, 8vh, 5rem);
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

	@media (prefers-reduced-motion: reduce) {
		.login-orb {
			animation: none;
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
		gap: 0.6rem;
		text-decoration: none;
		color: var(--text);
		min-height: 44px;
		border-radius: var(--radius-xs);
	}
	.login-brand:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.login-logo {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: var(--gradient);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.35),
			0 4px 12px color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.login-wordmark {
		font-family: var(--font-body);
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--text);
		letter-spacing: -0.01em;
	}

	/* Form overrides */
	.login-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.login-required-note {
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin: 0;
	}

	.login-field {
		display: flex;
		flex-direction: column;
	}

	.login-field label {
		font-size: var(--text-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		margin-bottom: var(--space-2);
	}

	.login-req {
		color: var(--error-text);
		font-weight: 700;
	}

	.login-hint {
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin: var(--space-2) 0 0;
	}

	/* Password show/hide */
	.login-input-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.login-input-toggleable {
		padding-right: 52px;
	}

	.login-pw-toggle {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		min-width: 44px;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: 0;
		border-radius: var(--radius-xs);
		color: var(--text-dim);
		cursor: pointer;
		transition: color var(--ease-fast);
	}

	.login-pw-toggle:hover {
		color: var(--text);
	}

	.login-pw-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* Error */
	.login-error {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-xs);
		background: color-mix(in srgb, var(--error) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
		color: var(--error-text);
		font-size: var(--text-base);
		font-weight: 500;
		animation: fadeDown 0.3s ease;
	}

	.login-error svg {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.login-error-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.login-error-message {
		font-weight: 700;
	}

	.login-error-help {
		font-weight: 500;
		color: var(--text);
		line-height: var(--leading-snug);
	}

	@media (prefers-reduced-motion: reduce) {
		.login-error {
			animation: none;
		}
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
		font-size: var(--text-base);
		color: var(--text-dim);
	}

	.login-alt a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-2);
		color: var(--accent-text);
		font-weight: 600;
		transition: color 0.2s ease;
	}

	.login-alt a:hover {
		color: var(--text);
	}

	.login-alt a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: var(--radius-xs);
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
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.35rem 1.1rem;
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: var(--text-base);
		color: var(--text-dim);
		font-weight: 500;
	}
	.login-footer li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.login-footer li::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success);
		flex-shrink: 0;
	}

	/* Matches the signup page's field-level error treatment. */
	.field-hint {
		display: block;
		font-size: var(--text-sm);
		margin-top: var(--space-1);
		margin-bottom: 0;
		font-weight: 500;
		color: var(--text-dim);
		line-height: var(--leading-snug);
	}

	.field-hint.error {
		color: var(--error-text);
		font-weight: 600;
	}
</style>
