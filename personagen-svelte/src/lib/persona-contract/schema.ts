/**
 * Persona Model v2 — the stored contract.
 *
 * Nested, versioned, token-valued. Every sub-object is optional because
 * profiles are built incrementally (wizard → "Generate for brand" → manual
 * edits → backfill) and a partial profile is the normal case, not an error.
 *
 * Three concepts that v1 kept in one flat namespace are separated here:
 *   creator  — WHO THEY ARE (the person): identity, life, character
 *   audience — WHO THEY TALK TO: the viewer, with buying/decisioning fields
 *   strategy — HOW THEY POSITION: niche, archetype, focus, angle
 * plus look (how they appear), voice, identityKit, description (derived facts
 * for UI) and meta (provenance). See docs/competitive/persona-model-v2-plan.md §3.
 *
 * Provenance per leaf (`meta.fieldSources`) is what makes silent filling safe:
 * automation may only write leaves whose source is absent, 'sampled' or
 * 'derived'; 'user' and 'extracted' are never overwritten. Rules live in the
 * store (P0.7), the type lives here.
 *
 * Client-safe: types and constants only.
 */
import type { HandleCandidate } from '../persona-identity';
import type { TokenOf } from './tokens';

export const PERSONA_SCHEMA_VERSION = 2 as const;

export type FieldSource = TokenOf<'fieldSource'>;
export type Generator = TokenOf<'generator'>;

export interface PersonaMeta {
	schemaVersion: typeof PERSONA_SCHEMA_VERSION;
	/** Canonical seed for the skeleton sampler; absent for hand-built profiles. */
	seed?: string;
	/** REGISTRY_VERSION of the Trait Registry that produced the skeleton. */
	registryVersion?: string;
	generator?: Generator;
	/** Provider/model that wrote the prose, when an LLM did. */
	generatorModel?: string;
	generatedAt?: string;
	/** Set by the lazy v1 → v2 upgrade. */
	upgradedFrom?: 1;
	/** Leaf path → who set it. Absent leaf = unknown, treated as writable by automation. */
	fieldSources?: Record<string, FieldSource>;
	/** Backfill bookkeeping (P1.7). */
	backfill?: { tier: 0 | 1 | 2; at?: string };
}

export interface PersonaLocation {
	region?: string;
	city?: string;
	geographicContext?: TokenOf<'geographicContext'>;
	timezone?: string;
}

export interface PersonaWork {
	domain?: TokenOf<'workDomain'>;
	title?: string;
	employmentStatus?: TokenOf<'employmentStatus'>;
	workLocationMode?: TokenOf<'workLocationMode'>;
	seniority?: TokenOf<'seniority'>;
}

export interface PersonaHousehold {
	relationshipStatus?: TokenOf<'relationshipStatus'>;
	children?: { count: number; ageBands: TokenOf<'childAgeBand'>[] };
	pets?: TokenOf<'pet'>[];
	housingType?: TokenOf<'housingType'>;
}

export interface PersonaLifestyle {
	activityLevel?: TokenOf<'activityLevel'>;
	transportMode?: TokenOf<'transportMode'>;
	dietaryStyle?: TokenOf<'dietaryStyle'>;
	/** Platform registry keys the creator personally uses. */
	socialPlatformsUsed?: string[];
}

export interface PersonaEconomic {
	incomeBand?: TokenOf<'incomeBand'>;
	priceFrame?: TokenOf<'priceFrame'>;
}

export interface BigFive {
	openness: number;
	conscientiousness: number;
	extraversion: number;
	agreeableness: number;
	neuroticism: number;
}

export interface PersonaCreator {
	firstName?: string;
	lastName?: string;
	/** Public display name (distinct from the internal agents.name). v1: displayName. */
	displayName?: string;
	/** v1: gender ('' meant unset; absent here). */
	gender?: TokenOf<'gender'>;
	/** Exact age; `ageSource: 'bucket'` when derived from a v1 bucket midpoint. */
	age?: number;
	ageSource?: 'exact' | 'bucket';
	/** 'MM-DD'. */
	birthday?: string;
	/** Token when the heritage matches the list; the verbatim text is always kept in heritageText. */
	heritage?: TokenOf<'heritage'>;
	heritageText?: string;
	market?: TokenOf<'market'>;
	location?: PersonaLocation;
	languages?: string[];
	education?: TokenOf<'education'>;
	work?: PersonaWork;
	household?: PersonaHousehold;
	lifestyle?: PersonaLifestyle;
	economic?: PersonaEconomic;
	/** 0–100 each. */
	bigFive?: BigFive;
	/** Derived from bigFive (≥ 65 high, ≤ 35 low). */
	traitLabels?: TokenOf<'traitLabel'>[];
	/** Brand-safety denylist — data, not prose. */
	neverDiscusses?: TokenOf<'neverDiscusses'>[];
}

/**
 * How they appear. STORAGE CONTRACT carried over from v1: curated fields hold a
 * token when the value matches the list, but the v1 free-text value is NEVER
 * snapped — it is kept verbatim in `*Text` companions so an existing persona's
 * face does not change on its next generation. Free-form fields stay strings.
 */
