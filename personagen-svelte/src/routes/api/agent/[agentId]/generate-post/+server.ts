import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import {
	generateUgcPack,
	generateCinematicUgcPack,
	resolveImageKeys,
	resolveVoiceForPersona,
	TALKINGHEAD_LABEL
} from '$lib/server/content/generate';
import { publishPostById } from '$lib/server/scheduler';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { priceOf } from '$lib/pricing';
import { modelsFor, resolveModel } from '$lib/models';
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
			{ success: false, error: 'Agent not found or ownership mismatch' },
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
	const requestedPlatforms: string[] = Array.isArray(body.platforms)
		? body.platforms
				.map((p: string) => String(p).toLowerCase())
				.filter((p: string) => connectedPlatforms.includes(p))
		: [];
	const targetPool = requestedPlatforms.length > 0 ? requestedPlatforms : connectedPlatforms;

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
		videoModel: resolveModel('video_i2v', body.video_model).id,
		// Composer format choice: spokesperson (TTS + talking-head) vs b-roll clip.
		// 'auto' (or anything unrecognized) defers to the persona's ugc_format.
		formatOverride: (['spokesperson', 'broll', 'auto'].includes(body.format)
			? body.format
			: 'auto') as 'auto' | 'spokesperson' | 'broll',
		// Captions + AI badge are OFF unless the composer explicitly opts in.
		captions: body.captions === true,
		aiBadge: body.ai_badge === true
	};

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
		const characterRef = genInput.characterRefOverride || cfgRow?.ugc_character_ref || null;
		const productPhoto = genInput.productPhotoUrlOverride || product?.photoUrl || null;

		const videoModel = resolveModel('video_i2v', body.video_model);

		// The model stack this run actually goes through, with per-call costs. A VIDEO
		// forks by format: a spokesperson clip runs voiceover + talking-head (OmniHuman),
		// a b-roll clip runs the picked i2v model. The persona's ugc_format decides
		// (auto → the Director picks, biased to spokesperson); the composer can override.
		const personaFormat: 'auto' | 'spokesperson' | 'broll' =
			cfgRow?.ugc_format === 'spokesperson' || cfgRow?.ugc_format === 'broll'
				? cfgRow.ugc_format
				: 'auto';
		const { voice: previewVoice } = resolveVoiceForPersona(cfgRow?.ugc_voice || DEFAULT_VOICE, agent);
		const voiceLabel = VOICE_CATALOG.find((v) => v.name === previewVoice)?.label || previewVoice;

		type Step = { step: string; provider: string; model: string; usd: number };
		const baseSteps: Step[] = [
			{ step: 'director (caption + scene)', provider: 'openrouter', model: 'gemini-3.5-flash', usd: priceOf('openrouter', 'llm') },
			{ step: 'product still', provider: 'fal', model: 'nano-banana-2', usd: priceOf('fal', 'image', 'nano') }
		];
		// Both video branches, so the composer's format selector can flip between them
		// client-side (with the right cost) without a re-fetch that would clobber edits.
		const stepsBroll: Step[] = [
			...baseSteps,
			{ step: 'b-roll video', provider: 'fal', model: videoModel.label, usd: videoModel.usd }
		];
		const stepsSpokesperson: Step[] = [
			...baseSteps,
			{ step: 'voiceover', provider: 'fal', model: `elevenlabs (${voiceLabel})`, usd: priceOf('fal', 'tts') },
			{ step: 'talking head', provider: 'fal', model: TALKINGHEAD_LABEL, usd: priceOf('fal', 'talking_head') }
		];

		// Initial pipeline shown = what this persona runs right now. For 'auto' that's
		// the spokesperson default (the Director's runtime bias).
		let steps: Step[];
		if (mediaKind === 'cinematic') {
			steps = [...baseSteps, { step: 'cinematic video', provider: 'fal', model: 'kling-o3-pro reference', usd: priceOf('fal', 'video', 'pro') }];
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
				product: product ? { id: product.id, name: product.name, photoUrl: product.photoUrl || null } : null,
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
				sceneNote: genInput.sceneOverride
					? 'This exact scene prompt will be sent to the image/video model.'
					: 'Left blank: the Director model will write the scene prompt. Type one here to pin it exactly.',
				scheduledDate,
				scheduledTime,
				// Budget control: the clip is by far the biggest line item, so let the
				// user pick the tier instead of silently billing the default.
				videoModelKind: 'video_i2v',
				videoModel: videoModel.id,
				videoModelOptions: mediaKind === 'video' ? modelsFor('video_i2v') : [],
				// Video format: the persona's setting is the initial pick; the composer
				// lets the user force spokesperson (OmniHuman) or b-roll for this run.
				format: personaFormat,
				stepsSpokesperson,
				stepsBroll,
				// Captions + AI badge default OFF — the composer surfaces them as toggles.
				captions: false,
				aiBadge: false,
				editable: ['topic', 'media', 'provider', 'platforms', 'product_id', 'product_photo_url', 'character_ref_url', 'scene', 'video_model', 'format', 'scheduled_date', 'scheduled_time', 'captions', 'ai_badge'],
				steps,
				estimatedCostUsd: +steps.reduce((s, x) => s + x.usd, 0).toFixed(4)
			}
		});
	}

	// ── Async job path ───────────────────────────────────────────────────────
	// Create the post row up front so the client has an id to poll. A caller-
	// supplied schedule slot is kept; otherwise the completion task stamps
	// "now" exactly like the old synchronous path did.
	const { data: pending, error: pendingErr } = await db.posts.create({
		user_id: user.id,
		agent_id: agentId,
		content: JSON.stringify({ topic: body.topic || null }),
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
				const content = pack.content;

				// Which SELECTED platforms can actually accept this pack's media type?
				let publishablePlatforms = targetPool;
				if (content?.media_type !== 'video') {
					publishablePlatforms = targetPool.filter(
						(p: string) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p.toLowerCase())
					);
				}

				// No publishable platform → keep the generated content as a DRAFT
				// rather than failing. This is the "generate without a connection" path.
				if (publishablePlatforms.length === 0) {
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
						content: JSON.stringify({
							topic: body.topic || null,
							error: (genErr as Error).message || 'Generation failed'
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
		'[generate-post] posts_status_check rejected status \'generating\' — apply post_status_generating_migration.sql. Falling back to synchronous generation.'
	);

	let content;
	try {
		const pack = wantCinematic
			? await generateCinematicUgcPack({ supabase: locals.supabase, ...genInput })
			: await generateUgcPack({ supabase: locals.supabase, ...genInput });
		content = pack.content;
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
	// than erroring. This is the "generate without a connection" path.
	if (publishablePlatforms.length === 0) {
		const reason =
			connectedPlatforms.length === 0
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
