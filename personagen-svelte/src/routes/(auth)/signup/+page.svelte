<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { showToast, themeState } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/ui/Button.svelte';
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

	// ── Presentation-only state: drives ARIA attributes, the error summary and focus ──
	let showPassword = $state(false);
	let showConfirm = $state(false);
	let showPin = $state(false);

	let nameEl: HTMLInputElement | null = $state(null);
	let emailEl: HTMLInputElement | null = $state(null);
	let passwordEl: HTMLInputElement | null = $state(null);
	let confirmEl: HTMLInputElement | null = $state(null);
	let pinEl: HTMLInputElement | null = $state(null);
	let summaryEl: HTMLDivElement | null = $state(null);

	let nameInvalid = $derived(!!error && fullName.trim().length === 0);
	let emailInvalid = $derived(!!error && email.trim().length === 0);
	let passwordInvalid = $derived(!!error && password.length < 6);
	let confirmInvalid = $derived(!passwordsMatch || (!!error && confirmPassword.length === 0));
	let hasFieldError = $derived(nameInvalid || emailInvalid || passwordInvalid || confirmInvalid);
	// The summary only appears after a failed submit; the live mismatch warning stays inline
	// so the layout doesn't jump while the user is still typing.
	let showSummary = $derived(!!error);

	let nameDescribedBy = $derived(nameInvalid ? 'full-name-error' : undefined);
	let emailDescribedBy = $derived(emailInvalid ? 'email-error' : undefined);
	let passwordDescribedBy = $derived(
		passwordInvalid ? 'password-help password-error' : 'password-help'
	);
	let confirmDescribedBy = $derived(confirmInvalid ? 'confirm-password-error' : undefined);

	// Svelte forbids a dynamic `type` attribute on an input that uses bind:value,
	// so the show/hide toggles are reflected onto the elements imperatively.
	$effect(() => {
		if (passwordEl) passwordEl.type = showPassword ? 'text' : 'password';
	});
	$effect(() => {
		if (confirmEl) confirmEl.type = showConfirm ? 'text' : 'password';
	});
	$effect(() => {
		if (pinEl) pinEl.type = showPin ? 'text' : 'password';
	});

	// After a failed submit, move focus to the first field the user must correct.
	// Reads inside the `then` callback are async, so they are not tracked here —
	// only `error` re-triggers this effect.
	$effect(() => {
		if (!error) return;
		tick().then(() => {
			const target = nameInvalid
				? nameEl
				: emailInvalid
					? emailEl
					: passwordInvalid
						? passwordEl
						: confirmInvalid
							? confirmEl
							: summaryEl;
			target?.focus();
		});
	});

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
				{#if showSummary}
					<div
						class="signup-error"
						id="signup-error-summary"
						role="alert"
						tabindex="-1"
						bind:this={summaryEl}
					>
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
						<div class="signup-error-body">
							<strong class="signup-error-title">{error}</strong>
							<ul class="signup-error-list">
								{#if nameInvalid}
									<li>
										<a href="#full-name">Full name</a> is empty — enter the name you want on your
										account.
									</li>
								{/if}
								{#if emailInvalid}
									<li>
										<a href="#email">Email address</a> is empty — enter the address you will sign in
										with, for example you@example.com.
									</li>
								{/if}
								{#if passwordInvalid}
									<li>
										<a href="#password">Password</a> is too short — use at least 6 characters.
									</li>
								{/if}
								{#if confirmInvalid}
									<li>
										<a href="#confirm-password">Confirm password</a> does not match your password — re-type
										the same password in both fields.
									</li>
								{/if}
								{#if !hasFieldError}
									<li>
										Check the details above and try again, or <a href="/login">sign in</a> if you
										already have an account.
									</li>
								{/if}
							</ul>
						</div>
					</div>
				{/if}

				<p class="signup-required-note">
					Fields marked <span class="signup-req" aria-hidden="true">*</span>
					<span class="sr-only">with an asterisk</span> are required.
				</p>

				<div class="signup-field">
					<label for="full-name">
						Full name <span class="signup-req" aria-hidden="true">*</span><span class="sr-only"
							>(required)</span
						>
					</label>
					<input
						id="full-name"
						class="input-field"
						type="text"
						bind:value={fullName}
						bind:this={nameEl}
						placeholder="Jane Doe"
						required
						aria-required="true"
						autocomplete="name"
						aria-invalid={nameInvalid ? 'true' : 'false'}
						aria-describedby={nameDescribedBy}
					/>
					{#if nameInvalid}
						<span class="field-hint error" id="full-name-error" role="alert">
							Enter your full name so we know what to call you.
						</span>
					{/if}
				</div>

				<div class="signup-field">
					<label for="email">
						Email address <span class="signup-req" aria-hidden="true">*</span><span class="sr-only"
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
						aria-invalid={emailInvalid ? 'true' : 'false'}
						aria-describedby={emailDescribedBy}
					/>
					{#if emailInvalid}
						<span class="field-hint error" id="email-error" role="alert">
							Enter the email address you will sign in with, for example you@example.com.
						</span>
					{/if}
				</div>

				<div class="signup-field">
					<label for="password">
						Password <span class="signup-req" aria-hidden="true">*</span><span class="sr-only"
							>(required)</span
						>
					</label>
					<div class="signup-input-wrap">
						<input
							id="password"
							class="input-field signup-input-toggleable"
							type="password"
							bind:value={password}
							bind:this={passwordEl}
							placeholder="••••••••"
							required
							aria-required="true"
							autocomplete="new-password"
							minlength={6}
							aria-invalid={passwordInvalid ? 'true' : 'false'}
							aria-describedby={passwordDescribedBy}
						/>
						<button
							type="button"
							class="signup-pw-toggle"
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
									<path
										d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
									/>
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
					<p class="field-hint" id="password-help">
						At least 6 characters. Mixing in a capital letter, a number and a symbol makes it
						stronger.
					</p>
					{#if passwordInvalid}
						<span class="field-hint error" id="password-error" role="alert">
							Password is too short — use at least 6 characters, then try again.
						</span>
					{/if}
					{#if password}
						<div class="password-strength" aria-hidden="true">
							<div class="strength-bar">
								<div
									class="strength-fill"
									style="transform: scaleX({passwordStrength.level /
										3}); background: {passwordStrength.color};"
								></div>
							</div>
							<span class="strength-label" data-level={passwordStrength.level}>
								{passwordStrength.label}
							</span>
						</div>
					{/if}
					<p class="sr-only" role="status" aria-live="polite">
						{password ? `Password strength: ${passwordStrength.label}` : ''}
					</p>
				</div>

				<div class="signup-field">
					<label for="confirm-password">
						Confirm password <span class="signup-req" aria-hidden="true">*</span><span
							class="sr-only">(required)</span
						>
					</label>
					<div class="signup-input-wrap">
						<input
							id="confirm-password"
							class="input-field signup-input-toggleable {confirmInvalid ? 'field-error' : ''}"
							type="password"
							bind:value={confirmPassword}
							bind:this={confirmEl}
							placeholder="••••••••"
							required
							aria-required="true"
							autocomplete="new-password"
							aria-invalid={confirmInvalid ? 'true' : 'false'}
							aria-describedby={confirmDescribedBy}
						/>
						<button
							type="button"
							class="signup-pw-toggle"
							aria-pressed={showConfirm}
							aria-controls="confirm-password"
							aria-label={showConfirm ? 'Hide confirmed password' : 'Show confirmed password'}
							onclick={() => (showConfirm = !showConfirm)}
						>
							{#if showConfirm}
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
									<path
										d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
									/>
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
					{#if confirmInvalid}
						<span class="field-hint error" id="confirm-password-error" role="alert">
							Passwords do not match — re-type the same password in both fields.
						</span>
					{/if}
				</div>

				<div class="signup-field">
					<label for="pin">Admin PIN <span class="signup-optional">(optional)</span></label>
					<div class="signup-input-wrap">
						<input
							id="pin"
							class="input-field signup-input-toggleable"
							type="password"
							bind:value={pin}
							bind:this={pinEl}
							placeholder="••••"
							autocomplete="off"
							aria-describedby="pin-help"
						/>
						<button
							type="button"
							class="signup-pw-toggle"
							aria-pressed={showPin}
							aria-controls="pin"
							aria-label={showPin ? 'Hide admin PIN' : 'Show admin PIN'}
							onclick={() => (showPin = !showPin)}
						>
							{#if showPin}
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
									<path
										d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
									/>
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
					<p class="field-hint" id="pin-help">
						Leave this blank unless your administrator gave you a PIN.
					</p>
				</div>

				<Button
					type="submit"
					variant="primary"
					disabled={!canSubmit}
					{loading}
					class="signup-submit"
				>
					{loading ? 'Creating account…' : 'Create Account'}
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

				{#if !canSubmit && !loading}
					<p class="field-hint signup-submit-note">
						Fill in every required field and make sure both passwords match to enable this button.
					</p>
				{/if}

				<p class="sr-only" role="status" aria-live="polite">
					{loading ? 'Creating your account, please wait…' : ''}
				</p>
			</form>

			<div class="signup-alt">
				<span>Already have an account?</span>
				<a href="/login">Sign in</a>
			</div>

			{#snippet footer()}
				<div class="signup-footer">
					<span>Managed by PersonaGen</span>
					<span class="signup-pulse" aria-hidden="true"></span>
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

	@media (prefers-reduced-motion: reduce) {
		.signup-orb,
		.signup-pulse {
			animation: none;
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
		box-shadow: 0 0 30px color-mix(in srgb, var(--accent) 35%, transparent);
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

	.signup-required-note {
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin: 0;
	}

	.signup-field {
		display: flex;
		flex-direction: column;
	}

	.signup-field label {
		font-size: var(--text-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		margin-bottom: var(--space-2);
	}

	.signup-req {
		color: var(--error-text);
		font-weight: 700;
	}

	.signup-optional {
		font-weight: 600;
		text-transform: none;
		letter-spacing: normal;
	}

	/* Password show/hide */
	.signup-input-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.signup-input-toggleable {
		padding-right: 52px;
	}

	.signup-pw-toggle {
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

	.signup-pw-toggle:hover {
		color: var(--text);
	}

	.signup-pw-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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

	/* Driven by transform (not width) so the meter never triggers layout. */
	.strength-fill {
		width: 100%;
		height: 100%;
		border-radius: 2px;
		transform-origin: left;
		transition:
			transform 0.25s ease,
			background 0.25s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.strength-fill {
			transition: none;
		}
	}

	.strength-label {
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		white-space: nowrap;
	}

	.strength-label[data-level='1'] {
		color: var(--error-text);
	}

	.strength-label[data-level='2'] {
		color: var(--warning-text);
	}

	.strength-label[data-level='3'] {
		color: var(--success-text);
	}

	/* Field hint */
	.field-hint {
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

	.signup-submit-note {
		text-align: center;
	}

	/* Error summary */
	.signup-error {
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

	.signup-error:focus-visible {
		outline: 2px solid var(--error);
		outline-offset: 2px;
	}

	.signup-error svg {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.signup-error-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.signup-error-title {
		font-weight: 700;
	}

	.signup-error-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding-left: var(--space-4);
		list-style: disc;
		color: var(--text);
		line-height: var(--leading-snug);
	}

	.signup-error-list a {
		color: var(--error-text);
		font-weight: 700;
		text-decoration: underline;
	}

	.signup-error-list a:focus-visible {
		outline: 2px solid var(--error);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.signup-error {
			animation: none;
		}
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
		border-color: color-mix(in srgb, var(--error) 55%, transparent) !important;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--error) 12%, transparent) !important;
	}

	/* Alt link */
	.signup-alt {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-6);
		font-size: var(--text-base);
		color: var(--text-dim);
	}

	.signup-alt a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-2);
		color: var(--accent-text);
		font-weight: 600;
		transition: color 0.2s ease;
	}

	.signup-alt a:hover {
		color: var(--text);
	}

	.signup-alt a:focus-visible {
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
		box-shadow: 0 0 8px color-mix(in srgb, var(--success) 60%, transparent);
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
