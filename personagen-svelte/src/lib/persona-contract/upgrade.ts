/**
 * Persona Model v2 — the pure v1 ⇄ v2 converters.
 *
 * `upgradeV1toV2` is what `readPersonaProfile()` will run on every legacy blob
 * (P0.3): in memory, on read, never persisted until the next ordinary save.
 * `downgradeV2toV1` exists for Phase 0's rollback path — it is the one phase
 * whose rollback cannot rely on a flag, so the inverse is written and tested
 * alongside the forward direction.
 *
 * Invariants (upgrade.spec.ts):
 *   • pure: no I/O, input never mutated
 *   • idempotent: upgrade(upgrade(x)) deep-equals upgrade(x); a v2 input is returned as-is
 *   • lossless: every v1 value survives — as a token when it matches the
 *     registry, otherwise VERBATIM in a *Text companion or in `_legacy`
 *   • provenance: every leaf produced from v1 is marked 'user' — it was
 *     visible and editable, so it is the user's, and automation may never
 *     overwrite it
 *   • round-trip: downgrade(upgrade(v1)) reproduces v1's meaning (labels back,
 *     bounds re-derived from buckets)
 *
 * Client-safe.
 */
import { AGE_RANGE_BOUNDS, ageBoundsFromRanges, deriveAgeRanges } from '../persona-age';
import type { PersonaProfile } from '../persona-profile-store';
import { coerceHandleCandidates, coerceBios, coerceConfirmedHandles } from '../persona-identity';
import { label, tokenForLabel } from './labels';
import {
	PERSONA_SCHEMA_VERSION,
	isPersonaProfileV2,
	type FieldSource,
	type PersonaLook,
	type PersonaProfileV2
} from './schema';
import { isToken, type TokenOf } from './tokens';

/** Midpoint used when only a v1 apparent-age bucket exists. `ageSource: 'bucket'` records the imprecision. */
const PERSONA_AGE_MIDPOINT: Record<TokenOf<'personaAge'>, number> = {
	'18_24': 21,
	'25_29': 27,
	'30_35': 32,
	'36_44': 40,
	'45_54': 49,
	'55_64': 59,
	'65_plus': 68
};

/** v1 keys the upgrade understands; anything else goes to `_legacy` untouched. */
const KNOWN_V1_KEYS = new Set([
	'ageRanges',
	'ageMin',
	'ageMax',
	'gender',
	'archetype',
	'contentFocus',
	'psychProfile',
	'contentAngle',
	'targetAvatar',
	'appearance',
	'voiceProfile',
	'bios',
	'handleCandidates',
	'confirmedHandles',
	'displayName'
]);

const text = (v: unknown): string | undefined => {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return t ? t : undefined;
};

/** Sets `obj[key] = value` only when value is defined; records the leaf path as user-owned. */
function put<T extends object, K extends keyof T>(
	obj: T,
	key: K,
	value: T[K] | undefined,
	path: string,
	sources: Record<string, FieldSource>
): void {
	if (value === undefined) return;
	obj[key] = value;
	sources[path] = 'user';
}

/**
 * Curated look trait: token when the v1 text matches the registry, and the
 * verbatim text ALWAYS kept alongside — the "never snap a stored value" rule.
 */
function lookTrait<G extends 'skinTone' | 'bodyType' | 'hairColor' | 'hairLength' | 'hairstyle' | 'eyeColor'>(
	group: G,
	raw: unknown
): { token?: TokenOf<G>; text?: string } {
	const t = text(raw);
	if (!t) return {};
	const token = tokenForLabel(group, t) ?? undefined;
	return { token, text: t };
}

