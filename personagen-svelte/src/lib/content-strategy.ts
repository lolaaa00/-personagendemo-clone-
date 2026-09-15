/**
 * Builds a content strategy from a brand brief and the answers given in the
 * Content Plan wizard.
 *
 * WHY THIS IS A PURE FUNCTION AND NOT A MODEL CALL
 *
 * The wizard this replaces did not compute anything. Step 5 ran
 * `await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500))` — a
 * simulated delay with a spinner — and then returned a hardcoded literal. The
 * competitor URLs, content types, age range, interests and locations collected
 * in steps 2 to 4 were never read. The result was never saved anywhere.
 *
 * The serious part was its "targets" table, which presented invented numbers as
 * the user's own current performance:
 *
 *     { metric: 'Total Followers', current: '2,400',  target30: '3,800'  }
 *     { metric: 'Engagement Rate', current: '2.1%',   target30: '4.5%'   }
 *
 * Shown to an account with no connected platforms, that is the product telling
 * the user something false about their own business. Nothing here invents a
 * measurement. Every field below is derived from an input the user supplied, and
 * `provenance` records which input produced it, so the UI can show its working.
 *
 * A model call would be a reasonable future upgrade for the prose. It is not
 * what was missing: what was missing was that the output had no relationship to
 * the input at all.
 */

export interface BriefLike {
	brandName?: string;
	tagline?: string;
	mission?: string;
	storeUrl?: string;
	products?: Array<{ name?: string; price?: string; blurb?: string } | string>;
	platforms?: string[] | string;
	traits?: string[] | string;
	commStyle?: string;
	interests?: string[] | string;
	painPoints?: string[] | string;
	demographics?: string;
	competitors?: Array<{ name?: string; url?: string } | string>;
}

export interface WizardAnswers {
	companyName: string;
	industry: string;
	targetAudience: string;
	competitors: Array<{ url: string; platform: string }>;
	existingContent: string;
	contentTypes: string[];
	ageMin: number;
	ageMax: number;
	interests: string[];
	locations: string[];
}

export interface StrategyPillar {
	name: string;
	description: string;
	priority: 'Primary' | 'Secondary' | 'Supporting';
	/** The input this pillar was derived from. */
	from: string;
}

export interface StrategySlot {
	day: string;
	time: string;
	type: string;
	platform: string;
}

export interface PlatformFit {
	platform: string;
	rank: number;
	why: string;
	/** True when the user named this platform themselves, rather than it being a default. */
	fromYou: boolean;
}

