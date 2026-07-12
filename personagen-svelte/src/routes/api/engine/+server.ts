import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';
import { getUserApiKey } from '$lib/server/user-api-keys';
import { publishPostById } from '$lib/server/scheduler';
import { resolveAiClient } from '$lib/server/ai-client';
import {
	generateUgcPack,
	generateUgcImage,
	safeParseJson,
	resolveImageKeys,
	loadBriefForAgent
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
	coerceAppearance
} from '$lib/persona-profile';
import { pickVoiceForProfile } from '$lib/server/voices';
import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF guard for the storefront-scrape fallback below: an authenticated user
 * supplies an arbitrary URL, and without this check the server would fetch
 * whatever they point it at — cloud metadata endpoints, internal admin
 * panels, localhost services. Resolves the hostname (not just string-matches
 * it) so a public-looking domain that resolves to a private IP is still
 * rejected — a bare hostname check alone doesn't stop that DNS-rebinding-style
 * bypass.
 */
async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error('Invalid URL');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Only http/https URLs are allowed');
	}
	const hostname = parsed.hostname.toLowerCase();
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
		throw new Error('URL resolves to a disallowed host');
	}

	const candidateIps: string[] = [];
	if (net.isIP(hostname)) {
		candidateIps.push(hostname);
	} else {
		const records = await dns.lookup(hostname, { all: true }).catch(() => []);
		candidateIps.push(...records.map((r) => r.address));
	}
	if (candidateIps.length === 0) {
		throw new Error('Could not resolve URL host');
	}

	for (const ip of candidateIps) {
		if (isPrivateOrReservedIp(ip)) {
			throw new Error('URL resolves to a private/internal address');
		}
	}
}