export interface PersonaLook {
	skinTone?: TokenOf<'skinTone'>;
	skinToneText?: string;
	bodyType?: TokenOf<'bodyType'>;
	bodyTypeText?: string;
	heightCm?: number;
	faceShape?: TokenOf<'faceShape'>;
	browShape?: TokenOf<'browShape'>;
	hair?: {
		color?: TokenOf<'hairColor'>;
		colorText?: string;
		grayCoverage?: TokenOf<'grayCoverage'>;
		length?: TokenOf<'hairLength'>;
		lengthText?: string;
		texture?: TokenOf<'hairTexture'>;
		style?: TokenOf<'hairstyle'>;
		styleText?: string;
	};
	facialHair?: TokenOf<'facialHair'>;
	eyes?: { color?: TokenOf<'eyeColor'>; colorText?: string };
	eyewear?: TokenOf<'eyewear'>;
	distinctiveFeatures?: string;
	wardrobe?: string;
	outfitColors?: string;
	headwear?: string;
	styling?: string;
	clothingSizes?: { top?: string; bottom?: string; shoe?: string };
	/** Precomputed prompt clause (= appearanceToPromptClause); cached on save. */
	promptCues?: string;
}

export interface PersonaVoice {
	gender?: TokenOf<'gender'>;
	nationality?: string;
	accent?: string;
	pinnedVoice?: string;
	voiceMatch?: 'exact' | 'fallback';
}

export interface AudienceDecisioning {
	priceSensitivity?: TokenOf<'priceSensitivity'>;
	purchaseChannel?: TokenOf<'purchaseChannel'>;
	brandLoyalty?: TokenOf<'brandLoyalty'>;
	promoResponsiveness?: TokenOf<'promoResponsiveness'>;
	messageProcessingStyle?: TokenOf<'messageProcessingStyle'>;
	communicationPreference?: TokenOf<'communicationPreference'>;
	digitalCapability?: TokenOf<'digitalCapability'>;
}

/** A sampled viewer (Phase 3 panel): a creator-shaped subset without look/voice. */
export interface ViewerSkeleton {
	seed: string;
	gender?: TokenOf<'gender'>;
	age?: number;
	location?: PersonaLocation;
	work?: PersonaWork;
	household?: PersonaHousehold;
	economic?: PersonaEconomic;
	decisioning?: AudienceDecisioning;
	summary?: string;
}

export interface PersonaAudience {
	/** v1: ageRanges as en-dashed labels; here tokens. */
	ageRanges?: TokenOf<'ageRange'>[];
	genderMix?: TokenOf<'genderMix'>;
	lifeStage?: TokenOf<'lifeStage'>[];
	incomeBand?: TokenOf<'incomeBand'>;
	decisioning?: AudienceDecisioning;
	/** Platform registry keys where the audience lives. */
	platforms?: string[];
	/** v1: targetAvatar. */
	targetAvatar?: string;
	/** v1: psychProfile. */
	psychProfile?: string;
	panel?: ViewerSkeleton[];
}

export interface PersonaStrategy {
	/** v1: agents.niche column (label) — mirrored here as a token when it matches. */
	niche?: TokenOf<'niche'>;
	archetype?: TokenOf<'archetype'>;
	/** Off-list v1 archetype kept verbatim (stored values are sacred). */
	archetypeText?: string;
	contentFocus?: TokenOf<'contentFocus'>;
	contentFocusText?: string;
	contentAngle?: string;
}

export interface PersonaIdentityKit {
	bios?: Record<string, string>;
	handleCandidates?: HandleCandidate[];
	confirmedHandles?: Record<string, string>;
}

export interface PersonaDescriptionFact {
	key: string;
	label: string;
	value: string;
}

/** Derived for UI; regenerable from the structured fields without an LLM. */
export interface PersonaDescription {
	short?: string;
	frame?: PersonaDescriptionFact[];
}

export interface PersonaProfileV2 {
	meta: PersonaMeta;
	creator?: PersonaCreator;
	look?: PersonaLook;
	voice?: PersonaVoice;
	audience?: PersonaAudience;
	strategy?: PersonaStrategy;
	identityKit?: PersonaIdentityKit;
	description?: PersonaDescription;
	/** v1 keys the upgrade did not recognise — carried, never dropped. */
	_legacy?: Record<string, unknown>;
}

/** Top-level keys, in canonical order. Anything else is stripped by the store. */
export const PERSONA_V2_KEYS = [
	'meta',
	'creator',
	'look',
	'voice',
	'audience',
	'strategy',
	'identityKit',
	'description',
	'_legacy'
] as const satisfies readonly (keyof PersonaProfileV2)[];

/** Type guard for the v2 shape — checks the version stamp only; contents are coerced by the store. */
export function isPersonaProfileV2(value: unknown): value is PersonaProfileV2 {
	return (
		!!value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		(value as { meta?: { schemaVersion?: unknown } }).meta?.schemaVersion === PERSONA_SCHEMA_VERSION
	);
}
