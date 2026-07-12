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
	import { TIER_LABEL, type ModelOption } from '$lib/models';

	interface Props {
		open: boolean;
		spec: ComposerSpec | null;
		onClose: () => void;
		/** Called with the FINAL body the user approved. Caller performs the POST. */
		onConfirm: (body: Record<string, unknown>) => void;
		/** Optional: jump to the Connections tab from the no-connection notice. */
		onGoToConnections?: () => void;
	}

	let { open, spec, onClose, onConfirm, onGoToConnections }: Props = $props();

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let preview = $state<any>(null);

	// Editable fields (populated from the server's resolved preview)
	let prompt = $state('');
	let topic = $state('');
	let scene = $state('');
	let media = $state('video');
	let provider = $state('auto');
	// Burn the on-screen caption hook onto the video. OFF by default — captions are
	// never generated without this explicit opt-in.
	let captions = $state(false);
	// Burn a small "AI GENERATED" disclosure badge. Independent of captions, OFF by default.
	let aiBadge = $state(false);
	let platforms = $state<string[]>([]);
	let productId = $state('');
	let productPhotoUrl = $state('');
	let characterRefUrl = $state('');
	let scheduledDate = $state('');
	let scheduledTime = $state('');
	// Budget-vs-quality: the model is a first-class, user-owned decision.
	let model = $state('');
	let videoModel = $state('');

	let isPromptKind = $derived(!!preview && typeof preview.prompt === 'string');
	let isPostKind = $derived(!!preview && Array.isArray(preview.steps));

	let modelOptions = $derived<ModelOption[]>(preview?.modelOptions ?? []);
	let selectedModel = $derived(modelOptions.find((m) => m.id === model) ?? null);

	// Re-price live as the user trades quality for budget, instead of showing the
	// cost of whatever the server happened to default to.
	let liveCost = $derived(
		selectedModel ? selectedModel.usd : (preview?.estimatedCostUsd ?? 0)
	);

	let videoModelOptions = $derived<ModelOption[]>(preview?.videoModelOptions ?? []);
	let selectedVideoModel = $derived(videoModelOptions.find((m) => m.id === videoModel) ?? null);

	// Re-price the whole pipeline as the user swaps the clip tier — the video is the
	// dominant line item, so a static total would misrepresent the decision.
	let livePostTotal = $derived.by(() => {
		if (!isPostKind) return 0;
		const steps = preview.steps ?? [];
		return steps.reduce((sum: number, st: any) => {
			const isVideoStep = String(st.step).includes('b-roll');
			if (isVideoStep && selectedVideoModel) return sum + selectedVideoModel.usd;
			return sum + (st.usd ?? 0);
		}, 0);
	});

	// This step feeds two references; a single-ref model silently drops one.
	let refWarning = $derived(
		preview?.multiRefNeeded && selectedModel && selectedModel.multiRef === false
			? selectedModel.caveat
			: null
	);
	// A post with no connected account can only be a draft — reflect that on the
	// confirm button so the outcome isn't a surprise.
	let hasConnections = $derived(!!preview?.connectedPlatforms?.length);

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
			captions = preview.captions === true;
			aiBadge = preview.aiBadge === true;
			provider = preview.provider ?? 'auto';
			platforms = [...(preview.platforms ?? [])];
			productId = preview.product?.id ?? '';
			productPhotoUrl = preview.productPhotoUrl ?? '';
			characterRefUrl = preview.characterRefUrl ?? '';
			scheduledDate = preview.scheduledDate ?? '';
			scheduledTime = preview.scheduledTime ?? '';
			model = preview.model ?? '';
			videoModel = preview.videoModel ?? '';
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
		if (model) body.model = model;
		if (videoModel) body.video_model = videoModel;
		if (isPostKind) {
			body.topic = topic || undefined;
			body.media = media;
			body.provider = provider;
			body.captions = captions;
			body.ai_badge = aiBadge;
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

	/** Hide a URL preview thumbnail if the image fails to load (bad/edited URL). */
	function hideOnError(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}
	/** Re-show once a (possibly edited) URL loads successfully. */
	function showImg(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'block';
	}
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
		{#if modelOptions.length}
			<div class="fld">
				<span class="fld-label">Model — pick your budget vs quality</span>
				<div class="models">
					{#each modelOptions as m}
						<button
							type="button"
							class="model"
							class:on={model === m.id}
							onclick={() => (model = m.id)}
						>
							<span class="model-top">
								<span class="model-name">{m.label}</span>
								<span class="model-usd">{usd(m.usd)}</span>
							</span>
							<span class="model-tier tier-{m.tier}">{TIER_LABEL[m.tier]}</span>
							<span class="model-note">{m.note}</span>
						</button>
					{/each}
				</div>
				{#if refWarning}
					<p class="model-warn">⚠ {refWarning}</p>
				{/if}
			</div>
		{/if}

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

			{#if media !== 'image'}
				<label class="captions-toggle">
					<input type="checkbox" bind:checked={captions} />
					<span class="captions-copy">
						<strong>Burn on-screen captions</strong>
						<span class="hint">
							Off by default — the video stays clean. When on, a short hook caption is burned
							onto the clip.
						</span>
					</span>
				</label>
				<label class="captions-toggle">
					<input type="checkbox" bind:checked={aiBadge} />
					<span class="captions-copy">
						<strong>“AI GENERATED” disclosure badge</strong>
						<span class="hint">
							Off by default. When on, a small badge is burned top-left. Independent of captions.
						</span>
					</span>
				</label>
			{/if}

			{#if preview.connectedPlatforms?.length}
				<div class="fld">
					<span class="fld-label">Publish to (connected accounts only)</span>
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
					<span class="hint">
						Only connected platforms are shown — a post only publishes where an account is connected.
					</span>
				</div>
			{:else}
				<!-- No connected account: a post can't be scheduled to publish. It can
				     still be saved as a draft and posted later once a platform connects. -->
				<div class="no-conn">
					<strong>⚠ No connected account</strong>
					<p>
						This post can't be scheduled to publish — there's nowhere to send it yet. Connect a
						platform first, then it can go out. You can still save it as a draft below.
					</p>
					{#if onGoToConnections}
						<button type="button" class="no-conn-cta" onclick={onGoToConnections}>
							Go to Connections →
						</button>
					{/if}
				</div>
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
					{#if productPhotoUrl}
						<img class="url-preview" src={productPhotoUrl} alt="Product preview" onload={showImg} onerror={hideOnError} />
					{/if}
				</label>
				<label class="fld">
					<span class="fld-label">Character reference URL</span>
					<input bind:value={characterRefUrl} placeholder="https://…" />
					{#if characterRefUrl}
						<img class="url-preview" src={characterRefUrl} alt="Character reference preview" onload={showImg} onerror={hideOnError} />
					{:else}
						<!-- Blank ≠ no face. The server sends the persona's PINNED face (or
						     generates one on the fly) so the character stays consistent. -->
						<span class="hint char-auto">
							Blank uses the persona's pinned face — a consistent face is still sent (generated
							automatically the first time). Paste a URL only to override it for this post.
						</span>
					{/if}
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

			{#if videoModelOptions.length}
				<div class="fld">
					<span class="fld-label">Video model — the biggest cost in this run</span>
					<div class="models">
						{#each videoModelOptions as m}
							<button
								type="button"
								class="model"
								class:on={videoModel === m.id}
								onclick={() => (videoModel = m.id)}
							>
								<span class="model-top">
									<span class="model-name">{m.label}</span>
									<span class="model-usd">{usd(m.usd)}</span>
								</span>
								<span class="model-tier tier-{m.tier}">{TIER_LABEL[m.tier]}</span>
								<span class="model-note">{m.note}</span>
							</button>
						{/each}
					</div>
					{#if selectedVideoModel}
						<!-- Params adjust to the picked model: what it actually supports. -->
						<div class="model-params">
							<span class="param" class:param-off={!selectedVideoModel.supportsAudio}>
								{selectedVideoModel.supportsAudio ? '🔊 Audio track' : '🔇 Silent — no audio'}
							</span>
							{#if selectedVideoModel.supportsDuration}
								<span class="param">⏱ Custom duration</span>
							{:else}
								<span class="param param-off">⏱ Fixed 5s</span>
							{/if}
							{#if selectedVideoModel.caveat}
								<span class="param param-warn">⚠ {selectedVideoModel.caveat}</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<div class="steps">
				<span class="fld-label">Pipeline that will run</span>
				{#each preview.steps as s}
					{@const isVid = String(s.step).includes('b-roll') && selectedVideoModel}
					<div class="step">
						<span class="step-name">{s.step}</span>
						<code>{isVid ? selectedVideoModel?.label : s.model}</code>
						<span class="step-usd">{usd(isVid ? selectedVideoModel!.usd : s.usd)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="meta">
			{#if preview.model}<span>Model <code>{preview.model}</code></span>{/if}
			{#if preview.provider && isPromptKind}<span>via {preview.provider}</span>{/if}
			<span class="cost">Est. {usd(isPostKind ? livePostTotal : liveCost)}</span>
		</div>
	{/if}

	{#snippet footer()}
		<button class="btn-ghost" onclick={onClose}>Cancel</button>
		<button class="btn-primary" disabled={loading || !!loadError || !preview} onclick={confirm}>
			{#if isPostKind && !hasConnections}
				Save as draft
			{:else}
				{spec?.confirmLabel ?? 'Approve & generate'}
			{/if}
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
	.captions-toggle {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		margin-bottom: 0.9rem;
		cursor: pointer;
	}
	.captions-toggle input {
		margin-top: 0.15rem;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	.captions-copy strong {
		font-size: 0.82rem;
		color: var(--text, #14172b);
	}
	.captions-copy .hint {
		margin-top: 0.15rem;
	}
	.no-conn {
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 10px;
		padding: 0.8rem 0.9rem;
		margin-bottom: 0.9rem;
	}
	.no-conn strong {
		color: #92400e;
		font-size: 0.85rem;
	}
	.no-conn p {
		margin: 0.35rem 0 0.6rem;
		font-size: 0.8rem;
		color: var(--muted, #6b7280);
	}
	.no-conn-cta {
		background: #f59e0b;
		border: 1px solid #f59e0b;
		color: #fff;
		border-radius: 8px;
		padding: 0.4rem 0.8rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.no-conn-cta:hover {
		background: #d97706;
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

	.models {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.5rem;
	}
	.model {
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border, #e6e8f0);
		border-radius: 10px;
		background: var(--surface, #fff);
		cursor: pointer;
	}
	.model.on {
		border-color: var(--accent, #7c6aed);
		box-shadow: 0 0 0 2px rgba(124, 106, 237, 0.16);
	}
	.model-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.model-name {
		font-weight: 700;
		font-size: 0.84rem;
	}
	.model-usd {
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		color: var(--text, #14172b);
	}
	.model-tier {
		align-self: flex-start;
		font-size: 0.64rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.1rem 0.35rem;
		border-radius: 999px;
	}
	.tier-budget {
		background: #ecfdf5;
		color: #047857;
	}
	.tier-balanced {
		background: #eff6ff;
		color: #1d4ed8;
	}
	.tier-premium {
		background: #faf5ff;
		color: #7e22ce;
	}
	.model-note {
		font-size: 0.72rem;
		color: var(--muted, #6b7280);
		line-height: 1.35;
	}
	.model-warn {
		margin: 0.5rem 0 0;
		font-size: 0.74rem;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
	}
	/* Inline preview thumbnails under the Product / Character URL inputs. */
	.url-preview {
		margin-top: 0.4rem;
		width: 84px;
		height: 84px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid var(--border, #e6e8f0);
		display: block;
	}
	.char-auto {
		color: var(--muted, #6b7280);
		line-height: 1.4;
	}
	/* Capabilities of the selected video model — the params that actually apply. */
	.model-params {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}
	.param {
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2, #f3f4f8);
		border: 1px solid var(--border, #e6e8f0);
		color: var(--text, #14172b);
	}
	.param-off {
		opacity: 0.6;
	}
	.param-warn {
		color: #92400e;
		background: #fffbeb;
		border-color: #fde68a;
	}
</style>
