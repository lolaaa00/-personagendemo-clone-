/**
 * Persona Model v2 — the derived description, in ONE place.
 *
 * `description.short` and `description.frame` are the human-readable rendering
 * of facts stored elsewhere in the profile. Three different callers need them:
 * the sampler writes them when it draws a creator, the Tier 1 backfill rebuilds
 * them for a persona that predates them, and a field re-roll refreshes them
 * after the facts move. Each of those independently reproduced the same
 * sentence, which is three chances for the wording, the a/an rule and the
 * separator to drift apart — and a drift nobody would notice, because each copy
 * passes its own tests.
 *
 * So the sentence lives here and nowhere else. This module is the definition;
 * the sampler is a caller like any other.
 *
 * It DEGRADES: every fact is optional, and a profile that has only some of them
 * gets a sentence about the ones it has, never about the ones it does not. That
 * is what lets the same function serve a freshly sampled creator (all facts
 * present, so it produces the full sentence) and a half-empty upgraded v1 blob.
 *
 * Rendered through `label()`, because a raw token in a UI string is the en-dash
 * incident waiting to happen again.
 *
 * Pure, client-safe, never throws: a malformed profile describes nothing, which
 * is a correct answer rather than a failure.
 */
import { label } from './labels';
import { isObj, type Obj } from './paths';
import type { PersonaDescription, PersonaDescriptionFact, PersonaProfileV2 } from './schema';

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Words that are proper nouns or initialisms even in running text.
 *
 * Occupation titles are stored title-cased ("Customer Support Lead") because
 * that is how they read in a field label, but "a 46-year-old Customer Support
 * Lead" is wrong in a sentence. Lower-casing the whole phrase fixes it, except
 * for these.
 */
const TITLE_KEEP_CASE = /^(AI|IT|HR|PR|UX|UI|SEO|QA|CEO|CTO|CFO|COO)$/;

/** A stored job title as it reads mid-sentence. */
export function inSentence(title: string): string {
	return title
		.split(' ')
		.map((word) => (TITLE_KEEP_CASE.test(word) ? word : word.toLowerCase()))
		.join(' ');
}

/**
 * 'a' vs 'an' for "a 34-year-old" / "an 18-year-old".
 *
 * Driven by how the NUMBER is pronounced, not by its first letter: 18, 19 and
 * the eighties all open with a vowel sound while their digits do not, so a
 * spelling test would write "a 18-year-old" in the headline sentence.
 */
export function ageArticle(age: number): string {
	return age === 11 || age === 18 || age === 19 || (age >= 80 && age <= 89) ? 'an' : 'a';
}

/** 'a' vs 'an' for a job title used without an age in front of it. */
function titleArticle(job: string): string {
	return /^[aeiou]/i.test(job) ? 'an' : 'a';
}

/** 'Brisbane, Queensland' — or whichever half exists. */
function placePhrase(location: unknown): string | undefined {
	if (!isObj(location)) return undefined;
	const city = str(location.city);
	const region = str(location.region);
	if (city && region) return `${city}, ${region}`;
	return city ?? region;
}

/** The public name: displayName, else first + last. */
function namePhrase(creator: Obj): string | undefined {
	const display = str(creator.displayName);
	if (display) return display;
	const parts = [str(creator.firstName), str(creator.lastName)].filter(Boolean);
	return parts.length ? parts.join(' ') : undefined;
}

/** The household fact: status · children · housing, whichever are set. */
function householdValue(household: unknown): string | undefined {
	if (!isObj(household)) return undefined;
	const parts: string[] = [];
	const status = str(household.relationshipStatus);
	if (status) parts.push(label('relationshipStatus', status));
	const children = isObj(household.children) ? household.children : undefined;
	const count = children ? num(children.count) : undefined;
	if (count !== undefined && count > 0) parts.push(`${count} ${count === 1 ? 'child' : 'children'}`);
	const housing = str(household.housingType);
	if (housing) parts.push(label('housingType', housing));
	return parts.length ? parts.join(' · ') : undefined;
}

/** The work fact: title · domain, whichever are set. */
function workValue(work: unknown): string | undefined {
	if (!isObj(work)) return undefined;
	const title = str(work.title);
	const domain = str(work.domain);
	const domainLabel = domain ? label('workDomain', domain) : undefined;
	if (title && domainLabel) return `${title} · ${domainLabel}`;
	return title ?? domainLabel;
}

/**
 * The one-line description. A name with nothing to say about it yields nothing:
 * "Jenny Tran." is not a description.
 */
export function describeShort(creator: unknown): string | undefined {
	if (!isObj(creator)) return undefined;
	const name = namePhrase(creator);
	if (!name) return undefined;

	const age = num(creator.age);
	const work = isObj(creator.work) ? creator.work : undefined;
	const title = work ? str(work.title) : undefined;
	const place = placePhrase(creator.location);
	const inPlace = place ? ` in ${place}` : '';

	if (age !== undefined && title) {
		return `${name} is ${ageArticle(age)} ${age}-year-old ${inSentence(title)}${inPlace}.`;
	}
	if (title) {
		const job = inSentence(title);
		return `${name} is ${titleArticle(job)} ${job}${inPlace}.`;
	}
	if (age !== undefined) {
		return place ? `${name} is ${age} years old and lives in ${place}.` : `${name} is ${age} years old.`;
	}
	if (place) return `${name} lives in ${place}.`;
	return undefined;
}

/** The fact strip. Canonical order; a fact with no input is simply absent. */
export function describeFrame(creator: unknown): PersonaDescriptionFact[] | undefined {
	if (!isObj(creator)) return undefined;
	const frame: PersonaDescriptionFact[] = [];
	const age = num(creator.age);
	if (age !== undefined) frame.push({ key: 'age', label: 'Age', value: `${age}` });
	const place = placePhrase(creator.location);
	if (place) frame.push({ key: 'location', label: 'Location', value: place });
	const work = workValue(creator.work);
	if (work) frame.push({ key: 'work', label: 'Work', value: work });
	const household = householdValue(creator.household);
	if (household) frame.push({ key: 'household', label: 'Household', value: household });
	return frame.length ? frame : undefined;
}

/**
 * Both halves for a whole profile. `undefined` when there is nothing to say,
 * so a caller can distinguish "no description" from "an empty one".
 */
export function describeProfile(profile: unknown): PersonaDescription | undefined {
	const creator = isObj(profile) ? (profile as unknown as PersonaProfileV2).creator : undefined;
	const short = describeShort(creator);
	const frame = describeFrame(creator);
	if (!short && !frame) return undefined;
	const out: PersonaDescription = {};
	if (short) out.short = short;
	if (frame) out.frame = frame;
	return out;
}
