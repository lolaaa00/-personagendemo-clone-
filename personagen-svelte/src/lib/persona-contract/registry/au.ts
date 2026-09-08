/**
 * Trait Registry — AUSTRALIA. The product's default market (`agents.market` has
 * defaulted to 'Australia' since the schema was written; confirmed 2026-09-07).
 *
 * CURATED PLAUSIBILITY WEIGHTS, NOT CENSUS STATISTICS.
 *
 * Only what is genuinely local lives here: places with real timezones, a
 * heritage mix that reflects who actually lives here, family names that read
 * Australian, and the languages a creator might speak. Everything else — work,
 * income, household, look — comes from `generic`.
 *
 * Client-safe.
 */
import type { MarketRegistry } from './types';

export const AU: MarketRegistry = {
	market: 'au',

	regions: [
		{
			name: 'New South Wales',
			weight: 32,
			cities: [
				{ name: 'Sydney', geographicContext: 'urban', timezone: 'Australia/Sydney', weight: 55 },
				{ name: 'Newcastle', geographicContext: 'regional', timezone: 'Australia/Sydney', weight: 15 },
				{ name: 'Wollongong', geographicContext: 'regional', timezone: 'Australia/Sydney', weight: 12 },
				{ name: 'Parramatta', geographicContext: 'suburban', timezone: 'Australia/Sydney', weight: 12 },
				{ name: 'Byron Bay', geographicContext: 'regional', timezone: 'Australia/Sydney', weight: 6 }
			]
		},
		{
			name: 'Victoria',
			weight: 26,
			cities: [
				{ name: 'Melbourne', geographicContext: 'urban', timezone: 'Australia/Melbourne', weight: 62 },
				{ name: 'Geelong', geographicContext: 'regional', timezone: 'Australia/Melbourne', weight: 16 },
				{ name: 'Ballarat', geographicContext: 'regional', timezone: 'Australia/Melbourne', weight: 10 },
				{ name: 'Frankston', geographicContext: 'suburban', timezone: 'Australia/Melbourne', weight: 12 }
			]
		},
		{
			name: 'Queensland',
			weight: 20,
			cities: [
				{ name: 'Brisbane', geographicContext: 'urban', timezone: 'Australia/Brisbane', weight: 46 },
				{ name: 'Gold Coast', geographicContext: 'suburban', timezone: 'Australia/Brisbane', weight: 26 },
				{ name: 'Sunshine Coast', geographicContext: 'regional', timezone: 'Australia/Brisbane', weight: 16 },
				{ name: 'Townsville', geographicContext: 'regional', timezone: 'Australia/Brisbane', weight: 12 }
			]
		},
		{
			name: 'Western Australia',
			weight: 10,
			cities: [
				{ name: 'Perth', geographicContext: 'urban', timezone: 'Australia/Perth', weight: 78 },
				{ name: 'Fremantle', geographicContext: 'suburban', timezone: 'Australia/Perth', weight: 14 },
				{ name: 'Bunbury', geographicContext: 'regional', timezone: 'Australia/Perth', weight: 8 }
			]
		},
		{
			name: 'South Australia',
			weight: 7,
			cities: [
				{ name: 'Adelaide', geographicContext: 'urban', timezone: 'Australia/Adelaide', weight: 84 },
				{ name: 'Mount Gambier', geographicContext: 'rural', timezone: 'Australia/Adelaide', weight: 16 }
			]
		},
		{
			name: 'Tasmania',
			weight: 3,
			cities: [
				{ name: 'Hobart', geographicContext: 'regional', timezone: 'Australia/Hobart', weight: 70 },
				{ name: 'Launceston', geographicContext: 'regional', timezone: 'Australia/Hobart', weight: 30 }
			]
		},
		{
			name: 'Australian Capital Territory',
			weight: 2,
			cities: [{ name: 'Canberra', geographicContext: 'urban', timezone: 'Australia/Sydney', weight: 100 }]
		}
	],

	// Reweighted for Australia: a large European-descended majority, a strong East
	// and Southeast Asian presence, meaningful South Asian and Middle Eastern
	// communities, and Pacific Islander representation well above the generic mix.
	heritage: {
		group: 'heritage',
		entries: [
			{ token: 'white', weight: 40 },
			{ token: 'east_asian', weight: 14 },
			{ token: 'southeast_asian', weight: 12 },
			{ token: 'south_asian', weight: 11 },
			{ token: 'middle_eastern', weight: 6 },
			{ token: 'mixed', weight: 6 },
			{ token: 'pacific_islander', weight: 5 },
			{ token: 'black_african', weight: 3 },
			{ token: 'hispanic', weight: 1 },
			{ token: 'native_american', weight: 0 },
			{ token: 'caribbean', weight: 0 },
			{ token: 'central_asian', weight: 2 }
		]
	},

	// Family names that read Australian for the two largest groups; the rest
	// inherit generic, which is already regionally appropriate.
	names: [
		{
			heritage: 'white',
			female: ['Chloe', 'Ruby', 'Isla', 'Matilda', 'Georgia', 'Harriet', 'Poppy', 'Sienna', 'Alice', 'Lily'],
			male: ['Jack', 'Ollie', 'Cooper', 'Angus', 'Hamish', 'Lachlan', 'Toby', 'Riley', 'Declan', 'Xavier'],
			family: ['Whitlock', 'Fitzgerald', 'Kennedy', 'Sutton', 'Barlow', 'Hargreaves', 'Callaghan', 'Doherty', 'Brennan', 'Ashcroft']
		},
		{
			heritage: 'pacific_islander',
			female: ['Anahera', 'Mele', 'Talia', 'Vaea', 'Sina', 'Moana', 'Lani', 'Hine', 'Ana', 'Tui'],
			male: ['Tane', 'Sione', 'Nikau', 'Rangi', 'Viliami', 'Manaia', 'Ioane', 'Tama', 'Filipo', 'Koa'],
			family: ['Tupou', 'Havili', 'Latu', 'Ngata', 'Tuilagi', 'Vaka', 'Faletau', 'Rongo', 'Kaitapu', 'Pouri']
		}
	],

	languages: ['English', 'Mandarin', 'Arabic', 'Vietnamese', 'Cantonese', 'Punjabi', 'Greek', 'Italian', 'Hindi', 'Tagalog'],

	// Car-dependent outside the big-city cores; strong public transport in Sydney
	// and Melbourne keeps that option meaningful.
	transportMode: {
		group: 'transportMode',
		entries: [
			{ token: 'car', weight: 54 },
			{ token: 'public_transport', weight: 24 },
			{ token: 'walk', weight: 10 },
			{ token: 'bike', weight: 8 },
			{ token: 'rideshare', weight: 4 }
		]
	}
};
