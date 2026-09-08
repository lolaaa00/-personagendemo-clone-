/**
 * Persona Model v2 — skeleton-first persona generation.
 *
 * THE FLIP. The v1 path asks a language model to invent every field of a persona
 * and then coerces whatever comes back onto the allowed option lists. That is why
 * personas drift (a Vietnamese name with a non-Asian face), why a roster
 * converges on one look, and why a persona cannot be created at all without a
 * provider key.
 *
 * Here the order is inverted:
 *   1. SAMPLE the facts deterministically from the Trait Registry, in dependency
 *      order, seeded by the agent id. Name, heritage, age, place, work, household,
 *      Big Five, look — all coherent by construction.
 *   2. Ask the model for PROSE ONLY, conditioned on those facts.
 *   3. Discard, in code, anything in the answer that is not prose. `applyProseOnly`
 *      is the enforcement; the prompt merely explains.
 *
 * Step 3 is the important one. A prompt instruction not to change the facts is a
 * request; a filter is a guarantee. Everything downstream (portrait, voice,
 * scripts) depends on the facts being the ones we sampled.
 *
 * The returned shape is the SAME v1 object the persona page already consumes,
 * produced by downgrading the v2 record. That is what lets this run behind a flag
 * without touching the client at all.
 */
import { NICHE_OPTIONS, PERSONA_ARCHETYPES, CONTENT_FOCUS_OPTIONS, coerceToOption } from '$lib/persona-profile';
import { label, tokenForLabel } from '$lib/persona-contract/labels';
import { samplePersonaSkeleton, type SkeletonConstraints } from '$lib/persona-contract/sampler';
import { downgradeV2toV1 } from '$lib/persona-contract/upgrade';
import type { TokenOf } from '$lib/persona-contract/tokens';
import { deriveAgeRanges } from '$lib/persona-age';
import { isToken } from '$lib/persona-contract/tokens';
import type { PersonaAudience, PersonaProfileV2 } from '$lib/persona-contract/schema';
import { briefToConstraints, type BriefConstraints } from './brief-constraints';

/** The only fields the model is allowed to contribute. Everything else is sampled. */
export const PROSE_FIELDS = [
	'soul',
	'archetype',
	'contentFocus',
	'contentAngle',
	'targetAvatar',
	'psychProfile',
	'wardrobe',
	'outfitColors',
	'styling',
	'distinctiveFeatures'
] as const;

export interface ProseAnswer {
	soul?: string;
	archetype?: string;
	contentFocus?: string;
	contentAngle?: string;
	targetAvatar?: string;
	psychProfile?: string;
	wardrobe?: string;
	outfitColors?: string;
	styling?: string;
	distinctiveFeatures?: string;
}

const text = (v: unknown): string | undefined => {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return t || undefined;
};

/**
 * Everything the model is told, and the only thing it is asked for.
 *
 * The facts are handed over as a compact readable summary rather than raw
 * tokens, because a model writes better prose about "a 34-year-old
 * physiotherapist in Brisbane" than about `work.domain: health_care`.
 */
