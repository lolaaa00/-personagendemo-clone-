/**
 * Trait Registry — the GENERIC market.
 *
 * CURATED PLAUSIBILITY WEIGHTS, NOT CENSUS STATISTICS. They exist so a roster of
 * creators comes out varied and internally coherent, not so the population
 * matches any country's real distribution. Nobody should cite these as data.
 *
 * This file is the complete fallback: every table the sampler can ask for is
 * here. A market file supplies only what is genuinely local (places, names,
 * heritage mix, a few weights) and `registry.for()` layers it on top, so adding
 * a market never means copying this file.
 *
 * Client-safe.
 */
import type { MarketRegistry } from './types';

export const GENERIC: MarketRegistry = {
	market: 'generic',

	regions: [
		{
			name: 'Northern Region',
			weight: 30,
			cities: [
				{ name: 'Riverton', geographicContext: 'urban', timezone: 'UTC', weight: 40 },
				{ name: 'Eastmarch', geographicContext: 'suburban', timezone: 'UTC', weight: 35 },
				{ name: 'Halewood', geographicContext: 'regional', timezone: 'UTC', weight: 25 }
			]
		},
		{
			name: 'Southern Region',
			weight: 30,
			cities: [
				{ name: 'Port Meridian', geographicContext: 'urban', timezone: 'UTC', weight: 45 },
				{ name: 'Fairholm', geographicContext: 'suburban', timezone: 'UTC', weight: 35 },
				{ name: 'Little Crossing', geographicContext: 'rural', timezone: 'UTC', weight: 20 }
			]
		},
		{
			name: 'Western Region',
			weight: 25,
			cities: [
				{ name: 'Ashford Bay', geographicContext: 'urban', timezone: 'UTC', weight: 50 },
				{ name: 'Kestrel', geographicContext: 'regional', timezone: 'UTC', weight: 50 }
			]
		},
		{
			name: 'Central Region',
			weight: 15,
			cities: [
				{ name: 'Thornbury', geographicContext: 'suburban', timezone: 'UTC', weight: 60 },
				{ name: 'Marrow Hill', geographicContext: 'rural', timezone: 'UTC', weight: 40 }
			]
		}
	],

	// One name set per heritage. Kept modest and real: enough that two personas
	// of the same heritage rarely collide, not a phone book.
	names: [
		{
			heritage: 'white',
			female: ['Emma', 'Claire', 'Hannah', 'Alice', 'Nina', 'Freya', 'Rosie', 'Maeve', 'Elena', 'Iris'],
			male: ['Adam', 'Ben', 'Callum', 'Daniel', 'Elliot', 'Finn', 'Jack', 'Luke', 'Owen', 'Theo'],
			family: ['Bennett', 'Carter', 'Doyle', 'Fletcher', 'Hayes', 'Lawson', 'Mercer', 'Nolan', 'Palmer', 'Whitfield']
		},
		{
			heritage: 'east_asian',
			female: ['Mei', 'Yuki', 'Hana', 'Jia', 'Soo-ah', 'Lin', 'Nari', 'Ai', 'Xiu', 'Eun'],
			male: ['Kenji', 'Wei', 'Jun', 'Haru', 'Min-jun', 'Tao', 'Ryo', 'Sung', 'Kai', 'Zhen'],
			family: ['Chen', 'Kim', 'Nakamura', 'Park', 'Sato', 'Tanaka', 'Wang', 'Yamamoto', 'Zhang', 'Lee']
		},
		{
			heritage: 'southeast_asian',
			female: ['Linh', 'Mai', 'Siti', 'Anong', 'Rina', 'Thao', 'Ayu', 'Chandra', 'Nur', 'Vy'],
			male: ['Minh', 'Arif', 'Somchai', 'Bayu', 'Duc', 'Rizal', 'Anh', 'Tuan', 'Adi', 'Nam'],
			family: ['Nguyen', 'Tran', 'Santos', 'Wijaya', 'Pham', 'Rahman', 'Sukarno', 'Lim', 'Chua', 'Reyes']
		},
		{
			heritage: 'south_asian',
			female: ['Priya', 'Anika', 'Meera', 'Zara', 'Ishita', 'Sana', 'Divya', 'Nisha', 'Aditi', 'Reena'],
			male: ['Arjun', 'Rohan', 'Imran', 'Vikram', 'Dev', 'Kabir', 'Sameer', 'Anil', 'Ravi', 'Zayn'],
			family: ['Kapoor', 'Sharma', 'Patel', 'Singh', 'Iyer', 'Khan', 'Nair', 'Desai', 'Rao', 'Gupta']
		},
		{
			heritage: 'black_african',
			female: ['Amara', 'Zola', 'Nia', 'Chidinma', 'Aisha', 'Thandi', 'Ayana', 'Simi', 'Kemi', 'Imani'],
			male: ['Kwame', 'Tunde', 'Sipho', 'Malik', 'Chike', 'Jabari', 'Kofi', 'Emeka', 'Zuri', 'Obi'],
			family: ['Okafor', 'Mensah', 'Dlamini', 'Adeyemi', 'Nkosi', 'Abara', 'Mwangi', 'Owusu', 'Bello', 'Achebe']
		},
		{
			heritage: 'hispanic',
			female: ['Sofia', 'Valentina', 'Camila', 'Lucia', 'Elena', 'Paloma', 'Ines', 'Mariana', 'Rocio', 'Daniela'],
			male: ['Mateo', 'Diego', 'Javier', 'Andres', 'Tomas', 'Rafael', 'Nicolas', 'Emilio', 'Bruno', 'Ivan'],
			family: ['Ramirez', 'Delgado', 'Vargas', 'Castillo', 'Moreno', 'Herrera', 'Navarro', 'Reyes', 'Ortega', 'Salazar']
		},
		{
			heritage: 'middle_eastern',
			female: ['Layla', 'Yasmin', 'Noor', 'Dana', 'Rania', 'Salma', 'Hala', 'Zeina', 'Amira', 'Lina'],
			male: ['Omar', 'Karim', 'Youssef', 'Sami', 'Tariq', 'Nabil', 'Hadi', 'Rami', 'Faris', 'Ziad'],
			family: ['Haddad', 'Nasser', 'Khalil', 'Aziz', 'Mansour', 'Farah', 'Saleh', 'Darwish', 'Rahim', 'Bakr']
		},
		{
			heritage: 'mixed',
			female: ['Ava', 'Maya', 'Leila', 'Sienna', 'Amara', 'Noa', 'Talia', 'Jade', 'Esme', 'Kaia'],
			male: ['Elias', 'Noah', 'Kai', 'Milo', 'Rio', 'Aden', 'Zane', 'Ari', 'Cruz', 'Ezra'],
			family: ['Marsh', 'Okada', 'Silva', 'Byrne', 'Costa', 'Ferrari', 'Nakano', 'Rivera', 'Hale', 'Duval']
		},
		{
			heritage: 'pacific_islander',
			female: ['Moana', 'Leilani', 'Tia', 'Vaea', 'Sina', 'Mele', 'Hina', 'Anahera', 'Lani', 'Talia'],
			male: ['Tane', 'Sione', 'Manaia', 'Rangi', 'Ioane', 'Filipo', 'Kalani', 'Tama', 'Nikau', 'Viliami'],
			family: ['Tupou', 'Faletau', 'Kealoha', 'Ngata', 'Tuilagi', 'Havili', 'Rongo', 'Latu', 'Pouri', 'Vaka']
		},
		{
			heritage: 'caribbean',
			female: ['Shanice', 'Kaya', 'Tamara', 'Junette', 'Marissa', 'Danielle', 'Alanna', 'Simone', 'Nadine', 'Yolande'],
			male: ['Andre', 'Devon', 'Kwesi', 'Ricardo', 'Trevon', 'Omari', 'Jamal', 'Everton', 'Dwayne', 'Kemar'],
			family: ['Campbell', 'Beaumont', 'Charles', 'Joseph', 'Providence', 'Baptiste', 'Grant', 'Pierre', 'Simms', 'Blaine']
		},
		{
			heritage: 'native_american',
			female: ['Aiyana', 'Winona', 'Tala', 'Nizhoni', 'Kai', 'Halona', 'Shayla', 'Dyani', 'Awinita', 'Chenoa'],
			male: ['Dakota', 'Kaya', 'Nash', 'Elan', 'Tokala', 'Chayton', 'Hototo', 'Mato', 'Ahiga', 'Kai'],
			family: ['Redcloud', 'Whitehorse', 'Yazzie', 'Begay', 'Standing Bear', 'Littlehawk', 'Tallchief', 'Runningwater', 'Blackfeather', 'Silvermoon']
		},
		{
			heritage: 'central_asian',
			female: ['Aigerim', 'Dilnoza', 'Madina', 'Nargiza', 'Zarina', 'Gulnara', 'Aida', 'Saule', 'Kamila', 'Nilufar'],
			male: ['Timur', 'Azamat', 'Ruslan', 'Bekzat', 'Islom', 'Daniyar', 'Aibek', 'Farrukh', 'Nurlan', 'Sanjar'],
			family: ['Abenov', 'Karimov', 'Tashkentov', 'Yusupov', 'Nazarbayev', 'Rakhimov', 'Bekova', 'Ismailov', 'Alimov', 'Turgunov']
		}
	],

	heritage: {
		group: 'heritage',
		entries: [
			{ token: 'white', weight: 22 },
			{ token: 'east_asian', weight: 12 },
			{ token: 'southeast_asian', weight: 11 },
			{ token: 'south_asian', weight: 12 },
			{ token: 'black_african', weight: 12 },
			{ token: 'hispanic', weight: 12 },
			{ token: 'middle_eastern', weight: 8 },
			{ token: 'mixed', weight: 7 },
			{ token: 'pacific_islander', weight: 2 },
			{ token: 'caribbean', weight: 1 },
			{ token: 'native_american', weight: 1 },
			{ token: 'central_asian', weight: 1 }
		]
	},

	education: {
		group: 'education',
		entries: [
			{ token: 'secondary', weight: 18 },
			{ token: 'trade_certificate', weight: 20 },
			{ token: 'some_tertiary', weight: 18 },
			{ token: 'bachelor', weight: 32 },
			{ token: 'postgraduate', weight: 12, gates: { minAge: 24 } }
		]
	},

	employmentStatus: {
		group: 'employmentStatus',
		entries: [
			{ token: 'employed_full_time', weight: 40 },
			{ token: 'employed_part_time', weight: 16 },
			{ token: 'self_employed', weight: 24 },
			{ token: 'student', weight: 8, gates: { maxAge: 28 } },
			{ token: 'homemaker', weight: 6, gates: { hasChildren: true } },
			{ token: 'between_jobs', weight: 4 },
			{ token: 'retired', weight: 2, gates: { minAge: 60 } }
		]
	},

	workLocationMode: {
		group: 'workLocationMode',
		entries: [
			{ token: 'on_site', weight: 40 },
			{ token: 'hybrid', weight: 35 },
			{ token: 'remote', weight: 25 }
		]
	},

	seniority: {
		group: 'seniority',
		entries: [
			{ token: 'entry', weight: 25, gates: { maxAge: 30 } },
			{ token: 'mid', weight: 35, gates: { minAge: 24 } },
			{ token: 'senior', weight: 22, gates: { minAge: 30 } },
			{ token: 'lead', weight: 10, gates: { minAge: 34 } },
			{ token: 'owner', weight: 8, gates: { minAge: 26 } }
		]
	},

	// Occupations carry niche affinity so a fitness creator plausibly works in
	// fitness — the credibility the old model had no field for.
	occupations: [
		{ title: 'Personal Trainer', domain: 'fitness_wellness', weight: 10, gates: { niches: ['fitness_health'] } },
		{ title: 'Physiotherapist', domain: 'health_care', weight: 8, gates: { niches: ['fitness_health'], educations: ['bachelor', 'postgraduate'] } },
		{ title: 'Yoga Instructor', domain: 'fitness_wellness', weight: 7, gates: { niches: ['fitness_health', 'lifestyle'] } },
		{ title: 'Nurse', domain: 'health_care', weight: 8, gates: { niches: ['fitness_health', 'beauty_wellness', 'parenting_family'] } },
		{ title: 'Dietitian', domain: 'health_care', weight: 6, gates: { niches: ['fitness_health', 'food_cooking'], educations: ['bachelor', 'postgraduate'] } },
		{ title: 'Makeup Artist', domain: 'beauty_personal_care', weight: 10, gates: { niches: ['beauty_wellness', 'fashion_style'] } },
		{ title: 'Hairstylist', domain: 'beauty_personal_care', weight: 8, gates: { niches: ['beauty_wellness', 'fashion_style'] } },
		{ title: 'Cosmetic Chemist', domain: 'science_research', weight: 5, gates: { niches: ['beauty_wellness'], educations: ['bachelor', 'postgraduate'] } },
		{ title: 'Software Engineer', domain: 'technology', weight: 10, gates: { niches: ['tech_ai', 'gaming_esports'] } },
		{ title: 'Product Designer', domain: 'technology', weight: 7, gates: { niches: ['tech_ai', 'arts_creativity'] } },
		{ title: 'Data Analyst', domain: 'technology', weight: 6, gates: { niches: ['tech_ai', 'finance_business'] } },
		{ title: 'Chef', domain: 'hospitality_food', weight: 10, gates: { niches: ['food_cooking'] } },
		{ title: 'Pastry Cook', domain: 'hospitality_food', weight: 6, gates: { niches: ['food_cooking'] } },
		{ title: 'Café Owner', domain: 'hospitality_food', weight: 6, gates: { niches: ['food_cooking', 'lifestyle'], seniorities: ['owner'] } },
		{ title: 'Stylist', domain: 'creative_media', weight: 8, gates: { niches: ['fashion_style'] } },
		{ title: 'Photographer', domain: 'creative_media', weight: 8, gates: { niches: ['fashion_style', 'travel_adventure', 'arts_creativity'] } },
		{ title: 'Videographer', domain: 'creative_media', weight: 7, gates: { niches: ['entertainment_pop_culture', 'travel_adventure'] } },
		{ title: 'Graphic Designer', domain: 'creative_media', weight: 7, gates: { niches: ['arts_creativity', 'tech_ai'] } },
		{ title: 'Financial Adviser', domain: 'finance_admin', weight: 7, gates: { niches: ['finance_business'], educations: ['bachelor', 'postgraduate'] } },
		{ title: 'Accountant', domain: 'finance_admin', weight: 6, gates: { niches: ['finance_business'] } },
		{ title: 'Marketing Manager', domain: 'marketing_sales', weight: 8, gates: { niches: ['finance_business', 'tech_ai', 'lifestyle'] } },
		{ title: 'Primary School Teacher', domain: 'education', weight: 8, gates: { niches: ['education_learning', 'parenting_family'], educations: ['bachelor', 'postgraduate'] } },
		{ title: 'Tutor', domain: 'education', weight: 6, gates: { niches: ['education_learning'] } },
		{ title: 'Carpenter', domain: 'trades_construction', weight: 8, gates: { niches: ['home_diy'], educations: ['trade_certificate', 'secondary'] } },
		{ title: 'Interior Designer', domain: 'creative_media', weight: 7, gates: { niches: ['home_diy', 'lifestyle'] } },
		{ title: 'Landscape Gardener', domain: 'agriculture_environment', weight: 6, gates: { niches: ['home_diy', 'sustainability_eco'] } },
		{ title: 'Veterinary Nurse', domain: 'health_care', weight: 8, gates: { niches: ['pets_animals'] } },
		{ title: 'Dog Trainer', domain: 'sports_outdoors', weight: 7, gates: { niches: ['pets_animals'] } },
		{ title: 'Sustainability Consultant', domain: 'agriculture_environment', weight: 6, gates: { niches: ['sustainability_eco'], educations: ['bachelor', 'postgraduate'] } },
		{ title: 'Mechanic', domain: 'automotive_transport', weight: 8, gates: { niches: ['automotive'], educations: ['trade_certificate', 'secondary'] } },
		{ title: 'Travel Agent', domain: 'hospitality_food', weight: 5, gates: { niches: ['travel_adventure'] } },
		{ title: 'Outdoor Guide', domain: 'sports_outdoors', weight: 6, gates: { niches: ['travel_adventure', 'sports'] } },
		{ title: 'Sports Coach', domain: 'sports_outdoors', weight: 7, gates: { niches: ['sports', 'fitness_health'] } },
		{ title: 'Musician', domain: 'arts_entertainment', weight: 6, gates: { niches: ['arts_creativity', 'entertainment_pop_culture'] } },
		{ title: 'Illustrator', domain: 'arts_entertainment', weight: 6, gates: { niches: ['arts_creativity'] } },
		{ title: 'Community Worker', domain: 'public_service', weight: 5, gates: { niches: ['parenting_family', 'education_learning'] } },
		// Niche-agnostic fallbacks so every combination can always fill.
		{ title: 'Retail Manager', domain: 'retail_ecommerce', weight: 4 },
		{ title: 'Customer Support Lead', domain: 'retail_ecommerce', weight: 3 },
		{ title: 'Administrator', domain: 'finance_admin', weight: 3 },
		{ title: 'Freelance Content Creator', domain: 'creative_media', weight: 5 }
	],

	incomeBand: {
		group: 'incomeBand',
		entries: [
			{ token: 'low', weight: 12 },
			{ token: 'lower_middle', weight: 22 },
			{ token: 'middle', weight: 34 },
			{ token: 'upper_middle', weight: 22, gates: { educations: ['bachelor', 'postgraduate', 'trade_certificate'] } },
			{ token: 'high', weight: 10, gates: { seniorities: ['senior', 'lead', 'owner'] } }
		]
	},

	priceFrame: {
		group: 'priceFrame',
		entries: [
			{ token: 'budget', weight: 22, gates: { incomeBands: ['low', 'lower_middle'] } },
			{ token: 'value', weight: 38 },
			{ token: 'premium', weight: 28, gates: { incomeBands: ['middle', 'upper_middle', 'high'] } },
			{ token: 'luxury', weight: 12, gates: { incomeBands: ['upper_middle', 'high'] } }
		]
	},

	relationshipStatus: {
		group: 'relationshipStatus',
		entries: [
			{ token: 'single', weight: 30 },
			{ token: 'dating', weight: 14, gates: { maxAge: 45 } },
			{ token: 'partnered', weight: 24 },
			{ token: 'married', weight: 28, gates: { minAge: 24 } },
			{ token: 'separated', weight: 3, gates: { minAge: 30 } },
			{ token: 'widowed', weight: 1, gates: { minAge: 50 } }
		]
	},

	childAgeBand: {
		group: 'childAgeBand',
		entries: [
			{ token: 'baby', weight: 18 },
			{ token: 'toddler', weight: 22 },
			{ token: 'primary', weight: 26 },
			{ token: 'teen', weight: 22 },
			{ token: 'adult', weight: 12 }
		]
	},

	housingType: {
		group: 'housingType',
		entries: [
			{ token: 'apartment_rented', weight: 26 },
			{ token: 'house_rented', weight: 20 },
			{ token: 'share_house', weight: 10, gates: { maxAge: 32 } },
			{ token: 'family_home', weight: 8, gates: { maxAge: 26 } },
			{ token: 'apartment_owned', weight: 14, gates: { minAge: 26, incomeBands: ['middle', 'upper_middle', 'high'] } },
			{ token: 'house_owned', weight: 22, gates: { minAge: 28, incomeBands: ['middle', 'upper_middle', 'high'] } }
		]
	},

	pet: {
		group: 'pet',
		entries: [
			{ token: 'dog', weight: 38 },
			{ token: 'cat', weight: 34 },
			{ token: 'small_pet', weight: 10 },
			{ token: 'bird', weight: 7 },
			{ token: 'fish', weight: 7 },
			{ token: 'reptile', weight: 3 },
			{ token: 'horse', weight: 1, gates: { incomeBands: ['upper_middle', 'high'] } }
		]
	},

	activityLevel: {
		group: 'activityLevel',
		entries: [
			{ token: 'sedentary', weight: 12 },
			{ token: 'light', weight: 24 },
			{ token: 'moderate', weight: 34 },
			{ token: 'active', weight: 22 },
			{ token: 'athlete', weight: 8, gates: { niches: ['fitness_health', 'sports'] } }
		]
	},

	transportMode: {
		group: 'transportMode',
		entries: [
			{ token: 'car', weight: 44 },
			{ token: 'public_transport', weight: 26 },
			{ token: 'bike', weight: 14 },
			{ token: 'walk', weight: 10 },
			{ token: 'rideshare', weight: 6 }
		]
	},

	dietaryStyle: {
		group: 'dietaryStyle',
		entries: [
			{ token: 'omnivore', weight: 52 },
			{ token: 'flexitarian', weight: 18 },
			{ token: 'vegetarian', weight: 12 },
			{ token: 'vegan', weight: 6 },
			{ token: 'pescatarian', weight: 6 },
			{ token: 'gluten_free', weight: 3 },
			{ token: 'halal', weight: 2 },
			{ token: 'kosher', weight: 1 }
		]
	},

	languages: ['English'],

	// Positioning defaults. The model normally writes these, but a persona
	// created without a provider must still be complete rather than half-blank,
	// so they are sampled like anything else — niche-gated where a pairing would
	// otherwise read as nonsense (a Finance creator as "The Entertainer").
	archetype: {
		group: 'archetype',
		entries: [
			{ token: 'relatable_friend', weight: 18 },
			{ token: 'educator', weight: 16 },
			{ token: 'expert_authority', weight: 14 },
			{ token: 'creator', weight: 12 },
			{ token: 'storyteller', weight: 10 },
			{ token: 'aspirational', weight: 9 },
			{ token: 'entertainer', weight: 8, gates: { niches: ['entertainment_pop_culture', 'gaming_esports', 'food_cooking', 'lifestyle', 'sports'] } },
			{ token: 'community_builder', weight: 6 },
			{ token: 'activist_advocate', weight: 5, gates: { niches: ['sustainability_eco', 'parenting_family', 'education_learning', 'beauty_wellness'] } },
			{ token: 'disruptor', weight: 4, gates: { niches: ['tech_ai', 'finance_business', 'automotive'] } }
		]
	},
	contentFocus: {
		group: 'contentFocus',
		entries: [
			{ token: 'education_how_tos', weight: 18 },
			{ token: 'product_reviews_ugc', weight: 16 },
			{ token: 'lifestyle_aesthetic', weight: 14 },
			{ token: 'tutorials_demos', weight: 12 },
			{ token: 'personal_journey', weight: 11 },
			{ token: 'inspiration_motivation', weight: 10 },
			{ token: 'behind_the_scenes', weight: 8 },
			{ token: 'entertainment_humor', weight: 7, gates: { niches: ['entertainment_pop_culture', 'gaming_esports', 'lifestyle', 'food_cooking'] } },
			{ token: 'news_commentary', weight: 4, gates: { niches: ['tech_ai', 'finance_business', 'sustainability_eco'] } }
		]
	},

	// Heritage-conditioned look weights. `default` covers any heritage without an
	// entry, so a new heritage token can never leave the sampler without a table.
	look: {
		default: {},
		white: {
			skinTone: { fair_light: 40, porcelain: 12, medium: 24, olive: 12, tan: 12 },
			eyeColor: { blue: 26, green: 14, hazel: 16, brown: 30, gray: 8, dark_brown: 6 },
			hairColor: { blonde: 22, light_brown: 26, dark_brown: 28, black: 8, auburn: 8, red: 6, platinum_blonde: 2 },
			hairTexture: { fine: 34, medium: 40, thick: 22, coarse: 4 }
		},
		east_asian: {
			skinTone: { fair_light: 30, porcelain: 14, medium: 40, olive: 12, tan: 4 },
			eyeColor: { dark_brown: 62, brown: 34, hazel: 4 },
			hairColor: { black: 74, dark_brown: 22, light_brown: 4 },
			hairTexture: { fine: 26, medium: 40, thick: 30, coarse: 4 }
		},
		southeast_asian: {
			skinTone: { medium: 38, tan: 26, olive: 16, bronze: 12, fair_light: 8 },
			eyeColor: { dark_brown: 66, brown: 32, hazel: 2 },
			hairColor: { black: 72, dark_brown: 24, auburn: 4 },
			hairTexture: { medium: 34, thick: 42, coarse: 20, fine: 4 }
		},
		south_asian: {
			skinTone: { medium: 24, tan: 24, bronze: 22, olive: 18, deep: 8, fair_light: 4 },
			eyeColor: { dark_brown: 64, brown: 28, hazel: 6, green: 2 },
			hairColor: { black: 70, dark_brown: 26, auburn: 4 },
			hairTexture: { thick: 44, medium: 30, coarse: 22, fine: 4 }
		},
		black_african: {
			skinTone: { deep: 38, dark: 30, bronze: 18, tan: 10, medium: 4 },
			eyeColor: { dark_brown: 70, brown: 26, hazel: 4 },
			hairColor: { black: 82, dark_brown: 16, auburn: 2 },
			hairTexture: { coarse: 48, thick: 36, medium: 14, fine: 2 }
		},
		hispanic: {
			skinTone: { medium: 30, olive: 24, tan: 22, fair_light: 14, bronze: 10 },
			eyeColor: { brown: 40, dark_brown: 36, hazel: 14, green: 6, blue: 4 },
			hairColor: { dark_brown: 44, black: 34, light_brown: 16, auburn: 6 },
			hairTexture: { medium: 36, thick: 38, coarse: 18, fine: 8 }
		},
		middle_eastern: {
			skinTone: { olive: 34, medium: 26, tan: 22, fair_light: 12, bronze: 6 },
			eyeColor: { dark_brown: 48, brown: 34, hazel: 12, green: 6 },
			hairColor: { black: 46, dark_brown: 42, light_brown: 8, auburn: 4 },
			hairTexture: { thick: 40, medium: 34, coarse: 20, fine: 6 }
		},
		pacific_islander: {
			skinTone: { bronze: 34, tan: 28, medium: 20, deep: 12, dark: 6 },
			eyeColor: { dark_brown: 68, brown: 28, hazel: 4 },
			hairColor: { black: 76, dark_brown: 20, auburn: 4 },
			hairTexture: { thick: 44, coarse: 32, medium: 22, fine: 2 }
		},
		caribbean: {
			skinTone: { bronze: 26, deep: 26, dark: 24, tan: 16, medium: 8 },
			eyeColor: { dark_brown: 64, brown: 28, hazel: 8 },
			hairColor: { black: 74, dark_brown: 22, auburn: 4 },
			hairTexture: { coarse: 44, thick: 36, medium: 18, fine: 2 }
		},
		native_american: {
			skinTone: { tan: 32, bronze: 28, medium: 24, deep: 10, olive: 6 },
			eyeColor: { dark_brown: 66, brown: 30, hazel: 4 },
			hairColor: { black: 72, dark_brown: 24, auburn: 4 },
			hairTexture: { thick: 46, medium: 30, coarse: 22, fine: 2 }
		},
		central_asian: {
			skinTone: { fair_light: 24, medium: 32, olive: 22, tan: 16, bronze: 6 },
			eyeColor: { dark_brown: 44, brown: 34, hazel: 12, green: 6, blue: 4 },
			hairColor: { dark_brown: 46, black: 40, light_brown: 10, auburn: 4 },
			hairTexture: { thick: 40, medium: 36, coarse: 18, fine: 6 }
		},
		mixed: {
			skinTone: { medium: 26, tan: 22, olive: 16, bronze: 16, fair_light: 12, deep: 8 },
			eyeColor: { brown: 34, dark_brown: 30, hazel: 18, green: 10, blue: 8 },
			hairColor: { dark_brown: 38, black: 28, light_brown: 20, auburn: 8, blonde: 6 },
			hairTexture: { medium: 34, thick: 34, coarse: 22, fine: 10 }
		}
	},

	// Base look tables, used when a heritage prior does not cover the group.
	// Where a prior DOES cover a group it is authoritative — only the tokens it
	// lists can be drawn — so a heritage cannot leak an implausible tone through
	// a base weight. See registry.pickLook.
	skinTone: {
		group: 'skinTone',
		entries: [
			{ token: 'fair_light', weight: 10 },
			{ token: 'porcelain', weight: 4 },
			{ token: 'medium', weight: 10 },
			{ token: 'olive', weight: 8 },
			{ token: 'tan', weight: 8 },
			{ token: 'bronze', weight: 6 },
			{ token: 'dark', weight: 6 },
			{ token: 'deep', weight: 6 }
		]
	},
	eyeColor: {
		group: 'eyeColor',
		entries: [
			{ token: 'brown', weight: 10 },
			{ token: 'dark_brown', weight: 10 },
			{ token: 'hazel', weight: 6 },
			{ token: 'green', weight: 4 },
			{ token: 'blue', weight: 5 },
			{ token: 'amber', weight: 2 },
			{ token: 'gray', weight: 2 }
		]
	},
	bodyType: {
		group: 'bodyType',
		entries: [
			{ token: 'average', weight: 26 },
			{ token: 'slim', weight: 20 },
			{ token: 'athletic', weight: 18, gates: { niches: ['fitness_health', 'sports'] } },
			{ token: 'curvy', weight: 16 },
			{ token: 'petite', weight: 8 },
			{ token: 'muscular', weight: 6, gates: { niches: ['fitness_health', 'sports'] } },
			{ token: 'plus_size', weight: 10 },
			{ token: 'tall_lean', weight: 8 }
		]
	},
	hairLength: {
		group: 'hairLength',
		entries: [
			{ token: 'long', weight: 22 },
			{ token: 'shoulder_length', weight: 20 },
			{ token: 'medium', weight: 18 },
			{ token: 'short', weight: 18 },
			{ token: 'chin_length', weight: 10 },
			{ token: 'pixie', weight: 6 },
			{ token: 'waist_length', weight: 6 }
		]
	},
	hairstyle: {
		group: 'hairstyle',
		entries: [
			{ token: 'straight', weight: 24 },
			{ token: 'wavy', weight: 24 },
			{ token: 'curly', weight: 16 },
			{ token: 'coily', weight: 8 },
			{ token: 'braided', weight: 8 },
			{ token: 'ponytail', weight: 8 },
			{ token: 'sleek_bun', weight: 6 },
			{ token: 'afro', weight: 4 },
			{ token: 'locs', weight: 4 },
			{ token: 'bald_shaved', weight: 3 }
		]
	},
	hairColor: {
		group: 'hairColor',
		entries: [
			{ token: 'dark_brown', weight: 10 },
			{ token: 'black', weight: 10 },
			{ token: 'light_brown', weight: 8 },
			{ token: 'blonde', weight: 6 },
			{ token: 'auburn', weight: 4 },
			{ token: 'red', weight: 2 },
			{ token: 'platinum_blonde', weight: 2 },
			{ token: 'silver_gray', weight: 2, gates: { minAge: 45 } }
		]
	},
	hairTexture: {
		group: 'hairTexture',
		entries: [
			{ token: 'fine', weight: 8 },
			{ token: 'medium', weight: 10 },
			{ token: 'thick', weight: 9 },
			{ token: 'coarse', weight: 6 }
		]
	},
	faceShape: {
		group: 'faceShape',
		entries: [
			{ token: 'oval', weight: 26 },
			{ token: 'round', weight: 20 },
			{ token: 'square', weight: 16 },
			{ token: 'heart', weight: 16 },
			{ token: 'long', weight: 14 },
			{ token: 'diamond', weight: 8 }
		]
	},
	browShape: {
		group: 'browShape',
		entries: [
			{ token: 'soft_arch', weight: 32 },
			{ token: 'straight', weight: 24 },
			{ token: 'high_arch', weight: 18 },
			{ token: 'thick', weight: 18 },
			{ token: 'thin', weight: 8 }
		]
	},
	// ── decisioning ──────────────────────────────────────────────────────────
	// CURATED PLAUSIBILITY WEIGHTS, NOT CONSUMER RESEARCH. They exist so a panel
	// of viewers disagrees with a draft in several different ways, not so the
	// spread matches any measured market. Nobody should cite these as data.
	//
	// The gates carry the one hard rule: a buying style must never contradict
	// the viewer wearing it. A 'low' income cannot be 'price_insensitive' or
	// 'promo_averse'. Every table keeps one UNGATED middle entry, so no income
	// band or age can ever empty the table and fall back to the ungated pool —
	// which is what would let a gated-out token be drawn after all.

	priceSensitivity: {
		group: 'priceSensitivity',
		entries: [
			{ token: 'price_led', weight: 26, gates: { incomeBands: ['low', 'lower_middle', 'middle'] } },
			{ token: 'value_led', weight: 40 },
			{
				token: 'quality_led',
				weight: 26,
				gates: { incomeBands: ['middle', 'upper_middle', 'high'] }
			},
			{ token: 'price_insensitive', weight: 8, gates: { incomeBands: ['upper_middle', 'high'] } }
		]
	},

	purchaseChannel: {
		group: 'purchaseChannel',
		entries: [
			{ token: 'online_first', weight: 32 },
			{ token: 'in_store_first', weight: 22, gates: { minAge: 30 } },
			{
				token: 'marketplace',
				weight: 16,
				gates: { incomeBands: ['low', 'lower_middle', 'middle'] }
			},
			{ token: 'social_commerce', weight: 16, gates: { maxAge: 44 } },
			{ token: 'mixed', weight: 24 }
		]
	},

	brandLoyalty: {
		group: 'brandLoyalty',
		entries: [
			{ token: 'loyal', weight: 34, gates: { minAge: 30 } },
			{ token: 'switcher', weight: 36 },
			{ token: 'explorer', weight: 30, gates: { maxAge: 54 } }
		]
	},

	promoResponsiveness: {
		group: 'promoResponsiveness',
		entries: [
			{
				token: 'deal_driven',
				weight: 34,
				gates: { incomeBands: ['low', 'lower_middle', 'middle'] }
			},
			{ token: 'occasional', weight: 46 },
			{ token: 'promo_averse', weight: 14, gates: { incomeBands: ['upper_middle', 'high'] } }
		]
	},

	messageProcessingStyle: {
		group: 'messageProcessingStyle',
		entries: [
			{ token: 'analytical', weight: 24 },
			{ token: 'intuitive', weight: 26 },
			{ token: 'social_proof', weight: 28, gates: { maxAge: 59 } },
			{ token: 'emotional', weight: 22 }
		]
	},

	communicationPreference: {
		group: 'communicationPreference',
		entries: [
			{ token: 'evidence_led', weight: 26 },
			{ token: 'story_led', weight: 28 },
			{ token: 'visual_led', weight: 26, gates: { maxAge: 59 } },
			{ token: 'peer_led', weight: 20, gates: { maxAge: 49 } }
		]
	},

	digitalCapability: {
		group: 'digitalCapability',
		entries: [
			{ token: 'basic', weight: 18, gates: { minAge: 50 } },
			{ token: 'confident', weight: 52 },
			{ token: 'advanced', weight: 30, gates: { maxAge: 59 } }
		]
	}
};
