/**
 * Every product claim the page makes in writing must be true of the code.
 *
 * Sibling of money-claims.spec.ts, same method: take a written claim, find the
 * line that must enforce it, and fail here when the two drift apart. A claim
 * with no enforcing line is either false or unverifiable. Applied to the
 * landing page and the in-app guides it found four:
 *
 *   "Every generated video carries an AI-generated marker."
 *        — the badge is opt-in and defaults OFF in all four places that set it
 *          (the pipeline type, the route's request mapping, the preview
 *          contract, the composer's state), and autopilot.ts does not contain
 *          the word aiBadge at all, so every unattended video shipped unmarked.
 *          The copy now describes the switch instead of promising the outcome.
 *
 *   "Advisor suggests."
 *        — advisor is the OFF position, not a mode: autopilot selects
 *          semi_autonomous and fully_autonomous only, and the module header
 *          says "'advisor' → off (no auto-generation)". It suggests nothing
 *          because it runs nothing. The in-app select already said "manual
 *          generate only"; the landing page now agrees.
 *
 *   "checked against your whole roster … and forced to be different"
 *        — the roster is serialised INTO THE PROMPT and truncated at 2500
 *          chars; nothing inspects the result, rejects it, or redraws. Voice is
 *          not consulted at all — it is a hash of a seed modulo the pool. As
 *          persona/generate-v2.ts puts it: "A prompt instruction not to change
 *          the facts is a request; a filter is a guarantee."
 *
 *   "Instagram: manual"
 *        — MANUAL_DELETE_ONLY_PLATFORMS names three platforms, not one.
 *
 * These assertions fail in BOTH directions. If the copy drifts back to the
 * absolutes, they go red. If the code moves under the corrected copy — someone
 * flips the aiBadge default ON, or lets advisor run unattended, or adds a
 * fourth undeleteable platform — they also go red, and the message names the
 * sentence that now needs rewriting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTONOMY_LABELS } from '$lib/types';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');

const landing = read('routes', '+page.svelte');
const guides = read('routes', '(portal)', 'guides', '+page.svelte');
const generate = read('lib', 'server', 'content', 'generate.ts');
const generatePost = read('routes', 'api', 'agent', '[agentId]', 'generate-post', '+server.ts');
const composer = read('lib', 'components', 'generation', 'GenerationComposer.svelte');
const autopilot = read('lib', 'server', 'autopilot.ts');
const engine = read('routes', 'api', 'engine', '+server.ts');
const zernio = read('lib', 'server', 'social', 'zernio.ts');

/** The single guides entry about taking a post down, so a platform named
 *  somewhere else in the guide (the Connect step names Instagram and TikTok)
 *  cannot satisfy the deletion assertions by accident. */
const DELETE_ENTRY_START = guides.indexOf("id: 'delete-live'");
const deleteEntry = (() => {
	if (DELETE_ENTRY_START < 0) return '';
	const next = guides.indexOf("id: '", DELETE_ENTRY_START + 20);
	return guides.slice(DELETE_ENTRY_START, next === -1 ? guides.length : next);
})();

/** The undeleteable platforms, taken from the declaration rather than retyped:
 *  add a fourth to zernio.ts and the guide assertion below fails until the
 *  guide names it too. Parsed from source because zernio.ts pulls
 *  $env/dynamic/private at import, which a node-environment unit run has no
 *  business booting. */
const manualDeletePlatforms = (() => {
	const m = zernio.match(/MANUAL_DELETE_ONLY_PLATFORMS\s*=\s*\[([^\]]*)\]/);
	if (!m) return [];
	return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
})();

describe('this spec is reading the files it claims to read', () => {
	// Without this, an empty or moved file makes every `not.toMatch` below pass
	// vacuously — the suite would stay green while asserting nothing at all.
	it('every source is non-empty and is the file it is supposed to be', () => {
		const sources: Array<[string, string, string]> = [
			['landing', landing, 'lp-trust'],
			['guides', guides, "id: 'delete-live'"],
			['generate.ts', generate, 'aiBadge'],
			['generate-post route', generatePost, 'aiBadge'],
			['GenerationComposer', composer, 'aiBadge'],
			['autopilot.ts', autopilot, 'autonomy_level'],
			['engine route', engine, 'appearanceFingerprint'],
			['zernio.ts', zernio, 'MANUAL_DELETE_ONLY_PLATFORMS']
		];
		for (const [name, body, fingerprint] of sources) {
			expect(
				body.length,
				`${name} read as empty — every assertion on it is vacuous`
			).toBeGreaterThan(500);
			expect(
				body,
				`${name} no longer contains ${fingerprint} — it moved or was renamed`
			).toContain(fingerprint);
		}
	});

	it('the deletion guide entry was located and is not empty', () => {
		expect(DELETE_ENTRY_START).toBeGreaterThan(-1);
		expect(deleteEntry.length).toBeGreaterThan(200);
	});

	it('the undeleteable-platform list was parsed, not silently empty', () => {
		expect(manualDeletePlatforms.length).toBeGreaterThanOrEqual(3);
		expect(manualDeletePlatforms).toContain('instagram');
	});
});

