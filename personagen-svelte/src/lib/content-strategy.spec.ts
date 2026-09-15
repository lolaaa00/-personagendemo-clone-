/**
 * The point of these tests is one property: **every field of the output must be
 * traceable to an input.** The wizard this replaced failed that property
 * completely — it returned the same literal whatever you typed, including a
 * "your current followers: 2,400" line shown to accounts with no connected
 * platform at all.
 *
 * So the assertions below are mostly of the form "change an input, the output
 * changes" and "invent nothing".
 */
import { describe, it, expect } from 'vitest';
import { buildStrategy, rankPlatforms, buildPillars, type BriefLike, type WizardAnswers } from './content-strategy';

const answers = (over: Partial<WizardAnswers> = {}): WizardAnswers => ({
	companyName: 'HoneyX',
	industry: 'E-Commerce',
	targetAudience: 'Australian men 28-45',
	competitors: [{ url: '', platform: 'youtube' }],
	existingContent: '',
	contentTypes: [],
	ageMin: 28,
	ageMax: 45,
	interests: [],
	locations: ['Sydney'],
	...over
});

const brief = (over: Partial<BriefLike> = {}): BriefLike => ({
	brandName: 'HoneyX',
	products: [{ name: 'Manly Plus 450g' }],
	...over
});

describe('nothing is invented', () => {
	it('reports no measurement of any kind', () => {
		const s = buildStrategy(brief(), answers());
		const text = JSON.stringify(s).toLowerCase();
		// The removed table claimed followers, engagement rate, reach, saves and
		// mentions as the user's CURRENT numbers. None of those words may return
		// as a claimed value.
		for (const banned of ['"current"', 'followers:', 'engagement rate:', 'avg. reach']) {
			expect(text).not.toContain(banned);
		}
		expect(s).not.toHaveProperty('targets');
	});

	it('an empty brief produces an admission, not advice', () => {
		const s = buildStrategy({}, answers({ companyName: '', targetAudience: '' }));
		expect(s.pillars).toHaveLength(1);
		expect(s.pillars[0].from).toMatch(/nothing/i);
		expect(s.pillars[0].description).toMatch(/guess dressed up as advice/i);
		expect(s.provenance.used).toHaveLength(0);
		expect(s.provenance.missing.length).toBeGreaterThan(4);
	});

	it('a default platform says out loud that it is not based on your input', () => {
		const s = buildStrategy({}, answers());
		expect(s.platforms.every((p) => p.fromYou === false)).toBe(true);
		expect(s.platforms[0].why).toMatch(/not based on anything you told us/i);
	});
});

describe('the output changes when the input changes', () => {
	it('platforms come from the brief, ranked above competitor platforms', () => {
		const ranked = rankPlatforms(brief({ platforms: ['linkedin'] }), answers({ competitors: [{ url: 'https://x.test/a', platform: 'tiktok' }] }));
		expect(ranked[0].platform).toBe('LinkedIn');
		expect(ranked[0].fromYou).toBe(true);
		expect(ranked[1].platform).toBe('TikTok');
		expect(ranked.map((p) => p.rank)).toEqual([1, 2]);
	});

	it('pain points in the brief create their own pillar, quoting the first one', () => {
		const p = buildPillars(brief({ painPoints: ['the 3pm energy crash'] }), answers());
		const pain = p.find((x) => x.name === 'The problem you solve');
		expect(pain).toBeTruthy();
		expect(pain!.description).toContain('the 3pm energy crash');
	});

	it('the chosen formats drive the weekly schedule', () => {
		const s = buildStrategy(brief(), answers({ contentTypes: ['Short video', 'Carousel'] }));
		expect(new Set(s.schedule.map((x) => x.type))).toEqual(new Set(['Short video', 'Carousel']));
		expect(s.commitment.formats.sort()).toEqual(['Carousel', 'Short video']);
	});

	it('interests the user typed appear in the audience pillar', () => {
		const p = buildPillars(brief(), answers({ interests: ['home espresso', 'trail running'] }));
		const aud = p.find((x) => x.name === 'What your audience is into anyway');
		expect(aud!.description).toContain('home espresso');
		expect(aud!.from).toContain('trail running');
	});

	it('product names reach the primary pillar', () => {
		const p = buildPillars(brief({ products: [{ name: 'Manly Plus 450g' }, { name: 'Manly Plus 200g' }] }), answers());
		expect(p[0].description).toContain('Manly Plus 450g');
		expect(p[0].from).toContain('2 products');
	});
});

describe('the commitment is a commitment, not a forecast', () => {
	it('counts what the plan asks of you and nothing else', () => {
		const s = buildStrategy(brief({ platforms: ['instagram', 'tiktok'] }), answers({ contentTypes: ['Post'] }));
		expect(s.commitment.postsPerWeek).toBe(s.schedule.length);
		expect(s.commitment.platforms).toBe(new Set(s.schedule.map((x) => x.platform)).size);
	});

	it('records which inputs were present and which were not', () => {
		const s = buildStrategy(brief({ painPoints: ['x'], platforms: ['instagram'] }), answers({ contentTypes: ['Post'] }));
		expect(s.provenance.used).toContain('products');
		expect(s.provenance.used).toContain('pain points');
		expect(s.provenance.missing).toContain('competitors you named');
	});
});
