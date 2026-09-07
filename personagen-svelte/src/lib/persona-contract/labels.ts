/**
 * Persona Model v2 — the label registry.
 *
 * One place that turns a stored token into the text a user sees, and back.
 * Where a group mirrors a legacy option list in persona-profile.ts, the labels
 * here are BYTE-IDENTICAL to that list (including the U+2013 en-dashes in the
 * age buckets), so the v1 → v2 upgrade is lossless and the UI can keep rendering
 * exactly what it renders today. tokens.spec.ts asserts that equivalence in
 * both directions.
 *
 * Renaming a label is a one-line change here and never a data migration.
 */
import { TOKEN_GROUPS, type TokenGroup, type TokenOf } from './tokens';

type LabelMap<G extends TokenGroup> = Record<TokenOf<G>, string>;

export const LABELS: { [G in TokenGroup]: LabelMap<G> } = {
	market: { au: 'Australia', us: 'United States', uk: 'United Kingdom', generic: 'International' },
	geographicContext: { urban: 'Urban', suburban: 'Suburban', regional: 'Regional', rural: 'Rural' },
	gender: { female: 'Female', male: 'Male' },
	heritage: {
		mixed: 'Mixed',
		hispanic: 'Hispanic',
		white: 'White',
		south_asian: 'South Asian',
		black_african: 'Black / African',
		east_asian: 'East Asian',
		southeast_asian: 'Southeast Asian',
		middle_eastern: 'Middle Eastern',
		native_american: 'Native American',
		pacific_islander: 'Pacific Islander',
		caribbean: 'Caribbean',
		central_asian: 'Central Asian'
	},
	personaAge: {
		'18_24': '18–24',
		'25_29': '25–29',
		'30_35': '30–35',
		'36_44': '36–44',
		'45_54': '45–54',
		'55_64': '55–64',
		'65_plus': '65+'
	},
	ageRange: {
		'13_17': '13–17',
		'18_24': '18–24',
		'25_34': '25–34',
		'35_44': '35–44',
		'45_54': '45–54',
		'55_plus': '55+'
	},
	education: {
		secondary: 'Secondary school',
		trade_certificate: 'Trade certificate',
		some_tertiary: 'Some tertiary',
		bachelor: "Bachelor's degree",
		postgraduate: 'Postgraduate'
	},
	employmentStatus: {
		employed_full_time: 'Employed full-time',
		employed_part_time: 'Employed part-time',
		self_employed: 'Self-employed',
		student: 'Student',
		homemaker: 'Homemaker',
		between_jobs: 'Between jobs',
		retired: 'Retired'
	},
	workLocationMode: { on_site: 'On site', hybrid: 'Hybrid', remote: 'Remote' },
	seniority: { entry: 'Entry level', mid: 'Mid level', senior: 'Senior', lead: 'Lead / manager', owner: 'Owner' },
	workDomain: {
		health_care: 'Health care',
		fitness_wellness: 'Fitness & wellness',
		beauty_personal_care: 'Beauty & personal care',
		education: 'Education',
		technology: 'Technology',
		creative_media: 'Creative & media',
		hospitality_food: 'Hospitality & food',
		retail_ecommerce: 'Retail & e-commerce',
		trades_construction: 'Trades & construction',
		finance_admin: 'Finance & admin',
		marketing_sales: 'Marketing & sales',
		public_service: 'Public service',
		parenting_home: 'Parenting & home',
		science_research: 'Science & research',
		sports_outdoors: 'Sports & outdoors',
		automotive_transport: 'Automotive & transport',
		arts_entertainment: 'Arts & entertainment',
		agriculture_environment: 'Agriculture & environment'
	},
	incomeBand: {
		low: 'Low income',
		lower_middle: 'Lower-middle income',
		middle: 'Middle income',
		upper_middle: 'Upper-middle income',
		high: 'High income'
	},
	priceFrame: { budget: 'Budget', value: 'Value', premium: 'Premium', luxury: 'Luxury' },
	relationshipStatus: {
		single: 'Single',
		dating: 'Dating',
		partnered: 'Partnered',
		married: 'Married',
		separated: 'Separated',
		widowed: 'Widowed'
	},
	childAgeBand: { baby: 'Baby', toddler: 'Toddler', primary: 'Primary school', teen: 'Teen', adult: 'Adult' },
	housingType: {
		apartment_rented: 'Rented apartment',
		apartment_owned: 'Owned apartment',
		house_rented: 'Rented house',
		house_owned: 'Owned house',
		share_house: 'Share house',
		family_home: 'Family home'
	},
	pet: { dog: 'Dog', cat: 'Cat', small_pet: 'Small pet', bird: 'Bird', fish: 'Fish', reptile: 'Reptile', horse: 'Horse' },
	activityLevel: { sedentary: 'Sedentary', light: 'Lightly active', moderate: 'Moderately active', active: 'Active', athlete: 'Athlete' },
	transportMode: { car: 'Car', public_transport: 'Public transport', bike: 'Bike', walk: 'Walks', rideshare: 'Rideshare' },
	dietaryStyle: {
		omnivore: 'Omnivore',
		flexitarian: 'Flexitarian',
		vegetarian: 'Vegetarian',
		vegan: 'Vegan',
		pescatarian: 'Pescatarian',
		gluten_free: 'Gluten-free',
		halal: 'Halal',
		kosher: 'Kosher'
	},
	bigFiveTrait: {
		openness: 'Openness',
		conscientiousness: 'Conscientiousness',
		extraversion: 'Extraversion',
		agreeableness: 'Agreeableness',
		neuroticism: 'Neuroticism'
	},
	traitLabel: {
		high_openness: 'Curious',
		low_openness: 'Conventional',
		high_conscientiousness: 'Organised',
		low_conscientiousness: 'Spontaneous',
		high_extraversion: 'Outgoing',
		low_extraversion: 'Reserved',
		high_agreeableness: 'Warm',
		low_agreeableness: 'Blunt',
		high_neuroticism: 'Sensitive',
		low_neuroticism: 'Steady'
	},
	neverDiscusses: {
		politics: 'Politics',
		religion: 'Religion',
		health_claims: 'Health claims',
		medical_advice: 'Medical advice',
		financial_advice: 'Financial advice',
		competitor_brands: 'Competitor brands',
		sexuality: 'Sexuality',
		body_shaming: 'Body shaming',
		current_tragedies: 'Current tragedies'
	},
	skinTone: {
		fair_light: 'Fair/Light',
		medium: 'Medium',
		dark: 'Dark',
		porcelain: 'Porcelain',
		olive: 'Olive',
		tan: 'Tan',
		bronze: 'Bronze',
		deep: 'Deep'
	},
	eyeColor: { brown: 'Brown', blue: 'Blue', green: 'Green', hazel: 'Hazel', amber: 'Amber', gray: 'Gray', dark_brown: 'Dark Brown' },
	bodyType: {
		athletic: 'Athletic',
		slim: 'Slim',
		curvy: 'Curvy',
		average: 'Average',
		muscular: 'Muscular',
		petite: 'Petite',
		plus_size: 'Plus-Size',
		tall_lean: 'Tall & Lean'
	},
	hairLength: {
		long: 'Long',
		medium: 'Medium',
		short: 'Short',
		shoulder_length: 'Shoulder-Length',
		chin_length: 'Chin-Length',
		pixie: 'Pixie',
		waist_length: 'Waist-Length'
	},
	hairstyle: {
		curly: 'Curly',
		wavy: 'Wavy',
		straight: 'Straight',
		coily: 'Coily',
		braided: 'Braided',
		sleek_bun: 'Sleek Bun',
		ponytail: 'Ponytail',
		afro: 'Afro',
		locs: 'Locs',
		bald_shaved: 'Bald / Shaved'
	},
	hairColor: {
		light_brown: 'Light Brown',
		dark_brown: 'Dark Brown',
		blonde: 'Blonde',
		black: 'Black',
		auburn: 'Auburn',
		red: 'Red',
		platinum_blonde: 'Platinum Blonde',
		silver_gray: 'Silver / Gray'
	},
	hairTexture: { fine: 'Fine', medium: 'Medium', thick: 'Thick', coarse: 'Coarse' },
	grayCoverage: { none: 'None', light: 'A little gray', salt_and_pepper: 'Salt and pepper', mostly_gray: 'Mostly gray', white: 'White' },
	facialHair: { none: 'None', stubble: 'Stubble', short_beard: 'Short beard', full_beard: 'Full beard', moustache: 'Moustache', goatee: 'Goatee' },
	eyewear: { none: 'None', glasses: 'Glasses', sunglasses_often: 'Often in sunglasses' },
	faceShape: { oval: 'Oval', round: 'Round', square: 'Square', heart: 'Heart', long: 'Long', diamond: 'Diamond' },
	browShape: { straight: 'Straight', soft_arch: 'Soft arch', high_arch: 'High arch', thick: 'Thick', thin: 'Thin' },
	archetype: {
		creator: 'The Creator',
		expert_authority: 'The Expert / Authority',
		relatable_friend: 'The Relatable Friend',
		aspirational: 'The Aspirational',
		storyteller: 'The Storyteller',
		activist_advocate: 'The Activist / Advocate',
		entertainer: 'The Entertainer',
		educator: 'The Educator',
		disruptor: 'The Disruptor',
		community_builder: 'The Community Builder'
	},
	contentFocus: {
		education_how_tos: 'Education & How-Tos',
		entertainment_humor: 'Entertainment & Humor',
		lifestyle_aesthetic: 'Lifestyle & Aesthetic',
		product_reviews_ugc: 'Product Reviews & UGC',
		inspiration_motivation: 'Inspiration & Motivation',
		behind_the_scenes: 'Behind-the-Scenes',
		news_commentary: 'News & Commentary',
		tutorials_demos: 'Tutorials & Demos',
		personal_journey: 'Personal Journey'
	},
	niche: {
		beauty_wellness: 'Beauty & Wellness',
		fitness_health: 'Fitness & Health',
		tech_ai: 'Tech & AI',
		food_cooking: 'Food & Cooking',
		fashion_style: 'Fashion & Style',
		travel_adventure: 'Travel & Adventure',
		finance_business: 'Finance & Business',
		gaming_esports: 'Gaming & Esports',
		education_learning: 'Education & Learning',
		lifestyle: 'Lifestyle',
		parenting_family: 'Parenting & Family',
		home_diy: 'Home & DIY',
		pets_animals: 'Pets & Animals',
		entertainment_pop_culture: 'Entertainment & Pop Culture',
		sustainability_eco: 'Sustainability & Eco',
		arts_creativity: 'Arts & Creativity',
		sports: 'Sports',
		automotive: 'Automotive'
	},
	genderMix: { female_skew: 'Mostly women', male_skew: 'Mostly men', mixed: 'Mixed' },
	lifeStage: {
		student: 'Student',
		early_career: 'Early career',
		young_family: 'Young family',
		established_family: 'Established family',
		empty_nester: 'Empty nester',
		retired: 'Retired'
	},
	priceSensitivity: { price_led: 'Price-led', value_led: 'Value-led', quality_led: 'Quality-led', price_insensitive: 'Price-insensitive' },
	purchaseChannel: { online_first: 'Online first', in_store_first: 'In store first', marketplace: 'Marketplaces', social_commerce: 'Social commerce', mixed: 'Mixed' },
	brandLoyalty: { loyal: 'Loyal', switcher: 'Switcher', explorer: 'Explorer' },
	promoResponsiveness: { deal_driven: 'Deal-driven', occasional: 'Occasional', promo_averse: 'Promo-averse' },
	messageProcessingStyle: { analytical: 'Analytical', intuitive: 'Intuitive', social_proof: 'Social proof', emotional: 'Emotional' },
	communicationPreference: { evidence_led: 'Evidence-led', story_led: 'Story-led', visual_led: 'Visual-led', peer_led: 'Peer-led' },
	digitalCapability: { basic: 'Basic', confident: 'Confident', advanced: 'Advanced' },
	generator: { skeleton_v1: 'Sampled (skeleton v1)', llm_v1: 'Generated (LLM v1)', manual: 'Set by you', imported: 'Imported' },
	fieldSource: { user: 'Set by you', sampled: 'Auto', extracted: 'From soul', derived: 'Derived' }
};

