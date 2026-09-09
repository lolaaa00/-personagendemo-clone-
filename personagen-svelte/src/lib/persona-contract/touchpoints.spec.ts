/**
 * The touchpoint contract, checked against reality rather than against itself.
 *
 * A map like this is worthless if it only agrees with the person who wrote it.
 * Three things make it able to fail:
 *
 *  1. COMPLETENESS — real personas are swept for the leaves they actually carry,
 *     and any leaf missing from the map fails. Add a field to the sampler and
 *     forget the contract, and this goes red.
 *  2. HONESTY — the builder sources are read, and a field the map claims reaches
 *     the script or a portrait must actually be mentioned by that builder. This
 *     is what stops the map drifting into wishful thinking, which is the failure
 *     mode a hand-written map is most prone to.
 *  3. SAFETY — the brand-safety class must not exist as a field anywhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leafPaths, type Obj } from './paths';
import { samplePersonaSkeleton } from './sampler';
import { upgradeV1toV2 } from './upgrade';
import {
	NEVER_EMIT_FIELDS,
	PERSONA_TOUCHPOINTS,
	TOUCHPOINTS,
	contractKeyFor,
	fieldsFor,
	isContractExempt,
	touchpointsFor,
	type Touchpoint
} from './touchpoints';

const SRC = join(process.cwd(), 'src');

/**
 * A v1 blob exercising every legacy key, so the upgrade's output is represented
 * alongside the sampler's. Most stored personas are still this shape.
 */
const V1_BLOB = {
	gender: 'female',
	archetype: 'The Educator',
	contentFocus: 'Education & How-tos',
	contentAngle: 'Plain answers about ingredients',
	targetAvatar: 'A renter who reads labels',
	psychProfile: 'Sceptical, time-poor',
	ageRanges: ['25–34'],
	niche: 'Beauty & Wellness',
	appearance: {
		ethnicity: 'Caucasian',
		skinTone: 'Fair',
		bodyType: 'Average',
		hairColor: 'Auburn',
		hairLength: 'Long',
		hairstyle: 'Waves',
		eyeColor: 'Green',
		headwear: 'None',
		distinctiveFeatures: 'Freckles',
		wardrobe: 'Linen',
		outfitColors: 'Muted',
		styling: 'Minimal'
	},
	voiceProfile: { gender: 'female', nationality: 'Australian', accent: 'neutral' },
	bios: { instagram: 'bio', tiktok: 'bio' },
	handleCandidates: [{ handle: 'x', platform: 'instagram' }],
	confirmedHandles: { instagram: 'x' },
	soul: 'Warm, dry humour.'
};

/** Every leaf that any real persona in this codebase can carry today. */
function occurringLeaves(): string[] {
	const all = new Set<string>();
	for (let i = 0; i < 40; i++) {
		const profile = samplePersonaSkeleton(`tp-${i}`, {}, { now: '2026-01-01T00:00:00.000Z' });
		for (const p of leafPaths(profile as unknown as Obj)) all.add(p);
	}
	for (const p of leafPaths(upgradeV1toV2(V1_BLOB) as unknown as Obj)) all.add(p);
	return [...all].filter((p) => !isContractExempt(p)).sort();
}

describe('the contract covers what personas actually carry', () => {
	const leaves = occurringLeaves();

	it('found a real spread of leaves (an empty sweep would pass vacuously)', () => {
		expect(leaves.length).toBeGreaterThan(50);
	});

	it('maps every leaf a real persona carries', () => {
		const unmapped = [...new Set(leaves.map(contractKeyFor))].filter(
			(key) => PERSONA_TOUCHPOINTS[key] === undefined
		);
		expect(
			unmapped,
			`these fields exist on real personas but no touchpoint contract says who may read them: ${unmapped.join(', ')}`
		).toEqual([]);
	});

	it('excludes provenance bookkeeping, which is not a persona fact', () => {
		expect(leaves.some((p) => p.startsWith('meta.'))).toBe(false);
		expect(isContractExempt('meta.fieldSources.creator.age')).toBe(true);
	});
});