function isPrivateOrReservedIp(ip: string): boolean {
	if (net.isIPv4(ip)) {
		const parts = ip.split('.').map(Number);
		const [a, b] = parts;
		if (a === 127) return true; // loopback
		if (a === 10) return true; // private
		if (a === 172 && b >= 16 && b <= 31) return true; // private
		if (a === 192 && b === 168) return true; // private
		if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata: 169.254.169.254)
		if (a === 0) return true; // "this network"
		return false;
	}
	if (net.isIPv6(ip)) {
		const lower = ip.toLowerCase();
		if (lower === '::1') return true; // loopback
		if (lower.startsWith('fe80:')) return true; // link-local
		if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
		if (lower.startsWith('::ffff:')) {
			// IPv4-mapped IPv6 — recheck the embedded IPv4 address.
			return isPrivateOrReservedIp(lower.replace('::ffff:', ''));
		}
		return false;
	}
	return true; // unrecognized format — fail closed
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
	const ai = await resolveAiClient(locals.supabase, session.user.id);
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
				const count = Math.min(Math.max(body.count || 10, 1), 100);
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
				const { orKey, falKey } = await resolveImageKeys(locals.supabase, session.user.id);
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
								const genUrl = await generateUgcImage(parsed.ugc_broll_prompt, orKey, falKey);
								// Archive it now. With a service key, a persist failure throws →
								// this item drops to a failure rather than scheduling a post with a
								// dead media_url. Without one, we fall back to the provider URL.
								parsed.media_url = batchSvc
									? await persistToStorage(batchSvc, genUrl, session.user.id, 'png')
									: genUrl;
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
						message: postStatus === 'draft' ? 'Saved as draft — connect a platform to publish.' : undefined
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
					if (!agent) return json({ success: false, error: 'Agent not found' }, { status: 404 });
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
						{ success: false, error: `${ai!.provider} returned an unusable script response — try again.` },
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI script forge failed:', msg);
					return json(
						{ success: false, error: `Script generation failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
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
						{ success: false, error: `Title generation failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
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
						{ success: false, error: `${ai!.provider} returned no usable thumbnail brief — try again.` },
						{ status: 502 }
					);
				} catch (err) {
					const msg = (err as Error).message || 'unknown error';
					console.error('[Engine] AI thumbnail brief failed:', msg);
					return json(
						{ success: false, error: `Thumbnail brief failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
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
						{ success: false, error: `Generation failed via ${ai?.provider ?? 'AI'}: ${msg.slice(0, 200)}` },
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
				const briefName =
					String(body.name || briefData.brandName || '').trim() || 'Untitled Brand';

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
							try {
								const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
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
								});
								if (fcRes.ok) {
									const fcJson = await fcRes.json();
									if (fcJson.success && fcJson.data?.markdown) {
										contentToParse = fcJson.data.markdown.substring(0, 40000);
										const meta = fcJson.data.metadata || {};
										// Logo candidates from OpenGraph / favicon metadata.
										for (const key of ['ogImage', 'og:image', 'image', 'favicon', 'logo']) {
											const v = meta[key];
											if (typeof v === 'string' && v.startsWith('http')) logoCandidates.push(v);
											else if (Array.isArray(v))
												v.filter((x) => typeof x === 'string' && x.startsWith('http')).forEach((x) => logoCandidates.push(x));
										}
										if (Array.isArray(fcJson.data.links)) {
											discoveredLinks.push(
												...fcJson.data.links
													.filter((l: any) => typeof l === 'string')
													.slice(0, 200)
											);
										}
										if (typeof fcJson.data.rawHtml === 'string') {
											harvestFonts(fcJson.data.rawHtml.slice(0, 300000));
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
												typeof f === 'string'
													? f
													: f?.family || f?.name || null;
											brandGuide = {
												logo: b.images?.logo || b.logo || b.logoUrl || null,
												favicon: b.images?.favicon || b.favicon || null,
												primaryColor: b.colors?.primary || b.colors?.primaryColor || null,
												secondaryColor: b.colors?.secondary || b.colors?.secondaryColor || null,
												accentColor: b.colors?.accent || null,
												fontPrimary:
													fontName(b.typography?.heading) || fontName(b.typography?.primary) ||
													fontName(b.fonts?.primary) ||
													(Array.isArray(b.fonts) ? fontName(b.fonts[0]) : null),
												fontSecondary:
													fontName(b.typography?.body) || fontName(b.fonts?.secondary) ||
													(Array.isArray(b.fonts) ? fontName(b.fonts[1]) : null),
												tone: b.personality?.tone || null,
												energy: b.personality?.energy || null,
												audience: b.personality?.audience || null
											};
											console.log('[Engine] Firecrawl branding guide captured:', JSON.stringify(brandGuide).slice(0, 300));
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
									contentToParse = html
										.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
										.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
										.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
										.substring(0, 40000);
								}
							} catch (ssrfErr) {
								console.warn(
									`[Engine] Refused direct fetch for ${storeUrl}:`,
									(ssrfErr as Error).message
								);
							}
						}

						if (contentToParse && hasAi) {
							// Scrape individual product pages for richer product data + photos.
							// Filter product-like URLs from the discovered links and scrape up to 4.
							const productLinks = discoveredLinks
								.filter((l) => /\/(products?|shop|item)\//i.test(l))
								.slice(0, 4);

							let productPageContent = '';
							if (firecrawlKey && !firecrawlKey.includes('placeholder') && productLinks.length > 0) {
								const productPageResults = await Promise.allSettled(
									productLinks.map(async (link) => {
										try {
											await assertPublicHttpUrl(link);
											const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
												method: 'POST',
												headers: {
													'Content-Type': 'application/json',
													Authorization: `Bearer ${firecrawlKey}`
												},
												body: JSON.stringify({ url: link, formats: ['markdown', 'links'], onlyMainContent: true })
											});
											if (!r.ok) return '';
											const rj = await r.json();
											// Collect image URLs from product page links/metadata
											if (rj.success) {
												const meta = rj.data?.metadata || {};
												for (const key of ['ogImage', 'og:image', 'image']) {
													const v = meta[key];
													if (typeof v === 'string' && v.startsWith('http')) logoCandidates.push(v);
												}
											}
											return rj.success ? (rj.data?.markdown || '').substring(0, 5000) : '';
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
Use the LOGO CANDIDATES for "logoUrl". Prefer real absolute image URLs (https://...) for every product "photoUrl" — look in the product pages content section. Never leave logoUrl empty if a candidate exists.${logoHint}${fontHint}${brandGuideHint}
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
${contentToParse.substring(0, 20000)}${productPagesHint}`;

							const resText = await ai!.generate(prompt, { json: true });
							if (resText) {
								const parsed = safeParseJson(resText);
								if (parsed && parsed.brandName) {
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
										if (brandGuide.secondaryColor) parsed.secondaryColor = brandGuide.secondaryColor;
										if (brandGuide.fontPrimary) parsed.fontPrimary = brandGuide.fontPrimary;
										if (brandGuide.fontSecondary) parsed.fontSecondary = brandGuide.fontSecondary;
									}
									// Backfill fonts from the harvested CSS candidates.
									if (!parsed.fontPrimary && fontCandidates[0]) parsed.fontPrimary = fontCandidates[0];
									if (!parsed.fontSecondary && fontCandidates[1]) parsed.fontSecondary = fontCandidates[1];
									// Belt+braces: never let a font reach the UI as an object.
									const coerceFont = (f: any) =>
										typeof f === 'string' ? f : f?.family || f?.name || '';
									parsed.fontPrimary = coerceFont(parsed.fontPrimary);
									parsed.fontSecondary = coerceFont(parsed.fontSecondary);
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

					const userFcKey = await getUserApiKey(locals.supabase, session.user.id, 'firecrawl').catch(
						() => null
					);
					const fcKey = userFcKey || env.FIRECRAWL_API_KEY;
					let pageContent = '';
					const imageCandidates: string[] = [];

					if (fcKey && !fcKey.includes('placeholder') && fcKey.trim() !== '') {
						const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${fcKey}`
							},
							body: JSON.stringify({ url: productUrl, formats: ['markdown'], onlyMainContent: false })
						});
						if (fcRes.ok) {
							const fcJson = (await fcRes.json()) as any;
							if (fcJson.success && fcJson.data?.markdown) {
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
							{ success: false, error: 'Could not fetch that product page (check the URL / Firecrawl key).' },
							{ status: 400 }
						);
					}

					const resText = await ai!.generate(
						`Extract ONE product from this product page.
${imageCandidates.length ? `IMAGE CANDIDATES (prefer the first for photoUrl): ${imageCandidates.slice(0, 4).join(', ')}` : ''}
Return ONLY JSON: { "name": "Product name", "description": "1-2 sentence description", "price": "$Price as shown", "photoUrl": "absolute https image URL" }
Page content:
${pageContent}`,
						{ json: true }
					);
					const parsed = safeParseJson(resText || '');
					if (!parsed?.name) {
						return json({ success: false, error: 'Could not extract a product from that page.' }, { status: 422 });
					}
					if ((!parsed.photoUrl || !String(parsed.photoUrl).startsWith('http')) && imageCandidates[0]) {
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
						{ success: false, error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.' },
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
						{ success: false, error: `Enrichment failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
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
						{ success: false, error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.' },
						{ status: 400 }
					);
				}
				const agentId = typeof body.agentId === 'string' ? body.agentId : '';
				if (!agentId) return json({ success: false, error: 'Missing agentId' }, { status: 400 });

				const { data: agent } = await db.agents.get(agentId);
				if (!agent || agent.user_id !== session.user.id) {
					return json({ success: false, error: 'Agent not found' }, { status: 404 });
				}
				const gender = typeof body.gender === 'string' && body.gender ? body.gender : 'unspecified';
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
						let p: any = {};
						try {
							if (typeof a.market === 'string' && a.market.startsWith('{')) p = JSON.parse(a.market);
						} catch {
							/* ignore unparseable market */
						}
						const ap = p.appearance || {};
						const look = [ap.hairColor, ap.hairstyle, ap.eyeColor, ap.headwear, ap.wardrobe, ap.outfitColors]
							.filter(Boolean)
							.join(', ');
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
PRODUCTS: ${Array.isArray(b.products) ? b.products.map((p: any) => p.name).filter(Boolean).join(', ') : '—'}.

This persona must be UNIQUE across the ENTIRE account — recognizably different from every other creator at a glance AND in positioning. Do NOT reuse another persona's content angle, target avatar, or visual look (hair color, hairstyle, eye color, headwear, wardrobe, colors). Prefer a niche/archetype/content-focus not already taken; only repeat one if it is unavoidable, and even then make the angle and look unmistakably distinct. Already used by other personas — avoid overlapping with any of these:
${JSON.stringify(taken).slice(0, 2500)}

Rules:
- "niche" MUST be exactly one of: ${NICHE_OPTIONS.join(' | ')}.
- "archetype" MUST be exactly one of: ${PERSONA_ARCHETYPES.join(' | ')}.
- "contentFocus" MUST be exactly one of: ${CONTENT_FOCUS_OPTIONS.join(' | ')}.
- "ageRanges" is an array using ONLY these exact strings (keep the en-dash): ${AGE_RANGE_KEYS.join(', ')}.
- "targetAvatar": one vivid sentence naming the ideal audience member.
- "psychProfile": 2-3 sentences on audience motivations, fears, desires, identity hooks.
- "contentAngle": the unique, ownable point of view that differentiates THIS creator competitively — first-person and specific, and unlike any other persona's angle above.
- "appearance": an object giving this creator a DISTINCT, ownable look (consistent with the gender) that does NOT match any other persona's look above — vary the hair color/style, eye color, headwear, wardrobe, and colors so each creator is visually unique. Keys — ${APPEARANCE_FIELDS.map((f) => `${f.key} (${f.placeholder.replace(/^e\.g\.\s*/, '')})`).join('; ')}. Use "none" for headwear if not applicable.
- "voiceProfile": read the creator's NAME (and soul) like a casting director — infer the heritage the name suggests and the spoken voice that fits the character. Keys: gender ("male"|"female"${gender !== 'unspecified' ? ` — MUST be "${gender}", it is already set` : ', inferred from the name'}), nationality (e.g. "American", "Indian", "Vietnamese-American", "British"), accent (the accent that voice would have, e.g. "American", "Indian", "British"). Examples: "Lexy Connor" → female American; "Ratio Ramadan" → male, Indian/South-Asian accent; "Jenny Tran" → female, Vietnamese-American; "Elena Washington" → female. Be faithful to the name — never default everyone to American.
- Tailor everything to the brand and keep it consistent with the creator's gender and personality.

Return ONLY JSON: {"niche":"","ageRanges":["25–34"],"archetype":"","contentFocus":"","targetAvatar":"","psychProfile":"","contentAngle":"","appearance":{"wardrobe":"","outfitColors":"","hairstyle":"","hairColor":"","eyeColor":"","headwear":"","styling":""},"voiceProfile":{"gender":"","nationality":"","accent":""}}`;

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
					// name), then pin the closest voice the catalog actually has. The
					// explicit gender input always wins over the LLM's inference.
					const vpRaw = parsed.voiceProfile || {};
					const vpGender: 'male' | 'female' | null =
						gender === 'male' || gender === 'female'
							? gender
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
						// agentId as seed: personas sharing an accent spread across the
						// matching voices instead of all landing on the same one.
						const picked = pickVoiceForProfile(vpGender, voiceProfile.accent, agentId);
						voice = picked.voice.name;
						voiceMatch = picked.exact ? 'exact' : 'fallback';
					}

					const data = {
						niche: coerceToOption(parsed.niche, NICHE_OPTIONS),
						ageRanges: coerceAgeRanges(parsed.ageRanges),
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
						{ success: false, error: `Generation failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
						{ status: 502 }
					);
				}
			}

			// ── ACTION: read_appearance_from_image ──
			// Vision: reads the persona's appearance (wardrobe, colors, hair, eyes,
			// headwear, styling) straight from a reference image so the appearance
			// variables MATCH the actual character instead of being invented.
			if (action === 'read_appearance_from_image') {
				if (!hasAi) {
					return json(
						{ success: false, error: 'No AI provider configured. Add an OpenRouter or Gemini key in Settings.' },
						{ status: 400 }
					);
				}
				const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
				if (!imageUrl) return json({ success: false, error: 'No image provided' }, { status: 400 });

				const prompt = `Look ONLY at the person in the provided image and describe their real appearance for a character config. Fill each field from what you actually SEE; use "" if genuinely unclear and "none" for headwear if there is none.
- wardrobe: their outfit / clothing
- outfitColors: the main colors of the outfit
- hairstyle: hair length and style
- hairColor: hair color
- eyeColor: eye color
- headwear: any hat / turban / scarf, else "none"
- styling: the overall vibe, season, or era of the look
Return ONLY JSON: {"wardrobe":"","outfitColors":"","hairstyle":"","hairColor":"","eyeColor":"","headwear":"","styling":""}`;

				try {
					const parsed: any = safeParseJson(await ai!.generate(prompt, { json: true, imageUrl }));
					if (!parsed || typeof parsed !== 'object') {
						return json(
							{ success: false, error: `${ai!.provider} couldn't read the image — try again.` },
							{ status: 502 }
						);
					}
					return json({ success: true, data: { appearance: coerceAppearance(parsed) } });
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
					return json({ success: false, error: 'No AI provider configured. Add an API key in Settings.' }, { status: 400 });
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
						{ success: false, error: `Generation failed via ${ai!.provider}: ${msg.slice(0, 200)}` },
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
					return json({ success: false, error: 'No AI provider configured. Add an API key in Settings.' }, { status: 400 });
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
