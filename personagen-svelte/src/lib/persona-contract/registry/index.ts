/**
 * Trait Registry — resolution and gated picking.
 *
 * `registry.for(market)` layers a market's tables over `generic`, so a market
 * file carries only what is genuinely local and can never leave the sampler
 * without a table. `registry.pick(table, rng, context)` applies each entry's
 * gates, then weights. The sampler holds no literals and no gate logic of its
 * own; it asks here.
 *
 * REGISTRY_VERSION is stamped into every generated persona (`meta.registryVersion`)
 * so a persona can always say which tables produced it. Bump it on any change to
 * an entry, a weight or a gate — the pre-commit hook enforces that.
 *
 * Client-safe.
 */
import { rng as makeRng, type Rng } from '../rng';
import type { TokenGroup, TokenOf } from '../tokens';
import { AU } from './au';
import { GENERIC } from './generic';
import { UK } from './uk';
import { US } from './us';
import type {
	Gate,
	LookPrior,
	MarketRegistry,
	RegistryEntry,
	RegistryNames,
	RegistryOccupation,
	RegistryTable,
	ResolvedRegistry
} from './types';

/**
 * Semver for the registry's CONTENT. Bump on any change to an entry, weight or
 * gate; every persona records the version that produced it, and the sampler's
 * golden snapshots are pinned to it.
 *
 * 1.0.0 — first tables (generic, au, us, uk). P1.1.
 */
export const REGISTRY_VERSION = '1.0.0';

const MARKETS: Record<string, MarketRegistry> = { au: AU, us: US, uk: UK, generic: GENERIC };

/** Facts a gate can be evaluated against. Every field optional: unknown means "no opinion", never "fails". */
export interface GateContext {
	age?: number;
	gender?: TokenOf<'gender'>;
	niche?: TokenOf<'niche'>;
	education?: TokenOf<'education'>;
	incomeBand?: TokenOf<'incomeBand'>;
	seniority?: TokenOf<'seniority'>;
	market?: TokenOf<'market'>;
	hasChildren?: boolean;
}

/**
 * True when every gate present on the entry is satisfied.
 *
 * An UNKNOWN context value passes: the sampler fills fields in dependency order,
 * so a gate on something not yet drawn must not silently empty the table. This
 * is what keeps "sample age before seniority" a sampler concern rather than a
 * table concern.
 */
export function gatePasses(gate: Gate | undefined, ctx: GateContext): boolean {
	if (!gate) return true;
	if (gate.minAge !== undefined && ctx.age !== undefined && ctx.age < gate.minAge) return false;
	if (gate.maxAge !== undefined && ctx.age !== undefined && ctx.age > gate.maxAge) return false;
	if (gate.gender && ctx.gender !== undefined && !gate.gender.includes(ctx.gender)) return false;
	if (gate.niches && ctx.niche !== undefined && !gate.niches.includes(ctx.niche)) return false;
	if (gate.educations && ctx.education !== undefined && !gate.educations.includes(ctx.education)) return false;
	if (gate.incomeBands && ctx.incomeBand !== undefined && !gate.incomeBands.includes(ctx.incomeBand)) return false;
	if (gate.seniorities && ctx.seniority !== undefined && !gate.seniorities.includes(ctx.seniority)) return false;
	if (gate.marketOnly && ctx.market !== undefined && !gate.marketOnly.includes(ctx.market)) return false;
	if (gate.hasChildren !== undefined && ctx.hasChildren !== undefined && gate.hasChildren !== ctx.hasChildren)
		return false;
	return true;
}

/** Merges a market's optional tables over the generic base. */
function resolve(market: TokenOf<'market'>): ResolvedRegistry {
	const base = GENERIC;
	const over = MARKETS[market] ?? GENERIC;
	const merged = { ...base, ...pruneUndefined(over), market } as ResolvedRegistry;
	// Names merge per heritage rather than replacing the whole list, so a market
	// can localise one or two heritages without restating the other ten.
	if (over.names && over !== base) {
		const byHeritage = new Map<string, RegistryNames>();
		for (const n of base.names ?? []) byHeritage.set(n.heritage, n);
		for (const n of over.names) byHeritage.set(n.heritage, n);
		merged.names = [...byHeritage.values()];
	}
	merged.look = { ...(base.look ?? {}), ...(over.look ?? {}) };
	return merged;
}