describe('the contract is well formed', () => {
	it('names only real consumers', () => {
		const known = new Set<string>(TOUCHPOINTS);
		const bad: string[] = [];
		for (const [path, value] of Object.entries(PERSONA_TOUCHPOINTS)) {
			if (value === 'never_emit') continue;
			for (const t of value) if (!known.has(t)) bad.push(`${path} → ${t}`);
		}
		expect(bad).toEqual([]);
	});

	it('lists each consumer at most once per field', () => {
		const dupes: string[] = [];
		for (const [path, value] of Object.entries(PERSONA_TOUCHPOINTS)) {
			if (value === 'never_emit') continue;
			if (new Set(value).size !== value.length) dupes.push(path);
		}
		expect(dupes).toEqual([]);
	});

	it('resolves a dynamic segment to one entry rather than one per platform', () => {
		expect(contractKeyFor('identityKit.bios.instagram')).toBe('identityKit.bios.*');
		expect(contractKeyFor('identityKit.bios.tiktok')).toBe('identityKit.bios.*');
		expect(contractKeyFor('_legacy.anythingAtAll')).toBe('_legacy.*');
		expect(touchpointsFor('identityKit.bios.threads')).toEqual(['display']);
	});

	it('answers "what does the portrait see" without reading six builders', () => {
		const portrait = fieldsFor('portrait');
		expect(portrait).toContain('look.facialHair');
		expect(portrait).toContain('creator.heritage');
		// A script does not describe a face; a face does not describe a household.
		expect(portrait).not.toContain('creator.household.pets');
		expect(fieldsFor('voice')).not.toContain('look.skinTone');
	});
});

