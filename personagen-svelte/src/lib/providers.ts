/**
 * Provider catalogue — the one description of every third-party provider the
 * product touches: what we call it, which `user_api_keys.provider` row holds a
 * customer key for it (if any), the name its cost events go by, whether that
 * spend is billed to the customer's own key, and whether a customer may bring
 * a key at ALL.
 *
 * Client-safe (no `$env/server`, no `$lib/server/*` imports) — the precedent is
 * pricing.ts — because the Settings page and the server-side gate have to read
 * the same facts. Before this file they restated them: the cost→key map in
 * credits.ts, the gated list in the Settings page, the same gated list again in
 * the api-keys route, and the CHECK enum in the database. Four lists, nothing
 * binding them, free to silently disagree.
 *
 * The fifth fact had no home at all: some providers CANNOT be BYOK'd, ever.
 * Higgsfield sells one subscription plus credits and issues no customer API
 * key. Saying that by leaving it out of a list is indistinguishable from an
 * oversight, and tells the user nothing. `byok: { supported: false, reason }`
 * says it out loud, and the Settings page renders the reason where the key
 * field would otherwise be.
 *
 * NOT catalogued: `local` (the ffmpeg card renderer) and `storage`. They are
 * not providers — no key, no vendor, nothing to bring. keySourceFor() returns
 * 'none' for every name absent here, which is exactly what they need.
 */

/** A value accepted by the `user_api_keys.provider` CHECK constraint. */
export type UserKeyProvider = 'zernio' | 'gemini' | 'openrouter' | 'firecrawl' | 'kie_ai' | 'fal_ai';

/**
 * Can a customer put their own key in?
 *
 * `supported: false` is the case that had no representation. It carries the
 * sentence the user reads, so an absence is never left to be guessed at; and
 * because the unsupported branch has no `entitlementGated` field, a provider
 * that cannot be BYOK'd can never end up on the entitlement-gated list.
 */
export type ByokPolicy =
	| {
			supported: true;
			/** Saving a key needs the `byok` plan entitlement (entitlements.ts). */
			entitlementGated: boolean;
	  }
	| {
			supported: false;
			/** One short user-facing sentence, in the voice of planRefusal(). */
			reason: string;
	  };

export interface ProviderEntry {
	/** Stable catalogue id. Equals `keyProvider` wherever a key is stored. */
	id: string;
	label: string;
	/** The `user_api_keys.provider` value, or null when no key is ever stored. */
	keyProvider: UserKeyProvider | null;
	/** The name this provider goes by in generation_events / pricing.ts, or null when it produces no cost event. */
	costProvider: string | null;
	/**
	 * True when a run stamped with `costProvider` is attributed to the
	 * customer's own key — keySourceFor() → 'byo' when a usable key is stored,
	 * 'platform' otherwise. False leaves it 'none': never billed to a key.
	 *
	 * This is a separate fact from `keyProvider`, and has to be. Zernio stores a
	 * key but bills per connected account per month, not per call, so no run is
	 * ever charged against it; Kie AI stores a key that nothing in the codebase
	 * spends yet. Both would be wrong to derive from "a key exists".
	 */
	billsToUserKey: boolean;
	byok: ByokPolicy;
}

/**
 * Why a customer can no longer bring a generation key.
 *
 * Bring your own key where the key is an IDENTITY. Never where the key is a
 * COST. Zernio is an identity: it holds the customer's own social connections,
 * it is priced per connected account per month, and no run is charged against
 * it — `billsToUserKey: false` says so. Fal, OpenRouter, Gemini and Firecrawl
 * are costs, and a key that is a cost cannot be brought without taking the
 * margin with it.
 *
 * The arithmetic is not a judgement call. At `credit_markup: 3` a BYOK run
 * forgoes exactly three times what it saves, so every such run destroys two
 * thirds of its own margin by definition of the markup. Measured on production
 * before this changed: 50 BYOK runs saved ~$0.94 of provider cost and forgave
 * 305 credits of retail — 47% of every credit ever metered — for a net of
 * −$2.11. Two accounts had ever saved a key.
 *
 * It was also incoherent to use. Nobody had ever saved a fal key, so images and
 * video always ran on the platform key and were charged, while text ran free on
 * a customer's OpenRouter key — with nothing on screen explaining the rule. A
 * wallet that moves for pictures and not for words reads as a broken wallet.
 *
 * The capability is not deleted: `billsToUserKey` and keySourceFor() still work
 * exactly as before, so a platform operator can re-open one of these by
 * restoring `supported: true` here, and historical 'byo' events stay readable.
 */
const GENERATION_KEY_REASON =
	'Generation runs on our keys so that every post is charged the same way, from your balance — bringing your own would make some posts cost credits and others nothing, with no way to tell which. Connect your own Zernio account instead: that one is yours, and it is what owns your publishing.';

