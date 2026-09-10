import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { checkAgentAccess } from '$lib/server/workspaces';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { persistBufferToStorage } from '$lib/server/storage';
import {
	CARD_RENDERER_LABEL,
	isCardRendererAvailable,
	renderTypographicCard,
	type CardLayout
} from '$lib/server/content/card-renderer';
import { planCardSet, type PlannedCard } from '$lib/server/content/card-set';
import { loadBriefForAgent, recordCostEvents } from '$lib/server/content/generate';
import { stillToMotion } from '$lib/server/video';
import { VIDEO_ONLY_PLATFORMS } from '$lib/server/social/platforms';
import { summarizeAspects, summarizeCosts, type CostEvent } from '$lib/pricing';
import { MAX_CARD_QUOTES, MAX_QUOTE_CHARS, type CardLook } from '$lib/card-quotes';

/**
 * "My own words" cards — a batch of typographic cards from quotes the user
 * typed, with NO model anywhere in the run.
 *
 * The text-card format is Director → quality gate → local typesetting. The
 * Director is the only paid stage, and the gate exists to abandon a weak
 * Director draft before money is spent on it. When the user supplies the
 * words there is nothing to write and nothing to grade, so this route skips
 * both by construction: it never resolves an AI client, never reads a provider
 * key, and records one $0 'local' event per card so the ledger says these
 * posts cost nothing rather than that they went unaccounted.
 *
 * Shape: one post row per quote, created up front as 'generating' (so the feed
 * shows them landing) and rendered in the background a few at a time. Every
 * card lands as a DRAFT — a hundred rows typed in one go must never be able to
 * race to a live account through a fully-autonomous persona.
 *
 * Nothing here can fall through to the image-model path. A host that cannot
 * typeset refuses the whole batch before a row exists, because "free" is the
 * promise this route makes and a silent $0.08 × 100 fallback would break it.
 */

