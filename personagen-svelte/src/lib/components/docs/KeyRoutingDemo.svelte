<script lang="ts">
	import DocsDemo from './DocsDemo.svelte';

	/**
	 * "Which balance pays for this generation?" — the rule the server applies,
	 * made clickable. It mirrors resolveAiClient() / resolveImageKeys(): a key
	 * you saved ALWAYS wins over the platform key, and only platform-key runs
	 * debit the wallet (credits.ts debitForEvents skips key_source !== 'platform').
	 *
	 * The scenario that motivated this: a user saved their own OpenRouter key,
	 * that key ran dry, the run failed "out of credits" — while the sidebar
	 * showed a healthy wallet that was never going to be touched.
	 */
	let ownWriting = $state(true);
	let ownMedia = $state(false);
	let wallet = $state(3131);

	type Stage = { label: string; provider: 'writing' | 'media' | 'local' };
	const STAGES: Stage[] = [
		{ label: 'Director writes the line', provider: 'writing' },
		{ label: 'Quality gate scores it', provider: 'writing' },
		{ label: 'Still is generated', provider: 'media' },
		{ label: 'Card is typeset on our servers', provider: 'local' }
	];

	function payer(s: Stage): 'you' | 'wallet' | 'none' {
		if (s.provider === 'local') return 'none';
		if (s.provider === 'writing') return ownWriting ? 'you' : 'wallet';
		return ownMedia ? 'you' : 'wallet';
	}
	const PAYER_TEXT = {
		you: 'Your own key pays',
		wallet: 'Wallet credits pay',
		none: 'Nothing to pay'
	} as const;

	let anyWallet = $derived(STAGES.some((s) => payer(s) === 'wallet'));
	let anyYou = $derived(STAGES.some((s) => payer(s) === 'you'));
</script>

<DocsDemo title="Who pays for a generation?" hint="Toggle the keys — the rule is the one the server applies.">
	<div class="kr">
		<div class="kr-controls">
			<label class="kr-toggle">
				<input type="checkbox" bind:checked={ownWriting} />
				<span class="kr-switch" aria-hidden="true"></span>
				<span>
					<b>Writing key saved</b>
					<small>Your own OpenRouter or Gemini key in Settings → Provider API Keys</small>
				</span>
			</label>
			<label class="kr-toggle">
				<input type="checkbox" bind:checked={ownMedia} />
				<span class="kr-switch" aria-hidden="true"></span>
				<span>
					<b>Media key saved</b>
					<small>Your own Fal key for images, video and voice</small>
				</span>
			</label>
			<div class="kr-wallet" aria-label="Example wallet">
				<span class="kr-wallet-label">Credits</span>
				<span class="kr-wallet-amt">₱{wallet.toLocaleString('en-PH')}</span>
			</div>
		</div>

		<ol class="kr-stages" aria-label="Stages of one generation and who pays for each">
			{#each STAGES as s (s.label)}
				{@const p = payer(s)}
				<li class="kr-stage" data-payer={p}>
					<span class="kr-stage-label">{s.label}</span>
					<span class="kr-stage-payer">{PAYER_TEXT[p]}</span>
				</li>
			{/each}
		</ol>

		<div class="kr-verdict" data-tone={anyWallet && anyYou ? 'mixed' : anyYou ? 'you' : 'wallet'}>
			{#if anyYou && !anyWallet}
				<b>Your wallet is not touched.</b> Every paid stage runs on keys you saved, so the
				bill lands on <em>those</em> accounts — the ₱{wallet.toLocaleString('en-PH')} stays
				exactly where it is. If one of your keys runs out, the run fails with "out of
				credits" even though the wallet looks full.
			{:else if anyYou && anyWallet}
				<b>Split bill.</b> Stages on your saved key go to that account; the rest debit the
				wallet. "Out of credits" can mean either side ran dry — the message names the
				key.
			{:else}
				<b>The wallet pays.</b> With no keys of your own saved, every paid stage runs on
				the platform keys and debits your credits. Top up at Billing when it runs low.
			{/if}
		</div>
		<p class="kr-fine">
			Rule: a key you save always wins over ours, per provider. Delete the key to switch
			that provider back to the wallet.
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
		grid-template-columns: 1fr 1fr auto;
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
	@media (max-width: 640px) {
		.kr-controls {
			grid-template-columns: 1fr;
		}
	}
</style>
