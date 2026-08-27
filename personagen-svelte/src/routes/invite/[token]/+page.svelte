<script lang="ts">
	import { goto } from '$app/navigation';
	import { showToast, themeState } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
	let invite = $derived(data.invite);
	let viewerEmail = $derived(data.viewerEmail as string | null);
	let emailMatches = $derived(
		!!invite && !!viewerEmail && invite.email.toLowerCase() === viewerEmail.toLowerCase()
	);

	let busy = $state(false);

	async function respond(accept: boolean) {
		busy = true;
		try {
			const res = await fetch(`/api/workspaces/invites/${data.token}/${accept ? 'accept' : 'decline'}`, {
				method: 'POST'
			});
			const result = await res.json();
			if (!result.success) throw new Error(result.error || 'Something went wrong');

			if (accept) {
				showToast(`Joined ${result.workspace?.name ?? 'the workspace'}`, 'success');
				goto('/dashboard');
			} else {
				showToast('Invite declined', 'success');
				goto('/dashboard');
			}
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Workspace Invite — PersonaGen</title>
</svelte:head>

<div class="login-page">
	<div class="login-ambient" aria-hidden="true">
		<div class="login-orb login-orb-1"></div>
		<div class="login-orb login-orb-2"></div>
	</div>
	<div class="login-grid" aria-hidden="true"></div>

	<div class="login-container">
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
				{#if !invite}
					<h1>Invite not found</h1>
				{:else if invite.status !== 'pending'}
					<h1>Already {invite.status}</h1>
				{:else if invite.expired}
					<h1>Invite expired</h1>
				{:else}
					<h1>You've been invited</h1>
				{/if}
			{/snippet}
			{#snippet description()}
				{#if !invite}
					<p>This invite link is invalid or has already been used.</p>
				{:else if invite.status !== 'pending'}
					<p>This invite has already been {invite.status}.</p>
				{:else if invite.expired}
					<p>Ask whoever invited you to send a new one.</p>
				{:else}
					<p>
						Join <strong>{invite.workspaceName}</strong> as a <strong>{invite.role}</strong>.
					</p>
				{/if}
			{/snippet}

			{#if !invite || invite.status !== 'pending'}
				<a href="/dashboard" class="invite-link">Go to dashboard</a>
			{:else if !invite.expired}
				{#if !viewerEmail}
					<p class="invite-note">
						This invite is for <strong>{invite.email}</strong>. Log in or create an account with that
						address, then come back to this same link to accept.
					</p>
					<div class="invite-auth-links">
						<a href="/login">Log in</a>
						<a href="/signup">Sign up</a>
					</div>
				{:else if !emailMatches}
					<p class="invite-note error">
						This invite is for <strong>{invite.email}</strong> — you're logged in as
						<strong>{viewerEmail}</strong>. Log out and sign in as the invited address to accept.
					</p>
				{:else}
					<div class="invite-actions">
						<Button variant="primary" loading={busy} onclick={() => respond(true)}>
							Accept invite
						</Button>
						<Button variant="secondary" disabled={busy} onclick={() => respond(false)}>
							Decline
						</Button>
					</div>
				{/if}
			{/if}
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
	}
	.login-orb-2 {
		width: 500px;
		height: 500px;
		background: var(--cyan);
		opacity: 0.04;
		bottom: 0;
		right: -5%;
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
	.login-container {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-8);
		width: 100%;
		max-width: 440px;
		padding: var(--space-6);
	}
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
		box-shadow: 0 0 30px color-mix(in srgb, var(--accent) 35%, transparent);
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
	:global(.login-card) {
		width: 100% !important;
	}
	.invite-actions {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}
	.invite-note {
		font-size: var(--text-base);
		color: var(--text-muted);
		line-height: var(--leading-snug);
	}
	.invite-note.error {
		color: var(--error-text);
	}
	.invite-auth-links {
		display: flex;
		gap: var(--space-4);
		margin-top: var(--space-3);
	}
	.invite-auth-links a,
	.invite-link {
		color: var(--accent-text);
		font-weight: 600;
	}
</style>
