import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';
import { AccountFactoryClient } from '$lib/server/account-factory';
import { getUserApiKey } from '$lib/server/user-api-keys';
import { publishPostById } from '$lib/server/scheduler';

// Helper: safe JSON parsing for Gemini response
function safeParseJson(text: string) {
	try {
		// Clean up markdown block wraps if model outputs them
		const cleaned = text
			.replace(/```json/g, '')
			.replace(/```/g, '')
			.trim();
		return JSON.parse(cleaned);
	} catch (e) {
		console.warn('[Engine] Failed to parse Gemini response as JSON:', e);
		return null;
	}
}

// Helper: Extract channel name from URL
function extractChannelName(u: string): string {
	try {
		const parsed = new URL(u);
		const path = parsed.pathname.split('/').filter(Boolean);
		return path[path.length - 1]?.replace(/^@/, '') || parsed.hostname;
	} catch {
		return u || 'Competitor Channel';
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
	const apiKey = env.GEMINI_API_KEY;
	const hasGemini = apiKey && !apiKey.includes('your-gemini') && !apiKey.includes('placeholder');

	console.log(
		`[Local Engine] Handling path "${path}" with action "${action}" (Has Gemini: ${!!hasGemini})`
	);

	try {
		// ══════════════════════════════════════════════════════════════════════════
		// A. PATH: personagen-account-factory
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-account-factory') {
			if (action === 'create_account') {
				const persona = body.persona;
				if (!persona || !persona.name) {
					return json({ success: false, error: 'Missing persona details' }, { status: 400 });
				}

				// Attempt external Account Factory only
				try {
					const factory = new AccountFactoryClient();
					const data = await factory.createAccount({
						name: persona.name,
						niche: persona.niche || 'Lifestyle',
						platform: persona.platform || 'instagram',
						personaId: persona.id || persona.agent_id || persona.agentId,
						bio: persona.bio,
						photoPath: persona.photoPath,
						isPrivate: persona.isPrivate,
						googleVoiceCreds: persona.googleVoiceCreds
					});

					return json({ success: true, data });
				} catch (factoryErr: any) {
					console.error('[Engine] Account Factory registration failed:', factoryErr?.message || factoryErr);
					return json({ success: false, error: `Account Factory failed: ${factoryErr?.message || 'Service unreachable'}` }, { status: 500 });
				}
			}

			if (action === 'check_status') {
				const accountId = body.accountId || body.account_id || body.id;
				if (!accountId) {
					return json({ success: false, error: 'Missing accountId' }, { status: 400 });
				}
				const factory = new AccountFactoryClient();
				const data = await factory.getStatus(String(accountId));
				return json({ success: true, data });
			}

			if (action === 'list_accounts') {
				const factory = new AccountFactoryClient();
				const data = await factory.listAccounts();
				return json({ success: true, data });
			}

			if (action === 'retry') {
				const accountId = body.accountId || body.account_id || body.id;
				if (!accountId) {
					return json({ success: false, error: 'Missing accountId' }, { status: 400 });
				}
				const factory = new AccountFactoryClient();
				const data = await factory.retry(String(accountId), body.fromStep || body.step);
				return json({ success: true, data });
			}

			if (action === 'refresh_session') {
				const accountId = body.accountId || body.account_id || body.id;
				if (!accountId) {
					return json({ success: false, error: 'Missing accountId' }, { status: 400 });
				}
				const factory = new AccountFactoryClient();
				const data = await factory.refreshSession(String(accountId));
				return json({ success: true, data });
			}

			if (action === 'health_check') {
				const accountId = body.accountId || body.account_id || body.id;
				if (!accountId) {
					return json({ success: false, error: 'Missing accountId' }, { status: 400 });
				}
				const factory = new AccountFactoryClient();
				const data = await factory.healthCheck(String(accountId));
				return json({ success: true, data });
			}

			return json(
				{ success: false, error: `Invalid account factory action: ${action}` },
				{ status: 400 }
			);
		}

		// ══════════════════════════════════════════════════════════════════════════
		// B. PATH: personagen-channel-decode
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-channel-decode') {
			if (action === 'decode') {
				const channelUrl = body.url || 'https://youtube.com/c/Creator';
				const platform = body.platform || 'youtube';
				const channelName = extractChannelName(channelUrl);

				if (hasGemini) {
					try {
						const ai = new GoogleGenAI({ apiKey });
						const prompt = `Perform a high-fidelity competitor strategy analysis for this social media channel:
URL: ${channelUrl}
Platform: ${platform}
Channel Name: ${channelName}

Conduct a 9-layer scorecard audit. Return a JSON object matching this exact shape:
{
  "channelName": "${channelName}",
  "platform": "${platform}",
  "overallScore": <number between 50 and 99>,
  "layers": [
    { "title": "Content DNA", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Audience Profile", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Posting Cadence", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Hook Patterns", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Visual Identity", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Engagement Mechanics", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Growth Levers", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Monetization", "score": <number>, "findings": [string, string, string, string], "confidence": <number> },
    { "title": "Replication Blueprint", "score": <number>, "findings": [string, string, string, string], "confidence": <number> }
  ]
}
Ensure findings contain high-fidelity, detailed, real-world context for this platform/channel niche. Do NOT wrap inside markdown block code, output ONLY raw valid JSON.`;

						const res = await ai.models.generateContent({
							model: 'gemini-3.5-flash',
							contents: [{ role: 'user', parts: [{ text: prompt }] }]
						});

						if (res.text) {
							const parsed = safeParseJson(res.text);
							if (parsed && parsed.layers) {
								let insertedId = undefined;
								try {
									const { data: inserted } = await db.blueprints.create({
										user_id: session.user.id,
										channel_name: parsed.channelName || channelName,
										channel_url: channelUrl,
										platform: parsed.platform || platform,
										score: Number(parsed.overallScore || parsed.score || 85),
										layers: parsed.layers || []
									});
									if (inserted) {
										insertedId = inserted.id;
									}
								} catch (dbErr) {
									console.error('[Engine] Failed to auto-save blueprint to DB:', dbErr);
								}

								return json({
									success: true,
									data: {
										...parsed,
										id: insertedId,
										isInferred: true
									}
								});
							}
						}
					} catch (geminiErr) {
						console.error(
							'[Engine] Gemini channel decode failed, falling back to mock:',
							geminiErr
						);
					}
				}

				const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';
				if (!allowDemoMode) {
					return json(
						{
							success: false,
							error: 'Failed to run competitor strategy decode. Real strategy audits require a valid GEMINI_API_KEY.'
						},
						{ status: 400 }
					);
				}

				// Mock fallback
				const mockData = {
					channelName,
					platform,
					overallScore: 86,
					layers: [
						{
							score: 90,
							title: 'Content DNA',
							findings: [
								'Primary format: vertical short-form (72% frequency)',
								'Average hook-to-hold duration is 42 seconds',
								'Content pillars balance educational topics (50%) with dynamic lifestyle (50%)',
								'Frequent pattern interrupt cuts every 2-3 seconds'
							],
							confidence: 92
						},
						{
							score: 84,
							title: 'Audience Profile',
							findings: [
								'Primary age bracket: 18-34 years old (68% total)',
								'High affinity with self-improvement and tech-adjacent topics',
								'Active hours: 8:00 AM and 6:30 PM Eastern Time',
								'Sentiment ratio: 88% positive comment feedback'
							],
							confidence: 89
						},
						{
							score: 88,
							title: 'Posting Cadence',
							findings: [
								'Upload cycle: 4-5 items per week',
								'Most optimal days: Monday, Wednesday, and Friday afternoons',
								'Consistent scheduling window maintained over past 90 days',
								'Re-sharing delay: 4 hours from Instagram to TikTok'
							],
							confidence: 91
						},
						{
							score: 92,
							title: 'Hook Patterns',
							findings: [
								'Opener strategy: curiosity questions ("Why is nobody talking about...")',
								'High-contrast visual overlay texts within the first 1.5 seconds',
								'Retention holds up to 74% at the 3-second mark',
								'Audio pacing: dramatic up-tempo soundtracks under voice'
							],
							confidence: 95
						},
						{
							score: 81,
							title: 'Visual Identity',
							findings: [
								'Branding palette: deep charcoal bases with striking neon teal highlights',
								'Text overlay font: heavy sans-serif (Inter/Montserrat Bold)',
								'Layout structure: centralized headshot framed by glowing elements',
								'Thumbnail thumb-stop rate calculated above average category benchmark'
							],
							confidence: 85
						},
						{
							score: 87,
							title: 'Engagement Mechanics',
							findings: [
								'High engagement feedback: pinned comment asking a polarizing question',
								'Prompt responses: creator likes/replies to top comments in first hour',
								'Clear bookmark triggers ("Save this video for your next session")',
								'Call to action placement: subtle midway transition'
							],
							confidence: 88
						},
						{
							score: 85,
							title: 'Growth Levers',
							findings: [
								'Cross-niche targeting: tagging rising trending audios',
								'Keyword optimization: deep search phrases incorporated in descriptions',
								'Strategic duet/stitch reactions with major channel figures',
								'Consistent month-over-month follower growth rate (+7.2%)'
							],
							confidence: 87
						},
						{
							score: 79,
							title: 'Monetization',
							findings: [
								'Core funnel: digital guide links located in the bio',
								'Occasional integrated brand sponsorships (approx 1 per month)',
								'Affiliate tracking codes highlighted inside pinned threads',
								'Estimated revenue CPM profile: $10.50 - $14.20 tier'
							],
							confidence: 80
						},
						{
							score: 89,
							title: 'Replication Blueprint',
							findings: [
								'Excellent structural blueprint clarity: 89/100',
								'Actionable start: copy hook rhythm and neon teal design highlights',
								'High ROI opportunity: vertical short-form education formats',
								'Traction expectation: positive trajectory visible within 4-6 weeks'
							],
							confidence: 90
						}
					]
				};

				let insertedId = undefined;
				try {
					const { data: inserted } = await db.blueprints.create({
						user_id: session.user.id,
						channel_name: mockData.channelName,
						channel_url: channelUrl,
						platform: mockData.platform,
						score: mockData.overallScore,
						layers: mockData.layers as any
					});
					if (inserted) {
						insertedId = inserted.id;
					}
				} catch (dbErr) {
					console.error('[Engine] Failed to auto-save mock blueprint to DB:', dbErr);
				}

				return json({
					success: true,
					data: {
						...mockData,
						id: insertedId,
						isInferred: true
					}
				});
			}

			if (action === 'analyze') {
				const channelData = body.channel_data;
				if (!channelData) {
					return json({ success: false, error: 'Missing channel_data' }, { status: 400 });
				}

				const { data: inserted, error } = await db.blueprints.create({
					user_id: session.user.id,
					channel_name: channelData.channelName || 'Competitor Channel',
					channel_url: channelData.channelUrl || null,
					platform: channelData.platform || 'youtube',
					score: Number(channelData.overallScore || channelData.score || 85),
					layers: channelData.layers || {}
				});

				if (error) {
					console.error('[Engine] Failed to save blueprint via analyze:', error);
					return json({ success: false, error: error.message }, { status: 500 });
				}

				return json({ success: true, data: inserted });
			}

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
		}

		// ══════════════════════════════════════════════════════════════════════════
		// C. PATH: personagen-content-forge
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-content-forge') {
			const topic = body.topic || 'Growing your personal brand';
			const platform = body.platforms?.[0] || 'youtube';
			const blueprintId = body.blueprint_id;
			let blueprintDetails = '';

			if (blueprintId && !blueprintId.startsWith('bp-')) {
				try {
					const { data: bp } = await db.blueprints.get(blueprintId);
					if (bp) {
						blueprintDetails = `Competitor Blueprint Context to incorporate:\n- Platform: ${bp.platform || platform}\n- Channel Name Reference: ${bp.channel_name || 'Competitor Channel'}\n`;
						if (bp.layers) {
							const layersList = Array.isArray(bp.layers) ? bp.layers : [];
							const hookFindings = layersList.find(
								(l: any) => l.title === 'Hook Patterns'
							)?.findings;
							const dnaFindings = layersList.find((l: any) => l.title === 'Content DNA')?.findings;
							const replicationFindings = layersList.find(
								(l: any) => l.title === 'Replication Blueprint'
							)?.findings;

							if (hookFindings && hookFindings.length > 0) {
								blueprintDetails += `- Hook style constraints:\n  * ${hookFindings.join('\n  * ')}\n`;
							}
							if (dnaFindings && dnaFindings.length > 0) {
								blueprintDetails += `- Content structure constraints:\n  * ${dnaFindings.join('\n  * ')}\n`;
							}
							if (replicationFindings && replicationFindings.length > 0) {
								blueprintDetails += `- Style replication guidelines:\n  * ${replicationFindings.join('\n  * ')}\n`;
							}
						}
					}
				} catch (err) {
					console.warn('[Engine] Failed to load blueprint for prompt enrichment:', err);
				}
			}

			if (action === 'generate') {
				// Generate Post
				if (hasGemini) {
					try {
						const ai = new GoogleGenAI({ apiKey });
						const prompt = `Write a ready-to-publish social media post for ${platform}.
Topic: "${topic}"
${blueprintDetails ? `Please align this post's hook, tone, and formatting style with the following competitor blueprint details:\n${blueprintDetails}\n` : ''}
Make it highly engaging, include a killer hook, spaced body paragraphs, emojis, a call to action, and 5 hashtags.
Return a JSON object in this exact format:
{
  "type": "post",
  "platform": "${platform}",
  "content": "the body text of the post with emojis and spacing",
  "hashtags": ["#tag1", "#tag2", ...],
  "hookScore": <number between 70 and 99>,
  "estimatedReach": "10K - 25K"
}`;
						const res = await ai.models.generateContent({
							model: 'gemini-3.5-flash',
							contents: [{ role: 'user', parts: [{ text: prompt }] }]
						});
						if (res.text) {
							const parsed = safeParseJson(res.text);
							if (parsed && parsed.content) {
								return json({ success: true, data: parsed });
							}
						}
					} catch (err) {
						console.error('[Engine] Gemini generate post failed:', err);
					}
				}

				// Fallback
				return json({
					success: true,
					data: {
						type: 'post',
						platform,
						content: `🔥 ${topic}\n\nMost content creators struggle because they lack a clear blueprint.\n\nHere is how the top 1% manage their strategy:\n\n1️⃣ **Process over Output**: Systems always beat raw motivation.\n2️⃣ **Aggressive Hooking**: Grab attention in the first 2 seconds.\n3️⃣ **Niche Mastery**: Speak deeply to one person rather than broadly to everyone.\n\nWhich of these are you focusing on today? 👇`,
						hashtags: [
							'#CreatorEconomy',
							'#SocialMedia',
							'#PersonalBrand',
							'#GrowthHacks',
							'#PersonaGen'
						],
						hookScore: 88,
						estimatedReach: '11.5K - 24.2K'
					}
				});
			}

			if (action === 'script') {
				// Generate Script
				if (hasGemini) {
					try {
						const ai = new GoogleGenAI({ apiKey });
						const prompt = `Write a detailed 60-second video script for platform ${platform} on topic: "${topic}".
${blueprintDetails ? `Please align this script's visual identity, pacing, and hooks with the following competitor blueprint details:\n${blueprintDetails}\n` : ''}
Include [Scene Direction], [Visual Cues], and voiceover content.
Return a JSON object in this exact format:
{
  "type": "script",
  "platform": "${platform}",
  "content": "the formatted script content",
  "hashtags": ["#tag1", "#tag2"],
  "hookScore": <number between 70 and 99>,
  "estimatedReach": "15K - 35K"
}`;
						const res = await ai.models.generateContent({
							model: 'gemini-3.5-flash',
							contents: [{ role: 'user', parts: [{ text: prompt }] }]
						});
						if (res.text) {
							const parsed = safeParseJson(res.text);
							if (parsed && parsed.content) {
								return json({ success: true, data: parsed });
							}
						}
					} catch (err) {
						console.error('[Engine] Gemini script forge failed:', err);
					}
				}

				// Fallback
				return json({
					success: true,
					data: {
						type: 'script',
						platform,
						content: `[SCENE DIRECTION: Close-up on speaker, animated expression]\n"I decoded the exact blueprint for this topic: ${topic}."\n\n[VISUAL: Text pop-up overlay: ${topic}]\n"Here is the single mistake 99% of creators make: they do not capture attention fast enough. To change this, follow this three-part blueprint..."`,
						hashtags: ['#VideoScript', '#ContentForge', '#CreatorGrowth'],
						hookScore: 93,
						estimatedReach: '14.8K - 38.6K'
					}
				});
			}

			if (action === 'titles') {
				// Brainstorm Titles
				if (hasGemini) {
					try {
						const ai = new GoogleGenAI({ apiKey });
						const prompt = `Generate 8 highly viral, click-worthy titles/hooks for a video about: "${topic}".
${blueprintDetails ? `Please write these titles/hooks mimicking the style patterns found in the following competitor blueprint details:\n${blueprintDetails}\n` : ''}
Return a JSON object in this exact format:
{
  "type": "titles",
  "platform": "${platform}",
  "content": "",
  "hashtags": [],
  "hookScore": 91,
  "estimatedReach": "N/A",
  "titles": [string, string, string, string, string, string, string, string]
}`;
						const res = await ai.models.generateContent({
							model: 'gemini-3.5-flash',
							contents: [{ role: 'user', parts: [{ text: prompt }] }]
						});
						if (res.text) {
							const parsed = safeParseJson(res.text);
							if (parsed && parsed.titles) {
								return json({ success: true, data: parsed });
							}
						}
					} catch (err) {
						console.error('[Engine] Gemini titles failed:', err);
					}
				}

				// Fallback
				return json({
					success: true,
					data: {
						type: 'titles',
						platform,
						content: '',
						hashtags: [],
						hookScore: 90,
						estimatedReach: 'N/A',
						titles: [
							`The exact strategy for ${topic} nobody talks about`,
							`Stop scrolling if you want to master ${topic}`,
							`I spent 100 hours auditing ${topic} — here is what I found`,
							`Why 99% of creators fail at ${topic}`,
							`The 3 secrets to ${topic} revealed`,
							`Before you write another post about ${topic}, watch this`,
							`The ultimate 2026 checklist for ${topic}`,
							`How to go viral with ${topic} in 3 easy steps`
						]
					}
				});
			}

			if (action === 'thumbnail_brief') {
				// Thumbnail Brief
				if (hasGemini) {
					try {
						const ai = new GoogleGenAI({ apiKey });
						const prompt = `Create a professional, graphic design brief for a YouTube/Social thumbnail for topic: "${topic}".
${blueprintDetails ? `Please align these thumbnail briefing guidelines with the visual identity and replication rules found in this competitor blueprint:\n${blueprintDetails}\n` : ''}
List 6 key visual briefing points.
Return a JSON object in this exact format:
{
  "type": "thumbnail",
  "platform": "${platform}",
  "content": "",
  "hashtags": [],
  "hookScore": 87,
  "estimatedReach": "N/A",
  "thumbnailNotes": [string, string, string, string, string, string]
}`;
						const res = await ai.models.generateContent({
							model: 'gemini-3.5-flash',
							contents: [{ role: 'user', parts: [{ text: prompt }] }]
						});
						if (res.text) {
							const parsed = safeParseJson(res.text);
							if (parsed && parsed.thumbnailNotes) {
								return json({ success: true, data: parsed });
							}
						}
					} catch (err) {
						console.error('[Engine] Gemini thumbnail brief failed:', err);
					}
				}

				// Fallback
				return json({
					success: true,
					data: {
						type: 'thumbnail',
						platform,
						content: '',
						hashtags: [],
						hookScore: 85,
						estimatedReach: 'N/A',
						thumbnailNotes: [
							'**Layout**: Split composition with face (left 50%) and text graphics (right 50%)',
							'**Expression**: Surprised/intrigued face with slight head tilt and focused look',
							'**Text Overlay**: "I DECODED IT" in bold Impact style font, white with thick black outline',
							'**Accent Elements**: Highlight badges and trending symbols colored bright teal',
							'**Background**: Clean dark slate gradient (#0d0e15 to #1a1c29) with faint grid overlay',
							'**Emotion Target**: High curiosity and FOMO — "What exactly did they find?"'
						]
					}
				});
			}

			if (action === 'repurpose') {
				return json({ success: true, data: { message: 'Repurposing scheduled' } });
			}

			if (action === 'publish_generated') {
				// Wire Content Forge output into the existing publish pipeline
				const content = body.content;
				const agentId = body.agent_id || body.agentId;
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

				// Build content object matching generate-post format
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

				// Trigger the same publish pipeline that powers generate-post
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
		}

		// ══════════════════════════════════════════════════════════════════════════
		// D. PATH: personagen-ai-generate
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-ai-generate') {
			const promptText = body.prompt || 'Writing social content';
			const personaId = body.persona_id;
			const platforms = body.platforms || ['instagram'];

			// Let's get agent context if personaId is valid
			let agentContext = 'an expert creator';
			if (personaId) {
				const { data: agent } = await db.agents.get(personaId);
				if (agent) {
					agentContext = `AI agent ${agent.name} (@${agent.handle}) working in the ${agent.niche} niche with personality: "${agent.soul}"`;
				}
			}

			if (hasGemini) {
				try {
					const ai = new GoogleGenAI({ apiKey });
					const systemPrompt = `You are ${agentContext}. Generate premium, high-converting social media copy.`;
					const prompt = `Write a ready-to-post piece of social media content for: ${platforms.join(', ')}.
Topic / Prompt: "${promptText}"
Ensure the draft captures the voice perfectly. Do not include meta text, output the completed ready-to-post draft content directly.`;

					const res = await ai.models.generateContent({
						model: 'gemini-3.5-flash',
						contents: [{ role: 'user', parts: [{ text: prompt }] }],
						config: { systemInstruction: systemPrompt }
					});

					if (res.text) {
						return json({
							success: true,
							data: {
								message: 'Content generated successfully',
								content: res.text.trim()
							}
						});
					}
				} catch (err) {
					console.error('[Engine] Gemini content generation failed:', err);
				}
			}

			const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';
			if (!allowDemoMode) {
				return json(
					{
						success: false,
						error: 'Failed to generate content. Real content generation requires a valid GEMINI_API_KEY.'
					},
					{ status: 400 }
				);
			}

			// Fallback
			return json({
				success: true,
				data: {
					message: 'Content generated successfully (Offline Fallback)',
					content: `🚀 **${promptText}**\n\nConsistency is the key multiplier in personal branding. If you want to scale effectively, build systems that support daily publishing without sacrificing depth.\n\n💡 Set up a reusable content blueprint and iterate on the results.\n\n#PersonalBrand #ContentStrategy #Growth #Systemize`
				}
			});
		}

		// ══════════════════════════════════════════════════════════════════════════
		// E. PATH: personagen-trends
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-trends') {
			const agentId = body.agentId || body.agent_id;
			if (!agentId) {
				const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';
				if (!allowDemoMode) {
					return json(
						{
							success: false,
							error: 'Missing agentId parameter. Trends analysis requires an agent context.'
						},
						{ status: 400 }
					);
				}
				// Static mock success for testing / simple calls
				return json({
					success: true,
					data: {
						message: 'Trends recalculated and matched',
						timestamp: new Date().toISOString()
					}
				});
			}

			// Get the agent's niche
			const { data: agent } = await db.agents.get(agentId);
			const niche = agent?.niche || 'Lifestyle';
			const agentName = agent?.name || 'Agent';

			let trends: any[] = [];

			if (hasGemini) {
				try {
					const ai = new GoogleGenAI({ apiKey });
					const prompt = `Generate 10 trending topics or themes relevant to the "${niche}" niche.
For each trend, specify its momentum (rising, stable, or falling), the main platform (TikTok, Instagram, YouTube, or Facebook), match score (how well it matches a creator named ${agentName} in this niche, between 60 and 99), typical hashtags, a short description, volume (e.g. "24.2K"), and growth (e.g. "+340%").

Return a JSON array where each object has this exact structure:
{
  "id": "t1",
  "name": "Trend Name",
  "momentum": "rising",
  "platform": "TikTok",
  "niche": "${niche}",
  "matchScore": 92,
  "hashtags": ["tag1", "tag2"],
  "description": "Short description of the trend",
  "volume": "24.2K",
  "growth": "+340%"
}
Ensure the output is ONLY a raw JSON array. Do not wrap in markdown code blocks.`;

					const res = await ai.models.generateContent({
						model: 'gemini-3.5-flash',
						contents: [{ role: 'user', parts: [{ text: prompt }] }]
					});

					if (res.text) {
						const parsed = safeParseJson(res.text);
						if (Array.isArray(parsed)) {
							trends = parsed.map((t, idx) => ({
								id: t.id || `t_${idx}_${Date.now()}`,
								name: t.name || 'Niche Trend',
								momentum: t.momentum || 'rising',
								platform: t.platform || 'TikTok',
								niche: t.niche || niche,
								matchScore: Number(t.matchScore || 85),
								hashtags: Array.isArray(t.hashtags) ? t.hashtags : ['trend'],
								description: t.description || 'Trending content description',
								volume: t.volume || '15K',
								growth: t.growth || '+100%'
							}));
						}
					}
				} catch (err) {
					console.error('[Engine] Gemini trends generation failed:', err);
				}
			}

			if (trends.length === 0) {
				const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';
				if (allowDemoMode) {
					// Fallback mock trends
					trends = [
						{
							topic: `Autonomous ${niche} Growth`,
							description: `Trending interest in ${niche} content creation tools and workflow automation.`,
							volume: '45K',
							growth: '+180%',
							matchScore: 95
						},
						{
							topic: `${niche} Strategy Optimization`,
							description: 'High engagement on posts dissecting campaign rhythm and audience retention.',
							volume: '22K',
							growth: '+120%',
							matchScore: 88
						}
					];
				} else {
					return json({
						success: false,
						error: 'Failed to retrieve niche trends. Real trend analysis requires a valid GEMINI_API_KEY.'
					}, { status: 400 });
				}
			}

			return json({
				success: true,
				data: {
					trends,
					message: 'Trends loaded successfully',
					timestamp: new Date().toISOString()
				}
			});
		}

		// ══════════════════════════════════════════════════════════════════════════
		// DD. PATH: personagen-brand-brief
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

						if (contentToParse && hasGemini) {
							const ai = new GoogleGenAI({ apiKey });
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

							const geminiRes = await ai.models.generateContent({
								model: 'gemini-3.5-flash',
								contents: [{ role: 'user', parts: [{ text: prompt }] }]
							});
							if (geminiRes.text) {
								const parsed = safeParseJson(geminiRes.text);
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
					return json({
						success: true,
						data: scrapedData
					});
				}

				// 2. If real scraping failed, check Demo Mode
				if (!allowDemoMode) {
					return json(
						{
							success: false,
							error: 'Failed to scrape the storefront page. Real scraping failed and demo mode is disabled. Please verify the URL or enter brand details and products manually.'
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
								"At HoneyX, we strive to empower men to live healthier and more fulfilling lives through nature's superfoods. Our proprietary formulations blend raw honey with potent organic extracts and herbs to enhance energy, strength, stamina, and daily performance.",
							primaryColor: '#eab308', // Amber/gold
							secondaryColor: '#f97316', // Vibrant orange
							logoUrl:
								'https://honeyforx.com/cdn/shop/files/honeyX_logo_1920x1080_329bd0fe-fcd2-4f47-ae79-3771e4539126.webp?v=1687433087',
							traits: ['Stamina', 'Premium/Luxury', 'Energetic', 'Organic Wellness'],
							commStyle: 'Bold',
							demographics:
								'Men and high-performers aged 24-45, athletes, fitness enthusiasts, holistic biohackers.',
							interests:
								'Biohacking, functional foods, fitness routines, high-end nutritional wellness, aesthetic vlog reviews.',
							platforms: 'TikTok (UGC), Instagram Reels, YouTube Shorts',
							painPoints:
								'Energy crashes, jittery pre-workouts, chemical supplement side-effects, boring health routines.',
							products: [
								{
									id: 'hx-p1',
									name: 'HoneyX Manly Plus',
									description:
										"Nature's premium superfood for men. An advanced blend of raw honey, Tribulus terrestris, ginseng, and organic herbal extracts designed for enhanced performance, energy, and stamina.",
									price: 'Rs. 2,450',
									photoUrl:
										'https://cdn.shopify.com/s/files/1/0725/5674/0906/files/honeyx_is_natural_superfood_for_men_in_Pakistan.webp?v=1729879293'
								},
								{
									id: 'hx-p2',
									name: 'Honey Shilajit Duo Active',
									description:
										'A premium, active fusion of raw wildflower honey, pure organic Shilajit, and natural performance saffron to optimize total body strength and vitality.',
									price: 'Rs. 2,450',
									photoUrl:
										'https://cdn.shopify.com/s/files/1/0725/5674/0906/files/honeyshilajitpriceinpakistan.webp?v=1753269155'
								},
								{
									id: 'hx-p3',
									name: 'Afrovit-SR Withania Somnifera Compound',
									description:
										'Formulated with high-strength Ashwagandha (Withania Somnifera) and active natural adaptogens to support stress resilience, mental focus, and optimal physical vigor.',
									price: 'Rs. 3,000',
									photoUrl:
										'https://cdn.shopify.com/s/files/1/0725/5674/0906/files/naturalandorganicafrovitsrcapletsbyhoneyx.webp?v=1753091546'
								}
							]
						}
					});
				}

				// General scraper fallback (only in demo mode)
				return json({
					success: true,
					data: {
						brandName: storeUrl.split('.')[0]?.toUpperCase() || 'My Ecom Brand',
						tagline: 'Premium Quality E-commerce Products',
						mission: `Delivering exceptional value and high-performance lifestyle products globally via ${storeUrl}.`,
						primaryColor: '#7c6aed',
						secondaryColor: '#22d3ee',
						logoUrl: 'https://cdn-icons-png.flaticon.com/512/825/825590.png',
						traits: ['Innovative', 'Aesthetic', 'Customer First'],
						commStyle: 'Professional',
						demographics: 'Modern online shoppers aged 18-35.',
						interests: 'Online shopping, premium lifestyle goods, social media trends.',
						platforms: 'Instagram, TikTok',
						painPoints:
							'Hard-to-source quality items, unreliable shipping, generic customer support.',
						products: [
							{
								id: 'gen-p1',
								name: 'Signature Lifestyle Item',
								description:
									'Our flagship product designed for premium aesthetics and ultimate everyday functionality.',
								price: '$45.00',
								photoUrl:
									'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80'
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

				if (hasGemini) {
					try {
						const ai = new GoogleGenAI({ apiKey });
						const prompt = `You are an elite brand strategist, copywriter, and e-commerce UGC marketer.
Take the following simple input for the brand brief field "${fieldName}" and expand/enrich it into a beautiful, premium, high-converting, and evocative brand description or positioning statement.
Ensure it is active, rich, modern, and aligned with luxury DTC trends. Keep the output under 3 sentences.

Input: "${fieldVal}"

Output ONLY the enriched expanded text directly. Do NOT include markdown code blocks, labels, or intros.`;

						const res = await ai.models.generateContent({
							model: 'gemini-3.5-flash',
							contents: [{ role: 'user', parts: [{ text: prompt }] }]
						});

						if (res.text) {
							return json({
								success: true,
								data: {
									enriched: res.text.trim()
								}
							});
						}
					} catch (err) {
						console.error('[Engine] Gemini field enrichment failed, falling back:', err);
					}
				}

				// Fallback enricher
				const allowDemoMode = env.ALLOW_DEMO_MODE === 'true';
				if (!allowDemoMode) {
					return json(
						{
							success: false,
							error: 'Failed to enrich field. Real field enrichment requires a valid GEMINI_API_KEY.'
						},
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
		// F. PATH: personagen-publish
		// ══════════════════════════════════════════════════════════════════════════
		if (path === 'personagen-publish') {
			// Queue immediate publishing. The scheduler is the only path that marks
			// posts as published because it records actual Composio outcomes.
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
					message:
						'Post queued for publishing. The scheduler will mark it published only after Composio succeeds.',
					queuedAt: new Date().toISOString()
				}
			});
		}

		// ══════════════════════════════════════════════════════════════════════════
		// G. PATH: Catch-All Fallback
		// ══════════════════════════════════════════════════════════════════════════
		return json(
			{
				success: false,
				error: `Unknown engine path: ${path}`
			},
			{ status: 400 }
		);
	} catch (err) {
		console.error(`[Local Engine] Error processing path "${path}":`, err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
