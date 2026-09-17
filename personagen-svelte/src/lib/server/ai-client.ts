/**
 * Provider-agnostic AI text generation client.
 *
 * Resolution order:
 * 1. User's OpenRouter key (from user_api_keys table)
 * 2. User's Gemini key (from user_api_keys table)
 * 3. Server-wide OPENROUTER_API_KEY env var (fallback)
 * 4. Server-wide GEMINI_API_KEY env var (fallback)
 *
 * OpenRouter uses the OpenAI-compatible /v1/chat/completions endpoint.
 * Gemini uses the @google/genai SDK.
 *
 * // ponytail: single file, no factory pattern. Upgrade path: add more providers to the switch.
 */

import { env } from '$env/dynamic/private';
import { getUserApiKey } from './user-api-keys';
import { GoogleGenAI } from '@google/genai';
import { fetchWithTimeout } from './social/http';
import { safeFetch } from './safe-fetch';

// LLM generation is slower than a provider REST ping, so it gets its own, more
// generous per-request deadline — but a deadline nonetheless. Without it a hung
// OpenRouter/Gemini socket never resolves, `pollScheduledPosts`'s `isRunning`
// flag never clears, and the ENTIRE scheduler (publish + analytics + autopilot)
// wedges silently until the process restarts.
const LLM_TIMEOUT_MS = 120_000;

/** Rejects if `p` doesn't settle within `ms` — a timeout for SDK calls with no signal. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

// Gemini model, env-overridable so it can be pinned/rolled without a code edit
// (and so it stops flip-flopping between hardcoded values). Verified 2026-07-01:
// gemini-3.5-flash is a current stable model — Google's most capable Flash tier —
// while gemini-2.5-flash is the older price/latency tier. Both clients stay in step.
const GEMINI_MODEL = env.GEMINI_MODEL || 'gemini-3.5-flash';
const OPENROUTER_GEMINI_MODEL = env.OPENROUTER_GEMINI_MODEL || 'google/gemini-3.5-flash';

export interface AiGenerateOptions {
	systemInstruction?: string;
	json?: boolean;
	/** Optional image URL — the (multimodal) model reads the image with the prompt. */
	imageUrl?: string;
	/**
	 * Called once, after a SUCCESSFUL call, with whatever the provider reported
	 * about what the request actually consumed.
	 *
	 * A callback rather than a changed return type on purpose: `generate()`
	 * resolves to a string at 29 call sites, and none of them care about tokens.
	 * The two metering wrappers are the only callers that pass this, so the
	 * measurement reaches the ledger without 29 files learning about billing.
	 * A property on the client would have been simpler and wrong — one client is
	 * shared across concurrent calls, so `lastUsage` would race.
	 */
	onUsage?: (usage: AiUsage) => void;
	/**
	 * Which STAGE of a run this call is: 'director', 'director_retry_hook',
	 * 'director_rewrite_qc', 'qc_grade', 'fit_judge', 'engine:<action>' …
	 * Per call, not per client, because one tracked client serves the director,
	 * its retries, the rewrite and the grader inside a single pack. Without it
	 * every event reads `model: gemini-3.5-flash` and nobody can say which
	 * stage is verbose or how often a retry doubled a post's LLM cost.
	 */
	stage?: string;
	/**
	 * How much the model may THINK before it answers.
	 *
	 * Gemini 3.5 Flash thinks by default, and its thinking is billed as output
	 * at the output rate. Measured 2026-09-17 on one quality-grader call through
	 * OpenRouter: 1,054 completion tokens, of which 950 were `reasoning_tokens`
	 * and ~92 were the 7-field JSON grade — 90% of the call's cost was hidden
	 * deliberation over a mechanical rubric. The same call at 'minimal' returned
	 * 148 completion tokens, 0 reasoning, a valid grade, at 18% of the price.
	 * Thinking cannot be switched off on that endpoint ("Reasoning is mandatory
	 * … cannot be disabled"), only budgeted — so this is a level, not a boolean.
	 *
	 * Unset = the provider's default, which is what every call did before this
	 * option existed. Set it per call: a rubric grade needs none of it; a script
	 * written by the director may well earn its keep.
	 */
	reasoning?: ReasoningEffort;
}

/**
 * OpenRouter's `reasoning.effort` levels, in ascending order; each is also a
 * member of the Gemini SDK's ThinkingLevel enum once upper-cased, which is how
 * the direct client sends it. (OpenRouter's 'none' is deliberately absent — the
 * Gemini endpoint rejects it, so a caller could never rely on it.)
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

/**
 * What a provider said the call cost. Every field is nullable because every
 * field is optional in practice: Gemini reports tokens and no price, OpenRouter
 * reports both, and a provider that reports neither must be distinguishable
 * from one that reported zero.
 */
