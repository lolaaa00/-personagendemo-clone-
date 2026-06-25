import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';
import { publishPostById } from '$lib/server/scheduler';

export const POST: RequestHandler = async ({ params, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agent ID' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);

	try {
		// 1. Fetch agent and verify owner
		const { data: agent, error: agentErr } = await db.agents.get(agentId);
		if (agentErr || !agent || agent.user_id !== user.id) {
			return json({ success: false, error: 'Agent not found or ownership mismatch' }, { status: 404 });
		}

		// 2. Fetch user's active social connections
		const { data: connections, error: connErr } = await locals.supabase
			.from('connections')
			.select('platform')
			.eq('agent_id', agentId)
			.eq('status', 'active');

		if (connErr || !connections || connections.length === 0) {
			return json({
				success: false,
				error: 'No active social platform connections configured. Connect an account first.'
			}, { status: 400 });
		}
		const targetPlatforms = connections.map((c: any) => c.platform);

		// 3. Retrieve user's scoped brand brief
		const { data: brandBrief } = await db.brandBriefs.get(user.id);
		let selectedProduct: any = null;
		let productDetails = '';

		if (brandBrief && brandBrief.data) {
			const b = brandBrief.data;
			if (Array.isArray(b.products) && b.products.length > 0) {
				// Prioritize products with valid photos
				selectedProduct = b.products.find((p: any) => p.photoUrl) || b.products[0];
			}
		}

		if (selectedProduct) {
			productDetails = `
Product Focus context:
Name: ${selectedProduct.name}
Price: ${selectedProduct.price || 'N/A'}
Description: ${selectedProduct.description || 'N/A'}
`;
		}

		const apiKey = env.GEMINI_API_KEY;
		if (!apiKey || apiKey.includes('your-gemini') || apiKey.includes('placeholder')) {
			return json({ success: false, error: 'Gemini API key is not configured.' }, { status: 500 });
		}

		// 4. Generate post via Gemini
		const ai = new GoogleGenAI({ apiKey });
		const systemInstruction = `You are the AI content creator agent ${agent.name} (@${agent.handle}). Your personality is: ${agent.soul}. Your writing style is: ${agent.skills}.
Generate a social media post pack containing a caption, a UGC B-roll description, and a 15s short video script.
You MUST respond with a valid JSON object ONLY. Do not write markdown fences, comments, or introductory text.

JSON schema:
{
  "text": "The ready-to-publish social media caption text (clean text only, with hooks, body, hashtags, and CTA. Do not include script text or prompt instructions in this caption)",
  "ugc_broll_prompt": "UGC video description for visual B-roll. Match the 4-layer UGC matrix: actor details, handheld camera feel (e.g. natural, real-world lighting, not staged), negative constraints, and high platform energy",
  "script": "15s Short Video Script structure (Hook in first 3s addressing pain points, script dialogue/voiceover, text-on-screen overlay, CTA)"
}
`;

		const prompt = `Generate a UGC post pack for the platform(s): ${targetPlatforms.join(', ')}.
Niche: ${agent.niche}
${productDetails ? `Focus on the following product:\n${productDetails}` : 'Focus on the brand niche.'}
${brandBrief && brandBrief.data ? `Audience demographics: ${brandBrief.data.demographics || 'N/A'}\nPain points: ${brandBrief.data.painPoints || 'N/A'}` : ''}

Provide a caption and short video layout according to the UGC prompt vault guidelines. Make the caption relatable, social-first, and ready to post. Output ONLY the JSON.`;

		const res = await ai.models.generateContent({
			model: 'gemini-3.5-flash',
			contents: [{ role: 'user', parts: [{ text: prompt }] }],
			config: {
				systemInstruction,
				responseMimeType: 'application/json'
			}
		});

		const responseText = res.text || '{}';
		let text = '';
		let ugcBroll = '';
		let script = '';

		try {
			let parsed = JSON.parse(responseText);
			// Robust parsing: check if the parsed object has a text field which is itself a JSON string
			if (parsed && typeof parsed.text === 'string' && parsed.text.trim().startsWith('{') && parsed.text.trim().endsWith('}')) {
				try {
					const nested = JSON.parse(parsed.text);
					if (nested && typeof nested === 'object') {
						parsed = { ...parsed, ...nested };
					}
				} catch (e) {
					// Ignore and fallback
				}
			}
			text = parsed.text || '';
			ugcBroll = parsed.ugc_broll_prompt || parsed.ugcPrompt || '';
			script = parsed.script || '';
		} catch (err) {
			console.error('Failed to parse Gemini UGC JSON:', err, responseText);
			text = responseText;
		}

		const contentObj = {
			text: text.trim(),
			ugc_broll_prompt: ugcBroll.trim(),
			script: script.trim(),
			media_url: selectedProduct?.photoUrl || null,
			product: selectedProduct ? {
				name: selectedProduct.name,
				price: selectedProduct.price,
				description: selectedProduct.description
			} : null
		};

		const publicationResults: Record<string, any> = {};
		for (const platform of targetPlatforms) {
			publicationResults[platform] = {
				status: 'publishing',
				started_at: new Date().toISOString()
			};
		}

		// 5. Create database post with status 'scheduled'
		const now = new Date();
		const scheduledDate = now.toISOString().split('T')[0];
		const scheduledTime = now.toTimeString().split(' ')[0];

		const { data: post, error: postErr } = await db.posts.create({
			user_id: user.id,
			agent_id: agentId,
			content: JSON.stringify(contentObj),
			platforms: targetPlatforms,
			status: 'scheduled',
			scheduled_date: scheduledDate,
			scheduled_time: scheduledTime,
			publication_results: publicationResults,
			published_at: null
		});

		if (postErr || !post) {
			throw postErr || new Error('Failed to insert generated post.');
		}

		console.log(`[Manual Generator] Created post ${post.id} with status 'publishing' for agent ${agentId}`);

		// 6. Trigger immediate isolated publishing
		const publishSuccess = await publishPostById(post.id);

		// Fetch updated status
		const { data: updatedPost } = await db.posts.get(post.id);

		return json({
			success: true,
			post: updatedPost || post,
			published: publishSuccess
		});
	} catch (err: any) {
		console.error('[Manual Generator API] Error:', err);
		return json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
	}
};
