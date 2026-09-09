import { describe, it, expect } from 'vitest';
import {
	FORMAT_CATALOG,
	FORMAT_KINDS,
	craftMatters,
	formatFromRequest,
	formatsOfKind,
	getFormat,
	planPipeline,
	planTotalUsd,
	requestFor,
	type StepKind,
	type StepModel
} from './formats';

/**
 * These lock the two properties the composer's honesty depends on:
 *
 *  1. A format id round-trips to and from the media/format/still body the API
 *     has always spoken, so 42 Studio templates and the autopilot keep working
 *     without knowing this module exists.
 *  2. planPipeline() is the ONE place a pipeline and its price are decided.
 *     The server builds the preview with it and the composer re-prices every
 *     change with it, so the two cannot drift — which is the entire reason the
 *     preview round-trip exists.
 */

const model = (id: string, usd: number, tier?: StepModel['tier']): StepModel => ({
	id,
	label: id,
	usd,
	provider: 'fal',
	tier
});

const OPTIONS: Partial<Record<StepKind, StepModel[]>> = {
	still: [
		model('qwen-edit', 0.02, 'budget'),
		model('kontext', 0.04, 'balanced'),
		model('nano', 0.08, 'premium')
	],
	video: [
		model('wan', 0.1, 'budget'),
		model('kling-std', 0.42, 'balanced'),
		model('veo', 1.5, 'premium')
	]
};

const FIXED: Partial<Record<StepKind, StepModel>> = {
	director: { id: 'gemini', label: 'gemini', usd: 0.002, provider: 'openrouter' },
	still: model('nano', 0.08, 'premium'),
	video: model('kling-std', 0.42, 'balanced'),
	card: { id: 'local-card', label: 'server renderer', usd: 0, provider: 'local', tier: 'free' },
	tts: model('eleven', 0.03, 'balanced'),
	talkinghead: model('omnihuman', 0.7, 'premium'),
	cine_stills: model('nano', 0.08, 'premium'),
	cine_video: model('kling-ref', 1.6, 'premium')
};

const plan = (formatId: string, extra = {}) =>
	planPipeline({ formatId, options: OPTIONS, fixed: FIXED, ...extra });

describe('format catalog', () => {
	it('every format belongs to a kind that is actually offered', () => {
		const kinds = new Set(FORMAT_KINDS.map((k) => k.id));
		for (const f of FORMAT_CATALOG) expect(kinds.has(f.kind)).toBe(true);
	});

	it('a text card is an Image, not a Video — the bug that started all this', () => {
		expect(getFormat('text-card')?.kind).toBe('image');
		expect(formatsOfKind('image').map((f) => f.id)).toContain('text-card');
		expect(formatsOfKind('video').map((f) => f.id)).not.toContain('text-card');
	});

	it('cinematic is a video FORMAT, no longer hidden inside the media dropdown', () => {
		expect(getFormat('cinematic')?.kind).toBe('video');
		expect(formatsOfKind('video').map((f) => f.id)).toContain('cinematic');
	});

	it('only offers controls a format actually reads', () => {
		// A card has no scene, no face and no product — showing those fields would
		// be the exact lie the composition contract exists to prevent.
		const card = getFormat('text-card')!;
		expect(card.needs).toEqual(expect.arrayContaining(['cardText']));
		expect(card.needs).not.toContain('face');
		expect(card.needs).not.toContain('product');
		expect(card.needs).not.toContain('scene');
		// Nothing declares a shot-count control: the Director picks 2–5 at run time.
		for (const f of FORMAT_CATALOG) expect(f.needs).not.toContain('shots');
	});
});

describe('requestFor / formatFromRequest — the legacy body round-trip', () => {
	it('maps each format to the media/format/still the API already speaks', () => {
		expect(requestFor('photo')).toMatchObject({ media: 'image', still: 'photo' });
		expect(requestFor('text-card')).toMatchObject({
			media: 'image',
			still: 'graphic',
			refs: { character: false, product: false }
		});
		expect(requestFor('spokesperson')).toMatchObject({ media: 'video', format: 'spokesperson' });
		expect(requestFor('product-motion')).toMatchObject({ media: 'video', format: 'broll' });
		expect(requestFor('cinematic')).toMatchObject({ media: 'cinematic' });
	});

	it('reads a legacy Studio template body back into a format', () => {
		expect(formatFromRequest({ media: 'image', still: 'graphic' })).toBe('text-card');
		expect(formatFromRequest({ media: 'image' })).toBe('photo');
		expect(formatFromRequest({ media: 'cinematic' })).toBe('cinematic');
		expect(formatFromRequest({ format: 'spokesperson' })).toBe('spokesperson');
		expect(formatFromRequest({ format: 'broll' })).toBe('product-motion');
		expect(formatFromRequest({})).toBe('auto');
		expect(formatFromRequest(null)).toBe('auto');
	});

	it('a graphic still never resolves to spokesperson — there is no face to animate', () => {
		// The server coerces this case to b-roll; resolving it to spokesperson here
		// would show a pipeline (and a price) the run would not produce.
		expect(formatFromRequest({ media: 'video', format: 'spokesperson', still: 'graphic' })).toBe(
			'product-motion'
		);
	});

	it('round-trips every format through its own request body', () => {
		for (const f of FORMAT_CATALOG) {
			if (f.kind === 'series') continue; // not a generate-post request
			const body = requestFor(f.id);
			// 'auto' is the one that cannot round-trip by construction: it exists so
			// the Director can still choose, and reads back as itself.
			expect(formatFromRequest(body)).toBe(f.id);
		}
	});
});

