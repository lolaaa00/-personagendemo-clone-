/**
 * Persona Model v2 — the touchpoint contract (P4.3).
 *
 * ONE QUESTION, ANSWERABLE: for any field on a persona, which parts of the
 * product actually see it?
 *
 * Without this the answer lives in six builders across three files, and the two
 * failure modes are silent in opposite directions. A field can be stored,
 * displayed and believed in while reaching no prompt at all — the customer edits
 * it and nothing about their content changes. Or a field can quietly reach a
 * prompt nobody intended it to, which is how a brand-safety problem happens.
 *
 * So the map below is a CONTRACT, written by hand on purpose: deciding which
 * consumer may see a field is a judgement, not something to derive. What IS
 * derived is the checking. `touchpoints.spec.ts` sweeps real personas for the
 * leaves that actually occur and fails if any of them is missing here, and it
 * greps the builder sources to fail if this map claims a field reaches a
 * consumer that never mentions it.
 *
 * KNOWN LIMIT, stated rather than hidden: the completeness sweep can only see
 * leaves that something writes. A field declared in `schema.ts` that nothing
 * populates is invisible to it — which is tolerable, because a field nothing
 * writes reaches no consumer either, and the sweep catches it the moment
 * anything does write it.
 *
 * Client-safe: data and pure lookups only.
 */

/** Everything that can read a persona field. */
export const TOUCHPOINTS = [
	'script',
	'portrait',
	'portrait_edit',
	'voice',
	'identity_kit',
	'fit_judge',
	'uniqueness',
	'display'
] as const;

export type Touchpoint = (typeof TOUCHPOINTS)[number];

/**
 * Fields that must NOT EXIST on a persona at all.
 *
 * Not "do not emit these" — do not have them. A persona record with a religion
 * field is a liability whether or not a prompt reads it: it will be stored,
 * backed up, exported, and eventually used. The spec asserts none of these ever
 * appears as a leaf, so the contract is enforced against the schema rather than
 * against the discipline of whoever adds the next field.
 */
export const NEVER_EMIT_FIELDS = [
	'politics',
	'politicalView',
	'politicalLeaning',
	'religion',
	'religiousView',
	'faith',
	'sexualOrientation',
	'healthCondition',
	'medicalCondition',
	'diagnosis',
	'disability',
	'race',
	'immigrationStatus',
	'criminalRecord',
	'unionMembership'
] as const;

/**
 * Leaf path → the consumers allowed to read it.
 *
 * A trailing `.*` matches any single dynamic segment, for the maps keyed by
 * platform. An empty array is a deliberate statement: this field is STORED and
 * read by nothing — it exists for a future consumer or for the record's own
 * integrity, and saying so here is more honest than leaving it out.
 */
