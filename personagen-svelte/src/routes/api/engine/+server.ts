import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';
import { getUserApiKey } from '$lib/server/user-api-keys';
import { publishPostById } from '$lib/server/scheduler';
import { resolveAiClient } from '$lib/server/ai-client';
import { meteredAiClient, meteredCall, meteringRefusal, BATCH_MAX } from '$lib/server/metering';
import { assertWithinBudget } from '$lib/server/budget';
import { creditsFor } from '$lib/server/credits';
import { priceOf as meteringPriceOf } from '$lib/pricing';
import {
	generateUgcPack,
	generateUgcImage,
	safeParseJson,
	resolveImageKeys,
	loadBriefForAgent,
	inferGenderFromName
} from '$lib/server/content/generate';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { persistToStorage } from '$lib/server/storage';
import {
	PERSONA_ARCHETYPES,
	CONTENT_FOCUS_OPTIONS,
	AGE_RANGE_KEYS,
	NICHE_OPTIONS,
	APPEARANCE_FIELDS,
	coerceToOption,
	coerceAgeRanges,
	coerceAppearance,
	stripLeadingAvatarName
} from '$lib/persona-profile';
import {
	PLATFORM_BIO_SPECS,
	BIO_PLATFORM_KEYS,
	STARTER_BIO_PLATFORMS,
	coerceBios,
	coerceHandleCandidates,
	coerceConfirmedHandles,
	sanitizeHandle
} from '$lib/persona-identity';
import { readPersonaProfile } from '$lib/persona-profile-store';
import { pickVoiceForProfile } from '$lib/server/voices';
import { resolvePublicIps } from '$lib/server/safe-fetch';

/**
 * The `appearance` JSON contract handed to the persona-generation prompts, derived
 * from APPEARANCE_FIELDS so a newly added trait can never be silently omitted.
 *
 * Curated traits (`options.length > 0`) list their ALLOWED OPTIONS rather than a
 * free-text hint: the persona page renders those traits as chips, so a value the
 * model invented ("late twenties") is preserved but has no chip to select, and the
 * trait reads as unset / "Best Fit". Free-text traits keep their placeholder hint
 * (minus its `e.g. ` prefix). Off-list values still degrade gracefully — the prompt
 * only steers, `coerceAppearance()` never snaps a value onto the list.
 */
const APPEARANCE_CONTRACT = APPEARANCE_FIELDS.map((f) =>
	f.options.length > 0
		? `${f.key} (pick EXACTLY one of: ${f.options.join(' | ')})`
		: `${f.key} (${f.placeholder.replace(/^e\.g\.\s*/, '')})`
).join('; ');

/** The `appearance` skeleton for the prompts' "Return ONLY JSON" example — every key. */
const APPEARANCE_JSON_SKELETON = `{${APPEARANCE_FIELDS.map((f) => `"${f.key}":""`).join(',')}}`;

/**
 * Cross-persona LOOK fingerprint: the visual dimensions a new persona must differ on.
 * Must cover every trait that meaningfully changes the face/body, otherwise two
 * personas converge through whichever dimension is missing here.
 */
function appearanceFingerprint(appearance: any): string {
	const ap = appearance || {};
	return [
		ap.ethnicity,
		ap.personaAge,
		ap.skinTone,
		ap.bodyType,
		ap.hairColor,
		ap.hairLength,
		ap.hairstyle,
		ap.eyeColor,
		ap.headwear,
		ap.wardrobe,
		ap.outfitColors
	]
		.filter(Boolean)
		.join(', ');
}

/**
 * SSRF guard for the storefront-scrape fallback below: an authenticated user
 * supplies an arbitrary URL, and without this check the server would fetch
 * whatever they point it at — cloud metadata endpoints, internal admin
 * panels, localhost services. Resolves the hostname (not just string-matches
 * it) so a public-looking domain that resolves to a private IP is still
 * rejected — a bare hostname check alone doesn't stop that DNS-rebinding-style
 * bypass.
 */
/**
 * URL guard for every user-supplied URL this route hands to a fetcher (store
 * scrape, product scrape, discovered links, vision image). One implementation,
 * shared with `ai-client.ts`: `$lib/server/safe-fetch`. The private copy that
 * used to live here lagged it (no carrier-grade-NAT range, no `::`), which is
 * exactly how two guards drift into one weak one.
 */
async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
	await resolvePublicIps(rawUrl);
}

/**
 * Guards the scrape → AI-extraction boundary. A transport-level "success"
 * doesn't mean the storefront was returned: Shopify/Cloudflare throttle
 * crawlers with tiny error bodies (e.g. "local_rate_limited", 26 chars,
 * upstream status 429) that Firecrawl still relays as success:true markdown.
 * Handing that to the extractor makes it fabricate a brand out of the error
 * text, which then auto-saves over the user's brief. Returns a human-readable
 * problem description, or null when the content is safe to extract from.
 */
function scrapeContentProblem(
	content: string,
	upstreamStatus?: number,
	minChars = 400
): string | null {
	if (upstreamStatus && upstreamStatus >= 400) {
		return `the site responded with HTTP ${upstreamStatus}`;
	}
	const text = content.trim();
	if (text.length < minChars) {
		return `page content too short to be a real storefront (${text.length} chars)`;
	}
	// Error/challenge pages are short and dominated by error text; a real
	// storefront can legitimately mention "blocked" somewhere deep in a long
	// page, so only pattern-match when the content is suspiciously small.
	if (
		text.length < 3000 &&
		/rate.?limit|too many requests|access denied|forbidden|captcha|are you a robot|attention required|checking your browser|verify you are human|service unavailable|temporarily unavailable|error \d{3}/i.test(
			text
		)
	) {
		return 'page content looks like an error or bot-challenge page';
	}
	return null;
}

/**
 * Hallucination guard for brand extraction: a genuinely extracted brand name
 * comes FROM the page, so the whole name must appear in the scraped content
 * (contiguously, ignoring punctuation/spacing), match the store's domain, or
 * have every meaningful token present as a real word in the content. Any-token
 * matching is NOT enough — the invented "Local Rate Limited" shared the
 * generic word "local" with the genuine page and would slip through.
 */
function isBrandNameGrounded(brandName: unknown, content: string, storeUrl: string): boolean {
	const name = String(brandName);
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const nameNorm = norm(name);
	if (!nameNorm) return false;
	if (norm(content).includes(nameNorm)) return true;
	try {
		const host = new URL(storeUrl).hostname.toLowerCase().replace(/^www\./, '');
		const domainNorm = norm(host);
		const domainCore = norm(host.split('.')[0]);
		if (domainNorm.includes(nameNorm)) return true;
		if (domainCore.length >= 4 && nameNorm.includes(domainCore)) return true;
	} catch {
		// unparseable URL — fall back to content-only grounding
	}
	const tokens = name
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 3);
	if (tokens.length === 0) return false;
	const contentLower = content.toLowerCase();
	return tokens.every((t) => new RegExp(`\\b${t}\\b`).test(contentLower));
}

