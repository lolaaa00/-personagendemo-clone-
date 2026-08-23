import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import {
	generateUgcPack,
	generateCinematicUgcPack,
	resolveImageKeys,
	resolveVoiceForPersona,
	TALKINGHEAD_LABEL,
	NANO_STILL_LABEL,
	CINEMATIC_VIDEO_LABEL,
	type UgcPackInput
} from '$lib/server/content/generate';
import { resolveAiClient } from '$lib/server/ai-client';
import { isCardRendererAvailable, CARD_RENDERER_LABEL } from '$lib/server/content/card-renderer';
import { publishPostById } from '$lib/server/scheduler';
import { assertWithinBudget } from '$lib/server/budget';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { priceOf } from '$lib/pricing';
import {
	loadRegistry,
	effectiveOptions,
	effectiveResolve,
	type RegistryRow
} from '$lib/server/model-registry';
import { VOICE_CATALOG, DEFAULT_VOICE } from '$lib/server/voices';
import { VIDEO_ONLY_PLATFORMS } from '$lib/server/social/platforms';

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

	// Verify agent ownership
	const { data: agent, error: agentErr } = await db.agents.get(agentId);
	if (agentErr || !agent || agent.user_id !== user.id) {
		return json(
			{ success: false, error: 'Persona not found or ownership mismatch' },
			{ status: 404 }
		);
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
		formatOverride: (['spokesperson', 'broll', 'auto'].includes(body.format)
			? body.format
			: 'auto') as 'auto' | 'spokesperson' | 'broll',
		// Captions + AI badge are OFF unless the composer explicitly opts in.
		captions: body.captions === true,
		aiBadge: body.ai_badge === true,
		// Composition contract from Studio templates: how the still is composed
		// ('graphic' = typographic card, no refs) and which references a 'photo'
		// still actually feeds. Absent (plain composer flows) = legacy behavior.
		stillStyle: (body.still === 'graphic' ? 'graphic' : 'photo') as 'photo' | 'graphic',
		useCharacterRef: !(body.refs && body.refs.character === false),
		useProductRef: !(body.refs && body.refs.product === false)
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
		const product =
			products.find((p: any) => p.id === genInput.productId) ||
			products.find((p: any) => p.photoUrl) ||
			products[0] ||
			null;

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
		const characterRef =
			genInput.characterRefOverride || (useCharacter ? cfgRow?.ugc_character_ref || null : null);
		const productPhoto =
			genInput.productPhotoUrlOverride || (useProduct ? product?.photoUrl || null : null);

		const videoModel = effectiveResolve(registryRows, 'video_i2v', body.video_model);

		// The model stack this run actually goes through, with per-call costs. A VIDEO
		// forks by format: a spokesperson clip runs voiceover + talking-head (OmniHuman),
		// a b-roll clip runs the picked i2v model. The persona's ugc_format decides
		// (auto → the Director picks, biased to spokesperson); the composer can override.
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
			cfgRow?.ugc_voice || DEFAULT_VOICE,
			agent
		);
		const voiceLabel = VOICE_CATALOG.find((v) => v.name === previewVoice)?.label || previewVoice;

		// The LLM the Director will ACTUALLY run on — resolved with the same
		// precedence the run uses (user OpenRouter key → user Gemini key → env),
		// so the preview never claims OpenRouter for a native-Gemini run.
		const previewAi = await resolveAiClient(locals.supabase, user.id).catch(() => null);
		const directorProvider = previewAi?.provider ?? 'openrouter';
		const directorModel = previewAi?.model ?? 'gemini-3.5-flash';

		type Step = { step: string; provider: string; model: string; usd: number };
		// The still step named for what THIS composition does — not a generic
		// "product still" on runs that composite no product at all.
		// Text cards typeset server-side for $0 when this host can render them
		// (ffmpeg + font present, renderer not env-disabled) — the preview quotes
		// free ONLY when the run will actually be free, and quotes the model
		// fallback price otherwise, so the composer never promises what the run
		// won't deliver.
		const freeCardRender = stillStyle === 'graphic' && (await isCardRendererAvailable());
		const stillStep: Step =
			stillStyle === 'graphic'
				? freeCardRender
					? {
							step: 'typographic card (server-rendered)',
							provider: 'local',
							model: CARD_RENDERER_LABEL,
							usd: 0
						}
					: {
							step: 'typographic card (text render)',
							provider: 'fal',
							model: NANO_STILL_LABEL,
							usd: priceOf('fal', 'image', 'nano')
						}
				: useCharacter || useProduct
					? {
							step:
								useCharacter && useProduct
									? 'still (product + face composite)'
									: useCharacter
										? 'still (face composite)'
										: 'still (product composite)',
							provider: 'fal',
							model: NANO_STILL_LABEL,
							usd: priceOf('fal', 'image', 'nano')
						}
					: {
							step: 'still (text-to-image)',
							provider: 'fal',
							model: 'flux-schnell',
							usd: priceOf('fal', 'image', 'flux')
						};
		const baseSteps: Step[] = [
			{
				step: 'director (caption + scene)',
				provider: directorProvider,
				model: directorModel,
				usd: priceOf(directorProvider, 'llm')
			},
			stillStep
		];
		// Both video branches, so the composer's format selector can flip between them
		// client-side (with the right cost) without a re-fetch that would clobber edits.
		const stepsBroll: Step[] = [
			...baseSteps,
			{ step: 'b-roll video', provider: 'fal', model: videoModel.label, usd: videoModel.usd }
		];
		const stepsSpokesperson: Step[] = [
			...baseSteps,
			{
				step: 'voiceover',
				provider: 'fal',
				model: `elevenlabs (${voiceLabel})`,
				usd: priceOf('fal', 'tts')
			},
			{
				step: 'talking head',
				provider: 'fal',
				model: TALKINGHEAD_LABEL,
				usd: priceOf('fal', 'talking_head')
			}
		];

		// Every media kind's step array ships to the composer, so its Media select
		// can flip between them client-side and the "pipeline that will run" stays
		// true — previously a media switch kept showing the ORIGINAL kind's steps.
		// Cinematic ignores the composition contract (its multi-shot pack always
		// composites character + product elements), so its still step says so even
		// when the template's own still is graphic or ref-less.
		const stepsCinematic: Step[] = [
			baseSteps[0],
			{
				// The run generates ONE composited still PER SHOT (the Director writes
				// 2–5). Priced at the 4-shot midpoint — a single-still line here would
				// under-quote the real spend by up to ~$0.32.
				step: 'storyboard stills (2–5 shots, product + face composite)',
				provider: 'fal',
				model: NANO_STILL_LABEL,
				usd: +(4 * priceOf('fal', 'image', 'nano')).toFixed(4)
			},
			{
				step: 'cinematic video (multi-shot)',
				provider: 'fal',
				model: CINEMATIC_VIDEO_LABEL,
				usd: priceOf('fal', 'video', 'pro')
			}
		];
		// Initial pipeline shown = what this persona runs right now. For 'auto' that's
		// the spokesperson default (the Director's runtime bias).
		let steps: Step[];
		if (mediaKind === 'cinematic') {
			steps = stepsCinematic;
		} else if (mediaKind === 'image') {
			steps = baseSteps;
		} else {
			steps = personaFormat === 'broll' ? stepsBroll : stepsSpokesperson;
		}

		return json({
			success: true,
			preview: {
				topic: genInput.topic || null,
				media: mediaKind,
				provider: genInput.providerPreference || 'auto',
				platforms: targetPool,
				connectedPlatforms,
				product: product
					? { id: product.id, name: product.name, photoUrl: product.photoUrl || null }
					: null,
				// The full brand-brief product set, so the composer can offer a picker
				// instead of a raw URL. Same array the generator resolves product_id
				// against — picking one here sends its id back verbatim.
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
							? 'Art direction for the typographic card. The Director writes the card’s exact line at run time — the model renders that text as the artwork.'
							: 'Left blank: the Director writes the card’s line AND its art direction. Type here to pin the art direction exactly.'
						: genInput.sceneOverride
							? 'This exact scene prompt will be sent to the image/video model.'
							: 'Left blank: the Director model will write the scene prompt. Type one here to pin it exactly.',
				// The composition contract this run obeys — the composer shows ONLY the
				// reference fields the pipeline will actually feed.
				composition: { still: stillStyle, character: useCharacter, product: useProduct },
				scheduledDate,
				scheduledTime,
				// Budget control: the clip is by far the biggest line item, so let the
				// user pick the tier instead of silently billing the default.
				videoModelKind: 'video_i2v',
				videoModel: videoModel.id,
				// Always shipped (not just for video) so the composer's Media switch to
				// video has real options to price with.
				videoModelOptions: effectiveOptions(registryRows, 'video_i2v'),
				// Video format: the persona's setting is the initial pick; the composer
				// lets the user force spokesperson (OmniHuman) or b-roll for this run.
				format: personaFormat,
				stepsSpokesperson,
				stepsBroll,
				stepsImage: baseSteps,
				stepsCinematic,
				// Captions + AI badge default OFF — the composer surfaces them as toggles.
				captions: false,
				aiBadge: false,
				editable: [
					'topic',
					'media',
					'provider',
					'platforms',
					'product_id',
					'product_photo_url',
					'character_ref_url',
					'scene',
					'video_model',
					'format',
					'scheduled_date',
					'scheduled_time',
					'captions',
					'ai_badge'
				],
				steps,
				estimatedCostUsd: +steps.reduce((s, x) => s + x.usd, 0).toFixed(4)
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
	try {
		await assertWithinBudget(locals.supabase, user.id, agentId);
	} catch (err) {
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

				// Have a publishable platform → schedule it. No caller-supplied slot
				// means "now" — publish immediately, exactly like the old sync path.
				// A supplied slot is left to the scheduler to fire when due.
				const now = new Date();
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
