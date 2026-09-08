/**
 * First-name → gender lookup, and the inference built on it.
 *
 * CLIENT-SAFE on purpose (no $env, no lib/server imports): the persona sampler,
 * the engine and content generation all need it, and a server-only home would
 * force the sampler to duplicate the table. Moved out of
 * lib/server/content/generate.ts for Persona Model v2 P1.1; that module
 * re-exports it, so every existing caller keeps working unchanged.
 *
 * Deliberately a small explicit table rather than a library: it only has to cover
 * the names this product generates and the ones users type. An unknown name
 * returns undefined, and callers treat that as "no signal" — never as a default
 * gender. That rule is what keeps a mis-set gender from being invented rather
 * than inferred.
 */

const NAME_GENDER: Record<string, 'male' | 'female'> = {
	// female
	aisha: 'female',
	sofia: 'female',
	sophia: 'female',
	veronica: 'female',
	chloe: 'female',
	aria: 'female',
	elena: 'female',
	jenny: 'female',
	jennifer: 'female',
	lexy: 'female',
	lexi: 'female',
	alexa: 'female',
	emma: 'female',
	olivia: 'female',
	ava: 'female',
	isabella: 'female',
	mia: 'female',
	amelia: 'female',
	harper: 'female',
	evelyn: 'female',
	charlotte: 'female',
	luna: 'female',
	grace: 'female',
	chloé: 'female',
	maya: 'female',
	zoe: 'female',
	zoey: 'female',
	nora: 'female',
	lily: 'female',
	hannah: 'female',
	layla: 'female',
	aaliyah: 'female',
	fatima: 'female',
	noor: 'female',
	sara: 'female',
	sarah: 'female',
	priya: 'female',
	ananya: 'female',
	mei: 'female',
	yuki: 'female',
	kayla: 'female',
	mila: 'female',
	ivy: 'female',
	ruby: 'female',
	jade: 'female',
	bella: 'female',
	// male
	marcus: 'male',
	kai: 'male',
	ryan: 'male',
	james: 'male',
	liam: 'male',
	noah: 'male',
	oliver: 'male',
	elijah: 'male',
	william: 'male',
	henry: 'male',
	lucas: 'male',
	mason: 'male',
	ethan: 'male',
	logan: 'male',
	jack: 'male',
	aiden: 'male',
	jackson: 'male',
	david: 'male',
	joseph: 'male',
	samuel: 'male',
	omar: 'male',
	ali: 'male',
	hassan: 'male',
	raj: 'male',
	arjun: 'male',
	chen: 'male',
	hiro: 'male',
	kenji: 'male',
	diego: 'male',
	mateo: 'male',
	leo: 'male',
	max: 'male',
	adam: 'male',
	brian: 'male',
	josh: 'male',
	joshua: 'male',
	tyler: 'male',
	dylan: 'male',
	nathan: 'male'
};

export function inferGenderFromName(
	name: string | undefined | null
): 'male' | 'female' | undefined {
	if (!name) return undefined;
	const first = name
		.trim()
		.toLowerCase()
		.split(/[\s._-]+/)[0]
		?.replace(/[^a-zà-ÿ]/g, '');
	return first ? NAME_GENDER[first] : undefined;
}
