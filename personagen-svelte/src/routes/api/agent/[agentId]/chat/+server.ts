import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';

const toolsList: any[] = [
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

async function executeTool(
	name: string,
	args: any,
	supabase: any,
	userId: string,
	agentId: string,
	fetchFn: typeof fetch,
	apiKey: string
) {
	if (name === 'get_trends') {
		try {
			const ai = new GoogleGenAI({ apiKey });
			const prompt = `Search the web for current social media trends, viral topics, or news related to the niche: "${args.niche || 'Fitness & Wellness'}".
Specify target markets, popular tags, and what is currently trending today. Make it actionable for a content creator.`;

			const res = await ai.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				config: {
					systemInstruction: "You are a professional social media trend scanner. Analyze search grounding results and provide a bulleted list of current trends.",
					tools: [{ googleSearch: {} }]
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
					tools: [{ googleSearch: {} }]
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

	if (name === 'save_memory') {
		try {
			const { error } = await supabase
				.from('agent_memories')
				.insert({
					user_id: userId,
					agent_id: agentId,
					content: args.content,
					importance: args.importance || 1,
					memory_type: 'fact'
				});
			if (error) throw error;
			return {
				success: true,
				message: `Successfully saved memory: "${args.content}"`
			};
		} catch (err) {
			console.error('[Save Memory Tool] Error:', err);
			return { success: false, error: (err as Error).message };
		}
	}

	if (name === 'create_new_agent') {
		try {
			const { error } = await supabase
				.from('agents')
				.insert({
					user_id: userId,
					name: args.name,
					handle: args.handle,
					niche: args.niche,
					soul: args.soul || 'Warm and engaging UGC creator agent.',
					status: 'active'
				});
			if (error) throw error;
			return {
				success: true,
				message: `Successfully created agent ${args.name} (@${args.handle})`
			};
		} catch (err) {
			console.error('[Create Agent Tool] Error:', err);
			return { success: false, error: (err as Error).message };
		}
	}

	if (name === 'collaborate_with_agent') {
		try {
			const res = await fetchFn(`/api/agent/${args.targetAgentId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: args.message,
					history: []
				})
			});
			const data = await res.json();
			if (res.ok && data.success) {
				return {
					success: true,
					agentResponse: data.response
				};
			} else {
				return {
					success: false,
					error: data.error || 'Failed to communicate with agent.'
				};
			}
		} catch (err) {
			console.error('[Collaborate Tool] Error:', err);
			return { success: false, error: (err as Error).message };
		}
	}

	throw new Error(`Tool not found: ${name}`);
}

// ─────────────────────────────────────────────
// GET: Retrieve persistent sync chat history (Layer 1)
// ─────────────────────────────────────────────
export const GET: RequestHandler = async ({ params, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	try {
		const { data: messages, error } = await db.chatMessages.listForAgent(agentId);
		if (error) throw error;
		return json({ success: true, messages });
	} catch (err) {
		console.error('[Agent API] Error listing messages:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

// ─────────────────────────────────────────────
// DELETE: Wipe chat history for an agent
// ─────────────────────────────────────────────
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	try {
		const { error } = await db.chatMessages.deleteForAgent(agentId);
		if (error) throw error;
		return json({ success: true });
	} catch (err) {
		console.error('[Agent API] Error clearing messages:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

// ─────────────────────────────────────────────
// POST: Process standard message chat turn
// ─────────────────────────────────────────────
export const POST: RequestHandler = async ({ params, request, locals, fetch }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	const { data: agent } = await db.agents.get(agentId);
	if (!agent) {
		return json({ success: false, error: 'Agent not found' }, { status: 404 });
	}

	const { message } = (await request.json()) as any;

	// 1. Persist User message immediately (Layer 1)
	await db.chatMessages.create({
		user_id: user.id,
		agent_id: agentId,
		role: 'user',
		content: message
	});

	const apiKey = env.GEMINI_API_KEY;

	// In dev bypass/placeholder mode without key, we return a mock response but keep history synced
	if (!apiKey || apiKey.includes('your-gemini') || apiKey.includes('placeholder')) {
		const bypassText = `[Bypass Mode] I received: "${message}". Set a valid GEMINI_API_KEY in your .env file to enable real Gemini AI interactions.`;
		
		await db.chatMessages.create({
			user_id: user.id,
			agent_id: agentId,
			role: 'model',
			content: bypassText
		});

		return json({
			success: true,
			response: bypassText,
			toolCalls: []
		});
	}

	try {
		// 2. Load persistent LTM memories (Layer 2)
		const { data: memories } = await db.agentMemories.listForAgent(agentId);
		let memoriesString = '';
		if (memories && memories.length > 0) {
			memoriesString = memories.map((m: any) => `- ${m.content} (importance: ${m.importance})`).join('\n');
		}

		// 3. Assemble System Prompt with dynamic role & memory context
		const systemPrompt = `
You are ${agent.name} (@${agent.handle}), an AI content creator in the ${agent.niche} niche.
${agent.is_overseer ? `\n## IMPORTANT ROLE\nYou are the platform's Chief Operational Overseer, Hermes. You have administrative tools to coordinate other agents, create agents, and retrieve system analytics.\n` : ''}

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

${memoriesString ? `\n## Your Memories (Persisted Facts)\n${memoriesString}\n` : ''}

You have access to tools for generating content drafts, reading market trends, decoding competitor profiles, listing posts, and long-term memory operations.
Always stay in character. If you execute a tool, explain the outcome in character.
`;

		// 4. Retrieve sliding context window (Layer 3 - last 15 messages)
		const { data: historyMessages } = await db.chatMessages.listForAgent(agentId);
		const slidingHistory = (historyMessages || []).slice(-15);

		// Format messages for Gemini API
		const geminiMessages: any[] = [];
		for (const msg of slidingHistory) {
			geminiMessages.push({
				role: msg.role === 'user' ? 'user' : 'model',
				parts: [{ text: msg.content }]
			});
		}

		// 5. Declare tools list (inject self-memory and Hermes tools on demand)
		const localTools = [...toolsList];
		localTools.push({
			name: 'save_memory',
			description: 'Save a core fact, preference, or instruction about the user, store, or brand to your long-term memory so you remember it in future conversations.',
			parameters: {
				type: 'OBJECT',
				properties: {
					content: { type: 'STRING', description: 'The precise fact or instruction to remember.' },
					importance: { type: 'INTEGER', description: 'Importance rating from 1 (low/trivial) to 5 (critical instruction).' }
				},
				required: ['content']
			}
		});

		if (agent.is_overseer) {
			localTools.push({
				name: 'create_new_agent',
				description: 'Create and provision a new UGC creator agent on the platform.',
				parameters: {
					type: 'OBJECT',
					properties: {
						name: { type: 'STRING', description: 'Name of the creator, e.g. "Olivia".' },
						handle: { type: 'STRING', description: 'Unique social handle, e.g. "olivia_fit".' },
						niche: { type: 'STRING', description: 'The content niche, e.g. "Fitness & Yoga".' },
						soul: { type: 'STRING', description: 'Personality profile or prompt of the agent.' }
					},
					required: ['name', 'handle', 'niche']
				}
			});

			localTools.push({
				name: 'collaborate_with_agent',
				description: 'Ask another UGC creator agent on the platform a question, request a draft, or coordinate campaigns.',
				parameters: {
					type: 'OBJECT',
					properties: {
						targetAgentId: { type: 'STRING', description: 'UUID of the target creator agent.' },
						message: { type: 'STRING', description: 'The message, question, or brief to send to that agent.' }
					},
					required: ['targetAgentId', 'message']
				}
			});
		}

		const ai = new GoogleGenAI({ apiKey });
		let currentMessages = [...geminiMessages];

		let response = await ai.models.generateContent({
			model: 'gemini-3.5-flash',
			contents: currentMessages,
			config: {
				systemInstruction: systemPrompt,
				tools: [
					{ googleSearch: {} },
					{ functionDeclarations: localTools as any }
				]
			}
		});

		const toolCallsExecuted: any[] = [];

		// Run tool execution loop up to 3 turns
		for (let i = 0; i < 3; i++) {
			const candidate = response.candidates?.[0];
			if (!candidate || !candidate.content) break;
			const parts = candidate.content.parts || [];
			const functionCalls = parts.filter((p: any) => p.functionCall);

			if (functionCalls.length === 0) break;

			currentMessages.push(candidate.content);
			const functionResponses: any[] = [];

			for (const call of functionCalls) {
				if (!call.functionCall || !call.functionCall.name) continue;
				const name = call.functionCall.name;
				const args = call.functionCall.args;
				console.log(`[Gemini Agent] Executing tool call: ${name} with args:`, args);

				let result;
				try {
					result = await executeTool(name, args, locals.supabase, user.id, agentId, fetch, apiKey);
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

			currentMessages.push({
				role: 'user',
				parts: functionResponses
			});

			response = await ai.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: currentMessages,
				config: {
					systemInstruction: systemPrompt,
					tools: [
						{ googleSearch: {} },
						{ functionDeclarations: localTools as any }
					]
				}
			});
		}

		const finalText = response.text || 'I could not generate a response.';

		// 6. Persist Agent's reply and tool execution logs
		await db.chatMessages.create({
			user_id: user.id,
			agent_id: agentId,
			role: 'model',
			content: finalText,
			tool_calls: toolCallsExecuted
		});

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
