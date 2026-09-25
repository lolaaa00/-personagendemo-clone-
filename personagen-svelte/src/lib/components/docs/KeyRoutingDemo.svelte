<script lang="ts">
	import DocsDemo from './DocsDemo.svelte';

	/**
	 * "Which wallet pays for this generation?" — the rule the server applies,
	 * made clickable. It mirrors resolveBillingAccount() (credits.ts): the
	 * PERSONA decides, walking persona → workspace → OWNER. Whoever is sitting
	 * at the keyboard does not come into it.
	 *
	 * Rewritten 2026-09-22. It used to toggle customer-supplied provider keys,
	 * which no longer exist for generation — a key you bring is an identity
	 * (Zernio), never a cost. The scenario it teaches now is the one that
	 * actually confuses people: a member of a workspace generates all day and
	 * their own balance never moves, because it was never the balance in play.
	 */
	let inWorkspace = $state(true);

	const WORKSPACE = 'Acme Studio';
	/** Illustrative balances, in credits — 1 credit = 1 US cent. */
	const OWNER_CREDITS = 4820;
	const OWN_CREDITS = 2000;

	const money = (c: number) => `$${(c / 100).toFixed(2)}`;

	type Stage = { label: string; paid: boolean };
	const STAGES: Stage[] = [
		{ label: 'Director writes the line', paid: true },
		{ label: 'Quality gate scores it', paid: true },
		{ label: 'Still is generated', paid: true },
		{ label: 'Card is typeset on our servers', paid: false }
	];

	/** 'wallet' = the workspace owner's, 'you' = your own, 'none' = nothing runs. */
	function payer(s: Stage): 'you' | 'wallet' | 'none' {
		if (!s.paid) return 'none';
		return inWorkspace ? 'wallet' : 'you';
	}
	let payerText = $derived({
		wallet: `${WORKSPACE}'s wallet pays`,
		you: 'Your wallet pays',
		none: 'Nothing to pay'
	});
	let charged = $derived(inWorkspace ? OWNER_CREDITS : OWN_CREDITS);
</script>

<DocsDemo
	title="Which wallet pays for a generation?"
	hint="Move the persona — the rule is the one the server applies."
>
	<div class="kr">
		<div class="kr-controls">
			<label class="kr-toggle">
				<input type="checkbox" bind:checked={inWorkspace} />
				<span class="kr-switch" aria-hidden="true"></span>
				<span>
					<b>This persona belongs to a workspace</b>
					<small>Off means it is a persona of your own, outside any workspace</small>
				</span>
			</label>
			<div class="kr-wallet" aria-label="{WORKSPACE} wallet" data-active={inWorkspace}>
				<span class="kr-wallet-label">{WORKSPACE}</span>
				<span class="kr-wallet-amt">{money(OWNER_CREDITS)}</span>
			</div>
			<div class="kr-wallet" aria-label="Your wallet" data-active={!inWorkspace}>
				<span class="kr-wallet-label">Your wallet</span>
				<span class="kr-wallet-amt">{money(OWN_CREDITS)}</span>
			</div>
		</div>

		<ol class="kr-stages" aria-label="Stages of one generation and which wallet pays for each">
			{#each STAGES as s (s.label)}
				<li class="kr-stage" data-payer={payer(s)}>
					<span class="kr-stage-label">{s.label}</span>
					<span class="kr-stage-payer">{payerText[payer(s)]}</span>
				</li>
			{/each}
		</ol>

		<div class="kr-verdict" data-tone={inWorkspace ? 'wallet' : 'you'}>
			{#if inWorkspace}
				<b>The workspace owner pays.</b> Every paid stage debits {WORKSPACE}'s wallet —
				{money(charged)} — and your own balance is not touched. This is the case people
				report as "billing is broken": you generate, and the number you were watching
				never moves, because it was never the one in play.
			{:else}
				<b>You pay.</b> This persona sits outside any workspace, so the bill lands on your
				own wallet — {money(charged)}. Top it up at Billing.
			{/if}
		</div>
		<p class="kr-fine">
			Rule: the persona decides, not the person generating. The balance in the sidebar is
			always the one that will actually be charged, and it names the workspace when that
			wallet is not yours.
		</p>
	</div>
</DocsDemo>

<style>
	.kr {
		display: grid;
		gap: 0.8rem;
	}
	.kr-controls {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.6rem;
		align-items: stretch;
	}
	.kr-toggle {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		cursor: pointer;
		/* The app styles bare <label> as an uppercase eyebrow; this is a card, not a field label. */
		font-size: var(--text-base);
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: var(--text);
		line-height: var(--leading-snug);
	}
	.kr-toggle:has(input:checked) {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.kr-toggle input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.kr-toggle b {
		display: block;
	}
	.kr-toggle small {
		display: block;
		color: var(--text-dim);
		font-size: var(--text-xs);
		line-height: var(--leading-snug);
	}
	.kr-switch {
		flex: none;
		width: 32px;
		height: 18px;
		border-radius: 999px;
		background: var(--border-strong);
		position: relative;
		margin-top: 0.15rem;
		transition: background 0.15s;
	}
	.kr-switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s;
	}
	.kr-toggle input:checked + .kr-switch {
		background: var(--accent);
	}
	.kr-toggle input:checked + .kr-switch::after {
		transform: translateX(14px);
	}
	.kr-toggle input:focus-visible + .kr-switch {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.kr-wallet {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 0.1rem;
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--surface-2, var(--bg));
		min-width: 7rem;
	}
	.kr-wallet[data-active='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.kr-wallet-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.kr-wallet-amt {
		font-family: var(--font-mono);
		font-weight: 700;
	}
	.kr-stages {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.kr-stage {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0.65rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		border-left: 3px solid var(--border-strong);
		font-size: var(--text-base);
		transition: border-color 0.2s;
	}
	.kr-stage[data-payer='you'] {
		border-left-color: var(--warning);
	}
	.kr-stage[data-payer='wallet'] {
		border-left-color: var(--accent);
	}
	.kr-stage[data-payer='none'] {
		border-left-color: var(--success);
	}
	.kr-stage-payer {
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
	}
	.kr-stage[data-payer='you'] .kr-stage-payer {
		color: var(--warning-text);
	}
	.kr-stage[data-payer='wallet'] .kr-stage-payer {
		color: var(--accent-text);
	}
	.kr-stage[data-payer='none'] .kr-stage-payer {
		color: var(--success-text);
	}
	.kr-verdict {
		padding: 0.7rem 0.8rem;
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		line-height: var(--leading-normal);
		border: 1px solid transparent;
	}
	.kr-verdict[data-tone='you'] {
		background: var(--warning-soft);
		border-color: color-mix(in srgb, var(--warning) 35%, transparent);
	}
	.kr-verdict[data-tone='wallet'] {
		background: var(--accent-soft);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
	}
	.kr-verdict[data-tone='mixed'] {
		background: var(--info-soft);
		border-color: color-mix(in srgb, var(--info) 35%, transparent);
	}
	.kr-fine {
		margin: 0;
		color: var(--text-dim);
		font-size: var(--text-xs);
	}
	/* Container, not viewport: see DocsDemo .demo-body. */
	@container (max-width: 560px) {
		.kr-controls {
			grid-template-columns: 1fr;
		}
		.kr-stage-payer {
			white-space: normal;
		}
	}
</style>
