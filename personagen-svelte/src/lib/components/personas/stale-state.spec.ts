/**
 * Stale-state warnings — contract tests.
 *
 * The whole point of this module is a warning a customer BELIEVES, so the first
 * and largest half of this file is about silence: personas that must produce
 * nothing, including a thousand freshly sampled ones (a persona the sampler just
 * drew is by definition consistent with itself — if any of them warns, the
 * detector is wrong, not the persona).
 *
 * The second half proves each warning fires on the evidence some route actually
 * writes, AND stays silent when that exact evidence is missing. A warning that
 * only has a positive test is a warning that can be keyed on a field nobody
 * sets and still pass forever.
 */
import { describe, expect, it } from 'vitest';
import { samplePersonaSkeleton } from '$lib/persona-contract/sampler';
import { staleWarnings, type StaleWarning } from './stale-state';
import { lookFingerprint } from '$lib/persona-contract/look-fingerprint';
import { readPersonaProfileV2 } from '$lib/persona-contract';

/** Fixed clock so nothing here asserts on the wall time. */
const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const keys = (warnings: StaleWarning[]) => warnings.map((w) => w.key);

/** An agent row shaped like the persona page's `data.agent`, with no history. */
const untouchedAgent = (extra: Record<string, unknown> = {}) => ({
	id: 'a1',
	name: 'Jenny Tran',
	handle: 'jennytran',
	niche: 'Beauty',
	market: 'Australia',
	ugc_voice: 'Adam',
	ugc_character_ref: 'https://cdn.example/portrait.png',
	ugc_reference_kit: {},
	personas_profile: {
		meta: { schemaVersion: 2, generatedAt: '2026-09-01T00:00:00.000Z' },
		creator: { displayName: 'Jenny Tran', gender: 'female', age: 29 },
		look: { skinTone: 'medium', hair: { color: 'black' } },
		voice: { gender: 'female', nationality: 'Australian' }
	},
	...extra
});

// ── Silence ──────────────────────────────────────────────────────────────────

describe('staleWarnings — a persona nobody has touched says nothing', () => {
	it('returns [] for an untouched persona with a portrait, a kit and a voice', () => {
		expect(staleWarnings(untouchedAgent(), NOW)).toEqual([]);
	});

	it('returns [] for a persona with a complete, successful reference kit', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: {
				sheet: 'https://cdn.example/sheet.png',
				full_body: 'https://cdn.example/full.png',
				side_profiles: 'https://cdn.example/side.png',
				face_closeup: 'https://cdn.example/face.png',
				feature_grid: 'https://cdn.example/grid.png',
				sheet_history: ['https://cdn.example/sheet-old.png'],
				full_body_history: ['https://cdn.example/full-old.png']
			}
		});
		expect(staleWarnings(agent, NOW)).toEqual([]);
	});

	it('returns [] for a brand-new persona with no portrait, no kit and no profile', () => {
		expect(staleWarnings({ id: 'a2', name: 'New', ugc_reference_kit: {} }, NOW)).toEqual([]);
	});

	it('returns [] for a v1 persona', () => {
		const v1 = {
			id: 'a3',
			ugc_reference_kit: {},
			personas_profile: {
				displayName: 'Marcus Webb',
				gender: 'male',
				personaAge: '30_35',
				appearance: { skinTone: 'olive', hairColor: 'dark brown' },
				voiceProfile: { gender: 'male', nationality: 'Australian', accent: 'Sydney' },
				targetAvatar: 'Weekend cyclists'
			}
		};
		expect(staleWarnings(v1, NOW)).toEqual([]);
	});

	it('returns [] for a v1 persona that never had a voice profile', () => {
		const v1 = {
			id: 'a4',
			personas_profile: { displayName: 'Priya', gender: 'female', niche: 'Fitness' }
		};
		expect(staleWarnings(v1, NOW)).toEqual([]);
	});

	it('returns [] for an empty profile in every empty shape', () => {
		expect(staleWarnings({ personas_profile: {} }, NOW)).toEqual([]);
		expect(staleWarnings({ personas_profile: null }, NOW)).toEqual([]);
		expect(staleWarnings({ personas_profile: '' }, NOW)).toEqual([]);
		expect(staleWarnings({ personas_profile: { meta: { schemaVersion: 2 } } }, NOW)).toEqual([]);
	});

	it('returns [] for null, undefined and junk without throwing', () => {
		expect(staleWarnings(null, NOW)).toEqual([]);
		expect(staleWarnings(undefined, NOW)).toEqual([]);
		expect(staleWarnings('nope', NOW)).toEqual([]);
		expect(staleWarnings(42, NOW)).toEqual([]);
		expect(staleWarnings([], NOW)).toEqual([]);
		expect(staleWarnings({ personas_profile: 'not json {{{' }, NOW)).toEqual([]);
		expect(staleWarnings({ ugc_reference_kit: 'not an object' }, NOW)).toEqual([]);
		expect(staleWarnings({ ugc_reference_kit: [1, 2, 3] }, NOW)).toEqual([]);
		expect(
			staleWarnings({ personas_profile: { creator: 7, voice: [] }, ugc_reference_kit: {} }, NOW)
		).toEqual([]);
	});

	it('works with no clock argument at all', () => {
		expect(staleWarnings(untouchedAgent())).toEqual([]);
	});

	it('says nothing about 1,000 freshly sampled personas', () => {
		const noisy: string[] = [];
		for (let i = 0; i < 1000; i++) {
			const seed = `stale-sweep-${i}`;
			const warnings = staleWarnings(
				{ id: seed, ugc_reference_kit: {}, personas_profile: samplePersonaSkeleton(seed) },
				NOW
			);
			if (warnings.length) noisy.push(`${seed}: ${keys(warnings).join(', ')}`);
		}
		expect(noisy).toEqual([]);
	});
});

