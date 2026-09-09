/**
 * Persona Model v2 — look → prompt clause.
 *
 * The v2 counterpart of `appearanceToPromptClause` in `$lib/persona-profile`.
 * ADDITIVE: nothing here replaces the v1 clause yet. Prompts for existing
 * personas must stay byte-identical until a flag turns v2 on, so v1 keeps its
 * own implementation and this module is only wired up behind that flag.
 *
 * Two rules drive everything below.
 *
 * 1. STORED TEXT IS SACRED. Every curated look field carries an optional
 *    `*Text` companion holding the value a persona was actually generated with
 *    (a v1 free-text 'honey blonde' that no token matches). The companion ALWAYS
 *    wins over the token's label, because snapping 'honey blonde' to 'Blonde'
 *    would silently change an existing persona's face on its next generation —
 *    the exact failure the v2 storage contract exists to prevent.
 *
 * 2. ORDERING IS PART OF THE CONTRACT. The clause follows v1's discipline —
 *    subject facts first (age, height, skin, build, face), then hair, eyes, the
 *    face-worn attributes, then what they are wearing — so a v1 persona upgraded
 *    to v2 produces a clause the image model reads the same way.
 *
 * Deliberately NOT emitted: heritage/ethnicity (the portrait builders put it in
 * the SUBJECT of the prompt, which is stronger than a trailing clause — carried
 * over from v1), `clothingSizes` (wardrobe logistics, not visual), and
 * `promptCues` (that field IS the cached output of this function).
 *
 * `promptCues` IS NEVER READ — not here, and not by any caller. It is a cache
 * WRITTEN on save and CLEARED by a field re-roll, and nothing in the codebase
 * recomputes it in between; a look whose beard was just re-rolled would carry a
 * stale cue string or none at all. There is no cheap way to prove a cached
 * string still matches the look it was derived from (no hash, no version, no
 * timestamp pair), so the clause is always recomputed from the look itself.
 * Correct and a few microseconds slower beats fast and silently describing a
 * face the persona no longer has. Treat the field as a display hint only.
 */
import { label } from './labels';
import type { PersonaLook } from './schema';

/** The v1 sentinel meaning "unset, let the model decide". Never rendered. */
const BEST_FIT_RE = /^best fit$/i;

/** v1's headwear opt-out spellings — kept identical so upgraded looks behave the same. */
const NO_HEADWEAR_RE = /^(none|no|n\/a)$/i;

/**
 * Gray coverage as a prompt adjective. The LABELS entries are UI copy
 * ('A little gray', 'Salt and pepper') that reads as a form field, not as part
 * of a sentence, so the prompt gets its own adjective form. Unknown tokens fall
 * back to the lowercased label rather than disappearing.
 */
const GRAY_ADJECTIVES: Record<string, string> = {
	light: 'lightly graying',
	salt_and_pepper: 'salt-and-pepper',
	mostly_gray: 'mostly gray',
	white: 'white'
};

/** Eyewear as a worn phrase; 'none' is handled by the caller. */
const EYEWEAR_PHRASES: Record<string, string> = {
	glasses: 'wearing glasses',
	sunglasses_often: 'often wearing sunglasses'
};

/**
 * Facial hair as a NOUN PHRASE for the portrait SUBJECT ("a creator with a short
 * beard"), article included. The trailing clause uses the bare label instead —
 * "short beard" reads correctly in a comma list and wrongly after "with".
 * 'stubble' is a mass noun and takes no article, which is why this is a table
 * and not an `a ${label}` template.
 */
const FACIAL_HAIR_SUBJECT_PHRASES: Record<string, string> = {
	stubble: 'stubble',
	short_beard: 'a short beard',
	full_beard: 'a full beard',
	moustache: 'a moustache',
	goatee: 'a goatee'
};

/** Eyewear as a noun phrase for the subject; 'none' is handled by the caller. */
const EYEWEAR_SUBJECT_PHRASES: Record<string, string> = {
	glasses: 'glasses',
	sunglasses_often: 'sunglasses'
};