describe('planPipeline — one pipeline, one price', () => {
	it('prices a spokesperson run as director + still + voiceover + talking head', () => {
		const steps = plan('spokesperson');
		expect(steps.map((s) => s.kind)).toEqual(['director', 'still', 'tts', 'talkinghead']);
		expect(planTotalUsd(steps)).toBeCloseTo(0.002 + 0.08 + 0.03 + 0.7, 4);
	});

	it('a text card costs the Director and nothing else when the host can render it', () => {
		const steps = plan('text-card');
		expect(steps.map((s) => s.kind)).toEqual(['director', 'card']);
		expect(planTotalUsd(steps)).toBeCloseTo(0.002, 4);
	});

	it('bills the storyboard per shot — a single still under-quotes cinematic', () => {
		const four = planTotalUsd(plan('cinematic', { shots: 4 }));
		const two = planTotalUsd(plan('cinematic', { shots: 2 }));
		expect(four - two).toBeCloseTo(0.08 * 2, 4);
		// Out-of-range shot counts clamp rather than producing a nonsense quote.
		expect(planTotalUsd(plan('cinematic', { shots: 99 }))).toBe(
			planTotalUsd(plan('cinematic', { shots: 5 }))
		);
	});

	it('an explicit pick beats the tier lock', () => {
		const steps = plan('product-motion', { tier: 'budget', picks: { video: 'veo' } });
		const video = steps.find((s) => s.kind === 'video')!;
		expect(video.model.id).toBe('veo');
		expect(video.via).toBe('picked');
	});

	it('a tier lock takes the top model INSIDE the tier, not the cheapest overall', () => {
		const premium = plan('product-motion', { tier: 'premium' });
		expect(premium.find((s) => s.kind === 'video')!.model.id).toBe('veo');
		const budget = plan('product-motion', { tier: 'budget' });
		expect(budget.find((s) => s.kind === 'video')!.model.id).toBe('wan');
	});

	it('says so when a tier cannot reach a stage instead of pretending it did', () => {
		// The talking head has exactly one wired model, so "budget everything"
		// genuinely cannot apply to it — the UI has to be able to tell the user.
		const steps = planPipeline({
			formatId: 'spokesperson',
			options: { ...OPTIONS, talkinghead: [model('omnihuman', 0.7, 'premium')] },
			fixed: FIXED,
			tier: 'budget'
		});
		const head = steps.find((s) => s.kind === 'talkinghead')!;
		expect(head.selectable).toBe(false);
		expect(['only', 'nearest']).toContain(head.via);
	});

	it('a supplied still costs nothing and does not run', () => {
		const steps = plan('spokesperson', { supplied: { still: true } });
		const still = steps.find((s) => s.kind === 'still')!;
		expect(still.supplied).toBe(true);
		expect(still.usd).toBe(0);
		// Everything downstream still runs — supplying an input is not skipping a
		// stage, which is why this is the only honest form of "don't run that".
		expect(steps.find((s) => s.kind === 'talkinghead')!.usd).toBeGreaterThan(0);
	});

	it('an unknown format plans nothing rather than guessing', () => {
		expect(plan('does-not-exist')).toEqual([]);
	});
});

describe('craftMatters — the journey is derived, not fixed at four steps', () => {
	it('is false for a format with nothing to choose and nothing to pay', () => {
		const cardOnly = planPipeline({
			formatId: 'text-card',
			options: {},
			fixed: { ...FIXED, director: { id: 'free', label: 'free', usd: 0, provider: 'local' } }
		});
		expect(craftMatters(cardOnly)).toBe(false);
	});

	it('is true as soon as a stage costs money or offers a choice', () => {
		expect(craftMatters(plan('text-card'))).toBe(true); // the Director is billable
		expect(craftMatters(plan('product-motion'))).toBe(true);
	});
});

describe('locally-assembled formats', () => {
	it('files the motion card as a video, not an image', () => {
		// The card is typeset as a still and then animated, but what comes out is a
		// video — and "what comes out" is the axis a user browses by.
		expect(getFormat('motion-card')?.kind).toBe('video');
		expect(getFormat('motion-card')?.video).toBe(true);
	});

	it('marks the ffmpeg-dependent formats so a host without it can hide them', () => {
		// ffmpeg is a soft dependency. Offering a format the host cannot build is
		// exactly the promise the composer exists to prevent.
		expect(getFormat('motion-card')?.needsFfmpeg).toBe(true);
		expect(getFormat('vo-broll')?.needsFfmpeg).toBe(true);
		expect(getFormat('spokesperson')?.needsFfmpeg).toBeFalsy();
		expect(getFormat('photo')?.needsFfmpeg).toBeFalsy();
	});

	it('assembles locally instead of paying a model for the expensive part', () => {
		const card = plan('motion-card');
		expect(card.map((s) => s.kind)).toEqual(['director', 'card', 'motion']);
		// Director only: no image model, no video model.
		expect(planTotalUsd(card)).toBeCloseTo(0.002, 4);

		const vo = plan('vo-broll');
		expect(vo.map((s) => s.kind)).toEqual(['director', 'still', 'tts', 'video', 'mux']);
		// Narration over a clip costs the clip plus the voice — no talking head.
		expect(planTotalUsd(vo)).toBeCloseTo(0.002 + 0.08 + 0.03 + 0.42, 4);
		expect(planTotalUsd(vo)).toBeLessThan(planTotalUsd(plan('spokesperson')));
	});

	it('round-trips the new formats through the legacy request body', () => {
		expect(requestFor('motion-card')).toMatchObject({
			media: 'video',
			format: 'motion_card',
			still: 'graphic'
		});
		expect(requestFor('vo-broll')).toMatchObject({ media: 'video', format: 'vo_broll' });
		expect(formatFromRequest(requestFor('motion-card'))).toBe('motion-card');
		expect(formatFromRequest(requestFor('vo-broll'))).toBe('vo-broll');
	});
});