// ── The portrait ─────────────────────────────────────────────────────────────

describe('staleWarnings — a portrait that never became the one you asked for', () => {
	it('warns when the last portrait attempt recorded a failure', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'failed: fal returned 500' }
		});
		const warnings = staleWarnings(agent, NOW);
		expect(keys(warnings)).toEqual(['portrait-failed']);
		expect(warnings[0].severity).toBe('warn');
	});

	it('says nothing while a portrait is genuinely still generating', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'generating', profile_started_at: minutesAgo(3) }
		});
		expect(staleWarnings(agent, NOW)).toEqual([]);
	});

	it('warns once a generating marker has outlived the in-flight window', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'generating', profile_started_at: minutesAgo(45) }
		});
		const warnings = staleWarnings(agent, NOW);
		expect(keys(warnings)).toEqual(['portrait-stalled']);
		expect(warnings[0].severity).toBe('info');
	});

	it('treats a generating marker with no start, or an unparseable one, as dead', () => {
		expect(
			keys(
				staleWarnings(untouchedAgent({ ugc_reference_kit: { profile_status: 'generating' } }), NOW)
			)
		).toEqual(['portrait-stalled']);
		expect(
			keys(
				staleWarnings(
					untouchedAgent({
						ugc_reference_kit: { profile_status: 'generating', profile_started_at: 'soon' }
					}),
					NOW
				)
			)
		).toEqual(['portrait-stalled']);
	});

	it('does not call a future-stamped start stalled (a client clock behind the server)', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'generating', profile_started_at: minutesAgo(-30) }
		});
		expect(staleWarnings(agent, NOW)).toEqual([]);
	});

	it('reports a failure rather than a stall when both could apply', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'failed: timeout', profile_started_at: minutesAgo(90) }
		});
		expect(keys(staleWarnings(agent, NOW))).toEqual(['portrait-failed']);
	});

	it('says nothing once the markers are cleared, which is what success does', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { full_body: 'https://cdn.example/full.png' }
		});
		expect(staleWarnings(agent, NOW)).toEqual([]);
	});
});

// ── The reference photos ─────────────────────────────────────────────────────

