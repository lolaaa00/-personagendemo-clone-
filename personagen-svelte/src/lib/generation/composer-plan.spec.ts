/**
 * The composer's pure field-plan and payload builder.
 *
 * The Svelte component renders from `composerFieldPlan` and submits ONLY what
 * `buildComposerPayload` returns — so "which controls exist" and "what gets
 * sent" are testable without a DOM, and stale hidden UI state can never ride
 * into a request the operation's contract does not allow.
 */
import { describe, it, expect } from 'vitest';
import {
	resolveStudioContract,
	resolveGenericContract
} from './contracts';
import {
	composerFieldPlan,
	resolveComposerDelivery,
	buildComposerPayload,
	type ComposerPayloadState
} from './composer-plan';

const baseState: ComposerPayloadState = {
	topic: 'a topic',
	scene: 'a scene',
	media: 'video',
	format: 'auto',
	provider: 'fal',
	captions: true,
	aiBadge: true,
	platforms: ['instagram'],
	productId: 'p1',
	productPhotoUrl: 'https://x/p.jpg',
	characterRefUrl: 'https://x/c.jpg',
	scheduledDate: '2026-09-01',
	scheduledTime: '10:00',
	model: '',
	videoModel: 'kling'
};

describe('composerFieldPlan — a control that cannot change the run is not shown', () => {
	it('graphic text card: no media/format/refs/video-model/caption controls', () => {
		const plan = composerFieldPlan(resolveStudioContract('quote-card')!, 'review');
		expect(plan.mediaSelect).toBe(false);
		expect(plan.formatChips).toBe(false);
		expect(plan.captions).toBe(false);
		expect(plan.aiBadge).toBe(false);
		expect(plan.productPicker).toBe(false);
		expect(plan.productUrl).toBe(false);
		expect(plan.characterUrl).toBe(false);
		expect(plan.videoModel).toBe(false);
		expect(plan.platforms).toBe(true);
		expect(plan.schedule).toBe(true);
		expect(plan.operationSummary).toBeTruthy();
	});

	it('character-only selfie still: character control only', () => {
		const plan = composerFieldPlan(resolveStudioContract('lifestyle-still')!, 'review');
		expect(plan.characterUrl).toBe(true);
		expect(plan.productPicker).toBe(false);
		expect(plan.productUrl).toBe(false);
		expect(plan.captions).toBe(false); // image output — nothing to burn onto
		expect(plan.videoModel).toBe(false);
	});

	it('product-only motion: product controls only, no spokesperson available', () => {
		const plan = composerFieldPlan(resolveStudioContract('hyper-motion')!, 'review');
		expect(plan.productPicker).toBe(true);
		expect(plan.productUrl).toBe(true);
		expect(plan.characterUrl).toBe(false);
		expect(plan.spokespersonOption).toBe(false);
		expect(plan.videoModel).toBe(true); // the b-roll model IS this run's engine
		expect(plan.captions).toBe(true);
		expect(plan.formatChips).toBe(false); // locked to Product motion
	});

	it('no-reference photo still (mood board): no reference controls at all', () => {
		const plan = composerFieldPlan(resolveStudioContract('mood-board')!, 'review');
		expect(plan.characterUrl).toBe(false);
		expect(plan.productUrl).toBe(false);
		expect(plan.spokespersonOption).toBe(false);
	});

	it('locked talking head: no format chips, no b-roll model picker', () => {
		const plan = composerFieldPlan(resolveStudioContract('the-rant')!, 'review');
		expect(plan.formatChips).toBe(false);
		expect(plan.videoModel).toBe(false);
		expect(plan.characterUrl).toBe(true);
		expect(plan.productUrl).toBe(false);
	});

	it('cinematic: provider pinned (fal-only), both reference controls, captions apply', () => {
		const plan = composerFieldPlan(resolveStudioContract('tv-spot')!, 'review');
		expect(plan.provider).toBe(false);
		expect(plan.productUrl).toBe(true);
		expect(plan.characterUrl).toBe(true);
		expect(plan.captions).toBe(true);
		expect(plan.mediaSelect).toBe(false);
	});

	it('generic post keeps full flexibility', () => {
		const plan = composerFieldPlan(resolveGenericContract({ media: 'video' }), 'publish-flow');
		expect(plan.mediaSelect).toBe(true);
		expect(plan.formatChips).toBe(true);
		expect(plan.spokespersonOption).toBe(true);
		expect(plan.productUrl).toBe(true);
		expect(plan.characterUrl).toBe(true);
		expect(plan.platforms).toBe(true);
		expect(plan.schedule).toBe(true);
	});

	it('generic image variant hides video-only controls', () => {
		const plan = composerFieldPlan(resolveGenericContract({ media: 'image' }), 'publish-flow');
		expect(plan.formatChips).toBe(false);
		expect(plan.captions).toBe(false);
		expect(plan.videoModel).toBe(false);
	});

	it('standalone-asset delivery hides publish and schedule controls', () => {
		const plan = composerFieldPlan(resolveStudioContract('quote-card')!, 'asset');
		expect(plan.platforms).toBe(false);
		expect(plan.schedule).toBe(false);
	});
});

