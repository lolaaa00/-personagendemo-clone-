/**
 * Trait Registry — UNITED STATES.
 *
 * CURATED PLAUSIBILITY WEIGHTS, NOT CENSUS STATISTICS.
 *
 * Local only: places with real timezones, a heritage mix, names, languages, and
 * the higher car dependence. Everything else comes from `generic`.
 *
 * Client-safe.
 */
import type { MarketRegistry } from './types';

export const US: MarketRegistry = {
	market: 'us',

	regions: [
		{
			name: 'California',
			weight: 18,
			cities: [
				{ name: 'Los Angeles', geographicContext: 'urban', timezone: 'America/Los_Angeles', weight: 40 },
				{ name: 'San Diego', geographicContext: 'urban', timezone: 'America/Los_Angeles', weight: 20 },
				{ name: 'San Jose', geographicContext: 'suburban', timezone: 'America/Los_Angeles', weight: 20 },
				{ name: 'Fresno', geographicContext: 'regional', timezone: 'America/Los_Angeles', weight: 20 }
			]
		},
		{
			name: 'Texas',
			weight: 15,
			cities: [
				{ name: 'Austin', geographicContext: 'urban', timezone: 'America/Chicago', weight: 30 },
				{ name: 'Houston', geographicContext: 'urban', timezone: 'America/Chicago', weight: 30 },
				{ name: 'Dallas', geographicContext: 'urban', timezone: 'America/Chicago', weight: 25 },
				{ name: 'Lubbock', geographicContext: 'regional', timezone: 'America/Chicago', weight: 15 }
			]
		},
		{
			name: 'New York',
			weight: 13,
			cities: [
				{ name: 'Brooklyn', geographicContext: 'urban', timezone: 'America/New_York', weight: 45 },
				{ name: 'Queens', geographicContext: 'urban', timezone: 'America/New_York', weight: 25 },
				{ name: 'Buffalo', geographicContext: 'regional', timezone: 'America/New_York', weight: 15 },
				{ name: 'Yonkers', geographicContext: 'suburban', timezone: 'America/New_York', weight: 15 }
			]
		},
		{
			name: 'Florida',
			weight: 12,
			cities: [
				{ name: 'Miami', geographicContext: 'urban', timezone: 'America/New_York', weight: 40 },
				{ name: 'Orlando', geographicContext: 'suburban', timezone: 'America/New_York', weight: 30 },
				{ name: 'Tampa', geographicContext: 'urban', timezone: 'America/New_York', weight: 30 }
			]
		},
		{
			name: 'Illinois',
			weight: 9,
			cities: [
				{ name: 'Chicago', geographicContext: 'urban', timezone: 'America/Chicago', weight: 70 },
				{ name: 'Naperville', geographicContext: 'suburban', timezone: 'America/Chicago', weight: 30 }
			]
		},
		{
			name: 'Georgia',
			weight: 8,
			cities: [
				{ name: 'Atlanta', geographicContext: 'urban', timezone: 'America/New_York', weight: 65 },
				{ name: 'Savannah', geographicContext: 'regional', timezone: 'America/New_York', weight: 35 }
			]
		},
		{
			name: 'Washington',
			weight: 7,
			cities: [
				{ name: 'Seattle', geographicContext: 'urban', timezone: 'America/Los_Angeles', weight: 70 },
				{ name: 'Spokane', geographicContext: 'regional', timezone: 'America/Los_Angeles', weight: 30 }
			]
		},
		{
			name: 'Colorado',
			weight: 6,
			cities: [
				{ name: 'Denver', geographicContext: 'urban', timezone: 'America/Denver', weight: 70 },
				{ name: 'Boulder', geographicContext: 'suburban', timezone: 'America/Denver', weight: 30 }
			]
		},
		{
			name: 'North Carolina',
			weight: 6,
			cities: [
				{ name: 'Charlotte', geographicContext: 'urban', timezone: 'America/New_York', weight: 60 },
				{ name: 'Asheville', geographicContext: 'regional', timezone: 'America/New_York', weight: 40 }
			]
		},
		{
			name: 'Arizona',
			weight: 6,
			cities: [
				{ name: 'Phoenix', geographicContext: 'urban', timezone: 'America/Phoenix', weight: 70 },
				{ name: 'Tucson', geographicContext: 'regional', timezone: 'America/Phoenix', weight: 30 }
			]
		}
	],

	heritage: {
		group: 'heritage',
		entries: [
			{ token: 'white', weight: 38 },
			{ token: 'hispanic', weight: 19 },
			{ token: 'black_african', weight: 14 },
			{ token: 'east_asian', weight: 7 },
			{ token: 'south_asian', weight: 6 },
			{ token: 'southeast_asian', weight: 5 },
			{ token: 'mixed', weight: 6 },
			{ token: 'middle_eastern', weight: 2 },
			{ token: 'caribbean', weight: 2 },
			{ token: 'native_american', weight: 1 },
			{ token: 'pacific_islander', weight: 0 },
			{ token: 'central_asian', weight: 0 }
		]
	},

	names: [
		{
			heritage: 'white',
			female: ['Emily', 'Madison', 'Abigail', 'Hailey', 'Brooke', 'Paige', 'Kaitlyn', 'Sydney', 'Morgan', 'Peyton'],
			male: ['Tyler', 'Brandon', 'Austin', 'Cody', 'Dylan', 'Hunter', 'Mason', 'Colton', 'Jared', 'Blake'],
			family: ['Miller', 'Anderson', 'Thompson', 'Harris', 'Sullivan', 'Bradley', 'Coleman', 'Reynolds', 'Schmidt', 'Vaughn']
		},
		{
			heritage: 'black_african',
			female: ['Jasmine', 'Imani', 'Kiara', 'Nia', 'Alaya', 'Destiny', 'Zaria', 'Camille', 'Tiana', 'Amara'],
			male: ['Marcus', 'Darius', 'Jalen', 'Andre', 'Terrance', 'Malik', 'Isaiah', 'Devin', 'Xavier', 'Amari'],
			family: ['Williams', 'Jackson', 'Washington', 'Coleman', 'Brooks', 'Gaines', 'Whitfield', 'Baldwin', 'Freeman', 'Dupree']
		}
	],

	languages: ['English', 'Spanish', 'Mandarin', 'Tagalog', 'Vietnamese', 'Arabic', 'French', 'Korean'],

	transportMode: {
		group: 'transportMode',
		entries: [
			{ token: 'car', weight: 62 },
			{ token: 'public_transport', weight: 18 },
			{ token: 'rideshare', weight: 8 },
			{ token: 'walk', weight: 7 },
			{ token: 'bike', weight: 5 }
		]
	}
};
