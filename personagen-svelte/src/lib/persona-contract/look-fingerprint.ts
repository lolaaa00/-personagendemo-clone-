/**
 * Persona Model v2 — a fingerprint of the appearance a portrait was generated from.
 *
 * THE PROBLEM THIS EXISTS FOR. A persona's portrait is generated from its
 * appearance. The user then edits the appearance, and the portrait silently
 * stops matching the person it belongs to. The page has no way to say so,
 * because nothing anywhere records what the portrait was made from.
 *
 * Timestamps cannot answer it. `meta.generatedAt` is bumped by EVERY save, so a
 * customer who fixes a typo in their bio would be told their portrait is stale.
 * The avatar route deletes its own progress markers on success and keeps
 * nothing. So the honest comparison is not "which is newer" but "was the face
 * described by the same words" — and that needs a fingerprint of the INPUTS,
 * taken when the portrait ran and compared when the page renders.
 *
 * WHY THE INPUTS AND NOT THE PROMPT. Fingerprinting the rendered prompt clause
 * would be simpler, and wrong: improving the wording of a prompt would change
 * every fingerprint at once and tell every customer their portrait was stale,
 * when nothing about their persona had moved. The fingerprint covers the fields
 * that describe the face, and changes only when one of them does.
 *
 * Pure, client-safe, never throws — the page recomputes it on render and the
 * server records it after a generation, so both sides must agree exactly.
 */
import { isObj, type Obj } from './paths';
import type { PersonaProfileV2 } from './schema';

/**
 * The appearance fields a portrait actually depends on, in a FIXED order.
 *
 * Ordered explicitly rather than walked, because an object-key walk would make
 * the fingerprint depend on insertion order — two records with identical
 * appearance would fingerprint differently, and every portrait would read as
 * stale after any save that rebuilt the object.
 *
 * Wardrobe, styling and outfit colours are deliberately absent: they describe
 * clothing, not the face, and the portrait is a head-and-shoulders shot. A
 * customer changing a jacket should not be told their face is out of date.
 */
const V2_LOOK_FIELDS = [
	'skinTone',
	'skinToneText',
	'bodyType',
	'bodyTypeText',
	'heightCm',
	'faceShape',
	'browShape',
	'facialHair',
	'eyewear',
	'headwear',
	'distinctiveFeatures'
] as const;

const V2_HAIR_FIELDS = [
	'color',
	'colorText',
	'length',
	'lengthText',
	'style',
	'styleText',
	'texture',
	'grayCoverage'
] as const;
const V2_EYE_FIELDS = ['color', 'colorText'] as const;

/** The v1 appearance keys that describe a face. Same reasoning, older shape. */
const V1_APPEARANCE_FIELDS = [
	'ethnicity',
	'skinTone',
	'bodyType',
	'hairColor',
	'hairLength',
	'hairstyle',
	'eyeColor',
	'headwear',
	'distinctiveFeatures'
] as const;

/**
 * Creator facts a portrait states about the subject. Age and gender reach the
 * prompt directly ("a 41-year-old", "male"), and heritage drives the ethnicity
 * emphasis, so a change to any of them genuinely produces a different face.
 */
const CREATOR_FIELDS = ['age', 'ageSource', 'gender', 'heritage'] as const;

function scalar(value: unknown): string {
	if (value === undefined || value === null || value === '') return '';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'boolean') return value ? '1' : '';
	return '';
}

/**
 * The canonical description of a face, as a single string.
 *
 * Exported for the spec and for debugging a fingerprint mismatch: when a
 * customer is told their portrait is stale, someone needs to be able to see
 * WHICH field moved, and comparing two of these answers that instantly.
 */
export function lookCanonicalForm(agentOrProfile: unknown): string {
	const root = isObj(agentOrProfile) ? (agentOrProfile as Obj) : {};
	const profile = root as unknown as PersonaProfileV2;

	const parts: string[] = [];
	const creator = isObj(profile.creator) ? (profile.creator as unknown as Obj) : {};
	for (const field of CREATOR_FIELDS) parts.push(`c.${field}=${scalar(creator[field])}`);

	const look = isObj(profile.look) ? (profile.look as unknown as Obj) : {};
	for (const field of V2_LOOK_FIELDS) parts.push(`l.${field}=${scalar(look[field])}`);
	const hair = isObj(look.hair) ? (look.hair as Obj) : {};
	for (const field of V2_HAIR_FIELDS) parts.push(`l.hair.${field}=${scalar(hair[field])}`);
	const eyes = isObj(look.eyes) ? (look.eyes as Obj) : {};
	for (const field of V2_EYE_FIELDS) parts.push(`l.eyes.${field}=${scalar(eyes[field])}`);

	// A persona still stored as v1 has no `look` at all. Its appearance record is
	// covered too, so a v1 persona's portrait can go stale exactly like a v2 one
	// — they are the majority, and excluding them would make the whole warning
	// apply to almost nobody.
	const legacy = isObj(profile._legacy) ? (profile._legacy as Obj) : {};
	const appearance = isObj(root.appearance)
		? (root.appearance as Obj)
		: isObj(legacy.appearance)
			? (legacy.appearance as Obj)
			: {};
	for (const field of V1_APPEARANCE_FIELDS) parts.push(`a.${field}=${scalar(appearance[field])}`);

	return parts.join('|');
}

/**
 * A short, stable hash of the canonical form.
 *
 * FNV-1a: tiny, dependency-free, identical in node and the browser, and this is
 * not a security boundary — a collision would mean failing to warn about a
 * change, never a false alarm, and the field set is small enough that the risk
 * is negligible. `crypto.subtle` is async and would force every caller into a
 * promise for no benefit.
 */
export function lookFingerprint(agentOrProfile: unknown): string {
	const text = lookCanonicalForm(agentOrProfile);
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		// FNV prime, via shifts so the maths stays in 32-bit territory.
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/**
 * True when a face is described at all. A profile with no appearance anywhere
 * fingerprints to a constant, and recording that constant would let every
 * blank persona "match" every other one — so callers check this first and
 * record nothing when there is nothing to describe.
 */
export function hasDescribableLook(agentOrProfile: unknown): boolean {
	const canonical = lookCanonicalForm(agentOrProfile);
	return canonical.split('|').some((pair) => !pair.endsWith('='));
}