describe('resolveComposerDelivery — the outcome is explicit, never inferred', () => {
	it('studio operations follow the Output toggle and default to review', () => {
		const studio = resolveStudioContract('quote-card')!;
		expect(resolveComposerDelivery('asset', studio, true, 1)).toBe('asset');
		expect(resolveComposerDelivery('review', studio, true, 1)).toBe('review');
		expect(resolveComposerDelivery(undefined, studio, true, 1)).toBe('review');
	});

	it('generic: platforms selected → publish flow; none → explicit draft', () => {
		const generic = resolveGenericContract({});
		expect(resolveComposerDelivery(undefined, generic, true, 2)).toBe('publish-flow');
		expect(resolveComposerDelivery(undefined, generic, true, 0)).toBe('draft');
		expect(resolveComposerDelivery(undefined, generic, false, 0)).toBe('draft');
	});
});

describe('buildComposerPayload — whitelisted, contract-shaped submission', () => {
	it('a graphic card submits NO product, character, video-model, or caption state', () => {
		const contract = resolveStudioContract('quote-card')!;
		const baseBody = { studio_template: 'quote-card', deliver: 'review', media: 'image', still: 'graphic' };
		const body = buildComposerPayload(baseBody, contract, 'review', baseState);
		expect(body.product_id).toBeUndefined();
		expect(body.product_photo_url).toBeUndefined();
		expect(body.character_ref_url).toBeUndefined();
		expect(body.video_model).toBeUndefined();
		expect(body.captions).toBeUndefined();
		expect(body.ai_badge).toBeUndefined();
		expect(body.media).toBe('image');
		expect(body.still).toBe('graphic');
		expect(body.deliver).toBe('review');
		expect(body.topic).toBe('a topic');
		expect(body.platforms).toEqual(['instagram']); // review keeps destinations
	});

	it('a locked talking head submits its contract format even if state says b-roll', () => {
		const contract = resolveStudioContract('the-rant')!;
		const body = buildComposerPayload(
			{ studio_template: 'the-rant', deliver: 'review' },
			contract,
			'review',
			{ ...baseState, format: 'broll' }
		);
		expect(body.format).toBe('spokesperson');
		expect(body.media).toBe('video');
		expect(body.video_model).toBeUndefined();
		expect(body.character_ref_url).toBe('https://x/c.jpg');
		expect(body.product_id).toBeUndefined();
	});

	it('product-only motion submits product state but never character state', () => {
		const contract = resolveStudioContract('hyper-motion')!;
		const body = buildComposerPayload(
			{ studio_template: 'hyper-motion', deliver: 'review' },
			contract,
			'review',
			baseState
		);
		expect(body.product_id).toBe('p1');
		expect(body.product_photo_url).toBe('https://x/p.jpg');
		expect(body.character_ref_url).toBeUndefined();
		expect(body.video_model).toBe('kling');
	});

	it('generic post keeps every editable field, including an explicit empty platform set', () => {
		const contract = resolveGenericContract({ media: 'video' });
		const body = buildComposerPayload({}, contract, 'publish-flow', baseState);
		expect(body.media).toBe('video');
		expect(body.format).toBe('auto');
		expect(body.provider).toBe('fal');
		expect(body.captions).toBe(true);
		expect(body.product_id).toBe('p1');
		expect(body.character_ref_url).toBe('https://x/c.jpg');
		expect(body.scheduled_date).toBe('2026-09-01');
		expect(body.deliver).toBe('publish');

		const drafted = buildComposerPayload({}, contract, 'draft', {
			...baseState,
			platforms: []
		});
		expect(drafted.platforms).toEqual([]);
		expect(drafted.deliver).toBe('draft');
	});

	it('asset delivery omits platform and schedule state entirely', () => {
		const contract = resolveStudioContract('quote-card')!;
		const body = buildComposerPayload(
			{ studio_template: 'quote-card', deliver: 'asset' },
			contract,
			'asset',
			baseState
		);
		expect(body.deliver).toBe('asset');
		expect(body.platforms).toBeUndefined();
		expect(body.scheduled_date).toBeUndefined();
		expect(body.scheduled_time).toBeUndefined();
	});

	it('prompt-kind composers submit the prompt and model only', () => {
		const contract = resolveGenericContract({});
		const body = buildComposerPayload({ stage: 'side_profiles' }, contract, 'publish-flow', {
			...baseState,
			isPromptKind: true,
			prompt: 'the edited prompt',
			model: 'nano'
		});
		expect(body.stage).toBe('side_profiles');
		expect(body.prompt).toBe('the edited prompt');
		expect(body.model).toBe('nano');
		expect(body.topic).toBeUndefined();
		expect(body.media).toBeUndefined();
		expect(body.platforms).toBeUndefined();
	});
});