const LAYOUTS: CardLayout[] = ['statement', 'quote', 'stack', 'list', 'split'];
const LOOKS: CardLook[] = ['set', 'same', 'unique'];
/** ffmpeg passes at once. A card is cheap; a hundred concurrent encoders is not. */
const CONCURRENCY = 3;

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

	let body: Record<string, unknown> = {};
	try {
		const parsed: unknown = await request.json();
		if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
	} catch {
		/* an empty body is refused below */
	}

	// ── The batch ────────────────────────────────────────────────────────────
	const rawQuotes: unknown = body.card_texts ?? body.quotes;
	if (!Array.isArray(rawQuotes) || rawQuotes.length === 0) {
		return json(
			{ success: false, error: 'Send card_texts — one quote per card.' },
			{ status: 400 }
		);
	}
	if (rawQuotes.length > MAX_CARD_QUOTES) {
		return json(
			{ success: false, error: `Up to ${MAX_CARD_QUOTES} cards per batch.` },
			{ status: 400 }
		);
	}
	const quotes = rawQuotes.map((q) =>
		String(q ?? '')
			.replace(/\r/g, '')
			.trim()
			.slice(0, MAX_QUOTE_CHARS)
	);
	const look: CardLook = LOOKS.includes(body.card_look as CardLook)
		? (body.card_look as CardLook)
		: 'set';
	const layout: CardLayout | null = LAYOUTS.includes(body.card_layout as CardLayout)
		? (body.card_layout as CardLayout)
		: null;
	const ground: string | null =
		typeof body.card_palette === 'string' &&
		/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(body.card_palette.trim())
			? body.card_palette.trim()
			: null;
	// The composer sends the format's request fields; a motion card is the same
	// typeset card put in motion by a local ffmpeg pass — still $0.
	const motion = body.format === 'motion_card' || body.motion === true;
	const studioTemplate = typeof body.studio_template === 'string' ? body.studio_template : null;
	const standalone = body.deliver === 'asset';
	const studioMeta =
		studioTemplate || standalone
			? {
					...(studioTemplate ? { template: studioTemplate } : {}),
					...(standalone ? { standalone: true } : {})
				}
			: null;

	// ── Refuse before a row exists if the promise cannot be kept ─────────────
	if (!(await isCardRendererAvailable())) {
		return json(
			{
				success: false,
				error:
					'This server cannot typeset cards right now (ffmpeg or a font is missing). Nothing was created and nothing was charged.'
			},
			{ status: 409 }
		);
	}
	let svc: ReturnType<typeof getServiceSupabase>;
	try {
		svc = getServiceSupabase();
	} catch {
		return json(
			{
				success: false,
				error: 'No storage service is configured — a rendered card would have nowhere to live.'
			},
			{ status: 503 }
		);
	}

	// Brand colors: the persona's pinned brief, exactly as the Director path
	// reads it. No brief → the renderer's curated palettes.
	let brand: { primary?: string | null; secondary?: string | null } | null = null;
	try {
		const { data: cfg } = await locals.supabase
			.from('agent_configs')
			.select('brand_brief_id')
			.eq('agent_id', agentId)
			.maybeSingle();
		const brief = await loadBriefForAgent(db, user.id, cfg?.brand_brief_id ?? null);
		const d = brief?.data ?? null;
		if (d) brand = { primary: d.primaryColor ?? null, secondary: d.secondaryColor ?? null };
	} catch {
		/* brand context is a nicety; the curated palettes are the fallback */
	}

	const plan = planCardSet({ quotes, look, layout, ground, brand });
	if (plan.cards.length === 0) {
		return json(
			{
				success: false,
				error: 'None of these quotes can be typeset — they use characters the card font cannot draw.',
				skipped: plan.skipped.map((s) => ({ text: s.text, reason: s.reason }))
			},
			{ status: 400 }
		);
	}

	// ── Platforms: the same rule as generate-post, minus anything a still cannot go to ──
	const { data: connections } = await locals.supabase
		.from('connections')
		.select('platform')
		.eq('agent_id', agentId)
		.eq('status', 'active');
	const connectedPlatforms: string[] = ((connections ?? []) as Array<{ platform: string }>).map(
		(c) => String(c.platform)
	);
	const requested: string[] | null = Array.isArray(body.platforms)
		? (body.platforms as unknown[])
				.map((p) => String(p).toLowerCase())
				.filter((p) => connectedPlatforms.includes(p))
		: null;
	const videoPool = requested === null ? connectedPlatforms : requested;
	const imagePool = videoPool.filter(
		(p) => !(VIDEO_ONLY_PLATFORMS as readonly string[]).includes(p.toLowerCase())
	);

	const intended = {
		media: motion ? 'video' : 'image',
		...(motion ? { format: 'motion_card' } : {}),
		still: 'graphic'
	};

	// ── Rows first, so the feed can watch them land ───────────────────────────
	const created: Array<{ id: string; card: PlannedCard }> = [];
	let firstErr: string | null = null;
	for (const card of plan.cards) {
		const { data: row, error } = await db.posts.create({
			user_id: user.id,
			agent_id: agentId,
			content: JSON.stringify({
				topic: null,
				intended,
				own_words: true,
				card_text: card.text,
				...(studioMeta ? { studio: studioMeta } : {})
			}),
			platforms: motion ? videoPool : imagePool,
			// Not in PostRow's status union (db.ts is owned by the posts feature) —
			// the DB CHECK constraint is the real gate here.
			status: 'generating' as unknown as 'draft',
			scheduled_date: null,
			scheduled_time: null,
			published_at: null,
			token_cost: 0
		});
		if (error || !row) {
			firstErr ??= error?.message ?? 'insert failed';
			console.error('[cards] could not create a card row:', firstErr);
			// One bad insert is a transient; a failing FIRST insert is the schema
			// (posts_status_check without 'generating') — stop rather than loop.
			if (created.length === 0) break;
			continue;
		}
		created.push({ id: row.id, card });
	}
	if (created.length === 0) {
		return json(
			{ success: false, error: `Could not create the card rows: ${firstErr ?? 'unknown error'}` },
			{ status: 500 }
		);
	}

	// ── Detached render job ─────────────────────────────────────────────────
	const taskDb = createDbService(svc);
	const handle = agent.handle ? `@${agent.handle}` : null;
	void runPool(created, CONCURRENCY, ({ id, card }) =>
		renderOne({
			svc,
			taskDb,
			userId: user.id,
			agentId,
			postId: id,
			card,
			motion,
			handle,
			intended,
			studioMeta,
			videoPool,
			imagePool
		})
	).catch((e) => console.error('[cards] batch runner crashed:', e));

	return json(
		{
			success: true,
			status: 'generating',
			count: created.length,
			post_ids: created.map((c) => c.id),
			skipped: plan.skipped.map((s) => ({ text: s.text, reason: s.reason }))
		},
		{ status: 202 }
	);
};

