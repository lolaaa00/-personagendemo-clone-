/**
 * Persona Model v2 — Trait Registry types.
 *
 * The registry is the ONLY source of sampled values. The sampler holds no
 * literals of its own: it asks the registry for a table and picks from it. That
 * is what makes "add a market" a directory and "add a trait" a table, rather
 * than a rewrite of the sampler.
 *
 * DECIDED 2026-09-05: no external persona API, ever. Every value is in-repo,
 * versioned, and reviewable in a diff.
 *
 * Weights are CURATED PLAUSIBILITY, not census statistics. They exist to make a
 * roster of creators feel varied and coherent, not to reproduce a population.
 * Every table file repeats that in its header so nobody mistakes them for data.
 *
 * Client-safe.
 */
import type { TokenGroup, TokenOf } from '../tokens';

/**
 * Conditions under which an entry may be drawn. All present gates must pass;
 * an absent gate is "no opinion". The sampler applies them, never the table.
 */
export interface Gate {
	minAge?: number;
	maxAge?: number;
	gender?: TokenOf<'gender'>[];
	/** Niche tokens this entry suits; absent = suits any. */
	niches?: TokenOf<'niche'>[];
	educations?: TokenOf<'education'>[];
	incomeBands?: TokenOf<'incomeBand'>[];
	seniorities?: TokenOf<'seniority'>[];
	/** Restricts an entry inherited from `generic` to one market. */
	marketOnly?: TokenOf<'market'>[];
	/** Requires (or forbids) children in the household. */
	hasChildren?: boolean;
}

export interface RegistryEntry<T extends string = string> {
	token: T;
	/** Relative likelihood. 0 disables without deleting, which keeps history readable. */
	weight: number;
	gates?: Gate;
}

/** A named table of entries drawn from one token group. */
export interface RegistryTable<G extends TokenGroup = TokenGroup> {
	group: G;
	entries: RegistryEntry<TokenOf<G>>[];
}

/** A place a persona can live. Cities carry their own context and timezone. */
export interface RegistryCity {
	name: string;
	geographicContext: TokenOf<'geographicContext'>;
	timezone: string;
	weight: number;
}

export interface RegistryRegion {
	name: string;
	weight: number;
	cities: RegistryCity[];
}

/** Given names for one heritage, split by gender, plus family names. */
export interface RegistryNames {
	heritage: TokenOf<'heritage'>;
	female: string[];
	male: string[];
	family: string[];
}

/** An occupation the sampler can give a creator, with the gates that make it plausible. */
export interface RegistryOccupation {
	title: string;
	domain: TokenOf<'workDomain'>;
	weight: number;
	gates?: Gate;
}

/**
 * One market's tables. Every field is optional: a market supplies only what
 * differs from `generic`, and `registry.for()` layers it on top. That keeps a
 * new market to the handful of things that are genuinely local — places, names,
 * heritage mix — instead of a full copy.
 */
export interface MarketRegistry {
	market: TokenOf<'market'>;
	regions?: RegistryRegion[];
	names?: RegistryNames[];
	heritage?: RegistryTable<'heritage'>;
	education?: RegistryTable<'education'>;
	employmentStatus?: RegistryTable<'employmentStatus'>;
	workLocationMode?: RegistryTable<'workLocationMode'>;
	seniority?: RegistryTable<'seniority'>;
	occupations?: RegistryOccupation[];
	incomeBand?: RegistryTable<'incomeBand'>;
	priceFrame?: RegistryTable<'priceFrame'>;
	relationshipStatus?: RegistryTable<'relationshipStatus'>;
	childAgeBand?: RegistryTable<'childAgeBand'>;
	housingType?: RegistryTable<'housingType'>;
	pet?: RegistryTable<'pet'>;
	activityLevel?: RegistryTable<'activityLevel'>;
	transportMode?: RegistryTable<'transportMode'>;
	dietaryStyle?: RegistryTable<'dietaryStyle'>;
	languages?: string[];
	/** Look priors, keyed by heritage token; `default` applies when a heritage has no entry. */
	look?: Record<string, LookPrior>;
	skinTone?: RegistryTable<'skinTone'>;
	eyeColor?: RegistryTable<'eyeColor'>;
	bodyType?: RegistryTable<'bodyType'>;
	hairLength?: RegistryTable<'hairLength'>;
	hairstyle?: RegistryTable<'hairstyle'>;
	hairColor?: RegistryTable<'hairColor'>;
	hairTexture?: RegistryTable<'hairTexture'>;
	faceShape?: RegistryTable<'faceShape'>;
	browShape?: RegistryTable<'browShape'>;
}

/** Heritage-conditioned look weights: the fix for "every persona looks the same". */
export interface LookPrior {
	skinTone?: Partial<Record<TokenOf<'skinTone'>, number>>;
	eyeColor?: Partial<Record<TokenOf<'eyeColor'>, number>>;
	hairColor?: Partial<Record<TokenOf<'hairColor'>, number>>;
	hairTexture?: Partial<Record<TokenOf<'hairTexture'>, number>>;
}

/** The fully-resolved registry for one market: generic, with the market layered over it. */
export interface ResolvedRegistry extends Required<Omit<MarketRegistry, 'market' | 'look'>> {
	market: TokenOf<'market'>;
	look: Record<string, LookPrior>;
}
