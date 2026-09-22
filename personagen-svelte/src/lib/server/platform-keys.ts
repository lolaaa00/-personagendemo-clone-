/**
 * Which platform provider keys are configured, and whether each one is working.
 *
 * Customer BYOK was withdrawn from every generation provider on 2026-09-21
 * (providers.ts), so from that day every generation for every customer runs on
 * OUR keys. That removed the confusion it was meant to remove and concentrated
 * all the risk in one place: a key that is missing, revoked or unfunded is now
 * an outage for everyone rather than for the subset who had not brought their
 * own.
 *
 * Before this file nothing in the product could answer "is FAL_API_KEY even
 * set here?" without shelling into the container. An operator found out the way
 * they found out about the OpenRouter balance in September — from a customer's
 * failed post.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *
 *   - It never reads, returns, logs or masks a key VALUE. `configured` is a
 *     boolean derived from length, nothing more. A panel that shows the first
 *     six characters of a secret is a panel that puts a secret in a screenshot.
 *   - It does not let anyone SET a key. These live in the deployment
 *     environment (EasyPanel) and changing them there is a deliberate,
 *     audited act; a text field in a web console that rewrites the platform's
 *     spending credentials is a much larger blast radius than the problem.
 *
 * So: read-only, value-free, and it answers the two questions an operator
 * actually has — is it configured, and has it worked recently.
 */

import { env } from '$env/dynamic/private';
import { PROVIDER_CATALOGUE } from '$lib/providers';

export interface PlatformKeyStatus {
	/** Catalogue id (providers.ts). */
	id: string;
	label: string;
	/** The environment variable the deployment sets. Named so an operator can go fix it. */
	envVar: string;
	/** Whether that variable is non-empty here. NEVER the value. */
	configured: boolean;
	/** The cost-event provider name, or null when this provider emits none. */
	costProvider: string | null;
	/** Last successful platform-keyed call, ISO, or null if never / not applicable. */
	lastUsedAt: string | null;
	/** Platform-keyed events in the last 30 days. */
	events30d: number;
	/**
	 * Set when something is wrong enough to act on. Null when fine.
	 * Phrased for someone who has to fix it, not for someone who wrote it.
	 */
	problem: string | null;
}

/** Catalogue id → the env var that holds the platform key for it. */
const ENV_VAR: Record<string, string> = {
	zernio: 'ZERNIO_API_KEY',
	fal_ai: 'FAL_API_KEY',
	openrouter: 'OPENROUTER_API_KEY',
	gemini: 'GEMINI_API_KEY',
	firecrawl: 'FIRECRAWL_API_KEY'
};

function isSet(name: string): boolean {
	return ((env as Record<string, string | undefined>)[name] ?? process.env[name] ?? '').trim().length > 0;
}

/**
 * Status for every provider the platform holds a key for.
 *
 * `supabase` is a service-role client: this reads across all users' events to
 * answer "has this key worked lately", which is an operator question, and the
 * route already requires a platform admin.
 */
export async function platformKeyStatuses(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase
	supabase: any
): Promise<PlatformKeyStatus[]> {
	const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

	/** provider → { last, count } over platform-keyed events in the window. */
	const usage = new Map<string, { last: string | null; count: number }>();
	try {
		const { data } = await supabase
			.from('generation_events')
			.select('provider, created_at')
			.eq('key_source', 'platform')
			.gte('created_at', since)
			.order('created_at', { ascending: false })
			.limit(5000);
		for (const row of (data ?? []) as Array<{ provider: string; created_at: string }>) {
			const cur = usage.get(row.provider);
			// Rows arrive newest-first, so the first one seen is the latest.
			if (cur) cur.count += 1;
			else usage.set(row.provider, { last: row.created_at, count: 1 });
		}
	} catch {
		/* Never-brick: an unreadable events table leaves usage empty, and every
		   entry below still reports whether its key is configured. */
	}

	return PROVIDER_CATALOGUE.filter((p) => ENV_VAR[p.id]).map((p) => {
		const envVar = ENV_VAR[p.id];
		const configured = isSet(envVar);
		const seen = p.costProvider ? usage.get(p.costProvider) : undefined;

		let problem: string | null = null;
		if (!configured) {
			problem =
				p.id === 'zernio'
					? `${envVar} is not set. Publishing falls back to each customer's own Zernio key; anyone without one cannot publish.`
					: `${envVar} is not set. Every generation that needs ${p.label} will fail — there is no customer key to fall back to any more.`;
		} else if (p.costProvider && !seen) {
			problem = `Configured, but no successful ${p.label} call in 30 days. That is expected if nothing uses it; otherwise the key may be revoked.`;
		}

		return {
			id: p.id,
			label: p.label,
			envVar,
			configured,
			costProvider: p.costProvider,
			lastUsedAt: seen?.last ?? null,
			events30d: seen?.count ?? 0,
			problem
		};
	});
}