describe('staleWarnings — reference photos that did not finish', () => {
	it('warns on a failed stage and names it in the customer’s words', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { face_closeup_status: 'failed: content policy' }
		});
		const warnings = staleWarnings(agent, NOW);
		expect(keys(warnings)).toEqual(['reference-photos-failed']);
		expect(warnings[0].detail).toContain('the face close-up');
		expect(warnings[0].severity).toBe('warn');
	});

	it('lists several failed stages in generation order, never in failure order', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: {
				feature_grid_status: 'failed: a',
				sheet_status: 'failed: b',
				side_profiles_status: 'failed: c'
			}
		});
		const [warning] = staleWarnings(agent, NOW);
		expect(warning.detail).toContain('the character sheet, the side profiles and the feature grid');
	});

	it('says nothing while a stage is genuinely still generating', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: {
				side_profiles_status: 'generating',
				side_profiles_started_at: minutesAgo(2)
			}
		});
		expect(staleWarnings(agent, NOW)).toEqual([]);
	});

	it('warns once a stage’s generating marker has outlived the in-flight window', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: {
				side_profiles_status: 'generating',
				side_profiles_started_at: minutesAgo(60)
			}
		});
		const warnings = staleWarnings(agent, NOW);
		expect(keys(warnings)).toEqual(['reference-photos-stalled']);
		expect(warnings[0].detail).toContain('the side profiles');
		expect(warnings[0].severity).toBe('info');
	});

	it('separates a failed stage from a stalled one without double-counting either', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: {
				sheet_status: 'failed: boom',
				feature_grid_status: 'generating',
				feature_grid_started_at: minutesAgo(120)
			}
		});
		const warnings = staleWarnings(agent, NOW);
		expect(keys(warnings)).toEqual(['reference-photos-failed', 'reference-photos-stalled']);
		expect(warnings[0].detail).toContain('the character sheet');
		expect(warnings[0].detail).not.toContain('the feature grid');
		expect(warnings[1].detail).toContain('the feature grid');
		expect(warnings[1].detail).not.toContain('the character sheet');
	});

	it('ignores a stage’s history and its finished URLs entirely', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: {
				sheet: 'https://cdn.example/sheet.png',
				sheet_history: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
				face_closeup_history: []
			}
		});
		expect(staleWarnings(agent, NOW)).toEqual([]);
	});

	it('never reads the portrait’s own marker as a reference-photo stage', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'failed: boom' }
		});
		expect(keys(staleWarnings(agent, NOW))).toEqual(['portrait-failed']);
	});
});

// ── The voice ────────────────────────────────────────────────────────────────

describe('staleWarnings — a voice cast for a persona that has since changed', () => {
	it('warns when the cast voice and the persona disagree about gender', () => {
		const agent = untouchedAgent({
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { gender: 'female' },
				voice: { gender: 'male' }
			}
		});
		const warnings = staleWarnings(agent, NOW);
		expect(keys(warnings)).toEqual(['voice-gender']);
		expect(warnings[0].severity).toBe('warn');
	});

	it('speaks in labels, never in stored values or field paths', () => {
		const agent = untouchedAgent({
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { gender: 'female' },
				voice: { gender: 'male' }
			}
		});
		const [warning] = staleWarnings(agent, NOW);
		const text = `${warning.title} ${warning.detail}`;
		expect(text).toContain('male');
		expect(text).toContain('female');
		expect(text).not.toContain('voice.gender');
		expect(text).not.toContain('creator.');
		expect(text).not.toContain('_status');
	});

	it('catches the same disagreement on an upgraded v1 persona', () => {
		const agent = {
			id: 'a5',
			personas_profile: {
				displayName: 'Marcus Webb',
				gender: 'male',
				voiceProfile: { gender: 'female', nationality: 'Australian' }
			}
		};
		expect(keys(staleWarnings(agent, NOW))).toEqual(['voice-gender']);
	});

	it('says nothing when the two agree', () => {
		const agent = untouchedAgent({
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { gender: 'male' },
				voice: { gender: 'male' }
			}
		});
		expect(staleWarnings(agent, NOW)).toEqual([]);
	});

	it('says nothing when either side is unset, blank or off-list', () => {
		const cases = [
			{ creator: { gender: 'female' }, voice: {} },
			{ creator: {}, voice: { gender: 'male' } },
			{ creator: { gender: 'female' }, voice: { gender: '' } },
			{ creator: { gender: '   ' }, voice: { gender: 'male' } },
			{ creator: { gender: 'female' }, voice: { gender: 'nonbinary' } },
			{ creator: { gender: 'Female' }, voice: { gender: 'female' } },
			{ creator: { gender: 42 }, voice: { gender: 'female' } }
		];
		for (const profile of cases) {
			expect(
				staleWarnings({ personas_profile: { meta: { schemaVersion: 2 }, ...profile } }, NOW)
			).toEqual([]);
		}
	});
});

