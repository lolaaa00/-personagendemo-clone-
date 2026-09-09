import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { checkAgentAccess } from '$lib/server/workspaces';
import {
	generateUgcPack,
	generateCinematicUgcPack,
	resolveImageKeys,
	resolveVoiceForPersona,
	NANO_STILL_LABEL,
	CINEMATIC_VIDEO_LABEL,
	TTS_MODEL,
	type UgcPackInput
} from '$lib/server/content/generate';
import { resolveAiClient } from '$lib/server/ai-client';
import { isCardRendererAvailable, CARD_RENDERER_LABEL } from '$lib/server/content/card-renderer';
import { publishPostById } from '$lib/server/scheduler';
import { assertWithinBudget } from '$lib/server/budget';
import { creditsFor, isCreditsError, resolveBillingAccount } from '$lib/server/credits';
import { creditsMode } from '$lib/server/flags';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { priceOf } from '$lib/pricing';
import {
	loadRegistry,
	effectiveOptions,
	effectiveResolve,
	registryDefault,
	type RegistryRow
} from '$lib/server/model-registry';
import { VOICE_CATALOG, DEFAULT_VOICE } from '$lib/server/voices';
import {
	formatFromRequest,
	planPipeline,
	planTotalUsd,
	type StepKind,
	type StepModel
} from '$lib/formats';
import type { ModelKind, ModelOption } from '$lib/models';
import { VIDEO_ONLY_PLATFORMS } from '$lib/server/social/platforms';
import { hasFfmpeg } from '$lib/server/video';