/**
 * Look keys the v1 `appearance` shape CANNOT express or resend (the same list
 * `upgradeV1toV2` guards when a v1 patch arrives). Their presence is the only
 * honest evidence that a look was authored on the v2 contract — by the sampler,
 * the vision read-back, or a v2 form — rather than upgraded in memory from v1.
 *
 * Presence, not truthiness: `facialHair: 'none'` renders nothing but still means
 * "someone decided this on the v2 contract".
 */
const V2_ONLY_LOOK_KEYS = ['heightCm', 'faceShape', 'browShape', 'facialHair', 'eyewear'] as const;
const V2_ONLY_HAIR_KEYS = ['texture', 'grayCoverage'] as const;

/**
 * Nested/renamed keys that only ever appear on a v2 look. A v1 appearance is a
 * FLAT record of plain strings (`hairColor`, `hairstyle`, `eyeColor`), so none of
 * these can occur on one.
 */
const V2_SHAPE_KEYS = [
	...V2_ONLY_LOOK_KEYS,
	'hair',
	'eyes',
	'clothingSizes',
	'skinToneText',
	'bodyTypeText',
	'promptCues'
] as const;

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Trims, and drops the empty string and the `Best Fit` sentinel. */
function clean(value: string | null | undefined): string {
	const t = typeof value === 'string' ? value.trim() : '';
	return !t || BEST_FIT_RE.test(t) ? '' : t;
}

/**
 * Resolves one paired field: verbatim `*Text` first (rule 1 — sacred), then the
 * token's label. Returns '' when neither is usable.
 */
function textOrLabel(
	group: Parameters<typeof label>[0],
	token: string | null | undefined,
	text: string | null | undefined
): string {
	const verbatim = clean(text);
	if (verbatim) return verbatim;
	return clean(label(group, clean(token) || undefined));
}

/** Lowercases a token label for mid-sentence use ('Short beard' → 'short beard'). */
function lower(value: string): string {
	return value ? value.toLowerCase() : '';
}

/**
 * Composes the hair phrase: gray, colour, length, texture, style.
 *
 * De-duplication, carried over from v1: personas created before `hairLength`
 * existed store a COMBINED value in the style ('long loose waves'), so emitting
 * the length again reads "long long loose waves". When the resolved style
 * already contains the resolved length as a whole word, the length is dropped.
 * The comparison runs on the RESOLVED strings (text-or-label), because the
 * duplication lives in the stored text, not in the tokens.
 */
function hairPhrase(hair: PersonaLook['hair']): string {
	if (!hair) return '';
	const color = textOrLabel('hairColor', hair.color, hair.colorText);
	const length = textOrLabel('hairLength', hair.length, hair.lengthText);
	const style = textOrLabel('hairstyle', hair.style, hair.styleText);
	const texture = lower(clean(label('hairTexture', clean(hair.texture) || undefined)));
	const grayToken = clean(hair.grayCoverage);
	const gray =
		!grayToken || grayToken === 'none'
			? ''
			: (GRAY_ADJECTIVES[grayToken] ?? lower(clean(label('grayCoverage', grayToken))));

	const lengthIsRedundant =
		!!length && !!style && new RegExp(`\\b${escapeRegExp(length)}\\b`, 'i').test(style);

	const descriptor = [gray, color, lengthIsRedundant ? '' : length, texture, style]
		.filter(Boolean)
		.join(' ');
	return descriptor ? `${descriptor} hair` : '';
}

/**
 * True when `value` is shaped like a v2 `look` rather than a v1 `appearance`.
 *
 * The two shapes overlap on the free-form keys they share (`wardrobe`,
 * `styling`, `distinctiveFeatures`, and the `skinTone`/`bodyType` names, which
 * hold a LABEL in v1 and a TOKEN in v2), so only the v2-exclusive keys above can
 * decide. An object carrying none of them is AMBIGUOUS and is reported as v1 —
 * the conservative answer, because v1 is what every existing caller passes and
 * misreading one as v2 would run its labels through `label()` as if they were
 * tokens.
 */
