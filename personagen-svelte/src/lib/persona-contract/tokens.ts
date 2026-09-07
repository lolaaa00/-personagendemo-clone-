/**
 * Persona Model v2 — token enums.
 *
 * STORAGE HOLDS TOKENS, NEVER LABELS. Every enumerated persona value is stored
 * as one of the snake_case tokens below; the text a user sees comes from
 * `labels.ts` at render time. This is the fix for the class of bug where a
 * display string doubled as a storage key (the '25–34' en-dash incident: a
 * chip key with a typographic dash that had to match byte-for-byte across the
 * UI, the generator prompt and the stored blob).
 *
 * Rules (enforced by tokens.spec.ts):
 *   • tokens match /^[a-z0-9]+(_[a-z0-9]+)*$/ — lowercase, digits, single underscores
 *   • every token in every list has a label in labels.ts
 *   • labels are unique within a list
 *   • lists that mirror a legacy option list in persona-profile.ts reproduce it
 *     exactly through the label registry, in both directions
 *
 * Client-safe: no `$env`, no `lib/server` imports — the page, the API routes and
 * the sampler all import the same source of truth.
 *
 * Adding a token: add it here, add its label, extend the touchpoint map when it
 * ships (Phase 4). Never rename a token that has reached storage — add a new one
 * and map the old one in upgrade.ts.
 */

// ── Market / geography ─────────────────────────────────────────────────────
export const MARKET_TOKENS = ['au', 'us', 'uk', 'generic'] as const;
export const GEOGRAPHIC_CONTEXT_TOKENS = ['urban', 'suburban', 'regional', 'rural'] as const;

// ── Identity ───────────────────────────────────────────────────────────────
export const GENDER_TOKENS = ['female', 'male'] as const;

/** Mirrors ETHNICITY_OPTIONS (persona-profile.ts). Free-text heritage is kept alongside as `heritageText`. */
export const HERITAGE_TOKENS = [
	'mixed',
	'hispanic',
	'white',
	'south_asian',
	'black_african',
	'east_asian',
	'southeast_asian',
	'middle_eastern',
	'native_american',
	'pacific_islander',
	'caribbean',
	'central_asian'
] as const;

/** The CREATOR's apparent age bucket. Mirrors PERSONA_AGE_OPTIONS. Distinct from the audience buckets below. */
export const PERSONA_AGE_TOKENS = [
	'18_24',
	'25_29',
	'30_35',
	'36_44',
	'45_54',
	'55_64',
	'65_plus'
] as const;

/** The AUDIENCE's age buckets. Mirrors AGE_RANGE_KEYS (the en-dashed chip keys). */
export const AGE_RANGE_TOKENS = ['13_17', '18_24', '25_34', '35_44', '45_54', '55_plus'] as const;

// ── Background / work / economic / household / lifestyle ──────────────────
export const EDUCATION_TOKENS = [
	'secondary',
	'trade_certificate',
	'some_tertiary',
	'bachelor',
	'postgraduate'
] as const;

export const EMPLOYMENT_STATUS_TOKENS = [
	'employed_full_time',
	'employed_part_time',
	'self_employed',
	'student',
	'homemaker',
	'between_jobs',
	'retired'
] as const;

export const WORK_LOCATION_MODE_TOKENS = ['on_site', 'hybrid', 'remote'] as const;

export const SENIORITY_TOKENS = ['entry', 'mid', 'senior', 'lead', 'owner'] as const;

export const WORK_DOMAIN_TOKENS = [
	'health_care',
	'fitness_wellness',
	'beauty_personal_care',
	'education',
	'technology',
	'creative_media',
	'hospitality_food',
	'retail_ecommerce',
	'trades_construction',
	'finance_admin',
	'marketing_sales',
	'public_service',
	'parenting_home',
	'science_research',
	'sports_outdoors',
	'automotive_transport',
	'arts_entertainment',
	'agriculture_environment'
] as const;

/** Market-relative bands so one token set serves every market's own currency ranges. */
export const INCOME_BAND_TOKENS = ['low', 'lower_middle', 'middle', 'upper_middle', 'high'] as const;

/** The creator's own price lens — what "worth it" means when they talk about products. */
export const PRICE_FRAME_TOKENS = ['budget', 'value', 'premium', 'luxury'] as const;

export const RELATIONSHIP_STATUS_TOKENS = [
	'single',
	'dating',
	'partnered',
	'married',
	'separated',
	'widowed'
] as const;

export const CHILD_AGE_BAND_TOKENS = ['baby', 'toddler', 'primary', 'teen', 'adult'] as const;

export const HOUSING_TYPE_TOKENS = [
	'apartment_rented',
	'apartment_owned',
	'house_rented',
	'house_owned',
	'share_house',
	'family_home'
] as const;

export const PET_TOKENS = ['dog', 'cat', 'small_pet', 'bird', 'fish', 'reptile', 'horse'] as const;

export const ACTIVITY_LEVEL_TOKENS = ['sedentary', 'light', 'moderate', 'active', 'athlete'] as const;

