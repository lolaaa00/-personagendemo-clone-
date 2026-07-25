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
		/**
		 * Optional persona switcher (multi-persona surfaces like the calendar).
		 * The parent rebuilds `spec` on change and the preview re-resolves for the
		 * new persona — face, voice, connected platforms, and costs are all
		 * persona-specific, so nothing here is patched client-side.
		 */
		agents?: Array<{ id: string; name: string }>;
		agentId?: string;
		onAgentChange?: (id: string) => void;
	}

	let { open, spec, onClose, onConfirm, onGoToConnections, agents, agentId, onAgentChange }: Props =
		$props();

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
	// The persona's brand-kit products, resolved server-side from the brand brief
	// selected in its Profile. Drives the product picker below; empty when the
	// persona has no brief selected (then the URL field is the only route).
	let products = $state<Array<{ id: string; name: string; photoUrl: string | null }>>([]);
	let characterRefUrl = $state('');
	let scheduledDate = $state('');
	let scheduledTime = $state('');
	// Budget-vs-quality: the model is a first-class, user-owned decision.
	let model = $state('');
	let videoModel = $state('');
	// Video format for this run: 'spokesperson' (voiceover + talking-head/OmniHuman),
	// 'broll' (the picked i2v clip), or 'auto' (Director decides, biased to spokesperson).
	let format = $state('auto');

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

	// The pipeline actually shown/priced, driven by the format selector. A video forks
	// between the spokesperson and b-roll step arrays the server resolved; non-video
	// (image/cinematic) has a single stack. 'auto' shows the spokesperson default.
	let activeSteps = $derived.by(() => {
		if (!isPostKind) return [] as any[];
		if (media !== 'video') return (preview.steps ?? []) as any[];
		if (format === 'broll') return (preview.stepsBroll ?? preview.steps ?? []) as any[];
		return (preview.stepsSpokesperson ?? preview.steps ?? []) as any[];
	});

	// Re-price the whole pipeline as the user swaps format or clip tier — the video is
	// the dominant line item, so a static total would misrepresent the decision.
	let livePostTotal = $derived.by(() => {
		if (!isPostKind) return 0;
		return activeSteps.reduce((sum: number, st: any) => {
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

	// Guards against out-of-order responses when the user switches personas
	// while a resolve is still in flight — only the latest request may land.
	let previewToken = 0;
	// The resolve hits real generation endpoints behind a reverse proxy — it can
	// hang indefinitely. Abort covers three exits: superseded by a newer resolve,
	// dialog closed, or the 30s timeout (which surfaces as a Retry-able error).
	let previewAbort: AbortController | null = null;
	const PREVIEW_TIMEOUT_MS = 30_000;

	async function loadPreview() {
		if (!spec) return;
		const token = ++previewToken;
		previewAbort?.abort();
		const ctrl = new AbortController();
		previewAbort = ctrl;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			ctrl.abort();
		}, PREVIEW_TIMEOUT_MS);
		loading = true;
		loadError = null;
		preview = null;
		try {
			const res = await fetch(spec.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...(spec.baseBody ?? {}), preview: true }),
				signal: ctrl.signal
			});
			const data = await res.json().catch(() => ({}));
			if (token !== previewToken) return; // superseded by a newer resolve
			if (!res.ok || !data?.success) {
				loadError = data?.error || `Could not resolve the request (HTTP ${res.status}).`;
				return;
			}
			preview = data.preview;

			prompt = preview.prompt ?? '';
			topic = preview.topic ?? '';
			scene = preview.scene ?? '';
			media = preview.media ?? 'video';
			format = preview.format ?? 'auto';
			captions = preview.captions === true;
			aiBadge = preview.aiBadge === true;
			provider = preview.provider ?? 'auto';
			platforms = [...(preview.platforms ?? [])];
			productId = preview.product?.id ?? '';
			products = Array.isArray(preview.products) ? preview.products : [];
			productPhotoUrl = preview.productPhotoUrl ?? '';
			characterRefUrl = preview.characterRefUrl ?? '';
			scheduledDate = preview.scheduledDate ?? '';
			scheduledTime = preview.scheduledTime ?? '';
			model = preview.model ?? '';
			videoModel = preview.videoModel ?? '';
		} catch (e) {
			// A stale token means the abort was ours (superseded/closed) — silent.
			// A timeout on the CURRENT request must say so, with Retry available.
			if (token === previewToken) {
				loadError = timedOut
					? 'Timed out resolving the request (30s) — the server may be busy. Try again.'
					: (e as Error).message;
			}
		} finally {
			clearTimeout(timer);
			if (token === previewToken) loading = false;
		}
	}

	// Re-resolve whenever the dialog opens for a new spec.
	$effect(() => {
		if (open && spec) loadPreview();
	});

	// Cancel-on-close: a resolve for a dismissed dialog must stop spending the
	// request AND must not land later (bumping the token makes any late abort or
	// response fall into the stale-token branches above).
	$effect(() => {
		if (!open) {
			previewToken++;
			previewAbort?.abort();
			previewAbort = null;
		}
	});

	function togglePlatform(p: string) {
		platforms = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
	}

	// Picking a brand-kit product pins its id (the server resolves the photo from
	// it) and mirrors its photo into the URL field so the thumbnail updates and
	// stays editable. "Custom / none" clears the id and leaves the URL for manual
	// entry — the raw-URL route is never removed.
	function onProductPick(e: Event) {
		const id = (e.currentTarget as HTMLSelectElement).value;
		productId = id;
		const picked = products.find((x) => x.id === id);
		if (picked?.photoUrl) productPhotoUrl = picked.photoUrl;
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
			body.format = format;
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
	{#if agents?.length && onAgentChange}
		<!-- Persona switcher — kept OUTSIDE the loading/error gate so a persona
		     whose preview fails (e.g. no connected account) can be swapped for
		     another without closing the composer. -->
		<div class="fld persona-fld">
			<label class="fld-label" for="gc-persona">Persona</label>
			<select
				id="gc-persona"
				aria-describedby="gc-persona-hint"
				value={agentId}
				onchange={(e) => onAgentChange((e.currentTarget as HTMLSelectElement).value)}
			>
				{#each agents as a}
					<option value={a.id}>{a.name}</option>
				{/each}
			</select>
			<span class="hint" id="gc-persona-hint">
				Switching re-resolves everything below for that persona — face, voice, connected
				platforms, and cost are all persona-specific.
			</span>
		</div>
	{/if}

	{#if loading}
		<div class="composer-loading" role="status" aria-live="polite">
			<span class="spinner" aria-hidden="true"></span> Resolving the exact request…
		</div>
	{:else if loadError}
		<div class="composer-error" role="alert">
			<strong>Can't prepare this generation</strong>
			<p>{loadError}</p>
			<button type="button" class="btn-retry" onclick={() => loadPreview()}>Retry</button>
		</div>
	{:else if preview}
		{#if modelOptions.length}
			<div class="fld">
				<span class="fld-label" id="gc-model-label">Model — pick your budget vs quality</span>
				<div
					class="models"
					role="radiogroup"
					aria-labelledby="gc-model-label"
					aria-invalid={!!refWarning}
					aria-describedby={refWarning ? 'gc-model-warn' : undefined}
				>
					{#each modelOptions as m}
						<button
							type="button"
							class="model"
							class:on={model === m.id}
							role="radio"
							aria-checked={model === m.id}
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
					<p class="model-warn" id="gc-model-warn" role="alert">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
						<span>{refWarning}</span>
					</p>
				{/if}
			</div>
		{/if}

		{#if isPromptKind}
			<div class="fld">
				<label class="fld-label" for="gc-prompt">Prompt sent to the model</label>
				<textarea id="gc-prompt" bind:value={prompt} rows="6" spellcheck="false"></textarea>
			</div>

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
						{#each preview.image_urls as url, i}
							<img
								src={url}
								alt="Reference image {i + 1} of {preview.image_urls.length}"
								width="72"
								height="72"
								loading="lazy"
							/>
						{/each}
					</div>
				</div>
			{/if}
		{/if}

		{#if isPostKind}
			<div class="fld">
				<label class="fld-label" for="gc-topic">Topic</label>
				<input id="gc-topic" bind:value={topic} placeholder="Leave blank to let the persona pick" />
			</div>

			<div class="row">
				<div class="fld">
					<label class="fld-label" for="gc-media">Media</label>
					<select id="gc-media" bind:value={media}>
						<option value="video">Video (b-roll)</option>
						<option value="image">Image only</option>
						<option value="cinematic">Cinematic (multi-shot)</option>
					</select>
				</div>
				<div class="fld">
					<label class="fld-label" for="gc-provider">Provider</label>
					<select id="gc-provider" bind:value={provider}>
						<option value="auto">Auto</option>
						<option value="fal">fal.ai</option>
						<option value="openrouter">OpenRouter</option>
					</select>
				</div>
			</div>

			{#if media !== 'image'}
				<label class="captions-toggle">
					<!-- The 16px control keeps its size; .cb-hit gives it a 44×44 target. -->
					<span class="cb-hit">
						<input type="checkbox" bind:checked={captions} aria-describedby="gc-captions-hint" />
					</span>
					<span class="captions-copy">
						<strong>Burn on-screen captions</strong>
						<span class="hint" id="gc-captions-hint">
							Off by default — the video stays clean. When on, a short hook caption is burned
							onto the clip.
						</span>
					</span>
				</label>
				<label class="captions-toggle">
					<span class="cb-hit">
						<input type="checkbox" bind:checked={aiBadge} aria-describedby="gc-aibadge-hint" />
					</span>
					<span class="captions-copy">
						<strong>“AI GENERATED” disclosure badge</strong>
						<span class="hint" id="gc-aibadge-hint">
							Off by default. When on, a small badge is burned top-left. Independent of captions.
						</span>
					</span>
				</label>
			{/if}

			{#if preview.connectedPlatforms?.length}
				<div class="fld">
					<span class="fld-label" id="gc-platforms-label">Publish to (connected accounts only)</span>
					<div
						class="chips"
						role="group"
						aria-labelledby="gc-platforms-label"
						aria-describedby="gc-platforms-hint"
					>
						{#each preview.connectedPlatforms as p}
							<button
								type="button"
								class="chip"
								class:on={platforms.includes(p)}
								aria-pressed={platforms.includes(p)}
								onclick={() => togglePlatform(p)}>{p}</button
							>
						{/each}
					</div>
					<span class="hint" id="gc-platforms-hint">
						Only connected platforms are shown — a post only publishes where an account is connected.
					</span>
				</div>
			{:else}
				<!-- No connected account: a post can't be scheduled to publish. It can
				     still be saved as a draft and posted later once a platform connects. -->
				<div class="no-conn" role="alert">
					<strong>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
						<span>No connected account</span>
					</strong>
					<p>
						This post can't be scheduled to publish — there's nowhere to send it yet. Connect a
						platform first, then it can go out. You can still save it as a draft below.
					</p>
					{#if onGoToConnections}
						<button type="button" class="no-conn-cta" onclick={onGoToConnections}>
							Go to Connections
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
						</button>
					{/if}
				</div>
			{/if}

			<div class="fld">
				<label class="fld-label" for="gc-scene">Scene / visual prompt</label>
				<textarea
					id="gc-scene"
					aria-describedby="gc-scene-hint"
					bind:value={scene}
					rows="4"
					placeholder="Leave blank to let the Director write it"
				></textarea>
				<span class="hint" id="gc-scene-hint">{preview.sceneNote}</span>
			</div>

			{#if products.length}
				<div class="fld">
					<label class="fld-label" for="gc-product">Product</label>
					<select
						id="gc-product"
						aria-describedby="gc-product-hint"
						value={productId}
						onchange={onProductPick}
					>
						<option value="">Custom / none — use the URL below</option>
						{#each products as p}
							<option value={p.id}>{p.name}{p.photoUrl ? '' : ' (no photo)'}</option>
						{/each}
					</select>
					<span class="hint" id="gc-product-hint">
						Pick a product from this persona's brand kit — its photo fills the URL below. Products
						come from the brand brief selected in the persona's <strong>Profile</strong>.
					</span>
				</div>
			{/if}

			<div class="row">
				<div class="fld">
					<label class="fld-label" for="gc-product-url"
						>Product photo URL{products.length ? ' (override)' : ''}</label
					>
					<input id="gc-product-url" inputmode="url" bind:value={productPhotoUrl} placeholder="https://…" />
					{#if productPhotoUrl}
						<img class="url-preview" src={productPhotoUrl} alt="Product preview" width="84" height="84" loading="lazy" onload={showImg} onerror={hideOnError} />
					{/if}
				</div>
				<div class="fld">
					<label class="fld-label" for="gc-character-url">Character reference URL</label>
					<input
						id="gc-character-url"
						inputmode="url"
						aria-describedby={characterRefUrl ? undefined : 'gc-character-hint'}
						bind:value={characterRefUrl}
						placeholder="https://…"
					/>
					{#if characterRefUrl}
						<img class="url-preview" src={characterRefUrl} alt="Character reference preview" width="84" height="84" loading="lazy" onload={showImg} onerror={hideOnError} />
					{:else}
						<!-- Blank ≠ no face. The server sends the persona's PINNED face (or
						     generates one on the fly) so the character stays consistent. -->
						<span class="hint char-auto" id="gc-character-hint">
							Blank uses the persona's pinned face — a consistent face is still sent (generated
							automatically the first time). Paste a URL only to override it for this post.
						</span>
					{/if}
				</div>
			</div>

			<div class="row">
				<div class="fld">
					<label class="fld-label" for="gc-date">Schedule date (optional)</label>
					<input id="gc-date" type="date" bind:value={scheduledDate} />
				</div>
				<div class="fld">
					<label class="fld-label" for="gc-time">Schedule time (optional)</label>
					<input id="gc-time" type="time" bind:value={scheduledTime} />
				</div>
			</div>

			{#if media === 'video'}
				<div class="fld">
					<span class="fld-label" id="gc-format-label">Video format</span>
					<div
						class="chips"
						role="radiogroup"
						aria-labelledby="gc-format-label"
						aria-describedby="gc-format-hint"
					>
						<button type="button" class="chip" class:on={format === 'spokesperson'} role="radio" aria-checked={format === 'spokesperson'} onclick={() => (format = 'spokesperson')}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
							Spokesperson
						</button>
						<button type="button" class="chip" class:on={format === 'broll'} role="radio" aria-checked={format === 'broll'} onclick={() => (format = 'broll')}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5" /></svg>
							B-roll
						</button>
						<button type="button" class="chip" class:on={format === 'auto'} role="radio" aria-checked={format === 'auto'} onclick={() => (format = 'auto')}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
							Auto
						</button>
					</div>
					<span class="hint" id="gc-format-hint">
						{#if format === 'spokesperson'}
							The character speaks on camera — voiceover + talking head (OmniHuman). The b-roll model picker below doesn't apply to this run.
						{:else if format === 'broll'}
							A silent product/lifestyle clip from the b-roll model below. No voiceover.
						{:else}
							The Director picks spokesperson or b-roll per post (biased to spokesperson). Pick one to lock the exact pipeline.
						{/if}
					</span>
				</div>
			{/if}

			{#if videoModelOptions.length && format !== 'spokesperson'}
				<div class="fld">
					<span class="fld-label" id="gc-videomodel-label">Video model — the biggest cost in this run</span>
					<div class="models" role="radiogroup" aria-labelledby="gc-videomodel-label">
						{#each videoModelOptions as m}
							<button
								type="button"
								class="model"
								class:on={videoModel === m.id}
								role="radio"
								aria-checked={videoModel === m.id}
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
								{#if selectedVideoModel.supportsAudio}
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
									Audio track
								{:else}
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z" /><line x1="22" x2="16" y1="9" y2="15" /><line x1="16" x2="22" y1="9" y2="15" /></svg>
									Silent — no audio
								{/if}
							</span>
							{#if selectedVideoModel.supportsDuration}
								<span class="param">
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
									Custom duration
								</span>
							{:else}
								<span class="param param-off">
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
									Fixed 5s
								</span>
							{/if}
							{#if selectedVideoModel.caveat}
								<span class="param param-warn">
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
									{selectedVideoModel.caveat}
								</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<div class="steps">
				<span class="fld-label">Pipeline that will run</span>
				{#each activeSteps as s}
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
			<span class="cost" aria-live="polite">Est. {usd(isPostKind ? livePostTotal : liveCost)}</span>
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
		color: var(--muted);
	}
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.composer-error {
		background: var(--error-soft);
		border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
		color: var(--error-text);
		padding: 0.9rem;
		border-radius: 10px;
	}
	.composer-error p {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
	}
	.btn-retry {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		margin-top: 0.6rem;
		background: var(--surface);
		border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
		color: var(--error-text);
		border-radius: 8px;
		padding: 0.35rem 0.8rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-retry:hover {
		background: var(--error-soft);
	}
	.fld {
		display: block;
		margin-bottom: 0.9rem;
	}
	.persona-fld {
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--border);
	}
	.fld-label {
		display: block;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--muted);
		margin-bottom: 0.35rem;
	}
	.fld input,
	.fld select,
	.fld textarea {
		width: 100%;
		/* 44px floor so date/time/text controls clear the touch-target minimum. */
		min-height: 44px;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		font: inherit;
		background: var(--surface);
		color: var(--text);
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 44px;
		min-width: 44px;
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 999px;
		padding: 0.3rem 0.85rem;
		font-size: 0.8rem;
		cursor: pointer;
		text-transform: capitalize;
	}
	.chip.on {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.hint {
		display: block;
		margin-top: 0.3rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.captions-toggle {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		margin-bottom: 0.9rem;
		cursor: pointer;
	}
	/* 44×44 activation region around the 16px checkbox. The negative margins pull
	   the oversized box back so the row's visual rhythm is unchanged; because the
	   whole thing sits inside the <label>, clicking anywhere in it toggles. */
	.cb-hit {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		margin: -0.6rem -1.05rem -0.6rem -0.7rem;
	}
	.captions-toggle input {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	.captions-copy strong {
		font-size: 0.82rem;
		color: var(--text);
	}
	.captions-copy .hint {
		margin-top: 0.15rem;
	}
	.no-conn {
		background: var(--warning-soft);
		border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
		border-radius: 10px;
		padding: 0.8rem 0.9rem;
		margin-bottom: 0.9rem;
	}
	.no-conn strong {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--warning-text);
		font-size: 0.85rem;
	}
	.no-conn p {
		margin: 0.35rem 0 0.6rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.no-conn-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 44px;
		min-width: 44px;
		background: var(--warning);
		border: 1px solid var(--warning);
		color: #fff;
		border-radius: 8px;
		padding: 0.4rem 0.8rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.no-conn-cta:hover {
		background: color-mix(in srgb, var(--warning) 82%, #000);
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
		border: 1px solid var(--border);
	}
	.raw {
		margin-bottom: 0.9rem;
	}
	.raw summary {
		cursor: pointer;
		/* Vertical padding lifts the disclosure row to a 44px target while keeping
		   `display: list-item` (and therefore the native marker) intact. */
		padding: 0.8rem 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.raw pre {
		white-space: pre-wrap;
		word-break: break-word;
		background: var(--surface-2);
		border: 1px solid var(--border);
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
		border-top: 1px dashed var(--border);
		font-size: 0.82rem;
	}
	.step-name {
		flex: 1;
	}
	.step-usd {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	code {
		background: var(--surface-2);
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
		border-top: 1px solid var(--border);
		font-size: 0.8rem;
		color: var(--muted);
	}
	.cost {
		margin-left: auto;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.btn-ghost,
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		border-radius: 10px;
		padding: 0.5rem 0.95rem;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.86rem;
	}
	.btn-ghost {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
	}
	.btn-primary {
		background: var(--accent);
		border: 1px solid var(--accent);
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
		min-height: 44px;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		cursor: pointer;
	}
	.model.on {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);
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
		color: var(--text);
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
		background: var(--success-soft);
		color: var(--success-text);
	}
	.tier-balanced {
		background: color-mix(in srgb, var(--info) 12%, transparent);
		color: var(--info-text);
	}
	.tier-premium {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.model-note {
		font-size: 0.72rem;
		color: var(--muted);
		line-height: 1.35;
	}
	.model-warn {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0.5rem 0 0;
		font-size: 0.74rem;
		color: var(--warning-text);
		background: var(--warning-soft);
		border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
	}
	.model-warn svg {
		flex: none;
		margin-top: 0.1rem;
	}
	/* Inline preview thumbnails under the Product / Character URL inputs. */
	.url-preview {
		margin-top: 0.4rem;
		width: 84px;
		height: 84px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid var(--border);
		display: block;
	}
	.char-auto {
		color: var(--muted);
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
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text);
	}
	.param-off {
		opacity: 0.6;
	}
	.param-warn {
		color: var(--warning-text);
		background: var(--warning-soft);
		border-color: color-mix(in srgb, var(--warning) 40%, transparent);
	}
</style>
