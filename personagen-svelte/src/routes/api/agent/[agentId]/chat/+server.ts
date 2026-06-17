import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';
import { createSupabaseServiceClient } from '$lib/server/supabase';
import { validateUrlForSsrf } from '$lib/server/security';

const toolsList: any[] = [
	{
		name: 'get_trends',
		description: "Get trending topics for this agent's niche from the Trend Scanner.",
		parameters: {
			type: 'OBJECT',
			properties: {
				niche: {
					type: 'STRING',
					description: 'The niche to search, e.g. "Fitness & Wellness", "Tech & AI".'
				}
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
		description:
			'Decode a competitor channel/profile content strategy using 9-layer scorecard analysis.',
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
	},
	{
		name: 'report_to_overseer',
		description:
			'Report an operational issue, bug, or blocker to the platform overseer (Hermes) for automatic ticketing and administrator review.',
		parameters: {
			type: 'OBJECT',
			properties: {
				issue: {
					type: 'STRING',
					description: 'Detailed description of the issue or blocker.'
				},
				priority: {
					type: 'STRING',
					enum: ['low', 'medium', 'high', 'urgent'],
					description: 'Urgency tier of the ticket.'
				}
			},
			required: ['issue']
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
					systemInstruction:
						'You are a professional social media trend scanner. Analyze search grounding results and provide a bulleted list of current trends.',
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
					systemInstruction:
						"You are a senior social media copywriter. Generate tailored post drafts according to each platform's character limits and best practices."
				}
			});

			const generatedText = res.text || '';
			const db = createDbService(supabase);
			const { data: postData, error: postErr } = await db.posts.create({
				user_id: userId,
				agent_id: agentId,
				content: generatedText,
				platforms: platformsList,
				status: 'draft',
				scheduled_date: null,
				scheduled_time: null,
				published_at: null
			});

			if (postErr) throw postErr;

			return {
				success: true,
				postId: postData.id,
				content: generatedText
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
			if (!(await validateUrlForSsrf(args.url))) {
				return {
					success: false,
					error: 'SSRF Warning: URL resolved to a restricted or invalid address.'
				};
			}
			try {
				const crawlRes = await fetchFn(args.url);
				if (crawlRes.ok) {
					const html = await crawlRes.text();
					pageText = html
						.replace(/<[^>]*>/g, ' ')
						.replace(/\s+/g, ' ')
						.substring(0, 3000);
				}
			} catch (crawlErr) {
				console.warn(
					'[Decoder Tool] Direct crawl failed (normal for JS-heavy or protected sites):',
					crawlErr
				);
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
					systemInstruction:
						'You are an expert content strategist. Audit the competitor data and write a structured 9-layer scorecard report.',
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
			const { error } = await supabase.from('agent_memories').insert({
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
			const { error } = await supabase.from('agents').insert({
				user_id: userId,
				name: args.name,
				handle: args.handle,
				niche: args.niche,
				soul: args.soul || 'Warm and engaging UGC creator agent.',
				status: 'active',
				supervisor_agent_id: agentId,
				managed_by_overseer: true,
				runtime_owner: 'hermes-orchestrated'
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

	if (name === 'update_agent_config') {
		try {
			let targetId = args.targetAgentId;
			if (!targetId && args.targetHandle) {
				const handleClean = args.targetHandle.replace(/^@/, '').trim().toLowerCase();
				const { data: matchedAgent, error: matchErr } = await supabase
					.from('agents')
					.select('id')
					.eq('user_id', userId)
					.or(`handle.ilike.${handleClean},handle.ilike.@${handleClean}`)
					.maybeSingle();

				if (matchErr) throw matchErr;
				if (!matchedAgent) {
					const { data: allAgents } = await supabase
						.from('agents')
						.select('id, handle')
						.eq('user_id', userId);
					
					const found = allAgents?.find((a: any) => 
						a.handle.replace(/^@/, '').trim().toLowerCase() === handleClean
					);
					if (found) {
						targetId = found.id;
					} else {
						return {
							success: false,
							error: `No agent found matching handle "${args.targetHandle}"`
						};
					}
				} else {
					targetId = matchedAgent.id;
				}
			}

			if (!targetId) {
				return {
					success: false,
					error: 'You must provide either targetAgentId or targetHandle to identify the agent.'
				};
			}

			const updateData: any = {};
			if (args.name !== undefined) updateData.name = args.name;
			if (args.handle !== undefined) updateData.handle = args.handle;
			if (args.niche !== undefined) updateData.niche = args.niche;
			if (args.soul !== undefined) updateData.soul = args.soul;
			if (args.skills !== undefined) updateData.skills = args.skills;
			if (args.tools !== undefined) updateData.tools = args.tools;
			if (args.status !== undefined) updateData.status = args.status;
			updateData.updated_at = new Date().toISOString();

			const { error: updateErr } = await supabase
				.from('agents')
				.update(updateData)
				.eq('id', targetId)
				.eq('user_id', userId);

			if (updateErr) throw updateErr;

			if (args.soul !== undefined || args.skills !== undefined || args.tools !== undefined) {
				const configUpdate: any = {};
				if (args.soul !== undefined) configUpdate.soul = args.soul;
				if (args.skills !== undefined) configUpdate.skills = args.skills;
				if (args.tools !== undefined) configUpdate.tools = args.tools;

				const { error: configErr } = await supabase
					.from('agent_configs')
					.update(configUpdate)
					.eq('agent_id', targetId)
					.eq('user_id', userId);

				if (configErr) {
					console.warn('[Update Agent Config Tool] Failed to update agent_configs:', configErr);
				}
			}

			return {
				success: true,
				message: `Successfully updated agent configuration for agent ID ${targetId}.`
			};
		} catch (err) {
			console.error('[Update Agent Config Tool] Error:', err);
			return { success: false, error: (err as Error).message };
		}
	}

	if (name === 'collaborate_with_agent') {
		try {
			const { data: initiator } = await supabase
				.from('agents')
				.select('name, handle')
				.eq('id', agentId)
				.single();

			const senderLabel = initiator
				? `${initiator.name} (@${initiator.handle})`
				: 'Hermes Overseer';

			const res = await fetchFn(`/api/agent/${args.targetAgentId}/chat`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${env.INTERNAL_API_SECRET}`
				},
				body: JSON.stringify({
					userId,
					message: `[Collaboration from ${senderLabel}]: ${args.message}`
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

	if (name === 'report_to_overseer') {
		try {
			// 1. Fetch current agent to determine who is reporting
			const { data: reporterAgent, error: fetchAgentErr } = await supabase
				.from('agents')
				.select('*')
				.eq('id', agentId)
				.single();

			if (fetchAgentErr || !reporterAgent) {
				throw new Error('Reporter agent not found: ' + (fetchAgentErr?.message || ''));
			}

			// 2. Determine overseer/supervisor agent ID
			let supervisorId = reporterAgent.supervisor_agent_id;
			if (!supervisorId) {
				// Query the database for the overseer for this user
				const { data: overseer, error: fetchOverseerErr } = await supabase
					.from('agents')
					.select('id')
					.eq('user_id', userId)
					.eq('is_overseer', true)
					.maybeSingle();
				if (!fetchOverseerErr && overseer) {
					supervisorId = overseer.id;
				}
			}

			if (!supervisorId) {
				throw new Error('No overseer agent associated with user or agent.');
			}

			// 3. Create a chat message row in the overseer's chat thread
			const { error: msgErr } = await supabase.from('chat_messages').insert({
				user_id: userId,
				agent_id: supervisorId,
				role: 'user',
				content: `[SYSTEM REPORT from ${reporterAgent.name} (@${reporterAgent.handle})]: ${args.issue}`
			});
			if (msgErr)
				console.error('[Report Overseer Tool] Error inserting alert chat message:', msgErr);

			// 4. Insert a ticket in the database backlog
			// Query current max position to place at the end of the backlog
			const { data: tickets, error: ticketListErr } = await supabase
				.from('tickets')
				.select('position')
				.order('position', { ascending: false })
				.limit(1);

			let nextPosition = 1;
			if (!ticketListErr && tickets && tickets.length > 0) {
				nextPosition = (tickets[0].position || 0) + 1;
			}

			const priorityValue = args.priority || 'medium';
			const { data: ticket, error: ticketErr } = await supabase
				.from('tickets')
				.insert({
					user_id: userId,
					title: `Fix operational issue reported by ${reporterAgent.name}`,
					description: args.issue,
					status: 'backlog',
					priority: priorityValue,
					assignee_agent_id: agentId,
					position: nextPosition
				})
				.select()
				.single();

			if (ticketErr) throw ticketErr;

			return {
				success: true,
				message: `Successfully reported issue to Hermes overseer and created ticket #${ticket.id}.`,
				ticketId: ticket.id
			};
		} catch (err) {
			console.error('[Report Overseer Tool] Error:', err);
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
export const POST: RequestHandler = async ({ params, locals, request }) => {
	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	let requestBody: any;
	try {
		requestBody = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	// 1. Determine Auth Context and select client BEFORE fetching agent from database
	const authHeader = request.headers.get('Authorization');
	const internalSecret = env.INTERNAL_API_SECRET;
	const isServiceCall = !!(
		authHeader &&
		internalSecret &&
		authHeader === `Bearer ${internalSecret}`
	);

	let supabaseClient = locals.supabase;
	let userId;

	if (isServiceCall) {
		try {
			supabaseClient = createSupabaseServiceClient();
			userId = requestBody.userId;
		} catch (err) {
			return json({ success: false, error: (err as Error).message }, { status: 500 });
		}
	} else {
		const { user } = await locals.safeGetSession();
		userId = user?.id;
	}

	// 2. Fetch agent with the resolved client
	const db = createDbService(supabaseClient);
	const { data: agent } = await db.agents.get(agentId);
	if (!agent) {
		return json({ success: false, error: 'Agent not found' }, { status: 404 });
	}

	// If service call is missing userId, fallback to the agent's owner
	if (isServiceCall && !userId) {
		userId = agent.user_id;
	}

	if (!userId) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const { message } = requestBody;

	// 3. Persist User message immediately (Layer 1) and claim it for SvelteKit
	await db.chatMessages.create({
		user_id: userId,
		agent_id: agentId,
		role: 'user',
		content: message,
		claimed_by: 'sveltekit',
		claimed_at: new Date().toISOString()
	});

	const apiKey = env.GEMINI_API_KEY;

	// In dev bypass/placeholder mode without key, we return a mock response but keep history synced
	if (!apiKey || apiKey.includes('your-gemini') || apiKey.includes('placeholder')) {
		const bypassText = `[Bypass Mode] I received: "${message}". Set a valid GEMINI_API_KEY in your .env file to enable real Gemini AI interactions.`;

		await db.chatMessages.create({
			user_id: userId,
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
			memoriesString = memories
				.map((m: any) => `- ${m.content} (importance: ${m.importance})`)
				.join('\n');
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
			description:
				'Save a core fact, preference, or instruction about the user, store, or brand to your long-term memory so you remember it in future conversations.',
			parameters: {
				type: 'OBJECT',
				properties: {
					content: { type: 'STRING', description: 'The precise fact or instruction to remember.' },
					importance: {
						type: 'INTEGER',
						description: 'Importance rating from 1 (low/trivial) to 5 (critical instruction).'
					}
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
				name: 'update_agent_config',
				description: "Update an existing creator agent's profile configuration, niche, soul/personality, or handle.",
				parameters: {
					type: 'OBJECT',
					properties: {
						targetAgentId: { type: 'STRING', description: 'The UUID of the target agent to update (optional if targetHandle is provided).' },
						targetHandle: { type: 'STRING', description: 'The social handle of the target agent, e.g. "rationocode" (optional if targetAgentId is provided).' },
						name: { type: 'STRING', description: 'New name for the creator agent.' },
						handle: { type: 'STRING', description: 'New social handle for the creator agent.' },
						niche: { type: 'STRING', description: 'New content niche, e.g. "Fitness & Wellness".' },
						soul: { type: 'STRING', description: 'New soul / personality profile of the agent.' },
						skills: { type: 'STRING', description: 'New skills / competencies list.' },
						tools: { type: 'STRING', description: 'New tools list.' },
						status: { type: 'STRING', enum: ['active', 'paused', 'pending'], description: 'New status for the agent.' }
					}
				}
			});

			localTools.push({
				name: 'collaborate_with_agent',
				description:
					'Ask another UGC creator agent on the platform a question, request a draft, or coordinate campaigns.',
				parameters: {
					type: 'OBJECT',
					properties: {
						targetAgentId: { type: 'STRING', description: 'UUID of the target creator agent.' },
						message: {
							type: 'STRING',
							description: 'The message, question, or brief to send to that agent.'
						}
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
				tools: [{ googleSearch: {} }, { functionDeclarations: localTools as any }],
				toolConfig: {
					includeServerSideToolInvocations: true
				}
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
					result = await executeTool(name, args, supabaseClient, userId, agentId, fetch, apiKey);
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
					tools: [{ googleSearch: {} }, { functionDeclarations: localTools as any }],
					toolConfig: {
						includeServerSideToolInvocations: true
					}
				}
			});
		}

		const finalText = response.text || 'I could not generate a response.';

		// 6. Persist Agent's reply and tool execution logs
		await db.chatMessages.create({
			user_id: userId,
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