export function proseOnlyPrompt(
	skeleton: PersonaProfileV2,
	brief: Record<string, unknown> | null | undefined,
	takenAngles: string[] = [],
	direction?: string
): string {
	const c = skeleton.creator ?? {};
	const b = brief ?? {};
	const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
	const place = [c.location?.city, c.location?.region].filter(Boolean).join(', ');
	const kids = c.household?.children?.count
		? `${c.household.children.count} child${c.household.children.count > 1 ? 'ren' : ''} (${(c.household.children.ageBands ?? []).map((t) => label('childAgeBand', t)).join(', ')})`
		: 'no children';
	const traits = (c.traitLabels ?? []).map((t) => label('traitLabel', t)).join(', ');
	const brand = String(b.brandName ?? b.name ?? 'the brand');

	return `You are an elite influencer strategist. Write the VOICE of a UGC creator whose life facts are already fixed.

THESE FACTS ARE FIXED. Do not restate them as a list, do not contradict them, and do not return them:
- Name: ${name}
- Age: ${c.age ?? 'unknown'}, ${c.gender ? label('gender', c.gender) : 'unspecified'}
- Heritage: ${c.heritageText ?? (c.heritage ? label('heritage', c.heritage) : 'unspecified')}
- Lives in: ${place || 'unspecified'}
- Day job: ${c.work?.title ?? 'unspecified'}${c.work?.seniority ? ` (${label('seniority', c.work.seniority)})` : ''}
- Household: ${c.household?.relationshipStatus ? label('relationshipStatus', c.household.relationshipStatus) : 'unspecified'}, ${kids}
- Personality: ${traits || 'balanced'}
- Niche: ${skeleton.strategy?.niche ? label('niche', skeleton.strategy.niche) : 'unspecified'}

BRAND: ${brand}${b.tagline ? ` — ${b.tagline}` : ''}. Mission: ${b.mission ?? '—'}.
AUDIENCE: ${b.demographics ?? '—'}. Pain points: ${b.painPoints ?? '—'}.
${direction ? `\nCREATIVE DIRECTION (agreed with the user — honour it): ${direction}\n` : ''}${
		takenAngles.length ? `\nAngles already used by other creators — do NOT overlap: ${JSON.stringify(takenAngles).slice(0, 1200)}\n` : ''
	}
Write ONLY these fields, as a person who genuinely has the life above:
- "soul": 2-3 sentences of personality, tone and values, in third person. Let the day job and household show without listing them.
- "archetype": EXACTLY one of: ${PERSONA_ARCHETYPES.join(' | ')}
- "contentFocus": EXACTLY one of: ${CONTENT_FOCUS_OPTIONS.join(' | ')}
- "contentAngle": the ownable first-person point of view that differentiates THIS creator.
- "targetAvatar": one vivid sentence describing the ideal viewer by traits and situation — NEVER give them a name.
- "psychProfile": 2-3 sentences on that viewer's motivations, fears and desires.
- "wardrobe", "outfitColors", "styling": how this specific person actually dresses.
- "distinctiveFeatures": one or two memorable, non-generic facial details.

The ONLY proper name anywhere in your answer is ${name || 'the creator'}. Never invent another.
Return ONLY JSON with exactly those keys.`;
}

/**
 * Merges a model answer into the skeleton, keeping ONLY prose.
 *
 * Any sampled fact the model echoed or altered — age, heritage, name, place,
 * work, household, hair, skin — is discarded here rather than trusted. This
 * function is the contract; the prompt is only an explanation of it.
 *
 * `archetype` and `contentFocus` are the two prose fields that must land on an
 * option list, so they are snapped through the same coercion the v1 path uses
 * and stored as tokens; anything off-list is kept as verbatim text rather than
 * dropped, matching the "stored values are sacred" rule.
 */
