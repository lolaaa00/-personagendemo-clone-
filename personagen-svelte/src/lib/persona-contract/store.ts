/**
 * Persona Model v2 — read / serialise / merge on the v2 contract.
 *
 * Lives beside the v1 store (`persona-profile-store.ts`) rather than replacing
 * it. The two are a dual-shape bridge:
 *   • v1 readers (`readPersonaProfile`) downgrade a v2 blob losslessly
 *   • v2 readers (`readPersonaProfileV2`, here) upgrade a v1 blob in memory
 * so consumers migrate one at a time and the stored shape flips only when the
 * save path (P0.5) starts writing v2. Nothing in this module performs I/O.
 *
 * THE MERGE RULE (same spirit as v1, now per sub-object and with provenance):
 *   • a key ABSENT from the patch preserves the stored value; so does an
 *     explicit null/undefined ("no opinion")
 *   • an explicit EMPTY value ('' / [] / {}) clears
 *   • merging is one level deep per sub-object, and one level deeper for the
 *     small nested records (hair, eyes, work, household, lifestyle, economic,
 *     location, decisioning, children, clothingSizes): a patch to `look.hair.color`
 *     cannot wipe `look.hair.style`
 *   • PROVENANCE: every leaf a patch writes is stamped in meta.fieldSources by
 *     origin — 'ui' → 'user', 'sampler' → 'sampled', 'backfill' → the source the
 *     patch declares ('extracted' | 'derived' | 'sampled'). Automation
 *     ('sampler' | 'backfill') may NOT overwrite a leaf whose current source is
 *     'user' or 'extracted': that leaf is skipped, the rest of the patch lands.
 *
 * `serializePersonaProfileV2` is the normalising gate: unknown top-level keys
 * stripped, token fields validated against the registry (an off-list value on
 * a field with a *Text companion moves there verbatim; elsewhere it is
 * dropped), numbers clamped, strings trimmed. Key presence is preserved so
 * serialise-then-merge stays safe.
 */
import { coerceBios, coerceConfirmedHandles, coerceHandleCandidates } from '../persona-identity';
import { readStoredProfileObject } from '../persona-profile-store';
import { PERSONA_SCHEMA_VERSION, PERSONA_V2_KEYS, isPersonaProfileV2, type FieldSource, type PersonaProfileV2 } from './schema';
import { TOKEN_GROUPS, isToken, type TokenGroup } from './tokens';
import { upgradeV1toV2, type UpgradeMode } from './upgrade';
import { isObj, isEmptyValue, getPath, setPath, deletePath, leafPaths, pruneEmptyObjects, stripEmptyLeaves, type Obj } from './paths';

export type MergeOrigin = 'ui' | 'sampler' | 'backfill';

