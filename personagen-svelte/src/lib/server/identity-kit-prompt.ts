/**
 * IDENTITY-KIT PROMPT — the one place the public-facing kit prompt is built.
 *
 * Extracted from the engine's `generate_identity_kit` action so the string is a
 * pure function of its inputs and can be pinned byte-for-byte by a spec. The
 * engine still owns everything around it (auth, platform scoping, taken-handle
 * collection, parsing); this file only turns those inputs into text.
 *
 * Persona Model v2, P4.2: the prompt gains three backbone facts — the city the
 * creator lives in, what they do for work, and who they live with — so a bio
 * reads like a person rather than a niche.
 *
 * **The backbone half is gated on `personaBackboneEmits()` (PERSONA_BACKBONE
 * === 'on').** Below `on` this builder must emit the byte-identical prompt it
 * emitted before the backbone existed; `identity-kit-prompt.spec.ts` proves that
 * against a verbatim copy of the pre-change template. Storing a fact and
 * speaking it are separate decisions — the same promise `generate.ts` makes for
 * scripts and portraits.
 *
 * Rules (same as `personaBackboneLines` in content/generate.ts):
 *  1. Set leaves only — a fact that is not stored is not mentioned, ever. No
 *     placeholders, no "unknown", no empty labels.
 *  2. Tokens go through `label()`; a raw storage token never reaches a model.
 *  3. Deterministic — same profile in, same bytes out.
 *  4. Never throws. A v1, empty, or malformed profile yields no facts, and the
 *     kit generates exactly as it does today.
 */

import { personaBackboneEmits } from '$lib/server/flags';
import { readPersonaProfileV2 } from '$lib/persona-contract/store';
import { label } from '$lib/persona-contract/labels';

const isObj = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The three backbone facts the identity kit is allowed to know: where the
 * creator lives, what they do, and who they live with. Empty below `on`, and
 * empty whenever the profile carries none of them.
 *
 * Returns prompt LINES with a leading '' so the caller can splice the block in
 * with a blank line above it — the shape `personaBackboneLines` uses.
 */
export function identityKitBackboneLines(agent: unknown): string[] {
	if (!personaBackboneEmits()) return [];

	let creator: Record<string, unknown>;
	try {
		const profile = readPersonaProfileV2(agent as never) as unknown;
		const c = isObj(profile) ? profile.creator : undefined;
		if (!isObj(c)) return [];
		creator = c;
	} catch {
		// A profile shape nobody anticipated must not take a generation down.
		return [];
	}

	/** Trimmed non-empty string, else undefined. */
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.trim() ? v.trim() : undefined;
	/** A token rendered through the registry; unset and unknown-blank both drop. */
	const lbl = (group: Parameters<typeof label>[0], v: unknown): string | undefined => {
		const token = str(v);
		return token ? str(label(group, token)) : undefined;
	};
	/** An array of tokens rendered in stored order, de-duplicated. */
	const lblList = (group: Parameters<typeof label>[0], v: unknown): string[] =>
		Array.isArray(v)
			? Array.from(new Set(v.map((x) => lbl(group, x)).filter((x): x is string => !!x)))
			: [];
	/** 'A · B · C' from the parts that exist, or undefined when none do. */
	const join = (...parts: (string | undefined)[]): string | undefined => {
		const kept = parts.filter((p): p is string => !!p);
		return kept.length ? kept.join(' · ') : undefined;
	};

	const facts: { key: string; value: string | undefined }[] = [];

	// 1. Lives in — the city only. A bio says "Brisbane", never a region code.
	const location = isObj(creator.location) ? creator.location : {};
	facts.push({ key: 'Lives in', value: str(location.city) });

	// 2. Does — the job title as stored, the thing a bio line can name.
	const work = isObj(creator.work) ? creator.work : {};
	facts.push({ key: 'Does', value: str(work.title) });

	// 3. Household — partner, children (count + bands), housing, pets.
	const household = isObj(creator.household) ? creator.household : {};
	const children = isObj(household.children) ? household.children : {};
	const count = children.count;
	const bands = lblList('childAgeBand', children.ageBands);
	const childPhrase =
		typeof count === 'number' && Number.isFinite(count) && count > 0
			? `${Math.round(count)} ${Math.round(count) === 1 ? 'child' : 'children'}${bands.length ? ` (${bands.join(', ')})` : ''}`
			: bands.length
				? `children (${bands.join(', ')})`
				: undefined;
	const pets = lblList('pet', household.pets);
	facts.push({
		key: 'Household',
		value: join(
			lbl('relationshipStatus', household.relationshipStatus),
			childPhrase,
			lbl('housingType', household.housingType),
			pets.length ? `Pets: ${pets.join(', ')}` : undefined
		)
	});

	const set = facts.filter((f) => f.value);
	if (!set.length) return [];

	return [
		'',
		"REAL LIFE — true facts about this creator. Let the bios sound like this person's actual life; never list these out, and never state one that is not here:",
		...set.map((f) => `- ${f.key}: ${f.value}.`)
	];
}

export interface IdentityKitPromptInput {
	/** The agent row — name, niche, soul, and the stored persona profile. */
	agent: {
		name?: unknown;
		niche?: unknown;
		soul?: unknown;
		personas_profile?: unknown;
		market?: unknown;
	} & Record<string, unknown>;
	/** The v1 persona profile view (archetype, focus, angle, avatar). */
	profile: Record<string, unknown>;
	/** The brand brief `data` object, or `{}` when the persona has no brief. */
	brief: Record<string, unknown>;
	/** Numbered "Return:" asks, already assembled by the caller. */
	wants: string[];
	/** JSON contract fragments, already assembled by the caller. */
	contract: string[];
}

/**
 * Builds the identity-kit prompt. Additive only: nothing that was in the prompt
 * before has been reworded or reordered, and the backbone block is spliced in
 * between the BRAND line and the "Return:" asks — where a fact is context, not
 * an instruction.
 */
export function buildIdentityKitPrompt(input: IdentityKitPromptInput): string {
	const { agent, profile, brief: b, wants, contract } = input;
	const backbone = identityKitBackboneLines(agent);

	return `You are an elite social-media brand strategist. Create the public-facing identity kit for one UGC creator.

CREATOR: ${agent.name || 'this creator'}. Niche: ${agent.niche || profile.niche || '—'}. Archetype: ${profile.archetype || '—'}. Content focus: ${profile.contentFocus || '—'}. Unique angle: ${profile.contentAngle || '—'}. Audience: ${profile.targetAvatar || '—'}. Personality/soul: ${String(agent.soul || '').slice(0, 500)}.
BRAND they create for: ${b.brandName || b.name || '—'}${b.tagline ? ` — ${b.tagline}` : ''}. Mission: ${b.mission || '—'}. Products: ${
		Array.isArray(b.products)
			? b.products
					.map((p: { name?: unknown }) => p?.name)
					.filter(Boolean)
					.join(', ')
			: '—'
	}.${backbone.map((line) => `\n${line}`).join('')}

Return:
${wants.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Return ONLY JSON: {${contract.join(',')}}`;
}
