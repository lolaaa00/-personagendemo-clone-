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
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
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
		/**
		 * Why Cinematic is out of reach on this plan, or null when it is included.
		 *
		 * The server refuses `media: 'cinematic'` with 403 PLAN_FEATURE BEFORE the
		 * preview branch, so without this the option looks available, the refusal
		 * arrives as an unexplained failure, and — for a cinematic Studio template,
		 * which posts its preview immediately — the composer renders a Retry button
		 * that can never succeed.
		 */
		cinematicBlocked?: string | null;
	}

	let {
		open,
		spec,
		onClose,
		onConfirm,
		onGoToConnections,
		agents,
		agentId,
		onAgentChange,
		cinematicBlocked = null
	}: Props = $props();

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

	// The composition contract from the server: which reference fields this run
	// will actually feed, and whether the still is a typographic card. Absent on
	// legacy previews → show everything (that pipeline feeds both refs).
	// Cinematic is the exception: its multi-shot pack always composites both
	// references, so switching the Media select to cinematic suspends the
	// contract here exactly like the run would.
	let composition = $derived<{ still?: string; character?: boolean; product?: boolean } | null>(
		preview?.composition ?? null
	);
	let activeComposition = $derived(media === 'cinematic' ? null : composition);
	let usesCharacterRef = $derived(!activeComposition || activeComposition.character !== false);
	let usesProductRef = $derived(!activeComposition || activeComposition.product !== false);
	let isGraphicCard = $derived(activeComposition?.still === 'graphic');

	let modelOptions = $derived<ModelOption[]>(preview?.modelOptions ?? []);
	let selectedModel = $derived(modelOptions.find((m) => m.id === model) ?? null);

	// Re-price live as the user trades quality for budget, instead of showing the
	// cost of whatever the server happened to default to.
	let liveCost = $derived(selectedModel ? selectedModel.usd : (preview?.estimatedCostUsd ?? 0));

	let videoModelOptions = $derived<ModelOption[]>(preview?.videoModelOptions ?? []);
	let selectedVideoModel = $derived(videoModelOptions.find((m) => m.id === videoModel) ?? null);

	// The pipeline actually shown/priced, driven by the Media + format selectors.
	// Every media kind's step array comes from the server, so switching Media here
	// re-derives the real stack — it never keeps showing the original kind's steps.
	let activeSteps = $derived.by(() => {
		if (!isPostKind) return [] as any[];
		if (media === 'image') return (preview.stepsImage ?? preview.steps ?? []) as any[];
		if (media === 'cinematic') return (preview.stepsCinematic ?? preview.steps ?? []) as any[];
		// A graphic card has no face to animate — the server coerces spokesperson
		// to b-roll on these, so the pipeline shown must be b-roll's too.
		if (format === 'broll' || isGraphicCard)
			return (preview.stepsBroll ?? preview.steps ?? []) as any[];
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

	// Where approving SENDS this run. The consequence belongs ON the button —
	// "Approve & generate" that quietly publishes live to a connected account the
	// moment generation finishes is exactly the kind of surprise this dialog
	// exists to prevent.
	let deliverMode = $derived(
		typeof spec?.baseBody?.deliver === 'string' ? (spec.baseBody.deliver as string) : null
	);
	let destination = $derived.by(() => {
		if (!isPostKind) return null; // prompt-kind flows keep their own label
		if (deliverMode === 'asset')
			return {
				label: spec?.confirmLabel ?? 'Approve & generate',
				hint: 'Output: standalone asset — skips the review queue and never publishes on its own.'
			};
		if (deliverMode === 'review')
			return {
				label: spec?.confirmLabel ?? 'Approve & generate',
				hint: 'Output: draft in the review queue — publishes only when you approve it there.'
			};
		if (!hasConnections)
			return {
				label: 'Save as draft',
				hint: 'Output: draft — no account is connected, so nothing can publish.'
			};
		if (platforms.length === 0)
			return {
				label: 'Save as draft',
				hint: 'Output: draft — no platform selected, so nothing publishes.'
			};
		if (scheduledDate)
			return {
				label: 'Approve & schedule',
				hint: `Output: scheduled post — publishes to ${platforms.join(', ')} on ${scheduledDate}${scheduledTime ? ` at ${scheduledTime}` : ''}.`
			};
		return {
			label: 'Approve & publish now',
			hint: `Output: LIVE post — publishes immediately to ${platforms.join(', ')} as soon as generation completes.`
		};
	});

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
	/** The preview was refused by the plan, not by a hiccup — Retry is pointless. */
	let loadBlockedByPlan = $state(false);
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
		loadBlockedByPlan = false;
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
				// A plan refusal is not a transient failure: retrying it forever cannot
				// help. Say so, and send them somewhere that can. This is the first
				// place in the app that reads a server error CODE rather than only its
				// sentence — the codes were being thrown away everywhere.
				loadBlockedByPlan = data?.code === 'PLAN_FEATURE';
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

	// ── The journey ────────────────────────────────────────────────────────
	// The composer used to be one long scroll: topic, media, captions, platforms,
	// scene, product, refs, schedule, format, models and pipeline all stacked in a
	// single pane, in an order that matched no decision anyone actually makes.
	//
	// It is now a sequence that mirrors the action being composed. A post really
	// is four decisions, in this order — and each step asks the question rather
	// than labelling a field:
	//
	//   subject → what are we making?      (topic, media kind, video format)
	//   look    → how should it look?      (scene, product, refs, burn-ins)
	//   craft   → what builds it?          (provider, models, pipeline, cost)
	//   deliver → where does it go?        (platforms, schedule, destination)
	//
	// A prompt-kind run is ONE decision, so it gets one pane. Stepping a two-field
	// dialog would be ceremony, not a journey — the step list is derived from what
	// is actually being composed, never fixed.
	interface Step {
		id: 'single' | 'subject' | 'look' | 'craft' | 'deliver';
		label: string;
		question: string;
		blurb: string;
	}

	let steps = $derived<Step[]>(
		isPostKind
			? [
					{
						id: 'subject',
						label: 'Subject',
						question: 'What are we posting?',
						blurb:
							'The topic and the kind of media. Everything after this adapts to what you pick here.'
					},
					{
						id: 'look',
						label: 'Look',
						question: 'How should it look?',
						blurb:
							'The scene, the product in shot, and the face. Leave anything blank and the Director writes it.'
					},
					{
						id: 'craft',
						label: 'Craft',
						question: 'What builds it?',
						blurb:
							'Your budget-vs-quality call. The pipeline below is exactly what will run, priced as you choose.'
					},
					{
						id: 'deliver',
						label: 'Deliver',
						question: 'Where does it go?',
						blurb: 'Pick the accounts and when. Nothing is spent until you approve on this step.'
					}
				]
			: [
					{
						id: 'single',
						label: 'Request',
						question: spec?.title ?? 'Confirm this request',
						blurb: 'This is the exact request that will be sent. Edit anything before approving.'
					}
				]
	);

	let stepIndex = $state(0);
	// Clamp rather than reset: switching Media mid-flow must never strand the user
	// on a step index that no longer exists.
	let currentStep = $derived(steps[Math.min(stepIndex, steps.length - 1)]);
	let isLastStep = $derived(stepIndex >= steps.length - 1);
	let isFirstStep = $derived(stepIndex <= 0);

	function goToStep(i: number) {
		stepIndex = Math.max(0, Math.min(i, steps.length - 1));
	}
	function nextStep() {
		if (!isLastStep) stepIndex += 1;
	}
	function prevStep() {
		if (!isFirstStep) stepIndex -= 1;
	}

	// A fresh spec is a fresh journey — reopening the composer must not drop the
	// user back on "Deliver" from last time.
	$effect(() => {
		if (open && spec) stepIndex = 0;
	});

	/**
	 * Enter advances the journey instead of doing nothing. Deliberately NOT on the
	 * last step: the final Enter would spend money, and that click must be aimed.
	 * Textareas keep Enter for newlines.
	 */
	function onPaneKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.shiftKey) return;
		const el = e.target as HTMLElement | null;
		if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return;
		if (isLastStep) return;
		e.preventDefault();
		nextStep();
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
	subtitle={spec?.subtitle ??
		'Review and edit exactly what gets sent — nothing is spent until you approve.'}
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
				Switching re-resolves everything below for that persona — face, voice, connected platforms,
				and cost are all persona-specific.
			</span>
		</div>
	{/if}

	{#if loading}
		<div class="composer-loading" role="status" aria-live="polite">
			<span class="spinner" aria-hidden="true"></span> Resolving the exact request…
		</div>
	{:else if loadError}
		<div class="composer-error" role="alert">
			<strong>{loadBlockedByPlan ? 'Not included in your plan' : "Can't prepare this generation"}</strong>
			<p>{loadError}</p>
			{#if loadBlockedByPlan}
				<a class="btn-retry" href="/billing">Compare plans</a>
			{:else}
				<button type="button" class="btn-retry" onclick={() => loadPreview()}>Retry</button>
			{/if}
		</div>
	{:else if preview}
		<!-- ── The journey ──────────────────────────────────────────────
		     A post is four decisions in a real order — what it is, how it
		     looks, what builds it, where it goes — so the composer asks them
		     in that order instead of stacking every field into one scroll.
		     A prompt-kind run is a single decision and stays on one pane; a
		     wizard for two fields would be worse than the form it replaced. -->
		{#if steps.length > 1}
			<nav class="journey" aria-label="Composer steps">
				{#each steps as s, i (s.id)}
					<button
						type="button"
						class="journey-step"
						class:current={i === stepIndex}
						class:done={i < stepIndex}
						aria-current={i === stepIndex ? 'step' : undefined}
						onclick={() => goToStep(i)}
					>
						<span class="journey-dot" aria-hidden="true">
							{#if i < stepIndex}
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
								>
							{:else}{i + 1}{/if}
						</span>
						<span class="journey-label">{s.label}</span>
					</button>
				{/each}
			</nav>
		{/if}

		<!-- Keyed so each step animates in as its own pane rather than the
		     fields silently swapping under a static heading. -->
		{#key currentStep.id}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<section
				class="pane"
				aria-labelledby="gc-pane-title"
				in:fly={{ x: 14, duration: 180, easing: cubicOut }}
				onkeydown={onPaneKeydown}
			>
				<header class="pane-head">
					<h4 id="gc-pane-title">{currentStep.question}</h4>
					<p>{currentStep.blurb}</p>
				</header>

				<div class="pane-body">
					{#if modelOptions.length && (!isPostKind || currentStep.id === 'craft')}
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
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path
											d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
										/><line x1="12" x2="12" y1="9" y2="13" /><line
											x1="12"
											x2="12.01"
											y1="17"
											y2="17"
										/></svg
									>
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

					{#if isPostKind && currentStep.id === 'subject'}
						<div class="fld">
							<label class="fld-label" for="gc-topic">Topic</label>
							<input
								id="gc-topic"
								bind:value={topic}
								placeholder="Leave blank to let the persona pick"
							/>
						</div>

						<div class="row">
							<div class="fld">
								<label class="fld-label" for="gc-media">Media</label>
								<!-- "video" covers BOTH spokesperson and b-roll — the Video format
							     chips below decide which — so the label must not claim b-roll. -->
								<select id="gc-media" bind:value={media}>
									<option value="video">Video</option>
									<option value="image">Image only</option>
									<option
						value="cinematic"
						disabled={cinematicBlocked !== null}
						title={cinematicBlocked ?? undefined}
					>
						Cinematic (multi-shot){cinematicBlocked ? ' — not in your plan' : ''}
					</option>
								</select>
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
									<button
										type="button"
										class="chip"
										class:on={format === 'spokesperson' && !isGraphicCard}
										role="radio"
										aria-checked={format === 'spokesperson' && !isGraphicCard}
										disabled={isGraphicCard}
										title={isGraphicCard
											? 'A graphic card has no face to animate — video runs as b-roll motion.'
											: undefined}
										onclick={() => (format = 'spokesperson')}
									>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
											><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path
												d="M19 10v2a7 7 0 0 1-14 0v-2"
											/><line x1="12" x2="12" y1="19" y2="22" /></svg
										>
										Spokesperson
									</button>
									<button
										type="button"
										class="chip"
										class:on={format === 'broll'}
										role="radio"
										aria-checked={format === 'broll'}
										onclick={() => (format = 'broll')}
									>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
											><rect x="2" y="3" width="20" height="18" rx="2" /><path
												d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5"
											/></svg
										>
										B-roll
									</button>
									<button
										type="button"
										class="chip"
										class:on={format === 'auto'}
										role="radio"
										aria-checked={format === 'auto'}
										onclick={() => (format = 'auto')}
									>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
											><path
												d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
											/></svg
										>
										Auto
									</button>
								</div>
								<span class="hint" id="gc-format-hint">
									{#if isGraphicCard}
										A graphic card has no face to animate — video always runs as b-roll motion of
										the card.
									{:else if format === 'spokesperson'}
										The character speaks on camera — voiceover + talking head (OmniHuman). The
										b-roll model picker below doesn't apply to this run.
									{:else if format === 'broll'}
										A silent product/lifestyle clip from the b-roll model below. No voiceover.
									{:else}
										The Director picks spokesperson or b-roll per post (biased to spokesperson).
										Pick one to lock the exact pipeline.
									{/if}
								</span>
							</div>
						{/if}

						{#if composition && (isGraphicCard || !usesCharacterRef || !usesProductRef)}
							<!-- The contract, stated up front: which references this run feeds.
						     Fields for unused references are not rendered at all below. -->
							<p class="comp-note" role="note">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path
										d="M12 8h.01"
									/></svg
								>
								<span>
									{#if isGraphicCard}
										<strong>Typographic card.</strong> The model renders the card's text as the artwork.
										No reference images are sent — no persona face, no product photo.
									{:else if !usesCharacterRef && !usesProductRef}
										<strong>No reference images.</strong> This composition includes neither the persona
										nor a product — the scene is generated purely from the prompt.
									{:else if !usesCharacterRef}
										<strong>Product reference only.</strong> The persona does not appear in this composition,
										so no face reference is sent (and none is generated).
									{:else}
										<strong>Face reference only.</strong> Product-free channel content — the brand-kit
										product photo is not attached.
									{/if}
								</span>
							</p>
						{/if}
					{/if}

					{#if isPostKind && currentStep.id === 'look'}
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

						{#if usesProductRef && products.length}
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
									Pick a product from this persona's brand kit — its photo fills the URL below.
									Products come from the brand brief selected in the persona's <strong
										>Profile</strong
									>.
								</span>
							</div>
						{/if}

						{#if usesProductRef || usesCharacterRef}
							<!-- Only the reference fields this composition actually feeds. A field
						     for a reference the run won't use would be a lie — it's not shown. -->
							<div class="row">
								{#if usesProductRef}
									<div class="fld">
										<label class="fld-label" for="gc-product-url"
											>Product photo URL{products.length ? ' (override)' : ''}</label
										>
										<input
											id="gc-product-url"
											inputmode="url"
											bind:value={productPhotoUrl}
											placeholder="https://…"
										/>
										{#if productPhotoUrl}
											<img
												class="url-preview"
												src={productPhotoUrl}
												alt="Product preview"
												width="84"
												height="84"
												loading="lazy"
												onload={showImg}
												onerror={hideOnError}
											/>
										{/if}
									</div>
								{/if}
								{#if usesCharacterRef}
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
											<img
												class="url-preview"
												src={characterRefUrl}
												alt="Character reference preview"
												width="84"
												height="84"
												loading="lazy"
												onload={showImg}
												onerror={hideOnError}
											/>
										{:else}
											<!-- Blank ≠ no face. The server sends the persona's PINNED face (or
										     generates one on the fly) so the character stays consistent. -->
											<span class="hint char-auto" id="gc-character-hint">
												Blank uses the persona's pinned face — a consistent face is still sent
												(generated automatically the first time). Paste a URL only to override it
												for this post.
											</span>
										{/if}
									</div>
								{/if}
							</div>
						{/if}

						{#if media !== 'image'}
							<label class="captions-toggle">
								<!-- The 16px control keeps its size; .cb-hit gives it a 44×44 target. -->
								<span class="cb-hit">
									<input
										type="checkbox"
										bind:checked={captions}
										aria-describedby="gc-captions-hint"
									/>
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
									<input
										type="checkbox"
										bind:checked={aiBadge}
										aria-describedby="gc-aibadge-hint"
									/>
								</span>
								<span class="captions-copy">
									<strong>“AI GENERATED” disclosure badge</strong>
									<span class="hint" id="gc-aibadge-hint">
										Off by default. When on, a small badge is burned top-left. Independent of
										captions.
									</span>
								</span>
							</label>
						{/if}
					{/if}

					{#if isPostKind && currentStep.id === 'craft'}
						<div class="fld">
							<label class="fld-label" for="gc-provider">Provider</label>
							<select id="gc-provider" bind:value={provider}>
								<option value="auto">Auto</option>
								<option value="fal">fal.ai</option>
								<option value="openrouter">OpenRouter</option>
							</select>
						</div>

						<!-- Only for runs that will actually feed an i2v model: image-only runs
					     never touch it, and cinematic runs use their own fixed pipeline —
					     offering the picker there would imply a choice that has no effect. -->
						{#if videoModelOptions.length && media === 'video' && format !== 'spokesperson'}
							<div class="fld">
								<span class="fld-label" id="gc-videomodel-label"
									>Video model — the biggest cost in this run</span
								>
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
												<svg
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path d="M11 5 6 9H2v6h4l5 4z" /><path
														d="M15.54 8.46a5 5 0 0 1 0 7.07"
													/><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg
												>
												Audio track
											{:else}
												<svg
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path d="M11 5 6 9H2v6h4l5 4z" /><line
														x1="22"
														x2="16"
														y1="9"
														y2="15"
													/><line x1="16" x2="22" y1="9" y2="15" /></svg
												>
												Silent — no audio
											{/if}
										</span>
										{#if selectedVideoModel.supportsDuration}
											<span class="param">
												<svg
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><circle cx="12" cy="12" r="10" /><polyline
														points="12 6 12 12 16 14"
													/></svg
												>
												Custom duration
											</span>
										{:else}
											<span class="param param-off">
												<svg
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><circle cx="12" cy="12" r="10" /><polyline
														points="12 6 12 12 16 14"
													/></svg
												>
												Fixed 5s
											</span>
										{/if}
										{#if selectedVideoModel.caveat}
											<span class="param param-warn">
												<svg
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path
														d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
													/><line x1="12" x2="12" y1="9" y2="13" /><line
														x1="12"
														x2="12.01"
														y1="17"
														y2="17"
													/></svg
												>
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

					{#if isPostKind && currentStep.id === 'deliver'}
						{#if preview.connectedPlatforms?.length}
							<div class="fld">
								<span class="fld-label" id="gc-platforms-label"
									>Publish to (connected accounts only)</span
								>
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
									Only connected platforms are shown — a post only publishes where an account is
									connected.
								</span>
							</div>
						{:else}
							<!-- No connected account: a post can't be scheduled to publish. It can
						     still be saved as a draft and posted later once a platform connects. -->
							<div class="no-conn" role="alert">
								<strong>
									<svg
										width="15"
										height="15"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path
											d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
										/><line x1="12" x2="12" y1="9" y2="13" /><line
											x1="12"
											x2="12.01"
											y1="17"
											y2="17"
										/></svg
									>
									<span>No connected account</span>
								</strong>
								<p>
									This post can't be scheduled to publish — there's nowhere to send it yet. Connect
									a platform first, then it can go out. You can still save it as a draft below.
								</p>
								{#if onGoToConnections}
									<button type="button" class="no-conn-cta" onclick={onGoToConnections}>
										Go to Connections
										<svg
											width="15"
											height="15"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg
										>
									</button>
								{/if}
							</div>
						{/if}

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

						{#if destination}
							<p class="dest-note" role="note" aria-live="polite">
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg
								>
								<span>{destination.hint}</span>
							</p>
						{/if}
					{/if}
				</div>
			</section>
		{/key}

		<!-- Model/provider footnote for prompt-kind runs only. A post-kind run
		     lists every model in the Craft step's pipeline, and the running cost
		     is pinned in the footer on every step — repeating either here just
		     printed the same number twice. -->
		{#if !isPostKind && (preview.model || preview.provider)}
			<div class="meta">
				{#if preview.model}<span>Model <code>{preview.model}</code></span>{/if}
				{#if preview.provider}<span>via {preview.provider}</span>{/if}
			</div>
		{/if}
	{/if}

	{#snippet footer()}
		<!-- The running cost lives in the footer, visible on EVERY step. It is the
		     one number that should never be a surprise at the end of a journey. -->
		{#if preview}
			<span class="foot-cost" aria-live="polite">
				<span class="foot-cost-label">Est. cost</span>
				<strong>{usd(isPostKind ? livePostTotal : liveCost)}</strong>
			</span>
		{/if}
		{#if isFirstStep}
			<button class="btn-ghost" onclick={onClose}>Cancel</button>
		{:else}
			<button class="btn-ghost" onclick={prevStep}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg
				>
				Back
			</button>
		{/if}
		{#if isLastStep}
			<button class="btn-primary" disabled={loading || !!loadError || !preview} onclick={confirm}>
				{destination?.label ?? spec?.confirmLabel ?? 'Approve & generate'}
			</button>
		{:else}
			<!-- Next, never "Approve" — the money decision belongs on the last step
			     only, so no intermediate button can spend by accident. -->
			<button class="btn-primary" disabled={loading || !!loadError || !preview} onclick={nextStep}>
				{steps[stepIndex + 1]?.label ?? 'Next'}
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg
				>
			</button>
		{/if}
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
	.comp-note {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		margin: 0;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.comp-note svg {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--accent);
	}
	.comp-note strong {
		color: var(--text);
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
	/* The destination line: what approving actually DOES with the output. */
	.dest-note {
		display: flex;
		gap: 0.45rem;
		align-items: flex-start;
		margin: 0.9rem 0 0;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
		color: var(--text);
		font-size: 0.8rem;
		line-height: 1.4;
	}
	.dest-note svg {
		flex: none;
		margin-top: 2px;
		color: var(--accent);
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
	/* ── The journey ──────────────────────────────────────────────────────
	   Progress rail + one pane per decision. The rail is clickable in both
	   directions: nothing here is required, so forcing a linear walk would
	   just be a worse version of the scroll it replaced. */

	.journey {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: -0.25rem 0 1.1rem;
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--border);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.journey::-webkit-scrollbar {
		display: none;
	}

	.journey-step {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.18s,
			background 0.18s;
	}

	.journey-step:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	.journey-dot {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		border: 1.5px solid var(--border-strong);
		font-size: 0.68rem;
		font-weight: 700;
		transition:
			background 0.18s,
			border-color 0.18s,
			color 0.18s;
	}

	.journey-step.current {
		color: var(--text);
	}

	.journey-step.current .journey-dot {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.journey-step.done {
		color: var(--text);
	}

	.journey-step.done .journey-dot {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}

	/* The label is the first thing to go on a narrow modal — the numbered dot
	   still carries the position, so the rail never wraps or clips mid-word. */
	@media (max-width: 620px) {
		.journey-label {
			display: none;
		}

		.journey-step {
			flex: 0 0 auto;
			justify-content: center;
		}
	}

	.pane {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.pane-head h4 {
		margin: 0 0 0.25rem;
		font-size: 1.02rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--text);
	}

	.pane-head p {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.55;
		color: var(--muted);
		max-width: 60ch;
	}

	.pane-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ── Footer: the running cost sits opposite the nav, on every step ──── */
	.foot-cost {
		margin-right: auto;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.foot-cost strong {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.foot-cost-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* The footer buttons carry chevrons now, so they need to be flex rows. */
	:global(.modal-foot) .btn-ghost,
	:global(.modal-foot) .btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
</style>
