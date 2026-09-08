/**
 * Trait Registry — UNITED KINGDOM.
 *
 * CURATED PLAUSIBILITY WEIGHTS, NOT CENSUS STATISTICS.
 *
 * Local only: places with real timezones, a heritage mix, names, languages, and
 * a lower car dependence than AU/US. Everything else comes from `generic`.
 *
 * Client-safe.
 */
import type { MarketRegistry } from './types';

export const UK: MarketRegistry = {
	market: 'uk',

	regions: [
		{
			name: 'Greater London',
			weight: 26,
			cities: [
				{ name: 'London', geographicContext: 'urban', timezone: 'Europe/London', weight: 70 },
				{ name: 'Croydon', geographicContext: 'suburban', timezone: 'Europe/London', weight: 15 },
				{ name: 'Ealing', geographicContext: 'suburban', timezone: 'Europe/London', weight: 15 }
			]
		},
		{
			name: 'North West England',
			weight: 15,
			cities: [
				{ name: 'Manchester', geographicContext: 'urban', timezone: 'Europe/London', weight: 50 },
				{ name: 'Liverpool', geographicContext: 'urban', timezone: 'Europe/London', weight: 35 },
				{ name: 'Preston', geographicContext: 'regional', timezone: 'Europe/London', weight: 15 }
			]
		},
		{
			name: 'West Midlands',
			weight: 12,
			cities: [
				{ name: 'Birmingham', geographicContext: 'urban', timezone: 'Europe/London', weight: 70 },
				{ name: 'Coventry', geographicContext: 'regional', timezone: 'Europe/London', weight: 30 }
			]
		},
		{
			name: 'Yorkshire',
			weight: 11,
			cities: [
				{ name: 'Leeds', geographicContext: 'urban', timezone: 'Europe/London', weight: 50 },
				{ name: 'Sheffield', geographicContext: 'urban', timezone: 'Europe/London', weight: 30 },
				{ name: 'York', geographicContext: 'regional', timezone: 'Europe/London', weight: 20 }
			]
		},
		{
			name: 'Scotland',
			weight: 10,
			cities: [
				{ name: 'Glasgow', geographicContext: 'urban', timezone: 'Europe/London', weight: 45 },
				{ name: 'Edinburgh', geographicContext: 'urban', timezone: 'Europe/London', weight: 40 },
				{ name: 'Inverness', geographicContext: 'rural', timezone: 'Europe/London', weight: 15 }
			]
		},
		{
			name: 'South East England',
			weight: 12,
			cities: [
				{ name: 'Brighton', geographicContext: 'urban', timezone: 'Europe/London', weight: 45 },
				{ name: 'Reading', geographicContext: 'suburban', timezone: 'Europe/London', weight: 30 },
				{ name: 'Canterbury', geographicContext: 'regional', timezone: 'Europe/London', weight: 25 }
			]
		},
		{
			name: 'Wales',
			weight: 7,
			cities: [
				{ name: 'Cardiff', geographicContext: 'urban', timezone: 'Europe/London', weight: 65 },
				{ name: 'Swansea', geographicContext: 'regional', timezone: 'Europe/London', weight: 35 }
			]
		},
		{
			name: 'Northern Ireland',
			weight: 4,
			cities: [{ name: 'Belfast', geographicContext: 'urban', timezone: 'Europe/London', weight: 100 }]
		},
		{
			name: 'South West England',
			weight: 3,
			cities: [
				{ name: 'Bristol', geographicContext: 'urban', timezone: 'Europe/London', weight: 70 },
				{ name: 'Exeter', geographicContext: 'regional', timezone: 'Europe/London', weight: 30 }
			]
		}
	],

	heritage: {
		group: 'heritage',
		entries: [
			{ token: 'white', weight: 52 },
			{ token: 'south_asian', weight: 16 },
			{ token: 'black_african', weight: 9 },
			{ token: 'caribbean', weight: 5 },
			{ token: 'mixed', weight: 7 },
			{ token: 'east_asian', weight: 4 },
			{ token: 'middle_eastern', weight: 4 },
			{ token: 'southeast_asian', weight: 2 },
			{ token: 'hispanic', weight: 1 },
			{ token: 'central_asian', weight: 0 },
			{ token: 'pacific_islander', weight: 0 },
			{ token: 'native_american', weight: 0 }
		]
	},

	names: [
		{
			heritage: 'white',
			female: ['Amelia', 'Olivia', 'Freya', 'Poppy', 'Daisy', 'Imogen', 'Nell', 'Bethan', 'Rosie', 'Elsie'],
			male: ['Harry', 'Alfie', 'Callum', 'Rhys', 'Ewan', 'Archie', 'Freddie', 'Reuben', 'Seb', 'Fraser'],
			family: ['Whitaker', 'Hollins', 'Ashworth', 'Pemberton', 'Gallagher', 'Rowntree', 'Beckett', 'Hargrave', 'Sinclair', 'Marchetti']
		},
		{
			heritage: 'caribbean',
			female: ['Shanice', 'Marcia', 'Nadine', 'Simone', 'Yolande', 'Denise', 'Alanna', 'Tamara', 'Junette', 'Cherise'],
			male: ['Everton', 'Delroy', 'Kemar', 'Andre', 'Winston', 'Dwayne', 'Omari', 'Trevon', 'Leroy', 'Ricardo'],
			family: ['Campbell', 'Grant', 'Bennett', 'Providence', 'Baptiste', 'Simms', 'Charles', 'Blaine', 'Joseph', 'Beaumont']
		}
	],

	languages: ['English', 'Polish', 'Punjabi', 'Urdu', 'Bengali', 'Welsh', 'Gujarati', 'Arabic'],

	transportMode: {
		group: 'transportMode',
		entries: [
			{ token: 'car', weight: 40 },
			{ token: 'public_transport', weight: 34 },
			{ token: 'walk', weight: 14 },
			{ token: 'bike', weight: 8 },
			{ token: 'rideshare', weight: 4 }
		]
	}
};