/** Resolves an image/link URL (absolute, protocol-relative, or root-relative) against a base. */
function resolveHttpUrl(raw: string, base: string): string | null {
	try {
		const u = new URL(raw.trim(), base);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/** First content value of a named/property meta tag, tolerating either attribute order. */
function metaContent(html: string, key: string): string {
	const attr = `(?:property|name)=["']${key}["']`;
	return (
		html.match(new RegExp(`<meta[^>]+${attr}[^>]*content=["']([^"']+)["']`, 'i'))?.[1] ||
		html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${attr}`, 'i'))?.[1] ||
		''
	);
}

/**
 * Harvests image URLs from raw HTML. Storefront themes (Shopify especially)
 * ship protocol-relative src ("//cdn.shopify.com/…") and lazy-load through
 * srcset/data-src — an https?:-only <img src> regex sees ZERO images on such
 * pages, which is exactly why scraped products arrived photoless.
 */
function harvestImageUrls(html: string, baseUrl: string, cap = 30): string[] {
	const found: string[] = [];
	const push = (raw: string) => {
		const u = resolveHttpUrl(raw, baseUrl);
		// Skip vectors (icons/sprites) and inline data — products need photos.
		if (u && !/\.svg(\?|$)/i.test(u) && !u.startsWith('data:') && !found.includes(u)) {
			found.push(u);
		}
	};
	for (const m of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi)) {
		push(m[1]);
		if (found.length >= cap) return found;
	}
	for (const m of html.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)) {
		// srcset is comma-separated "url width" pairs — take the last (largest).
		const parts = m[1]
			.split(',')
			.map((s) => s.trim().split(/\s+/)[0])
			.filter(Boolean);
		if (parts.length) push(parts[parts.length - 1]);
		if (found.length >= cap) return found;
	}
	return found;
}

/**
 * Harvests genuine logo candidates from HTML: favicon/apple-touch <link> icons
 * and images whose URL names a logo. og:image is deliberately NOT included —
 * it is usually a hero/campaign banner (the "sitewide sale" banner that got
 * saved as a brand logo), so it belongs at the END of the candidate list only.
 */
function harvestLogoUrls(html: string, baseUrl: string): string[] {
	const found: string[] = [];
	const push = (raw: string) => {
		const u = resolveHttpUrl(raw, baseUrl);
		if (!u || found.includes(u)) return;
		// Icon URLs often carry tiny resize params (width=32) — offer the
		// original file first where the CDN pattern allows it.
		if (/[?&](?:width|height|crop)=/i.test(u)) {
			const bare = u.split('?')[0];
			if (!found.includes(bare)) found.push(bare);
		}
		found.push(u);
	};
	for (const m of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']*logo[^"']*)["']/gi)) {
		push(m[1]);
	}
	for (const m of html.matchAll(
		/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*href=["']([^"']+)["']/gi
	)) {
		push(m[1]);
	}
	for (const m of html.matchAll(
		/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["']/gi
	)) {
		push(m[1]);
	}
	return found.slice(0, 6);
}

export const POST: RequestHandler = async ({ url, request, locals, fetch }) => {
	// 1. Authenticate user
	const { session } = await locals.safeGetSession();
	if (!session) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const path = url.searchParams.get('path');
	if (!path) {
		return json({ success: false, error: 'Missing path parameter' }, { status: 400 });
	}

	const body = (await request.json()) as any;
	const action = body.action;

	const db = createDbService(locals.supabase);
	// Every engine text call is metered through one wrapper: gated once per
	// request, recorded + debited per call (D11). Nothing below changes.
	const ai = meteredAiClient(await resolveAiClient(locals.supabase, session.user.id), { supabase: locals.supabase, userId: session.user.id });
	const hasAi = !!ai;

	console.log(
		`[Local Engine] Handling path "${path}" with action "${action}" (AI Provider: ${ai?.provider || 'none'})`
	);

	try {
		// ══════════════════════════════════════════════════════════════════════════
		// A. PATH: personagen-blueprints (Style Template Vault)
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-blueprints') {
			if (action === 'list_blueprints') {
				const { data: blueprints, error } = await db.blueprints.list();
				if (error) {
					console.error('[Engine] Failed to list blueprints:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true, data: blueprints });
			}

			if (action === 'get_blueprint') {
				const { data: blueprint, error } = await db.blueprints.get(body.id);
				if (error) {
					console.error('[Engine] Failed to get blueprint:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true, data: blueprint });
			}

			if (action === 'save_blueprint') {
				const { data: inserted, error } = await db.blueprints.create({
					user_id: session.user.id,
					channel_name: body.channel_name || body.name || 'UGC Template',
					channel_url: body.channel_url || null,
					platform: body.platform || 'instagram',
					score: Number(body.score || 90),
					layers: body.layers || {}
				});
				if (error) {
					console.error('[Engine] Failed to save blueprint:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true, data: inserted });
			}

			if (action === 'update_blueprint') {
				const { data: updated, error } = await db.blueprints.update(body.id, body.data);
				if (error) {
					console.error('[Engine] Failed to update blueprint:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true, data: updated });
			}

			if (action === 'delete_blueprint') {
				const { error } = await db.blueprints.delete(body.id);
				if (error) {
					console.error('[Engine] Failed to delete blueprint:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true });
			}

			return json(
				{ success: false, error: `Invalid blueprint vault action: ${action}` },
				{ status: 400 }
			);
		}

		// ══════════════════════════════════════════════════════════════════════════
		// B. PATH: personagen-content-forge (Unified Generation Engine)
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-content-forge') {
			const topic = body.topic || 'Growing your personal brand';
			const platform = body.platforms?.[0] || body.platform || 'instagram';
			const blueprintId = body.blueprint_id || body.template_id;
			const agentId = body.agent_id || body.agentId;
			const productId = body.product_id || body.productId;

			// ── Load agent persona ──────────────────────────────────────────────
			// skills may be structured JSON ([{name, md}]) from the persona editor —
			// summarize to names+playbooks instead of dumping raw JSON in prompts.
			const summarizeSkills = (raw: string): string => {
				try {
					const j = JSON.parse(raw);
					if (Array.isArray(j)) {
						return j
							.filter((s: any) => s?.name)
							.map((s: any) => `${s.name}${s.md ? `: ${String(s.md).slice(0, 200)}` : ''}`)
							.join(' | ');
					}
				} catch {
					/* legacy plain text */
				}
				return raw;
			};
			let agentContext = '';
			let agentData: any = null;
			if (agentId) {
				const { data: agent } = await db.agents.get(agentId);
				if (agent) {
					agentData = agent;
					agentContext = `You are ${agent.name} (@${agent.handle}), a ${agent.niche} content creator.
Personality: ${agent.soul || 'Authentic and relatable'}
Content Style: ${summarizeSkills(agent.skills || '') || 'UGC-style product content'}
`;
				}
			}

			// ── Load brand brief + select product ───────────────────────────────
			// Persona-pinned brief first (multi-brand users pin one brief per
			// persona via agent_configs.brand_brief_id), newest brief as the
			// fallback — the same resolution the UGC pipeline uses.
			let productContext = '';
			let selectedProduct: any = null;
			let briefData: any = null;
			let pinnedBriefId: string | null = null;
			if (agentId) {
				const { data: agentCfg } = await locals.supabase
					.from('agent_configs')
					.select('brand_brief_id')
					.eq('agent_id', agentId)
					.maybeSingle();
				pinnedBriefId = agentCfg?.brand_brief_id || null;
			}
			const brandBrief = await loadBriefForAgent(db, session.user.id, pinnedBriefId);
			if (brandBrief?.data) {
				briefData = brandBrief.data;
				const products = Array.isArray(briefData.products) ? briefData.products : [];
				selectedProduct = productId
					? products.find((p: any) => p.id === productId)
					: products.find((p: any) => p.photoUrl) || products[0];

				if (selectedProduct) {
					productContext += `PRODUCT TO FEATURE:
Name: ${selectedProduct.name}
Price: ${selectedProduct.price || 'N/A'}
Description: ${selectedProduct.description || 'N/A'}
Product Image URL: ${selectedProduct.photoUrl || 'N/A'}
`;
				}
				productContext += `BRAND CONTEXT:
Brand: ${briefData.brandName || 'N/A'}
Tagline: ${briefData.tagline || 'N/A'}
Target Audience: ${briefData.demographics || 'N/A'}
Pain Points: ${briefData.painPoints || 'N/A'}
Brand Voice: ${briefData.commStyle || 'N/A'}
Brand Traits: ${Array.isArray(briefData.traits) ? briefData.traits.join(', ') : 'N/A'}
`;
			}

			// ── Load style template (blueprint) ─────────────────────────────────
			let templateDetails = '';
			if (blueprintId && !blueprintId.startsWith('bp-')) {
				try {
					const { data: bp } = await db.blueprints.get(blueprintId);
					if (bp) {
						templateDetails = `UGC STYLE TEMPLATE: "${bp.channel_name}"
Platform: ${bp.platform || platform}
`;
						if (bp.layers) {
							const layersList = Array.isArray(bp.layers) ? bp.layers : [];
							const hookFindings = layersList.find(
								(l: any) => l.title === 'Hook Patterns'
							)?.findings;
							const dnaFindings = layersList.find((l: any) => l.title === 'Content DNA')?.findings;
							const replicationFindings = layersList.find(
								(l: any) => l.title === 'Replication Blueprint'
							)?.findings;

							if (hookFindings?.length > 0) {
								templateDetails += `- Hook style: ${hookFindings.join('; ')}\n`;
							}
							if (dnaFindings?.length > 0) {
								templateDetails += `- Content DNA: ${dnaFindings.join('; ')}\n`;
							}
							if (replicationFindings?.length > 0) {
								templateDetails += `- Style guidelines: ${replicationFindings.join('; ')}\n`;
							}
						}
					}
				} catch (err) {
					console.warn('[Engine] Failed to load template for prompt enrichment:', err);
				}
			}

			// ── Assembled context block (injected into every prompt) ─────────────
			const fullContext = [agentContext, productContext, templateDetails]
				.filter(Boolean)
				.join('\n');

			// ── ACTION: generate (single UGC post pack — replaces generate-post) ──
			if (action === 'generate') {
				if (!hasAi) {
					// No AI = no content. Never fabricate a canned post as success —
					// it would look like real generation and get published as-is.
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}

				try {
					// Interactive forge preview: caption + product-accurate still only
					// (fast + cheap). Full video is produced at generate-post / autopilot time.
					const { content } = await generateUgcPack({
						supabase: locals.supabase,
						userId: session.user.id,
						agentId,
						productId,
						blueprintId,
						platform,
						topic,
						video: false
					});
					return json({ success: true, data: content });
				} catch (genErr) {
					const msg = (genErr as Error).message;
					const status = /image generation/i.test(msg) ? 502 : 500;
					return json({ success: false, error: msg }, { status });
				}
			}

			// ── ACTION: batch_generate (100 UGC copies in one click) ────────────
			if (action === 'batch_generate') {
				const count = Math.min(Math.max(body.count || 10, 1), BATCH_MAX);
				// Gate the WHOLE batch up front at retail (text + still per copy), so a
				// thin wallet is refused before the first paid call instead of after copy 7.
				try {
					await assertWithinBudget(locals.supabase, session.user.id, undefined, creditsFor(count * (meteringPriceOf('openrouter', 'llm') + meteringPriceOf('fal', 'image', 'nano'))));
				} catch (gateErr) {
					const refusal = meteringRefusal(gateErr);
					return json(refusal.body, { status: refusal.status });
				}
				const BATCH_SIZE = 10;

				if (!hasAi) {
					return json(
						{ success: false, error: 'No AI provider configured. Add an API key in Settings.' },
						{ status: 500 }
					);
				}

				const copies: any[] = [];
				let imageFailures = 0;

				// Resolve image providers once for the whole batch — same per-user
				// key resolution the rest of the pipeline uses (user's saved
				// OpenRouter/fal keys first, env keys as the fallback).
				const { orKey, falKey, orRoutes } = await resolveImageKeys(locals.supabase, session.user.id);
				if (!orKey && !falKey) {
					return json(
						{
							success: false,
							error:
								'No image generation provider configured. Add an OpenRouter or Fal AI key in Settings before batch generating.'
						},
						{ status: 500 }
					);
				}

				// Every batch image must be archived in our bucket so the scheduled post
				// doesn't reference a provider URL that 404s before it's ever published.
				// Degrade (warn + keep provider URL) only if no service-role key exists.
				const batchSvc = (() => {
					try {
						return getServiceSupabase();
					} catch {
						return null;
					}
				})();
				if (!batchSvc) {
					console.warn(
						'[Engine] No service-role Supabase key — batch images will be stored as EPHEMERAL provider URLs (not backed up).'
					);
				}

				const batchSystemInstruction = `${agentContext || 'You are a real person sharing authentic product experiences on social media.'}
Write like a HUMAN — casual, punchy, first-person. Caption MAX 4 lines. BANNED words: "elevate", "premium quality", "transform", "game-changer". 1-3 emojis max. Hook lands in first 7 words. Hashtags in the hashtags array ONLY, never in text field.
Return ONLY valid JSON: { "text": "caption no hashtags", "hashtags": ["#tag",...5 tags], "hookScore": 70-99, "ugc_broll_prompt": "specific UGC creator brief with location/action/camera", "script": "15s [0-3s hook][3-12s demo][12-15s CTA]" }`;

				for (let i = 0; i < count; i += BATCH_SIZE) {
					const batchPromises = Array.from(
						{ length: Math.min(BATCH_SIZE, count - i) },
						async (_, j) => {
							const idx = i + j + 1;
							const prompt = `${fullContext}
Write variation ${idx} of ${count} — a UNIQUE UGC post for ${platform}.
${selectedProduct ? `Product: "${selectedProduct.name}". Feature it by name in an authentic first-person way.` : `Topic: "${topic}"`}

Make this variation DISTINCT from others: different hook angle, different emotion, different CTA style, different scene.
Output ONLY the JSON.`;
							try {
								const raw = await ai!.generate(prompt, {
									json: true,
									systemInstruction: batchSystemInstruction
								});
								const parsed = safeParseJson(raw);
								if (!parsed || !parsed.text || !parsed.ugc_broll_prompt) return null;
								// Generate a unique UGC image for this copy — no product-photo fallback
								const gen = await meteredCall(
									{ supabase: locals.supabase, userId: session.user.id },
									// Positional defaults kept explicit so the registry-resolved t2i route
									// lands in the trailing slot without changing model/aspect/people.
									() => generateUgcImage(parsed.ugc_broll_prompt, orKey, falKey, undefined, '3:4', true, orRoutes.t2i),
									{
										estimateUsd: meteringPriceOf('fal', 'image', 'nano'),
										event: (r) => ({ provider: r.provider, operation: 'image', model: r.model, usd: meteringPriceOf(r.provider, 'image', r.provider === 'fal' ? 'nano' : undefined) })
									}
								);
								// Archive it now. With a service key, a persist failure throws →
								// this item drops to a failure rather than scheduling a post with a
								// dead media_url. Without one, we fall back to the provider URL.
								parsed.media_url = batchSvc
									? await persistToStorage(batchSvc, gen.url, session.user.id, 'png')
									: gen.url;
								parsed.media_generated = true;
								parsed.product = selectedProduct
									? {
											name: selectedProduct.name,
											price: selectedProduct.price,
											description: selectedProduct.description
										}
									: null;
								parsed.platform = platform;
								return parsed;
							} catch (err: any) {
								console.error(`[Engine] Batch item ${idx} failed:`, err?.message || err);
								return null;
							}
						}
					);

					const results = await Promise.allSettled(batchPromises);
					for (const r of results) {
						if (r.status === 'fulfilled' && r.value) {
							copies.push(r.value);
						} else {
							imageFailures++;
						}
					}
				}

				if (copies.length === 0) {
					return json(
						{
							success: false,
							error:
								'Batch generation produced no usable posts (text or image generation failed for all items).'
						},
						{ status: 502 }
					);
				}

				return json({
					success: true,
					data: {
						copies,
						total: copies.length,
						requested: count,
						failed: imageFailures,
						product: selectedProduct?.name || null,
						agent: agentData?.name || null
					}
				});
			}

			// ── ACTION: auto_schedule (distribute copies across calendar) ────────
			if (action === 'auto_schedule') {
				const copies = body.copies || [];
				if (copies.length === 0) {
					return json({ success: false, error: 'No copies provided to schedule' }, { status: 400 });
				}
				if (!agentId) {
					return json({ success: false, error: 'Missing agent_id' }, { status: 400 });
				}

				const startDate = body.start_date || new Date().toISOString().split('T')[0];
				const intervalHours = body.interval_hours || 2;
				const windowStart = body.window_start || 8; // 8 AM
				const windowEnd = body.window_end || 20; // 8 PM
				const targetPlatforms = body.platforms || [platform];

				// Calculate slots per day: [8, 10, 12, 14, 16, 18, 20]
				const slotsPerDay: number[] = [];
				for (let h = windowStart; h <= windowEnd; h += intervalHours) {
					slotsPerDay.push(h);
				}

				const scheduled: any[] = [];
				let dayOffset = 0;
				let slotIdx = 0;

				for (const copy of copies) {
					const date = new Date(startDate);
					date.setDate(date.getDate() + dayOffset);
					const hour = slotsPerDay[slotIdx];
					const scheduledDate = date.toISOString().split('T')[0];
					const scheduledTime = `${String(hour).padStart(2, '0')}:00:00`;

					const contentObj = {
						text: copy.text || '',
						ugc_broll_prompt: copy.ugc_broll_prompt || '',
						script: copy.script || '',
						media_url: copy.media_url || selectedProduct?.photoUrl || null,
						poster_url: copy.poster_url || null,
						media_type: copy.media_type || 'image',
						product: copy.product || null,
						hashtags: copy.hashtags || []
					};

					const { data: post, error: postErr } = await db.posts.create({
						user_id: session.user.id,
						agent_id: agentId,
						content: JSON.stringify(contentObj),
						platforms: targetPlatforms,
						status: 'scheduled',
						scheduled_date: scheduledDate,
						scheduled_time: scheduledTime,
						published_at: null
					});

					if (post && !postErr) {
						scheduled.push({
							id: post.id,
							scheduled_date: scheduledDate,
							scheduled_time: scheduledTime
						});
					}

					slotIdx++;
					if (slotIdx >= slotsPerDay.length) {
						slotIdx = 0;
						dayOffset++;
					}
				}

				return json({
					success: true,
					data: {
						scheduled: scheduled.length,
						days_covered: dayOffset + (slotIdx > 0 ? 1 : 0),
						slots_per_day: slotsPerDay.length,
						interval_hours: intervalHours,
						window: `${windowStart}:00 - ${windowEnd}:00`,
						first_post: scheduled[0]?.scheduled_date || null,
						last_post: scheduled[scheduled.length - 1]?.scheduled_date || null,
						posts: scheduled
					}
				});
			}

			// ── ACTION: publish_generated (publish a saved post immediately) ─────
			if (action === 'publish_generated') {
				const content = body.content;
				const mediaUrl = body.media_url || body.mediaUrl || null;

				if (!content || !agentId) {
					return json({ success: false, error: 'Missing content or agent_id' }, { status: 400 });
				}

				// Fetch agent's active connections — optional. No connections → draft.
				const { data: connections } = await locals.supabase
					.from('connections')
					.select('platform')
					.eq('agent_id', agentId)
					.eq('status', 'active');

				const targetPlatforms = (connections || []).map((c: any) => c.platform);
				const hasConnections = targetPlatforms.length > 0;
				const postStatus = hasConnections ? 'scheduled' : 'draft';

				const contentObj = {
					text: typeof content === 'string' ? content : content.content || content.text || '',
					media_url: mediaUrl
				};

				const now = new Date();
				const { data: post, error: postErr } = await db.posts.create({
					user_id: session.user.id,
					agent_id: agentId,
					content: JSON.stringify(contentObj),
					platforms: targetPlatforms.length > 0 ? targetPlatforms : ['instagram'],
					status: postStatus,
					scheduled_date: postStatus === 'scheduled' ? now.toISOString().split('T')[0] : null,
					scheduled_time: postStatus === 'scheduled' ? now.toTimeString().split(' ')[0] : null,
					published_at: null
				});

				if (postErr || !post) {
					return json(
						{ success: false, error: postErr?.message || 'Failed to create post' },
						{ status: 500 }
					);
				}

				let publishSuccess = false;
				if (postStatus === 'scheduled') {
					publishSuccess = await publishPostById(post.id);
				}
				const { data: updatedPost } = await db.posts.get(post.id);

				return json({
					success: true,
					data: {
						post: updatedPost || post,
						published: publishSuccess,
						draft: postStatus === 'draft',
						platforms: targetPlatforms,
						message:
							postStatus === 'draft' ? 'Saved as draft — connect a platform to publish.' : undefined
					}
				});
			}

			// ── ACTION: generate_profile ─────────────────────────────────────────
			if (action === 'generate_profile') {
				if (!agentId) {
					return json({ success: false, error: 'Missing agent_id' }, { status: 400 });
				}
				if (!agentData) {
					const { data: agent } = await db.agents.get(agentId);
					if (!agent) return json({ success: false, error: 'Persona not found' }, { status: 404 });
					agentData = agent;
				}

				if (hasAi) {
					const prompt = `You are a social media branding expert. Generate a complete profile setup for this persona:

Name: ${agentData.name}
Handle: @${agentData.handle}
Niche: ${agentData.niche}
Personality: ${agentData.soul || 'Professional and authentic'}
Skills/Style: ${agentData.skills || 'Content creation'}
${briefData ? `Brand: ${briefData.brandName || ''}\nIndustry: ${briefData.industry || ''}\nTarget Audience: ${briefData.demographics || ''}\nBrand Voice: ${briefData.commStyle || ''}` : ''}

Return a JSON object with:
{
  "bio": "Ready-to-paste Instagram bio (max 150 chars). Include relevant emoji, a hook line, niche identifier, and a CTA. No hashtags in bio.",
  "profile_picture_prompt": "Detailed AI image generation prompt for a professional profile picture. Describe: subject appearance/style matching the niche, lighting (soft studio or natural), composition (headshot or upper body, centered), background (clean/branded), mood (approachable, trustworthy). Square 1:1 ratio, high quality.",
  "display_name": "Optimized display name with relevant emoji or niche keyword (max 30 chars)",
  "highlights_suggestions": ["5 Instagram Story Highlight cover names relevant to the niche"]
}`;

					try {
						const text = await ai!.generate(prompt, { json: true });
						const parsed = safeParseJson(text);
						if (parsed) {
							return json({
								success: true,
								data: {
									...parsed,
									provider: ai!.provider,
									instructions:
										'Copy the bio and display name to your Instagram profile. Use the profile_picture_prompt with any AI image generator (Midjourney, DALL-E, Flux) to create your profile picture, then upload manually.'
								}
							});
						}
					} catch (err) {
						console.error('[Engine] Profile generation failed:', err);
					}
				}

				// Fallback
				const fallbackBio = `${agentData.niche} creator ✨ | ${agentData.soul?.slice(0, 60) || 'Authentic content'} | Link below 👇`;
				return json({
					success: true,
					data: {
						bio: fallbackBio.slice(0, 150),
						profile_picture_prompt: `Professional social media profile photo of a ${agentData.niche} content creator. Clean background, soft studio lighting, square 1:1 format, approachable expression, high quality.`,
						display_name: agentData.name,
						highlights_suggestions: ['About', 'Products', 'Reviews', 'Tips', 'BTS'],
						instructions:
							'Copy the bio and display name to your Instagram profile. Use the profile_picture_prompt with any AI image generator to create your profile picture, then upload manually.'
					}
				});
			}

			// ── ACTION: script ───────────────────────────────────────────────────
			if (action === 'script') {
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}
				try {
					const prompt = `${fullContext}
Write a detailed 60-second video script for ${platform} on topic: "${topic}".
${selectedProduct ? `The script MUST feature "${selectedProduct.name}" as the main product being demonstrated.` : ''}
Include [Scene Direction], [Visual Cues], and voiceover content.
Return JSON: { "type": "script", "platform": "${platform}", "content": "formatted script", "hashtags": [...], "hookScore": <70-99>, "estimatedReach": "15K - 35K" }`;
					const resText = await ai!.generate(prompt, { json: true });
					if (resText) {
						const parsed = safeParseJson(resText);
						if (parsed?.content) return json({ success: true, data: parsed });
					}
					return json(
						{
							success: false,
							error: `${ai!.provider} returned an unusable script response — try again.`
						},
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI script forge failed:', msg);
					return json(
						{
							success: false,
							error: `Script generation failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: titles ───────────────────────────────────────────────────
			if (action === 'titles') {
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}
				try {
					const prompt = `${fullContext}
Generate 8 highly viral, click-worthy titles/hooks for content about: "${topic}".
${selectedProduct ? `Each title should reference or relate to "${selectedProduct.name}".` : ''}
Return JSON: { "type": "titles", "platform": "${platform}", "titles": [string x 8], "hookScore": 91 }`;
					const resText = await ai!.generate(prompt, { json: true });
					if (resText) {
						const parsed = safeParseJson(resText);
						if (parsed?.titles) return json({ success: true, data: parsed });
					}
					return json(
						{ success: false, error: `${ai!.provider} returned no usable titles — try again.` },
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI titles failed:', msg);
					return json(
						{
							success: false,
							error: `Title generation failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: thumbnail_brief ──────────────────────────────────────────
			if (action === 'thumbnail_brief') {
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}
				try {
					const prompt = `${fullContext}
Create a professional thumbnail brief for a YouTube/Social thumbnail about: "${topic}".
${selectedProduct ? `Feature "${selectedProduct.name}" prominently in the visual.` : ''}
Return JSON: { "type": "thumbnail", "platform": "${platform}", "thumbnailNotes": [6 visual briefing points], "hookScore": 87 }`;
					const resText = await ai!.generate(prompt, { json: true });
					if (resText) {
						const parsed = safeParseJson(resText);
						if (parsed?.thumbnailNotes) return json({ success: true, data: parsed });
					}
					return json(
						{
							success: false,
							error: `${ai!.provider} returned no usable thumbnail brief — try again.`
						},
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI thumbnail brief failed:', msg);
					return json(
						{
							success: false,
							error: `Thumbnail brief failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			if (action === 'repurpose') {
				// Honest 501: repurposing was a fake no-op ("Repurposing scheduled"
				// with no side effects). No client calls this anymore.
				return json({ success: false, error: "Repurposing isn't available yet." }, { status: 501 });
			}

			return json(
				{ success: false, error: `Invalid content forge action: ${action}` },
				{ status: 400 }
			);
		}

		// ══════════════════════════════════════════════════════════════════════════
		// C. PATH: personagen-ai-generate (Direct freeform content)
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-ai-generate') {
			const promptText = body.prompt || 'Writing social content';
			const personaId = body.persona_id;
			const platforms = body.platforms || ['instagram'];

			let agentContext = 'an expert creator';
			if (personaId) {
				const { data: agent } = await db.agents.get(personaId);
				if (agent) {
					agentContext = `AI agent ${agent.name} (@${agent.handle}) working in the ${agent.niche} niche with personality: "${agent.soul}"`;
				}
			}

			if (hasAi) {
				try {
					const systemPrompt = `You are ${agentContext}. Generate premium, high-converting social media copy.`;
					const prompt = `Write a ready-to-post piece of social media content for: ${platforms.join(', ')}.
Topic / Prompt: "${promptText}"
Ensure the draft captures the voice perfectly. Do not include meta text, output the completed ready-to-post draft content directly.`;

					const resText = await ai!.generate(prompt, { systemInstruction: systemPrompt });

					if (resText) {
						return json({
							success: true,
							data: {
								message: 'Content generated successfully',
								content: resText.trim()
							}
						});
					}
				} catch (err) {
					// Surface the real provider error instead of the old misleading
					// "configure a provider" message — a configured key that fails
					// (rate limit, credit, model, timeout) is a different problem.
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI content generation failed:', msg);
					return json(
						{
							success: false,
							error: `Generation failed via ${ai?.provider ?? 'AI'}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			return json(
				{
					success: false,
					error: hasAi
						? 'AI returned an empty response — try again.'
						: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
				},
				{ status: hasAi ? 502 : 400 }
			);
		}

		// ══════════════════════════════════════════════════════════════════════════
		// D. PATH: personagen-brand-brief
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-brand-brief') {
			// ── ACTION: save_brief — multi-brand: updates the brief named by
			//    body.brief_id, or creates a new one when absent. One user can
			//    run several brands (e.g. "Just Kids Honey" + "HoneyX Manly
			//    Plus"), each persona pinning the brief it generates against. ──
			if (action === 'save_brief') {
				const briefData = body.data;
				if (!briefData || typeof briefData !== 'object') {
					return json({ success: false, error: 'Missing brief data' }, { status: 400 });
				}
				const briefName = String(body.name || briefData.brandName || '').trim() || 'Untitled Brand';

				if (body.brief_id) {
					const { data: existing } = await db.brandBriefs.getById(body.brief_id, session.user.id);
					if (!existing) {
						return json({ success: false, error: 'Brief not found' }, { status: 404 });
					}
					const { data: saved, error } = await db.brandBriefs.updateById(
						body.brief_id,
						session.user.id,
						{ data: briefData, name: briefName, version: (existing.version || 0) + 1 }
					);
					if (error) {
						console.error('[Engine] Failed to update brand brief:', error);
						return json({ success: false, error: error.message }, { status: 500 });
					}
					return json({ success: true, data: saved });
				}

				const { data: created, error } = await db.brandBriefs.create({
					user_id: session.user.id,
					name: briefName,
					data: briefData,
					version: 1
				});
				if (error) {
					console.error('[Engine] Failed to create brand brief:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true, data: created });
			}

			// ── ACTION: list_briefs — id/name/updated_at for pickers ──────────────
			if (action === 'list_briefs') {
				const { data: briefs, error } = await db.brandBriefs.list(session.user.id);
				if (error) {
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true, data: briefs ?? [] });
			}

			// ── ACTION: delete_brief — permanently removes one of the user's
			//    briefs. Personas that pinned it are unpinned automatically
			//    (agent_configs.brand_brief_id is ON DELETE SET NULL) and fall
			//    back to the newest remaining brief. ───────────────────────────────
			if (action === 'delete_brief') {
				const briefId = String(body.brief_id || '').trim();
				if (!briefId) {
					return json({ success: false, error: 'Missing brief_id' }, { status: 400 });
				}
				const { data: existing } = await db.brandBriefs.getById(briefId, session.user.id);
				if (!existing) {
					return json({ success: false, error: 'Brief not found' }, { status: 404 });
				}
				const { error } = await db.brandBriefs.deleteById(briefId, session.user.id);
				if (error) {
					console.error('[Engine] Failed to delete brand brief:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
				return json({ success: true, data: { id: briefId, name: existing.name } });
			}

			// ── ACTION: get_brief (read-only — powers the generation composer;
			//    body.brief_id selects a specific brief, else newest) ──────────────
			if (action === 'get_brief') {
				const brief = body.brief_id
					? (await db.brandBriefs.getById(body.brief_id, session.user.id)).data
					: (await db.brandBriefs.get(session.user.id)).data;
				return json({
					success: true,
					data: brief?.data ?? null,
					brief_id: brief?.id ?? null,
					name: brief?.name ?? null
				});
			}

			if (action === 'scrape_store') {
				// Users paste "justkidshoney.com" — normalize to https:// BEFORE the
				// SSRF guard, whose `new URL()` throws on protocol-less input (this
				// was the "Failed to scrape" regression: valid domains rejected
				// before Firecrawl ever saw them).
				let storeUrl = String(body.url || '').trim();
				if (storeUrl && !/^https?:\/\//i.test(storeUrl)) storeUrl = `https://${storeUrl}`;

				// 1. Try real scraping if URL is provided
				let scrapeSuccess = false;
				let scrapedData: any = null;
				// Specific, honest failure reason for the user — never let a failed
				// scrape masquerade as generic mystery (or worse, fake success).
				let scrapeFailReason = '';

				if (storeUrl) {
					try {
						// Validate BEFORE any fetch — including the Firecrawl call below,
						// not just the direct-fetch fallback — so a user-supplied internal/
						// private URL is never handed to any scraper. A throw here is caught
						// by this block's catch and degrades to the manual-entry response.
						await assertPublicHttpUrl(storeUrl);
						const userFirecrawlKey = await getUserApiKey(
							locals.supabase,
							session.user.id,
							'firecrawl'
						);
						const firecrawlKey = userFirecrawlKey || env.FIRECRAWL_API_KEY;
						let contentToParse = '';
						// Logo/product image URLs live in page metadata + links, not in the
						// markdown text — capture them separately so the extractor can fill
						// logoUrl and product photoUrl reliably.
						const logoCandidates: string[] = [];
						const discoveredLinks: string[] = [];
						// Fonts live in <link>/inline CSS — they don't survive markdown.
						const fontCandidates: string[] = [];
						// Structured brand guide from Firecrawl's Branding format (when present).
						let brandGuide: Record<string, any> | null = null;
						const harvestFonts = (html: string) => {
							for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"')]+/gi)) {
								for (const fam of m[0].matchAll(/family=([A-Za-z0-9+ _-]+)/g)) {
									const name = decodeURIComponent(fam[1]).replace(/\+/g, ' ').split(':')[0].trim();
									if (name && !fontCandidates.includes(name)) fontCandidates.push(name);
								}
							}
							for (const m of html.matchAll(/font-family:\s*['"]?([A-Za-z0-9 _-]{3,40})['"]?/gi)) {
								const name = m[1].trim();
								if (
									name &&
									!/^(sans-serif|serif|monospace|inherit|initial|system-ui|Arial|Helvetica)$/i.test(
										name
									) &&
									!fontCandidates.includes(name)
								) {
									fontCandidates.push(name);
								}
								if (fontCandidates.length > 8) break;
							}
						};

						// 1. Try Firecrawl scraping if API key is configured
						if (
							firecrawlKey &&
							!firecrawlKey.includes('placeholder') &&
							firecrawlKey.trim() !== ''
						) {
							console.log(`[Engine] Scrape using Firecrawl for: ${storeUrl}`);
							// Shopify-style crawler throttling is transient, so give Firecrawl
							// one bounded retry before degrading to the direct-fetch fallback.
							for (let attempt = 0; attempt < 2 && !contentToParse; attempt++) {
								if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
								try {
									const fcRes = await meteredCall({ supabase: locals.supabase, userId: session.user.id }, () => fetch('https://api.firecrawl.dev/v1/scrape', {
										method: 'POST',
										headers: {
											'Content-Type': 'application/json',
											Authorization: `Bearer ${firecrawlKey}`
										},
										body: JSON.stringify({
											url: storeUrl,
											// Full data spectrum: markdown for copy, links for product
											// discovery, and keep nav/footer (onlyMainContent:false) so the
											// logo in the header is visible to the extractor.
											formats: ['markdown', 'links', 'rawHtml', 'branding'],
											onlyMainContent: false
										})
									}), { estimateUsd: meteringPriceOf('firecrawl', 'scrape'), event: () => ({ provider: 'firecrawl', operation: 'scrape', model: 'v1/scrape store', usd: meteringPriceOf('firecrawl', 'scrape') }) });
									if (fcRes.ok) {
										const fcJson = await fcRes.json();
										if (fcJson.success && fcJson.data?.markdown) {
											// Firecrawl reports success even when the SITE refused the
											// crawl (throttle/challenge page) — validate what actually
											// came back before letting the extractor see it.
											const problem = scrapeContentProblem(
												fcJson.data.markdown,
												Number(fcJson.data.metadata?.statusCode) || undefined
											);
											if (problem) {
												console.warn(
													`[Engine] Firecrawl content rejected for ${storeUrl} (${problem}) — ${attempt === 0 ? 'retrying once' : 'falling back to direct fetch'}`
												);
												continue;
											}
											contentToParse = fcJson.data.markdown.substring(0, 40000);
											const meta = fcJson.data.metadata || {};
											// Logo candidates from OpenGraph / favicon metadata.
											for (const key of ['ogImage', 'og:image', 'image', 'favicon', 'logo']) {
												const v = meta[key];
												if (typeof v === 'string' && v.startsWith('http')) logoCandidates.push(v);
												else if (Array.isArray(v))
													v.filter((x) => typeof x === 'string' && x.startsWith('http')).forEach(
														(x) => logoCandidates.push(x)
													);
											}
											if (Array.isArray(fcJson.data.links)) {
												discoveredLinks.push(
													...fcJson.data.links
														.filter((l: any) => typeof l === 'string')
														.slice(0, 200)
												);
											}
											if (typeof fcJson.data.rawHtml === 'string') {
												const raw = fcJson.data.rawHtml.slice(0, 300000);
												harvestFonts(raw);
												// Real logos (favicon/apple-touch/logo-named images) beat
												// the og:image hero banner already in the candidate list.
												logoCandidates.unshift(...harvestLogoUrls(raw, storeUrl));
											}
											// Firecrawl Branding format: the structured brand guide
											// (logo, hex colors, fonts, personality) — deterministic
											// ground truth that outranks AI inference. Tolerant reads:
											// the response schema isn't published, only the categories.
											const b = fcJson.data.branding;
											if (b && typeof b === 'object') {
												// Fonts arrive as objects ({ family, role }) — verified live
												// 2026-07-05 — so coerce every font-ish value to its name.
												const fontName = (f: any): string | null =>
													typeof f === 'string' ? f : f?.family || f?.name || null;
												brandGuide = {
													logo: b.images?.logo || b.logo || b.logoUrl || null,
													favicon: b.images?.favicon || b.favicon || null,
													primaryColor: b.colors?.primary || b.colors?.primaryColor || null,
													secondaryColor: b.colors?.secondary || b.colors?.secondaryColor || null,
													accentColor: b.colors?.accent || null,
													fontPrimary:
														fontName(b.typography?.heading) ||
														fontName(b.typography?.primary) ||
														fontName(b.fonts?.primary) ||
														(Array.isArray(b.fonts) ? fontName(b.fonts[0]) : null),
													fontSecondary:
														fontName(b.typography?.body) ||
														fontName(b.fonts?.secondary) ||
														(Array.isArray(b.fonts) ? fontName(b.fonts[1]) : null),
													tone: b.personality?.tone || null,
													energy: b.personality?.energy || null,
													audience: b.personality?.audience || null
												};
												console.log(
													'[Engine] Firecrawl branding guide captured:',
													JSON.stringify(brandGuide).slice(0, 300)
												);
											}
											console.log(
												`[Engine] Firecrawl success: markdown ${contentToParse.length} chars, ${logoCandidates.length} logo candidate(s), ${discoveredLinks.length} link(s), ${fontCandidates.length} font candidate(s)`
											);
										}
									} else {
										console.warn(
											`[Engine] Firecrawl API error (status ${fcRes.status}):`,
											await fcRes.text()
										);
									}
								} catch (fcErr) {
									console.warn('[Engine] Firecrawl API call failed:', fcErr);
								}
							}
						}

						// 2. Fall back to simple HTTP fetch if Firecrawl didn't return content
						if (!contentToParse) {
							console.log(`[Engine] Falling back to direct HTTP page fetch for: ${storeUrl}`);
							try {
								await assertPublicHttpUrl(storeUrl);
								// Follow redirects manually so a public URL that 3xx's to an
								// internal address can't bypass the check above.
								let nextUrl = storeUrl;
								let response: Response | null = null;
								for (let hop = 0; hop < 5; hop++) {
									const res = await fetch(nextUrl, {
										redirect: 'manual',
										headers: {
											'User-Agent':
												'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
										}
									});
									if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
										nextUrl = new URL(res.headers.get('location')!, nextUrl).toString();
										await assertPublicHttpUrl(nextUrl);
										continue;
									}
									response = res;
									break;
								}
								if (response?.ok) {
									const html = await response.text();
									harvestFonts(html.slice(0, 300000));
									const stripped = html
										.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
										.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
										.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
									// Judge the human-visible text: bot challenges arrive with a
									// 200 status but carry almost no real copy. Meta-tag-only SPAs
									// keep enough title/meta signal that the lower floor (200) passes.
									const visibleText = stripped
										.replace(/<[^>]+>/g, ' ')
										.replace(/\s+/g, ' ')
										.trim();
									const problem = scrapeContentProblem(visibleText, response.status, 200);
									if (problem) {
										console.warn(
											`[Engine] Direct fetch content rejected for ${storeUrl}: ${problem}`
										);
									} else {
										// Distill the page rather than passing raw markup: the
										// extractor only ever sees the first ~20k chars, and
										// head-heavy storefront HTML fills that with tags before any
										// copy appears (the raw-markup version of this page carried
										// just ~700 chars of text in its first 40k).
										const titleText =
											html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim() || '';
										const metaLines: string[] = [];
										for (const m of html.matchAll(/<meta\s[^>]*?>/gi)) {
											const tag = m[0];
											const key = tag
												.match(/(?:name|property)=["']([^"']+)["']/i)?.[1]
												?.toLowerCase();
											if (
												!key ||
												!/^(description|keywords|og:site_name|og:title|og:description|og:image|twitter:title|twitter:description)$/.test(
													key
												)
											)
												continue;
											const content = tag.match(/content=["']([^"']*)["']/i)?.[1]?.trim();
											if (!content) continue;
											metaLines.push(`${key}: ${content}`);
											if (metaLines.length >= 12) break;
										}
										// Real logos (favicon/apple-touch/logo-named images) go FIRST;
										// og:image is usually a hero banner, so it goes last.
										logoCandidates.unshift(...harvestLogoUrls(html, storeUrl));
										const ogImage = resolveHttpUrl(metaContent(html, 'og:image') || '', storeUrl);
										if (ogImage) logoCandidates.push(ogImage);
										// Give the product-page sub-scraper links to chew on (Firecrawl
										// normally supplies these) and the extractor real image URLs.
										for (const m of html.matchAll(/href=["']((?:https?:\/\/|\/)[^"'\s>]+)["']/gi)) {
											try {
												discoveredLinks.push(new URL(m[1], storeUrl).toString());
											} catch {
												// skip malformed hrefs
											}
											if (discoveredLinks.length >= 200) break;
										}
										const imgUrls = harvestImageUrls(html, storeUrl, 30);
										contentToParse = [
											titleText ? `PAGE TITLE: ${titleText}` : '',
											metaLines.length ? `PAGE METADATA:\n${metaLines.join('\n')}` : '',
											`VISIBLE PAGE TEXT:\n${visibleText.slice(0, 15000)}`,
											imgUrls.length ? `IMAGE URLS ON PAGE:\n${imgUrls.join('\n')}` : ''
										]
											.filter(Boolean)
											.join('\n\n')
											.substring(0, 40000);
									}
								} else if (response) {
									console.warn(
										`[Engine] Direct fetch failed for ${storeUrl}: HTTP ${response.status}`
									);
								}
							} catch (ssrfErr) {
								console.warn(
									`[Engine] Refused direct fetch for ${storeUrl}:`,
									(ssrfErr as Error).message
								);
							}
						}

						if (!contentToParse) {
							scrapeFailReason =
								'Could not retrieve readable page content — the store may be rate-limiting or blocking automated access. Try again in a minute, or enter brand details manually.';
						}

						if (contentToParse && hasAi) {
							// Shopify(-compatible) stores expose a public JSON catalog — the
							// most reliable source of product names/prices/photos, immune to
							// markup quirks and crawler throttling. Try it first.
							type CatalogProduct = {
								name: string;
								price: string;
								image: string;
								description: string;
							};
							let catalogProducts: CatalogProduct[] = [];
							try {
								const catRes = await fetch(
									new URL('/products.json?limit=30', storeUrl).toString(),
									{
										headers: {
											'User-Agent':
												'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
										}
									}
								);
								if (catRes.ok) {
									const cat = await catRes.json().catch(() => null);
									if (Array.isArray(cat?.products)) {
										catalogProducts = cat.products
											.slice(0, 30)
											.map((p: any) => ({
												name: String(p.title || '').slice(0, 150),
												price: String(p.variants?.[0]?.price ?? ''),
												image: String(p.images?.[0]?.src || ''),
												description: String(p.body_html || '')
													.replace(/<[^>]+>/g, ' ')
													.replace(/\s+/g, ' ')
													.trim()
													.slice(0, 200)
											}))
											.filter((p: CatalogProduct) => p.name);
										console.log(
											`[Engine] Shopify catalog found: ${catalogProducts.length} products (${catalogProducts.filter((p) => p.image).length} with images)`
										);
									}
								}
							} catch {
								// not a Shopify-style store — fall back to page scraping below
							}

							// Scrape individual product pages for richer product data + photos.
							// Dedupe product-like URLs (storefront homepages repeat each product
							// link many times) and scrape up to 8. Skipped when the JSON catalog
							// already delivered the products.
							const productLinks = catalogProducts.length
								? []
								: [
										...new Set(
											discoveredLinks
												.filter((l) => /\/(products?|shop|item)\//i.test(l))
												.map((l) => l.split('#')[0].split('?')[0])
										)
									].slice(0, 8);

							let productPageContent = '';
							if (productLinks.length > 0) {
								const productPageResults = await Promise.allSettled(
									productLinks.map(async (link) => {
										try {
											await assertPublicHttpUrl(link);
											// Firecrawl first, when configured…
											if (firecrawlKey && !firecrawlKey.includes('placeholder')) {
												try {
													const r = await meteredCall({ supabase: locals.supabase, userId: session.user.id }, () => fetch('https://api.firecrawl.dev/v1/scrape', {
														method: 'POST',
														headers: {
															'Content-Type': 'application/json',
															Authorization: `Bearer ${firecrawlKey}`
														},
														body: JSON.stringify({
															url: link,
															formats: ['markdown'],
															onlyMainContent: true
														})
													}), { estimateUsd: meteringPriceOf('firecrawl', 'scrape'), event: () => ({ provider: 'firecrawl', operation: 'scrape', model: 'v1/scrape product page', usd: meteringPriceOf('firecrawl', 'scrape') }) });
													if (r.ok) {
														const rj = await r.json();
														// A throttled product page must not pollute the
														// extraction context with error text — fall through
														// to the direct fetch instead.
														if (
															rj.success &&
															!scrapeContentProblem(
																rj.data?.markdown || '',
																Number(rj.data?.metadata?.statusCode) || undefined,
																80
															)
														) {
															const meta = rj.data?.metadata || {};
															const img =
																[meta.ogImage, meta['og:image'], meta.image]
																	.flat()
																	.find(
																		(v: any) => typeof v === 'string' && v.startsWith('http')
																	) || '';
															return `PRODUCT PAGE: ${link}${img ? `\nPRODUCT IMAGE: ${img}` : ''}\n${(rj.data?.markdown || '').substring(0, 4000)}`;
														}
													}
												} catch {
													// fall through to direct fetch
												}
											}
											// …direct fetch fallback: Shopify throttles Firecrawl's
											// crawler but serves plain server fetches fine — the same
											// story as the homepage. No redirect following (the URL was
											// SSRF-validated; a redirect could escape that check).
											const res = await fetch(link, {
												redirect: 'manual',
												headers: {
													'User-Agent':
														'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
												}
											});
											if (!res.ok) return '';
											const html = await res.text();
											const visible = html
												.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
												.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
												.replace(/<[^>]+>/g, ' ')
												.replace(/\s+/g, ' ')
												.trim();
											if (scrapeContentProblem(visible, res.status, 80)) return '';
											const title =
												metaContent(html, 'og:title') ||
												html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim() ||
												'';
											const img =
												resolveHttpUrl(metaContent(html, 'og:image') || '', link) ||
												harvestImageUrls(html, link, 1)[0] ||
												'';
											const price =
												metaContent(html, 'og:price:amount') ||
												metaContent(html, 'product:price:amount');
											return [
												`PRODUCT PAGE: ${link}`,
												title ? `TITLE: ${title}` : '',
												img ? `PRODUCT IMAGE: ${img}` : '',
												price ? `PRICE: ${price}` : '',
												visible.slice(0, 2500)
											]
												.filter(Boolean)
												.join('\n');
										} catch {
											return '';
										}
									})
								);
								productPageContent = productPageResults
									.map((r) => (r.status === 'fulfilled' ? r.value : ''))
									.filter(Boolean)
									.join('\n\n---\n\n');
							}

							const logoHint = logoCandidates.length
								? `\nLOGO CANDIDATES (pick the best brand logo for logoUrl; prefer the first): ${logoCandidates.slice(0, 5).join(', ')}`
								: '';
							// Names+prices only: the model needs the catalog for brand context
							// (mission, competitors, audience), but must NOT echo it back —
							// 30 products of CDN URLs overflow the response token cap and
							// truncate the JSON. Products are attached verbatim after parsing.
							const catalogHint = catalogProducts.length
								? `\n\nPRODUCT CATALOG (the store's own product list, for context — do NOT return a "products" field, it is attached automatically): ${catalogProducts
										.map((c) => `${c.name} (${c.price})`)
										.join('; ')
										.substring(0, 3000)}`
								: '';
							const productPagesHint = productPageContent
								? `\n\nPRODUCT PAGES CONTENT (extract products from here with real image URLs):\n${productPageContent.substring(0, 15000)}`
								: '';

							const fontHint = fontCandidates.length
								? `\nFONT CANDIDATES (harvested from the page's CSS — use these for fontPrimary/fontSecondary): ${fontCandidates.slice(0, 6).join(', ')}`
								: '';
							const brandGuideHint = brandGuide
								? `\nBRAND GUIDE (structured extraction — treat as ground truth): ${JSON.stringify(brandGuide)}`
								: '';
							const prompt = `You are a web scraper agent. Extract the brand brief details and all products (with name, description, price, and image URL) from this e-commerce storefront content.
CRITICAL: Only extract what is actually present in the content. If the content is NOT a real brand storefront — e.g. a rate-limit or error message, a bot/captcha challenge, a parked domain, a login wall, or a near-empty page — return exactly {"error": "<short reason>"} and nothing else. NEVER invent, guess, or fabricate a brand from error text.
Use the LOGO CANDIDATES for "logoUrl" (prefer an actual logo/icon over hero or campaign banners). Never leave logoUrl empty if a candidate exists.
PRODUCT PHOTOS: give every product a real absolute "photoUrl" from the content — use the PRODUCT IMAGE line of the matching PRODUCT PAGE block first, then any matching URL from IMAGE URLS ON PAGE (match by product name appearing in the URL). Use "" only when no plausible image URL exists for that product. Never invent an image URL.${logoHint}${fontHint}${brandGuideHint}
COMPETITORS: identify 3-5 REAL direct competitors of this brand (same product category and audience — well-known brands count). Use any mentioned in the content first, then infer from the category. Never return fewer than 3.
Return a JSON object matching this exact shape:
{
  "brandName": "Brand name",
  "tagline": "Brief tagline",
  "mission": "Mission statement",
  "primaryColor": "#hexcolor",
  "secondaryColor": "#hexcolor",
  "logoUrl": "URL to logo image (from LOGO CANDIDATES above)",
  "fontPrimary": "Primary font name (prefer FONT CANDIDATES)",
  "fontSecondary": "Secondary font name (prefer FONT CANDIDATES)",
  "traits": ["Trait1", "Trait2", "Trait3"],
  "commStyle": "Communication style (Casual/Professional/Bold/Minimal)",
  "demographics": "Target demographics description",
  "interests": "Target audience interests",
  "platforms": "Social platforms they use",
  "painPoints": "Customer pain points addressed",
  "competitors": [
    {
      "id": "c1",
      "name": "Competitor brand name",
      "url": "https://competitor-site.com",
      "notes": "One-line differentiator vs this brand"
    }
  ],
  "products": [
    {
      "id": "p1",
      "name": "Product Name",
      "description": "Product Description",
      "price": "$Price",
      "photoUrl": "Absolute URL to product photo"
    }
  ]
}
Store Homepage Content:
${contentToParse.substring(0, 20000)}${catalogHint}${productPagesHint}`;

							const resText = await ai!.generate(prompt, { json: true });
							if (resText) {
								const parsed = safeParseJson(resText);
								if (parsed?.error && !parsed.brandName) {
									scrapeFailReason = `The page did not look like a storefront (${String(parsed.error).slice(0, 200)}).`;
									console.warn('[Engine] Extractor refused scrape content:', parsed.error);
								} else if (
									parsed &&
									parsed.brandName &&
									!isBrandNameGrounded(parsed.brandName, contentToParse, storeUrl)
								) {
									// Hallucination guard: a genuine extraction takes the brand
									// name FROM the page, so some token of it must appear in the
									// scraped content or the domain itself.
									scrapeFailReason = `Extraction produced a brand name ("${String(parsed.brandName).slice(0, 80)}") that appears nowhere on the page — discarding it as unreliable.`;
									console.warn('[Engine]', scrapeFailReason);
								} else if (parsed && parsed.brandName) {
									// Backfill the logo from metadata if the model didn't set one.
									if (
										(!parsed.logoUrl || !String(parsed.logoUrl).startsWith('http')) &&
										logoCandidates.length
									) {
										parsed.logoUrl = logoCandidates[0];
									}
									// Deterministic brand-guide values OUTRANK model inference.
									if (brandGuide) {
										if (brandGuide.logo) parsed.logoUrl = brandGuide.logo;
										if (brandGuide.primaryColor) parsed.primaryColor = brandGuide.primaryColor;
										if (brandGuide.secondaryColor)
											parsed.secondaryColor = brandGuide.secondaryColor;
										if (brandGuide.fontPrimary) parsed.fontPrimary = brandGuide.fontPrimary;
										if (brandGuide.fontSecondary) parsed.fontSecondary = brandGuide.fontSecondary;
									}
									// Backfill fonts from the harvested CSS candidates.
									if (!parsed.fontPrimary && fontCandidates[0])
										parsed.fontPrimary = fontCandidates[0];
									if (!parsed.fontSecondary && fontCandidates[1])
										parsed.fontSecondary = fontCandidates[1];
									// Belt+braces: never let a font reach the UI as an object.
									const coerceFont = (f: any) =>
										typeof f === 'string' ? f : f?.family || f?.name || '';
									parsed.fontPrimary = coerceFont(parsed.fontPrimary);
									parsed.fontSecondary = coerceFont(parsed.fontSecondary);
									// Products come from the store's own JSON catalog VERBATIM when
									// available — names, prices and photos are facts, not something
									// to run through a language model.
									if (catalogProducts.length) {
										parsed.products = catalogProducts.map((c, i) => ({
											id: `p${i + 1}`,
											name: c.name,
											description: c.description || '',
											price: c.price && /^\d/.test(c.price) ? `$${c.price}` : c.price || '',
											photoUrl: c.image || ''
										}));
									}
									scrapedData = parsed;
									scrapeSuccess = true;
								}
							}
						}
					} catch (e) {
						console.warn('[Engine] Storefront scraping failed:', e);
					}
				}

				if (scrapeSuccess && scrapedData) {
					return json({ success: true, data: scrapedData });
				}

				return json(
					{
						success: false,
						error:
							scrapeFailReason ||
							'Failed to scrape the storefront page. Please verify the URL or enter brand details and products manually.'
					},
					{ status: 400 }
				);
			}

			// ── ACTION: scrape_product (add a single product by URL via Firecrawl) ──
			if (action === 'scrape_product') {
				let productUrl = String(body.url || '').trim();
				if (!productUrl) {
					return json({ success: false, error: 'Missing product URL' }, { status: 400 });
				}
				if (!/^https?:\/\//i.test(productUrl)) productUrl = `https://${productUrl}`;
				if (!hasAi) {
					return json(
						{ success: false, error: 'No AI provider configured. Add a key in Settings.' },
						{ status: 400 }
					);
				}

				try {
					await assertPublicHttpUrl(productUrl);

					const userFcKey = await getUserApiKey(
						locals.supabase,
						session.user.id,
						'firecrawl'
					).catch(() => null);
					const fcKey = userFcKey || env.FIRECRAWL_API_KEY;
					let pageContent = '';
					const imageCandidates: string[] = [];

					if (fcKey && !fcKey.includes('placeholder') && fcKey.trim() !== '') {
						const fcRes = await meteredCall({ supabase: locals.supabase, userId: session.user.id }, () => fetch('https://api.firecrawl.dev/v1/scrape', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${fcKey}`
							},
							body: JSON.stringify({
								url: productUrl,
								formats: ['markdown'],
								onlyMainContent: false
							})
						}), { estimateUsd: meteringPriceOf('firecrawl', 'scrape'), event: () => ({ provider: 'firecrawl', operation: 'scrape', model: 'v1/scrape product', usd: meteringPriceOf('firecrawl', 'scrape') }) });
						if (fcRes.ok) {
							const fcJson = (await fcRes.json()) as any;
							if (fcJson.success && fcJson.data?.markdown) {
								// Same guard as scrape_store: Firecrawl relays throttle/challenge
								// pages as success:true — never hand those to the extractor.
								const problem = scrapeContentProblem(
									fcJson.data.markdown,
									Number(fcJson.data.metadata?.statusCode) || undefined,
									80
								);
								if (problem) {
									return json(
										{
											success: false,
											error: `Could not read that product page (${problem}). The site may be rate-limiting scrapers — try again in a minute.`
										},
										{ status: 422 }
									);
								}
								pageContent = fcJson.data.markdown.substring(0, 20000);
								const meta = fcJson.data.metadata || {};
								for (const key of ['ogImage', 'og:image', 'image']) {
									const v = meta[key];
									if (typeof v === 'string' && v.startsWith('http')) imageCandidates.push(v);
									else if (Array.isArray(v))
										v.filter((x) => typeof x === 'string' && x.startsWith('http')).forEach((x) =>
											imageCandidates.push(x)
										);
								}
							}
						}
					}

					if (!pageContent) {
						return json(
							{
								success: false,
								error: 'Could not fetch that product page (check the URL / Firecrawl key).'
							},
							{ status: 400 }
						);
					}

					const resText = await ai!.generate(
						`Extract ONE product from this product page.
If the content is NOT a real product page (error page, rate-limit notice, captcha/bot challenge, empty page), return exactly {"error": "<short reason>"} instead. NEVER invent a product.
${imageCandidates.length ? `IMAGE CANDIDATES (prefer the first for photoUrl): ${imageCandidates.slice(0, 4).join(', ')}` : ''}
Return ONLY JSON: { "name": "Product name", "description": "1-2 sentence description", "price": "$Price as shown", "photoUrl": "absolute https image URL" }
Page content:
${pageContent}`,
						{ json: true }
					);
					const parsed = safeParseJson(resText || '');
					if (parsed?.error && !parsed.name) {
						return json(
							{
								success: false,
								error: `That page did not look like a product page (${String(parsed.error).slice(0, 200)}).`
							},
							{ status: 422 }
						);
					}
					if (!parsed?.name) {
						return json(
							{ success: false, error: 'Could not extract a product from that page.' },
							{ status: 422 }
						);
					}
					if (
						(!parsed.photoUrl || !String(parsed.photoUrl).startsWith('http')) &&
						imageCandidates[0]
					) {
						parsed.photoUrl = imageCandidates[0];
					}
					return json({
						success: true,
						data: {
							id: `p${Math.random().toString(36).slice(2, 8)}`,
							name: String(parsed.name).slice(0, 120),
							description: String(parsed.description || '').slice(0, 500),
							price: String(parsed.price || ''),
							photoUrl: parsed.photoUrl || null,
							sourceUrl: productUrl
						}
					});
				} catch (e) {
					return json(
						{ success: false, error: `Product scrape failed: ${(e as Error).message}` },
						{ status: 500 }
					);
				}
			}

			if (action === 'extend_field') {
				const fieldName = body.fieldName || 'Description';
				const fieldVal = body.fieldVal || '';

				if (!fieldVal.trim()) {
					return json({ success: false, error: 'Input text is empty' }, { status: 400 });
				}

				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}

				try {
					const prompt = `You are an elite brand strategist, copywriter, and e-commerce UGC marketer.
Take the following simple input for the brand brief field "${fieldName}" and expand/enrich it into a beautiful, premium, high-converting positioning statement.
Keep under 3 sentences. Output ONLY the enriched text directly.

Input: "${fieldVal}"`;

					const resText = await ai!.generate(prompt);
					if (resText) {
						return json({ success: true, data: { enriched: resText.trim() } });
					}
					// A configured provider returned empty — that's a provider/model
					// issue, not a missing-key issue. Say so instead of misdirecting
					// the user to Settings for a key they already have.
					return json(
						{ success: false, error: `${ai!.provider} returned an empty response — try again.` },
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI field enrichment failed:', msg);
					// Surface the ACTUAL provider error (rate limit, credit, model,
					// timeout) rather than the old misleading "configure a provider"
					// message — the user has one; the call itself failed.
					return json(
						{
							success: false,
							error: `Enrichment failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: generate_persona_profile ──
			// Fills a UNIQUE, brand-tailored persona profile (archetype, focus, avatar,
			// psychology, angle, age ranges) from the persona's gender + the saved brand
			// brief, differentiated from every other persona on the account. Gender is
			// an INPUT (never overwritten); everything else is generated for competitive
			// influencer positioning and feeds content generation prompts.
			if (action === 'generate_persona_profile') {
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}
				const agentId = typeof body.agentId === 'string' ? body.agentId : '';
				if (!agentId) return json({ success: false, error: 'Missing agentId' }, { status: 400 });

				const { data: agent } = await db.agents.get(agentId);
				if (!agent || agent.user_id !== session.user.id) {
					return json({ success: false, error: 'Persona not found' }, { status: 404 });
				}
				const gender = typeof body.gender === 'string' && body.gender ? body.gender : 'unspecified';
				// Gender is driven by the persona's NAME (its identity), NOT a possibly-stale
				// stored value — so "Generate for brand" CORRECTS a mis-set gender instead of
				// obeying it (the "Ratio Ramadan shows as Female" bug, which then fed a female
				// face/voice/kit prompt). Deterministic first-name lookup; the LLM fills the gap
				// for names not in the table, guided by the examples in the prompt.
				const nameGender = inferGenderFromName(agent.name);
				const brief = await loadBriefForAgent(
					db,
					session.user.id,
					body.brandBriefId || agent.brand_brief_id || null
				);
				const b: any = brief?.data ?? {};

				// Angles/archetypes/avatars already taken by OTHER personas — the new one
				// must differ, so no two creators share the same positioning.
				const { data: allAgents } = await db.agents.list();
				// A full identity + look fingerprint of every OTHER persona, so the new one
				// is distinct across the whole account — strategy AND visual look. niche
				// is an agent column; the rest live in the market JSON.
				const taken = (allAgents ?? [])
					.filter((a: any) => a.id !== agentId)
					.map((a: any) => {
						const p: any = readPersonaProfile(a);
						const look = appearanceFingerprint(p.appearance);
						return {
							name: a.name,
							niche: a.niche || undefined,
							archetype: p.archetype || undefined,
							contentFocus: p.contentFocus || undefined,
							angle: p.contentAngle || undefined,
							avatar: p.targetAvatar || undefined,
							look: look || undefined
						};
					})
					.filter((x: any) => x.niche || x.archetype || x.angle || x.avatar || x.look);

				const prompt = `You are an elite influencer strategist. Design a UNIQUE, competitive persona profile for a UGC creator who represents one brand.

CREATOR: ${agent.name || 'this creator'} — gender: ${gender}. Personality/soul: ${String(agent.soul || '').slice(0, 800)}.
BRAND: ${b.brandName || b.name || 'the brand'}${b.tagline ? ` — ${b.tagline}` : ''}. Mission: ${b.mission || '—'}.
AUDIENCE: ${b.demographics || '—'}. Pain points: ${b.painPoints || '—'}. Interests: ${Array.isArray(b.interests) ? b.interests.join(', ') : b.interests || '—'}.
BRAND VOICE: ${b.commStyle || '—'}. Traits: ${Array.isArray(b.traits) ? b.traits.join(', ') : '—'}.
PRODUCTS: ${
					Array.isArray(b.products)
						? b.products
								.map((p: any) => p.name)
								.filter(Boolean)
								.join(', ')
						: '—'
				}.

This persona must be UNIQUE across the ENTIRE account — recognizably different from every other creator at a glance AND in positioning. Do NOT reuse another persona's content angle, target avatar, or visual look (ethnicity, age, skin tone, body type, hair color/length/style, eye color, headwear, wardrobe, colors). Prefer a niche/archetype/content-focus not already taken; only repeat one if it is unavoidable, and even then make the angle and look unmistakably distinct. Already used by other personas — avoid overlapping with any of these:
${JSON.stringify(taken).slice(0, 2500)}

Rules:
- "niche" MUST be exactly one of: ${NICHE_OPTIONS.join(' | ')}.
- "archetype" MUST be exactly one of: ${PERSONA_ARCHETYPES.join(' | ')}.
- "contentFocus" MUST be exactly one of: ${CONTENT_FOCUS_OPTIONS.join(' | ')}.
- "ageRanges" is an array using ONLY these exact strings (keep the en-dash): ${AGE_RANGE_KEYS.join(', ')}.
- "targetAvatar": one vivid sentence describing the ideal audience member by their traits, situation, and mindset — do NOT give them a proper name (write "a 36-year-old molecular-biologist mom who audits every ingredient", NEVER "Beatrice, a 36-year-old…").
- "psychProfile": 2-3 sentences on audience motivations, fears, desires, identity hooks.
- "contentAngle": the unique, ownable point of view that differentiates THIS creator competitively — first-person and specific, and unlike any other persona's angle above.
- "appearance": an object giving this creator a DISTINCT, ownable look that does NOT match any other persona's look above. "ethnicity" is REQUIRED and must be a specific, real heritage faithful to the creator's NAME and consistent with voiceProfile.nationality (e.g. "Jenny Tran" → "Vietnamese"; "Ratio Ramadan" → "Middle Eastern / Arab"; "Elena Washington" → "African-American"; "Chen Kai" → "Chinese") — never blank, never generic, never default everyone to the same ethnicity. Vary the ethnicity, age, skin tone, body type, hair color/length/style, eye color, distinctive facial features, headwear, wardrobe, and colors so each creator is visually UNMISTAKABLE from every other persona above. Emit ALL of these keys — ${APPEARANCE_CONTRACT}. Where an ALLOWED OPTION LIST is given you MUST copy one of those strings VERBATIM (exact spelling, casing and en-dash) — never invent your own wording for those keys. Use "none" for headwear if not applicable.
- "voiceProfile": read the creator's NAME (and soul) like a casting director — infer the heritage the name suggests and the spoken voice that fits the character. Keys: gender ("male"|"female"${nameGender ? ` — MUST be "${nameGender}", inferred from the creator's name` : " — infer STRICTLY from the creator's NAME; NEVER default to female"}), nationality (e.g. "American", "Indian", "Vietnamese-American", "British"), accent (the accent that voice would have, e.g. "American", "Indian", "British"). Examples: "Lexy Connor" → female American; "Ratio Ramadan" → male, Indian/South-Asian accent; "Jenny Tran" → female, Vietnamese-American; "Elena Washington" → female. Be faithful to the name — never default everyone to American.
- Tailor everything to the brand and keep it consistent with the creator's gender and personality.
- NAMES: the ONLY person with a proper name is the creator, ${agent.name || 'this creator'}. Never invent or use any other proper name ANYWHERE in the output — targetAvatar, psychProfile, and contentAngle must describe people by their traits/role, never by a made-up first name. A stray name here leaks into generated scripts and breaks character consistency.

Return ONLY JSON: {"niche":"","ageRanges":["25–34"],"archetype":"","contentFocus":"","targetAvatar":"","psychProfile":"","contentAngle":"","appearance":${APPEARANCE_JSON_SKELETON},"voiceProfile":{"gender":"","nationality":"","accent":""}}`;

				try {
					const parsed: any = safeParseJson(await ai!.generate(prompt, { json: true }));
					if (!parsed || typeof parsed !== 'object') {
						return json(
							{ success: false, error: `${ai!.provider} returned no usable profile — try again.` },
							{ status: 502 }
						);
					}
					// Coerce the LLM output back onto the allowed sets so every value selects
					// cleanly in the UI's <select> / chip bindings.
					// Voice: record the TRUE inferred profile (nationality/accent from the
					// name), then pin the closest voice the catalog actually has. Gender
					// resolves NAME-first (identity) → the LLM's read of the name → the passed
					// value only as a last resort — so a mis-set stored gender is CORRECTED,
					// not obeyed, and everything downstream (face, voice, kit) realigns.
					const vpRaw = parsed.voiceProfile || {};
					const llmGender: 'male' | 'female' | null =
						vpRaw.gender === 'male' || vpRaw.gender === 'female' ? vpRaw.gender : null;
					const vpGender: 'male' | 'female' | null =
						nameGender ?? llmGender ?? (gender === 'male' || gender === 'female' ? gender : null);
					const voiceProfile = {
						gender: vpGender ?? '',
						nationality: typeof vpRaw.nationality === 'string' ? vpRaw.nationality.trim() : '',
						accent: typeof vpRaw.accent === 'string' ? vpRaw.accent.trim() : ''
					};
					let voice: string | null = null;
					let voiceMatch: 'exact' | 'fallback' | null = null;
					if (vpGender) {
						// agentId as seed: personas sharing an accent spread across the
						// matching voices instead of all landing on the same one.
						const picked = pickVoiceForProfile(vpGender, voiceProfile.accent, agentId);
						voice = picked.voice.name;
						voiceMatch = picked.exact ? 'exact' : 'fallback';
					}

					const data = {
						niche: coerceToOption(parsed.niche, NICHE_OPTIONS),
						ageRanges: coerceAgeRanges(parsed.ageRanges),
						// The resolved (name-driven) gender — the UI adopts it so a mis-set
						// gender is corrected in place and everything realigns.
						gender: vpGender,
						archetype: coerceToOption(parsed.archetype, PERSONA_ARCHETYPES),
						contentFocus: coerceToOption(parsed.contentFocus, CONTENT_FOCUS_OPTIONS),
						targetAvatar: typeof parsed.targetAvatar === 'string' ? parsed.targetAvatar.trim() : '',
						psychProfile: typeof parsed.psychProfile === 'string' ? parsed.psychProfile.trim() : '',
						contentAngle: typeof parsed.contentAngle === 'string' ? parsed.contentAngle.trim() : '',
						appearance: coerceAppearance(parsed.appearance),
						voiceProfile,
						voice,
						voiceMatch
					};
					return json({ success: true, data });
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] Persona profile generation failed:', msg);
					return json(
						{
							success: false,
							error: `Generation failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: generate_identity_kit ──
			// The persona's PUBLIC-FACING identity: display name, ~10 username
			// candidates, and one bio per platform written to that platform's char
			// limit + register. Username availability has NO API anywhere — the user
			// confirms candidates manually at signup (mark taken → try next → confirm
			// the winner). Deliberately a SEPARATE action from generate_persona_profile:
			// it runs after the profile so the prompt can use the fresh niche/angle,
			// and it can re-roll bios/handles without churning strategy or look.
			if (action === 'generate_identity_kit') {
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}
				const agentId = typeof body.agentId === 'string' ? body.agentId : '';
				if (!agentId) return json({ success: false, error: 'Missing agentId' }, { status: 400 });

				const { data: agent } = await db.agents.get(agentId);
				if (!agent || agent.user_id !== session.user.id) {
					return json({ success: false, error: 'Persona not found' }, { status: 404 });
				}
				// Extended profile (archetype/angle/avatar…) lives in the persona profile.
				const profile: any = readPersonaProfile(agent);
				const brief = await loadBriefForAgent(
					db,
					session.user.id,
					body.brandBriefId || agent.brand_brief_id || null
				);
				const b: any = brief?.data ?? {};

				// LEAN CALLS by design: bios generate per platform (or a small batch),
				// NEVER all 13 at once — a full-registry call overflows the client's
				// max_tokens cap (truncated JSON) and flirts with the 120s LLM
				// deadline, which surfaced to users as "generates then times out".
				// body.platforms scopes the bios; body.includeBase adds display name +
				// username candidates. Omitting platforms = the persona's connected
				// platforms, else a starter trio.
				const requested: string[] | null = Array.isArray(body.platforms)
					? [
							...new Set(
								body.platforms.filter(
									(k: any) => typeof k === 'string' && BIO_PLATFORM_KEYS.includes(k)
								) as string[]
							)
						]
					: null;
				const includeBase =
					body.includeBase === true || (body.includeBase === undefined && !requested);
				let bioTargets: string[];
				if (requested) {
					bioTargets = requested.slice(0, 6);
				} else {
					const { data: conns } = await db.connections.listForAgent(agentId);
					const connected = [
						...new Set((conns ?? []).map((c: any) => String(c.platform || '').toLowerCase()))
					].filter((k) => BIO_PLATFORM_KEYS.includes(k));
					bioTargets = (connected.length ? connected : [...STARTER_BIO_PLATFORMS]).slice(0, 6);
				}
				if (bioTargets.length === 0 && !includeBase) {
					return json(
						{ success: false, error: 'Nothing to generate — pass platforms and/or includeBase.' },
						{ status: 400 }
					);
				}

				// Handles used or shortlisted by OTHER personas — candidates must not
				// collide anywhere on the account. Only needed when generating the base.
				const takenHandles = new Set<string>();
				if (includeBase) {
					const { data: allAgents } = await db.agents.list();
					for (const a of allAgents ?? []) {
						if (a.id === agentId) continue;
						const h = sanitizeHandle(a.handle);
						if (h) takenHandles.add(h);
						const p = readPersonaProfile(a);
						for (const c of coerceHandleCandidates(p.handleCandidates)) takenHandles.add(c.handle);
						for (const ch of Object.values(coerceConfirmedHandles(p.confirmedHandles))) {
							takenHandles.add(ch);
						}
					}
				}

				const wants: string[] = [];
				const contract: string[] = [];
				if (includeBase) {
					wants.push(
						`"displayName": the profile display name — the creator's real name, optionally plus ONE emoji or a 2–3 word descriptor. Max 30 chars.`,
						`"handles": exactly 10 username candidates, best first. Rules: lowercase letters, digits and underscores ONLY, 15 characters or fewer (so every candidate is valid on EVERY platform including X), no periods, rooted in the creator's name — catchy, memorable, unmistakably THIS creator (name + niche twists). Do NOT use any of these already-taken handles: ${[...takenHandles].join(', ') || '(none)'}.`
					);
					contract.push('"displayName":""', '"handles":["",""]');
				}
				if (bioTargets.length) {
					const bioRules = bioTargets
						.map(
							(k) =>
								`  "${k}": max ${PLATFORM_BIO_SPECS[k].limit} chars — ${PLATFORM_BIO_SPECS[k].style}`
						)
						.join('\n');
					wants.push(
						`"bios": one bio per platform, keys EXACTLY as listed, each within its limit and register:\n${bioRules}\nBio rules: first person, in the creator's voice; weave in the niche and what followers get; STRICTLY within each platform's character limit (count characters); no invented stats or follower counts; no proper names other than ${agent.name || 'the creator'}; use \\n for line breaks where the register calls for multiple lines; hashtags only where natural (TikTok/Instagram, max 2).`
					);
					contract.push(`"bios":{${bioTargets.map((k) => `"${k}":""`).join(',')}}`);
				}

				const prompt = `You are an elite social-media brand strategist. Create the public-facing identity kit for one UGC creator.

CREATOR: ${agent.name || 'this creator'}. Niche: ${agent.niche || profile.niche || '—'}. Archetype: ${profile.archetype || '—'}. Content focus: ${profile.contentFocus || '—'}. Unique angle: ${profile.contentAngle || '—'}. Audience: ${profile.targetAvatar || '—'}. Personality/soul: ${String(agent.soul || '').slice(0, 500)}.
BRAND they create for: ${b.brandName || b.name || '—'}${b.tagline ? ` — ${b.tagline}` : ''}. Mission: ${b.mission || '—'}. Products: ${
					Array.isArray(b.products)
						? b.products
								.map((p: any) => p.name)
								.filter(Boolean)
								.join(', ')
						: '—'
				}.

Return:
${wants.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Return ONLY JSON: {${contract.join(',')}}`;

				try {
					const parsed: any = safeParseJson(await ai!.generate(prompt, { json: true }));
					if (!parsed || typeof parsed !== 'object') {
						return json(
							{
								success: false,
								error: `${ai!.provider} returned no usable identity kit — try again.`
							},
							{ status: 502 }
						);
					}
					// Sanitize/dedupe candidates; drop collisions with other personas the
					// LLM ignored. Bios are FILTERED to the requested targets so an
					// over-eager model emitting extra platforms can never touch bios the
					// user wrote or generated for other platforms.
					const allBios = coerceBios(parsed.bios);
					const bios: Record<string, string> = {};
					for (const k of bioTargets) if (allBios[k]) bios[k] = allBios[k];
					const data = {
						displayName:
							includeBase && typeof parsed.displayName === 'string'
								? parsed.displayName.trim().slice(0, 40)
								: '',
						handleCandidates: includeBase
							? coerceHandleCandidates(parsed.handles).filter((c) => !takenHandles.has(c.handle))
							: [],
						bios
					};
					return json({ success: true, data });
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] Identity kit generation failed:', msg);
					return json(
						{
							success: false,
							error: `Generation failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: generate_full_persona ──
			// Generates one or more COMPLETE brand-tailored personas from scratch (for
			// the Agent Generator create flow). Unlike generate_persona_profile — which
			// fills an EXISTING agent — this invents the whole persona: a realistic
			// creator NAME, gender, niche, soul, PLUS the full profile. Each is unique
			// across the account and (when count>1) distinct from the others returned.
			if (action === 'generate_full_persona') {
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}
				const count = Math.min(Math.max(Number(body.count) || 1, 1), 3);
				// Optional user-set creative direction — a steer every generated persona
				// must honour (e.g. "a no-nonsense male strength coach for busy dads").
				const direction =
					typeof body.direction === 'string' ? body.direction.trim().slice(0, 400) : '';
				const brief = await loadBriefForAgent(db, session.user.id, body.brandBriefId || null);
				const b: any = brief?.data ?? {};

				// Full identity + look fingerprint of EVERY existing persona (incl. name),
				// so the new one(s) don't overlap on positioning, look, OR name.
				const { data: allAgents } = await db.agents.list();
				const taken = (allAgents ?? []).map((a: any) => {
					const p: any = readPersonaProfile(a);
					const look = appearanceFingerprint(p.appearance);
					return {
						name: a.name,
						niche: a.niche || undefined,
						archetype: p.archetype || undefined,
						angle: p.contentAngle || undefined,
						look: look || undefined
					};
				});

				const prompt = `You are an elite influencer strategist. Design ${count} UNIQUE, competitive UGC creator persona${count > 1 ? 's' : ''} that represent ONE brand.

BRAND: ${b.brandName || b.name || 'the brand'}${b.tagline ? ` — ${b.tagline}` : ''}. Mission: ${b.mission || '—'}.
AUDIENCE: ${b.demographics || '—'}. Pain points: ${b.painPoints || '—'}. Interests: ${Array.isArray(b.interests) ? b.interests.join(', ') : b.interests || '—'}.
BRAND VOICE: ${b.commStyle || '—'}. Traits: ${Array.isArray(b.traits) ? b.traits.join(', ') : '—'}.
PRODUCTS: ${
					Array.isArray(b.products)
						? b.products
								.map((p: any) => p.name)
								.filter(Boolean)
								.join(', ')
						: '—'
				}.
${direction ? `\nCREATIVE DIRECTION (agreed with the user — EVERY persona you return MUST be fine-tuned to this steer, on top of the brand): ${direction}\n` : ''}
Each persona must be UNIQUE across the ENTIRE account${count > 1 ? ' AND distinct from every other persona you return in this batch' : ''} — recognizably different in name, niche, positioning, and visual look. Do NOT reuse another persona's name, content angle, or look. Already used by existing personas — avoid overlapping:
${JSON.stringify(taken).slice(0, 2200)}

For EACH persona, produce these keys:
- "name": a realistic, memorable CREATOR name that fits the niche + brand and the inferred heritage (e.g. "Marcus Fit", "Elle Vitae", "Priya Kapoor") — a REAL person's name, NOT "<Brand> Advocate" or a slogan, and different from every existing name above.
- "gender": "male" | "female".
- "soul": 2-3 sentences on their personality, tone, and values (this becomes their character voice).
- "niche" MUST be exactly one of: ${NICHE_OPTIONS.join(' | ')}.
- "archetype" MUST be exactly one of: ${PERSONA_ARCHETYPES.join(' | ')}.
- "contentFocus" MUST be exactly one of: ${CONTENT_FOCUS_OPTIONS.join(' | ')}.
- "ageRanges" is an array using ONLY these exact strings (keep the en-dash): ${AGE_RANGE_KEYS.join(', ')}.
- "targetAvatar": one vivid sentence DESCRIBING the ideal audience member by traits/situation — do NOT give them a proper name.
- "psychProfile": 2-3 sentences on audience motivations, fears, desires.
- "contentAngle": the unique, ownable first-person POV that differentiates THIS creator.
- "appearance": a DISTINCT, ownable look. "ethnicity" is REQUIRED and must match the creator's NAME (e.g. "Priya Kapoor" → "Indian") — never blank or generic. Vary ethnicity, age, skin tone, body type, hair, eyes, wardrobe so each creator is visually unmistakable. Emit ALL of these keys — ${APPEARANCE_CONTRACT}. Where an ALLOWED OPTION LIST is given you MUST copy one of those strings VERBATIM (exact spelling, casing and en-dash) — never invent your own wording for those keys. Use "none" for headwear if not applicable.
- "voiceProfile": read the NAME like a casting director. Keys: gender ("male"|"female"), nationality (e.g. "American", "Indian", "Vietnamese-American"), accent.
- NAMES: the ONLY proper name in each persona's output is that creator's own "name". Never invent any other proper name in targetAvatar/psychProfile/contentAngle.

Return ONLY JSON: {"personas":[{"name":"","gender":"","soul":"","niche":"","archetype":"","contentFocus":"","ageRanges":["25–34"],"targetAvatar":"","psychProfile":"","contentAngle":"","appearance":${APPEARANCE_JSON_SKELETON},"voiceProfile":{"gender":"","nationality":"","accent":""}}]}`;

				try {
					const parsed: any = safeParseJson(await ai!.generate(prompt, { json: true }));
					const rawList: any[] = Array.isArray(parsed?.personas)
						? parsed.personas
						: parsed?.name
							? [parsed]
							: [];
					const personas = rawList
						.slice(0, count)
						.map((p: any, i: number) => {
							const vpRaw = p.voiceProfile || {};
							const vpGender: 'male' | 'female' | null =
								p.gender === 'male' || p.gender === 'female'
									? p.gender
									: vpRaw.gender === 'male' || vpRaw.gender === 'female'
										? vpRaw.gender
										: null;
							const voiceProfile = {
								gender: vpGender ?? '',
								nationality: typeof vpRaw.nationality === 'string' ? vpRaw.nationality.trim() : '',
								accent: typeof vpRaw.accent === 'string' ? vpRaw.accent.trim() : ''
							};
							let voice: string | null = null;
							let voiceMatch: 'exact' | 'fallback' | null = null;
							if (vpGender) {
								// Seed by name+index so a batch of 3 spreads across voices.
								const picked = pickVoiceForProfile(
									vpGender,
									voiceProfile.accent,
									`${p.name || ''}-${i}`
								);
								voice = picked.voice.name;
								voiceMatch = picked.exact ? 'exact' : 'fallback';
							}
							return {
								name: typeof p.name === 'string' ? p.name.trim() : '',
								gender: vpGender ?? '',
								soul: typeof p.soul === 'string' ? p.soul.trim() : '',
								niche: coerceToOption(p.niche, NICHE_OPTIONS),
								archetype: coerceToOption(p.archetype, PERSONA_ARCHETYPES),
								contentFocus: coerceToOption(p.contentFocus, CONTENT_FOCUS_OPTIONS),
								ageRanges: coerceAgeRanges(p.ageRanges),
								// Defensive: strip any leading name the model slipped into the avatar.
								targetAvatar: stripLeadingAvatarName(
									typeof p.targetAvatar === 'string' ? p.targetAvatar.trim() : ''
								),
								psychProfile: typeof p.psychProfile === 'string' ? p.psychProfile.trim() : '',
								contentAngle: typeof p.contentAngle === 'string' ? p.contentAngle.trim() : '',
								appearance: coerceAppearance(p.appearance),
								voiceProfile,
								voice,
								voiceMatch
							};
						})
						.filter((p: any) => p.name && p.niche);
					if (!personas.length) {
						return json(
							{ success: false, error: `${ai!.provider} returned no usable persona — try again.` },
							{ status: 502 }
						);
					}
					return json({ success: true, data: { personas } });
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] Full persona generation failed:', msg);
					return json(
						{
							success: false,
							error: `Generation failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: suggest_directions ──
			// From the selected brand brief, proposes a handful of SHORT persona
			// "direction" ideas (distinct angles) the user can click to steer generation
			// — on-brand and non-overlapping with existing personas' angles.
			if (action === 'suggest_directions') {
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}
				const brief = await loadBriefForAgent(db, session.user.id, body.brandBriefId || null);
				const b: any = brief?.data ?? {};
				const { data: allAgents } = await db.agents.list();
				const takenAngles = (allAgents ?? [])
					.map((a: any) => {
						const p: any = readPersonaProfile(a);
						return p.contentAngle || p.archetype || undefined;
					})
					.filter(Boolean)
					.slice(0, 20);

				const prompt = `You are an influencer strategist. Suggest 5 SHORT, punchy creative directions (persona angles) for UGC creators representing this brand. Each is ONE phrase, max 12 words, describing a distinct persona angle (e.g. "a no-nonsense male strength coach for busy dads"). Each must be tailored to the brand, clearly different from the others, and NOT overlap these existing angles: ${JSON.stringify(takenAngles).slice(0, 1200)}.

BRAND: ${b.brandName || b.name || 'the brand'}${b.tagline ? ` — ${b.tagline}` : ''}. Mission: ${b.mission || '—'}.
AUDIENCE: ${b.demographics || '—'}. Pain points: ${b.painPoints || '—'}.
PRODUCTS: ${
					Array.isArray(b.products)
						? b.products
								.map((p: any) => p.name)
								.filter(Boolean)
								.join(', ')
						: '—'
				}.

Return ONLY JSON: {"directions":["","","","",""]}`;

				try {
					const parsed: any = safeParseJson(await ai!.generate(prompt, { json: true }));
					const directions: string[] = Array.isArray(parsed?.directions)
						? parsed.directions
								.filter((d: any) => typeof d === 'string' && d.trim())
								.map((d: string) => d.trim().slice(0, 120))
								.slice(0, 6)
						: [];
					if (!directions.length) {
						return json(
							{ success: false, error: `${ai!.provider} returned no ideas — try again.` },
							{ status: 502 }
						);
					}
					return json({ success: true, data: { directions } });
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] Direction suggestions failed:', msg);
					return json(
						{
							success: false,
							error: `Suggestions failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: read_appearance_from_image ──
			// Vision: reads the persona's appearance (wardrobe, colors, hair, eyes,
			// headwear, styling) straight from a reference image so the appearance
			// variables MATCH the actual character instead of being invented.
			if (action === 'read_appearance_from_image') {
				const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
				if (!imageUrl) return json({ success: false, error: 'No image provided' }, { status: 400 });
				// User-supplied URL that a provider (or, on the Gemini path, THIS server)
				// will fetch. Reject internal/private targets here so both provider paths
				// behave the same and the rejection is a clean 400, not a vision failure.
				// Runs BEFORE the provider gate on purpose: the guard must hold — and be
				// provable by the live smoke probe — on a host with no AI key configured.
				try {
					await assertPublicHttpUrl(imageUrl);
				} catch (e) {
					return json(
						{ success: false, error: `Image URL rejected: ${(e as Error).message}` },
						{ status: 400 }
					);
				}
				if (!hasAi) {
					return json(
						{
							success: false,
							error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.'
						},
						{ status: 400 }
					);
				}

				// The contract is the SAME field list the profile generator and the
				// TraitPicker use (APPEARANCE_FIELDS), so a read-back fills every key the
				// portrait clause consumes — including the four that lead it (age, skin
				// tone, body type, hair length), which the old hand-written list skipped.
				// Length and style are asked for SEPARATELY: writing "long wavy" into
				// hairstyle is the legacy combined value `hairDescriptor()` has to de-dup.
				const prompt = `Look ONLY at the person in the provided image and describe their real appearance for a character config. Fill each field from what you actually SEE. Use "" if genuinely unclear; use "none" for headwear if there is none. Describe ethnicity/heritage respectfully from visible features so the pinned face can be reproduced faithfully.
Fields — ${APPEARANCE_CONTRACT}.
Where an option list is given you MUST copy one option VERBATIM (exact spelling, casing and en-dash). "hairstyle" is the STYLE ONLY (curly/wavy/straight/bun…) — put the length in "hairLength". "personaAge" is the person's apparent age bracket.
Return ONLY JSON: ${APPEARANCE_JSON_SKELETON}`;

				try {
					const parsed: any = safeParseJson(await ai!.generate(prompt, { json: true, imageUrl }));
					if (!parsed || typeof parsed !== 'object') {
						return json(
							{ success: false, error: `${ai!.provider} couldn't read the image — try again.` },
							{ status: 502 }
						);
					}
					// Vision output is LLM output, so snapping curated traits onto their
					// option list is correct here (it is STORED values that must never be
					// snapped). Off-list answers are kept verbatim — a legit description
					// beats a blank.
					const snapped: Record<string, string> = {};
					for (const f of APPEARANCE_FIELDS) {
						const v = parsed[f.key];
						if (typeof v !== 'string') continue;
						snapped[f.key] = f.options.length ? coerceToOption(v, f.options) || v : v;
					}
					return json({ success: true, data: { appearance: coerceAppearance(snapped) } });
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] read_appearance_from_image failed:', msg);
					return json(
						{ success: false, error: `Read failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
						{ status: 502 }
					);
				}
			}

			// ── ACTION: generate_field (generate from scratch, no existing text needed) ──
			if (action === 'generate_field') {
				const fieldName = body.fieldName || 'Description';
				const brandContext = body.brandContext || '';

				if (!hasAi) {
					return json(
						{ success: false, error: 'No AI provider configured. Add an API key in Settings.' },
						{ status: 400 }
					);
				}

				try {
					const prompt = `You are an elite brand strategist and copywriter.
Generate compelling text for the brand brief field: "${fieldName}".
${brandContext ? `Brand context:\n${brandContext}` : ''}
Keep the output concise and high-converting (2-3 sentences max unless the field requires more).
Output ONLY the generated text for this field — no explanation, no label, no quotes.`;

					const resText = await ai!.generate(prompt);
					if (resText) {
						return json({ success: true, data: { generated: resText.trim() } });
					}
					return json(
						{ success: false, error: `${ai!.provider} returned an empty response — try again.` },
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI field generation failed:', msg);
					return json(
						{
							success: false,
							error: `Generation failed via ${ai!.provider}: ${msg.slice(0, 200)}`
						},
						{ status: 502 }
					);
				}
			}

			// ── ACTION: spin_field (rewrite existing text in 3 distinct ways) ──────
			if (action === 'spin_field') {
				const fieldName = body.fieldName || 'Description';
				const fieldVal = body.fieldVal || '';
				const brandContext = body.brandContext || '';

				if (!fieldVal.trim()) {
					return json({ success: false, error: 'No text to spin' }, { status: 400 });
				}
				if (!hasAi) {
					return json(
						{ success: false, error: 'No AI provider configured. Add an API key in Settings.' },
						{ status: 400 }
					);
				}

				try {
					const prompt = `You are an elite brand strategist, copywriter, and e-commerce UGC marketer.
Rewrite this brand brief field "${fieldName}" in 3 distinctly different ways.
Each variation should have a different angle, tone, emotional hook, or emphasis — not just synonym swaps.
${brandContext ? `Brand context:\n${brandContext}` : ''}
Original text: "${fieldVal}"

Return JSON: { "variations": ["variation 1 text", "variation 2 text", "variation 3 text"] }`;

					const resText = await ai!.generate(prompt, { json: true });
					if (resText) {
						const parsed = safeParseJson(resText);
						if (parsed?.variations?.length) {
							return json({ success: true, data: { variations: parsed.variations } });
						}
					}
					return json(
						{ success: false, error: `${ai!.provider} returned no usable variations — try again.` },
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI field spin failed:', msg);
					return json(
						{ success: false, error: `Spin failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
						{ status: 502 }
					);
				}
			}
		}

		// ══════════════════════════════════════════════════════════════════════════
		// E. PATH: personagen-publish
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-publish') {
			let targetPostId = body.post_id;
			if (!targetPostId && body.post) {
				targetPostId = body.post.id;
			}

			if (targetPostId) {
				const now = new Date();
				console.log(`[Local Engine] Queueing post ${targetPostId} for immediate scheduler publish`);
				const { error } = await db.posts.update(targetPostId, {
					status: 'scheduled',
					scheduled_date: now.toISOString().split('T')[0],
					scheduled_time: now.toTimeString().split(' ')[0],
					published_at: null
				});
				if (error) {
					console.error('[Engine] Failed to queue post for publishing:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}
			}

			return json({
				success: true,
				data: {
					message: 'Post queued for publishing. The scheduler will publish via Zernio.',
					queuedAt: new Date().toISOString()
				}
			});
		}

		// ══════════════════════════════════════════════════════════════════════════
		// F. Catch-All Fallback
		// ══════════════════════════════════════════════════════════════════════════
		return json({ success: false, error: `Unknown engine path: ${path}` }, { status: 400 });
	} catch (err) {
		console.error(`[Local Engine] Error processing path "${path}":`, err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