// ── Shape ────────────────────────────────────────────────────────────────────

describe('staleWarnings — a portrait made before the appearance changed', () => {
	/** The kit a successful portrait now leaves behind. */
	const generatedFrom = (agent: ReturnType<typeof untouchedAgent>) => ({
		profile_generated_at: minutesAgo(60),
		profile_look_fingerprint: lookFingerprint(readPersonaProfileV2(agent as never))
	});

	it('says nothing while the recorded appearance still matches', () => {
		const agent = untouchedAgent();
		const withKit = untouchedAgent({ ugc_reference_kit: generatedFrom(agent) });
		expect(keys(staleWarnings(withKit, NOW))).toEqual([]);
	});

	it('warns once the appearance has been edited since', () => {
		const agent = untouchedAgent();
		const kit = generatedFrom(agent);
		const edited = untouchedAgent({
			ugc_reference_kit: kit,
			personas_profile: {
				...agent.personas_profile,
				look: { skinTone: 'deep', hair: { color: 'black' } }
			}
		});
		expect(keys(staleWarnings(edited, NOW))).toContain('portrait-outdated');
	});

	/**
	 * THE FALSE-ALARM GUARD, and the reason this keys on a fingerprint of the
	 * appearance rather than on a timestamp. `meta.generatedAt` is bumped by every
	 * save, so a timestamp comparison would tell a customer who fixed a typo that
	 * their portrait was stale.
	 */
	it('stays silent when something that is not the face changes', () => {
		const agent = untouchedAgent();
		const kit = generatedFrom(agent);
		for (const [what, profile] of [
			[
				'a later save',
				{
					...agent.personas_profile,
					meta: { schemaVersion: 2, generatedAt: '2030-01-01T00:00:00.000Z' }
				}
			],
			[
				'the wardrobe',
				{
					...agent.personas_profile,
					look: { ...agent.personas_profile.look, wardrobe: 'new jacket' }
				}
			],
			[
				'the angle',
				{ ...agent.personas_profile, strategy: { contentAngle: 'completely rewritten' } }
			]
		] as const) {
			const edited = untouchedAgent({ ugc_reference_kit: kit, personas_profile: profile });
			expect(keys(staleWarnings(edited, NOW)), what as string).not.toContain('portrait-outdated');
		}
	});

	/**
	 * Every portrait taken before this shipped has no recorded fingerprint. They
	 * must stay silent rather than all being declared stale at once on the
	 * strength of a field that did not exist when they ran.
	 */
	it('says nothing about a portrait generated before any of this existed', () => {
		const legacy = untouchedAgent({
			ugc_reference_kit: { profile_generated_at: minutesAgo(9000) }
		});
		expect(keys(staleWarnings(legacy, NOW))).not.toContain('portrait-outdated');
	});

	it('does not pile on while a portrait is already running or has failed', () => {
		const agent = untouchedAgent();
		const stale = { skinTone: 'deep', hair: { color: 'black' } };
		for (const status of ['generating', 'failed: provider said no']) {
			const busy = untouchedAgent({
				ugc_reference_kit: {
					...generatedFrom(agent),
					profile_status: status,
					profile_started_at: minutesAgo(2)
				},
				personas_profile: { ...agent.personas_profile, look: stale }
			});
			expect(keys(staleWarnings(busy, NOW)), status).not.toContain('portrait-outdated');
		}
	});

	it('says nothing about a persona with no appearance at all', () => {
		const blank = untouchedAgent({
			ugc_reference_kit: {
				profile_generated_at: minutesAgo(60),
				profile_look_fingerprint: 'deadbeef'
			},
			personas_profile: { meta: { schemaVersion: 2 } }
		});
		expect(keys(staleWarnings(blank, NOW))).not.toContain('portrait-outdated');
	});
});