export function upgradeV1toV2(input: unknown): PersonaProfileV2 {
	if (isPersonaProfileV2(input)) return input;
	const v1: Record<string, unknown> =
		input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

	const sources: Record<string, FieldSource> = {};
	const out: PersonaProfileV2 = {
		meta: { schemaVersion: PERSONA_SCHEMA_VERSION, generator: 'manual', upgradedFrom: 1 }
	};

	// ── creator ──────────────────────────────────────────────────────────────
	const creator: NonNullable<PersonaProfileV2['creator']> = {};
	if (v1.gender === 'female' || v1.gender === 'male') put(creator, 'gender', v1.gender, 'creator.gender', sources);
	put(creator, 'displayName', text(v1.displayName), 'creator.displayName', sources);

	const appearance =
		v1.appearance && typeof v1.appearance === 'object' && !Array.isArray(v1.appearance)
			? (v1.appearance as Record<string, unknown>)
			: {};

	const heritageText = text(appearance.ethnicity);
	if (heritageText) {
		const token = tokenForLabel('heritage', heritageText);
		if (token) put(creator, 'heritage', token, 'creator.heritage', sources);
		put(creator, 'heritageText', heritageText, 'creator.heritageText', sources);
	}
	const personaAge = tokenForLabel('personaAge', text(appearance.personaAge));
	if (personaAge) {
		put(creator, 'age', PERSONA_AGE_MIDPOINT[personaAge], 'creator.age', sources);
		creator.ageSource = 'bucket';
	}
	if (Object.keys(creator).length) out.creator = creator;

	// ── look ─────────────────────────────────────────────────────────────────
	const look: PersonaLook = {};
	const skin = lookTrait('skinTone', appearance.skinTone);
	put(look, 'skinTone', skin.token, 'look.skinTone', sources);
	put(look, 'skinToneText', skin.text, 'look.skinToneText', sources);
	const body = lookTrait('bodyType', appearance.bodyType);
	put(look, 'bodyType', body.token, 'look.bodyType', sources);
	put(look, 'bodyTypeText', body.text, 'look.bodyTypeText', sources);

	const hair: NonNullable<PersonaLook['hair']> = {};
	const hc = lookTrait('hairColor', appearance.hairColor);
	put(hair, 'color', hc.token, 'look.hair.color', sources);
	put(hair, 'colorText', hc.text, 'look.hair.colorText', sources);
	const hl = lookTrait('hairLength', appearance.hairLength);
	put(hair, 'length', hl.token, 'look.hair.length', sources);
	put(hair, 'lengthText', hl.text, 'look.hair.lengthText', sources);
	const hs = lookTrait('hairstyle', appearance.hairstyle);
	put(hair, 'style', hs.token, 'look.hair.style', sources);
	put(hair, 'styleText', hs.text, 'look.hair.styleText', sources);
	if (Object.keys(hair).length) look.hair = hair;

	const ec = lookTrait('eyeColor', appearance.eyeColor);
	if (ec.text) {
		const eyes: NonNullable<PersonaLook['eyes']> = {};
		put(eyes, 'color', ec.token, 'look.eyes.color', sources);
		put(eyes, 'colorText', ec.text, 'look.eyes.colorText', sources);
		look.eyes = eyes;
	}
	put(look, 'wardrobe', text(appearance.wardrobe), 'look.wardrobe', sources);
	put(look, 'outfitColors', text(appearance.outfitColors), 'look.outfitColors', sources);
	put(look, 'headwear', text(appearance.headwear), 'look.headwear', sources);
	put(look, 'distinctiveFeatures', text(appearance.distinctiveFeatures), 'look.distinctiveFeatures', sources);
	put(look, 'styling', text(appearance.styling), 'look.styling', sources);
	if (Object.keys(look).length) out.look = look;

	// ── voice ────────────────────────────────────────────────────────────────
	const vp =
		v1.voiceProfile && typeof v1.voiceProfile === 'object' && !Array.isArray(v1.voiceProfile)
			? (v1.voiceProfile as Record<string, unknown>)
			: null;
	if (vp) {
		const voice: NonNullable<PersonaProfileV2['voice']> = {};
		if (vp.gender === 'female' || vp.gender === 'male') put(voice, 'gender', vp.gender, 'voice.gender', sources);
		put(voice, 'nationality', text(vp.nationality), 'voice.nationality', sources);
		put(voice, 'accent', text(vp.accent), 'voice.accent', sources);
		if (Object.keys(voice).length) out.voice = voice;
	}

	// ── audience ─────────────────────────────────────────────────────────────
	const audience: NonNullable<PersonaProfileV2['audience']> = {};
	// Buckets first; a numbers-only legacy profile recovers its buckets from the bounds.
	const legacyRanges = deriveAgeRanges(v1 as PersonaProfile);
	if (legacyRanges.length) {
		const tokens = legacyRanges
			.map((r) => tokenForLabel('ageRange', r))
			.filter((t): t is TokenOf<'ageRange'> => t !== null);
		if (tokens.length) put(audience, 'ageRanges', tokens, 'audience.ageRanges', sources);
	}
	put(audience, 'targetAvatar', text(v1.targetAvatar), 'audience.targetAvatar', sources);
	put(audience, 'psychProfile', text(v1.psychProfile), 'audience.psychProfile', sources);
	if (Object.keys(audience).length) out.audience = audience;

	// ── strategy ─────────────────────────────────────────────────────────────
	const strategy: NonNullable<PersonaProfileV2['strategy']> = {};
	const arch = text(v1.archetype);
	if (arch) {
		const token = tokenForLabel('archetype', arch);
		if (token) put(strategy, 'archetype', token, 'strategy.archetype', sources);
		else put(strategy, 'archetypeText', arch, 'strategy.archetypeText', sources);
	}
	const focus = text(v1.contentFocus);
	if (focus) {
		const token = tokenForLabel('contentFocus', focus);
		if (token) put(strategy, 'contentFocus', token, 'strategy.contentFocus', sources);
		else put(strategy, 'contentFocusText', focus, 'strategy.contentFocusText', sources);
	}
	put(strategy, 'contentAngle', text(v1.contentAngle), 'strategy.contentAngle', sources);
	if (Object.keys(strategy).length) out.strategy = strategy;

	// ── identity kit ─────────────────────────────────────────────────────────
	const kit: NonNullable<PersonaProfileV2['identityKit']> = {};
	if (v1.bios !== undefined) {
		const bios = coerceBios(v1.bios);
		if (Object.keys(bios).length) put(kit, 'bios', bios, 'identityKit.bios', sources);
	}
	if (v1.handleCandidates !== undefined) {
		const hc = coerceHandleCandidates(v1.handleCandidates);
		if (hc.length) put(kit, 'handleCandidates', hc, 'identityKit.handleCandidates', sources);
	}
	if (v1.confirmedHandles !== undefined) {
		const ch = coerceConfirmedHandles(v1.confirmedHandles);
		if (Object.keys(ch).length) put(kit, 'confirmedHandles', ch, 'identityKit.confirmedHandles', sources);
	}
	if (Object.keys(kit).length) out.identityKit = kit;

	// ── unknown keys: carried, never dropped ─────────────────────────────────
	const legacy: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(v1)) {
		if (!KNOWN_V1_KEYS.has(k) && v !== undefined) legacy[k] = v;
	}
	// Appearance keys the contract does not know are legacy too.
	const knownAppearance = new Set([
		'ethnicity',
		'personaAge',
		'skinTone',
		'bodyType',
		'hairLength',
		'hairstyle',
		'hairColor',
		'eyeColor',
		'wardrobe',
		'outfitColors',
		'headwear',
		'distinctiveFeatures',
		'styling'
	]);
	const strayAppearance: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(appearance)) {
		if (!knownAppearance.has(k) && v !== undefined) strayAppearance[k] = v;
	}
	if (Object.keys(strayAppearance).length) legacy.appearance = strayAppearance;
	if (Object.keys(legacy).length) out._legacy = legacy;

	if (Object.keys(sources).length) out.meta.fieldSources = sources;
	return out;
}

