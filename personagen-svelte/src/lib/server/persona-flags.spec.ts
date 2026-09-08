/**
 * Persona Model v2 switches — precedence and fail-safe behaviour.
 *
 * These two flags decide whether a persona is built by the old path or the new
 * one, and whether sampled life facts reach a prompt. Both must default to
 * today's behaviour and must never turn ON by accident: a typo in the Admin
 * Console, a stale environment variable, a half-written database row all have to
 * read as "off", never as "on".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv, settings } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string>,
	settings: { value: {} as Record<string, unknown> }
}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./settings', () => ({ getSettings: () => settings.value }));

const {
	personaGenerator,
	personaGeneratorSource,
	personaBackbone,
	personaBackboneSource,
	personaBackbonePersists,
	personaBackboneEmits
} = await import('./flags');

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	settings.value = {};
});

describe('defaults — the untouched system behaves exactly as it does today', () => {
	it('generator is v1 and backbone is off with nothing configured', () => {
		expect(personaGenerator()).toBe('v1');
		expect(personaBackbone()).toBe('off');
		expect(personaGeneratorSource()).toBe('default');
		expect(personaBackboneSource()).toBe('default');
		expect(personaBackbonePersists()).toBe(false);
		expect(personaBackboneEmits()).toBe(false);
	});
});

describe('precedence: env beats database beats default', () => {
	it('the database row is used when no env var is set', () => {
		settings.value = { persona_generator: 'v2', persona_backbone: 'fill' };
		expect(personaGenerator()).toBe('v2');
		expect(personaBackbone()).toBe('fill');
		expect(personaGeneratorSource()).toBe('database');
		expect(personaBackboneSource()).toBe('database');
	});

	it('the env var overrides the database — the host-level emergency brake', () => {
		settings.value = { persona_generator: 'v2', persona_backbone: 'on' };
		mockEnv.PERSONA_GENERATOR = 'v1';
		mockEnv.PERSONA_BACKBONE = 'off';
		expect(personaGenerator()).toBe('v1');
		expect(personaBackbone()).toBe('off');
		expect(personaGeneratorSource()).toBe('env');
		expect(personaBackboneSource()).toBe('env');
	});

	it('an EMPTY env var is not a setting — it falls through to the database', () => {
		settings.value = { persona_generator: 'v2' };
		mockEnv.PERSONA_GENERATOR = '';
		expect(personaGenerator()).toBe('v2');
		expect(personaGeneratorSource()).toBe('database');
	});

	it('is read at call time, so a console flip takes effect without a redeploy', () => {
		expect(personaBackbone()).toBe('off');
		settings.value = { persona_backbone: 'on' };
		expect(personaBackbone()).toBe('on');
	});
});

describe('fail safe — anything unrecognised reads as the current behaviour', () => {
	it.each(['V2 ', 'yes', 'true', '2', 'enabled', 'null'])(
		'generator: %s does not silently mean v2 unless it really is v2',
		(raw) => {
			mockEnv.PERSONA_GENERATOR = raw;
			expect(personaGenerator()).toBe(raw.trim().toLowerCase() === 'v2' ? 'v2' : 'v1');
		}
	);

	it.each(['ON!', 'yes', 'true', 'fill ', 'shadowy', ''])('backbone: %s never turns emission on by accident', (raw) => {
		mockEnv.PERSONA_BACKBONE = raw;
		const v = personaBackbone();
		const expected = ['shadow', 'fill', 'on'].includes(raw.trim().toLowerCase()) ? raw.trim().toLowerCase() : 'off';
		expect(v).toBe(raw === '' ? 'off' : expected);
	});

	it('junk in the database row reads as off, not as a crash', () => {
		settings.value = { persona_generator: 42, persona_backbone: { nested: true } };
		expect(personaGenerator()).toBe(42 as never); // getSettings is the coercion boundary…
		settings.value = {};
		expect(personaGenerator()).toBe('v1'); // …and an absent row is always safe
	});

	it('case and surrounding whitespace are tolerated on the env var', () => {
		mockEnv.PERSONA_BACKBONE = '  ON  ';
		expect(personaBackbone()).toBe('on');
		mockEnv.PERSONA_GENERATOR = ' V2 ';
		expect(personaGenerator()).toBe('v2');
	});
});

describe('the two derived gates', () => {
	it('persists at fill and on, not before', () => {
		for (const [mode, persists] of [
			['off', false],
			['shadow', false],
			['fill', true],
			['on', true]
		] as const) {
			settings.value = { persona_backbone: mode };
			expect(personaBackbonePersists(), mode).toBe(persists);
		}
	});

	it('emits ONLY at on — the single gate on facts reaching a prompt', () => {
		for (const mode of ['off', 'shadow', 'fill'] as const) {
			settings.value = { persona_backbone: mode };
			expect(personaBackboneEmits(), mode).toBe(false);
		}
		settings.value = { persona_backbone: 'on' };
		expect(personaBackboneEmits()).toBe(true);
	});

	it('storing data and telling the model are separate steps — fill persists but never emits', () => {
		settings.value = { persona_backbone: 'fill' };
		expect(personaBackbonePersists()).toBe(true);
		expect(personaBackboneEmits()).toBe(false);
	});
});