export const PERSONA_TOUCHPOINTS: Record<string, readonly Touchpoint[] | 'never_emit'> = {
	// ── who they are ────────────────────────────────────────────────────────
	'creator.firstName': ['identity_kit', 'display'],
	'creator.lastName': ['identity_kit', 'display'],
	// NOT script: the script prompt uses the agent's own `name` column, not this.
	'creator.displayName': ['identity_kit', 'uniqueness', 'display'],
	'creator.gender': ['script', 'portrait', 'portrait_edit', 'voice', 'display'],
	'creator.age': ['script', 'portrait', 'portrait_edit', 'voice', 'display'],
	// Says whether the age is a real fact or a bucket midpoint. It never reaches a
	// prompt itself; it decides whether the AGE may be stated as one.
	'creator.ageSource': ['display'],
	// NOT script. Repeating heritage into a SCRIPT prompt buys nothing and invites
	// the model to write an accent; the portrait pair is where it belongs.
	'creator.heritage': ['portrait', 'portrait_edit', 'uniqueness', 'display'],
	'creator.heritageText': ['portrait', 'portrait_edit', 'display'],
	'creator.market': ['script', 'identity_kit', 'display'],
	// NOT script. The backbone's own header explains why it does not send them,
	// and that comment was what fooled the honesty check into believing it did.
	'creator.languages': ['display'],
	'creator.education': ['display'],
	// Typed, validated, labelled and RENDERED by the persona page — but nothing in
	// the repo writes it. Listed with its real consumer rather than left out, so
	// the day something does populate it, the contract already says who may read
	// it. It reaches no prompt: a brand-safety denylist belongs in the guardrail
	// block of a prompt, not among a persona's life facts.
	'creator.neverDiscusses': ['display'],
	'creator.traitLabels': ['script', 'display'],
	// The RAW SCORES reach no prompt, deliberately: a model given
	// "neuroticism: 71" writes a psychology report. `creator.traitLabels` is what
	// the script sees. If a future change starts emitting the numbers, the
	// honesty check in the spec fails until this map is updated to admit it.
	'creator.bigFive.openness': ['display'],
	'creator.bigFive.conscientiousness': ['display'],
	'creator.bigFive.extraversion': ['display'],
	'creator.bigFive.agreeableness': ['display'],
	'creator.bigFive.neuroticism': ['display'],

	// ── where they live ─────────────────────────────────────────────────────
	'creator.location.city': ['script', 'identity_kit', 'display'],
	'creator.location.region': ['script', 'identity_kit', 'display'],
	'creator.location.geographicContext': ['script', 'display'],
	'creator.location.timezone': ['display'],

	// ── what they do ────────────────────────────────────────────────────────
	'creator.work.title': ['script', 'identity_kit', 'uniqueness', 'display'],
	'creator.work.domain': ['script', 'uniqueness', 'display'],
	'creator.work.seniority': ['script', 'display'],
	'creator.work.employmentStatus': ['script', 'display'],
	'creator.work.workLocationMode': ['script', 'display'],

	// ── who they live with ──────────────────────────────────────────────────
	'creator.household.relationshipStatus': ['script', 'identity_kit', 'display'],
	'creator.household.children.count': ['script', 'identity_kit', 'display'],
	'creator.household.children.ageBands': ['script', 'display'],
	'creator.household.housingType': ['script', 'display'],
	'creator.household.pets': ['script', 'display'],

	// ── how they live ───────────────────────────────────────────────────────
	'creator.lifestyle.activityLevel': ['script', 'display'],
	'creator.lifestyle.transportMode': ['script', 'display'],
	'creator.lifestyle.dietaryStyle': ['script', 'display'],
	'creator.economic.incomeBand': ['script', 'display'],
	// The creator's own price frame reaches no prompt. Every price line in a
	// script prompt is about the AUDIENCE's frame; emitting the creator's beside
	// it would read as a contradiction.
	'creator.economic.priceFrame': ['display'],

	// ── how they look ───────────────────────────────────────────────────────
	// The portrait pair, and nothing else: a script does not describe a face.
	'look.skinTone': ['portrait', 'portrait_edit', 'display'],
	'look.skinToneText': ['portrait', 'portrait_edit', 'display'],
	'look.bodyType': ['portrait', 'portrait_edit', 'display'],
	'look.bodyTypeText': ['portrait', 'portrait_edit', 'display'],
	'look.heightCm': ['portrait', 'portrait_edit', 'display'],
	'look.faceShape': ['portrait', 'portrait_edit', 'display'],
	'look.browShape': ['portrait', 'portrait_edit', 'display'],
	'look.facialHair': ['portrait', 'portrait_edit', 'display'],
	'look.eyewear': ['portrait', 'portrait_edit', 'display'],
	'look.headwear': ['portrait', 'portrait_edit', 'display'],
	'look.distinctiveFeatures': ['portrait', 'portrait_edit', 'display'],
	'look.hair.color': ['portrait', 'portrait_edit', 'display'],
	'look.hair.colorText': ['portrait', 'portrait_edit', 'display'],
	'look.hair.length': ['portrait', 'portrait_edit', 'display'],
	'look.hair.lengthText': ['portrait', 'portrait_edit', 'display'],
	'look.hair.style': ['portrait', 'portrait_edit', 'display'],
	'look.hair.styleText': ['portrait', 'portrait_edit', 'display'],
	'look.hair.texture': ['portrait', 'portrait_edit', 'display'],
	'look.hair.grayCoverage': ['portrait', 'portrait_edit', 'display'],
	'look.eyes.color': ['portrait', 'portrait_edit', 'display'],
	'look.eyes.colorText': ['portrait', 'portrait_edit', 'display'],
	'look.wardrobe': ['portrait', 'portrait_edit', 'display'],
	'look.outfitColors': ['portrait', 'portrait_edit', 'display'],
	'look.styling': ['portrait', 'portrait_edit', 'display'],
	'look.clothingSizes': ['display'],
	// A CACHE of the clause the portrait builders compute live. Listed so nobody
	// mistakes it for a source; the builders deliberately ignore it.
	'look.promptCues': [],

	// ── voice ───────────────────────────────────────────────────────────────
	'voice.gender': ['voice', 'display'],
	'voice.nationality': ['voice', 'display'],
	'voice.accent': ['voice', 'display'],
	'voice.pinnedVoice': ['voice', 'display'],
	'voice.voiceMatch': ['display'],

	// ── who they talk to ────────────────────────────────────────────────────
	'audience.ageRanges': ['script', 'fit_judge', 'display'],
	'audience.genderMix': ['script', 'fit_judge', 'display'],
	'audience.lifeStage': ['script', 'fit_judge', 'display'],
	'audience.incomeBand': ['script', 'fit_judge', 'display'],
	'audience.platforms': ['display'],
	'audience.targetAvatar': ['script', 'display'],
	'audience.psychProfile': ['script', 'display'],
	'audience.panel': ['fit_judge', 'display'],
	'audience.decisioning.priceSensitivity': ['fit_judge', 'display'],
	'audience.decisioning.purchaseChannel': ['fit_judge', 'display'],
	'audience.decisioning.brandLoyalty': ['fit_judge', 'display'],
	'audience.decisioning.promoResponsiveness': ['fit_judge', 'display'],
	'audience.decisioning.messageProcessingStyle': ['fit_judge', 'display'],
	'audience.decisioning.communicationPreference': ['fit_judge', 'display'],
	'audience.decisioning.digitalCapability': ['fit_judge', 'display'],

	// ── how they position ───────────────────────────────────────────────────
	'strategy.niche': ['script', 'identity_kit', 'uniqueness', 'display'],
	'strategy.archetype': ['script', 'identity_kit', 'display'],
	'strategy.archetypeText': ['script', 'identity_kit', 'display'],
	'strategy.contentFocus': ['script', 'identity_kit', 'display'],
	'strategy.contentFocusText': ['script', 'identity_kit', 'display'],
	'strategy.contentAngle': ['script', 'uniqueness', 'display'],

	// ── derived and stored ──────────────────────────────────────────────────
	'description.short': ['fit_judge', 'display'],
	'description.frame': ['display'],
	'identityKit.bios.*': ['display'],
	'identityKit.confirmedHandles.*': ['display'],
	'identityKit.handleCandidates': ['display'],

	// ── carried, never read ─────────────────────────────────────────────────
	// v1 keys the upgrade did not recognise. Kept so nothing is lost on the way
	// through; deliberately read by nothing, because their meaning is unknown.
	'_legacy.*': []
};

