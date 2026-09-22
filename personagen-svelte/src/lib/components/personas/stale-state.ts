/**
 * "Stale state" — the warnings the persona page shows when an artefact on it no
 * longer matches the persona it belongs to.
 *
 * A portrait, a set of reference photos and a cast voice are all made FROM a
 * profile at one moment. The profile keeps moving afterwards, and a generation
 * can die halfway without anything on the page changing. The page then shows a
 * face, a photo grid and a voice as though all three are current. This module
 * is the one place that says otherwise.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: a persona nobody has touched must
 * produce nothing. A page that cries wolf is a page whose warnings are scrolled
 * past, and the one warning that mattered goes with them. So every warning
 * below is keyed on evidence some code path actually WRITES — never on a
 * plausible field nobody sets, which is a warning that can only ever be silent
 * or wrong. What that leaves out, and why, is written down at the bottom.
 *
 * The evidence, and only this:
 *   • `agent.ugc_reference_kit.profile_status` / `profile_started_at` — the
 *     portrait job's markers. `/api/agent/[id]/generate-avatar` sets them before
 *     responding, DELETES them on success, and on failure leaves
 *     `profile_status: 'failed: …'` behind until the next attempt. A failed or
 *     abandoned marker is therefore durable proof that the pinned face is not
 *     the one the user last asked for.
 *   • `agent.ugc_reference_kit.<stage>_status` / `<stage>_started_at` — exactly
 *     the same contract, per reference-photo stage, from
 *     `/api/agent/[id]/generate-reference-kit`.
 *   • the stored profile's `voice.gender` against `creator.gender` — the voice
 *     is cast at generation time from the persona's gender; editing the persona
 *     afterwards does not re-cast it, and the two are then a recorded
 *     disagreement about the same person.
 *
 * Pure, client-safe, and it never throws: an unreadable agent describes nothing,
 * which is the correct answer rather than a failure.
 */
import { isToken, label, readPersonaProfileV2 } from '$lib/persona-contract';
import { hasDescribableLook, lookFingerprint } from '$lib/persona-contract/look-fingerprint';

/**
 * What the user can DO about a warning, described as data.
 *
 * A client audit filed this as UX-007: the reference-photo notice said
 * "Generate them again when you're ready" and carried no control. The user was
 * told to retry and given no retry. Every warning below that asks the reader to
 * act now carries the act.
 *
 * It stays a descriptor, not a callback, so this module remains pure and
 * client-safe: the page decides HOW to run it, and does so through the same
 * confirm-first flow as the original generation. A retry spends money exactly
 * like the first attempt did, so it earns no shortcut past that approval.
 */
export type StaleAction =
	| { kind: 'regenerate-portrait'; label: string }
	| { kind: 'regenerate-kit-stage'; label: string; stage: string }
	| { kind: 'recast-voice'; label: string };

