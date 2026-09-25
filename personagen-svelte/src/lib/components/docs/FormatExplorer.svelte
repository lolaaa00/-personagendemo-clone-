<script lang="ts">
	import DocsDemo from './DocsDemo.svelte';
	import { FORMAT_CATALOG, STEP_LABEL, STEP_PURPOSE, type StepKind } from '$lib/formats';
	import { priceOf } from "$lib/pricing";
	import { quote } from "$lib/stores/pricing.svelte";

	/**
	 * "What actually runs when I pick this format?" — answered from the same
	 * FORMAT_CATALOG the composer plans from, so the docs cannot drift from the
	 * product. Every stage is tagged with WHOSE KEY it bills, which is the
	 * question the money pill never answers: a "free" text card still makes two
	 * writing calls, and those go to the writing key.
	 */

	type Payer = 'writing' | 'media' | 'local';
	const PAYER: Record<StepKind, Payer> = {
		director: 'writing',
		grader: 'writing',
		still: 'media',
		card: 'local',
		tts: 'media',
		talkinghead: 'media',
		video: 'media',
		cine_stills: 'media',
		cine_video: 'media',
		motion: 'local',
		mux: 'local',
		v2v: 'media'
	};
	const PAYER_LABEL: Record<Payer, string> = {
		writing: 'Writing key (OpenRouter / Gemini)',
		media: 'Media key (Fal)',
		local: 'Our servers — nothing to pay'
	};

	/** Default-model estimate per stage. The composer's preview is the exact number. */
	function estimate(kind: StepKind): number {
		switch (kind) {
			case 'director':
			case 'grader':
				return priceOf('openrouter', 'llm');
			case 'still':
				return priceOf('fal', 'image', 'nano');
			case 'tts':
				return priceOf('fal', 'tts');
			case 'talkinghead':
				return priceOf('fal', 'talking_head');
			case 'video':
				return priceOf('fal', 'video', 'standard');
			case 'cine_stills':
				return priceOf('fal', 'image', 'nano') * 3;
			case 'cine_video':
				return priceOf('fal', 'video', 'pro');
			case 'v2v':
				return priceOf('fal', 'video', 'per source second') * 5;
			default:
				return 0;
		}
	}

	const formats = FORMAT_CATALOG.filter((f) => f.kind !== 'series');
	let picked = $state(formats.find((f) => f.id === 'motion-card')?.id ?? formats[0].id);
	let format = $derived(formats.find((f) => f.id === picked) ?? formats[0]);
	/** "My own words" — a card format whose line the user supplies skips the two writing stages. */
	let ownWords = $state(false);
	let isCard = $derived(format.steps.includes('card'));
	let rows = $derived(
		format.steps
			.filter((kind) => !(ownWords && isCard && (kind === 'director' || kind === 'grader')))
			.map((kind) => ({
				kind,
				label: STEP_LABEL[kind],
				purpose: STEP_PURPOSE[kind],
				payer: PAYER[kind],
				usd: estimate(kind)
			}))
	);
	let total = $derived(rows.reduce((s, r) => s + r.usd, 0));
	let payers = $derived([...new Set(rows.map((r) => r.payer))] as Payer[]);

	
</script>