/** Bookkeeping, not persona facts. Excluded from the contract entirely. */
export const CONTRACT_EXEMPT_PREFIXES = ['meta.'] as const;

/** True for a path the contract does not govern. */
export function isContractExempt(path: string): boolean {
	return CONTRACT_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Collapses a dynamic segment to the wildcard the map is keyed by, so
 * `identityKit.bios.instagram` and `identityKit.bios.tiktok` are one entry
 * rather than one per platform anyone ever adds.
 */
export function contractKeyFor(path: string): string {
	for (const prefix of ['identityKit.bios.', 'identityKit.confirmedHandles.']) {
		if (path.startsWith(prefix)) return `${prefix}*`;
	}
	if (path.startsWith('_legacy.')) return '_legacy.*';
	// Array leaves address an element; the contract is about the field.
	return path.replace(/\[\d+\]/g, '').replace(/\.\d+(?=\.|$)/g, '');
}

/**
 * Which consumers may read this field. `undefined` means the field is not in
 * the contract at all — the spec treats that as a failure, so a caller seeing
 * it has found a gap rather than a permission.
 */
export function touchpointsFor(path: string): readonly Touchpoint[] | 'never_emit' | undefined {
	return PERSONA_TOUCHPOINTS[contractKeyFor(path)];
}

/** Every field a given consumer is allowed to read, sorted. */
export function fieldsFor(touchpoint: Touchpoint): string[] {
	return Object.entries(PERSONA_TOUCHPOINTS)
		.filter(([, v]) => Array.isArray(v) && v.includes(touchpoint))
		.map(([k]) => k)
		.sort();
}
