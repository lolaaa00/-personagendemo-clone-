import { describe, it, expect } from 'vitest';
import {
	FORMAT_CATALOG,
	FORMAT_KINDS,
	billedUnits,
	billingFor,
	buildableWith,
	craftMatters,
	MIN_ITEMS,
	MAX_ITEMS,
	MAX_SECONDS,
	MIN_SECONDS,
	formatFromRequest,
	formatsOfKind,
	getFormat,
	planPipeline,
	planTotalUsd,
	requestFor,
	type FormatEntry,
	type HostCapability,
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
		expect(getFormat('motion-card')?.requires).toEqual(['ffmpeg']);
		expect(getFormat('vo-broll')?.requires).toEqual(['ffmpeg']);
		expect(getFormat('spokesperson')?.requires).toBeFalsy();
		expect(getFormat('photo')?.requires).toBeFalsy();
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

/**
 * The two generalizations the quote depends on. Both replaced a special case,
 * so the point of these is as much what they DON'T change: every format that
 * billed per call before still quotes to the same number.
 */
describe('host capability gating', () => {
	const ffmpegOnly: HostCapability[] = ['ffmpeg'];

	it('hides a format whose capability the host lacks, and shows it when present', () => {
		const motionCard = getFormat('motion-card')!;
		expect(buildableWith(motionCard, [])).toBe(false);
		expect(buildableWith(motionCard, ffmpegOnly)).toBe(true);
	});

	it('lets a format with no requirement run on a host with nothing', () => {
		// The common case must not need a capability declaration to stay visible.
		expect(buildableWith(getFormat('photo')!, [])).toBe(true);
		expect(buildableWith({ requires: [] }, [])).toBe(true);
	});

	it('fails CLOSED when only part of a multi-capability format is available', () => {
		// Why this is a list and not a boolean: partial support must hide the
		// format, never sell a run that gets halfway and stops.
		const both: Pick<FormatEntry, 'requires'> = { requires: ['ffmpeg', 'videoIngest'] };
		expect(buildableWith(both, ffmpegOnly)).toBe(false);
		expect(buildableWith(both, ['videoIngest'])).toBe(false);
		expect(buildableWith(both, ['ffmpeg', 'videoIngest'])).toBe(true);
	});
});

describe('billing basis', () => {
	const perCall: StepModel = { id: 'm', label: 'M', usd: 0.1, provider: 'fal' };
	const perSecond: StepModel = { ...perCall, billing: 'per_second' };

	it('defaults every stage to per call, so nothing quotes differently', () => {
		expect(billingFor('still', perCall)).toBe('per_call');
		expect(billingFor('video', perCall)).toBe('per_call');
		expect(billedUnits('video', perCall, { formatId: 'product-motion' })).toBe(1);
	});

	it('keeps the storyboard billing per shot — the case that used to be hardcoded', () => {
		expect(billingFor('cine_stills', perCall)).toBe('per_shot');
		const units = (shots?: number) =>
			billedUnits('cine_stills', perCall, { formatId: 'cinematic', shots });
		expect(units(3)).toBe(3);
		expect(units()).toBe(4); // the Director's default shot count
		expect(units(99)).toBe(5); // clamped to the storyboard ceiling
		expect(units(0)).toBe(1); // never free
	});

	it('lets a model override its stage — billing is a fact about the provider', () => {
		// A per-second clip model dropped into a stage whose other models bill per
		// call must quote by duration, or the stage's basis silently misquotes it.
		expect(billingFor('video', perSecond)).toBe('per_second');
		expect(billedUnits('video', perSecond, { formatId: 'product-motion', seconds: 12 })).toBe(12);
	});

	it('quotes an unmeasured per-second stage at the pipeline default, never at zero', () => {
		const units = (seconds?: number) =>
			billedUnits('video', perSecond, { formatId: 'product-motion', seconds });
		expect(units()).toBe(5); // matches UGC_VIDEO_DURATION
		expect(units(0)).toBe(1);
		expect(units(Number.NaN)).toBe(1);
		expect(units(999)).toBe(30); // clamped to the ingest ceiling
	});

	it('multiplies the quoted price by the billed units', () => {
		const steps = planPipeline({
			formatId: 'cinematic',
			shots: 5,
			options: { cine_stills: [perCall] }
		});
		const stills = steps.find((s) => s.kind === 'cine_stills')!;
		expect(stills.usd).toBeCloseTo(0.5, 4);
		expect(stills.model.label).toContain('×5 shots');
	});
});

/**
 * The video-to-video formats. These are the first stages whose price scales with
 * an input the USER supplies, so the invariants worth pinning are about honesty:
 * what is quoted is what runs, and the quote moves with the real clip length.
 */
describe('video-to-video formats', () => {
	const v2vModel: StepModel = {
		id: 'fal-ai/wan/v2.2-14b/animate/replace',
		label: 'Wan Animate · Replace',
		usd: 0.06,
		provider: 'fal',
		billing: 'per_second'
	};
	const v2vPlan = (formatId: string, seconds?: number) =>
		planPipeline({
			formatId,
			options: OPTIONS,
			fixed: { ...FIXED, v2v: v2vModel },
			seconds
		});

	it('quotes the still it actually runs', () => {
		// The engine composites a still on every v2v run — poster frame, and the
		// anchor the never-brick i2v fallback re-performs from. Dropping it from
		// the steps would bill an image the quote never mentioned.
		for (const id of ['reel-remake', 'motion-transfer']) {
			expect(getFormat(id)!.steps).toContain('still');
			expect(v2vPlan(id).map((s) => s.kind)).toEqual(['director', 'still', 'v2v']);
		}
	});

	it('prices the transfer by the measured clip length, not per call', () => {
		const at = (secs: number) => v2vPlan('reel-remake', secs).find((s) => s.kind === 'v2v')!.usd;
		expect(at(10)).toBeCloseTo(0.6, 4);
		expect(at(20)).toBeCloseTo(1.2, 4);
		// Twice the clip is twice the money — the property a flat per-call quote
		// would have got wrong by however long the clip is.
		expect(at(20)).toBeCloseTo(at(10) * 2, 4);
	});

	it('clamps to the ingest bounds so a quote can never promise what ingest refuses', () => {
		const at = (secs?: number) => v2vPlan('reel-remake', secs).find((s) => s.kind === 'v2v')!.usd;
		expect(at(999)).toBeCloseTo(0.06 * MAX_SECONDS, 4);
		expect(at(0)).toBeCloseTo(0.06 * MIN_SECONDS, 4);
		// No measured duration yet (nothing uploaded) still quotes something real.
		expect(at()).toBeGreaterThan(0);
	});

	it('never quotes LESS than the run will bill, at any clip length', () => {
		// The engine charges the MEASURED duration including its fraction
		// (12.4s x rate). The quote works in whole units, so it must round UP:
		// rounding 12.4 down to 12 would quote $0.72 and then bill $0.744, and a
		// bill that exceeds its own quote is the exact dishonesty the shared
		// pipeline exists to prevent. This pins the INVARIANT (quote >= bill), not
		// the arithmetic, so it still holds if either side changes how it rounds.
		for (const secs of [0.4, 1, 2.6, 9.99, 10, 12.4, 12.5, 17.001, 29.7, 30, 45]) {
			const quotedUnits = billedUnits('v2v', v2vModel, { formatId: 'reel-remake', seconds: secs });
			const billedSecs = Math.min(Math.max(secs, MIN_SECONDS), MAX_SECONDS);
			expect(quotedUnits).toBeGreaterThanOrEqual(billedSecs);
		}
	});

	it('needs a source clip and the host capability to ingest one', () => {
		for (const id of ['reel-remake', 'motion-transfer']) {
			const f = getFormat(id)!;
			expect(f.needs).toContain('sourceVideo');
			expect(f.requires).toContain('videoIngest');
			expect(buildableWith(f, ['ffmpeg'])).toBe(false);
		}
		// Move's output follows the REFERENCE aspect, so it needs a reframe pass
		// that Replace does not — that is a real capability difference, not a copy
		// of the same list.
		expect(getFormat('motion-transfer')!.requires).toContain('ffmpeg');
		expect(getFormat('reel-remake')!.requires).not.toContain('ffmpeg');
		expect(buildableWith(getFormat('reel-remake')!, ['videoIngest'])).toBe(true);
	});
});

describe('listicle — a format that makes one stage run many times', () => {
	const tts: StepModel = { id: 'eleven', label: 'eleven', usd: 0.03, provider: 'fal' };
	const lp = (items?: number) =>
		planPipeline({ formatId: 'listicle', options: OPTIONS, fixed: { ...FIXED, tts }, items });

	it('bills the voiceover per beat, not once for the whole script', () => {
		// The reveals can only be TIMED if each beat is generated separately, so
		// the run really does make N calls. Quoting one would under-charge every
		// listicle by N-1 voiceovers.
		expect(billingFor('tts', tts, getFormat('listicle'))).toBe('per_item');
		expect(lp(4).find((s) => s.kind === 'tts')!.usd).toBeCloseTo(0.12, 4);
		// Two beats is a hook plus ONE item — not a list — so the floor is three.
		expect(lp(2).find((s) => s.kind === 'tts')!.usd).toBeCloseTo(0.03 * MIN_ITEMS, 4);
	});

	it('leaves every other format quoting the voiceover exactly as before', () => {
		// The override is scoped to the format that needs it. Spokesperson shares
		// the stage AND the model, and must be untouched.
		expect(billingFor('tts', tts, getFormat('spokesperson'))).toBe('per_call');
		const spoken = planPipeline({
			formatId: 'spokesperson',
			options: OPTIONS,
			fixed: { ...FIXED, tts }
		});
		expect(spoken.find((s) => s.kind === 'tts')!.usd).toBeCloseTo(0.03, 4);
	});

	it('clamps the beat count so a quote is never zero or unbounded', () => {
		expect(lp(99).find((s) => s.kind === 'tts')!.usd).toBeCloseTo(0.03 * MAX_ITEMS, 4);
		expect(lp(0).find((s) => s.kind === 'tts')!.usd).toBeCloseTo(0.03 * MIN_ITEMS, 4);
		expect(lp().find((s) => s.kind === 'tts')!.usd).toBeGreaterThan(0);
	});

	it('needs its list, and a host that can burn the reveals', () => {
		const f = getFormat('listicle')!;
		expect(f.needs).toContain('listItems');
		expect(f.requires).toContain('ffmpeg');
		// No ffmpeg means the list cannot be drawn — that is not a degraded
		// listicle, it is a talking head reading numbers nobody can see.
		expect(buildableWith(f, [])).toBe(false);
		expect(buildableWith(f, ['ffmpeg'])).toBe(true);
	});
});

describe('listicle bounds are one source of truth', () => {
	it('a beat count is a hook PLUS items, so two is not a list', () => {
		// The engine needs at least two ITEMS. Beats include the hook, so the
		// floor is three. Offering a 2 that the engine then serves as a plain
		// spokesperson is exactly the offered-then-degraded promise the catalog
		// exists to prevent.
		expect(MIN_ITEMS).toBe(3);
		expect(MAX_ITEMS).toBeGreaterThan(MIN_ITEMS);
	});

	it('clamps to the exported range, which every caller shares', () => {
		const units = (items?: number) =>
			billedUnits(
				'tts',
				{ billing: undefined },
				{ formatId: 'listicle', items },
				getFormat('listicle')
			);
		expect(units(1)).toBe(MIN_ITEMS);
		expect(units(999)).toBe(MAX_ITEMS);
		expect(units(4)).toBe(4);
	});
});