describe('staleWarnings — the shape the page can rely on', () => {
	it('orders portrait, then reference photos, then voice, whatever the input order', () => {
		const agent = {
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { gender: 'female' },
				voice: { gender: 'male' }
			},
			ugc_reference_kit: {
				feature_grid_status: 'generating',
				feature_grid_started_at: minutesAgo(90),
				sheet_status: 'failed: boom',
				profile_status: 'failed: boom'
			}
		};
		expect(keys(staleWarnings(agent, NOW))).toEqual([
			'portrait-failed',
			'reference-photos-failed',
			'reference-photos-stalled',
			'voice-gender'
		]);
	});

	it('is deterministic — the same agent twice gives the identical result', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'failed: boom', sheet_status: 'failed: boom' }
		});
		expect(staleWarnings(agent, NOW)).toEqual(staleWarnings(agent, NOW));
	});

	it('keys are unique and every warning carries real copy', () => {
		const agent = {
			personas_profile: {
				meta: { schemaVersion: 2 },
				creator: { gender: 'female' },
				voice: { gender: 'male' }
			},
			ugc_reference_kit: {
				profile_status: 'failed: boom',
				sheet_status: 'failed: boom',
				feature_grid_status: 'generating',
				feature_grid_started_at: minutesAgo(90)
			}
		};
		const warnings = staleWarnings(agent, NOW);
		expect(new Set(keys(warnings)).size).toBe(warnings.length);
		for (const warning of warnings) {
			expect(warning.title.length).toBeGreaterThan(8);
			expect(warning.detail.length).toBeGreaterThan(40);
			expect(['info', 'warn']).toContain(warning.severity);
			expect(`${warning.title} ${warning.detail}`).not.toMatch(/ugc_|_status|_started_at|\bmeta\./);
		}
	});

	it('does not mutate the agent it was handed', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: { profile_status: 'failed: boom' }
		});
		const before = JSON.stringify(agent);
		staleWarnings(agent, NOW);
		expect(JSON.stringify(agent)).toBe(before);
	});
});

describe('a warning that asks the reader to act carries the act (audit UX-007)', () => {
	// The audit found a notice reading "Generate them again when you're ready"
	// with no control on it: told to retry, given no retry. These pin the rule
	// rather than one notice, so a new warning cannot ship the same defect.

	it('the failed reference-photo notice offers a retry of the earliest failed stage', () => {
		const agent = untouchedAgent({
			ugc_reference_kit: {
				feature_grid_status: 'failed: a',
				side_profiles_status: 'failed: c'
			}
		});
		const [warning] = staleWarnings(agent, NOW);
		expect(warning.action).toEqual({
			kind: 'regenerate-kit-stage',
			label: 'Retry side profiles',
			// Stages build on each other, so the useful retry is the earliest.
			stage: 'side_profiles'
		});
	});

	it('a failed or stalled portrait offers to generate it again', () => {
		const failed = staleWarnings(
			untouchedAgent({ ugc_reference_kit: { profile_status: 'failed: fal returned 500' } }),
			NOW
		);
		expect(failed[0].action?.kind).toBe('regenerate-portrait');
	});

	it('every warning whose copy tells the reader to do something has a button for it', () => {
		// Built from every failure shape the module knows, then checked against its
		// own words: any detail that ends in an instruction must carry an action.
		const shapes = [
			{ ugc_reference_kit: { profile_status: 'failed: x' } },
			{ ugc_reference_kit: { profile_status: 'generating', profile_started_at: minutesAgo(600) } },
			{ ugc_reference_kit: { side_profiles_status: 'failed: x' } },
			{ ugc_reference_kit: { face_closeup_status: 'generating', face_closeup_started_at: minutesAgo(600) } }
		];
		const warnings: StaleWarning[] = shapes.flatMap((over) => staleWarnings(untouchedAgent(over), NOW));
		// The sample must be real, or every assertion below passes vacuously.
		expect(warnings.length).toBeGreaterThanOrEqual(4);
		for (const w of warnings) {
			if (/again|re-?generate|pick the voice|start (it|them)/i.test(w.detail)) {
				expect(w.action, `${w.key} tells the reader to act and offers nothing to click`).toBeDefined();
				expect(w.action!.label.length).toBeGreaterThan(3);
			}
		}
	});

	it('an untouched persona still produces nothing — no warning, so no button', () => {
		expect(staleWarnings(untouchedAgent({}), NOW)).toEqual([]);
	});
});