/**
 * Generate a fresh UGC post (caption + AI image tuned to the brand brief / product)
 * for an agent and publish it immediately to that agent's live connected accounts.
 *
 * Called by the calendar '✨ Generate Post Now' button and the persona feed's 'Generate Now' action.
 *
 * ASYNC JOB PATTERN: fal image/video generation takes 30s–5min — far past the
 * reverse proxy's request timeout, which used to kill this request with an
 * HTML 502 mid-generation. Validations stay synchronous (fast-fail 400/401),
 * then the post row is created UP FRONT in status 'generating', a 202 is
 * returned immediately, and generation finishes in a detached task that
 * updates that row ('draft'/'scheduled' on success, 'failed' with
 * content.error on failure). The client polls the post row.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);

	// Verify agent access — generating content is a "creator" action.
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent) {
		return json(
			{ success: false, error: 'Persona not found or ownership mismatch' },
			{ status: 404 }
		);
	}
	const access = await checkAgentAccess(locals.supabase, user.id, agentId, 'creator');
	if (!access.ok) {
		return json({ success: false, error: access.message }, { status: access.status });
	}

	// Optional overrides (product focus, platform, topic)
	let body: any = {};
	try {
		body = await request.json();
	} catch {
		/* an empty body is fine */
	}

	// Model Manager: resolve models against the user's registry (enable/disable,
	// per-kind default, price overrides). Unreachable/empty registry falls back
	// to the static catalog — the manager can refine generation, never brick it.
	let registryRows: RegistryRow[] = [];
	try {
		registryRows = await loadRegistry(locals.supabase, user.id);
	} catch (e) {
		console.error('[Generate Post] Registry unavailable, using static catalog:', e);
	}

	// Resolve target platforms from the agent's active connections (used for
	// publishing). Generation itself does NOT require any connection — an agent
	// with no linked account still generates content, saved as a draft to
	// publish later once connected.
	const { data: connections } = await locals.supabase
		.from('connections')
		.select('platform')
		.eq('agent_id', agentId)
		.eq('status', 'active');

	const connectedPlatforms = (connections || []).map((c: any) => c.platform);

	// Composer platform selection: an explicit subset wins (validated against
	// the agent's connections so a stray value can't route to a dead platform).
	// An explicit EMPTY array means "publish nowhere" (→ draft) — the composer
	// shows toggled-off chips as off, so treating [] as "all connected" would
	// publish to every account the user just deselected. Only an ABSENT field
	// defaults to all connected platforms.
	const requestedPlatforms: string[] | null = Array.isArray(body.platforms)
		? body.platforms
				.map((p: string) => String(p).toLowerCase())
				.filter((p: string) => connectedPlatforms.includes(p))
		: null;
	const targetPool = requestedPlatforms === null ? connectedPlatforms : requestedPlatforms;

	// Cinematic mode is fal-exclusive (Kling O3 Pro reference-to-video) — check
	// the key up front so a missing key fails fast, BEFORE any LLM spend.
	const wantCinematic = body.media === 'cinematic';
	if (wantCinematic) {
		const { falKey } = await resolveImageKeys(locals.supabase, user.id);
		if (!falKey) {
			return json(
				{ success: false, error: 'Cinematic video requires a Fal AI key — add one in Settings.' },
				{ status: 400 }
			);
		}
		// Cinematic composites the brand product into every shot — without a product
		// photo the pipeline is doomed. Fail HERE, before any spend and before the
		// 202 a bulk campaign would count as "queued", not minutes later in the
		// detached task where the failure is silent.
		const hasOverridePhoto =
			typeof body.product_photo_url === 'string' && /^https?:\/\//i.test(body.product_photo_url);
		if (!hasOverridePhoto) {
			const { data: cinCfg } = await locals.supabase
				.from('agent_configs')
				.select('brand_brief_id')
				.eq('agent_id', agentId)
				.maybeSingle();
			const { data: cinBrief } = cinCfg?.brand_brief_id
				? await db.brandBriefs.getById(cinCfg.brand_brief_id, user.id)
				: { data: null };
			const cinProducts = Array.isArray(cinBrief?.data?.products) ? cinBrief.data.products : [];
			// Same selection order the pipeline uses: requested id, else first with a photo.
			const cinProduct =
				cinProducts.find((p: any) => p.id === (body.product_id || body.productId)) ||
				cinProducts.find((p: any) => p.photoUrl) ||
				cinProducts[0] ||
				null;
			if (!cinProduct?.photoUrl) {
				return json(
					{
						success: false,
						error: 'Cinematic mode needs a product photo — add one in the Brand Brief first.'
					},
					{ status: 400 }
				);
			}
		}
	}

	// Pipeline input, minus the supabase client — the detached task injects the
	// service-role client, the synchronous fallback injects the session one.
	const genInput = {
		userId: user.id,
		agentId,
		productId: body.product_id || body.productId,
		platform: body.platform || targetPool[0] || 'instagram',
		topic: body.topic,
		// Composer overrides — every field the confirm modal lets the user edit.
		video: body.media === 'image' ? false : undefined,
		providerPreference: ['auto', 'fal', 'openrouter'].includes(body.provider)
			? body.provider
			: undefined,
		sceneOverride: typeof body.scene === 'string' ? body.scene.slice(0, 1200) : undefined,
		productPhotoUrlOverride:
			typeof body.product_photo_url === 'string' && /^https?:\/\//i.test(body.product_photo_url)
				? body.product_photo_url
				: undefined,
		characterRefOverride:
			typeof body.character_ref_url === 'string' && /^https?:\/\//i.test(body.character_ref_url)
				? body.character_ref_url
				: undefined,
		// The user's budget-vs-quality pick for the b-roll clip (Wan $0.10 → Veo $1.50).
		videoModel: effectiveResolve(registryRows, 'video_i2v', body.video_model).id,
		// Registry price (Model Manager edit) rides along so the cost ledger bills
		// what the manager says, not the static catalog rate.
		videoModelUsd: effectiveResolve(registryRows, 'video_i2v', body.video_model).usd,
		// Generated adapter for the resolved video model (present on swapped-in
		// discovered models). Without this the pipeline can only drive models it
		// has hand-written shapes for — the whole point of the Model Manager swap.
		videoAdapter: (() => {
			const id = effectiveResolve(registryRows, 'video_i2v', body.video_model).id;
			const row = registryRows.find((r) => r.kind === 'video_i2v' && r.model_id === id);
			// Stored as JSON at probe time; shape is guaranteed by adapterFromProbe.
			return ((row?.probe as any)?.adapter as UgcPackInput['videoAdapter']) ?? null;
		})(),
		// Composer format choice: spokesperson (TTS + talking-head) vs b-roll clip.
		// 'auto' (or anything unrecognized) defers to the persona's ugc_format.
		formatOverride: (['spokesperson', 'broll', 'vo_broll', 'motion_card', 'auto'].includes(
			body.format
		)
			? body.format
			: 'auto') as UgcPackInput['formatOverride'],
		// Captions + AI badge are OFF unless the composer explicitly opts in.
		captions: body.captions === true,
		aiBadge: body.ai_badge === true,
		// Composition contract from Studio templates: how the still is composed
		// ('graphic' = typographic card, no refs) and which references a 'photo'
		// still actually feeds. Absent (plain composer flows) = legacy behavior.
		stillStyle: (body.still === 'graphic' ? 'graphic' : 'photo') as 'photo' | 'graphic',
		useCharacterRef: !(body.refs && body.refs.character === false),
		useProductRef: !(body.refs && body.refs.product === false),
		// ── Per-run controls the composer's Look step now pins ────────────────
		// The Director still writes anything left blank; these only ever REPLACE a
		// decision the user made explicitly, so an absent field is today's run.
		/** The spoken line for a spokesperson run. Previously editable only on a refine. */
		dialogueOverride:
			typeof body.script === 'string' && body.script.trim()
				? body.script.slice(0, 1200)
				: undefined,
		/** Per-run voice; the persona's pinned voice remains the default. */
		voiceOverride:
			typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : undefined,
		/** Typographic card controls — the line, and how it is set. */
		cardText:
			typeof body.card_text === 'string' && body.card_text.trim()
				? body.card_text.slice(0, 400)
				: undefined,
		cardLayout: ['statement', 'quote', 'stack', 'list', 'split'].includes(body.card_layout)
			? body.card_layout
			: undefined,
		cardPalette:
			typeof body.card_palette === 'string' && body.card_palette !== 'auto'
				? body.card_palette
				: undefined,
		/** The realism register for photo compositions (front camera / mirror / third person). */
		framing: ['front', 'mirror', 'third'].includes(body.framing) ? body.framing : undefined,
		/** Budget-vs-quality for the still, the second largest line in most runs. */
		stillModel: typeof body.still_model === 'string' ? body.still_model : undefined,
		/** The lip-sync model — the dearest single call in a spokesperson post. */
		talkingHeadModel:
			typeof body.talking_head_model === 'string' ? body.talking_head_model : undefined,
		/** The Director's LLM; ignored unless it matches the provider that resolves. */
		llmModel: typeof body.llm_model === 'string' ? body.llm_model : undefined,
		/** "Use my own still": skips still generation entirely, and its charge with it. */
		stillUrlOverride:
			typeof body.still_url === 'string' && /^https?:\/\//i.test(body.still_url)
				? body.still_url
				: undefined
	};

	// ── Studio delivery contract ─────────────────────────────────────────────
	// `studio_template` tags the output with the archetype that produced it (so
	// the Studio gallery can surface real generations as template previews).
	// `deliver` overrides the destination: 'review' pins the result as a DRAFT
	// even when a platform is connected — without it, an unscheduled generate
	// publishes immediately, which is right for "post now" but wrong for Studio —
	// and 'asset' additionally marks it standalone so the review queue skips it.
	const studioTemplate =
		typeof body.studio_template === 'string' ? body.studio_template.slice(0, 64) : null;
	const deliver: 'review' | 'asset' | null =
		body.deliver === 'asset' || body.deliver === 'review' ? body.deliver : null;
	const studioMeta =
		studioTemplate || deliver
			? {
					...(studioTemplate ? { template: studioTemplate } : {}),
					...(deliver === 'asset' ? { standalone: true } : {})
				}
			: null;

	const scheduledDate = typeof body.scheduled_date === 'string' ? body.scheduled_date : null;
	const scheduledTime = typeof body.scheduled_time === 'string' ? body.scheduled_time : null;

	// ── Preview: resolve, don't spend ────────────────────────────────────────
	// Hands back the fully-resolved configuration this request would run with, so
	// the composer shows the user exactly what is about to happen (and what it
	// costs) before a cent is spent. Nothing is generated and no row is created.
	if (body.preview === true) {
		const { data: cfgRow } = await locals.supabase
			.from('agent_configs')
			.select('ugc_character_ref, brand_brief_id, ugc_format, ugc_voice')
			.eq('agent_id', agentId)
			.maybeSingle();

		// Pinned-only: use the persona's explicitly selected brand brief, or no
		// brand context at all — never a silent fall-back to the newest brief.
		const { data: selectedBrief } = cfgRow?.brand_brief_id
			? await db.brandBriefs.getById(cfgRow.brand_brief_id, user.id)
			: { data: null };
		const briefData = selectedBrief?.data || null;
		const products = Array.isArray(briefData?.products) ? briefData.products : [];

		const mediaKind = wantCinematic ? 'cinematic' : genInput.video === false ? 'image' : 'video';
		// The composition contract decides which refs this run will actually feed —
		// the preview must show ONLY those. A ref nulled by policy is deliberate,
		// and the composer hides its field entirely (cinematic runs its own pack
		// and always composites both, so the contract applies to image/video only).
		const stillStyle = wantCinematic ? 'photo' : genInput.stillStyle;
		const useCharacter =
			wantCinematic || (genInput.useCharacterRef !== false && stillStyle !== 'graphic');
		const useProduct =
			wantCinematic || (genInput.useProductRef !== false && stillStyle !== 'graphic');

		// Only resolve a product for a composition that FEEDS one. Resolving it
		// unconditionally is how a product id ended up being submitted by
		// product-free channel templates whose product field was hidden: the
		// composer read it out of this payload and posted it back, and the
		// Director then wrote copy about a product the user never saw offered.
		const product = useProduct
			? products.find((p: any) => p.id === genInput.productId) ||
				products.find((p: any) => p.photoUrl) ||
				products[0] ||
				null
			: null;
		// The pinned face and the brand-brief product LIST are shipped whatever this
		// run composites: the composer lets the user switch format client-side, and a
		// switch into a composition that DOES feed a product must not find an empty
		// picker. What stays gated is the resolved product for THIS run (below) and,
		// in the composer, whether a product id is submitted at all.
		const characterRef = genInput.characterRefOverride || cfgRow?.ugc_character_ref || null;
		const productPhoto =
			genInput.productPhotoUrlOverride || (useProduct ? product?.photoUrl || null : null);

		// The quote must price the row the pipeline will actually RUN, or the
		// customer approves one number and the ledger records another.
		const voiceModel = registryDefault(
			registryRows,
			'tts',
			'fal',
			TTS_MODEL,
			priceOf('fal', 'tts')
		);

		// Honor an explicit format in the request first (the REAL run already does,
		// via formatOverride) — otherwise a Studio template or composer choice would
		// preview as the persona's default pipeline while generating as the requested
		// one, showing the wrong model stack and cost.
		const personaFormat: 'auto' | 'spokesperson' | 'broll' =
			body.format === 'spokesperson' || body.format === 'broll'
				? body.format
				: cfgRow?.ugc_format === 'spokesperson' || cfgRow?.ugc_format === 'broll'
					? cfgRow.ugc_format
					: 'auto';
		const { voice: previewVoice } = resolveVoiceForPersona(
			body.voice || cfgRow?.ugc_voice || DEFAULT_VOICE,
			agent
		);
		const voiceLabel = VOICE_CATALOG.find((v) => v.name === previewVoice)?.label || previewVoice;

		// The LLM the Director will ACTUALLY run on — resolved with the same
		// precedence the run uses (user OpenRouter key → user Gemini key → env),
		// so the preview never claims OpenRouter for a native-Gemini run.
		const previewAi = await resolveAiClient(locals.supabase, user.id).catch(() => null);
		const directorProvider = previewAi?.provider ?? 'openrouter';
		const directorModel = previewAi?.model ?? 'gemini-3.5-flash';

		// Text cards typeset server-side for $0 when this host can render them
		// (ffmpeg + font present, renderer not env-disabled). The preview quotes
		// free ONLY when the run will actually be free, and quotes the model
		// fallback price otherwise, so the composer never promises what the run
		// won't deliver.
		const [freeCardRender, ffmpegAvailable] = await Promise.all([
			isCardRendererAvailable(),
			hasFfmpeg()
		]);

		// ── The plan ────────────────────────────────────────────────────────
		// One catalog, one planner. The composer calls planPipeline() with THIS
		// options/fixed pair on every change, so the pipeline it prices and the
		// pipeline this endpoint would run are produced by the same function —
		// which is the entire reason the preview round-trip exists. Previously
		// the server shipped one pre-built array per media/format combination and
		// the client re-derived cost by string-matching the step name.
		const stillKind: ModelKind = useCharacter || useProduct ? 'image_edit' : 'image_t2i';
		const toStepModel = (m: ModelOption): StepModel => ({
			id: m.id,
			label: m.label,
			usd: m.usd,
			provider: m.provider,
			tier: m.tier,
			note: m.note,
			caveat: m.caveat,
			supportsAudio: m.supportsAudio,
			supportsDuration: m.supportsDuration,
			multiRef: m.multiRef
		});

		const stillOptions = effectiveOptions(registryRows, stillKind).map(toStepModel);
		const videoOptions = effectiveOptions(registryRows, 'video_i2v').map(toStepModel);
		const defaultStill = effectiveResolve(registryRows, stillKind, body.still_model);
		const defaultVideo = effectiveResolve(registryRows, 'video_i2v', body.video_model);

		// The Director only ever runs on the provider this user's keys resolve to,
		// so offering the other provider's models would be offering a 404.
		const llmOptions = effectiveOptions(registryRows, 'llm')
			.filter((m) => m.provider === directorProvider)
			.map(toStepModel);
		const planOptions: Partial<Record<StepKind, StepModel[]>> = {
			still: stillOptions,
			video: videoOptions,
			talkinghead: effectiveOptions(registryRows, 'talking_head').map(toStepModel),
			director: llmOptions
		};
		const planFixed: Partial<Record<StepKind, StepModel>> = {
			director: {
				id: directorModel,
				label: directorModel,
				usd: priceOf(directorProvider, 'llm'),
				provider: directorProvider
			},
			still: toStepModel(defaultStill),
			video: toStepModel(defaultVideo),
			card: freeCardRender
				? {
						id: 'local/typographic-card',
						label: CARD_RENDERER_LABEL,
						usd: 0,
						provider: 'local',
						tier: 'free'
					}
				: {
						id: NANO_STILL_LABEL,
						label: `${NANO_STILL_LABEL} (renderer unavailable on this host)`,
						usd: priceOf('fal', 'image', 'nano'),
						provider: 'fal'
					},
			tts: {
				id: voiceModel.id,
				label: `${voiceModel.id.replace(/^fal-ai\//, '')} (${voiceLabel})`,
				usd: voiceModel.usd,
				provider: 'fal'
			},
			talkinghead: toStepModel(
				effectiveResolve(registryRows, 'talking_head', body.talking_head_model)
			),
			// Per SHOT: planPipeline multiplies this by the shot count, so a 5-shot
			// sequence is not quoted as a single still.
			cine_stills: {
				id: NANO_STILL_LABEL,
				label: NANO_STILL_LABEL,
				usd: priceOf('fal', 'image', 'nano'),
				provider: 'fal'
			},
			motion: {
				id: 'local/ffmpeg-motion',
				label: 'server motion renderer (no AI, $0)',
				usd: 0,
				provider: 'local',
				tier: 'free'
			},
			mux: {
				id: 'local/ffmpeg-mux',
				label: 'server audio mix (no AI, $0)',
				usd: 0,
				provider: 'local',
				tier: 'free'
			},
			cine_video: {
				id: CINEMATIC_VIDEO_LABEL,
				label: CINEMATIC_VIDEO_LABEL,
				usd: priceOf('fal', 'video', 'pro'),
				provider: 'fal'
			}
		};

		// Which format this request IS, in the vocabulary the composer now speaks.
		// Derived from the same media/format/still fields the run will receive, so
		// a Studio template that pins media:'image' + still:'graphic' opens on
		// "Text card" without that template changing at all.
		const formatId = formatFromRequest({
			media: mediaKind,
			format: personaFormat,
			still: stillStyle
		});

		const shots = 4;
		const previewPlan = planPipeline({
			formatId,
			options: planOptions,
			fixed: planFixed,
			picks: {
				...(body.still_model ? { still: String(body.still_model) } : {}),
				...(body.video_model ? { video: String(body.video_model) } : {}),
				...(body.talking_head_model ? { talkinghead: String(body.talking_head_model) } : {}),
				...(body.llm_model ? { director: String(body.llm_model) } : {})
			},
			shots
		});
		const planUsd = planTotalUsd(previewPlan);

		return json({
			success: true,
			preview: {
				kind: 'post',
				topic: genInput.topic || null,
				// The format the composer opens on, and everything it needs to plan
				// any OTHER format the user switches to without a second round-trip.
				formatId,
				plan: { options: planOptions, fixed: planFixed, shots },
				media: mediaKind,
				provider: genInput.providerPreference || 'auto',
				platforms: targetPool,
				connectedPlatforms,
				// Platforms that reject a still. The server has always filtered these
				// AFTER generating (and then quietly saved a draft); the composer can
				// now say so before the money is spent instead of promising a live
				// post it cannot deliver.
				videoOnlyPlatforms: [...VIDEO_ONLY_PLATFORMS],
				product: product
					? { id: product.id, name: product.name, photoUrl: product.photoUrl || null }
					: null,
				// The full brand-brief product set, so the composer can offer a picker
				// instead of a raw URL. Empty for a composition that feeds no product,
				// so the picker cannot appear where the run would ignore it.
				products: products.map((p: any) => ({
					id: p.id,
					name: p.name,
					photoUrl: p.photoUrl || null
				})),
				productPhotoUrl: productPhoto,
				characterRefUrl: characterRef,
				// Be honest: unless the user pins a scene, the Director LLM writes the
				// visual prompt at run time — we cannot show a prompt that doesn't exist yet.
				scene: genInput.sceneOverride || null,
				sceneNote:
					stillStyle === 'graphic'
						? genInput.sceneOverride
							? 'Art direction for the card. The Director writes the card’s exact line at run time — the model renders that text as the artwork.'
							: 'Left blank: the Director writes the card’s line AND its art direction. Type here to pin the art direction exactly.'
						: genInput.sceneOverride
							? 'This exact scene prompt will be sent to the image/video model.'
							: 'Left blank: the Director model will write the scene prompt. Type one here to pin it exactly.',
				// The composition contract this run obeys — the composer shows ONLY the
				// reference fields the pipeline will actually feed.
				composition: { still: stillStyle, character: useCharacter, product: useProduct },
				scheduledDate,
				scheduledTime,
				// Voice is a per-run choice now, not only a persona setting.
				voice: previewVoice,
				voices: VOICE_CATALOG.map((v) => ({
					name: v.name,
					label: v.label,
					gender: v.gender,
					style: v.style,
					accent: v.accent ?? null
				})),
				cardRendererFree: freeCardRender,
				// Formats that assemble locally are only offered where they can be
				// built. Same posture as the $0 card renderer above.
				ffmpegAvailable,
				// Kept because the run body still speaks these, and the calendar's
				// legacy callers read them back.
				videoModelKind: 'video_i2v',
				videoModel: defaultVideo.id,
				stillModel: defaultStill.id,
				format: personaFormat,
				// Captions + AI badge default OFF — the composer surfaces them as toggles.
				captions: false,
				aiBadge: false,
				editable: [
					'topic',
					'format',
					'media',
					'provider',
					'platforms',
					'product_id',
					'product_photo_url',
					'character_ref_url',
					'scene',
					'script',
					'voice',
					'card_text',
					'card_layout',
					'card_palette',
					'framing',
					'shots',
					'still_model',
					'still_url',
					'video_model',
					'talking_head_model',
					'llm_model',
					'scheduled_date',
					'scheduled_time',
					'captions',
					'ai_badge'
				],
				steps: previewPlan.map((s) => ({
					step: s.label,
					provider: s.model.provider,
					model: s.model.label,
					usd: s.usd
				})),
				estimatedCostUsd: planUsd,
				// 1 credit = 1¢ of RETAIL (cost × markup), rounded up per step the way
				// the ledger rounds per event, so the quote matches the debit.
				estimatedCredits: previewPlan.reduce((s, x) => s + creditsFor(x.usd), 0),
				creditsMode: creditsMode()
			}
		});
	}

	// ── Budget precheck, SYNCHRONOUS ─────────────────────────────────────────
	// The caps also assert inside the detached task (fail-closed, before any
	// paid call) — but by then this request has already 202'd, so a bulk
	// campaign launch reported "42 queued" while over-cap slots quietly flipped
	// to failed minutes later. Checking here turns an over-cap slot into an
	// immediate 400 the CampaignPlanner counts truthfully ("N failed to queue"),
	// and a doomed slot never creates a placeholder row at all. The detached
	// assert stays: two requests can pass this precheck concurrently, and the
	// inner one is what actually guards the money.
	// Conservative retail quote for the credit gate: the spokesperson pipeline
	// (the dearer of the two video branches) or the cinematic pack, so a thin
	// wallet is refused up front instead of overdrawing mid-run. The composer's
	// preview above quotes the exact pipeline; this only has to be an upper bound.
	const roughUsd = wantCinematic
		? priceOf('openrouter', 'llm') +
			4 * priceOf('fal', 'image', 'nano') +
			priceOf('fal', 'video', 'pro')
		: body.media === 'image'
			? priceOf('openrouter', 'llm') + priceOf('fal', 'image', 'nano')
			: genInput.formatOverride === 'broll'
				? priceOf('openrouter', 'llm') +
					priceOf('fal', 'image', 'nano') +
					Math.max(genInput.videoModelUsd ?? 0, priceOf('fal', 'video', 'standard'))
				: priceOf('openrouter', 'llm') +
					priceOf('fal', 'image', 'nano') +
					priceOf('fal', 'tts') +
					priceOf('fal', 'talking_head');
	try {
		await assertWithinBudget(locals.supabase, user.id, agentId, creditsFor(roughUsd));
	} catch (err) {
		if (isCreditsError(err)) {
			// 402 with a place to go: the composer shows the message, the pill is red,
			// and /billing sells the top-up, so the "ran out" wall becomes a purchase.
			// A seat generating against a workspace persona draws on the OWNER's
			// wallet (owner pays) — say so, instead of sending them to top up a
			// personal wallet that is not the one being checked.
			const billed = await resolveBillingAccount(locals.supabase, agentId, user.id).catch(
				() => user.id
			);
			const ownerPays = billed !== user.id;
			return json(
				{
					success: false,
					code: 'INSUFFICIENT_CREDITS',
					billedTo: ownerPays ? 'workspace_owner' : 'self',
					error: ownerPays
						? `${(err as Error).message} This persona is billed to the workspace owner's wallet — ask them to top up. (Your Billing page lists the workspace wallets you draw on.)`
						: `${(err as Error).message} Top up at /billing to continue.`,
					billingUrl: '/billing'
				},
				{ status: 402 }
			);
		}
		return json({ success: false, error: (err as Error).message }, { status: 400 });
	}

	// What this run is SET OUT to produce — media kind, format, still style.
	// Stamped on the placeholder row (and kept on failure) so every surface can
	// type the slot truthfully while it generates or after it dies, instead of
	// defaulting to "photo" for a video/cinematic run. Templates aren't the only
	// source of type anymore — plain composer and campaign slots carry it too.
	const intended = {
		media: wantCinematic ? 'cinematic' : body.media === 'image' ? 'image' : 'video',
		...(genInput.formatOverride !== 'auto' && !wantCinematic && body.media !== 'image'
			? { format: genInput.formatOverride }
			: {}),
		...(genInput.stillStyle === 'graphic' ? { still: 'graphic' } : {})
	};

	// ── Async job path ───────────────────────────────────────────────────────
	// Create the post row up front so the client has an id to poll. A caller-
	// supplied schedule slot is kept; otherwise the completion task stamps
	// "now" exactly like the old synchronous path did.
	const { data: pending, error: pendingErr } = await db.posts.create({
		user_id: user.id,
		agent_id: agentId,
		// Studio provenance rides from birth, not just completion — a campaign
		// slot that is still generating (or whose worker died) must already say
		// WHAT it is becoming, so the calendar and library can show a typed
		// placeholder instead of an anonymous spinner.
		content: JSON.stringify({
			topic: body.topic || null,
			intended,
			...(studioMeta ? { studio: studioMeta } : {})
		}),
		platforms: targetPool,
		// Not in PostRow's status union (db.ts is owned by the posts feature) —
		// the DB CHECK constraint is the real gate here.
		status: 'generating' as any,
		scheduled_date: scheduledDate,
		scheduled_time: scheduledTime,
		published_at: null,
		token_cost: 0
	});

	// GRACEFUL DEGRADATION: posts_status_check rejecting 'generating' means
	// post_status_generating_migration.sql isn't applied yet — fall back to the
	// old fully-synchronous behavior (and its 200 shape) instead of erroring.
	const statusCheckRejected =
		!!pendingErr &&
		((pendingErr as any).code === '23514' ||
			/posts_status_check|check constraint/i.test(pendingErr.message || ''));
	if (pendingErr && !statusCheckRejected) {
		return json(
			{ success: false, error: pendingErr.message || 'Failed to create post' },
			{ status: 500 }
		);
	}

	if (pending && !pendingErr) {
		// Everything the detached task needs is captured NOW — SvelteKit's
		// request/locals must not be touched after the response is returned.
		const postId = pending.id;
		// Session tokens can expire mid-task (generation runs up to 5min);
		// prefer the service-role client, falling back to the session client
		// only where service credentials aren't configured (dev).
		let taskSupabase: any;
		try {
			taskSupabase = getServiceSupabase();
		} catch {
			taskSupabase = locals.supabase;
		}

		void (async () => {
			const taskDb = createDbService(taskSupabase);
			try {
				const pack = wantCinematic
					? await generateCinematicUgcPack({ supabase: taskSupabase, ...genInput, postId })
					: await generateUgcPack({ supabase: taskSupabase, ...genInput, postId });
				const content = studioMeta ? { ...pack.content, studio: studioMeta } : pack.content;

				// Which SELECTED platforms can actually accept this pack's media type?
				let publishablePlatforms = targetPool;
				if (content?.media_type !== 'video') {
					publishablePlatforms = targetPool.filter(
						(p: string) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p.toLowerCase())
					);
				}

				// No publishable platform → keep the generated content as a DRAFT
				// rather than failing. This is the "generate without a connection" path.
				// A Studio `deliver` request pins a draft too — Studio output must
				// never race straight to a live platform.
				if (deliver || publishablePlatforms.length === 0) {
					await taskDb.posts.update(postId, {
						content: JSON.stringify(content),
						platforms: targetPool,
						status: 'draft',
						token_cost: content?.costBreakdown?.total ?? 0
					});
					return;
				}

				// Have a publishable platform. What happens next is the persona's
				// autonomy setting, which this route never used to read: it published
				// the moment generation finished, so a persona set to "Advisor —
				// suggests" or "Semi-autonomous — drafts and waits for you" posted to
				// a live account before its owner ever saw the result. Every connected
				// account in production is on one of those two levels, and the product
				// promises approval on the pricing page. Only FULLY autonomous
				// publishes by itself; an explicit publish_now from the caller is the
				// deliberate "post this now" action.
				//
				// The unpublished case must be a DRAFT, not a 'scheduled' row dated
				// today: the scheduler polls due slots every 60 s, so leaving it
				// scheduled would publish it a minute later by another path.
				const { data: cfgRow } = await taskSupabase
					.from('agent_configs')
					.select('autonomy_level')
					.eq('agent_id', agentId)
					.maybeSingle();
				const autonomy = String(cfgRow?.autonomy_level ?? 'advisor');
				const mayPublishItself = autonomy === 'fully_autonomous' || body.publish_now === true;

				const now = new Date();
				if (!scheduledDate && !mayPublishItself) {
					await taskDb.posts.update(postId, {
						content: JSON.stringify(content),
						platforms: publishablePlatforms,
						status: 'draft',
						token_cost: content?.costBreakdown?.total ?? 0
					});
					console.log(`[generate-post] ${postId} held for review (autonomy=${autonomy})`);
					return;
				}

				await taskDb.posts.update(postId, {
					content: JSON.stringify(content),
					platforms: publishablePlatforms,
					status: 'scheduled',
					scheduled_date: scheduledDate || now.toISOString().split('T')[0],
					scheduled_time: scheduledTime || now.toTimeString().split(' ')[0],
					token_cost: content?.costBreakdown?.total ?? 0
				});
				if (!scheduledDate) {
					try {
						await publishPostById(postId);
					} catch (pubErr) {
						console.error('[generate-post] Immediate publish failed:', pubErr);
					}
				}
			} catch (genErr) {
				console.error('[generate-post] Detached generation failed:', genErr);
				try {
					await taskDb.posts.update(postId, {
						status: 'failed',
						// Keep the studio provenance AND the intended type on failure — a
						// failed slot must still say WHAT it was going to be (format badge,
						// retry), not fall back to a default "photo" classification.
						content: JSON.stringify({
							topic: body.topic || null,
							intended,
							error: (genErr as Error).message || 'Generation failed',
							...(studioMeta ? { studio: studioMeta } : {})
						})
					});
				} catch (updateErr) {
					console.error('[generate-post] Failed to record generation failure:', updateErr);
				}
			}
		})();

		return json({ success: true, post_id: postId, status: 'generating' }, { status: 202 });
	}

	// ── Legacy synchronous fallback (migration not applied yet) ───────────────
	console.warn(
		"[generate-post] posts_status_check rejected status 'generating' — apply post_status_generating_migration.sql. Falling back to synchronous generation."
	);

	let content;
	try {
		const pack = wantCinematic
			? await generateCinematicUgcPack({ supabase: locals.supabase, ...genInput })
			: await generateUgcPack({ supabase: locals.supabase, ...genInput });
		content = studioMeta ? { ...pack.content, studio: studioMeta } : pack.content;
	} catch (genErr) {
		const msg = (genErr as Error).message;
		const status = /image generation/i.test(msg) ? 502 : 500;
		return json({ success: false, error: msg }, { status });
	}

	// Which SELECTED platforms can actually accept this pack's media type?
	let publishablePlatforms = targetPool;
	if (content?.media_type !== 'video') {
		publishablePlatforms = targetPool.filter(
			(p: string) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p.toLowerCase())
		);
	}

	const now = new Date();

	// No publishable platform → save the generated content as a DRAFT rather
	// than erroring. This is the "generate without a connection" path. A Studio
	// `deliver` request pins a draft too (see the async path for why).
	if (deliver || publishablePlatforms.length === 0) {
		const reason = deliver
			? deliver === 'asset'
				? 'Saved as a standalone asset — it will not appear in the review queue.'
				: 'Saved as a draft for review, as requested.'
			: connectedPlatforms.length === 0
				? 'No social account connected yet — saved as a draft.'
				: `Content is image-only and the selected platform(s) (${targetPool.join(', ')}) don't accept image posts — saved as a draft.`;
		const { data: draft, error: draftErr } = await db.posts.create({
			user_id: user.id,
			agent_id: agentId,
			content: JSON.stringify(content),
			platforms: targetPool,
			status: 'draft',
			scheduled_date: null,
			scheduled_time: null,
			published_at: null,
			token_cost: content?.costBreakdown?.total ?? 0
		});
		if (draftErr || !draft) {
			return json(
				{ success: false, error: draftErr?.message || 'Failed to save draft' },
				{ status: 500 }
			);
		}
		return json({ success: true, post: draft, published: false, draft: true, reason });
	}

	// Have a publishable platform → create a scheduled post and publish now.
	const { data: post, error: postErr } = await db.posts.create({
		user_id: user.id,
		agent_id: agentId,
		content: JSON.stringify(content),
		platforms: publishablePlatforms,
		status: 'scheduled',
		scheduled_date: now.toISOString().split('T')[0],
		scheduled_time: now.toTimeString().split(' ')[0],
		published_at: null,
		token_cost: content?.costBreakdown?.total ?? 0
	});

	if (postErr || !post) {
		return json(
			{ success: false, error: postErr?.message || 'Failed to create post' },
			{ status: 500 }
		);
	}

	let published = false;
	try {
		published = await publishPostById(post.id);
	} catch (pubErr) {
		console.error('[generate-post] Immediate publish failed:', pubErr);
	}

	const { data: updatedPost } = await db.posts.get(post.id);
	return json({ success: true, post: updatedPost || post, published, draft: false });
};