/** Label for a curated trait: the token's label, else the verbatim text. */
const back = <G extends 'skinTone' | 'bodyType' | 'hairColor' | 'hairLength' | 'hairstyle' | 'eyeColor' | 'heritage'>(
	group: G,
	token: string | undefined,
	verbatim: string | undefined
): string | undefined => (token ? label(group, token) : verbatim);

/**
 * Inverse of the upgrade, for Phase 0 rollback. Labels come back from the
 * registry; verbatim text wins where no token exists; audience bounds are
 * re-derived from the buckets exactly as the v1 store does.
 */
export function downgradeV2toV1(v2: PersonaProfileV2): PersonaProfile {
	const out: PersonaProfile & Record<string, unknown> = {};
	const c = v2.creator ?? {};
	const l = v2.look ?? {};
	const a = v2.audience ?? {};
	const s = v2.strategy ?? {};
	const k = v2.identityKit ?? {};

	if (a.ageRanges?.length) {
		const ranges = a.ageRanges.map((t) => label('ageRange', t)).filter((r) => r in AGE_RANGE_BOUNDS);
		out.ageRanges = ranges;
		const b = ageBoundsFromRanges(ranges);
		out.ageMin = b.ageMin;
		out.ageMax = b.ageMax;
	}
	if (c.gender) out.gender = c.gender;
	if (s.archetype) out.archetype = label('archetype', s.archetype);
	else if (s.archetypeText) out.archetype = s.archetypeText;
	if (s.contentFocus) out.contentFocus = label('contentFocus', s.contentFocus);
	else if (s.contentFocusText) out.contentFocus = s.contentFocusText;
	if (a.psychProfile) out.psychProfile = a.psychProfile;
	if (s.contentAngle) out.contentAngle = s.contentAngle;
	if (a.targetAvatar) out.targetAvatar = a.targetAvatar;

	const appearance: Record<string, string> = {};
	const setA = (key: string, v: string | undefined) => {
		if (v) appearance[key] = v;
	};
	setA('ethnicity', back('heritage', c.heritage, c.heritageText));
	if (c.age !== undefined && c.ageSource === 'bucket') {
		const bucket = (Object.keys(PERSONA_AGE_MIDPOINT) as TokenOf<'personaAge'>[]).find(
			(t) => PERSONA_AGE_MIDPOINT[t] === c.age
		);
		if (bucket) setA('personaAge', label('personaAge', bucket));
	}
	setA('skinTone', back('skinTone', l.skinTone, l.skinToneText));
	setA('bodyType', back('bodyType', l.bodyType, l.bodyTypeText));
	setA('hairLength', back('hairLength', l.hair?.length, l.hair?.lengthText));
	setA('hairstyle', back('hairstyle', l.hair?.style, l.hair?.styleText));
	setA('hairColor', back('hairColor', l.hair?.color, l.hair?.colorText));
	setA('eyeColor', back('eyeColor', l.eyes?.color, l.eyes?.colorText));
	setA('wardrobe', l.wardrobe);
	setA('outfitColors', l.outfitColors);
	setA('headwear', l.headwear);
	setA('distinctiveFeatures', l.distinctiveFeatures);
	setA('styling', l.styling);
	const strayAppearance = (v2._legacy?.appearance ?? {}) as Record<string, unknown>;
	for (const [key, v] of Object.entries(strayAppearance)) if (typeof v === 'string') appearance[key] = v;
	if (Object.keys(appearance).length) out.appearance = appearance;

	if (v2.voice && (v2.voice.gender || v2.voice.nationality || v2.voice.accent)) {
		out.voiceProfile = {};
		if (v2.voice.gender) out.voiceProfile.gender = v2.voice.gender;
		if (v2.voice.nationality) out.voiceProfile.nationality = v2.voice.nationality;
		if (v2.voice.accent) out.voiceProfile.accent = v2.voice.accent;
	}
	if (k.bios) out.bios = k.bios;
	if (k.handleCandidates) out.handleCandidates = k.handleCandidates;
	if (k.confirmedHandles) out.confirmedHandles = k.confirmedHandles;
	if (c.displayName) out.displayName = c.displayName;

	for (const [key, v] of Object.entries(v2._legacy ?? {})) {
		if (key !== 'appearance') out[key] = v;
	}
	return out;
}

/** True when the value is one of the group's tokens — re-exported for spec convenience. */
export const isTokenOf = isToken;