export interface ContentStrategy {
	/** ISO timestamp — a strategy is a snapshot of the brief it was built from. */
	builtAt: string;
	pillars: StrategyPillar[];
	schedule: StrategySlot[];
	platforms: PlatformFit[];
	/** What the plan asks of the operator each week. Commitments, never measurements. */
	commitment: { postsPerWeek: number; platforms: number; formats: string[] };
	/** Which inputs were present, so the UI can say what it worked from — and what it lacked. */
	provenance: { used: string[]; missing: string[] };
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Slot times chosen to spread across the day; not a claim about your audience. */
const TIMES = ['08:00', '12:00', '17:30', '09:30', '19:00', '11:00', '16:00'];

const PLATFORM_LABEL: Record<string, string> = {
	instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook',
	x: 'X', threads: 'Threads', linkedin: 'LinkedIn', bluesky: 'Bluesky',
	pinterest: 'Pinterest', reddit: 'Reddit', telegram: 'Telegram', snapchat: 'Snapchat',
	google_business: 'Google Business'
};

const toList = (v: unknown): string[] => {
	if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
	if (typeof v === 'string') return v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
	return [];
};

const label = (p: string) => PLATFORM_LABEL[p.toLowerCase().replace(/\s|\//g, '_')] ?? p;

const productNames = (brief: BriefLike): string[] =>
	(brief.products ?? [])
		.map((p) => (typeof p === 'string' ? p : (p?.name ?? '')))
		.map((s) => String(s).trim())
		.filter(Boolean);

/**
 * The platforms this plan will cover, in priority order.
 *
 * Priority is evidence, not a score: a platform the user named in their brief
 * outranks one they only mentioned while listing a competitor, which outranks
 * the default. No numeric "fit score" is produced, because a number like 92
 * reads as a measurement and nothing here is measured.
 */
export function rankPlatforms(brief: BriefLike, answers: WizardAnswers): PlatformFit[] {
	const fromBrief = toList(brief.platforms).map((p) => p.toLowerCase());
	const fromCompetitors = answers.competitors
		.filter((c) => c.url.trim())
		.map((c) => c.platform.toLowerCase());

	const seen = new Map<string, PlatformFit>();
	let rank = 1;
	for (const p of fromBrief) {
		if (seen.has(p)) continue;
		seen.set(p, { platform: label(p), rank: rank++, fromYou: true, why: 'You listed this in your brand brief as a platform you publish on.' });
	}
	for (const p of fromCompetitors) {
		if (seen.has(p)) continue;
		seen.set(p, { platform: label(p), rank: rank++, fromYou: true, why: 'You pointed at a competitor here, so it is somewhere your market already looks.' });
	}
	if (seen.size === 0) {
		// Nothing to go on. Say so rather than inventing a ranking.
		for (const p of ['instagram', 'tiktok']) {
			seen.set(p, { platform: label(p), rank: rank++, fromYou: false, why: 'A starting default — your brief names no platforms yet, so this is not based on anything you told us.' });
		}
	}
	return [...seen.values()];
}

/** Content pillars, each traceable to the input that produced it. */
export function buildPillars(brief: BriefLike, answers: WizardAnswers): StrategyPillar[] {
	const brand = answers.companyName || brief.brandName || 'your brand';
	const products = productNames(brief);
	const pains = toList(brief.painPoints);
	const interests = [...new Set([...answers.interests, ...toList(brief.interests)])];
	const pillars: StrategyPillar[] = [];

	if (products.length) {
		pillars.push({
			name: 'The product, shown in use',
			priority: 'Primary',
			from: `${products.length} product${products.length === 1 ? '' : 's'} in your brief`,
			description: `${products.slice(0, 3).join(', ')}${products.length > 3 ? ` and ${products.length - 3} more` : ''} — shown being used, not described. This is the pillar that has to carry ${brand}, because it is the only one your catalogue can prove.`
		});
	}
	if (pains.length) {
		pillars.push({
			name: 'The problem you solve',
			priority: products.length ? 'Primary' : 'Primary',
			from: 'the pain points in your brief',
			description: `Content that starts from "${pains[0]}" and earns the product as the answer. Your brief lists ${pains.length} pain point${pains.length === 1 ? '' : 's'}; each one is a series, not a post.`
		});
	}
	if (interests.length) {
		pillars.push({
			name: 'What your audience is into anyway',
			priority: 'Secondary',
			from: `interests you named: ${interests.slice(0, 4).join(', ')}`,
			description: `The ~80% that has nothing to sell: ${interests.slice(0, 4).join(', ')}. This is what makes the account worth following between promotions.`
		});
	}
	if (answers.existingContent.trim()) {
		pillars.push({
			name: 'More of what already worked',
			priority: 'Secondary',
			from: 'the existing content you described',
			description: `You told us what you are already posting. Keep the format that works and change only the subject: repetition is what makes an account legible.`
		});
	}
	if (brief.mission || brief.tagline) {
		pillars.push({
			name: 'Why the brand exists',
			priority: 'Supporting',
			from: brief.mission ? 'your mission statement' : 'your tagline',
			description: `${brief.mission || brief.tagline} — said occasionally and plainly, not as a slogan on every post.`
		});
	}
	if (!pillars.length) {
		pillars.push({
			name: 'Not enough in the brief yet',
			priority: 'Primary',
			from: 'nothing — your brief is still empty',
			description: 'Add products, pain points or an audience to your brand brief and build this again. A plan derived from an empty brief would be a guess dressed up as advice.'
		});
	}
	return pillars;
}

/** A week of slots, built from the formats chosen and the platforms ranked. */
export function buildSchedule(answers: WizardAnswers, platforms: PlatformFit[]): StrategySlot[] {
	const formats = answers.contentTypes.length ? answers.contentTypes : ['Post'];
	const plats = platforms.length ? platforms : [{ platform: 'Instagram', rank: 1, why: '', fromYou: false }];
	// One slot per day, cycling formats and platforms so no combination repeats
	// until both lists have been exhausted.
	return DAYS.map((day, i) => ({
		day,
		time: TIMES[i % TIMES.length],
		type: formats[i % formats.length],
		platform: plats[i % plats.length].platform
	}));
}

export function buildStrategy(brief: BriefLike, answers: WizardAnswers): ContentStrategy {
	const platforms = rankPlatforms(brief, answers);
	const pillars = buildPillars(brief, answers);
	const schedule = buildSchedule(answers, platforms);

	const used: string[] = [];
	const missing: string[] = [];
	const note = (ok: boolean, name: string) => (ok ? used : missing).push(name);
	note(productNames(brief).length > 0, 'products');
	note(toList(brief.painPoints).length > 0, 'pain points');
	note(Boolean(brief.mission || brief.tagline), 'mission or tagline');
	note(toList(brief.platforms).length > 0, 'platforms in your brief');
	note(answers.contentTypes.length > 0, 'the formats you picked');
	note(answers.interests.length > 0 || toList(brief.interests).length > 0, 'audience interests');
	note(answers.competitors.some((c) => c.url.trim()), 'competitors you named');
	note(Boolean(answers.targetAudience.trim() || brief.demographics), 'who you are talking to');

	return {
		builtAt: new Date().toISOString(),
		pillars,
		schedule,
		platforms,
		commitment: {
			postsPerWeek: schedule.length,
			platforms: new Set(schedule.map((s) => s.platform)).size,
			formats: [...new Set(schedule.map((s) => s.type))]
		},
		provenance: { used, missing }
	};
}
