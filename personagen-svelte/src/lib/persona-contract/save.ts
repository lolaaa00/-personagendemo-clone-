/**
 * Persona Model v2 — the one function every save path calls.
 *
 * Takes whatever a client sent (the persona page's v1 form object, the legacy
 * stringified transport, or a v2 record), runs the v1 normalising gate when the
 * input is v1-shaped (so avatar-name stripping, age-bucket coercion and handle
 * sanitising keep applying exactly as before), upgrades, serialises on the v2
 * contract, merges over what is stored with provenance, and stamps meta.
 *
 * From the first save through this function a persona's stored blob is v2.
 * Every reader is already dual-shape (P0.3), so nothing else changes.
 *
 * Client-safe; no I/O.
 */
import {
	readStoredProfileObject,
	serializePersonaProfile,
	type PersonaProfile
} from '../persona-profile-store';
import { isPersonaProfileV2, type PersonaProfileV2 } from './schema';
import { mergePersonaProfileV2, serializePersonaProfileV2, type MergeOptions } from './store';

/**
 * Normalises a client-supplied profile to a v2 patch. A string is the legacy
 * transport (already JSON); an object is taken as-is. v1 shapes pass through
 * the v1 gate first so its behaviour is preserved to the byte.
 */
export function incomingProfileToV2Patch(personaProfile: unknown): PersonaProfileV2 {
	const raw = readStoredProfileObject(
		typeof personaProfile === 'string' ? { market: personaProfile } : { personas_profile: personaProfile }
	);
	const normalised = isPersonaProfileV2(raw) ? raw : serializePersonaProfile(raw as PersonaProfile);
	// 'patch' mode: explicit empties survive as clears and token/text pairs carry
	// '' on the side being replaced, so the merge does what the user meant.
	return serializePersonaProfileV2(normalised, 'patch');
}

export interface SaveOptions extends MergeOptions {
	/** ISO timestamp; injectable for tests. */
	now?: string;
}

/**
 * The record to store after a save: existing (any shape) ⊕ incoming (any shape)
 * → v2 with provenance and a fresh meta.generatedAt. Pure.
 */
export function buildStoredProfile(
	existingAgent: { personas_profile?: unknown; market?: unknown } | null | undefined,
	personaProfile: unknown,
	options: SaveOptions = {}
): PersonaProfileV2 {
	const existingRaw = readStoredProfileObject(existingAgent);
	const existing = isPersonaProfileV2(existingRaw) ? existingRaw : serializePersonaProfileV2(existingRaw);
	const patch = incomingProfileToV2Patch(personaProfile);
	const merged = mergePersonaProfileV2(existing, patch, options);
	merged.meta.generatedAt = options.now ?? new Date().toISOString();
	if (!merged.meta.generator) merged.meta.generator = 'manual';
	return merged;
}
