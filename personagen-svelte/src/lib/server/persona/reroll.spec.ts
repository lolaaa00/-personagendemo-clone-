/**
 * P1.5 — per-field re-roll.
 *
 * The claims worth proving are about BLAST RADIUS, not about any particular
 * draw: a job re-roll must move the job (and may move what the job pays) while
 * the face, name, age and heritage stay byte-identical. Everything below is
 * asserted over a sweep of nonces rather than one lucky seed, because "this
 * nonce happened not to change the face" is not the property we need.
 */
import { registry } from '$lib/persona-contract/registry';
import { describe, expect, it } from 'vitest';
import { samplePersonaSkeleton } from '$lib/persona-contract/sampler';
import type { PersonaProfileV2 } from '$lib/persona-contract/schema';
import { REROLL_GROUPS, deriveDescription, rerollField, rerollGroupFor } from './reroll';

const NOW = '2026-01-01T00:00:00.000Z';
const NONCES = Array.from({ length: 40 }, (_, i) => `n${i}`);

const base = (seed = 'agent-1'): PersonaProfileV2 => samplePersonaSkeleton(seed, {}, { now: NOW });

/** A fresh copy, so a test that mutates its fixture cannot leak into the next. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('rerollGroupFor', () => {
	it('resolves a group key, an owned leaf and an owned leaf’s parent', () => {
		expect(rerollGroupFor('creator.work')?.key).toBe('creator.work');
		expect(rerollGroupFor('creator.work.title')?.key).toBe('creator.work');
		expect(rerollGroupFor('creator.economic.incomeBand')?.key).toBe('creator.work');
		expect(rerollGroupFor('look.hair')?.key).toBe('look');
		expect(rerollGroupFor('look.hair.color')?.key).toBe('look');
	});

	it('refuses bare sections, unknown paths and non-rerollable fields', () => {
		for (const path of ['creator', 'strategy', 'strategy.niche', 'creator.birthday', 'audience.psychProfile', '', ' ']) {
			expect(rerollGroupFor(path), path).toBeUndefined();
		}
		expect(rerollGroupFor(undefined)).toBeUndefined();
		expect(rerollGroupFor(42)).toBeUndefined();
	});

	it('gives every group a unique key and non-empty owns/pins', () => {
		const keys = REROLL_GROUPS.map((g) => g.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const group of REROLL_GROUPS) {
			expect(group.owns.length, group.key).toBeGreaterThan(0);
			expect(group.pins.length, group.key).toBeGreaterThan(0);
		}
	});
});

describe('rerollField — creator.work', () => {
	it('changes the job title across nonces', () => {
		const profile = base();
		const titles = new Set(
			NONCES.map((n) => rerollField(profile, 'creator.work.title', n).creator?.work?.title ?? '')
		);
		expect(titles.size).toBeGreaterThan(1);
	});

	it('may change the income band', () => {
		const profile = base();
		const bands = new Set(
			NONCES.map((n) => rerollField(profile, 'creator.work.title', n).creator?.economic?.incomeBand ?? '')
		);
		expect(bands.size).toBeGreaterThan(1);
	});

	it('never changes age, heritage, name or look', () => {
		const profile = base();
		for (const n of NONCES) {
			const next = rerollField(profile, 'creator.work.title', n);
			expect(next.creator?.age, n).toBe(profile.creator?.age);
			expect(next.creator?.heritage, n).toBe(profile.creator?.heritage);
			expect(next.creator?.gender, n).toBe(profile.creator?.gender);
			expect(next.creator?.displayName, n).toBe(profile.creator?.displayName);
			expect(next.creator?.firstName, n).toBe(profile.creator?.firstName);
			expect(next.creator?.lastName, n).toBe(profile.creator?.lastName);
			expect(next.look, n).toEqual(profile.look);
			expect(next.creator?.location, n).toEqual(profile.creator?.location);
			expect(next.creator?.household, n).toEqual(profile.creator?.household);
			expect(next.creator?.bigFive, n).toEqual(profile.creator?.bigFive);
		}
	});

	it('marks every leaf it writes as sampled', () => {
		const profile = base();
		const next = rerollField(profile, 'creator.work.title', 'k');
		for (const path of ['creator.work.title', 'creator.work.domain', 'creator.economic.incomeBand']) {
			expect(next.meta.fieldSources?.[path], path).toBe('sampled');
		}
	});
});

describe('rerollField — determinism', () => {
	it('is idempotent for the same nonce', () => {
		const profile = base();
		expect(rerollField(profile, 'creator.work.title', 7)).toEqual(rerollField(profile, 'creator.work.title', 7));
		expect(rerollField(profile, 'look', 'x')).toEqual(rerollField(profile, 'look', 'x'));
	});

	it('gives a different draw for a different nonce', () => {
		const profile = base();
		const draws = new Set(NONCES.map((n) => JSON.stringify(rerollField(profile, 'creator.work', n).creator?.work)));
		expect(draws.size).toBeGreaterThan(1);
	});

	it('keys the seed on the field path, so two groups do not share a draw', () => {
		const profile = base();
		const work = rerollField(profile, 'creator.work', 'same-nonce');
		const look = rerollField(profile, 'look', 'same-nonce');
		expect(work.creator?.work).not.toEqual(look.creator?.work);
		expect(look.look).not.toEqual(work.look);
	});
});

describe('rerollField — provenance', () => {
	it('never overwrites a user-sourced leaf inside the group being rerolled', () => {
		const profile = base();
		profile.meta.fieldSources!['creator.work.title'] = 'user';
		const originalTitle = profile.creator!.work!.title;
		for (const n of NONCES) {
			const next = rerollField(profile, 'creator.work', n);
			expect(next.creator?.work?.title, n).toBe(originalTitle);
			expect(next.meta.fieldSources?.['creator.work.title'], n).toBe('user');
		}
	});

	it('never overwrites an extracted leaf', () => {
		const profile = base();
		profile.meta.fieldSources!['creator.economic.incomeBand'] = 'extracted';
		const band = profile.creator!.economic!.incomeBand;
		const bands = new Set(NONCES.map((n) => rerollField(profile, 'creator.work', n).creator?.economic?.incomeBand));
		expect([...bands]).toEqual([band]);
	});

	it('clears a stale derived text companion and the cached prompt cues on a look re-roll', () => {
		const profile = base();
		profile.look!.skinToneText = 'warm olive';
		profile.look!.promptCues = 'a stale rendered clause';
		profile.meta.fieldSources!['look.skinToneText'] = 'derived';
		profile.meta.fieldSources!['look.promptCues'] = 'derived';

		const next = rerollField(profile, 'look', 'q');
		expect(next.look?.skinToneText).toBeUndefined();
		expect(next.look?.promptCues).toBeUndefined();
		expect(next.meta.fieldSources?.['look.promptCues']).toBeUndefined();
	});

	it('keeps a user-typed text companion even when the tokens are re-rolled', () => {
		const profile = base();
		profile.look!.skinToneText = 'warm olive, freckled';
		profile.meta.fieldSources!['look.skinToneText'] = 'user';
		const next = rerollField(profile, 'look', 'q');
		expect(next.look?.skinToneText).toBe('warm olive, freckled');
	});
});

describe('rerollField — safety', () => {
	it('returns an unchanged profile for an unknown or non-rerollable path', () => {
		const profile = base();
		for (const path of ['', 'creator', 'strategy.niche', 'creator.birthday', 'nonsense.path']) {
			expect(rerollField(profile, path, 'n'), path).toEqual(profile);
		}
	});

	it('does not mutate its input', () => {
		const profile = base();
		const before = copy(profile);
		rerollField(profile, 'creator.work', 'a');
		rerollField(profile, 'look', 'b');
		rerollField(profile, 'creator.household', 'c');
		expect(profile).toEqual(before);
	});

	it('returns a new object rather than the input reference', () => {
		const profile = base();
		expect(rerollField(profile, 'creator.work', 'a')).not.toBe(profile);
		expect(rerollField(profile, 'unknown.path', 'a')).not.toBe(profile);
	});

	it('works on a profile with no meta.seed, and stays deterministic', () => {
		const profile = base('seedless');
		delete profile.meta.seed;
		const once = rerollField(profile, 'creator.work', 'z');
		const twice = rerollField(profile, 'creator.work', 'z');
		expect(once).toEqual(twice);
		const titles = new Set(NONCES.map((n) => rerollField(profile, 'creator.work', n).creator?.work?.title));
		expect(titles.size).toBeGreaterThan(1);
	});

	it('survives a hand-built profile with almost nothing in it', () => {
		const profile: PersonaProfileV2 = { meta: { schemaVersion: 2 } };
		const next = rerollField(profile, 'creator.work', 'n');
		expect(next.creator?.work?.title).toBeTruthy();
		expect(next.meta.fieldSources?.['creator.work.title']).toBe('sampled');
	});
});

describe('rerollField — household', () => {
	it('leaves no empty children husk when the re-drawn household is childless', () => {
		const profile = base('parent-seed');
		let sawChildless = false;
		for (const n of NONCES) {
			const next = rerollField(profile, 'creator.household', n);
			const children = next.creator?.household?.children;
			if (children === undefined) {
				sawChildless = true;
				expect(Object.keys(next.creator?.household ?? {}), n).not.toContain('children');
			} else {
				expect(children.count, n).toBeGreaterThan(0);
			}
		}
		expect(sawChildless).toBe(true);
	});
});

describe('creator.work — the education pin', () => {
	it('never changes the education the creator already has', () => {
		const profile = base('education-pin');
		const before = profile.creator?.education;
		expect(before).toBeTruthy();
		for (let n = 0; n < 40; n++) {
			expect(rerollField(profile, 'creator.work', n).creator?.education, `nonce ${n}`).toBe(before);
		}
	});

		/**
	 * THE REASON THE PIN EXISTS, and the only assertion that fails without it.
	 *
	 * Holding education still is not enough on its own: the work group does not
	 * own that leaf, so it never moves either way. What matters is that the job
	 * the re-draw picks was chosen against the education the creator ACTUALLY
	 * has. Unpinned, the re-draw invents a fresh degree, gates the occupation
	 * table on THAT, and can hand back a job the stored education does not
	 * qualify for — a secondary-educated physiotherapist. Nothing has visibly
	 * "changed"; the persona is simply, quietly, incoherent.
	 *
	 * The fixture is built rather than sampled because the education-gated
	 * occupations are niche-gated too: a randomly seeded creator usually has a
	 * niche that can reach none of them, which is exactly how this test passed
	 * against the unpinned code the first time it was written.
	 */
	it('re-rolls only into jobs the creator’s stored education qualifies for', () => {
		const profile = copy(base('edu-gate'));
		const creator = profile.creator ?? (profile.creator = {});
		creator.education = 'secondary';
		(profile.strategy ??= {}).niche = 'fitness_health';

		const occupations = registry.for(creator.market).occupations;
		const gatedTitles = occupations
			.filter((o) => o.gates?.educations && !o.gates.educations.includes('secondary'))
			.map((o) => o.title);
		expect(gatedTitles.length, 'fixture reaches no gated job, so the test would be vacuous').toBeGreaterThan(0);

		const offenders: string[] = [];
		for (let n = 0; n < 40; n++) {
			const title = rerollField(profile, 'creator.work', n).creator?.work?.title;
			if (title && gatedTitles.includes(title)) offenders.push(`nonce ${n}: "${title}"`);
		}
		expect(offenders).toEqual([]);
	});

	it('still moves the job itself, so the pin has not frozen the group', () => {
		const profile = base('education-pin');
		const titles = new Set<string | undefined>();
		for (let n = 0; n < 40; n++) titles.add(rerollField(profile, 'creator.work', n).creator?.work?.title);
		expect(titles.size).toBeGreaterThan(1);
	});
});

describe('deriveDescription', () => {
	it('reproduces the sampler’s own description for a freshly sampled profile', () => {
		// The drift guard: reroll.ts rebuilds the derived description itself, so
		// this is what stops it and the sampler from disagreeing.
		for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
			const profile = samplePersonaSkeleton(seed, {}, { now: NOW });
			expect(deriveDescription(profile), seed).toEqual(profile.description);
		}
	});

	it('returns undefined when the facts it needs are missing', () => {
		expect(deriveDescription({ meta: { schemaVersion: 2 } })).toBeUndefined();
	});

	it('follows a job re-roll', () => {
		const profile = base();
		for (const n of NONCES) {
			const next = rerollField(profile, 'creator.work.title', n);
			const title = next.creator!.work!.title!;
			expect(next.description?.frame?.find((f) => f.key === 'work')?.value, n).toContain(title);
		}
	});

	it('follows a name re-roll', () => {
		const profile = base();
		const next = rerollField(profile, 'creator.name', 'r');
		expect(next.description?.short).toContain(next.creator!.displayName!);
	});
});
