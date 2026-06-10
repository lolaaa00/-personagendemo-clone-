import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createDbService } from '$lib/server/db';

const toolsList = [
	{
		name: 'get_trends',
		description: 'Get trending topics for this agent\'s niche from the Trend Scanner.',
		parameters: {
			type: 'OBJECT',
			properties: {
				niche: { type: 'STRING', description: 'The niche to search, e.g. "Fitness & Wellness", "Tech & AI".' }
			},
			required: ['niche']
		}
	},
	{
		name: 'generate_content',
		description: 'Generate social media post content draft for a prompt and target platforms.',
		parameters: {
			type: 'OBJECT',
			properties: {
				prompt: { type: 'STRING', description: 'What the post should be about.' },
				platforms: {
					type: 'ARRAY',
					items: { type: 'STRING' },
					description: 'Target platforms, e.g. ["instagram", "tiktok", "youtube", "x"].'
				}
			},
			required: ['prompt', 'platforms']
		}
	},
	{
		name: 'decode_channel',
		description: 'Decode a competitor channel/profile content strategy using 9-layer scorecard analysis.',
		parameters: {
			type: 'OBJECT',
			properties: {
				url: { type: 'STRING', description: 'URL of the channel to decode.' },
				platform: { type: 'STRING', description: 'Platform name (tiktok, instagram, youtube).' }
			},
			required: ['url', 'platform']
		}
	},
	{
		name: 'list_recent_posts',
		description: 'List recent content calendar posts from the database.',
		parameters: {
			type: 'OBJECT',
			properties: {
				limit: { type: 'INTEGER', description: 'Maximum number of posts to return.' }
			}
		}
	}
];

async function executeTool(name: string, args: any, supabase: any, userId: string, agentId: string, fetchFn: typeof fetch, apiKey: string) {
	if (name === 'get_trends') {
		// Use local Gemini Search Grounding or Google Search via Gemini to fetch real-time trends
		try {
			const ai = new GoogleGenAI({ apiKey });
			const prompt = `Search the web for current social media trends, viral topics, or news related to the niche: "${args.niche || 'Fitness & Wellness'}".
Specify target markets, popular tags, and what is currently trending today. Make it actionable for a content creator.`;

			const res = await ai.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				config: {
					systemInstruction: "You are a professional social media trend scanner. Analyze search grounding results and provide a bulleted list of current trends.",
					tools: [{ googleSearch: {} }] // Natively use Google Search grounding inside the tool!
				}
			});

			return {
				success: true,
				trends: res.text || 'No trends identified.'
			};
		} catch (err) {
			console.error('[Trends Tool] Error fetching trends natively:', err);
			return { success: false, error: (err as Error).message };
		}
	}

	if (name === 'generate_content') {
		try {
			const ai = new GoogleGenAI({ apiKey });
			const platformsList = args.platforms || ['instagram'];
			const prompt = `Generate a high-converting social media post draft for the platform(s): ${platformsList.join(', ')}.
Niche: ${args.niche || 'General'}
Topic / Prompt: "${args.prompt}"

Write a ready-to-publish draft for each platform (Instagram, Facebook, YouTube, TikTok) with appropriate characters, hooks, CTAs, and hashtags.`;

			const res = await ai.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				config: {
					systemInstruction: "You are a senior social media copywriter. Generate tailored post drafts according to each platform's character limits and best practices."
				}
			});

			return {
				success: true,
				content: res.text || 'Failed to generate content'
			};
		} catch (err) {
			console.error('[Generate Content Tool] Error:', err);
			return { success: false, error: (err as Error).message };
		}
	}

	if (name === 'decode_channel') {
		try {
			const ai = new GoogleGenAI({ apiKey });
			let pageText = '';
			try {
				// Try a direct server-side crawl of the target profile
				const crawlRes = await fetchFn(args.url);
				if (crawlRes.ok) {
					const html = await crawlRes.text();
					pageText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 3000);
				}
			} catch (crawlErr) {
				console.warn('[Decoder Tool] Direct crawl failed (normal for JS-heavy or protected sites):', crawlErr);
			}

			const prompt = `Perform a competitor content strategy analysis for this channel URL:
URL: ${args.url}
Platform: ${args.platform}
Crawl Data (if available): ${pageText || 'None'}

Conduct a 9-layer scorecard audit (1-100 score, Hook structures, Visual DNA, Rhythm, Target audience, Content gaps, Monetization, and Actionable takeaways).`;

			const res = await ai.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				config: {
					systemInstruction: "You are an expert content strategist. Audit the competitor data and write a structured 9-layer scorecard report.",
					tools: [{ googleSearch: {} }] // Let Gemini search the web for the competitor profile to complement analysis!
				}
			});

			return {
				success: true,
				analysis: res.text || 'Failed to analyze channel.'
			};
		} catch (err) {
			console.error('[Decode Channel Tool] Error:', err);
			return { success: false, error: (err as Error).message };
		}
	}

	if (name === 'list_recent_posts') {
		const { data, error } = await supabase
			.from('posts')
			.select('*')
			.eq('agent_id', agentId)
			.order('created_at', { ascending: false })
			.limit(args.limit || 5);

		if (error) throw error;
		return data;
	}

	throw new Error(`Tool not found: ${name}`);
}