export interface AiUsage {
	tokensIn: number | null;
	/** Everything billed as output — the answer AND any hidden thinking. */
	tokensOut: number | null;
	/**
	 * USD the provider itself says this request cost. OpenRouter returns this on
	 * every response and it is the only ground truth in the system — the price
	 * table is an estimate maintained by hand.
	 */
	costUsd: number | null;
	/**
	 * Of `tokensOut`, how many were the model thinking rather than answering.
	 * 0 means the provider said "none"; null means it did not say. The split is
	 * what turns "this stage emits 1,100 output tokens" into "this stage emits a
	 * 90-token answer after 1,000 tokens of deliberation" — two very different
	 * fixes.
	 */
	tokensReasoning: number | null;
}

/**
 * Google reports thinking apart from the answer (`thoughtsTokenCount` beside
 * `candidatesTokenCount`) while OpenRouter folds both into `completion_tokens`.
 * The ledger wants one meaning: tokensOut is everything billed as output.
 */
function billedOutput(answer: number | null, thoughts: number | null): number | null {
	return answer === null ? null : answer + (thoughts ?? 0);
}

/** A finite, non-negative number, or null. Providers omit, null, and stringify. */
function num(v: unknown): number | null {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Hard ceiling on an inline vision image. Gemini's own inline limit is ~20 MB;
 * anything larger is either not a photo or an attempt to make the server buffer
 * arbitrary bytes. Checked on Content-Length AND on the actual body, because
 * a hostile origin can lie about (or omit) the header.
 */
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Fetches an image URL into base64 inline data for Gemini's vision input.
 *
 * The URL is USER-SUPPLIED (`read_appearance_from_image` passes whatever the
 * client sends), so this is an SSRF surface: a plain fetch would happily pull
 * `http://supabase-kong:8000/…` or the cloud metadata endpoint from inside the
 * deployment network and hand the bytes back base64-encoded. `safeFetch`
 * validates the scheme/host, resolves once, and pins the socket to a checked
 * public IP so a DNS rebind between check and connect can't redirect it.
 *
 * Returns null (never throws) so a bad image degrades to a text-only prompt —
 * the caller reports "couldn't read the image" from the model's answer.
 * Exported for the unit test that pins this path to `safeFetch`.
 */
export async function fetchImageInlineData(
	url: string
): Promise<{ mimeType: string; data: string } | null> {
	try {
		const res = await safeFetch(url, { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) });
		if (!res.ok) return null;
		const declared = Number(res.headers.get('content-length') || 0);
		if (declared > MAX_INLINE_IMAGE_BYTES) return null;
		const mimeType = res.headers.get('content-type') || 'image/png';
		if (!mimeType.toLowerCase().startsWith('image/')) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.byteLength > MAX_INLINE_IMAGE_BYTES) return null;
		return { mimeType, data: buf.toString('base64') };
	} catch {
		return null;
	}
}

export interface AiClient {
	provider: 'openrouter' | 'gemini';
	/** The exact model id this client sends — recorded in the cost ledger and
	 *  echoed by generation previews, so the UI names the model that really runs. */
	model: string;
	generate(prompt: string, opts?: AiGenerateOptions): Promise<string>;
}

/**
 * Resolves the best available AI client for the given user.
 * Returns null if no provider is configured.
 */
export async function resolveAiClient(
	supabase: any,
	userId: string,
	/**
	 * Per-run model pick from the composer's Craft step. Applied ONLY to the
	 * provider this user's keys actually resolve to: the picker is filtered by
	 * provider server-side, and honouring a mismatched id here would send an
	 * OpenRouter slug to Gemini (a 404 the user waits for and pays nothing for,
	 * having already approved the run).
	 */
	modelOverride?: { provider: 'openrouter' | 'gemini'; model: string } | null
): Promise<AiClient | null> {
	const overrideFor = (p: 'openrouter' | 'gemini') =>
		modelOverride && modelOverride.provider === p ? modelOverride.model : null;

	// 1. Check user's OpenRouter key first
	const orKey = await getUserApiKey(supabase, userId, 'openrouter').catch(() => null);
	if (orKey) {
		return createOpenRouterClient(orKey, overrideFor('openrouter'));
	}

	// 2. Check user's Gemini key
	const userGeminiKey = await getUserApiKey(supabase, userId, 'gemini').catch(() => null);
	if (userGeminiKey) {
		return createGeminiClient(userGeminiKey, overrideFor('gemini'));
	}

	// 3. Fall back to server-wide env vars — OpenRouter first (matches the
	//    user-key precedence above), then Gemini. Without the OpenRouter env
	//    fallback, a server with only OPENROUTER_API_KEY set reported
	//    "No AI provider configured" even though a key existed.
	const envOrKey = env.OPENROUTER_API_KEY;
	if (envOrKey && !envOrKey.includes('placeholder') && !envOrKey.includes('your-')) {
		return createOpenRouterClient(envOrKey);
	}

	const envKey = env.GEMINI_API_KEY;
	if (envKey && !envKey.includes('placeholder') && !envKey.includes('your-gemini')) {
		return createGeminiClient(envKey);
	}

	return null;
}