export const TRANSPORT_MODE_TOKENS = ['car', 'public_transport', 'bike', 'walk', 'rideshare'] as const;

export const DIETARY_STYLE_TOKENS = [
	'omnivore',
	'flexitarian',
	'vegetarian',
	'vegan',
	'pescatarian',
	'gluten_free',
	'halal',
	'kosher'
] as const;

// ── Psychology ─────────────────────────────────────────────────────────────
export const BIG_FIVE_TRAIT_TOKENS = [
	'openness',
	'conscientiousness',
	'extraversion',
	'agreeableness',
	'neuroticism'
] as const;

/** Derived from the 0–100 scores: ≥ 65 → high_*, ≤ 35 → low_*, else omitted. */
export const TRAIT_LABEL_TOKENS = [
	'high_openness',
	'low_openness',
	'high_conscientiousness',
	'low_conscientiousness',
	'high_extraversion',
	'low_extraversion',
	'high_agreeableness',
	'low_agreeableness',
	'high_neuroticism',
	'low_neuroticism'
] as const;

/** Brand-safety denylist. Data, not prose: consumers emit these as hard rules. */
export const NEVER_DISCUSSES_TOKENS = [
	'politics',
	'religion',
	'health_claims',
	'medical_advice',
	'financial_advice',
	'competitor_brands',
	'sexuality',
	'body_shaming',
	'current_tragedies'
] as const;

// ── Look (Phase 2 fields are declared now so the contract is complete) ─────
export const SKIN_TONE_TOKENS = [
	'fair_light',
	'medium',
	'dark',
	'porcelain',
	'olive',
	'tan',
	'bronze',
	'deep'
] as const;

export const EYE_COLOR_TOKENS = ['brown', 'blue', 'green', 'hazel', 'amber', 'gray', 'dark_brown'] as const;

export const BODY_TYPE_TOKENS = [
	'athletic',
	'slim',
	'curvy',
	'average',
	'muscular',
	'petite',
	'plus_size',
	'tall_lean'
] as const;

export const HAIR_LENGTH_TOKENS = [
	'long',
	'medium',
	'short',
	'shoulder_length',
	'chin_length',
	'pixie',
	'waist_length'
] as const;

export const HAIRSTYLE_TOKENS = [
	'curly',
	'wavy',
	'straight',
	'coily',
	'braided',
	'sleek_bun',
	'ponytail',
	'afro',
	'locs',
	'bald_shaved'
] as const;

export const HAIR_COLOR_TOKENS = [
	'light_brown',
	'dark_brown',
	'blonde',
	'black',
	'auburn',
	'red',
	'platinum_blonde',
	'silver_gray'
] as const;

export const HAIR_TEXTURE_TOKENS = ['fine', 'medium', 'thick', 'coarse'] as const;
export const GRAY_COVERAGE_TOKENS = ['none', 'light', 'salt_and_pepper', 'mostly_gray', 'white'] as const;
export const FACIAL_HAIR_TOKENS = ['none', 'stubble', 'short_beard', 'full_beard', 'moustache', 'goatee'] as const;
export const EYEWEAR_TOKENS = ['none', 'glasses', 'sunglasses_often'] as const;
export const FACE_SHAPE_TOKENS = ['oval', 'round', 'square', 'heart', 'long', 'diamond'] as const;
export const BROW_SHAPE_TOKENS = ['straight', 'soft_arch', 'high_arch', 'thick', 'thin'] as const;

// ── Strategy ───────────────────────────────────────────────────────────────
/** Mirrors PERSONA_ARCHETYPES. */
export const ARCHETYPE_TOKENS = [
	'creator',
	'expert_authority',
	'relatable_friend',
	'aspirational',
	'storyteller',
	'activist_advocate',
	'entertainer',
	'educator',
	'disruptor',
	'community_builder'
] as const;

/** Mirrors CONTENT_FOCUS_OPTIONS. */
export const CONTENT_FOCUS_TOKENS = [
	'education_how_tos',
	'entertainment_humor',
	'lifestyle_aesthetic',
	'product_reviews_ugc',
	'inspiration_motivation',
	'behind_the_scenes',
	'news_commentary',
	'tutorials_demos',
	'personal_journey'
] as const;

/** Mirrors NICHE_OPTIONS. */
export const NICHE_TOKENS = [
	'beauty_wellness',
	'fitness_health',
	'tech_ai',
	'food_cooking',
	'fashion_style',
	'travel_adventure',
	'finance_business',
	'gaming_esports',
	'education_learning',
	'lifestyle',
	'parenting_family',
	'home_diy',
	'pets_animals',
	'entertainment_pop_culture',
	'sustainability_eco',
	'arts_creativity',
	'sports',
	'automotive'
] as const;

// ── Audience decisioning (Phase 3 fields, declared now) ────────────────────
export const GENDER_MIX_TOKENS = ['female_skew', 'male_skew', 'mixed'] as const;

export const LIFE_STAGE_TOKENS = [
	'student',
	'early_career',
	'young_family',
	'established_family',
	'empty_nester',
	'retired'
] as const;

