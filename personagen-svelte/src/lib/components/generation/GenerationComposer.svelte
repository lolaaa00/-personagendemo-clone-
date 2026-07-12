<script lang="ts">
	/**
	 * Confirm-before-generate composer.
	 *
	 * Nothing in here is guessed client-side. On open it calls the same endpoint it
	 * will eventually generate with, passing `preview: true` — the server resolves
	 * the REAL payload (actual prompt text, actual model id, actual reference
	 * images, actual cost) and hands it back. We render that as an editable form,
	 * and on confirm we POST the edited values to the same endpoint.
	 *
	 * That round-trip is the whole point: a form built from client-side assumptions
	 * drifts from what the server really sends the moment either side changes. This
	 * one cannot — the preview and the request are produced by one code path.
	 */
	import Modal from '$lib/components/ui/Modal.svelte';
	import type { ComposerSpec } from './types';

	interface Props {
		open: boolean;
		spec: ComposerSpec | null;
		onClose: () => void;
		/** Called with the FINAL body the user approved. Caller performs the POST. */
		onConfirm: (body: Record<string, unknown>) => void;
	}

	let { open, spec, onClose, onConfirm }: Props = $props();

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let preview = $state<any>(null);

	// Editable fields (populated from the server's resolved preview)
	let prompt = $state('');
	let topic = $state('');
	let scene = $state('');
	let media = $state('video');
	let provider = $state('auto');
	let platforms = $state<string[]>([]);
	let productId = $state('');
	let productPhotoUrl = $state('');
	let characterRefUrl = $state('');
	let scheduledDate = $state('');
	let scheduledTime = $state('');

	let isPromptKind = $derived(!!preview && typeof preview.prompt === 'string');
	let isPostKind = $derived(!!preview && Array.isArray(preview.steps));

	// The literal string the provider will receive. generateUgcImage prepends a
	// style prefix, so for those flows we show prefix + the (possibly edited)
	// prompt rather than pretending the textarea is the whole request.
	let finalPromptPreview = $derived.by(() => {
		if (!isPromptKind) return '';
		if (typeof preview.finalPrompt === 'string') {
			const prefix = preview.finalPrompt.slice(
				0,
				preview.finalPrompt.length - String(preview.prompt).length
			);
			return prefix + prompt;
		}
		return prompt;
	});

	async function loadPreview() {
		if (!spec) return;
		loading = true;
		loadError = null;
		preview = null;
		try {
			const res = await fetch(spec.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...(spec.baseBody ?? {}), preview: true })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || !data?.success) {
				loadError = data?.error || `Could not resolve the request (HTTP ${res.status}).`;
				return;
			}
			preview = data.preview;

			prompt = preview.prompt ?? '';
			topic = preview.topic ?? '';
			scene = preview.scene ?? '';
			media = preview.media ?? 'video';
			provider = preview.provider ?? 'auto';
			platforms = [...(preview.platforms ?? [])];
			productId = preview.product?.id ?? '';
			productPhotoUrl = preview.productPhotoUrl ?? '';
			characterRefUrl = preview.characterRefUrl ?? '';
			scheduledDate = preview.scheduledDate ?? '';
			scheduledTime = preview.scheduledTime ?? '';
		} catch (e) {
			loadError = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	// Re-resolve whenever the dialog opens for a new spec.
	$effect(() => {
		if (open && spec) loadPreview();
	});

	function togglePlatform(p: string) {
		platforms = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
	}

	function confirm() {
		const body: Record<string, unknown> = { ...(spec?.baseBody ?? {}) };
		if (isPromptKind) {
			body.prompt = prompt;
		}
		if (isPostKind) {
			body.topic = topic || undefined;
			body.media = media;
			body.provider = provider;
			body.platforms = platforms;
			body.product_id = productId || undefined;
			body.product_photo_url = productPhotoUrl || undefined;
			body.character_ref_url = characterRefUrl || undefined;
			body.scene = scene || undefined;
			body.scheduled_date = scheduledDate || undefined;
			body.scheduled_time = scheduledTime || undefined;
		}
		onConfirm(body);
	}

	const usd = (n: number) => `$${Number(n ?? 0).toFixed(3)}`;
</script>

<Modal
	{open}
	size="lg"
	title={spec?.title ?? 'Confirm generation'}
	subtitle={spec?.subtitle ?? 'Review and edit exactly what gets sent — nothing is spent until you approve.'}
	{onClose}
>
	{#if loading}
		<div class="composer-loading">
			<span class="spinner"></span> Resolving the exact request…
		</div>
	{:else if loadError}
		<div class="composer-error">
			<strong>Can't prepare this generation</strong>
			<p>{loadError}</p>
		</div>
	{:else if preview}
		{#if isPromptKind}
			<label class="fld">
				<span class="fld-label">Prompt sent to the model</span>
				<textarea bind:value={prompt} rows="6" spellcheck="false"></textarea>
			</label>

			{#if preview.finalPrompt}
				<details class="raw">
					<summary>Exact string the provider receives</summary>
					<pre>{finalPromptPreview}</pre>
					<p class="hint">
						The pipeline prepends a fixed style prefix — shown here so what you approve is
						literally what is sent.
					</p>
				</details>
			{/if}

			{#if preview.image_urls?.length}
				<div class="fld">
					<span class="fld-label">Reference images ({preview.image_urls.length})</span>
					<div class="refs">
						{#each preview.image_urls as url}
							<img src={url} alt="reference" />
						{/each}
					</div>
				</div>
			{/if}
		{/if}

		{#if isPostKind}
			<label class="fld">
				<span class="fld-label">Topic</span>
				<input bind:value={topic} placeholder="Leave blank to let the persona pick" />
			</label>

			<div class="row">
				<label class="fld">
					<span class="fld-label">Media</span>
					<select bind:value={media}>
						<option value="video">Video (b-roll)</option>
						<option value="image">Image only</option>
						<option value="cinematic">Cinematic (multi-shot)</option>
					</select>
				</label>
				<label class="fld">
					<span class="fld-label">Provider</span>
					<select bind:value={provider}>
						<option value="auto">Auto</option>
						<option value="fal">fal.ai</option>
						<option value="openrouter">OpenRouter</option>
					</select>
				</label>
			</div>

			{#if preview.connectedPlatforms?.length}
				<div class="fld">
					<span class="fld-label">Publish to</span>
					<div class="chips">
						{#each preview.connectedPlatforms as p}
							<button
								type="button"
								class="chip"
								class:on={platforms.includes(p)}
								onclick={() => togglePlatform(p)}>{p}</button
							>
						{/each}
					</div>
				</div>
			{:else}
				<p class="hint">No connected accounts — this will be saved as a draft.</p>
			{/if}

			<label class="fld">
				<span class="fld-label">Scene / visual prompt</span>
				<textarea bind:value={scene} rows="4" placeholder="Leave blank to let the Director write it"
				></textarea>
				<span class="hint">{preview.sceneNote}</span>
			</label>

			<div class="row">
				<label class="fld">
					<span class="fld-label">Product photo URL</span>
					<input bind:value={productPhotoUrl} placeholder="https://…" />
				</label>
				<label class="fld">
					<span class="fld-label">Character reference URL</span>
					<input bind:value={characterRefUrl} placeholder="https://…" />
				</label>
			</div>

			<div class="row">
				<label class="fld">
					<span class="fld-label">Schedule date (optional)</span>
					<input type="date" bind:value={scheduledDate} />
				</label>
				<label class="fld">
					<span class="fld-label">Schedule time (optional)</span>
					<input type="time" bind:value={scheduledTime} />
				</label>
			</div>

			<div class="steps">
				<span class="fld-label">Pipeline that will run</span>
				{#each preview.steps as s}
					<div class="step">
						<span class="step-name">{s.step}</span>
						<code>{s.model}</code>
						<span class="step-usd">{usd(s.usd)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="meta">
			{#if preview.model}<span>Model <code>{preview.model}</code></span>{/if}
			{#if preview.provider && isPromptKind}<span>via {preview.provider}</span>{/if}
			<span class="cost">Est. {usd(preview.estimatedCostUsd)}</span>
		</div>
	{/if}

	{#snippet footer()}
		<button class="btn-ghost" onclick={onClose}>Cancel</button>
		<button class="btn-primary" disabled={loading || !!loadError || !preview} onclick={confirm}>
			{spec?.confirmLabel ?? 'Approve & generate'}
		</button>
	{/snippet}
</Modal>

<style>
	.composer-loading {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 1.5rem 0;
		color: var(--muted, #6b7280);
	}
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--border, #e6e8f0);
		border-top-color: var(--accent, #7c6aed);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.composer-error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #991b1b;
		padding: 0.9rem;
		border-radius: 10px;
	}
	.composer-error p {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
	}
	.fld {
		display: block;
		margin-bottom: 0.9rem;
	}
	.fld-label {
		display: block;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--muted, #6b7280);
		margin-bottom: 0.35rem;
	}
	.fld input,
	.fld select,
	.fld textarea {
		width: 100%;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 10px;
		font: inherit;
		background: var(--surface, #fff);
		color: var(--text, #14172b);
	}
	.fld textarea {
		resize: vertical;
		line-height: 1.45;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 560px) {
		.row {
			grid-template-columns: 1fr;
		}
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		border: 1px solid var(--border, #e6e8f0);
		background: var(--surface, #fff);
		border-radius: 999px;
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
		cursor: pointer;
		text-transform: capitalize;
	}
	.chip.on {
		background: var(--accent, #7c6aed);
		border-color: var(--accent, #7c6aed);
		color: #fff;
	}
	.hint {
		display: block;
		margin-top: 0.3rem;
		font-size: 0.75rem;
		color: var(--muted, #6b7280);
	}
	.refs {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.refs img {
		width: 72px;
		height: 72px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid var(--border, #e6e8f0);
	}
	.raw {
		margin-bottom: 0.9rem;
	}
	.raw summary {
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--muted, #6b7280);
	}
	.raw pre {
		white-space: pre-wrap;
		word-break: break-word;
		background: var(--surface-2, #f7f8fb);
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 10px;
		padding: 0.7rem;
		font-size: 0.76rem;
		margin: 0.5rem 0 0;
	}
	.steps {
		margin-top: 0.5rem;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0;
		border-top: 1px dashed var(--border, #e6e8f0);
		font-size: 0.82rem;
	}
	.step-name {
		flex: 1;
	}
	.step-usd {
		font-variant-numeric: tabular-nums;
		color: var(--muted, #6b7280);
	}
	code {
		background: var(--surface-2, #f3f4f8);
		padding: 0.1rem 0.35rem;
		border-radius: 6px;
		font-size: 0.75rem;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border, #e6e8f0);
		font-size: 0.8rem;
		color: var(--muted, #6b7280);
	}
	.cost {
		margin-left: auto;
		font-weight: 700;
		color: var(--text, #14172b);
	}
	.btn-ghost,
	.btn-primary {
		border-radius: 10px;
		padding: 0.5rem 0.95rem;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.86rem;
	}
	.btn-ghost {
		background: transparent;
		border: 1px solid var(--border, #e6e8f0);
		color: var(--text, #14172b);
	}
	.btn-primary {
		background: var(--accent, #7c6aed);
		border: 1px solid var(--accent, #7c6aed);
		color: #fff;
	}
	.btn-primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