export interface StaleWarning {
	/** Stable across renders and releases; used as the keyed-each key. */
	key: string;
	title: string;
	detail: string;
	/** 'warn' — something failed. 'info' — nothing broke, but what you see is old. */
	severity: 'info' | 'warn';
	/** The fix, when there is one the page can run. */
	action?: StaleAction;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

/**
 * How long a 'generating' marker is trusted before it is read as a job that
 * died (deploy or restart mid-generation). Mirrors `IN_FLIGHT_STALE_MS` in both
 * generation routes deliberately: below this window the server itself still
 * refuses a retry as a duplicate, so warning would contradict the product.
 */
const IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

/**
 * Reference-photo stages, in the order they are generated and displayed, with
 * the names a customer sees. `profile` is NOT here — that is the portrait, and
 * it gets its own warnings.
 */
const KIT_STAGES: readonly { key: string; name: string }[] = [
	{ key: 'sheet', name: 'the character sheet' },
	{ key: 'full_body', name: 'the full-body shot' },
	{ key: 'side_profiles', name: 'the side profiles' },
	{ key: 'face_closeup', name: 'the face close-up' },
	{ key: 'feature_grid', name: 'the feature grid' }
];

/** 'a, b and c' — in the order given, never sorted by what happened to fail. */
function joinNames(names: readonly string[]): string {
	if (names.length <= 1) return names[0] ?? '';
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A `<key>_status` that records a failure. The routes write `failed: <message>`. */
const isFailed = (status: string | undefined): boolean =>
	!!status && status.toLowerCase().startsWith('failed');

/**
 * A `<key>_status` of 'generating' whose job is no longer plausibly alive:
 * either its start is older than the in-flight window, or it carries no start
 * at all — which the generation routes themselves treat as a dead task.
 *
 * A start stamped in the FUTURE (a client clock behind the server's) counts as
 * running, not as stalled. Guessing "stalled" from a clock disagreement is the
 * exact false alarm this module exists to avoid.
 */
function isStalled(kit: Obj, statusKey: string, startedKey: string, now: number): boolean {
	if (str(kit[statusKey]) !== 'generating') return false;
	const startedAt = str(kit[startedKey]);
	if (startedAt === undefined) return true;
	const started = Date.parse(startedAt);
	if (!Number.isFinite(started)) return true;
	return now - started >= IN_FLIGHT_STALE_MS;
}

/** The stored reference kit, or an empty one. Never throws. */
function referenceKit(agent: unknown): Obj {
	const row = isObj(agent) ? agent.ugc_reference_kit : undefined;
	return isObj(row) ? row : {};
}

/**
 * The persona's gender as cast into the voice, and as the profile now states
 * it — but only when both are real gender values. An absent, unknown or
 * off-list value on either side is not a disagreement, it is silence.
 */
function voiceGenderMismatch(agent: unknown): { voice: string; creator: string } | undefined {
	try {
		const profile = readPersonaProfileV2(isObj(agent) ? agent : null);
		const voice = str(profile?.voice?.gender);
		const creator = str(profile?.creator?.gender);
		if (!voice || !creator || voice === creator) return undefined;
		if (!isToken('gender', voice) || !isToken('gender', creator)) return undefined;
		return { voice, creator };
	} catch {
		return undefined;
	}
}

/**
 * Every warning that applies to this persona, in a fixed order: portrait first
 * (it is the artefact the page leads with), then the reference photos it feeds,
 * then the voice. `[]` means "render nothing" — the caller must not draw a
 * banner, a heading or an empty slot for an empty result.
 *
 * `now` is injectable so a test asserts on a persona rather than on the clock.
 */
export function staleWarnings(agent: unknown, now: number = Date.now()): StaleWarning[] {
	const out: StaleWarning[] = [];
	const kit = referenceKit(agent);

	// ── Portrait ─────────────────────────────────────────────────────────────
	if (isFailed(str(kit.profile_status))) {
		out.push({
			key: 'portrait-failed',
			title: 'The last portrait didn’t finish',
			detail:
				'Something went wrong the last time this persona’s portrait was generated, so the picture here is still the previous one. Generate it again when you’re ready.',
			severity: 'warn',
			action: { kind: 'regenerate-portrait', label: 'Generate portrait again' }
		});
	} else if (isStalled(kit, 'profile_status', 'profile_started_at', now)) {
		out.push({
			key: 'portrait-stalled',
			title: 'A portrait was started but never arrived',
			detail:
				'A portrait for this persona was started a while ago and never came back, so the picture here is still the previous one. Nothing is running now — it’s safe to start it again.',
			severity: 'info',
			action: { kind: 'regenerate-portrait', label: 'Start portrait again' }
		});
	}

	// ── Portrait vs the appearance it was made from ──────────────────────────
	// The headline case, and until now it could not be detected: nothing recorded
	// what a portrait was rendered from, and `meta.generatedAt` is bumped by every
	// save, so any timestamp comparison would have warned about someone who fixed
	// a typo. The avatar route now stores a fingerprint of the appearance it fed
	// the model; this recomputes it and compares.
	//
	// Only fires when there IS a recorded fingerprint, so every portrait taken
	// before this shipped stays silent rather than being declared stale on the
	// strength of a field that did not exist when it ran.
	const renderedFrom = str(kit.profile_look_fingerprint);
	if (
		renderedFrom &&
		!isFailed(str(kit.profile_status)) &&
		str(kit.profile_status) !== 'generating'
	) {
		const profile = readPersonaProfileV2(isObj(agent) ? (agent as never) : undefined);
		if (hasDescribableLook(profile) && lookFingerprint(profile) !== renderedFrom) {
			out.push({
				key: 'portrait-outdated',
				title: 'This portrait was made before you changed how they look',
				detail:
					'The appearance on this persona has been edited since the picture was generated, so the face here no longer matches the description everything else uses. Generate the portrait again to bring them back together.',
				severity: 'warn',
				action: { kind: 'regenerate-portrait', label: 'Generate portrait again' }
			});
		}
	}

	// ── Reference photos ─────────────────────────────────────────────────────
	const failedStages = KIT_STAGES.filter((stage) => isFailed(str(kit[`${stage.key}_status`])));
	const stalledStages = KIT_STAGES.filter(
		(stage) =>
			!isFailed(str(kit[`${stage.key}_status`])) &&
			isStalled(kit, `${stage.key}_status`, `${stage.key}_started_at`, now)
	);

	if (failedStages.length) {
		out.push({
			key: 'reference-photos-failed',
			title: 'Some reference photos didn’t finish',
			detail: `${joinNames(failedStages.map((stage) => stage.name))} failed to generate, so the photos that keep this persona’s face the same across videos are incomplete. Generate them again when you’re ready.`,
			severity: 'warn',
			// The stages build on each other, so the useful retry is the EARLIEST
			// one that failed; the page's own order gate handles the rest.
			action: {
				kind: 'regenerate-kit-stage',
				label: `Retry ${failedStages[0].name.replace(/^the /, '')}`,
				stage: failedStages[0].key
			}
		});
	}
	if (stalledStages.length) {
		out.push({
			key: 'reference-photos-stalled',
			title: 'Some reference photos never arrived',
			detail: `${joinNames(stalledStages.map((stage) => stage.name))} were started a while ago and never came back. Nothing is running now — it’s safe to start them again.`,
			severity: 'info',
			action: {
				kind: 'regenerate-kit-stage',
				label: `Start ${stalledStages[0].name.replace(/^the /, '')} again`,
				stage: stalledStages[0].key
			}
		});
	}

	// ── Voice ────────────────────────────────────────────────────────────────
	const mismatch = voiceGenderMismatch(agent);
	if (mismatch) {
		const cast = label('gender', mismatch.voice).toLowerCase();
		const nowIs = label('gender', mismatch.creator).toLowerCase();
		out.push({
			key: 'voice-gender',
			title: 'The voice doesn’t match this persona any more',
			detail: `This persona’s voice was cast as ${cast} back when the persona was too. The persona is ${nowIs} now, so anything spoken in that voice will sound like someone else. Pick the voice again.`,
			severity: 'warn',
			action: { kind: 'recast-voice', label: 'Pick a voice' }
		});
	}

	return out;
}

/**
 * DELIBERATELY NOT DETECTED, because nothing writes the evidence — each of
 * these would be a warning that can never fire, and a test for it would pass
 * forever while the customer stayed uninformed:
 *
 *   • "Your portrait was generated before you edited this persona's
 *     appearance." Nothing records WHEN the pinned portrait was made. The
 *     portrait job deletes `profile_started_at` on success and
 *     `agent_configs.ugc_character_ref` is a bare URL, so there is no instant
 *     to compare `meta.generatedAt` against. One line in the portrait generator
 *     — stamping the completion time, and ideally the look clause it ran with,
 *     into the reference kit — would make this detectable, and it is the single
 *     highest-value warning this page is missing.
 *
 *   • "This voice isn't available any more." `voice.voiceMatch` and
 *     `voice.pinnedVoice` exist in the schema but no code path stores them; the
 *     generator returns `voiceMatch` in its RESPONSE only, and the pinned voice
 *     lives in `agent_configs.ugc_voice`, which carries a column default
 *     ('Adam') that is not a choice. Keying on either would fire on personas
 *     nobody ever cast a voice for.
 *
 *   • "The bios and handles were written for a different persona." The identity
 *     kit records no generation time either, and `meta.generatedAt` moves on
 *     every save of any field, so comparing them would warn about a persona
 *     whose owner only fixed a typo.
 */