export const PRICE_SENSITIVITY_TOKENS = ['price_led', 'value_led', 'quality_led', 'price_insensitive'] as const;
export const PURCHASE_CHANNEL_TOKENS = ['online_first', 'in_store_first', 'marketplace', 'social_commerce', 'mixed'] as const;
export const BRAND_LOYALTY_TOKENS = ['loyal', 'switcher', 'explorer'] as const;
export const PROMO_RESPONSIVENESS_TOKENS = ['deal_driven', 'occasional', 'promo_averse'] as const;
export const MESSAGE_PROCESSING_STYLE_TOKENS = ['analytical', 'intuitive', 'social_proof', 'emotional'] as const;
export const COMMUNICATION_PREFERENCE_TOKENS = ['evidence_led', 'story_led', 'visual_led', 'peer_led'] as const;
export const DIGITAL_CAPABILITY_TOKENS = ['basic', 'confident', 'advanced'] as const;

// ── Meta ───────────────────────────────────────────────────────────────────
export const GENERATOR_TOKENS = ['skeleton_v1', 'llm_v1', 'manual', 'imported'] as const;
export const FIELD_SOURCE_TOKENS = ['user', 'sampled', 'extracted', 'derived'] as const;

/** Every list above, keyed by the group name used in labels.ts and in field paths. */
export const TOKEN_GROUPS = {
	market: MARKET_TOKENS,
	geographicContext: GEOGRAPHIC_CONTEXT_TOKENS,
	gender: GENDER_TOKENS,
	heritage: HERITAGE_TOKENS,
	personaAge: PERSONA_AGE_TOKENS,
	ageRange: AGE_RANGE_TOKENS,
	education: EDUCATION_TOKENS,
	employmentStatus: EMPLOYMENT_STATUS_TOKENS,
	workLocationMode: WORK_LOCATION_MODE_TOKENS,
	seniority: SENIORITY_TOKENS,
	workDomain: WORK_DOMAIN_TOKENS,
	incomeBand: INCOME_BAND_TOKENS,
	priceFrame: PRICE_FRAME_TOKENS,
	relationshipStatus: RELATIONSHIP_STATUS_TOKENS,
	childAgeBand: CHILD_AGE_BAND_TOKENS,
	housingType: HOUSING_TYPE_TOKENS,
	pet: PET_TOKENS,
	activityLevel: ACTIVITY_LEVEL_TOKENS,
	transportMode: TRANSPORT_MODE_TOKENS,
	dietaryStyle: DIETARY_STYLE_TOKENS,
	bigFiveTrait: BIG_FIVE_TRAIT_TOKENS,
	traitLabel: TRAIT_LABEL_TOKENS,
	neverDiscusses: NEVER_DISCUSSES_TOKENS,
	skinTone: SKIN_TONE_TOKENS,
	eyeColor: EYE_COLOR_TOKENS,
	bodyType: BODY_TYPE_TOKENS,
	hairLength: HAIR_LENGTH_TOKENS,
	hairstyle: HAIRSTYLE_TOKENS,
	hairColor: HAIR_COLOR_TOKENS,
	hairTexture: HAIR_TEXTURE_TOKENS,
	grayCoverage: GRAY_COVERAGE_TOKENS,
	facialHair: FACIAL_HAIR_TOKENS,
	eyewear: EYEWEAR_TOKENS,
	faceShape: FACE_SHAPE_TOKENS,
	browShape: BROW_SHAPE_TOKENS,
	archetype: ARCHETYPE_TOKENS,
	contentFocus: CONTENT_FOCUS_TOKENS,
	niche: NICHE_TOKENS,
	genderMix: GENDER_MIX_TOKENS,
	lifeStage: LIFE_STAGE_TOKENS,
	priceSensitivity: PRICE_SENSITIVITY_TOKENS,
	purchaseChannel: PURCHASE_CHANNEL_TOKENS,
	brandLoyalty: BRAND_LOYALTY_TOKENS,
	promoResponsiveness: PROMO_RESPONSIVENESS_TOKENS,
	messageProcessingStyle: MESSAGE_PROCESSING_STYLE_TOKENS,
	communicationPreference: COMMUNICATION_PREFERENCE_TOKENS,
	digitalCapability: DIGITAL_CAPABILITY_TOKENS,
	generator: GENERATOR_TOKENS,
	fieldSource: FIELD_SOURCE_TOKENS
} as const;

export type TokenGroup = keyof typeof TOKEN_GROUPS;
export type TokenOf<G extends TokenGroup> = (typeof TOKEN_GROUPS)[G][number];

/** The one shape every token must satisfy. Exported so the spec and the sampler share it. */
export const TOKEN_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/** True when `value` is a member of the named group. Narrow, never throws. */
export function isToken<G extends TokenGroup>(group: G, value: unknown): value is TokenOf<G> {
	return typeof value === 'string' && (TOKEN_GROUPS[group] as readonly string[]).includes(value);
}