describe('the AI-disclosure badge: a switch, not a promise', () => {
	it('no surface claims every generated video is marked', () => {
		for (const [name, copy] of [
			['landing', landing],
			['guides', guides]
		] as const) {
			expect(copy, `${name} still promises every video carries a marker`).not.toMatch(
				/every generated video carries/i
			);
			expect(copy, `${name} still promises an automatic AI-generated marker`).not.toMatch(
				/carries an AI-generated marker/i
			);
		}
	});

	it('the corrected copy describes an opt-in, per-generation switch', () => {
		expect(landing).toMatch(/off (by default|until you turn it on)/i);
		expect(landing).toMatch(/one-tap|one tap/i);
	});

	it('the badge still defaults OFF in all four places that set it', () => {
		const why = 'the badge default flipped — the landing copy says it is off by default';
		// 1. The pipeline input type documents it as opt-in.
		expect(generate, why).toMatch(/Opt-in:[\s\S]{0,160}aiBadge\?: boolean;/);
		expect(generate, why).toMatch(/OFF by\s*\*?\s*default/);
		// 2. The route only honours an explicit true from the request body.
		expect(generatePost, why).toContain('aiBadge: body.ai_badge === true');
		// 3. The preview contract the composer renders from ships it off.
		expect(generatePost, why).toContain('aiBadge: false');
		// 4. The composer's own toggle starts off.
		expect(composer, why).toContain('let aiBadge = $state(false)');
	});

	it('an unattended autopilot run cannot switch it on, and the copy says so', () => {
		expect(
			autopilot,
			'autopilot now references aiBadge — unattended runs may be marked, so update the landing copy that says they are not'
		).not.toMatch(/aiBadge/i);
		expect(landing).toMatch(/unattended autopilot run/i);
	});
});

describe('advisor is the off switch, not a third running mode', () => {
	it('no surface says "Advisor suggests"', () => {
		expect(landing, 'landing still says Advisor suggests').not.toMatch(/Advisor suggests/i);
		expect(landing, 'landing still implies all three levels run').not.toMatch(
			/choose Advisor, Semi-autonomous or Fully autonomous, set the cadence\. Then it runs\./i
		);
	});

	it('the corrected copy calls advisor manual', () => {
		expect(landing).toMatch(/Advisor is manual/i);
		expect(landing).toMatch(/Advisor stays manual/i);
	});

	it('autopilot still selects only semi and fully autonomous', () => {
		expect(
			autopilot,
			'autopilot no longer selects exactly semi+fully — if advisor now generates, the landing copy calling it manual is false'
		).toContain("'semi_autonomous', 'fully_autonomous'");
		expect(autopilot).toContain(".in('autonomy_level'");
		expect(autopilot).toMatch(/'advisor'\s*→\s*off/);
	});

	it('the shared AutonomyLevel description agrees with the select and the page', () => {
		expect(AUTONOMY_LABELS.advisor.description).toMatch(/manual/i);
		expect(AUTONOMY_LABELS.advisor.description).not.toMatch(/suggests/i);
	});
});

describe('persona distinctness is steering, not a filter', () => {
	it('no surface claims personas are checked and forced apart', () => {
		expect(landing, 'landing still claims personas are forced to be different').not.toMatch(
			/forced to be different/i
		);
		expect(landing, 'landing still claims each persona is checked against the roster').not.toMatch(
			/checked against your whole roster/i
		);
		expect(landing, 'landing still promises ten personas will not converge').not.toMatch(
			/will not converge/i
		);
	});

	it('the corrected copy claims what the engine does: generates with the roster in view', () => {
		expect(landing).toMatch(/generated with your whole roster in view/i);
	});

	it('the roster reaches the model as prompt text, truncated — nothing rejects the result', () => {
		// This truncation is exactly why "checked … and forced" was false: past
		// roughly the eighth persona the roster stops reaching the model at all.
		expect(engine).toContain('JSON.stringify(taken).slice(0, 2500)');
	});

	it('voice is a hash of a seed, so the copy no longer lists voice as an axis', () => {
		expect(generate).toMatch(/pool\[stableVoiceHash\([^)]*\) % pool\.length\]/);
		expect(landing, 'landing claims voice is compared across the roster; it is not').not.toMatch(
			/look, angle, audience, voice/i
		);
	});
});

describe('the deletion guide names every platform the code cannot delete', () => {
	it('names each entry of MANUAL_DELETE_ONLY_PLATFORMS', () => {
		for (const platform of manualDeletePlatforms) {
			expect(
				deleteEntry,
				`the "Take down a published post" guide never names ${platform}, which MANUAL_DELETE_ONLY_PLATFORMS says cannot be removed by API`
			).toMatch(new RegExp(platform, 'i'));
		}
	});

	it('no longer singles out Instagram as the only manual case', () => {
		expect(deleteEntry).not.toMatch(/'Instagram: manual/);
		expect(deleteEntry).not.toMatch(/Instagram doesn’t allow apps to delete posts/);
	});

	it('the landing page, already correct, still names all three', () => {
		for (const platform of manualDeletePlatforms) {
			expect(landing, `the landing FAQ never names ${platform}`).toMatch(new RegExp(platform, 'i'));
		}
	});
});