function pruneUndefined<T extends object>(o: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
	return out as Partial<T>;
}

const CACHE = new Map<string, ResolvedRegistry>();

export const registry = {
	/** The resolved tables for a market; unknown markets fall back to generic and never throw. */
	for(market: string | null | undefined): ResolvedRegistry {
		const key = market && MARKETS[market] ? market : 'generic';
		let hit = CACHE.get(key);
		if (!hit) {
			hit = resolve(key as TokenOf<'market'>);
			CACHE.set(key, hit);
		}
		return hit;
	},

	/**
	 * Weighted pick from a table after gating.
	 *
	 * NEVER returns undefined: if every entry is gated out (an over-constrained
	 * context), it falls back to the ungated weights, and failing that to the
	 * first entry. A sampler that has to handle "no value" everywhere is a
	 * sampler that will one day produce a persona with holes.
	 */
	pick<G extends TokenGroup>(table: RegistryTable<G>, r: Rng, ctx: GateContext = {}): TokenOf<G> {
		if (!table.entries.length) throw new Error(`registry table '${table.group}' is empty`);
		const live = table.entries.filter((e) => e.weight > 0 && gatePasses(e.gates, ctx));
		const pool = live.length ? live : table.entries.filter((e) => e.weight > 0);
		if (!pool.length) return table.entries[0].token;
		return r.weighted(pool, (e) => e.weight).token;
	},

	/**
	 * Weighted pick under a heritage look prior.
	 *
	 * A prior is AUTHORITATIVE for the group it names: only the tokens it lists
	 * can be drawn. Treating a prior as a re-weighting of the full base table
	 * instead would leave every unmentioned tone reachable — a persona with a
	 * 'white' heritage could still draw a deep skin tone at its base weight,
	 * which is precisely the heritage-mismatch this prior exists to prevent.
	 * A group the prior does not mention falls through to the base table.
	 *
	 * Gating still applies inside the prior, and if gating empties it we fall
	 * back to the base table rather than returning nothing.
	 */
	pickLook<G extends 'skinTone' | 'eyeColor' | 'hairColor' | 'hairTexture'>(
		table: RegistryTable<G>,
		prior: LookPrior | undefined,
		key: G,
		r: Rng,
		ctx: GateContext = {}
	): TokenOf<G> {
		const overrides = prior?.[key] as Partial<Record<string, number>> | undefined;
		const gated = table.entries.filter((e) => gatePasses(e.gates, ctx));
		const base = gated.length ? gated : table.entries;
		if (overrides && Object.keys(overrides).length) {
			const scoped = base
				.filter((e) => (overrides[e.token] ?? 0) > 0)
				.map((e) => ({ token: e.token, weight: overrides[e.token] as number }));
			if (scoped.length) return r.weighted(scoped, (e) => e.weight).token;
		}
		const usable = base.filter((e) => e.weight > 0);
		if (!usable.length) return table.entries[0].token;
		return r.weighted(usable, (e) => e.weight).token;
	},

	/** Occupations that suit the context, gated the same way. */
	occupations(resolved: ResolvedRegistry, r: Rng, ctx: GateContext): RegistryOccupation {
		const live = resolved.occupations.filter((o) => o.weight > 0 && gatePasses(o.gates, ctx));
		const pool = live.length ? live : resolved.occupations.filter((o) => !o.gates?.niches);
		if (!pool.length) return resolved.occupations[0];
		return r.weighted(pool, (o) => o.weight);
	},

	/** The name set for a heritage, falling back to the first set rather than throwing. */
	namesFor(resolved: ResolvedRegistry, heritage: TokenOf<'heritage'>): RegistryNames {
		return resolved.names.find((n) => n.heritage === heritage) ?? resolved.names[0];
	}
};

/** Convenience for tests and tools: a fresh generator for a seed. */
export const registryRng = makeRng;

export type { Gate, GateContext as RegistryGateContext, RegistryEntry, RegistryTable, ResolvedRegistry };
export { GENERIC, AU, US, UK };