/** Display text for a token; the token itself if unknown (never blank, never throws). */
export function label<G extends TokenGroup>(group: G, token: string | null | undefined): string {
	if (!token) return '';
	const map = LABELS[group] as Record<string, string>;
	return map[token] ?? token;
}

/**
 * Reverse lookup for the v1 → v2 upgrade and for LLM output that speaks in
 * labels. Exact match first, then case-insensitive, then a match that treats
 * '-' and '–' (en-dash) as the same character — the en-dash incident, closed.
 * Returns null when nothing matches; callers keep the raw text elsewhere.
 */
export function tokenForLabel<G extends TokenGroup>(group: G, text: string | null | undefined): TokenOf<G> | null {
	if (typeof text !== 'string') return null;
	const wanted = text.trim();
	if (!wanted) return null;
	const map = LABELS[group] as Record<string, string>;
	const tokens = TOKEN_GROUPS[group] as readonly string[];
	const norm = (s: string) => s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
	const exact = tokens.find((t) => map[t] === wanted);
	if (exact) return exact as TokenOf<G>;
	const loose = tokens.find((t) => norm(map[t]) === norm(wanted));
	if (loose) return loose as TokenOf<G>;
	// A token typed as text ('25_34', 'The Creator' already handled above).
	if (tokens.includes(wanted)) return wanted as TokenOf<G>;
	return null;
}