export interface MergeOptions {
	origin?: MergeOrigin;
	/** For origin 'backfill': the provenance to stamp on written leaves. Default 'derived'. */
	source?: Extract<FieldSource, 'extracted' | 'derived' | 'sampled'>;
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** The stored profile as v2. A v1 blob is upgraded in memory; never persisted here. */
export function readPersonaProfileV2(
	agent: { personas_profile?: unknown; market?: unknown } | null | undefined
): PersonaProfileV2 {
	const raw = readStoredProfileObject(agent);
	return isPersonaProfileV2(raw) ? raw : upgradeV1toV2(raw);
}

// ── Token field map ──────────────────────────────────────────────────────────

/**
 * Leaf path → registry group. A trailing `[]` marks an array of tokens. Paths
 * use the same dotted form as meta.fieldSources. Fields with a verbatim
 * companion list it, so an off-list value is preserved instead of dropped.
 */
const TOKEN_FIELDS: Record<string, { group: TokenGroup; text?: string }> = {
	'creator.gender': { group: 'gender' },
	'creator.heritage': { group: 'heritage', text: 'creator.heritageText' },
	'creator.market': { group: 'market' },
	'creator.location.geographicContext': { group: 'geographicContext' },
	'creator.education': { group: 'education' },
	'creator.work.domain': { group: 'workDomain' },
	'creator.work.employmentStatus': { group: 'employmentStatus' },
	'creator.work.workLocationMode': { group: 'workLocationMode' },
	'creator.work.seniority': { group: 'seniority' },
	'creator.household.relationshipStatus': { group: 'relationshipStatus' },
	'creator.household.children.ageBands[]': { group: 'childAgeBand' },
	'creator.household.pets[]': { group: 'pet' },
	'creator.household.housingType': { group: 'housingType' },
	'creator.lifestyle.activityLevel': { group: 'activityLevel' },
	'creator.lifestyle.transportMode': { group: 'transportMode' },
	'creator.lifestyle.dietaryStyle': { group: 'dietaryStyle' },
	'creator.economic.incomeBand': { group: 'incomeBand' },
	'creator.economic.priceFrame': { group: 'priceFrame' },
	'creator.traitLabels[]': { group: 'traitLabel' },
	'creator.neverDiscusses[]': { group: 'neverDiscusses' },
	'look.skinTone': { group: 'skinTone', text: 'look.skinToneText' },
	'look.bodyType': { group: 'bodyType', text: 'look.bodyTypeText' },
	'look.faceShape': { group: 'faceShape' },
	'look.browShape': { group: 'browShape' },
	'look.hair.color': { group: 'hairColor', text: 'look.hair.colorText' },
	'look.hair.grayCoverage': { group: 'grayCoverage' },
	'look.hair.length': { group: 'hairLength', text: 'look.hair.lengthText' },
	'look.hair.texture': { group: 'hairTexture' },
	'look.hair.style': { group: 'hairstyle', text: 'look.hair.styleText' },
	'look.facialHair': { group: 'facialHair' },
	'look.eyes.color': { group: 'eyeColor', text: 'look.eyes.colorText' },
	'look.eyewear': { group: 'eyewear' },
	'voice.gender': { group: 'gender' },
	'audience.ageRanges[]': { group: 'ageRange' },
	'audience.genderMix': { group: 'genderMix' },
	'audience.lifeStage[]': { group: 'lifeStage' },
	'audience.incomeBand': { group: 'incomeBand' },
	'audience.decisioning.priceSensitivity': { group: 'priceSensitivity' },
	'audience.decisioning.purchaseChannel': { group: 'purchaseChannel' },
	'audience.decisioning.brandLoyalty': { group: 'brandLoyalty' },
	'audience.decisioning.promoResponsiveness': { group: 'promoResponsiveness' },
	'audience.decisioning.messageProcessingStyle': { group: 'messageProcessingStyle' },
	'audience.decisioning.communicationPreference': { group: 'communicationPreference' },
	'audience.decisioning.digitalCapability': { group: 'digitalCapability' },
	'strategy.niche': { group: 'niche' },
	'strategy.archetype': { group: 'archetype', text: 'strategy.archetypeText' },
	'strategy.contentFocus': { group: 'contentFocus', text: 'strategy.contentFocusText' },
	'meta.generator': { group: 'generator' }
};

/** Exported for the touchpoint map (P4.3) and for tests. */
export const PERSONA_V2_TOKEN_FIELDS: Readonly<Record<string, { group: TokenGroup; text?: string }>> = TOKEN_FIELDS;

// ── Serialise ────────────────────────────────────────────────────────────────

const clampInt = (v: unknown, lo: number, hi: number): number | undefined => {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
	if (!Number.isFinite(n)) return undefined;
	return Math.min(hi, Math.max(lo, Math.round(n)));
};

/**
 * Normalises a v2 profile (or a v1 patch, which is upgraded first) for
 * storage. Preserves key presence; empty values pass through untouched so
 * merge can treat them as "clear".
 */
export function serializePersonaProfileV2(profile: unknown, mode: UpgradeMode = 'stored'): PersonaProfileV2 {
	const patchMode = mode === 'patch';
	const v2 = isPersonaProfileV2(profile) ? profile : upgradeV1toV2(profile, mode);
	// Deep copy, then strip unknown top-level keys.
	const out = JSON.parse(JSON.stringify(v2)) as Obj;
	for (const k of Object.keys(out)) {
		if (!(PERSONA_V2_KEYS as readonly string[]).includes(k)) delete out[k];
	}
	const meta = isObj(out.meta) ? out.meta : {};
	meta.schemaVersion = PERSONA_SCHEMA_VERSION;
	out.meta = meta;

	// Trim every string leaf; leave '' in place (it is an explicit clear).
	for (const p of leafPaths(out)) {
		const v = getPath(out, p);
		if (typeof v === 'string') setPath(out, p, v.trim());
		else if (Array.isArray(v)) setPath(out, p, v.map((x) => (typeof x === 'string' ? x.trim() : x)));
	}

	// Token validation.
	for (const [spec, { group, text }] of Object.entries(TOKEN_FIELDS)) {
		const isArray = spec.endsWith('[]');
		const path = isArray ? spec.slice(0, -2) : spec;
		const v = getPath(out, path);
		if (v === undefined || v === null) continue;
		if (isArray) {
			if (!Array.isArray(v)) {
				deletePath(out, path);
				continue;
			}
			setPath(out, path, Array.from(new Set(v.filter((x) => isToken(group, x)))));
			continue;
		}
		if (v === '') {
			// Explicit clear of the token clears its verbatim companion too (patch mode).
			if (patchMode && text && getPath(out, text) === undefined) setPath(out, text, '');
			continue;
		}
		if (isToken(group, v)) {
			// A token and its companion are ONE logical field: in a patch, a valid
			// token with no companion clears any stale verbatim text on merge.
			if (patchMode && text && getPath(out, text) === undefined) setPath(out, text, '');
			continue;
		}
		// Off-list: keep verbatim in the companion when there is one, else drop.
		// In a patch, also clear the token so the pair cannot disagree after merge.
		if (text && typeof v === 'string' && v.trim()) {
			if (getPath(out, text) === undefined) setPath(out, text, v.trim());
			if (patchMode) setPath(out, path, '');
			else deletePath(out, path);
			continue;
		}
		deletePath(out, path);
	}

	// Numbers.
	const creator = isObj(out.creator) ? out.creator : undefined;
	if (creator) {
		if (creator.age !== undefined && creator.age !== null) {
			const age = clampInt(creator.age, 13, 99);
			if (age === undefined) delete creator.age;
			else creator.age = age;
		}
		if (isObj(creator.bigFive)) {
			for (const trait of TOKEN_GROUPS.bigFiveTrait) {
				const n = clampInt(creator.bigFive[trait], 0, 100);
				if (n === undefined) delete creator.bigFive[trait];
				else creator.bigFive[trait] = n;
			}
		}
		if (isObj(creator.household) && isObj(creator.household.children)) {
			const c = creator.household.children;
			const count = clampInt(c.count, 0, 12);
			if (count === undefined) delete c.count;
			else c.count = count;
		}
	}
	const look = isObj(out.look) ? out.look : undefined;
	if (look && look.heightCm !== undefined && look.heightCm !== null) {
		const h = clampInt(look.heightCm, 120, 230);
		if (h === undefined) delete look.heightCm;
		else look.heightCm = h;
	}

	// Identity kit through the same coercers the v1 store uses.
	const kit = isObj(out.identityKit) ? out.identityKit : undefined;
	if (kit) {
		if (kit.bios !== undefined && !isEmptyValue(kit.bios)) kit.bios = coerceBios(kit.bios);
		if (kit.handleCandidates !== undefined && !isEmptyValue(kit.handleCandidates))
			kit.handleCandidates = coerceHandleCandidates(kit.handleCandidates);
		if (kit.confirmedHandles !== undefined && !isEmptyValue(kit.confirmedHandles))
			kit.confirmedHandles = coerceConfirmedHandles(kit.confirmedHandles);
	}

	if (!patchMode) {
		stripEmptyLeaves(out, PERSONA_V2_KEYS.filter((k) => k !== 'meta' && k !== '_legacy'), isObj(out.meta) && isObj(out.meta.fieldSources) ? (out.meta.fieldSources as Record<string, unknown>) : undefined);
	}

	// A sub-object emptied by validation (every leaf dropped) is removed, EXCEPT
	// one the caller passed as an explicit `{}` — that is a deliberate clear and
	// merge must still see it. Compare against the input, not the output.
	const inputV2 = v2 as unknown as Obj;
	for (const section of PERSONA_V2_KEYS) {
		if (section === 'meta') continue;
		const produced = out[section];
		if (isObj(produced) && Object.keys(produced).length === 0) {
			const given = inputV2[section];
			if (!(isObj(given) && Object.keys(given).length === 0)) delete out[section];
		}
	}

	return out as unknown as PersonaProfileV2;
}

// ── Merge ────────────────────────────────────────────────────────────────────

const PROTECTED: ReadonlySet<FieldSource> = new Set<FieldSource>(['user', 'extracted']);

/**
 * Merges a v2 patch into a stored v2 profile under THE MERGE RULE above.
 * Pure: returns a new object; neither argument is mutated.
 */
export function mergePersonaProfileV2(
	existing: PersonaProfileV2 | null | undefined,
	patch: PersonaProfileV2 | null | undefined,
	options: MergeOptions = {}
): PersonaProfileV2 {
	const origin: MergeOrigin = options.origin ?? 'ui';
	const stamp: FieldSource = origin === 'ui' ? 'user' : origin === 'sampler' ? 'sampled' : (options.source ?? 'derived');
	const automated = origin !== 'ui';

	const out = JSON.parse(JSON.stringify(existing ?? { meta: { schemaVersion: PERSONA_SCHEMA_VERSION } })) as Obj;
	const meta = isObj(out.meta) ? out.meta : {};
	meta.schemaVersion = PERSONA_SCHEMA_VERSION;
	out.meta = meta;
	const sources = isObj(meta.fieldSources) ? (meta.fieldSources as Record<string, FieldSource>) : {};
	meta.fieldSources = sources;

	if (!isObj(patch)) {
		if (!Object.keys(sources).length) delete meta.fieldSources;
		return out as unknown as PersonaProfileV2;
	}

	for (const section of PERSONA_V2_KEYS) {
		const incoming = (patch as unknown as Obj)[section];
		if (incoming === undefined || incoming === null) continue;
		if (section === 'meta') {
			// Only these meta fields are patchable; provenance and version are managed here.
			const m = isObj(incoming) ? incoming : {};
			for (const k of ['seed', 'registryVersion', 'generator', 'generatorModel', 'generatedAt', 'backfill'] as const) {
				if (m[k] !== undefined && m[k] !== null) meta[k] = m[k];
			}
			continue;
		}
		if (section === '_legacy') {
			if (isObj(incoming)) out._legacy = { ...(isObj(out._legacy) ? out._legacy : {}), ...incoming };
			continue;
		}
		if (isEmptyValue(incoming)) {
			// Explicit clear of a whole section — only a human may do that.
			if (!automated) {
				delete out[section];
				for (const p of Object.keys(sources)) if (p.startsWith(`${section}.`)) delete sources[p];
			}
			continue;
		}
		if (!isObj(incoming)) continue;

		for (const leaf of leafPaths(incoming, section)) {
			const value = getPath(patch as unknown as Obj, leaf);
			if (value === undefined || value === null) continue; // no opinion
			if (automated && PROTECTED.has(sources[leaf])) continue; // never overwrite a person's value
			if (isEmptyValue(value)) {
				deletePath(out, leaf);
				delete sources[leaf];
				continue;
			}
			// An UNCHANGED value keeps its provenance. The persona page re-sends its
			// whole form on every save; without this, one click would re-stamp every
			// sampled/derived leaf as 'user' and lock automation out of it forever.
			const current = getPath(out, leaf);
			if (current !== undefined && JSON.stringify(current) === JSON.stringify(value)) {
				if (!sources[leaf]) sources[leaf] = stamp;
				continue;
			}
			setPath(out, leaf, JSON.parse(JSON.stringify(value)));
			sources[leaf] = stamp;
		}
	}

	pruneEmptyObjects(out);
	if (!Object.keys(sources).length) delete meta.fieldSources;
	out.meta = meta;
	return out as unknown as PersonaProfileV2;
}
