<script lang="ts">
	/**
	 * Confirm-before-generate composer.
	 *
	 * Nothing in here is guessed client-side. On open it calls the same endpoint it
	 * will eventually generate with, passing `preview: true` — the server resolves
	 * the REAL payload (actual references, actual model options, actual prices) and
	 * hands it back. We render that as an editable form, and on confirm we POST the
	 * edited values to the same endpoint.
	 *
	 * That round-trip is the whole point: a form built from client-side assumptions
	 * drifts from what the server really sends the moment either side changes.
	 *
	 * ── The vocabulary ──────────────────────────────────────────────────────
	 * A post used to be composed out of four overlapping fields — media, format,
	 * still and refs — which is why a typographic card had to be assembled as
	 * media:'image' + still:'graphic' + no refs, and why it could never be listed
	 * anywhere sensible. There is now ONE axis: pick a kind (Image / Video /
	 * Series), then a format inside it. Everything else is derived from
	 * $lib/formats, and `requestFor()` turns the pick back into the media/format/
	 * still/refs the API has always spoken, so no existing caller changed.
	 *
	 * ── The cascade ─────────────────────────────────────────────────────────
	 * Each format declares what it NEEDS. Look renders exactly those controls,
	 * Craft is the format's own step plan, and the journey itself grows or shrinks
	 * — a text card has nothing to configure, so it has no Craft step rather than
	 * an empty one. No pane in here knows what a "spokesperson" is.
	 *
	 * ── The money ───────────────────────────────────────────────────────────
	 * Every price is `quote()`: the provider estimate converted to what the
	 * customer is actually charged, in their own currency. This screen used to
	 * print the raw provider cost, which at the production markup was a third of
	 * the real charge.
	 */
	import Modal from '$lib/components/ui/Modal.svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { ComposerSpec } from './types';
	import { TIER_LABEL, type ModelOption } from '$lib/models';
	import {
		FORMAT_KINDS,
		formatsOfKind,
		getFormat,
		formatFromRequest,
		requestFor,
		planPipeline,
		craftMatters,
		buildableWith,
		MIN_ITEMS,
		MAX_ITEMS,
		type FormatEntry,
		type FormatKind,
		type FormatNeed,
		type HostCapability,
		type PipelineStep,
		type StepKind,
		type StepModel
	} from '$lib/formats';
	import { quote, quoteSteps, pricingContext } from '$lib/stores/pricing.svelte';
	import {
		parseQuotes,
		quoteProblem,
		MAX_CARD_QUOTES,
		CARD_LOOKS,
		type CardLook
	} from '$lib/card-quotes';
	import { STUDIO_TEMPLATES } from '$lib/studio-templates';
	import { AUTONOMY_LABELS, type AutonomyLevel } from '$lib/types';

	interface Props {
		open: boolean;
		spec: ComposerSpec | null;
		onClose: () => void;
		/** Called with the FINAL body the user approved. Caller performs the POST. */
		onConfirm: (body: Record<string, unknown>) => void;
		/** Optional: jump to the Connections tab from the no-connection notice. */
		onGoToConnections?: () => void;
		/**
		 * Optional: hand off to the campaign planner. A run of posts is a different
		 * question from one post (cadence, horizon, a mix of formats) and the planner
		 * already asks it well. Without this callback the Series kind is not offered
		 * at all — a kind whose only format cannot be produced from here would be
		 * exactly the empty promise this dialog exists to prevent.
		 */
		onOpenPlanner?: () => void;
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
		/**
		 * The persona's SAVED `agent_configs.autonomy_level` — the same row the
		 * generate-post route reads before it decides whether the finished post may
		 * publish itself.
		 *
		 * Without it this dialog promised "Approve & publish now / LIVE post" for
		 * every persona, while the server held the output as a draft for anything
		 * below 'fully_autonomous' — a button that lied in the safe direction, and
		 * a post nobody knew to go and approve.
		 *
		 * `null`/absent is deliberately treated as HELD, matching the route's own
		 * `String(cfgRow?.autonomy_level ?? 'advisor')` fallback: an unknown level
		 * must never be advertised as an immediate publish.
		 */
		autonomyLevel?: AutonomyLevel | null;
	}

	let {
		open,
		spec,
		onClose,
		onConfirm,
		onGoToConnections,
		onOpenPlanner,
		agents,
		agentId,
		onAgentChange,
		cinematicBlocked = null,
		autonomyLevel = null
	}: Props = $props();

	let loading = $state(false);
	/**
	 * Latches the instant the spend is dispatched, and never unlatches — the
	 * composer is unmounted by every caller right after `onConfirm`, so there is
	 * no second legitimate submit from this instance.
	 *
	 * `loading` cannot do this job: it belongs to the PREVIEW fetch, and is false
	 * exactly when the confirm button is enabled. Both call sites happen to set
	 * `composerOpen = false` before running, but Svelte flushes effects
	 * asynchronously, so the button survives the frame in which it was clicked —
	 * and a third caller that ran before closing would re-open the window with no
	 * warning. A double-charge must not depend on every caller's ordering.
	 */
	let submitting = $state(false);
	let loadError = $state<string | null>(null);
	let preview = $state<any>(null);

	// ── Editable state (populated from the server's resolved preview) ────────
	let prompt = $state('');
	let topic = $state('');
	let scene = $state('');
	let provider = $state('auto');
	/** The one axis: which format this run is. Media/format/still are derived. */
	let formatId = $state('auto');
	let kind = $state<FormatKind>('video');
	// Burn the on-screen caption hook onto the video. OFF by default — captions are
	// never generated without this explicit opt-in.
	let captions = $state(false);
	// Burn a small "AI GENERATED" disclosure badge. Independent of captions, OFF by default.
	let aiBadge = $state(false);
	let platforms = $state<string[]>([]);
	let productId = $state('');
	let productPhotoUrl = $state('');
	// The persona's brand-brief products, resolved server-side. Shipped whatever
	// this run composites so switching format client-side never finds an empty
	// picker; whether an id is SENT is gated on the composition below.
	let products = $state<Array<{ id: string; name: string; photoUrl: string | null }>>([]);
	let characterRefUrl = $state('');
	let scheduledDate = $state('');
	let scheduledTime = $state('');
	// Per-run controls the Look step pins when the format reads them.
	let script = $state('');
	let voice = $state('');
	let voices = $state<Array<{ name: string; label: string; style: string; accent: string | null }>>(
		[]
	);
	let cardText = $state('');
	let cardLayout = $state('auto');
	let cardPalette = $state('auto');
	// "My own words": the user's quotes replace the Director's line — one card
	// per quote, up to MAX_CARD_QUOTES, and no model anywhere in the run. The
	// Director and the quality gate are the only paid stages of a card format,
	// so a batch typed by the user is free by construction, not by discount.
	let cardMode = $state<'director' | 'own'>('director');
	let cardQuotesRaw = $state('');
	let cardLook = $state<CardLook>('set');
	// Framing is only SENT when the user actually chooses one. Studio templates
	// already bake a front-camera or mirror clause into their scene text, so
	// posting a default on every run would splice the same instruction twice.
	let framing = $state<'front' | 'mirror' | 'third'>('front');
	let framingTouched = $state(false);
	/** "Use my own still" — the URL replaces the generated frame and its charge. */
	let stillUrl = $state('');
	// ── The list (the listicle format) ───────────────────────────────────────
	// Two values, because they answer two different questions and only one of them
	// is money: HOW MANY beats — which the voiceover stage is billed per, so it
	// moves the quote — and WHICH beats, which the Director writes unless the user
	// names them. Both are optional; neither blocks the run. The count opens on
	// whatever the server just priced (`plan.items`) rather than a second guess.
	let listCount = $state(4);
	/** The user's own beat labels, by index. A gap means "the Director writes that one". */
	let listItems = $state<string[]>([]);
	// ── The source clip (the video-to-video formats) ─────────────────────────
	// Ingest is a round-trip of its own: the file is POSTed to /source-clip,
	// which probes it and hands back a stored URL plus the MEASURED duration.
	// That duration is the billing basis for the per-second transfer stage, so it
	// is never taken from the filename, the file size, or a guess on this side —
	// a clip the server could not measure is a clip that cannot be priced, and it
	// is refused here rather than quoted at the pipeline's default length.
	let sourceVideoUrl = $state('');
	let sourceSeconds = $state<number | null>(null);
	let sourceDims = $state<{ width: number; height: number } | null>(null);
	let sourceName = $state('');
	let sourceUploading = $state(false);
	let sourceError = $state<string | null>(null);
	// Budget-vs-quality. The tier locks every stage at once; a per-stage pick
	// overrides it for that stage and flips the lock to manual.
	let tier = $state<'budget' | 'balanced' | 'premium' | 'manual'>('manual');
	let picks = $state<Partial<Record<StepKind, string>>>({});
	/** Prompt-kind (avatar / reference kit) model pick — unchanged flow. */
	let model = $state('');

	let isPromptKind = $derived(!!preview && typeof preview.prompt === 'string');
	let isPostKind = $derived(!!preview && preview.kind === 'post');

	let format = $derived(getFormat(formatId));
	let ffmpegAvailable = $derived(preview?.ffmpegAvailable !== false);
	// Fails CLOSED where ffmpeg fails open: an older server that has never heard
	// of ingest omits the flag entirely, and offering a format that needs a clip
	// on a host that cannot take one is exactly the empty promise the capability
	// gate exists to prevent. ffmpeg can default the other way because its
	// formats degrade; a v2v run has nothing to degrade to.
	let videoIngestAvailable = $derived(preview?.videoIngestAvailable === true);
	// What this host can actually do. Formats declare capabilities, not flags, so
	// a new one is added to this set and nothing below changes.
	let hostCapabilities = $derived<HostCapability[]>([
		...(ffmpegAvailable ? (['ffmpeg'] as const) : []),
		...(videoIngestAvailable ? (['videoIngest'] as const) : [])
	]);
	const buildable = (f: Pick<FormatEntry, 'requires'>) => buildableWith(f, hostCapabilities);
	let availableKinds = $derived(
		FORMAT_KINDS.filter(
			(k) =>
				(k.id !== 'series' || !!onOpenPlanner) &&
				// A kind whose every format is unbuildable here is not a choice.
				formatsOfKind(k.id).some((f) => buildable(f) || k.id === 'series')
		)
	);
	let isSeries = $derived(format?.kind === 'series');

	/**
	 * The composition contract: which references this run feeds, and whether the
	 * still is a typographic card. Derived from the FORMAT (so it stays true when
	 * the user switches format without a re-resolve) falling back to whatever the
	 * caller's own request pinned — a channel template that excludes the product
	 * must keep excluding it.
	 */
	let baseRefs = $derived.by<{ character: boolean; product: boolean } | null>(() => {
		// A typographic template turns both references off because a CARD has no
		// references — that is an artifact of the format, not a content policy. If
		// the user switches such a template to a photo, carrying those flags over
		// would silently produce a faceless photo. Every other template's refs ARE
		// policy (product-free channel content) and must survive a format change.
		const base = spec?.baseBody as any;
		if (!base || base.still === 'graphic') return null;
		return base.refs ?? null;
	});
	let composition = $derived.by(() => {
		const f = getFormat(formatId);
		if (!f) return { still: 'photo' as const, character: true, product: true };
		if (f.request.refs) return { still: f.request.still ?? 'photo', ...f.request.refs };
		// Cinematic runs its own pack and always composites both references.
		if (formatId === 'cinematic')
			return { still: 'photo' as const, character: true, product: true };
		return {
			still: f.request.still ?? 'photo',
			character: baseRefs ? baseRefs.character !== false : true,
			product: baseRefs ? baseRefs.product !== false : true
		};
	});
	let usesCharacterRef = $derived(composition.character !== false);
	let usesProductRef = $derived(composition.product !== false);
	let isGraphicCard = $derived(composition.still === 'graphic');
	let cardQuotes = $derived(parseQuotes(cardQuotesRaw));
	let cardQuoteProblems = $derived(cardQuotes.map((q) => quoteProblem(q)));
	let cardQuotesOk = $derived(cardQuoteProblems.filter((p) => p === null).length);
	/** The batch is what will run: a card format, own-words mode, at least one quote. */
	let ownWords = $derived(isGraphicCard && cardMode === 'own' && cardQuotes.length > 0);
	/** Refuse to send a batch nothing can come out of, or one over the cap. */
	let ownWordsBlocked = $derived(
		ownWords && (cardQuotes.length > MAX_CARD_QUOTES || cardQuotesOk === 0)
	);

	/**
	 * The beat counts a listicle can be. The whole range is offered because
	 * $lib/formats clamps to exactly it — a chip outside it would quote one number
	 * and run another.
	 */
	// DERIVED from the catalog's exported bounds, never typed out: a chip the
	// engine would reject is a count this screen quoted and the run will not
	// honour. The floor is 3 because a beat is the hook plus an item, so two
	// beats is one item — not a list.
	const BEAT_CHOICES = Array.from({ length: MAX_ITEMS - MIN_ITEMS + 1 }, (_, i) => MIN_ITEMS + i);

	/** Does this format need a control? The whole Look pane is built from this. */
	const needs = (n: FormatNeed) => !!format?.needs.includes(n);

	// ── Prompt-kind model picker (avatar / reference kit) ────────────────────
	let modelOptions = $derived<ModelOption[]>(preview?.modelOptions ?? []);
	let selectedModel = $derived(modelOptions.find((m) => m.id === model) ?? null);
	let liveCost = $derived(selectedModel ? selectedModel.usd : (preview?.estimatedCostUsd ?? 0));
	// This step feeds two references; a single-ref model silently drops one.
	let refWarning = $derived(
		preview?.multiRefNeeded && selectedModel && selectedModel.multiRef === false
			? selectedModel.caveat
			: null
	);

	// ── The plan ─────────────────────────────────────────────────────────────
	// planPipeline() is the SAME function the server called to build this preview.
	// Switching format or model re-runs it here with the server's own options, so
	// the pipeline shown and the pipeline that would run cannot drift apart, and
	// no combination has to be pre-shipped.
	let planOptions = $derived<Partial<Record<StepKind, StepModel[]>>>(preview?.plan?.options ?? {});
	let planFixed = $derived<Partial<Record<StepKind, StepModel>>>(preview?.plan?.fixed ?? {});
	// Stages that belong to no format but WILL run and bill on this particular
	// run — building a persona's face the first time. Priced by the server and
	// carried here so the composer's total is the server's total; recomputing
	// them client-side would be a second source of truth for a real charge.
	let planOneOffs = $derived<PipelineStep[]>(preview?.plan?.oneOffs ?? []);
	/**
	 * The transfer stage has no picker — the FORMAT is the endpoint (Reel remake
	 * runs Replace, Motion transfer runs Move). The server resolved both and sent
	 * them with the plan, so switching format here re-pins the stage to the one
	 * that would actually run instead of leaving it named after whichever the
	 * request opened on. Keyed by the request `format` the catalog already
	 * declares, so a third transfer would need nothing here.
	 */
	let v2vModels = $derived<Record<string, StepModel>>(preview?.plan?.v2vModels ?? {});
	const fixedFor = (f: FormatEntry | undefined): Partial<Record<StepKind, StepModel>> => {
		const m = f?.request.format ? v2vModels[f.request.format] : undefined;
		return m ? { ...planFixed, v2v: m } : planFixed;
	};
	let activePlan = $derived<PipelineStep[]>(
		isPostKind
			? planPipeline({
					formatId,
					options: planOptions,
					fixed: fixedFor(format),
					picks,
					// A supplied stage runs nothing and costs nothing. The user's own
					// quotes supply the Director's line AND make the quality gate moot —
					// there is no draft to abandon when the words are the user's.
					supplied: { still: !!stillUrl, director: ownWords, grader: ownWords },
					tier,
					shots: preview?.plan?.shots ?? 4,
					oneOffs: planOneOffs,
					// The MEASURED length of the clip the user supplied. Absent, the
					// planner quotes its own default duration — which is the honest
					// answer before a clip exists, and wrong the moment one does.
					seconds: sourceSeconds ?? undefined,
					// The beat count, straight in — the voiceover stage is billed per beat
					// and planPipeline owns that arithmetic. Computing it here would be a
					// second multiplier no test ever sees.
					items: listCount
				})
			: []
	);
	/** The run's price rounded per stage, as the ledger debits — see quoteSteps(). */
	let planPrice = $derived(
		// "Let the Director choose" is quoted at its dearer outcome (formats.ts),
		// so it reads as a ceiling, not a price.
		(isPostKind && formatId === 'auto' ? 'up to ' : '') + quoteSteps(activePlan.map((s) => s.usd))
	);
	/**
	 * A format whose run is a transformation OF something has nothing to
	 * transform until that something is here. Blocking the submit is the whole
	 * point: the pipeline degrades a clip-less transfer to a plain b-roll clip,
	 * which would spend the user's money on a post they did not ask for.
	 */
	let missingSourceClip = $derived(needs('sourceVideo') && !sourceVideoUrl);
	/** One row per beat. Shrinking the count hides labels rather than deleting them,
	 *  so a nudge from 5 to 3 and back doesn't cost the user what they typed. */
	let beatRows = $derived(Array.from({ length: listCount }, (_, i) => i));
	let listLabels = $derived(beatRows.map((i) => (listItems[i] ?? '').trim()));
	let namedBeats = $derived(listLabels.filter((l) => l.length > 0).length);
	let hasCraftStep = $derived(craftMatters(activePlan));

	/** How far a tier lock can actually reach in this format — stated, not implied. */
	let tierReach = $derived.by(() => {
		const selectable = activePlan.filter((s) => s.selectable).length;
		const paid = activePlan.filter((s) => s.usd > 0 || s.supplied).length;
		return { selectable, paid };
	});

	// ── Destinations ─────────────────────────────────────────────────────────
	let connectedPlatforms = $derived<string[]>(preview?.connectedPlatforms ?? []);
	let videoOnlyPlatforms = $derived<string[]>(preview?.videoOnlyPlatforms ?? []);
	/**
	 * A platform that only accepts video cannot take a still. The server has
	 * always known this and filtered those platforms AFTER generating, quietly
	 * saving a draft; the composer promised a live post anyway. Now the chip says
	 * so before the money is spent.
	 */
	const platformBlocked = (p: string) =>
		!format?.video && videoOnlyPlatforms.includes(p.toLowerCase());
	let selectablePlatforms = $derived(platforms.filter((p) => !platformBlocked(p)));
	let hasConnections = $derived(connectedPlatforms.length > 0);

	let deliverMode = $derived(
		typeof spec?.baseBody?.deliver === 'string' ? (spec.baseBody.deliver as string) : null
	);
	let destination = $derived.by(() => {
		if (!isPostKind) return null; // prompt-kind flows keep their own label
		if (isSeries)
			return {
				label: 'Open the campaign planner',
				hint: 'Nothing is generated here — the planner asks for a cadence and a mix, then queues the posts as drafts.'
			};
		// A batch of the user's own cards always lands as drafts: nothing typed a
		// hundred times over should be able to race straight to a live account.
		if (ownWords) {
			const n = cardQuotes.length;
			return {
				label: `Create ${n} ${n === 1 ? 'card' : 'cards'} — free`,
				hint: `Output: ${n} ${n === 1 ? 'draft' : 'drafts'} in the review queue. Your words, typeset on our servers — no model runs and nothing is charged. Approve each one in Review to post.`
			};
		}
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
				// A paid run must never be labelled like a free save (round-2 re-audit:
				// a spend button read "Save as draft", and a critic's stop-list missed it).
				label: 'Approve & generate draft',
				hint: 'Output: draft — no account is connected, so nothing can publish.'
			};
		if (selectablePlatforms.length === 0)
			return {
				label: 'Approve & generate draft',
				hint: 'Output: draft — no platform can take this post, so nothing publishes.'
			};
		// A date the user picked is an attended publish: generate-post writes a
		// 'scheduled' row at every autonomy level (its hold is `!scheduledDate &&
		// !mayPublishItself`) and the scheduler's poll sends it. True as written.
		if (scheduledDate)
			return {
				label: 'Approve & schedule',
				hint: `Output: scheduled post — publishes to ${selectablePlatforms.join(', ')} on ${scheduledDate}${scheduledTime ? ` at ${scheduledTime}` : ''}.`
			};
		// Unattended publishing is the persona's own setting. generate-post holds
		// the finished post as a DRAFT unless the level is 'fully_autonomous', so
		// only that level may be promised an immediate live post here. Say where
		// the post actually went: a marketer who has never opened /review has no
		// reason to look there for something a button called "publish now" made.
		if (autonomyLevel !== 'fully_autonomous')
			return {
				label: 'Approve & send to review',
				hint: `Output: draft in the review queue — ${autonomyLevel ? `this persona is set to ${AUTONOMY_LABELS[autonomyLevel].label}, so it does not publish` : 'this persona does not publish'} on its own. Approve it in Review to post to ${selectablePlatforms.join(', ')}.`
			};
		return {
			label: 'Approve & publish now',
			hint: `Output: LIVE post — publishes immediately to ${selectablePlatforms.join(', ')} as soon as generation completes.`
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

	/**
	 * Topic suggestions, free. The Studio archetypes are 42 topics somebody
	 * already wrote and the app already ships — offering them here costs nothing
	 * and beats a blank field. Deliberately a datalist, not a select: topic has
	 * always been free text and taking that away would be a downgrade for anyone
	 * who knows what they want to post.
	 */
	let topicSuggestions = $derived.by(() => {
		const wantsVideo = format?.video ?? true;
		const pool = STUDIO_TEMPLATES.filter((t) => {
			const isVideoTemplate =
				t.pipeline === 'Talking head' ||
				t.pipeline === 'Product motion' ||
				t.pipeline === 'Cinematic';
			return isVideoTemplate === wantsVideo;
		});
		const seen = new Set<string>();
		return pool
			.map((t) => t.baseBody.topic)
			.filter((t) => t && !seen.has(t) && seen.add(t))
			.slice(0, 24);
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
	// A seat refusal is the SERVER's verdict, read from the preview's 403. Access
	// is per persona (agent_access_role) and the account's workspace seat is only
	// an upper bound on it: a Viewer in one workspace can still own personas of
	// its own, so deciding here from the seat would block those. The server
	// already decides at preview time; the composer only has to say it well.
	let loadBlockedBySeat = $state(false);
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
		loadBlockedBySeat = false;
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
				// 403 + the route convention's JSON body is an access refusal; a bare
				// 403 (CSRF, origin) has no JSON and stays a plain failure with Retry.
				loadBlockedBySeat = res.status === 403 && data?.success === false;
				return;
			}
			preview = data.preview;

			prompt = preview.prompt ?? '';
			topic = preview.topic ?? '';
			scene = preview.scene ?? '';
			captions = preview.captions === true;
			aiBadge = preview.aiBadge === true;
			provider = preview.provider ?? 'auto';
			platforms = [...(preview.platforms ?? [])];
			products = Array.isArray(preview.products) ? preview.products : [];
			productPhotoUrl = preview.productPhotoUrl ?? '';
			characterRefUrl = preview.characterRefUrl ?? '';
			scheduledDate = preview.scheduledDate ?? '';
			scheduledTime = preview.scheduledTime ?? '';
			model = preview.model ?? '';
			voice = preview.voice ?? '';
			voices = Array.isArray(preview.voices) ? preview.voices : [];
			script = '';
			cardText = '';
			framingTouched = false;
			cardLayout = 'auto';
			cardPalette = 'auto';
			cardMode = 'director';
			cardQuotesRaw = '';
			cardLook = 'set';
			stillUrl = '';
			// The beat count opens on the one the server quoted this preview with, so
			// the footer's number and the plan behind it agree from the first paint.
			listCount = Number(preview.plan?.items) || 4;
			listItems = [];
			// A clip belongs to the persona it was ingested for; a re-resolve is a
			// different request (often a different persona) and must not inherit it.
			clearSourceClip();
			tier = 'manual';
			// The server's resolved defaults become the starting picks, so the plan
			// shown on open is the plan this request would run right now.
			picks = {
				...(preview.stillModel ? { still: preview.stillModel } : {}),
				...(preview.videoModel ? { video: preview.videoModel } : {}),
				...(preview.plan?.fixed?.talkinghead?.id
					? { talkinghead: preview.plan.fixed.talkinghead.id }
					: {}),
				...(preview.plan?.fixed?.director?.id ? { director: preview.plan.fixed.director.id } : {})
			};
			if (preview.kind === 'post') {
				formatId = preview.formatId ?? formatFromRequest(spec?.baseBody ?? null);
				kind = getFormat(formatId)?.kind ?? 'video';
				// A product id is only adopted when this composition actually feeds
				// one. Adopting it unconditionally is how product-free posts ended up
				// submitting a hidden product the user was never shown.
				productId = composition.product !== false ? (preview.product?.id ?? '') : '';
			}
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
		if (platformBlocked(p)) return;
		platforms = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
	}

	function pickKind(k: FormatKind) {
		if (kind === k) return;
		kind = k;
		const first = formatsOfKind(k)[0];
		if (first) pickFormat(first.id);
	}

	function pickFormat(id: string) {
		formatId = id;
		kind = getFormat(id)?.kind ?? kind;
		// A format switch changes which references the run feeds. Drop a product id
		// the new composition would ignore rather than submitting it invisibly.
		if (composition.product === false) productId = '';
	}

	/**
	 * Labels are positional — beat 3 is index 2 whether or not beats 1 and 2 were
	 * typed — so the array is padded rather than pushed onto. Written back whole
	 * because a rune tracks the assignment, not the element.
	 */
	function setBeat(i: number, value: string) {
		const next = Array.from(
			{ length: Math.max(listItems.length, i + 1) },
			(_, k) => listItems[k] ?? ''
		);
		next[i] = value;
		listItems = next;
	}

	function pickStepModel(step: StepKind, id: string) {
		picks = { ...picks, [step]: id };
		// An explicit pick outranks the lock; saying so beats a lock that silently
		// no longer describes the stack.
		tier = 'manual';
	}

	function pickTier(t: typeof tier) {
		tier = t;
		if (t !== 'manual') picks = {};
	}

	/**
	 * Ingest sits beside the generate endpoint this spec already targets, so it
	 * is derived from that rather than built out of `agentId` — that prop is
	 * optional and the single-persona surfaces never pass one.
	 */
	let sourceClipEndpoint = $derived(
		spec?.endpoint ? spec.endpoint.replace(/\/generate-post\/?$/, '/source-clip') : ''
	);

	function clearSourceClip() {
		sourceVideoUrl = '';
		sourceSeconds = null;
		sourceDims = null;
		sourceName = '';
		sourceError = null;
	}

	/**
	 * Upload → probe → re-quote. The clip only becomes part of the run once the
	 * server has MEASURED it: a probe that failed leaves nothing selected rather
	 * than a clip whose per-second stage would be quoted at a default length and
	 * billed at its real one. The server's own rejection text is surfaced
	 * verbatim — it is the only thing that knows which limit was hit.
	 */
	async function uploadSourceClip(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Cleared immediately so re-picking the SAME file after a rejection still
		// fires a change event — otherwise fix-and-retry silently does nothing.
		input.value = '';
		if (!file) return;
		clearSourceClip();
		if (!sourceClipEndpoint) {
			sourceError = 'This surface has no clip endpoint to upload to.';
			return;
		}
		sourceUploading = true;
		sourceName = file.name;
		try {
			const form = new FormData();
			form.append('clip', file);
			const res = await fetch(sourceClipEndpoint, { method: 'POST', body: form });
			const d = await res.json().catch(() => ({}));
			if (!res.ok || d?.success !== true)
				throw new Error(d?.error || `Could not accept that clip (HTTP ${res.status}).`);
			const url = typeof d.url === 'string' ? d.url : '';
			const secs = Number(d.durationSec);
			if (!url) throw new Error('The clip was accepted but no stored URL came back.');
			if (!Number.isFinite(secs) || secs <= 0)
				throw new Error('That clip’s length could not be measured, so it cannot be priced.');
			sourceVideoUrl = url;
			sourceSeconds = secs;
			sourceDims =
				Number.isFinite(Number(d.width)) && Number.isFinite(Number(d.height))
					? { width: Number(d.width), height: Number(d.height) }
					: null;
			sourceName = file.name;
		} catch (err) {
			const message = (err as Error).message;
			clearSourceClip();
			sourceError = message;
		} finally {
			sourceUploading = false;
		}
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
	// A post is four decisions in a real order — what it is, how it looks, what
	// builds it, where it goes — and the composer asks them in that order instead
	// of stacking every field into one scroll.
	//
	// The list is DERIVED, not fixed. A format whose whole stack is one free
	// renderer has nothing to configure, so it has no Craft step at all; a
	// prompt-kind run is a single decision and stays on one pane. A wizard for
	// two fields would be worse than the form it replaced.
	interface Step {
		id: 'single' | 'subject' | 'look' | 'craft' | 'deliver';
		label: string;
		question: string;
		blurb: string;
	}

	let steps = $derived.by<Step[]>(() => {
		if (!isPostKind)
			return [
				{
					id: 'single',
					label: 'Request',
					question: spec?.title ?? 'Confirm this request',
					blurb: 'This is the exact request that will be sent. Edit anything before approving.'
				}
			];
		const list: Step[] = [
			{
				id: 'subject',
				label: 'Subject',
				question: 'What are we posting?',
				blurb:
					'The topic, and the kind of thing this is. Everything after this adapts to what you pick here.'
			},
			{
				id: 'look',
				label: 'Look',
				question: 'How should it look?',
				blurb:
					'Only the controls this format actually uses. Leave anything blank and the Director writes it.'
			}
		];
		if (hasCraftStep)
			list.push({
				id: 'craft',
				label: 'Craft',
				question: 'What builds it?',
				blurb:
					'Every stage that will run, what it is for, and what it costs. Set one quality level, or choose stage by stage.'
			});
		list.push({
			id: 'deliver',
			label: 'Deliver',
			question: 'Ready to make this?',
			blurb: 'What you are about to generate, what it costs, and where it lands.'
		});
		return list;
	});

	let stepIndex = $state(0);
	// Clamp rather than reset: switching format mid-flow must never strand the
	// user on a step index that no longer exists.
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
		// Re-entrancy first: everything below either spends or hands off.
		if (submitting) return;
		if (isSeries) {
			onOpenPlanner?.();
			return;
		}
		// Belt and braces with the disabled submit: a transfer posted without its
		// clip is coerced server-side to a plain b-roll clip, which spends the
		// money on a post nobody asked for.
		if (missingSourceClip) return;
		const body: Record<string, unknown> = { ...(spec?.baseBody ?? {}) };
		if (isPromptKind) {
			body.prompt = prompt;
		}
		if (model) body.model = model;
		if (isPostKind) {
			// The format is the request: media/format/still/refs come from ONE place,
			// so the thing shown and the thing sent cannot describe different runs.
			Object.assign(body, requestFor(formatId));
			body.topic = topic || undefined;
			body.provider = provider;
			body.captions = captions;
			body.ai_badge = aiBadge;
			body.platforms = selectablePlatforms;
			// Only the references this composition feeds. A hidden field that is
			// submitted anyway is how product-free posts were steered by a product
			// the user never saw offered.
			// Send the composition this dialog actually SHOWED. Leaving the caller's
			// original refs in place would let a format switch generate against a
			// contract the user never saw.
			const chosen = getFormat(formatId);
			body.refs = chosen?.request.refs
				? { ...chosen.request.refs }
				: { character: usesCharacterRef, product: usesProductRef };
			body.product_id = usesProductRef && productId ? productId : undefined;
			body.product_photo_url = usesProductRef && productPhotoUrl ? productPhotoUrl : undefined;
			body.character_ref_url = usesCharacterRef && characterRefUrl ? characterRefUrl : undefined;
			body.scene = needs('scene') && scene ? scene : undefined;
			body.script = needs('script') && script.trim() ? script.trim() : undefined;
			body.voice = needs('voice') && voice ? voice : undefined;
			body.card_text = needs('cardText') && cardText.trim() ? cardText.trim() : undefined;
			body.card_layout = needs('cardLayout') && cardLayout !== 'auto' ? cardLayout : undefined;
			body.card_palette = needs('cardPalette') && cardPalette !== 'auto' ? cardPalette : undefined;
			// The batch replaces the single card. A body carrying card_texts is routed
			// by the persona page to /cards, which calls no model and records $0.
			if (ownWords) {
				if (ownWordsBlocked) return;
				body.card_texts = cardQuotes;
				body.card_look = cardLook;
				body.card_text = undefined;
			}
			body.framing = needs('framing') && framingTouched ? framing : undefined;
			body.still_model = picks.still || undefined;
			body.video_model = picks.video || undefined;
			body.talking_head_model = picks.talkinghead || undefined;
			body.llm_model = picks.director || undefined;
			body.still_url = stillUrl || undefined;
			// The ingested clip and the duration the SERVER measured — sent only for
			// a format that reads them, like every other need-gated field here, and
			// re-validated on arrival because it is the basis of the bill.
			body.source_video_url = needs('sourceVideo') && sourceVideoUrl ? sourceVideoUrl : undefined;
			body.source_seconds = needs('sourceVideo') && sourceSeconds ? sourceSeconds : undefined;
			// The beat count goes even when untouched: it is the number this screen
			// quoted, and a run that used a different one would bill past it. The
			// labels go only if the user wrote any — blanks included, because position
			// IS the beat and a gap has to survive the trip.
			body.list_count = needs('listItems') ? listCount : undefined;
			body.list_items = needs('listItems') && namedBeats ? listLabels : undefined;
			body.scheduled_date = scheduledDate || undefined;
			body.scheduled_time = scheduledTime || undefined;
		}
		// Set immediately before dispatch, never before the early returns above —
		// a blocked or handed-off click must leave the button usable.
		submitting = true;
		onConfirm(body);
	}

	/**
	 * Money on this screen is always what the CUSTOMER pays — the provider
	 * estimate converted at the platform markup, in their currency. Printing the
	 * provider cost here (as this screen used to) understated every quote.
	 */
	const money = (usd: number) => quote(usd);
	let metered = $derived(pricingContext().metered);
	let costLabel = $derived(metered ? 'Est. charge' : 'Est. cost');

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
		<!-- Three refusals, three answers. A plan refusal points at a plan that
		     includes it; a seat refusal names who can change the seat; only a
		     transient failure gets Retry. Retrying a permission is a dead click
		     that reads as "broken", and was the one permission state left in the
		     product that looked like an outage. -->
		<div class="composer-error" role="alert">
			<strong
				>{loadBlockedByPlan
					? 'Not included in your plan'
					: loadBlockedBySeat
						? 'Your seat cannot generate for this persona'
						: "Can't prepare this generation"}</strong
			>
			<p>{loadError}</p>
			{#if loadBlockedByPlan}
				<a class="btn-retry" href="/billing">Compare plans</a>
			{:else if loadBlockedBySeat}
				<p>A workspace admin can change your seat.</p>
			{:else}
				<button type="button" class="btn-retry" onclick={() => loadPreview()}>Retry</button>
			{/if}
		</div>
	{:else if preview}
		<!-- ── The journey ──────────────────────────────────────────────
		     Derived from what is actually being composed: four decisions for a
		     post, three when the format has nothing to configure, one for a
		     prompt-kind run. -->
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
					<!-- ── Prompt-kind: one decision, one pane ─────────────────── -->
					{#if isPromptKind}
						{#if modelOptions.length}
							<div class="fld">
								<span class="fld-label" id="gc-model-label"
									>Model — pick your budget vs quality</span
								>
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
												<span class="model-usd">{money(m.usd)}</span>
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

					<!-- ── Subject: what are we posting? ───────────────────────── -->
					{#if isPostKind && currentStep.id === 'subject'}
						<div class="fld">
							<label class="fld-label" for="gc-topic">Topic</label>
							<input
								id="gc-topic"
								list="gc-topic-ideas"
								autocomplete="off"
								bind:value={topic}
								placeholder="Leave blank to let the persona pick"
							/>
							<datalist id="gc-topic-ideas">
								{#each topicSuggestions as t}
									<option value={t}></option>
								{/each}
							</datalist>
							<span class="hint">
								Type anything, or start from one of the {topicSuggestions.length} archetypes this persona's
								Studio already ships. Blank still lets the persona choose.
							</span>
						</div>

						<div class="fld">
							<span class="fld-label" id="gc-kind-label">What kind of post?</span>
							<div class="kinds" role="radiogroup" aria-labelledby="gc-kind-label">
								{#each availableKinds as k}
									<button
										type="button"
										class="kind"
										class:on={kind === k.id}
										role="radio"
										aria-checked={kind === k.id}
										onclick={() => pickKind(k.id)}
									>
										<span class="kind-name">{k.label}</span>
										<span class="kind-sub">{k.sub}</span>
									</button>
								{/each}
							</div>
						</div>

						<div class="fld">
							<span class="fld-label" id="gc-format-label">Format</span>
							<div class="formats" role="radiogroup" aria-labelledby="gc-format-label">
								{#each formatsOfKind(kind).filter(buildable) as f (f.id)}
									{@const costSteps = (
										planPipeline({
											formatId: f.id,
											options: planOptions,
											fixed: fixedFor(f),
											tier: tier === 'manual' ? undefined : tier,
											shots: preview?.plan?.shots ?? 4,
											oneOffs: planOneOffs,
											seconds: sourceSeconds ?? undefined,
											items: listCount
										})
									).map((st) => st.usd)}
									{@const planLocked = f.id === 'cinematic' && cinematicBlocked !== null}
									<button
										type="button"
										class="fmt"
										class:on={formatId === f.id}
										role="radio"
										aria-checked={formatId === f.id}
										disabled={planLocked}
										title={planLocked ? (cinematicBlocked ?? undefined) : undefined}
										onclick={() => pickFormat(f.id)}
									>
										<span class="fmt-top">
											<span class="fmt-name"
												>{f.label}{planLocked ? ' — not in your plan' : ''}</span
											>
											<span class="fmt-cost">{f.steps.length ? quoteSteps(costSteps) : 'varies'}</span>
										</span>
										<span class="fmt-note">{f.note}</span>
									</button>
								{/each}
							</div>
							{#if kind === 'series'}
								<span class="hint">
									A run of posts is a different question from one post — cadence, horizon and a mix
									of formats. Approving here opens the campaign planner, which asks those.
								</span>
							{/if}
						</div>

						{#if isGraphicCard || !usesCharacterRef || !usesProductRef}
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
										<strong>Typographic card.</strong> The card's text IS the artwork. No reference images
										are sent — no persona face, no product photo.
									{:else if !usesCharacterRef && !usesProductRef}
										<strong>No reference images.</strong> This composition includes neither the persona
										nor a product — the scene is generated purely from the prompt.
									{:else if !usesCharacterRef}
										<strong>Product reference only.</strong> The persona does not appear in this composition,
										so no face reference is sent (and none is generated).
									{:else}
										<strong>Face reference only.</strong> Product-free channel content — the brand product
										photo is not attached.
									{/if}
								</span>
							</p>
						{/if}
					{/if}

					<!-- ── Look: rendered from format.needs, nothing else ──────── -->
					{#if isPostKind && currentStep.id === 'look'}
						{#if needs('planner')}
							<p class="comp-note" role="note">
								<span>
									The planner takes over from here — how many posts, over how long, in what mix.
									This composer handles one post.
								</span>
							</p>
						{/if}

						{#if needs('sourceVideo')}
							<!-- The one control whose value is not typed but UPLOADED, and the
							     only Look field the run cannot proceed without: everything else
							     here has a Director-written default, and a transfer has nothing
							     to transform. -->
							<div class="fld">
								<label class="fld-label" for="gc-clip">
									Source clip{sourceVideoUrl ? ' — replace' : ''}
								</label>
								{#if sourceVideoUrl}
									<div class="clip-ok">
										<video
											class="clip-vid"
											src={sourceVideoUrl}
											preload="metadata"
											controls
											muted
											playsinline
										></video>
										<div class="clip-facts">
											<strong>{sourceName || 'Clip accepted'}</strong>
											<span>
												{sourceSeconds?.toFixed(1)}s{sourceDims
													? ` · ${sourceDims.width}×${sourceDims.height}`
													: ''} — measured on the server. This is the number the transfer stage is billed
												on, and the quote below already uses it.
											</span>
										</div>
									</div>
								{/if}
								{#if sourceUploading}
									<div class="clip-busy" role="status" aria-live="polite">
										<span class="spinner" aria-hidden="true"></span>
										<span>Uploading {sourceName} and measuring it…</span>
									</div>
								{:else}
									<input
										id="gc-clip"
										type="file"
										class="clip-input"
										accept="video/mp4,video/quicktime,video/webm,video/*"
										aria-describedby="gc-clip-hint"
										onchange={uploadSourceClip}
									/>
								{/if}
								{#if sourceError}
									<!-- The server's own words. It is the only party that knows which
									     limit was hit, and paraphrasing it here would go stale the
									     first time a limit moves. -->
									<p class="clip-err" role="alert">{sourceError}</p>
								{/if}
								<span class="hint" id="gc-clip-hint">
									MP4, MOV or WebM — up to 100MB and 30 seconds. Nothing is generated from it until
									you approve; its measured length is what this run is priced per second on.
								</span>
							</div>
						{/if}

						{#if needs('cardText')}
							<!-- Who writes the line. The Director is a paid stage; the user's own
							     words are not — and they can come a hundred at a time. -->
							<div class="fld">
								<span class="fld-label" id="gc-cardmode-label">Words</span>
								<div class="segs" role="radiogroup" aria-labelledby="gc-cardmode-label">
									<button
										type="button"
										class="seg"
										class:on={cardMode === 'director'}
										role="radio"
										aria-checked={cardMode === 'director'}
										onclick={() => (cardMode = 'director')}>The Director writes it</button
									>
									<button
										type="button"
										class="seg"
										class:on={cardMode === 'own'}
										role="radio"
										aria-checked={cardMode === 'own'}
										onclick={() => (cardMode = 'own')}>My own words — free</button
									>
								</div>
							</div>
							{#if cardMode === 'own'}
								<div class="fld">
									<label class="fld-label" for="gc-cardquotes">
										Your quotes
										<span class="fld-count" class:over={cardQuotes.length > MAX_CARD_QUOTES}>
											{cardQuotes.length} of {MAX_CARD_QUOTES}
											{cardQuotes.length === 1 ? 'card' : 'cards'}
										</span>
									</label>
									<textarea
										id="gc-cardquotes"
										class="quotes"
										aria-describedby="gc-cardquotes-hint"
										bind:value={cardQuotesRaw}
										rows="8"
										placeholder="One quote per line.&#10;Leave a blank line between quotes that need their own line breaks (a list, a myth/fact)."
									></textarea>
									<span class="hint" id="gc-cardquotes-hint">
										Each quote becomes one card, typeset on our servers. No model runs, so nothing
										is charged.
									</span>
									{#if cardQuotes.length > MAX_CARD_QUOTES}
										<span class="warn-line"
											>Up to {MAX_CARD_QUOTES} at a time — trim the list to continue.</span
										>
									{:else if cardQuotes.length > 0 && cardQuotesOk < cardQuotes.length}
										<ul class="quote-problems">
											{#each cardQuotes as q, i (i)}
												{#if cardQuoteProblems[i]}
													<li>
														<b>“{q.length > 48 ? q.slice(0, 48) + '…' : q}”</b> — {cardQuoteProblems[
															i
														]}
													</li>
												{/if}
											{/each}
										</ul>
									{/if}
								</div>
								<div class="fld">
									<label class="fld-label" for="gc-cardlook">Look across the set</label>
									<select id="gc-cardlook" bind:value={cardLook}>
										{#each CARD_LOOKS as l (l.id)}
											<option value={l.id}>{l.label}</option>
										{/each}
									</select>
									<span class="hint">{CARD_LOOKS.find((l) => l.id === cardLook)?.blurb}</span>
								</div>
							{:else}
								<div class="fld">
									<label class="fld-label" for="gc-cardtext">Card text</label>
									<textarea
										id="gc-cardtext"
										aria-describedby="gc-cardtext-hint"
										bind:value={cardText}
										rows="3"
										placeholder="Leave blank and the Director writes the line"
									></textarea>
									<span class="hint" id="gc-cardtext-hint">
										Line breaks decide the shape — one line reads as a statement, several become a
										stack or a list.
									</span>
								</div>
							{/if}
							<div class="row">
								<div class="fld">
									<label class="fld-label" for="gc-cardlayout">Layout</label>
									<select id="gc-cardlayout" bind:value={cardLayout}>
										<option value="auto">Auto — match the text</option>
										<option value="statement">Statement</option>
										<option value="quote">Quote</option>
										<option value="stack">Stack</option>
										<option value="list">List</option>
										<option value="split">Split</option>
									</select>
								</div>
								<div class="fld">
									<label class="fld-label" for="gc-cardpalette">Palette</label>
									<select id="gc-cardpalette" bind:value={cardPalette}>
										<option value="auto">Auto — from the brand brief</option>
										<option value="ink">Ink</option>
										<option value="warm">Warm</option>
										<option value="cool">Cool</option>
										<option value="mono">Mono</option>
									</select>
								</div>
							</div>
						{/if}

						{#if needs('script')}
							<div class="fld">
								<label class="fld-label" for="gc-script">Spoken line</label>
								<textarea
									id="gc-script"
									aria-describedby="gc-script-hint"
									bind:value={script}
									rows="3"
									placeholder="Leave blank and the Director writes it"
								></textarea>
								<span class="hint" id="gc-script-hint">
									What the persona says on camera. Blank keeps the Director's line, which is written
									from the topic and the brand voice.
								</span>
							</div>
						{/if}

						{#if needs('voice') && voices.length}
							<div class="fld">
								<label class="fld-label" for="gc-voice">Voice</label>
								<select id="gc-voice" bind:value={voice}>
									{#each voices as v}
										<option value={v.name}
											>{v.label} — {v.style}{v.accent ? ` (${v.accent})` : ''}</option
										>
									{/each}
								</select>
								<span class="hint">
									Defaults to the persona's pinned voice. Changing it here applies to this post
									only.
								</span>
							</div>
						{/if}

						{#if needs('listItems')}
							<!-- The list itself. Rendered off the need like every other control here,
							 and split in two because the count is a PRICE — the voiceover runs
							 once per beat — while the labels are only content the Director would
							 otherwise write. Neither is required to run. -->
							<div class="fld">
								<span class="fld-label" id="gc-beats-label">How many beats</span>
								<div class="chips" role="radiogroup" aria-labelledby="gc-beats-label">
									{#each BEAT_CHOICES as n}
										<button
											type="button"
											class="chip"
											class:on={listCount === n}
											role="radio"
											aria-checked={listCount === n}
											aria-describedby="gc-beats-hint"
											onclick={() => (listCount = n)}>{n}</button
										>
									{/each}
								</div>
								<span class="hint" id="gc-beats-hint">
									The hook and the items it counts down. Each beat is voiced as its own take, so its
									on-screen reveal lands on the words instead of on a guess — which is why the price
									moves when this does.
								</span>
							</div>
							<div class="fld">
								<span class="fld-label" id="gc-beatlist-label">The list (optional)</span>
								<div class="beats" role="group" aria-labelledby="gc-beatlist-label">
									{#each beatRows as i (i)}
										<label class="beat">
											<span class="beat-n">{i + 1}</span>
											<input
												value={listItems[i] ?? ''}
												aria-label="Beat {i + 1}"
												placeholder={i === 0
													? 'The hook — leave blank and the Director writes it'
													: 'Leave blank and the Director writes this one'}
												oninput={(e) => setBeat(i, (e.currentTarget as HTMLInputElement).value)}
											/>
										</label>
									{/each}
								</div>
								<span class="hint">
									What you type is the label that appears on screen for that beat and stays there.
									Fill in none, some or all of them — a blank row is one the Director writes, and it
									still gets its own beat.
								</span>
							</div>
						{/if}

						{#if needs('scene')}
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
						{/if}

						{#if needs('framing')}
							<div class="fld">
								<span class="fld-label" id="gc-framing-label">Framing</span>
								<div class="chips" role="radiogroup" aria-labelledby="gc-framing-label">
									<button
										type="button"
										class="chip"
										class:on={framingTouched && framing === 'front'}
										role="radio"
										aria-checked={framingTouched && framing === 'front'}
										onclick={() => {
											framing = 'front';
											framingTouched = true;
										}}>Front camera</button
									>
									<button
										type="button"
										class="chip"
										class:on={framing === 'mirror'}
										role="radio"
										aria-checked={framing === 'mirror'}
										onclick={() => {
											framing = 'mirror';
											framingTouched = true;
										}}>Mirror selfie</button
									>
									<button
										type="button"
										class="chip"
										class:on={framing === 'third'}
										role="radio"
										aria-checked={framing === 'third'}
										onclick={() => {
											framing = 'third';
											framingTouched = true;
										}}>Third person</button
									>
								</div>
								<span class="hint">
									How the shot was supposedly taken. Leave it alone and this run keeps whatever the
									template or the Director decides; front camera and mirror selfie read as real,
									third person reads as an ad — which is sometimes what you want.
								</span>
							</div>
						{/if}

						{#if usesProductRef && needs('product') && products.length}
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
									Products come from the <strong>Brand Brief</strong> selected in this persona's Profile.
								</span>
							</div>
						{/if}

						{#if (usesProductRef && needs('product')) || (usesCharacterRef && needs('face'))}
							<!-- Only the reference fields this composition actually feeds. A field
							     for a reference the run won't use would be a lie — it's not shown. -->
							<div class="row">
								{#if usesProductRef && needs('product')}
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
								{#if usesCharacterRef && needs('face')}
									<div class="fld">
										<label class="fld-label" for="gc-character-url">Face override URL</label>
										<input
											id="gc-character-url"
											inputmode="url"
											aria-describedby="gc-character-hint"
											bind:value={characterRefUrl}
											placeholder="https://…"
										/>
										{#if characterRefUrl}
											<img
												class="url-preview"
												src={characterRefUrl}
												alt="Face reference preview"
												width="84"
												height="84"
												loading="lazy"
												onload={showImg}
												onerror={hideOnError}
											/>
										{/if}
										<!-- Blank ≠ no face. The server sends the persona's pinned face (the
										     same image the Profile tab calls the profile picture) so the
										     character stays consistent. -->
										<span class="hint char-auto" id="gc-character-hint">
											Blank uses this persona's pinned face — the one set on their Profile. Paste a
											URL only to override it for this post.
										</span>
									</div>
								{/if}
							</div>
						{/if}

						{#if needs('captions')}
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

					<!-- ── Craft: the format's own step plan, priced ───────────── -->
					{#if isPostKind && currentStep.id === 'craft'}
						<div class="tierbar">
							<span class="tier-label" id="gc-tier-label">Quality</span>
							<div class="segs" role="radiogroup" aria-labelledby="gc-tier-label">
								{#each ['budget', 'balanced', 'premium', 'manual'] as t}
									<button
										type="button"
										class="seg"
										class:on={tier === t}
										role="radio"
										aria-checked={tier === t}
										onclick={() => pickTier(t as typeof tier)}
									>
										{t === 'manual' ? 'Choose per stage' : TIER_LABEL[t as 'budget']}
									</button>
								{/each}
							</div>
							<span class="tier-reach">
								{#if tier === 'manual'}
									Each stage below uses its default until you change it.
								{:else}
									Applies to <strong>{tierReach.selectable}</strong> of {tierReach.paid} paid stages in
									this format — the rest have only one model wired.
								{/if}
							</span>
						</div>

						<div class="stack">
							{#each activePlan as s (s.kind)}
								{@const options = planOptions[s.kind] ?? []}
								<div class="stepcard" class:supplied={s.supplied}>
									<div class="sc-top">
										<div class="sc-id">
											<span class="sc-name">
												{s.label}
												{#if s.model.tier}
													<span class="model-tier tier-{s.model.tier}">
														{s.model.tier === 'free' ? 'Free' : TIER_LABEL[s.model.tier]}
													</span>
												{/if}
											</span>
											<span class="sc-purpose">{s.purpose}</span>
										</div>
										<span class="sc-price">
											<strong>{s.supplied ? money(0) : money(s.usd)}</strong>
										</span>
									</div>
									<div class="sc-ctl">
										{#if s.supplied}
											<span class="sc-note"
												>{s.kind === 'still'
													? 'Using the image you supplied'
													: 'Using your own words'} — this stage won't run.</span
											>
										{:else if options.length > 1}
											<select
												aria-label="Model for the {s.label} stage"
												value={s.model.id}
												onchange={(e) =>
													pickStepModel(s.kind, (e.currentTarget as HTMLSelectElement).value)}
											>
												{#each options as m}
													<option value={m.id}>{m.label} — {money(m.usd)}</option>
												{/each}
											</select>
										{:else}
											<span class="sc-note"
												>{s.model.label} — the only model wired for this stage.</span
											>
										{/if}
										{#if s.via === 'tier'}
											<span class="sc-via">set by quality level</span>
										{:else if s.via === 'nearest'}
											<span class="sc-via warn">no {tier} model here — nearest used</span>
										{:else if s.via === 'picked' && options.length > 1}
											<span class="sc-via">your pick</span>
										{/if}
									</div>
									{#if s.model.caveat && !s.supplied}
										<p class="model-warn" role="note">
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
											<span>{s.model.caveat}</span>
										</p>
									{/if}
								</div>
							{/each}
						</div>

						{#if activePlan.some((s) => s.kind === 'still')}
							<!-- The only honest "skip a stage": supply its output. Unchecking a
							     stage outright would build pipelines that cannot run (a talking
							     head with no voiceover), so it isn't offered. -->
							<div class="fld">
								<label class="fld-label" for="gc-still-url">Use my own still (optional)</label>
								<input
									id="gc-still-url"
									inputmode="url"
									aria-describedby="gc-still-url-hint"
									bind:value={stillUrl}
									placeholder="https://…"
								/>
								<span class="hint" id="gc-still-url-hint">
									Paste an image and the still stage doesn't run — everything after it uses your
									image instead. The quote above drops accordingly.
								</span>
							</div>
						{/if}

						<div class="fld">
							<label class="fld-label" for="gc-provider">Provider routing</label>
							<select id="gc-provider" bind:value={provider}>
								<option value="auto">Auto — fal, falling back to OpenRouter</option>
								<option value="fal">fal.ai only</option>
								<option value="openrouter">OpenRouter only</option>
							</select>
						</div>
					{/if}

					<!-- ── Deliver: what is about to be made, then where it goes ── -->
					{#if isPostKind && currentStep.id === 'deliver'}
						<div class="confirm">
							<div class="confirm-preview">
								{#if isGraphicCard}
									<!-- A card is deterministic: this is genuinely what comes out. -->
									<div class="frame frame-card">
										<span
											>{ownWords
												? cardQuotes[0]
												: cardText || 'The Director writes this line'}</span
										>
									</div>
									<span class="frame-cap">
										{ownWords
											? `1 of ${cardQuotes.length} — your words, one card each`
											: cardText
												? 'The card that will be made'
												: 'Layout preview — the line is written at run time'}
									</span>
								{:else}
									<!-- Everything else is written by the Director at run time, so the
									     honest preview is the INPUTS, labelled as inputs. A pretty
									     stand-in frame would be the worst possible lie on this screen. -->
									<div class="frame frame-refs">
										<div class="frame-thumbs">
											{#if usesCharacterRef && characterRefUrl}
												<img
													src={characterRefUrl}
													alt="Face reference"
													width="56"
													height="56"
													loading="lazy"
													onerror={hideOnError}
												/>
											{/if}
											{#if usesProductRef && productPhotoUrl}
												<img
													src={productPhotoUrl}
													alt="Product reference"
													width="56"
													height="56"
													loading="lazy"
													onerror={hideOnError}
												/>
											{/if}
											{#if !characterRefUrl && !productPhotoUrl}
												<span class="frame-empty">No reference images</span>
											{/if}
										</div>
										<span class="frame-meta">9:16 · {format?.video ? 'video' : 'still'}</span>
									</div>
									<span class="frame-cap">
										The references this run feeds — not the result. The frame itself is written by
										the Director when you approve.
									</span>
								{/if}
							</div>

							<dl class="summary">
								<div class="sumrow">
									<dt>Making</dt>
									<dd><strong>{format?.label}</strong> — {format?.note}</dd>
								</div>
								<div class="sumrow">
									<dt>About</dt>
									<dd>{topic || 'whatever this persona feels like posting'}</dd>
								</div>
								{#if needs('listItems')}
									<div class="sumrow">
										<dt>The list</dt>
										<dd>
											<strong>{listCount} beats</strong>{namedBeats
												? ` — ${namedBeats} written by you, the rest by the Director.`
												: ' — all written by the Director.'}
											The voiceover runs once per beat, which is what the estimate below counts.
										</dd>
									</div>
								{/if}
								{#if needs('sourceVideo')}
									<div class="sumrow">
										<dt>From</dt>
										<dd>
											{#if sourceSeconds}
												<strong>{sourceName || 'your clip'}</strong> — {sourceSeconds.toFixed(1)}s,
												and the transfer is billed per second of it.
											{:else}
												No clip yet — this format transforms one, so it cannot run without it.
											{/if}
										</dd>
									</div>
								{/if}
								<div class="sumrow">
									<dt>Built by</dt>
									<!-- Only the stages that RUN. A supplied stage (the user's still, the
									     user's words) is not a builder, and naming it here would claim a
									     Director wrote lines the user typed. -->
									<dd>
										{[
											...(ownWords ? ['Your words'] : []),
											...activePlan.filter((s) => !s.supplied).map((s) => s.label)
										].join(' → ') || '—'}
									</dd>
								</div>
								<div class="sumrow">
									<dt>{costLabel}</dt>
									<dd>
										<strong>{planPrice}</strong>
										{ownWords
											? ' — no model runs, so nothing is charged'
											: !metered
												? ' — estimated, nothing is debited'
												: preview?.payer?.kind === 'workspace_owner'
													? ` — taken from the ${preview.payer.name ?? 'workspace'} wallet (the workspace owner's) when you approve`
													: ' — taken from your balance when you approve'}
									</dd>
								</div>
							</dl>
						</div>

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
										{@const blocked = platformBlocked(p)}
										<button
											type="button"
											class="chip"
											class:on={platforms.includes(p) && !blocked}
											class:blocked
											disabled={blocked}
											aria-pressed={platforms.includes(p) && !blocked}
											title={blocked
												? `${p} only accepts video — this format makes a still.`
												: undefined}
											onclick={() => togglePlatform(p)}>{p}</button
										>
									{/each}
								</div>
								<span class="hint" id="gc-platforms-hint">
									{#if preview.connectedPlatforms.some((p: string) => platformBlocked(p))}
										Greyed accounts only accept video, and this format makes a still — they are left
										out instead of failing after you've paid.
									{:else}
										Only connected platforms are shown — a post only publishes where an account is
										connected.
									{/if}
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
									a platform first, then it can go out. You can still generate it as a draft below —
									that is a paid generation, at the price shown.
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
		     lists every model in the Craft step's plan, and the running price is
		     pinned in the footer on every step — repeating either here just
		     printed the same number twice. -->
		{#if !isPostKind && (preview.model || preview.provider)}
			<div class="meta">
				{#if preview.model}<span>Model <code>{preview.model}</code></span>{/if}
				{#if preview.provider}<span>via {preview.provider}</span>{/if}
			</div>
		{/if}
	{/if}

	{#snippet footer()}
		<!-- The running price lives in the footer, visible on EVERY step. It is the
		     one number that should never be a surprise at the end of a journey —
		     and it is what the customer pays, not what the provider charges us. -->
		{#if preview}
			<span class="foot-cost" aria-live="polite">
				<span class="foot-cost-label">{costLabel}</span>
				<strong>{isPostKind ? planPrice : money(liveCost)}</strong>
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
			<button
				class="btn-primary"
				disabled={submitting ||
					loading ||
					!!loadError ||
					!preview ||
					missingSourceClip ||
					ownWordsBlocked}
				title={loadBlockedBySeat
					? loadError
					: missingSourceClip
						? 'Add a source clip on the Look step — this format transforms one.'
						: undefined}
				onclick={confirm}
			>
				{submitting
					? 'Starting…'
					: (destination?.label ?? spec?.confirmLabel ?? 'Approve & generate')}
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
	/* ── Kind → format cascade (Subject) ────────────────────────────────── */
	.kinds {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.kind {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		min-width: 116px;
		padding: 0.55rem 0.85rem;
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		text-align: left;
		font: inherit;
	}
	.kind:hover {
		border-color: var(--border-hover);
	}
	.kind.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.kind-name {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.kind-sub {
		font-size: 0.72rem;
		color: var(--text-dim);
	}
	.formats {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 640px) {
		.formats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.fmt {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		text-align: left;
		font: inherit;
	}
	.fmt:hover {
		border-color: var(--border-hover);
	}
	.fmt.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.fmt-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.fmt-name {
		font-weight: 600;
		font-size: 0.88rem;
	}
	.fmt-cost {
		font-size: 0.78rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.fmt-note {
		font-size: 0.75rem;
		color: var(--text-dim);
		line-height: 1.4;
	}

	/* ── Craft: quality level + the format's own stages ─────────────────── */
	.tierbar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.7rem 0.8rem;
		margin-bottom: 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.tier-label {
		font-size: 0.8rem;
		font-weight: 600;
	}
	.segs {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		flex-wrap: wrap;
	}
	.seg {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.28rem 0.6rem;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
	}
	.seg.on {
		background: var(--accent-dark);
		color: #fff;
		font-weight: 600;
	}
	.tier-reach {
		flex: 1 1 200px;
		min-width: 180px;
		font-size: 0.76rem;
		color: var(--text-dim);
	}
	.stack {
		display: grid;
		gap: 0.5rem;
	}
	.stepcard {
		display: grid;
		gap: 0.45rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
	}
	.stepcard.supplied {
		opacity: 0.65;
	}
	.sc-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
	}
	.sc-id {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.sc-name {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		font-weight: 600;
		font-size: 0.88rem;
	}
	.sc-purpose {
		font-size: 0.76rem;
		color: var(--text-dim);
		line-height: 1.45;
	}
	.sc-price strong {
		font-size: 0.92rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.sc-ctl {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.sc-ctl select {
		max-width: 100%;
		flex: 1 1 240px;
	}
	.sc-note {
		font-size: 0.75rem;
		color: var(--text-dim);
	}
	.sc-via {
		font-size: 0.7rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.sc-via.warn {
		color: var(--warning-text);
	}
	.model-tier.tier-free {
		background: var(--surface-3, var(--surface-2));
		color: var(--text-dim);
	}

	/* ── Deliver: what is about to be made ──────────────────────────────── */
	.confirm {
		display: grid;
		gap: 0.9rem;
		margin-bottom: 1rem;
	}
	@media (min-width: 640px) {
		.confirm {
			grid-template-columns: 170px minmax(0, 1fr);
			align-items: start;
		}
	}
	.confirm-preview {
		display: grid;
		gap: 0.35rem;
	}
	.frame {
		aspect-ratio: 9 / 16;
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		overflow: hidden;
		display: grid;
		place-items: center;
		padding: 0.8rem;
		text-align: center;
	}
	.frame-card {
		background: linear-gradient(150deg, var(--accent-dark, #2c2450), var(--accent));
	}
	.frame-card span {
		color: #fff;
		font-weight: 700;
		font-size: 0.95rem;
		line-height: 1.25;
		white-space: pre-wrap;
	}
	.frame-refs {
		background: var(--surface-2);
		align-content: center;
		gap: 0.5rem;
	}
	.frame-thumbs {
		display: flex;
		gap: 0.35rem;
		justify-content: center;
	}
	.frame-thumbs img {
		width: 56px;
		height: 56px;
		border-radius: 8px;
		object-fit: cover;
		border: 1px solid var(--border);
	}
	.frame-empty,
	.frame-meta {
		font-size: 0.72rem;
		color: var(--text-dim);
	}
	.frame-cap {
		font-size: 0.7rem;
		color: var(--text-dim);
		line-height: 1.4;
	}
	.summary {
		margin: 0;
		display: grid;
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}
	.sumrow {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr);
		gap: 0.6rem;
		padding: 0.5rem 0.7rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.82rem;
	}
	.sumrow:last-child {
		border-bottom: 0;
	}
	.sumrow dt {
		color: var(--text-dim);
		font-size: 0.75rem;
	}
	.sumrow dd {
		margin: 0;
	}
	@media (max-width: 480px) {
		.sumrow {
			grid-template-columns: 1fr;
			gap: 0.1rem;
		}
	}

	/* A platform that cannot accept this format's media. Disabled rather than
	   hidden: "YouTube is connected but can't take a still" is information. */
	.chip.blocked {
		opacity: 0.5;
		cursor: not-allowed;
		text-decoration: line-through;
	}
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
		color: var(--accent-text);
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
	@media (max-width: 640px) {
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
		background: var(--accent-dark);
		border-color: var(--accent-dark);
		color: #fff;
	}
	.hint {
		display: block;
		margin-top: 0.3rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	/* "My own words" — the batch textarea and its live count. */
	.fld-count {
		margin-left: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--accent-text);
	}
	.fld-count.over {
		color: var(--error-text);
	}
	.fld textarea.quotes {
		min-height: 9.5rem;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.warn-line {
		display: block;
		margin-top: 0.35rem;
		font-size: 0.75rem;
		color: var(--error-text);
	}
	.quote-problems {
		margin: 0.35rem 0 0;
		padding-left: 1rem;
		font-size: 0.74rem;
		color: var(--warning-text);
		line-height: 1.45;
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
		color: var(--accent-text);
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
		background: var(--accent-dark);
		border: 1px solid var(--accent-dark);
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
	/* ── The list (Look) ────────────────────────────────────────────────── */
	.beats {
		display: grid;
		gap: 0.4rem;
	}
	.beat {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.beat-n {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 600;
	}
	.beat input {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* ── Source clip (Look) ─────────────────────────────────────────────── */
	/* The accepted clip is shown as a real, playable video rather than a poster
	   frame: this format's whole promise is the timing of the thing you handed
	   us, and a still cannot show timing. */
	.clip-ok {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.6rem;
		margin-bottom: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
	}
	.clip-vid {
		width: 96px;
		max-height: 140px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: #000;
		flex-shrink: 0;
	}
	.clip-facts {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
		font-size: 0.78rem;
		color: var(--muted);
		line-height: 1.45;
	}
	.clip-facts strong {
		color: var(--text);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.clip-input {
		display: block;
		width: 100%;
		font: inherit;
		font-size: 0.82rem;
		color: var(--text);
	}
	.clip-busy {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		font-size: 0.82rem;
		color: var(--muted);
	}
	.clip-err {
		margin: 0.45rem 0 0;
		padding: 0.5rem 0.65rem;
		border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
		border-radius: 8px;
		background: var(--error-soft);
		color: var(--error-text);
		font-size: 0.8rem;
		line-height: 1.45;
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
		border-color: var(--accent-dark);
		background: var(--accent-dark);
		color: #fff;
	}

	.journey-step.done {
		color: var(--text);
	}

	.journey-step.done .journey-dot {
		border-color: var(--accent);
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}

	/* The label is the first thing to go on a narrow modal — the numbered dot
	   still carries the position, so the rail never wraps or clips mid-word. */
	@media (max-width: 640px) {
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
