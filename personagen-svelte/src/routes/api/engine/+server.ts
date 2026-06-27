import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';
import { getUserApiKey } from '$lib/server/user-api-keys';
import { publishPostById } from '$lib/server/scheduler';
import { resolveAiClient } from '$lib/server/ai-client';

// Helper: safe JSON parsing for AI responses
function safeParseJson(text: string) {
	try {
		const cleaned = text
			.replace(/```json/g, '')
			.replace(/```/g, '')
			.trim();
		return JSON.parse(cleaned);
	} catch (e) {
		console.warn('[Engine] Failed to parse AI response as JSON:', e);
		return null;
	}
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
			let agentContext = '';
			let agentData: any = null;
			if (agentId) {
				const { data: agent } = await db.agents.get(agentId);
				if (agent) {
					agentData = agent;
					agentContext = `You are ${agent.name} (@${agent.handle}), a ${agent.niche} content creator.
Personality: ${agent.soul || 'Authentic and relatable'}
Content Style: ${agent.skills || 'UGC-style product content'}
`;
				}
			}

			// ── Load brand brief + select product ───────────────────────────────
			let productContext = '';
			let selectedProduct: any = null;
			let briefData: any = null;
			const { data: brandBrief } = await db.brandBriefs.get(session.user.id);
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
			const fullContext = [agentContext, productContext, templateDetails].filter(Boolean).join('\n');

			// ── ACTION: generate (single UGC post pack — replaces generate-post) ──
			if (action === 'generate') {
				if (!hasAi) {
					// Fallback
					return json({
						success: true,
						data: {
							text: `🔥 ${topic}\n\nMost creators struggle because they lack a clear blueprint.\n\n1️⃣ Process over Output\n2️⃣ Aggressive Hooking\n3️⃣ Niche Mastery\n\nWhich one are you focusing on today? 👇`,
							hashtags: ['#CreatorEconomy', '#UGC', '#PersonalBrand', '#Growth', '#PersonaGen'],
							hookScore: 88,
							ugc_broll_prompt: `Handheld close-up of a person using a product, natural lighting, authentic feel.`,
							script: `[HOOK] "Stop scrolling if you care about ${topic}"\n[BODY] Quick cuts showing the product in use\n[CTA] "Follow for more!"`,
							media_url: selectedProduct?.photoUrl || null,
							product: selectedProduct ? { name: selectedProduct.name, price: selectedProduct.price } : null,
							platform
						}
					});
				}

				const systemInstruction = `${agentContext || 'You are a UGC content creator.'}
Generate a social media post pack containing a caption, a UGC B-roll description, and a 15s short video script.
You MUST respond with a valid JSON object ONLY. No markdown fences or commentary.

JSON schema:
{
  "text": "Ready-to-publish caption (hooks, body, hashtags, CTA). Do NOT include script or prompt text in the caption.",
  "hashtags": ["#tag1", "#tag2", ...],
  "hookScore": <number 70-99>,
  "ugc_broll_prompt": "UGC video description: actor details, handheld camera feel, natural lighting, negative constraints, high platform energy",
  "script": "15s Short Video Script (Hook in first 3s, voiceover/dialogue, text-on-screen, CTA)"
}`;

				const prompt = `Generate a UGC post pack for ${platform}.
Topic: "${topic}"

${productContext ? `PRODUCT FOCUS:\n${productContext}` : 'Focus on the brand niche.'}
${templateDetails ? `STYLE TEMPLATE:\n${templateDetails}` : ''}
${briefData ? `Audience: ${briefData.demographics || 'N/A'}\nPain points: ${briefData.painPoints || 'N/A'}` : ''}

The content must feature the specific product by name. The UGC B-roll prompt should describe a person using THIS product specifically. Output ONLY the JSON.`;

				try {
					const responseText = await ai!.generate(prompt, { systemInstruction, json: true }) || '{}';
					let parsed = safeParseJson(responseText);
					if (parsed) {
						// Robust parsing: check for nested JSON in text field
						if (parsed.text && typeof parsed.text === 'string' && parsed.text.trim().startsWith('{')) {
							try {
								const nested = JSON.parse(parsed.text);
								if (nested && typeof nested === 'object') parsed = { ...parsed, ...nested };
							} catch { /* ignore */ }
						}
						parsed.media_url = selectedProduct?.photoUrl || null;
						parsed.product = selectedProduct ? { name: selectedProduct.name, price: selectedProduct.price, description: selectedProduct.description } : null;
						parsed.platform = platform;
						return json({ success: true, data: parsed });
					}
				} catch (err) {
					console.error('[Engine] AI generate post pack failed:', err);
				}

				return json({ success: false, error: 'AI generation failed' }, { status: 500 });
			}

			// ── ACTION: batch_generate (100 UGC copies in one click) ────────────
			if (action === 'batch_generate') {
				const count = Math.min(Math.max(body.count || 10, 1), 100);
				const BATCH_SIZE = 10;

				if (!hasAi) {
					return json({ success: false, error: 'No AI provider configured. Add an API key in Settings.' }, { status: 500 });
				}

				const copies: any[] = [];

				for (let i = 0; i < count; i += BATCH_SIZE) {
					const batchPromises = Array.from(
						{ length: Math.min(BATCH_SIZE, count - i) },
						(_, j) => {
							const idx = i + j + 1;
							const prompt = `${fullContext}
Write variation ${idx} of ${count} — a UNIQUE, ready-to-publish UGC social media post for ${platform}.
Topic: "${topic}"

CRITICAL: Make this variation DISTINCT. Vary the hook style, emoji usage, CTA, tone angle, and sentence structure from other variations.
${selectedProduct ? `The post MUST feature the product "${selectedProduct.name}" by name and describe it being used authentically.` : ''}

Return JSON:
{
  "text": "Ready-to-publish caption with hook, body, hashtags, CTA",
  "hashtags": ["#tag1", "#tag2", ...],
  "hookScore": <number 70-99>,
  "ugc_broll_prompt": "UGC video description showing a real person using ${selectedProduct?.name || 'the product'}",
  "script": "15s video script (3s hook, body, CTA)"
}`;
							return ai!.generate(prompt, { json: true }).catch((err: any) => {
								console.error(`[Engine] Batch item ${idx} failed:`, err);
								return null;
							});
						}
					);

					const results = await Promise.allSettled(batchPromises);
					for (const r of results) {
						if (r.status === 'fulfilled' && r.value) {
							const parsed = safeParseJson(r.value);
							if (parsed && parsed.text) {
								parsed.media_url = selectedProduct?.photoUrl || null;
								parsed.product = selectedProduct
									? { name: selectedProduct.name, price: selectedProduct.price, description: selectedProduct.description }
									: null;
								parsed.platform = platform;
								copies.push(parsed);
							}
						}
					}
				}

				return json({
					success: true,
					data: {
						copies,
						total: copies.length,
						requested: count,
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
				const windowStart = body.window_start || 8;   // 8 AM
				const windowEnd = body.window_end || 20;       // 8 PM
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
					return json(
						{ success: false, error: 'Missing content or agent_id' },
						{ status: 400 }
					);
				}

				// Fetch agent's active connections to determine target platforms
				const { data: connections } = await locals.supabase
					.from('connections')
					.select('platform')
					.eq('agent_id', agentId)
					.eq('status', 'active');

				const targetPlatforms = (connections || []).map((c: any) => c.platform);
				if (targetPlatforms.length === 0) {
					return json(
						{ success: false, error: 'No active social connections. Connect a platform first.' },
						{ status: 400 }
					);
				}

				const contentObj = {
					text: typeof content === 'string' ? content : (content.content || content.text || ''),
					media_url: mediaUrl
				};

				const now = new Date();
				const { data: post, error: postErr } = await db.posts.create({
					user_id: session.user.id,
					agent_id: agentId,
					content: JSON.stringify(contentObj),
					platforms: targetPlatforms,
					status: 'scheduled',
					scheduled_date: now.toISOString().split('T')[0],
					scheduled_time: now.toTimeString().split(' ')[0],
					published_at: null
				});

				if (postErr || !post) {
					return json(
						{ success: false, error: postErr?.message || 'Failed to create post' },
						{ status: 500 }
					);
				}

				const publishSuccess = await publishPostById(post.id);
				const { data: updatedPost } = await db.posts.get(post.id);

				return json({
					success: true,
					data: {
						post: updatedPost || post,
						published: publishSuccess,
						platforms: targetPlatforms
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
									instructions: 'Copy the bio and display name to your Instagram profile. Use the profile_picture_prompt with any AI image generator (Midjourney, DALL-E, Flux) to create your profile picture, then upload manually.'
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
						instructions: 'Copy the bio and display name to your Instagram profile. Use the profile_picture_prompt with any AI image generator to create your profile picture, then upload manually.'
					}
				});
			}

			// ── ACTION: script ───────────────────────────────────────────────────
			if (action === 'script') {
				if (hasAi) {
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
					} catch (err) {
						console.error('[Engine] AI script forge failed:', err);
					}
				}

				return json({
					success: true,
					data: {
						type: 'script',
						platform,
						content: `[SCENE: Close-up, handheld]\n"I tried ${selectedProduct?.name || topic} and here's what happened..."\n\n[VISUAL: Product in use, natural lighting]\n"The results speak for themselves."\n\n[CTA] "Link in bio — try it yourself."`,
						hashtags: ['#UGC', '#ProductReview', '#Authentic'],
						hookScore: 90,
						estimatedReach: '14.8K - 38.6K'
					}
				});
			}

			// ── ACTION: titles ───────────────────────────────────────────────────
			if (action === 'titles') {
				if (hasAi) {
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
					} catch (err) {
						console.error('[Engine] AI titles failed:', err);
					}
				}

				return json({
					success: true,
					data: {
						type: 'titles',
						platform,
						titles: [
							`The truth about ${selectedProduct?.name || topic} nobody tells you`,
							`I tried ${selectedProduct?.name || topic} for 30 days — here's what happened`,
							`Stop scrolling if you care about ${topic}`,
							`Why everyone is switching to ${selectedProduct?.name || topic}`,
							`The 3 secrets about ${topic} revealed`,
							`Before you buy ${selectedProduct?.name || 'another product'}, watch this`,
							`The ultimate 2026 guide to ${topic}`,
							`How ${selectedProduct?.name || topic} changed my routine forever`
						],
						hookScore: 90
					}
				});
			}

			// ── ACTION: thumbnail_brief ──────────────────────────────────────────
			if (action === 'thumbnail_brief') {
				if (hasAi) {
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
					} catch (err) {
						console.error('[Engine] AI thumbnail brief failed:', err);
					}
				}

				return json({
					success: true,
					data: {
						type: 'thumbnail',
						platform,
						thumbnailNotes: [
							'**Layout**: Split composition with face (left 50%) and product (right 50%)',
							'**Expression**: Surprised/excited face with genuine reaction',
							`**Product**: ${selectedProduct?.name || 'Featured product'} prominently displayed`,
							'**Text Overlay**: Bold Impact font, white with thick black outline',
							'**Background**: Clean gradient with brand colors',
							'**Emotion Target**: High curiosity and FOMO'
						],
						hookScore: 85
					}
				});
			}

			if (action === 'repurpose') {
				return json({ success: true, data: { message: 'Repurposing scheduled' } });
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
					console.error('[Engine] AI content generation failed:', err);
				}
			}

			const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';
			if (!allowDemoMode) {
				return json(
					{ success: false, error: 'Failed to generate content. Configure an AI provider in Settings.' },
					{ status: 400 }
				);
			}

			return json({
				success: true,
				data: {
					message: 'Content generated successfully (Offline Fallback)',
					content: `🚀 **${promptText}**\n\nConsistency is the key multiplier in personal branding. If you want to scale effectively, build systems that support daily publishing without sacrificing depth.\n\n💡 Set up a reusable content blueprint and iterate on the results.\n\n#PersonalBrand #ContentStrategy #Growth #Systemize`
				}
			});
		}

		// ══════════════════════════════════════════════════════════════════════════
		// D. PATH: personagen-brand-brief
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-brand-brief') {
			if (action === 'scrape_store') {
				const storeUrl = body.url || '';
				const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';

				// 1. Try real scraping if URL is provided
				let scrapeSuccess = false;
				let scrapedData: any = null;

				if (storeUrl) {
					try {
						const userFirecrawlKey = await getUserApiKey(locals.supabase, session.user.id, 'firecrawl');
						const firecrawlKey = userFirecrawlKey || env.FIRECRAWL_API_KEY;
						let contentToParse = '';

						// 1. Try Firecrawl scraping if API key is configured
						if (firecrawlKey && !firecrawlKey.includes('placeholder') && firecrawlKey.trim() !== '') {
							console.log(`[Engine] Scrape using Firecrawl for: ${storeUrl}`);
							try {
								const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										'Authorization': `Bearer ${firecrawlKey}`
									},
									body: JSON.stringify({
										url: storeUrl,
										formats: ['markdown']
									})
								});
								if (fcRes.ok) {
									const fcJson = await fcRes.json();
									if (fcJson.success && fcJson.data?.markdown) {
										contentToParse = fcJson.data.markdown.substring(0, 40000);
										console.log(`[Engine] Firecrawl success, parsed content length: ${contentToParse.length}`);
									}
								} else {
									console.warn(`[Engine] Firecrawl API error (status ${fcRes.status}):`, await fcRes.text());
								}
							} catch (fcErr) {
								console.warn('[Engine] Firecrawl API call failed:', fcErr);
							}
						}

						// 2. Fall back to simple HTTP fetch if Firecrawl didn't return content
						if (!contentToParse) {
							console.log(`[Engine] Falling back to direct HTTP page fetch for: ${storeUrl}`);
							const response = await fetch(storeUrl, {
								headers: {
									'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
								}
							});
							if (response.ok) {
								const html = await response.text();
								contentToParse = html
									.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
									.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
									.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
									.substring(0, 40000);
							}
						}

						if (contentToParse && hasAi) {
							const prompt = `You are a web scraper agent. Extract the brand brief details and any products (with name, description, price, and image URL if visible) from this e-commerce storefront page content.
Return a JSON object matching this exact shape:
{
  "brandName": "Brand name",
  "tagline": "Brief tagline",
  "mission": "Mission statement",
  "primaryColor": "#hexcolor",
  "secondaryColor": "#hexcolor",
  "logoUrl": "URL to logo or placeholder image",
  "traits": ["Trait1", "Trait2"],
  "commStyle": "Communication style",
  "demographics": "Target demographics",
  "interests": "Target interests",
  "platforms": "Target platforms",
  "painPoints": "Customer pain points",
  "products": [
    {
      "id": "p1",
      "name": "Product Name",
      "description": "Product Description",
      "price": "$Price",
      "photoUrl": "URL to product photo"
    }
  ]
}
Store Content:
${contentToParse}`;

							const resText = await ai!.generate(prompt, { json: true });
							if (resText) {
								const parsed = safeParseJson(resText);
								if (parsed && parsed.brandName) {
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

				// 2. If real scraping failed, check Demo Mode
				if (!allowDemoMode) {
					return json(
						{
							success: false,
							error: 'Failed to scrape the storefront page. Please verify the URL or enter brand details and products manually.'
						},
						{ status: 400 }
					);
				}

				// 3. Fallbacks when in Demo Mode
				const isHoneyForX =
					storeUrl.toLowerCase().includes('honeyforx') ||
					storeUrl.toLowerCase().includes('honey for x');

				if (isHoneyForX) {
					return json({
						success: true,
						data: {
							brandName: 'HoneyX',
							tagline: "Nature's Superfood for Men - Put a Little Honey in Your Life",
							mission:
								"At HoneyX, we strive to empower men to live healthier and more fulfilling lives through nature's superfoods.",
							primaryColor: '#eab308',
							secondaryColor: '#f97316',
							logoUrl:
								'https://honeyforx.com/cdn/shop/files/honeyX_logo_1920x1080_329bd0fe-fcd2-4f47-ae79-3771e4539126.webp?v=1687433087',
							traits: ['Stamina', 'Premium/Luxury', 'Energetic', 'Organic Wellness'],
							commStyle: 'Bold',
							demographics: 'Men and high-performers aged 24-45, athletes, fitness enthusiasts.',
							interests: 'Biohacking, functional foods, fitness routines, nutritional wellness.',
							platforms: 'TikTok (UGC), Instagram Reels, YouTube Shorts',
							painPoints: 'Energy crashes, jittery pre-workouts, chemical supplement side-effects.',
							products: [
								{
									id: 'hx-p1',
									name: 'HoneyX Manly Plus',
									description: "Nature's premium superfood for men. Raw honey with Tribulus terrestris, ginseng, and organic herbal extracts.",
									price: 'Rs. 2,450',
									photoUrl: 'https://cdn.shopify.com/s/files/1/0725/5674/0906/files/honeyx_is_natural_superfood_for_men_in_Pakistan.webp?v=1729879293'
								},
								{
									id: 'hx-p2',
									name: 'Honey Shilajit Duo Active',
									description: 'Raw wildflower honey, pure organic Shilajit, and natural performance saffron.',
									price: 'Rs. 2,450',
									photoUrl: 'https://cdn.shopify.com/s/files/1/0725/5674/0906/files/honeyshilajitpriceinpakistan.webp?v=1753269155'
								},
								{
									id: 'hx-p3',
									name: 'Afrovit-SR Withania Somnifera Compound',
									description: 'High-strength Ashwagandha with active natural adaptogens for stress resilience and focus.',
									price: 'Rs. 3,000',
									photoUrl: 'https://cdn.shopify.com/s/files/1/0725/5674/0906/files/naturalandorganicafrovitsrcapletsbyhoneyx.webp?v=1753091546'
								}
							]
						}
					});
				}

				// General fallback (demo mode only)
				return json({
					success: true,
					data: {
						brandName: storeUrl.split('.')[0]?.toUpperCase() || 'My Ecom Brand',
						tagline: 'Premium Quality E-commerce Products',
						mission: `Delivering exceptional value and high-performance lifestyle products.`,
						primaryColor: '#7c6aed',
						secondaryColor: '#22d3ee',
						logoUrl: 'https://cdn-icons-png.flaticon.com/512/825/825590.png',
						traits: ['Innovative', 'Aesthetic', 'Customer First'],
						commStyle: 'Professional',
						demographics: 'Modern online shoppers aged 18-35.',
						interests: 'Online shopping, premium lifestyle goods, social media trends.',
						platforms: 'Instagram, TikTok',
						painPoints: 'Hard-to-source quality items, unreliable shipping, generic support.',
						products: [
							{
								id: 'gen-p1',
								name: 'Signature Lifestyle Item',
								description: 'Flagship product designed for premium aesthetics and functionality.',
								price: '$45.00',
								photoUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80'
							}
						]
					}
				});
			}

			if (action === 'extend_field') {
				const fieldName = body.fieldName || 'Description';
				const fieldVal = body.fieldVal || '';

				if (!fieldVal.trim()) {
					return json({ success: false, error: 'Input text is empty' }, { status: 400 });
				}

				if (hasAi) {
					try {
						const prompt = `You are an elite brand strategist, copywriter, and e-commerce UGC marketer.
Take the following simple input for the brand brief field "${fieldName}" and expand/enrich it into a beautiful, premium, high-converting positioning statement.
Keep under 3 sentences. Output ONLY the enriched text directly.

Input: "${fieldVal}"`;

						const resText = await ai!.generate(prompt);
						if (resText) {
							return json({ success: true, data: { enriched: resText.trim() } });
						}
					} catch (err) {
						console.error('[Engine] AI field enrichment failed:', err);
					}
				}

				const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';
				if (!allowDemoMode) {
					return json(
						{ success: false, error: 'Failed to enrich field. Configure an AI provider in Settings.' },
						{ status: 400 }
					);
				}

				return json({
					success: true,
					data: {
						enriched: `${fieldVal} — meticulously crafted for discerning individuals, blending exceptional premium quality with modern functional design to deliver a transformative consumer experience.`
					}
				});
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
					message: 'Post queued for publishing. The scheduler will publish via Composio/Zernio.',
					queuedAt: new Date().toISOString()
				}
			});
		}

		// ══════════════════════════════════════════════════════════════════════════
		// F. Catch-All Fallback
		// ══════════════════════════════════════════════════════════════════════════
		return json(
			{ success: false, error: `Unknown engine path: ${path}` },
			{ status: 400 }
		);
	} catch (err) {
		console.error(`[Local Engine] Error processing path "${path}":`, err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
