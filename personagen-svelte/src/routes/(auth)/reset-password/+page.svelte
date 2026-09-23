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
	import { tick } from 'svelte';

	let sending = $state(false);
	let sent = $state(false);
	let error = $state('');
	let emailEl = $state<HTMLInputElement | null>(null);
	let sentEl = $state<HTMLElement | null>(null);
	let helpState = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');
	let helpMessage = $state('');
	let helpEl = $state<HTMLElement | null>(null);
	async function askForHelp() {
		helpState = 'sending';
		try {
			const res = await fetch('/api/support/sign-in-help', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: email.trim() })
			});
			const d = await res.json().catch(() => ({}));
			helpMessage = d?.message || d?.error || 'Request sent.';
			helpState = res.ok ? 'sent' : 'error';
		} catch {
			helpMessage = 'Could not reach the server. Check your connection and try again.';
			helpState = 'error';
		}
		// The button that was pressed is gone; focus the answer, or focus falls
		// to <body> and a screen reader hears nothing (round-4 re-audit).
		await tick();
		helpEl?.focus();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (!email.trim()) {
			error = 'Enter the email address you sign in with.';
			emailEl?.focus();
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
			// Focus follows the page's answer, not <body> (re-audit).
			await tick();
			sentEl?.focus();
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
			<p class="reset-sent" role="status" tabindex="-1" bind:this={sentEl}>
				If that address has an account, we have asked our mail service to send a reset link — but
				email is not reaching every inbox from this server right now. If it arrives, open it on this device and
				you'll be asked to choose a new password straight away.
			</p>
			<p class="reset-hint">
				Nothing after a few minutes? Check spam first. If it still hasn't come, trying again won't
				help — ask us instead. We check it is really you, then set you a temporary password that
				you replace the first time you sign in.
			</p>
			{#if helpState === 'sent' || helpState === 'error'}
				<p class="reset-sent" role="status" tabindex="-1" bind:this={helpEl}>{helpMessage}</p>
			{/if}
			{#if helpState !== 'sent'}
				<button class="reset-btn reset-btn-secondary" type="button" onclick={askForHelp} disabled={helpState === 'sending'}>
					{helpState === 'sending' ? 'Sending…' : 'Ask us to help you sign in'}
				</button>
			{/if}
			<a class="reset-btn" href="/login">Back to sign in</a>
		{:else}
			<p class="reset-lead">
				Enter the address you sign in with and we'll email you a link to set a new password.
			</p>

			<form onsubmit={submit} novalidate>
				{#if error}
					<p class="reset-error" id="reset-error" role="alert">{error}</p>
				{/if}

				<label class="reset-label" for="reset-email">Email</label>
				<input
					id="reset-email"
					bind:this={emailEl}
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? 'reset-error' : undefined}
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
	.reset-btn-secondary {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border-strong);
		margin-bottom: 0.75rem;
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