function createOpenRouterClient(apiKey: string, modelOverride?: string | null): AiClient {
	return {
		provider: 'openrouter',
		model: modelOverride || OPENROUTER_GEMINI_MODEL,
		async generate(prompt: string, opts?: AiGenerateOptions): Promise<string> {
			const messages: any[] = [];
			if (opts?.systemInstruction) {
				messages.push({ role: 'system', content: opts.systemInstruction });
			}
			// Multimodal user turn when an image is supplied (OpenAI/OpenRouter shape).
			messages.push({
				role: 'user',
				content: opts?.imageUrl
					? [
							{ type: 'text', text: prompt },
							{ type: 'image_url', image_url: { url: opts.imageUrl } }
						]
					: prompt
			});

			const body: any = {
				model: OPENROUTER_GEMINI_MODEL,
				messages,
				max_tokens: 4096
			};

			if (opts?.json) {
				body.response_format = { type: 'json_object' };
			}
			// Only when asked: an absent key is the provider's default, which is the
			// behaviour every call had before the option existed.
			if (opts?.reasoning) {
				body.reasoning = { effort: opts.reasoning };
			}

			const res = await fetchWithTimeout(
				'https://openrouter.ai/api/v1/chat/completions',
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
						'HTTP-Referer': 'https://personagen.app',
						'X-Title': 'PersonaGen'
					},
					body: JSON.stringify(body)
				},
				LLM_TIMEOUT_MS
			);

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(`OpenRouter returned HTTP ${res.status}: ${errText.slice(0, 300)}`);
			}

			const data = (await res.json()) as any;
			// OpenRouter returns `usage` on every response, including a real `cost`
			// in USD. It was read and discarded here for the life of the project,
			// which is why an LLM call is billed a flat table rate whatever it used.
			opts?.onUsage?.({
				tokensIn: num(data.usage?.prompt_tokens),
				tokensOut: num(data.usage?.completion_tokens),
				costUsd: num(data.usage?.cost),
				// Inside completion_tokens already; reported so the two can be told apart.
				tokensReasoning: num(data.usage?.completion_tokens_details?.reasoning_tokens)
			});
			return data.choices?.[0]?.message?.content || '';
		}
	};
}

function createGeminiClient(apiKey: string, modelOverride?: string | null): AiClient {
	return {
		provider: 'gemini',
		model: modelOverride || GEMINI_MODEL,
		async generate(prompt: string, opts?: AiGenerateOptions): Promise<string> {
			const ai = new GoogleGenAI({ apiKey });
			const config: any = {};
			if (opts?.json) {
				config.responseMimeType = 'application/json';
			}
			if (opts?.systemInstruction) {
				config.systemInstruction = opts.systemInstruction;
			}
			// Same level the OpenRouter client sends, in the SDK's spelling.
			if (opts?.reasoning) {
				config.thinkingConfig = { thinkingLevel: opts.reasoning.toUpperCase() };
			}

			// Vision: fetch the image into inline base64 (Gemini takes no arbitrary URL).
			const parts: any[] = [{ text: prompt }];
			if (opts?.imageUrl) {
				const inline = await fetchImageInlineData(opts.imageUrl);
				if (inline) parts.unshift({ inlineData: inline });
			}

			const res = await withTimeout(
				ai.models.generateContent({
					model: GEMINI_MODEL,
					contents: [{ role: 'user', parts }],
					config
				}),
				LLM_TIMEOUT_MS,
				'Gemini generateContent'
			);

			// Gemini reports token counts but no price — costUsd stays null, which is
			// why it is nullable rather than 0. Zero would read as "this was free".
			const um = (res as unknown as { usageMetadata?: Record<string, unknown> }).usageMetadata;
			const thoughts = num(um?.thoughtsTokenCount);
			opts?.onUsage?.({
				tokensIn: num(um?.promptTokenCount),
				tokensOut: billedOutput(num(um?.candidatesTokenCount), thoughts),
				costUsd: null,
				tokensReasoning: thoughts
			});
			return res.text || '';
		}
	};
}