interface RenderJob {
	svc: ReturnType<typeof getServiceSupabase>;
	taskDb: ReturnType<typeof createDbService>;
	userId: string;
	agentId: string;
	postId: string;
	card: PlannedCard;
	motion: boolean;
	handle: string | null;
	intended: Record<string, unknown>;
	studioMeta: Record<string, unknown> | null;
	videoPool: string[];
	imagePool: string[];
}

/** Typeset one card (and animate it when asked), then land the row as a draft. */
async function renderOne(j: RenderJob): Promise<void> {
	const costEvents: CostEvent[] = [];
	try {
		const rendered = await renderTypographicCard({
			cardText: j.card.text,
			layout: j.card.layout,
			brand: j.card.brand,
			handle: j.handle
		});
		if (!rendered) {
			throw new Error('The card could not be typeset on this server (ffmpeg or font missing).');
		}
		const stillUrl = await persistBufferToStorage(j.svc, rendered.buffer, j.userId, 'png', 'image/png');
		// $0 by construction — recorded so the ledger, provenance and drawer all
		// say this card cost nothing, not that it went unaccounted.
		costEvents.push({
			provider: 'local',
			operation: 'image',
			model: CARD_RENDERER_LABEL,
			usd: 0,
			assetUrl: stillUrl
		});

		let mediaUrl = stillUrl;
		let mediaType: 'image' | 'video' = 'image';
		let motionAssembled = false;
		if (j.motion) {
			const clip = await stillToMotion(stillUrl);
			if (clip) {
				mediaUrl = await persistBufferToStorage(j.svc, clip, j.userId, 'mp4', 'video/mp4');
				mediaType = 'video';
				motionAssembled = true;
			} else {
				// Same rule as the Director path: ship the still rather than fail a
				// card the user already approved, and let the record say what shipped.
				console.warn('[cards] motion could not be assembled locally — delivering the still card.');
			}
		}

		const content = {
			// The quote IS the caption: nothing wrote a second line, so nothing claims to have.
			text: j.card.text,
			hashtags: [] as string[],
			on_screen_text: j.card.text,
			media_url: mediaUrl,
			poster_url: stillUrl,
			media_type: mediaType,
			media_generated: true,
			...(mediaType === 'video' ? { format: 'motion_card' } : {}),
			intended: j.intended,
			own_words: true,
			card_text: j.card.text,
			qualityGrade: null,
			qc_status: 'ungraded',
			costBreakdown: summarizeCosts(costEvents),
			generation: {
				...summarizeAspects(costEvents),
				images: { character_ref: null, product_photo: null },
				still_style: 'graphic',
				refs_policy: { character: false, product: false },
				card_text: j.card.text,
				card_layout: rendered.layout,
				card_palette: rendered.palette,
				// Who wrote the words — the drawer can say "yours" instead of naming a model.
				words: 'own',
				...(j.motion && !motionAssembled ? { motion_assembled: false as const } : {})
			},
			...(j.studioMeta ? { studio: j.studioMeta } : {})
		};
		await j.taskDb.posts.update(j.postId, {
			content: JSON.stringify(content),
			platforms: mediaType === 'video' ? j.videoPool : j.imagePool,
			status: 'draft',
			token_cost: 0
		});
	} catch (e) {
		const message = (e as Error)?.message ?? String(e);
		console.error(`[cards] ${j.postId} failed:`, message);
		try {
			await j.taskDb.posts.update(j.postId, {
				content: JSON.stringify({
					intended: j.intended,
					own_words: true,
					card_text: j.card.text,
					error: message
				}),
				status: 'failed'
			});
		} catch (updateErr) {
			console.error(`[cards] ${j.postId} could not be marked failed:`, (updateErr as Error).message);
		}
	} finally {
		if (costEvents.length) {
			await recordCostEvents(j.svc, j.userId, j.agentId, costEvents, j.postId).catch((e) =>
				console.error('[cards] ledger write failed:', (e as Error).message)
			);
		}
	}
}

/** Run `fn` over `items` with at most `n` in flight; never rejects for one item's failure. */
async function runPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
		while (next < items.length) {
			const item = items[next++];
			try {
				await fn(item);
			} catch (e) {
				console.error('[cards] worker error:', (e as Error).message);
			}
		}
	});
	await Promise.all(workers);
}