<DocsDemo title="Pick a format, see what runs and who pays">
	<div class="fx">
		<div class="fx-picker" role="tablist" aria-label="Formats">
			{#each formats as f (f.id)}
				<button
					type="button"
					role="tab"
					class="fx-chip"
					class:active={f.id === picked}
					aria-selected={f.id === picked}
					onclick={() => (picked = f.id)}
				>
					<span class="fx-chip-kind">{f.kind === 'video' ? 'Video' : 'Image'}</span>
					{f.label}
				</button>
			{/each}
		</div>

		<p class="fx-note">{format.note}</p>

		{#if isCard}
			<label class="fx-own">
				<input type="checkbox" bind:checked={ownWords} />
				<span>
					<b>I bring the words</b> — my own quotes instead of the Director's line.
					{#if ownWords}The two writing stages are skipped, so nothing in this run bills any key.{/if}
				</span>
			</label>
		{/if}

		<ol class="fx-stages">
			{#each rows as r, i (r.kind)}
				<li class="fx-stage" data-payer={r.payer}>
					<span class="fx-n">{i + 1}</span>
					<span class="fx-stage-main">
						<span class="fx-stage-label">{r.label}</span>
						<span class="fx-stage-purpose">{r.purpose}</span>
					</span>
					<span class="fx-payer">{PAYER_LABEL[r.payer]}</span>
					<span class="fx-usd" class:free={r.usd === 0}>{quote(r.usd)}</span>
				</li>
			{/each}
		</ol>

		<div class="fx-total">
			<span>
				Bills
				{#each payers as p, i (p)}
					{i > 0 ? (i === payers.length - 1 ? ' and ' : ', ') : ' '}<b data-payer={p}
						>{p === 'local' ? 'nothing' : PAYER_LABEL[p].split(' (')[0].toLowerCase()}</b
					>
				{/each}
			</span>
			<span class="fx-total-usd">≈ {quote(total)} at default models</span>
		</div>
		<p class="fx-fine">
			Estimates at the default models — the composer's quote is the exact number for your
			Model Manager picks. "Our servers" stages never touch a provider key.
		</p>
	</div>
</DocsDemo>

<style>
	.fx {
		display: grid;
		gap: 0.75rem;
	}
	.fx-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.fx-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.fx-chip:hover {
		border-color: var(--border-hover);
	}
	.fx-chip.active {
		background: var(--accent-dark);
		border-color: var(--accent-dark);
		color: #fff;
	}
	.fx-chip-kind {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		opacity: 0.7;
	}
	.fx-note {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-base);
	}
	.fx-own {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--success-soft);
		cursor: pointer;
		/* The app styles bare <label> as an uppercase eyebrow; this is a sentence. */
		font-size: var(--text-sm);
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: var(--text);
		line-height: var(--leading-snug);
	}
	.fx-own input {
		margin-top: 0.15rem;
	}
	.fx-stages {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.fx-stage {
		display: grid;
		grid-template-columns: 1.6rem minmax(0, 1fr) auto auto; /* minmax(0): a 1fr track's floor is min-content, which pushed the row 4–15px past the figure at 1366 (round-9) */
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.65rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		border-left: 3px solid var(--border-strong);
		background: var(--surface);
		font-size: var(--text-base);
	}
	.fx-stage[data-payer='writing'] {
		border-left-color: var(--accent);
	}
	.fx-stage[data-payer='media'] {
		border-left-color: var(--cyan);
	}
	.fx-stage[data-payer='local'] {
		border-left-color: var(--success);
	}
	.fx-n {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: var(--text-xs);
		font-weight: 700;
		background: var(--surface-2, var(--bg));
		color: var(--text-dim);
	}
	.fx-stage-main {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}
	.fx-stage-label {
		font-weight: 700;
	}
	.fx-stage-purpose {
		color: var(--text-dim);
		font-size: var(--text-sm);
		line-height: var(--leading-snug);
	}
	.fx-payer {
		font-size: var(--text-xs);
		color: var(--text-dim);
		white-space: nowrap;
	}
	.fx-usd {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
	}
	.fx-usd.free {
		color: var(--success-text);
	}
	.fx-total {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		padding: 0.6rem 0.65rem;
		border-radius: var(--radius-sm);
		background: var(--accent-soft);
		font-size: var(--text-base);
	}
	.fx-total b[data-payer='writing'] {
		color: var(--accent-text);
	}
	.fx-total b[data-payer='media'] {
		color: var(--cyan-text);
	}
	.fx-total b[data-payer='local'] {
		color: var(--success-text);
	}
	.fx-total-usd {
		font-family: var(--font-mono);
		font-weight: 700;
		white-space: nowrap;
	}
	.fx-fine {
		margin: 0;
		color: var(--text-dim);
		font-size: var(--text-xs);
	}
	/* Container, not viewport: see DocsDemo .demo-body. */
	@container (max-width: 560px) {
		.fx-stage {
			grid-template-columns: 1.6rem minmax(0, 1fr) auto;
		}
		.fx-payer {
			grid-column: 2;
			white-space: normal;
		}
	}
</style>