export function applyProseOnly(skeleton: PersonaProfileV2, answer: unknown): PersonaProfileV2 {
	const a = (answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {}) as ProseAnswer;
	const out: PersonaProfileV2 = JSON.parse(JSON.stringify(skeleton));
	const sources = (out.meta.fieldSources ??= {});
	/**
	 * A model wrote this, so the honest source is 'derived' — NOT 'user'.
	 *
	 * The distinction is load-bearing, not cosmetic. The store's rule is that
	 * automation may never overwrite a 'user' or 'extracted' leaf, so marking a
	 * model's guess 'user' would freeze it against the customer's own later
	 * re-generate and against backfill, while telling the UI a human chose it.
	 * 'user' is reserved for words a person actually typed.
	 */
	const mark = (path: string) => {
		sources[path] = 'derived';
	};

	const strategy = (out.strategy ??= {});
	const archetypeText = text(a.archetype);
	if (archetypeText) {
		const canonical = coerceToOption(archetypeText, PERSONA_ARCHETYPES);
		const token = canonical ? tokenForLabel('archetype', canonical) : null;
		if (token) {
			strategy.archetype = token;
			delete strategy.archetypeText;
			mark('strategy.archetype');
		} else {
			strategy.archetypeText = archetypeText;
			// The sampled token is SUPERSEDED, not joined. Leaving it beside off-list
			// text would give the persona two positions at once and let a downgrade
			// pick either one; since the skeleton always samples a archetype, this
			// branch is now reachable with a token already in place.
			delete strategy.archetype;
			delete sources['strategy.archetype'];
			mark('strategy.archetypeText');
		}
	}
	const focusText = text(a.contentFocus);
	if (focusText) {
		const canonical = coerceToOption(focusText, CONTENT_FOCUS_OPTIONS);
		const token = canonical ? tokenForLabel('contentFocus', canonical) : null;
		if (token) {
			strategy.contentFocus = token;
			delete strategy.contentFocusText;
			mark('strategy.contentFocus');
		} else {
			strategy.contentFocusText = focusText;
			// The sampled token is SUPERSEDED, not joined. Leaving it beside off-list
			// text would give the persona two positions at once and let a downgrade
			// pick either one; since the skeleton always samples a contentFocus, this
			// branch is now reachable with a token already in place.
			delete strategy.contentFocus;
			delete sources['strategy.contentFocus'];
			mark('strategy.contentFocusText');
		}
	}
	const angle = text(a.contentAngle);
	if (angle) {
		strategy.contentAngle = angle;
		mark('strategy.contentAngle');
	}

	const audience = (out.audience ??= {});
	const avatar = text(a.targetAvatar);
	if (avatar) {
		audience.targetAvatar = avatar;
		mark('audience.targetAvatar');
	}
	const psych = text(a.psychProfile);
	if (psych) {
		audience.psychProfile = psych;
		mark('audience.psychProfile');
	}

	const look = (out.look ??= {});
	for (const key of ['wardrobe', 'outfitColors', 'styling', 'distinctiveFeatures'] as const) {
		const v = text(a[key]);
		if (v) {
			look[key] = v;
			mark(`look.${key}`);
		}
	}

	out.meta.generator = 'skeleton_v1';
	return out;
}

export interface GenerateV2Input {
	/** Stable per-persona seed. The agent id, so a re-generate reproduces the same person. */
	seed: string;
	/** The persona's existing name, if any — conditions gender and is never overwritten. */
	name?: string | null;
	/** Explicit gender from the UI; wins over the name inference. */
	gender?: string | null;
	brief?: Record<string, unknown> | null;
	/** Angles other personas already own, so this one differs. */
	takenAngles?: string[];
	direction?: string;
	/** Extra constraints (e.g. a niche the user already chose). */
	constraints?: SkeletonConstraints;
	now?: string;
}

/**
 * Drops keys whose value is `undefined`.
 *
 * Spreading an object that carries `{ market: undefined }` overrides a
 * brief-derived market with nothing. That is the quiet way a real signal
 * disappears — the key is present, so the spread wins, and no test that only
 * checks "the caller can override" ever notices. Pruning first makes the spread
 * mean "what the caller actually specified".
 */
function definedOnly(c: SkeletonConstraints | undefined): SkeletonConstraints {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(c ?? {})) if (v !== undefined) out[k] = v;
	return out as SkeletonConstraints;
}

/**
 * The facts about the CREATOR that a brief may legitimately pin. Deliberately short.
 *
 * A brief mixes two subjects that must not be confused: what the creator is, and
 * who they talk to. Market, niche and creator gender describe the creator. Age
 * band, gender skew, life stage and price positioning describe the AUDIENCE —
 * routing those here is how "we sell to 45–54s" silently becomes a 49-year-old
 * creator nobody asked for, and how a premium price frame becomes a wealthy
 * persona. `brief-constraints.ts` already draws that line when it reads a brief
 * (creator gender from the whole document, age and gender skew only from the
 * audience fields); this keeps the line intact on the way out.
 */
