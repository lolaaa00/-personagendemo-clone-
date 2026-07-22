/**
 * Persona gender resolution — the engine behind every gendered prompt (kit
 * stages, hero portrait, voice pick). Guards the three misgendering bugs:
 * audience text flipping the creator's gender ("helps busy moms" → female),
 * the customer avatar being scanned as if it described the creator, and the
 * unpinned 'Adam' voice default silently reading as a male signal.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

const {
	inferGenderFromText,
	resolvePersonaGender,
	buildFaceCloseupPrompt,
	buildSideProfilePrompt
} = await import('./generate');

describe('inferGenderFromText', () => {
	it('reads pronouns as the persona itself', () => {
		expect(inferGenderFromText('She shares her morning routine')).toBe('female');
		expect(inferGenderFromText('He reviews gear on his channel')).toBe('male');
	});

	it('pronouns beat audience nouns (the "male coach for women" case)', () => {
		expect(inferGenderFromText('He is a coach helping busy moms and women stay fit')).toBe(
			'male'
		);
	});

	it('ignores plural audience nouns entirely', () => {
		expect(inferGenderFromText('Target audience: women 30+ who want healthy snacks')).toBe(
			undefined
		);
		expect(inferGenderFromText('content for men and boys')).toBe(undefined);
	});

	it('singular identity nouns still resolve', () => {
		expect(inferGenderFromText('a 26-year-old woman from Dubai')).toBe('female');
		expect(inferGenderFromText('a regular guy who loves BBQ')).toBe('male');
	});

	it('returns undefined on contradiction or no signal', () => {
		expect(inferGenderFromText('she and he co-host')).toBe(undefined);
		expect(inferGenderFromText('brand advocate for healthy snacks')).toBe(undefined);
		expect(inferGenderFromText('')).toBe(undefined);
	});
});

describe('resolvePersonaGender', () => {
	it('explicit Profile field always wins', () => {
		expect(
			resolvePersonaGender({ market: '{"gender":"male"}', soul: 'She loves her routine' })
		).toBe('male');
	});

	it('name lookup beats the text scan', () => {
		expect(resolvePersonaGender({ name: 'Marcus Chen', soul: 'helps busy moms' })).toBe('male');
	});

	it('does NOT scan targetAvatar (it describes the customer)', () => {
		const agent = {
			name: 'Courtney Glenn', // not in the name dictionary
			soul: 'You are the official brand advocate for Just Kids Honey.',
			market: '{"targetAvatar":"Sarah, 32-year-old mother of two, she juggles work and kids"}'
		};
		expect(resolvePersonaGender(agent)).toBe(undefined);
	});

	it('audience-only soul text no longer flips the persona female', () => {
		const agent = {
			name: 'Courtney Glenn',
			soul: 'You help busy moms and women 30+ find healthy snacks for active kids.'
		};
		expect(resolvePersonaGender(agent)).toBe(undefined);
	});

	it('falls back to a deliberately pinned voice', () => {
		const neutral = { name: 'Courtney Glenn', soul: 'Brand advocate for healthy snacks.' };
		expect(resolvePersonaGender(neutral, 'Rachel')).toBe('female');
		expect(resolvePersonaGender(neutral, 'Josh')).toBe('male');
		// The column default is not a user choice — no signal.
		expect(resolvePersonaGender(neutral, 'Adam')).toBe(undefined);
		// Unknown voice name → no signal either.
		expect(resolvePersonaGender(neutral, 'NotAVoice')).toBe(undefined);
	});

	it('reads agentData.ugc_voice when merged into the agent row', () => {
		expect(
			resolvePersonaGender({ name: 'Courtney Glenn', soul: 'Snacks.', ugc_voice: 'Rachel' })
		).toBe('female');
	});

	it('soul pronouns beat the pinned voice', () => {
		expect(
			resolvePersonaGender({ name: 'Courtney Glenn', soul: 'He shares his honest reviews' }, 'Rachel')
		).toBe('male');
	});
});

describe('kit prompts stay neutral when gender is unknown', () => {
	it('never claims a gender it does not have', () => {
		expect(buildFaceCloseupPrompt(undefined)).toContain("the person's face");
		expect(buildFaceCloseupPrompt('male')).toContain("the man's face");
		expect(buildFaceCloseupPrompt('female')).toContain("the woman's face");
		expect(buildSideProfilePrompt(undefined)).toContain('their side profile');
	});
});