describe('the brand-safety class does not exist as a field', () => {
	/**
	 * Not "is not emitted" — does not EXIST. A persona record holding a religion
	 * is a liability whether or not a prompt reads it: it gets stored, backed up
	 * and exported regardless.
	 */
	it('no persona leaf names anything in NEVER_EMIT_FIELDS', () => {
		const leaves = occurringLeaves();
		const offenders: string[] = [];
		for (const leaf of leaves) {
			const last = leaf.split('.').pop()?.toLowerCase() ?? '';
			for (const banned of NEVER_EMIT_FIELDS) {
				if (last === banned.toLowerCase()) offenders.push(leaf);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('no contract entry names one either', () => {
		const keys = Object.keys(PERSONA_TOUCHPOINTS).map(
			(k) => k.split('.').pop()?.toLowerCase() ?? ''
		);
		for (const banned of NEVER_EMIT_FIELDS) {
			expect(keys, banned).not.toContain(banned.toLowerCase());
		}
	});

	it('would catch one if it appeared (the check is not vacuous)', () => {
		// Proves the matcher works, without adding a banned field to the schema.
		const pretend = ['creator.religion', 'creator.age'];
		const caught = pretend.filter((leaf) =>
			NEVER_EMIT_FIELDS.some((b) => leaf.split('.').pop()?.toLowerCase() === b.toLowerCase())
		);
		expect(caught).toEqual(['creator.religion']);
	});
});

describe('the contract is honest about what the builders actually read', () => {
	/**
	 * THE ANTI-WISHFUL-THINKING CHECK. A hand-written map drifts by claiming a
	 * field reaches a consumer that has never heard of it — and nothing else in
	 * the codebase would notice. So the builder sources are read and searched for
	 * the field's own leaf name.
	 *
	 * Deliberately loose: it looks for the last path segment, because builders
	 * destructure (`const { facialHair } = look`). A loose check that runs beats a
	 * precise one that is too brittle to keep.
	 */
	const sourceFor = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

	/**
	 * Checked for the consumers that put a field in front of a MODEL. 'display'
	 * and 'identity_kit' are deliberately not swept: the display surface is the
	 * whole UI, so the check would degrade into maintaining a file list rather
	 * than catching anything, and a list that is always being fixed stops being
	 * read. The prompt-reaching consumers are where a false claim actually costs
	 * something.
	 */
	const CONSUMERS: [Touchpoint, string[]][] = [
		['script', ['lib/server/content/generate.ts']],
		[
			'portrait',
			[
				'lib/server/content/generate.ts',
				'lib/persona-contract/look-prompt.ts',
				'lib/persona-profile.ts'
			]
		],
		[
			'portrait_edit',
			[
				'lib/server/content/generate.ts',
				'lib/persona-contract/look-prompt.ts',
				'lib/persona-profile.ts'
			]
		],
		[
			'fit_judge',
			[
				'lib/server/persona/fit-judge.ts',
				'lib/persona-contract/panel.ts',
				'lib/server/content/generate.ts'
			]
		]
	];

	/**
	 * Fields whose VALUE reaches a prompt under a different name, because the v1
	 * downgrade folds them into the legacy key a builder actually reads —
	 * `heritageText` becomes `appearance.ethnicity`, the `*Text` positioning
	 * variants become plain `archetype` / `contentFocus`. The grep cannot see
	 * that, so each is exempted BY NAME with its reason rather than by loosening
	 * the check for everything.
	 */
	const REACHES_VIA_DOWNGRADE: Record<string, string> = {
		'creator.heritageText': 'downgrades into appearance.ethnicity',
		'strategy.archetypeText': 'downgrades into the plain archetype field',
		'strategy.contentFocusText': 'downgrades into the plain contentFocus field'
	};

	it.each(CONSUMERS)(
		'every field mapped to %s is mentioned by its builders',
		(touchpoint, files) => {
			const haystack = files.map(sourceFor).join('\n');
			const missing = fieldsFor(touchpoint).filter((path) => {
				if (REACHES_VIA_DOWNGRADE[path]) return false;
				const leaf = path.replace(/\.\*$/, '').split('.').pop() ?? '';
				if (leaf.length <= 2) return false;
				// WORD BOUNDARY, not `includes`. A substring match called this honest
				// while it was reading the word "educational" inside an unrelated prose
				// string and concluding that `creator.education` reached the script. A
				// check that cannot distinguish a field name from a fragment of English
				// is not a check.
				return !new RegExp(`\\b${leaf}\\b`).test(haystack);
			});
			expect(
				missing,
				`the contract says these reach ${touchpoint}, but no builder for it mentions them: ${missing.join(', ')}`
			).toEqual([]);
		}
	);

	/**
	 * THE REVERSE CHECK — "does a builder read anything the contract has not
	 * granted it" — was written, measured, and REMOVED. Recorded here so nobody
	 * rebuilds it the same way.
	 *
	 * It cannot work at file granularity. `generate.ts` hosts the script builder,
	 * both portrait builders and the fit judge's call site, so "this field name
	 * appears in this file" cannot say WHICH consumer mentioned it: the reverse
	 * check for `script` sees `look.eyewear` in the portrait builder and concludes
	 * the script reads it. Run for real it produced 24 false positives for script
	 * and 46 for portrait.
	 *
	 * Worse, the probe that first said it was clean was itself broken: it built
	 * its matcher as `new RegExp(\`\b${leaf}\b\`)` inside a template literal,
	 * where `` is a BACKSPACE escape rather than a word boundary, so it matched
	 * nothing and reported zero. A measurement that cannot fail is not evidence.
	 *
	 * Doing it properly needs function-level granularity — slicing each builder's
	 * own source out of the file — which is worth doing when a builder is
	 * extracted, and not worth faking before then.
	 */

	it('the downgrade exemptions are few, named, and still in the contract', () => {
		// An exemption list is where an honesty check goes to die. Keep it short,
		// and keep every entry pointing at a field that still exists.
		expect(Object.keys(REACHES_VIA_DOWNGRADE).length).toBeLessThanOrEqual(5);
		for (const path of Object.keys(REACHES_VIA_DOWNGRADE)) {
			expect(touchpointsFor(path), path).toBeDefined();
		}
	});

	it('the source files it reads actually exist and are not empty', () => {
		for (const [, files] of CONSUMERS) {
			for (const f of files) expect(sourceFor(f).length, f).toBeGreaterThan(500);
		}
	});
});
