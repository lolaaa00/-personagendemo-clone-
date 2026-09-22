<script lang="ts">
	/**
	 * Password recovery — the entry point UX-012 found missing.
	 *
	 * The sign-in form had no "forgot password" link because there was nowhere
	 * for it to go: no reset route existed anywhere in the product. Adding the
	 * link alone would have shipped the exact defect the same audit filed as
	 * UX-003 — a control that looks ready and fails on click.
	 *
	 * This asks for an address and stops. The recovery link Supabase sends lands
	 * on /api/auth/callback, which exchanges it for a session and forwards to
	 * Settings → Profile, where the existing password form finishes the job.
	 */
	let email = $state('');
	let sending = $state(false);
	let sent = $state(false);
	let error = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (!email.trim()) {
			error = 'Enter the email address you sign in with.';
			return;
		}
		sending = true;
		try {
			const res = await fetch('/api/auth/reset', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: email.trim() })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = d?.error || 'Could not send the reset link. Try again in a moment.';
				return;
			}
			sent = true;
		} catch {
			error = 'Could not reach the server. Check your connection and try again.';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>Reset your password — PersonaGen</title>
</svelte:head>

<div class="reset">
	<div class="reset-card">
		<h1>Reset your password</h1>

		{#if sent}
			<p class="reset-sent" role="status">
				If that address has an account, a reset link is on its way. Open it on this device and
				you'll be asked to choose a new password straight away.
			</p>
			<p class="reset-hint">
				Nothing after a few minutes? Check spam, then try again — the link expires, so request a
				fresh one rather than reusing an old email.
			</p>
			<a class="reset-btn" href="/login">Back to sign in</a>
		{:else}
			<p class="reset-lead">
				Enter the address you sign in with and we'll email you a link to set a new password.
			</p>

			<form onsubmit={submit} novalidate>
				{#if error}
					<p class="reset-error" role="alert">{error}</p>
				{/if}

				<label class="reset-label" for="reset-email">Email</label>
				<input
					id="reset-email"
					type="email"
					autocomplete="email"
					bind:value={email}
					placeholder="you@company.com"
					disabled={sending}
				/>

				<button class="reset-btn" type="submit" disabled={sending}>
					{sending ? 'Sending…' : 'Email me a reset link'}
				</button>
			</form>

			<p class="reset-hint">
				Remembered it? <a href="/login">Back to sign in</a>
			</p>
		{/if}
	</div>
</div>

<style>
	.reset {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		min-height: 100dvh;
		padding: var(--space-6);
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-body);
	}
	.reset-card {
		width: 100%;
		max-width: 26rem;
	}
	.reset-card h1 {
		margin: 0 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
		line-height: var(--leading-tight);
	}
	.reset-lead,
	.reset-sent {
		margin: 0 0 var(--space-5);
		font-size: var(--text-md);
		line-height: var(--leading-relaxed);
		color: var(--text-muted);
	}
	.reset-label {
		display: block;
		margin-bottom: var(--space-2);
		font-size: var(--text-base);
		font-weight: 600;
	}
	.reset-card input {
		width: 100%;
		margin-bottom: var(--space-4);
	}
	.reset-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 44px;
		padding: 0 var(--space-5);
		border: none;
		border-radius: var(--radius-full);
		background: var(--gradient-cta);
		color: #fff;
		font-size: var(--text-base);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
	.reset-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.reset-error {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		background: var(--error-soft, var(--surface-2));
		font-size: var(--text-base);
		color: var(--error-text);
	}
	.reset-hint {
		margin: var(--space-4) 0 0;
		font-size: var(--text-base);
		color: var(--text-dim);
	}
	.reset-hint a,
	.reset-sent a {
		color: var(--accent-text);
	}
</style>