/** Reading order matches the Settings page: publish, media, language, research. */
export const PROVIDER_CATALOGUE: readonly ProviderEntry[] = [
	{
		id: 'zernio',
		label: 'Zernio',
		keyProvider: 'zernio',
		costProvider: 'zernio',
		// Pay-per-connected-account per month, not per call — the publish event
		// prices at $0, so there is nothing to attribute to a key.
		billsToUserKey: false,
		// Never gated: Zernio is how EVERY plan publishes, Free included.
		byok: { supported: true, entitlementGated: false }
	},
	{
		id: 'fal_ai',
		label: 'Fal AI',
		keyProvider: 'fal_ai',
		costProvider: 'fal',
		billsToUserKey: true,
		byok: { supported: false, reason: GENERATION_KEY_REASON }
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		keyProvider: 'openrouter',
		costProvider: 'openrouter',
		billsToUserKey: true,
		byok: { supported: false, reason: GENERATION_KEY_REASON }
	},
	{
		id: 'gemini',
		label: 'Gemini',
		keyProvider: 'gemini',
		costProvider: 'gemini',
		billsToUserKey: true,
		byok: { supported: false, reason: GENERATION_KEY_REASON }
	},
	{
		id: 'firecrawl',
		label: 'Firecrawl',
		keyProvider: 'firecrawl',
		costProvider: 'firecrawl',
		billsToUserKey: true,
		byok: { supported: false, reason: GENERATION_KEY_REASON }
	},
	{
		id: 'kie_ai',
		label: 'Kie AI',
		keyProvider: 'kie_ai',
		// Nothing in the codebase calls it, so it emits no cost event and cannot
		// resolve a key source. A saved key was validated and never spent.
		costProvider: null,
		billsToUserKey: false,
		byok: {
			supported: false,
			reason:
				'Nothing in the product calls Kie AI yet, so a key saved here would sit unused. There is nothing to bring until it is wired up.'
		}
	},
	{
		id: 'higgsfield',
		label: 'Higgsfield',
		// No key is ever stored: there is no customer-issued key to store.
		keyProvider: null,
		costProvider: null,
		billsToUserKey: false,
		byok: {
			supported: false,
			reason:
				'Higgsfield does not issue customer API keys — access is one subscription plus credits, so there is no key to bring.'
		}
	}
];

/**
 * Cost-event provider name → `user_api_keys.provider`. This is what decides
 * whether a run is billed to us or to the customer's key (credits.ts →
 * keySourceFor). Anything absent resolves to 'none' and is never key-billed.
 */
export const KEYED_COST_PROVIDERS: Readonly<Record<string, UserKeyProvider>> = Object.freeze(
	Object.fromEntries(
		PROVIDER_CATALOGUE.flatMap((p) =>
			p.billsToUserKey && p.costProvider && p.keyProvider
				? ([[p.costProvider, p.keyProvider]] as Array<[string, UserKeyProvider]>)
				: []
		)
	)
);

/** Every provider a customer key can be stored for. */
export const USER_KEY_PROVIDERS: readonly UserKeyProvider[] = PROVIDER_CATALOGUE.flatMap((p) =>
	p.keyProvider ? [p.keyProvider] : []
);

/**
 * The generation providers whose key-SAVE needs the `byok` entitlement.
 * Publishing (Zernio) and research (Firecrawl) are promised to Free and are
 * never on this list; a provider that cannot be BYOK'd at all cannot be either.
 */
export const BYOK_GATED_KEY_PROVIDERS: readonly UserKeyProvider[] = PROVIDER_CATALOGUE.flatMap((p) =>
	p.byok.supported && p.byok.entitlementGated && p.keyProvider ? [p.keyProvider] : []
);

/** Providers that can never take a customer key — each with the reason why. */
export const NON_BYOK_PROVIDERS: readonly ProviderEntry[] = PROVIDER_CATALOGUE.filter(
	(p) => !p.byok.supported
);

export function providerById(id: string): ProviderEntry | null {
	return PROVIDER_CATALOGUE.find((p) => p.id === id) ?? null;
}

export function providerByKeyProvider(keyProvider: string): ProviderEntry | null {
	return PROVIDER_CATALOGUE.find((p) => p.keyProvider === keyProvider) ?? null;
}

/** True when saving a key for this `user_api_keys.provider` needs the `byok` entitlement. */
export function isByokGated(keyProvider: string): boolean {
	return (BYOK_GATED_KEY_PROVIDERS as readonly string[]).includes(keyProvider);
}

/** The sentence to show instead of a key field, or null when BYOK is supported. */
export function byokReason(provider: ProviderEntry): string | null {
	return provider.byok.supported ? null : provider.byok.reason;
}