export const POST: RequestHandler = async ({ params, request, locals, fetch }) => {
	const { session, user } = await locals.safeGetSession();
	const apiKey = env.GEMINI_API_KEY;

	// In dev bypass/placeholder mode without key, we return a mock chatbot response
	if (!apiKey || apiKey.includes('your-gemini') || apiKey.includes('placeholder')) {
		const { message } = await request.json() as any;
		return json({
			success: true,
			response: `[Bypass Mode] I received: "${message}". Set a valid GEMINI_API_KEY in your .env file to enable real Gemini AI interactions.`,
			toolCalls: []
		});
	}

	const { message, history } = await request.json() as any;
	const agentId = params.agentId;

	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	const { data: agent } = await db.agents.get(agentId);

	if (!agent) {
		return json({ success: false, error: 'Agent not found' }, { status: 404 });
	}

	const systemPrompt = `
You are ${agent.name} (@${agent.handle}), an AI content creator in the ${agent.niche} niche.

## Your Soul (Personality & Directives)
${agent.soul || 'Warm and professional.'}

## Your Skills
${agent.skills || 'Content writing, post scheduling.'}

## Your Tools
${agent.tools || 'None.'}

## Your Heartbeat (Posting Schedule)
${agent.heartbeat || 'Posting daily.'}

## Your Market
${agent.market || 'Australia'}

You have access to tools for generating content drafts, reading market trends, decoding competitor profiles, and listing posts.
Always stay in character. If you execute a tool, explain the outcome in character.
`;

	try {
		const ai = new GoogleGenAI({ apiKey });

		// Map message history to Gemini format: [{ role: 'user' | 'model', parts: [{ text: string }] }]
		const geminiMessages: any[] = [];

		if (history && history.length > 0) {
			for (const msg of history) {
				geminiMessages.push({
					role: msg.role === 'user' ? 'user' : 'model',
					parts: [{ text: msg.content }]
				});
			}
		}

		// Add current message
		geminiMessages.push({
			role: 'user',
			parts: [{ text: message }]
		});

		let currentMessages = [...geminiMessages];
		let response = await ai.models.generateContent({
			model: 'gemini-3.5-flash',
			contents: currentMessages,
			config: {
				systemInstruction: systemPrompt,
				tools: [
					{ googleSearch: {} }, // Enable real-time Google Search grounding natively!
					{ functionDeclarations: toolsList as any }
				]
			}
		});

		const toolCallsExecuted: any[] = [];

		// Run tool loop up to 3 times
		for (let i = 0; i < 3; i++) {
			const candidate = response.candidates?.[0];
			if (!candidate || !candidate.content) break;
			const parts = candidate.content.parts || [];
			const functionCalls = parts.filter((p: any) => p.functionCall);

			if (functionCalls.length === 0) break;

			// Add Gemini model output with function calls to the history
			currentMessages.push(candidate.content);

			const functionResponses: any[] = [];

			for (const call of functionCalls) {
				if (!call.functionCall || !call.functionCall.name) continue;
				const name = call.functionCall.name;
				const args = call.functionCall.args;
				console.log(`[Gemini Agent] Executing tool call: ${name} with args:`, args);

				let result;
				try {
					result = await executeTool(name, args, locals.supabase, user?.id || '', agentId as string, fetch, apiKey);
					toolCallsExecuted.push({
						id: Math.random().toString(36).substring(7),
						name,
						args,
						result,
						status: 'completed'
					});
				} catch (e) {
					console.error(`[Gemini Agent] Tool execution error for ${name}:`, e);
					result = { success: false, error: (e as Error).message };
					toolCallsExecuted.push({
						id: Math.random().toString(36).substring(7),
						name,
						args,
						result,
						status: 'failed'
					});
				}

				functionResponses.push({
					functionResponse: {
						name,
						response: { result }
					}
				});
			}

			// Add function responses to history
			currentMessages.push({
				role: 'user',
				parts: functionResponses
			});

			// Get next model response
			response = await ai.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: currentMessages,
				config: {
					systemInstruction: systemPrompt,
					tools: [
						{ googleSearch: {} },
						{ functionDeclarations: toolsList as any }
					]
				}
			});
		}

		const finalText = response.text || 'I could not generate a response.';

		return json({
			success: true,
			response: finalText,
			toolCalls: toolCallsExecuted
		});
	} catch (err) {
		console.error('[Gemini Agent API] Chat error:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
