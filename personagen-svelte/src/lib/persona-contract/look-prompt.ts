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
