/**
 * Provider-agnostic AI text generation client.
 *
 * Resolution order:
 * 1. User's OpenRouter key (from user_api_keys table)
 * 2. User's Gemini key (from user_api_keys table)
 * 3. Server-wide GEMINI_API_KEY env var (fallback)
 *
 * OpenRouter uses the OpenAI-compatible /v1/chat/completions endpoint.
 * Gemini uses the @google/genai SDK.
 *
 * // ponytail: single file, no factory pattern. Upgrade path: add more providers to the switch.
 */

import { env } from '$env/dynamic/private';
import { getUserApiKey, type UserKeyProvider } from './user-api-keys';
import { GoogleGenAI } from '@google/genai';

export interface AiGenerateOptions {
	systemInstruction?: string;
	json?: boolean;
}

export interface AiClient {
	provider: 'openrouter' | 'gemini';
	generate(prompt: string, opts?: AiGenerateOptions): Promise<string>;
}

/**
 * Resolves the best available AI client for the given user.
 * Returns null if no provider is configured.
 */
export async function resolveAiClient(
	supabase: any,
	userId: string
): Promise<AiClient | null> {
	// 1. Check user's OpenRouter key first
	const orKey = await getUserApiKey(supabase, userId, 'openrouter').catch(() => null);
	if (orKey) {
		return createOpenRouterClient(orKey);
	}

	// 2. Check user's Gemini key
	const userGeminiKey = await getUserApiKey(supabase, userId, 'gemini').catch(() => null);
	if (userGeminiKey) {
		return createGeminiClient(userGeminiKey);
	}

	// 3. Fall back to server-wide env var
	const envKey = env.GEMINI_API_KEY;
	if (envKey && !envKey.includes('placeholder') && !envKey.includes('your-gemini')) {
		return createGeminiClient(envKey);
	}

	return null;
}

function createOpenRouterClient(apiKey: string): AiClient {
	return {
		provider: 'openrouter',
		async generate(prompt: string, opts?: AiGenerateOptions): Promise<string> {
			const messages: any[] = [];
			if (opts?.systemInstruction) {
				messages.push({ role: 'system', content: opts.systemInstruction });
			}
			messages.push({ role: 'user', content: prompt });

			const body: any = {
				model: 'google/gemini-2.5-flash',
				messages,
				max_tokens: 4096
			};

			if (opts?.json) {
				body.response_format = { type: 'json_object' };
			}

			const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://personagen.app',
					'X-Title': 'PersonaGen'
				},
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(`OpenRouter returned HTTP ${res.status}: ${errText.slice(0, 300)}`);
			}

			const data = (await res.json()) as any;
			return data.choices?.[0]?.message?.content || '';
		}
	};
}

function createGeminiClient(apiKey: string): AiClient {
	return {
		provider: 'gemini',
		async generate(prompt: string, opts?: AiGenerateOptions): Promise<string> {
			const ai = new GoogleGenAI({ apiKey });
			const config: any = {};
			if (opts?.json) {
				config.responseMimeType = 'application/json';
			}
			if (opts?.systemInstruction) {
				config.systemInstruction = opts.systemInstruction;
			}

			const res = await ai.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				config
			});

			return res.text || '';
		}
	};
}