export function isV2Look(value: unknown): value is PersonaLook {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return V2_SHAPE_KEYS.some((k) => k in value);
}

/**
 * True when the look holds at least one attribute the v1 shape cannot carry.
 *
 * This is the switch a prompt builder needs: a v1 persona read as v2 (every
 * profile still stored as v1, upgraded in memory) has NONE of these, so it keeps
 * taking the v1 clause path and its prompts stay byte-identical. A persona the
 * v2 sampler or the vision read-back wrote has at least one, and gets the v2
 * clause with its beard, glasses, face shape, height and hair texture intact.
 */
export function hasV2OnlyLookAttributes(look: PersonaLook | null | undefined): boolean {
	if (!look || typeof look !== 'object') return false;
	if (V2_ONLY_LOOK_KEYS.some((k) => k in look)) return true;
	const hair = look.hair;
	return !!hair && typeof hair === 'object' && V2_ONLY_HAIR_KEYS.some((k) => k in hair);
}

/**
 * The drift-prone attributes as a phrase for the portrait SUBJECT —
 * ' with a short beard and glasses', or '' when neither is set.
 *
 * Deliberately restated here even though `lookToPromptClause` already names them
 * in the trailing clause. Facial hair and eyewear are the two attributes image
 * models drop between the hero portrait and a later edit ("the beard disappears
 * on the second image"); naming them in the subject — the strongest position in
 * the prompt — is what holds them, and the redundancy with the trailing clause
 * is the point, not an oversight.
 *
 * Scope is exactly the two drift sources, matching `lookPreservationClause`.
 * Height, face shape and hair texture do not drift and would only dilute the
 * subject.
 */
export function lookSubjectAttributes(look: PersonaLook | null | undefined): string {
	const l = look ?? {};
	const parts: string[] = [];

	const facialHairToken = clean(l.facialHair);
	if (facialHairToken && facialHairToken !== 'none') {
		const phrase =
			FACIAL_HAIR_SUBJECT_PHRASES[facialHairToken] ??
			lower(clean(label('facialHair', facialHairToken)));
		if (phrase) parts.push(phrase);
	}

	const eyewearToken = clean(l.eyewear);
	if (eyewearToken && eyewearToken !== 'none') {
		const phrase =
			EYEWEAR_SUBJECT_PHRASES[eyewearToken] ?? lower(clean(label('eyewear', eyewearToken)));
		if (phrase) parts.push(phrase);
	}

	return parts.length ? ` with ${parts.join(' and ')}` : '';
}

/**
 * Turns a v2 look into the trailing "Appearance: …" clause appended to an image
 * prompt. Returns '' (never undefined) when nothing is set, so the model is left
 * free rather than being handed an empty instruction.
 *
 * `opts.age` is passed in rather than read off the look because v2 stores an
 * exact age on the creator, not v1's bucket — the clause renders it as
 * "34 years old" where v1 rendered "30–35 years old".
 *
 * Pure and deterministic: the same input always yields the identical string, and
 * the input object is never mutated (the cached `promptCues` on a saved persona
 * must be reproducible from the look alone).
 */
