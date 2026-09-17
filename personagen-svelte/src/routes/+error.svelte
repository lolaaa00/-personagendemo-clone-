<script lang="ts">
	/**
	 * The app's error page.
	 *
	 * Without one, SvelteKit renders its built-in fallback: the status code and
	 * the message, as bare text, with no links, no navigation and no shell. A
	 * signed-in user who mistyped a URL or followed a stale bookmark was stranded
	 * with nothing to click — the only way back was editing the address bar.
	 *
	 * This gives every error a way out, and says something true about each of the
	 * cases people actually hit rather than printing a number at them.
	 */
	import { page } from '$app/stores';

	let status = $derived($page.status);
	let message = $derived($page.error?.message ?? '');

	/** What happened, in the user's terms — never the raw framework string. */
	let headline = $derived(
		status === 404
			? 'That page does not exist'
			: status === 403
				? 'You do not have access to that'
				: status === 401
					? 'You need to sign in first'
					: 'Something went wrong at our end'
	);

	let explanation = $derived(
		status === 404
			? 'The link may be out of date, or the thing it pointed at may have been deleted. Nothing is broken.'
			: status === 403
				? 'Your seat cannot open this page. A workspace admin can change that.'
				: status === 401
					? 'Your session ended. Signing in again will bring you back here.'
					: 'This is our fault, not yours. Trying again often works; if it does not, the details below help us find it.'
	);
</script>

<svelte:head>
	<title>{status} — PersonaGen</title>
</svelte:head>

<div class="err">
	<div class="err-card">
		<p class="err-status">{status}</p>
		<h1>{headline}</h1>
		<p class="err-body">{explanation}</p>

		{#if message && message !== headline}
			<p class="err-detail">{message}</p>
		{/if}

		<div class="err-actions">
			<a class="err-btn err-btn-primary" href="/dashboard">Back to dashboard</a>
			{#if status === 401}
				<a class="err-btn" href="/login">Sign in</a>
			{:else}
				<a class="err-btn" href="/guides">Open the guides</a>
			{/if}
		</div>
	</div>
</div>

<style>
	.err {
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
	.err-card {
		max-width: 32rem;
		text-align: center;
	}
	.err-status {
		margin: 0 0 var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-base);
		font-weight: 600;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
	}
	.err-card h1 {
		margin: 0 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--text-3xl);
		font-weight: 700;
		line-height: var(--leading-tight);
		letter-spacing: var(--tracking-tight);
	}
	.err-body {
		margin: 0;
		font-size: var(--text-md);
		line-height: var(--leading-relaxed);
		color: var(--text-muted);
	}
	.err-detail {
		margin: var(--space-4) 0 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text-dim);
		word-break: break-word;
	}
	.err-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		justify-content: center;
		margin-top: var(--space-6);
	}
	.err-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0 var(--space-5);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 600;
		text-decoration: none;
	}
	.err-btn:hover {
		border-color: var(--accent);
		color: var(--accent-text);
	}
	.err-btn-primary {
		background: var(--gradient-cta);
		border-color: transparent;
		color: #fff;
	}
	.err-btn-primary:hover {
		color: #fff;
	}
	.err-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
</style>