function creatorConstraints(input: GenerateV2Input, fromBrief: BriefConstraints): SkeletonConstraints {
	const explicit = definedOnly(input.constraints);
	return {
		// A brief-derived market is a real signal; absent, the sampler's own
		// default applies rather than a random country per persona.
		market: (fromBrief.market as TokenOf<'market'> | undefined) ?? explicit.market,
		niche: (fromBrief.niche as TokenOf<'niche'> | undefined) ?? explicit.niche,
		...explicit,
		name: input.name ?? explicit.name,
		gender:
			(input.gender === 'male' || input.gender === 'female' ? input.gender : undefined) ??
			explicit.gender ??
			(fromBrief.gender as TokenOf<'gender'> | undefined)
	};
}

/**
 * The audience the brief describes, written onto the skeleton.
 *
 * Marked `extracted`, not `sampled`: these came out of the customer's own brief,
 * and under the store's provenance rule automation may never overwrite an
 * extracted leaf. That is the correct treatment for something we were told
 * rather than something we chose.
 */
function applyBriefAudience(skeleton: PersonaProfileV2, fromBrief: BriefConstraints): PersonaProfileV2 {
	const sources = (skeleton.meta.fieldSources ??= {});
	const audience: PersonaAudience = (skeleton.audience ??= {});
	const put = <K extends keyof PersonaAudience>(key: K, value: PersonaAudience[K]): void => {
		audience[key] = value;
		sources[`audience.${key}`] = 'extracted';
	};

	// ONE definition of the buckets. `deriveAgeRanges` already answers "which
	// chips does this numeric span overlap", and the v1 UI is keyed by its
	// en-dashed labels, so converting its answer to tokens keeps the numbers,
	// the chips and the stored tokens from ever disagreeing. A second bounds
	// table here would be a second thing to keep in sync.
	if (fromBrief.ageRange) {
		const [a, b] = fromBrief.ageRange;
		const tokens = deriveAgeRanges({ ageMin: Math.min(a, b), ageMax: Math.max(a, b) })
			.map((l) => tokenForLabel('ageRange', l))
			.filter((t): t is TokenOf<'ageRange'> => isToken('ageRange', t));
		if (tokens.length) put('ageRanges', tokens);
	}
	if (isToken('genderMix', fromBrief.genderMix)) put('genderMix', fromBrief.genderMix);
	if (isToken('incomeBand', fromBrief.incomeBand)) put('incomeBand', fromBrief.incomeBand);
	const stages = (fromBrief.lifeStage ?? []).filter((s): s is TokenOf<'lifeStage'> =>
		isToken('lifeStage', s)
	);
	if (stages.length) put('lifeStage', stages);
	return skeleton;
}

/** The sampled persona before any model involvement. Pure and deterministic. */
export function skeletonFor(input: GenerateV2Input): PersonaProfileV2 {
	const fromBrief = briefToConstraints(input.brief);
	const skeleton = samplePersonaSkeleton(
		input.seed,
		creatorConstraints(input, fromBrief),
		input.now ? { now: input.now } : undefined
	);
	return applyBriefAudience(skeleton, fromBrief);
}

/**
 * The v1-shaped response the persona page already consumes, produced by
 * downgrading the v2 record. Keeping the wire shape identical is what lets the
 * flip happen behind a flag with no client change at all.
 */
export function toV1Response(profile: PersonaProfileV2): Record<string, unknown> {
	const v1 = downgradeV2toV1(profile) as Record<string, unknown>;
	const niche = profile.strategy?.niche ? label('niche', profile.strategy.niche) : '';
	return {
		niche: coerceToOption(niche, NICHE_OPTIONS),
		ageRanges: v1.ageRanges ?? [],
		gender: v1.gender ?? '',
		archetype: v1.archetype ?? '',
		contentFocus: v1.contentFocus ?? '',
		targetAvatar: v1.targetAvatar ?? '',
		psychProfile: v1.psychProfile ?? '',
		contentAngle: v1.contentAngle ?? '',
		appearance: v1.appearance ?? {},
		voiceProfile: v1.voiceProfile ?? {},
		/** The full v2 record, so a caller that understands it can store it verbatim. */
		_v2: profile
	};
}