export function lookToPromptClause(
	look: PersonaLook | null | undefined,
	opts?: { age?: number }
): string {
	const l = look ?? {};
	const parts: string[] = [];

	// Subject facts lead: they describe who this is before the styling details do.
	const age = opts?.age;
	if (typeof age === 'number' && Number.isFinite(age) && age > 0) {
		parts.push(`${Math.round(age)} years old`);
	}
	if (typeof l.heightCm === 'number' && Number.isFinite(l.heightCm) && l.heightCm > 0) {
		parts.push(`about ${Math.round(l.heightCm)} cm tall`);
	}

	// v1-era fields render with their label casing untouched, so an upgraded
	// persona's clause matches the one v1 produced for it.
	const skinTone = textOrLabel('skinTone', l.skinTone, l.skinToneText);
	if (skinTone) parts.push(`${skinTone} skin tone`);
	const bodyType = textOrLabel('bodyType', l.bodyType, l.bodyTypeText);
	if (bodyType) parts.push(`${bodyType} build`);

	// v2-only token fields are lowercased: their labels are UI sentence-case
	// ('Soft arch') and would read as headings inside the sentence.
	const faceShape = lower(clean(label('faceShape', clean(l.faceShape) || undefined)));
	if (faceShape) parts.push(`${faceShape} face`);
	const browShape = lower(clean(label('browShape', clean(l.browShape) || undefined)));
	if (browShape) parts.push(`${browShape} brows`);

	const hair = hairPhrase(l.hair);
	if (hair) parts.push(hair);

	const eyeColor = textOrLabel('eyeColor', l.eyes?.color, l.eyes?.colorText);
	if (eyeColor) parts.push(`${eyeColor} eyes`);

	// Facial hair and eyewear sit next to the eyes because they are face-worn,
	// and because they are the two attributes a regeneration most often drops
	// (see `lookPreservationClause`).
	const facialHairToken = clean(l.facialHair);
	if (facialHairToken && facialHairToken !== 'none') {
		const facialHair = lower(clean(label('facialHair', facialHairToken)));
		if (facialHair) parts.push(facialHair);
	}
	const eyewearToken = clean(l.eyewear);
	if (eyewearToken && eyewearToken !== 'none') {
		const eyewear = EYEWEAR_PHRASES[eyewearToken] ?? lower(clean(label('eyewear', eyewearToken)));
		if (eyewear) parts.push(eyewear);
	}

	const distinctiveFeatures = clean(l.distinctiveFeatures);
	if (distinctiveFeatures) parts.push(distinctiveFeatures);

	const headwear = clean(l.headwear);
	if (headwear && !NO_HEADWEAR_RE.test(headwear)) parts.push(`wearing a ${headwear}`);

	const wardrobe = clean(l.wardrobe);
	if (wardrobe) parts.push(`dressed in ${wardrobe}`);
	const outfitColors = clean(l.outfitColors);
	if (outfitColors) parts.push(`outfit in ${outfitColors}`);
	const styling = clean(l.styling);
	if (styling) parts.push(`${styling} styling`);

	return parts.length ? ` Appearance: ${parts.join(', ')}.` : '';
}

/**
 * The sentence a REGENERATE / edit prompt appends to hold drift-prone
 * attributes fixed.
 *
 * Scope is deliberately two attributes. Across this codebase's portrait
 * regenerations, facial hair and eyewear are the attributes image models drop
 * most often: a bearded persona comes back clean-shaven, a persona in glasses
 * comes back without them, while hair colour and build survive the round trip.
 * Restating everything would dilute the instruction, so only the two known
 * drift sources are named — and they are named explicitly ("their glasses",
 * "their facial hair") because a generic "keep their face" does not hold them.
 *
 * Returns '' when neither applies, so callers can concatenate unconditionally.
 */
export function lookPreservationClause(look: PersonaLook | null | undefined): string {
	const l = look ?? {};
	const sentences: string[] = [];

	const facialHairToken = clean(l.facialHair);
	if (facialHairToken && facialHairToken !== 'none') {
		const facialHair = lower(clean(label('facialHair', facialHairToken)));
		if (facialHair) {
			sentences.push(`Keep their facial hair exactly as in the reference: ${facialHair}.`);
		}
	}

	const eyewearToken = clean(l.eyewear);
	if (eyewearToken === 'glasses') sentences.push('Keep their glasses.');
	else if (eyewearToken === 'sunglasses_often') sentences.push('Keep their sunglasses.');

	return sentences.length ? ` ${sentences.join(' ')}` : '';
}
