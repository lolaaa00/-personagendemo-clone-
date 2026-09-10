/**
 * What a customer is told when a generation fails — and what they are not.
 *
 * On 2026-09-10 a real customer's post failed and the reason recorded against
 * it, verbatim, was:
 *
 *   OpenRouter returned HTTP 402: {"error":{"message":"This request requires
 *   more credits, or fewer max_tokens. You requested up to 4096 tokens, but
 *   can only afford 3709. To increase, visit
 *   https://openrouter.ai/settings/credits and upgrade to a paid account"...
 *
 * Three things wrong with that, in increasing order of seriousness. It names a
 * vendor the customer has no relationship with. It hands out a URL to OUR
 * billing account. And it says "you can only afford" to someone whose wallet
 * was full — the account that ran dry was the platform's, so the sentence
 * blames the customer for our operational failure.
 *
 * The existing client-side translator (components/feed/postDisplay.ts) already
 * caught the raw text and softened it, but softened it in the same wrong
 * direction: "The generation key ran out of credits. Top it up and try again."
 * Told to a customer, about our key, that is still the wrong person.
 *
 * So the distinction this module exists to make is WHOSE money ran out:
 *
 *   the platform's key  → this is on us, say so, and never name the vendor
 *   the customer's key  → theirs to fix, so name it and point at Settings
 *   the customer wallet → not handled here; that path returns 402 up front
 *
 * When it cannot tell, it assumes the platform's. Telling someone to go fix
 * something that was never theirs is the failure mode worth designing against.
 */

/** Raw provider text is for logs. Only `customer` is ever stored on the post. */
export interface ClassifiedFailure {
	kind:
		| 'provider_funding'
		| 'provider_auth'
		| 'rate_limited'
		| 'timeout'
		| 'content_policy'
		| 'quality_gate'
		| 'unknown';
	/** Safe to show. Names a vendor only when the key in question is the user's own. */
	customer: string;
	/** The original message, for server logs and the admin timeline. Never stored on a post. */
	internal: string;
	/** True when the cause is ours to fix, not the customer's. */
	onUs: boolean;
}

/** Anything that looks like a link, gone. A vendor's billing URL is not ours to hand out. */
function stripUrls(s: string): string {
	return s.replace(/https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim();
}

/** Dig a message out of whatever was thrown — Error, string, or nested provider JSON. */
export function rawMessage(err: unknown, depth = 0): string {
	if (depth > 4 || err == null) return '';
	if (typeof err === 'string') {
		const t = err.trim();
		if (t.startsWith('{') || t.startsWith('[')) {
			try {
				return rawMessage(JSON.parse(t), depth + 1);
			} catch {
				return t;
			}
		}
		return t;
	}
	if (err instanceof Error) return err.message;
	if (typeof err === 'object') {
		const o = err as Record<string, unknown>;
		return rawMessage(o.message ?? o.error ?? o.detail ?? o.reason ?? '', depth + 1);
	}
	return String(err);
}

/**
 * @param ownKey true when the call ran on a key the CUSTOMER supplied, so a
 *   funding or auth failure really is theirs to fix. Defaults to false: unknown
 *   means we take the blame rather than misdirect them.
 */
export function classifyFailure(err: unknown, opts?: { ownKey?: boolean }): ClassifiedFailure {
	const internal = rawMessage(err) || 'Generation failed';
	const low = internal.toLowerCase();
	const ownKey = opts?.ownKey === true;

	// The quality gate is OUR check, its wording is already written for a human,
	// and it tells the user something they can act on. Pass it through — trimmed,
	// and with any stray link removed.
	if (/quality \d|below floor|grader|rewrite/.test(low)) {
		return {
			kind: 'quality_gate',
			customer: stripUrls(internal).slice(0, 400),
			internal,
			onUs: false
		};
	}

	if (/\b402\b|requires more credits|can only afford|insufficient (?:funds|credit|balance)|out of credit|quota|upgrade to a paid/.test(low)) {
		return {
			kind: 'provider_funding',
			customer: ownKey
				? 'Your own generation key is out of credit. Top it up, or remove it in Settings to use the platform’s.'
				: 'Generation is paused — the platform’s generation account needs topping up. This one is on us, and nothing was taken from your wallet. It will work again shortly.',
			internal,
			onUs: !ownKey
		};
	}

	if (/invalid.*key|unauthor|forbidden|\b401\b|\b403\b|api key/.test(low)) {
		return {
			kind: 'provider_auth',
			customer: ownKey
				? 'Your generation key was rejected. Check it in Settings.'
				: 'The platform’s generation key was rejected. This one is on us — nothing was taken from your wallet.',
			internal,
			onUs: !ownKey
		};
	}

	if (/rate.?limit|too many requests|\b429\b/.test(low)) {
		return {
			kind: 'rate_limited',
			customer: 'The generation provider is rate-limiting us right now. Try again in a few minutes.',
			internal,
			onUs: true
		};
	}

	if (/timeout|timed out|deadline|took too long|abort/.test(low)) {
		return {
			kind: 'timeout',
			customer: 'The model took too long and the run was stopped. Try again.',
			internal,
			onUs: false
		};
	}

	if (/content policy|safety|nsfw|flagged|moderat|blocked/.test(low)) {
		return {
			kind: 'content_policy',
			customer: 'Blocked by the model’s content policy. Adjust the prompt and try again.',
			internal,
			onUs: false
		};
	}

	return {
		kind: 'unknown',
		// Deliberately generic. An unrecognised provider string is exactly the
		// shape that leaked a vendor URL, so it never reaches the customer.
		customer: 'Generation failed. The details are logged and nothing was taken from your wallet.',
		internal,
		onUs: true
	};
}

/** The one line that may be written onto a post row. */
export function customerFailureText(err: unknown, opts?: { ownKey?: boolean }): string {
	return classifyFailure(err, opts).customer;
}
