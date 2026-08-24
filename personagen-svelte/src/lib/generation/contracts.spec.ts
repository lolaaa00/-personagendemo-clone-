/**
 * Operation-contract resolver — the single authoritative description of what
 * each composer operation IS: media kind, format, still style, reference
 * policy, product semantic-context policy, field applicability, delivery.
 *
 * These tests iterate the REAL Studio catalog: every one of its templates must
 * resolve explicitly and deterministically, and the catalog itself must be
 * truthful (a channel operation never feeds or references a product).
 */
import { describe, it, expect } from 'vitest';
import { STUDIO_TEMPLATES } from '$lib/studio-templates';
import {
	OPERATION_CONTRACT_VERSION,
	resolveStudioContract,
	resolveGenericContract,
	resolveOperationContract,
	normalizeGenerationBody,
	normalizePlatforms,
	resolveDeliveryPolicy,
	selectRunProduct,
	resolveRunFormat,
	campaignEligibility,
	operationProvenance
} from './contracts';

const EXPECTED_MEDIA_BY_SURFACE = {
	motion: 'video',
	photo: 'image',
	cinematic: 'cinematic',
	typographic: 'image'
} as const;

/** The same prose heuristic the composer audit uses for product dependence. */
const PRODUCT_PROSE =
	/\b(featured product|product (?:as|in|at|matters|category)|ties? (?:it )?to the product)\b/i;

describe('resolveStudioContract — full catalog', () => {
	it('resolves every template in the catalog (all 41)', () => {
		expect(STUDIO_TEMPLATES.length).toBe(41);
		for (const t of STUDIO_TEMPLATES) {
			const c = resolveStudioContract(t.id);
			expect(c, t.id).not.toBeNull();
			expect(c!.kind).toBe('studio');
			expect(c!.operationId).toBe(t.id);
			expect(c!.version).toBe(OPERATION_CONTRACT_VERSION);
		}
	});

	it('is deterministic — resolving twice yields identical contracts', () => {
		for (const t of STUDIO_TEMPLATES) {
			expect(resolveStudioContract(t.id)).toEqual(resolveStudioContract(t.id));
		}
	});

	it('returns null for an unknown operation instead of guessing', () => {
		expect(resolveStudioContract('not-a-template')).toBeNull();
	});

	it('actual media matches the advertised surface for every template', () => {
		for (const t of STUDIO_TEMPLATES) {
			const c = resolveStudioContract(t.id)!;
			expect(c.media, `${t.id} surface=${t.surface}`).toBe(EXPECTED_MEDIA_BY_SURFACE[t.surface]);
		}
	});

	it('pipeline chip matches the machinery that runs', () => {
		for (const t of STUDIO_TEMPLATES) {
			const c = resolveStudioContract(t.id)!;
			if (t.pipeline === 'Talking head') {
				expect(c.media, t.id).toBe('video');
				expect(c.format, t.id).toBe('spokesperson');
			} else if (t.pipeline === 'Product motion') {
				expect(c.media, t.id).toBe('video');
				expect(c.format, t.id).toBe('broll');
			} else if (t.pipeline === 'Cinematic') {
				expect(c.media, t.id).toBe('cinematic');
			} else if (t.pipeline === 'Text card') {
				expect(c.media, t.id).toBe('image');
				expect(c.still, t.id).toBe('graphic');
			} else if (t.pipeline === 'Still image') {
				expect(c.media, t.id).toBe('image');
				expect(c.still, t.id).toBe('photo');
			}
		}
	});

	it('typographic cards feed NO references and carry no product context', () => {
		for (const t of STUDIO_TEMPLATES.filter((x) => x.surface === 'typographic')) {
			const c = resolveStudioContract(t.id)!;
			expect(c.still, t.id).toBe('graphic');
			expect(c.characterRef, t.id).toBe(false);
			expect(c.productRef, t.id).toBe(false);
			expect(c.productContext, t.id).toBe(false);
		}
	});

	it('a channel operation never feeds a product reference or product context', () => {
		for (const t of STUDIO_TEMPLATES.filter((x) => x.intent === 'channel')) {
			const c = resolveStudioContract(t.id)!;
			expect(c.productRef, `${t.id} is channel but feeds a product reference`).toBe(false);
			expect(c.productContext, `${t.id} is channel but allows product context`).toBe(false);
		}
	});

	it('channel template copy never depends on a product', () => {
		for (const t of STUDIO_TEMPLATES.filter((x) => x.intent === 'channel')) {
			const prose = `${t.baseBody.topic}\n${t.baseBody.scene ?? ''}`;
			expect(PRODUCT_PROSE.test(prose), `${t.id} channel copy depends on a product`).toBe(false);
		}
	});

	it('cinematic operations are brand: the generator hard-requires a product photo', () => {
		for (const t of STUDIO_TEMPLATES.filter((x) => x.surface === 'cinematic')) {
			const c = resolveStudioContract(t.id)!;
			expect(t.intent, `${t.id} advertises product-free cinematic`).toBe('brand');
			expect(c.characterRef, t.id).toBe(true);
			expect(c.productRef, t.id).toBe(true);
			expect(c.productContext, t.id).toBe(true);
		}
	});

	it('a spokesperson operation always has a character reference (a face to animate)', () => {
		for (const t of STUDIO_TEMPLATES) {
			const c = resolveStudioContract(t.id)!;
			if (c.media === 'video' && c.format === 'spokesperson') {
				expect(c.characterRef, t.id).toBe(true);
				expect(c.spokespersonEligible, t.id).toBe(true);
			}
		}
	});

	it('product-only motion excludes the persona and cannot be a spokesperson', () => {
		for (const t of STUDIO_TEMPLATES.filter((x) => x.pipeline === 'Product motion')) {
			const c = resolveStudioContract(t.id)!;
			expect(c.characterRef, t.id).toBe(false);
			expect(c.productRef, t.id).toBe(true);
			expect(c.spokespersonEligible, t.id).toBe(false);
		}
	});

	it('brand intent grants product context; channel denies it — for every template', () => {
		for (const t of STUDIO_TEMPLATES) {
			const c = resolveStudioContract(t.id)!;
			expect(c.productContext, t.id).toBe(t.intent === 'brand');
		}
	});

	it('control applicability: video model, captions, provider', () => {
		for (const t of STUDIO_TEMPLATES) {
			const c = resolveStudioContract(t.id)!;
			// The i2v picker only matters when the run actually feeds an i2v model.
			expect(c.videoModelApplies, t.id).toBe(c.media === 'video' && c.format === 'broll');
			// Captions/badge burn onto video output only (cinematic honors them too).
			expect(c.captionsApply, t.id).toBe(c.media !== 'image');
			// Cinematic is fal-exclusive — a provider choice there has no effect.
			expect(c.providerApplies, t.id).toBe(c.media !== 'cinematic');
		}
	});

	it('studio operations lock media/format and only deliver to review or asset', () => {
		for (const t of STUDIO_TEMPLATES) {
			const c = resolveStudioContract(t.id)!;
			expect(c.lockMedia, t.id).toBe(true);
			expect(c.lockFormat, t.id).toBe(true);
			expect(c.allowedDelivery, t.id).toEqual(['review', 'asset']);
		}
	});

	it('expected result kind is derivable and truthful', () => {
		expect(resolveStudioContract('quote-card')!.resultKind).toBe('graphic-image');
		expect(resolveStudioContract('lifestyle-still')!.resultKind).toBe('photo-image');
		expect(resolveStudioContract('the-rant')!.resultKind).toBe('video');
		expect(resolveStudioContract('tv-spot')!.resultKind).toBe('cinematic-video');
	});
});

describe('resolveGenericContract — legacy/plain composer variants', () => {
	it('default request is the legacy flexible video operation', () => {
		const c = resolveGenericContract({});
		expect(c.kind).toBe('generic');
		expect(c.operationId).toBe('generic-post');
		expect(c.media).toBe('video');
		expect(c.format).toBe('auto');
		expect(c.characterRef).toBe(true);
		expect(c.productRef).toBe(true);
		expect(c.productContext).toBe(true);
		expect(c.lockMedia).toBe(false);
		expect(c.lockFormat).toBe(false);
	});

	it('a variant switch resolves the COMPLETE variant contract, not stale refs', () => {
		// Cinematic composites both references — switching to it must say so
		// even if the previous variant excluded them.
		const cin = resolveGenericContract({ media: 'cinematic', refs: { character: false, product: false } });
		expect(cin.media).toBe('cinematic');
		expect(cin.characterRef).toBe(true);
		expect(cin.productRef).toBe(true);
		expect(cin.format).toBeNull();
		expect(cin.providerApplies).toBe(false);
		expect(cin.videoModelApplies).toBe(false);
	});

	it('image-only variant: no video controls, captions do not apply', () => {
		const img = resolveGenericContract({ media: 'image' });
		expect(img.media).toBe('image');
		expect(img.format).toBeNull();
		expect(img.videoModelApplies).toBe(false);
		expect(img.captionsApply).toBe(false);
		expect(img.resultKind).toBe('photo-image');
	});

	it('a graphic still excludes references exactly like the pipeline does', () => {
		const g = resolveGenericContract({ media: 'image', still: 'graphic' });
		expect(g.still).toBe('graphic');
		expect(g.characterRef).toBe(false);
		expect(g.productRef).toBe(false);
		expect(g.resultKind).toBe('graphic-image');
	});

	it('an explicit persona-free video variant cannot be a spokesperson', () => {
		const v = resolveGenericContract({
			media: 'video',
			format: 'spokesperson',
			refs: { character: false, product: true }
		});
		expect(v.characterRef).toBe(false);
		expect(v.spokespersonEligible).toBe(false);
		// The resolved format must not claim a talking head it cannot run.
		expect(v.format).toBe('broll');
	});

	it('generic contracts never masquerade as studio contracts', () => {
		const c = resolveGenericContract({ media: 'video' });
		expect(c.kind).toBe('generic');
		expect(c.lockMedia).toBe(false);
		expect(c.allowedDelivery).toContain('publish-flow');
	});
});

describe('resolveOperationContract — dispatch', () => {
	it('routes a studio_template body to its catalog contract', () => {
		const c = resolveOperationContract({ studio_template: 'quote-card', media: 'video' });
		expect(c.kind).toBe('studio');
		expect(c.operationId).toBe('quote-card');
		// The catalog contract wins over a client-mutated media field.
		expect(c.media).toBe('image');
	});

	it('an unknown studio_template falls back to an explicit generic contract', () => {
		const c = resolveOperationContract({ studio_template: 'deleted-template', media: 'image' });
		expect(c.kind).toBe('generic');
		expect(c.media).toBe('image');
	});

	it('a plain body resolves generic', () => {
		expect(resolveOperationContract({}).kind).toBe('generic');
	});
});

describe('normalizeGenerationBody — the server trusts the contract, not the client', () => {
	it('a locked Studio text card cannot be mutated into a video with references', () => {
		const { contract, body } = normalizeGenerationBody({
			studio_template: 'quote-card',
			media: 'video',
			format: 'spokesperson',
			still: 'photo',
			refs: { character: true, product: true },
			product_id: 'p1',
			product_photo_url: 'https://x/p.jpg',
			character_ref_url: 'https://x/c.jpg',
			video_model: 'kling',
			captions: true,
			ai_badge: true
		});
		expect(contract.operationId).toBe('quote-card');
		expect(body.media).toBe('image');
		expect(body.still).toBe('graphic');
		expect(body.refs).toEqual({ character: false, product: false });
		expect(body.product_id).toBeUndefined();
		expect(body.product_photo_url).toBeUndefined();
		expect(body.character_ref_url).toBeUndefined();
		expect(body.video_model).toBeUndefined();
		expect(body.captions).toBe(false);
		expect(body.ai_badge).toBe(false);
	});

	it('a Studio talking head cannot be flipped to b-roll by a client override', () => {
		const { body } = normalizeGenerationBody({ studio_template: 'the-rant', format: 'broll' });
		expect(body.media).toBe('video');
		expect(body.format).toBe('spokesperson');
	});

	it('a product-free channel operation drops the hidden product id AND photo', () => {
		const { body } = normalizeGenerationBody({
			studio_template: 'lifestyle-still',
			product_id: 'stale-from-preview',
			product_photo_url: 'https://x/p.jpg'
		});
		expect(body.product_id).toBeUndefined();
		expect(body.product_photo_url).toBeUndefined();
		expect(body.character_ref_url).toBeUndefined(); // none was sent
	});

	it('a product-only operation keeps product fields but drops character overrides', () => {
		const { contract, body } = normalizeGenerationBody({
			studio_template: 'hyper-motion',
			product_id: 'p1',
			character_ref_url: 'https://x/c.jpg'
		});
		expect(contract.characterRef).toBe(false);
		expect(body.product_id).toBe('p1');
		expect(body.character_ref_url).toBeUndefined();
	});

	it('cinematic ignores the provider preference (fal-exclusive pipeline)', () => {
		const { body } = normalizeGenerationBody({ studio_template: 'tv-spot', provider: 'openrouter' });
		expect(body.provider).toBeUndefined();
	});

	it('generic requests keep their flexibility — nothing is stripped for a plain video', () => {
		const raw = {
			topic: 'hello',
			media: 'video',
			format: 'auto',
			provider: 'fal',
			product_id: 'p1',
			product_photo_url: 'https://x/p.jpg',
			character_ref_url: 'https://x/c.jpg',
			video_model: 'kling',
			captions: true,
			platforms: ['instagram']
		};
		const { contract, body } = normalizeGenerationBody(raw);
		expect(contract.kind).toBe('generic');
		expect(body.topic).toBe('hello');
		expect(body.provider).toBe('fal');
		expect(body.product_id).toBe('p1');
		expect(body.character_ref_url).toBe('https://x/c.jpg');
		expect(body.video_model).toBe('kling');
		expect(body.captions).toBe(true);
	});

	it('a generic image-only run drops video-only controls and caption flags', () => {
		const { body } = normalizeGenerationBody({ media: 'image', video_model: 'kling', captions: true });
		expect(body.video_model).toBeUndefined();
		expect(body.captions).toBe(false);
	});

	it('asset delivery strips publish/schedule fields the outcome ignores', () => {
		const { body, delivery } = normalizeGenerationBody({
			studio_template: 'quote-card',
			deliver: 'asset',
			platforms: ['instagram'],
			scheduled_date: '2026-09-01',
			scheduled_time: '10:00'
		});
		expect(delivery).toBe('asset');
		expect(body.platforms).toEqual([]);
		expect(body.scheduled_date).toBeUndefined();
		expect(body.scheduled_time).toBeUndefined();
	});

	it('review delivery keeps its calendar slot and destinations (campaign contract)', () => {
		const { body, delivery } = normalizeGenerationBody({
			studio_template: 'the-rant',
			deliver: 'review',
			platforms: ['instagram'],
			scheduled_date: '2026-09-01',
			scheduled_time: '10:00'
		});
		expect(delivery).toBe('review');
		expect(body.platforms).toEqual(['instagram']);
		expect(body.scheduled_date).toBe('2026-09-01');
	});
});

describe('resolveDeliveryPolicy', () => {
	it('a Studio operation can never publish directly — publish clamps to review', () => {
		const studio = resolveStudioContract('quote-card')!;
		expect(resolveDeliveryPolicy('publish', studio)).toBe('review');
		expect(resolveDeliveryPolicy(undefined, studio)).toBe('review');
		expect(resolveDeliveryPolicy('asset', studio)).toBe('asset');
		expect(resolveDeliveryPolicy('review', studio)).toBe('review');
	});

	it('generic keeps legacy behavior: absent means the publish flow', () => {
		const generic = resolveGenericContract({});
		expect(resolveDeliveryPolicy(undefined, generic)).toBe('publish-flow');
		expect(resolveDeliveryPolicy('publish', generic)).toBe('publish-flow');
		expect(resolveDeliveryPolicy('draft', generic)).toBe('draft');
		expect(resolveDeliveryPolicy('review', generic)).toBe('review');
		expect(resolveDeliveryPolicy('nonsense', generic)).toBe('publish-flow');
	});
});

describe('normalizePlatforms — explicit empty stays empty', () => {
	const connected = ['instagram', 'tiktok'];

	it('an absent field returns null (caller may use its defaults)', () => {
		expect(normalizePlatforms(undefined, connected)).toBeNull();
		expect(normalizePlatforms('instagram', connected)).toBeNull();
	});

	it('an explicit empty array NEVER expands to all connected platforms', () => {
		expect(normalizePlatforms([], connected)).toEqual([]);
	});

	it('invalid or unconnected values are filtered, never expanded', () => {
		expect(normalizePlatforms(['myspace', 'instagram'], connected)).toEqual(['instagram']);
		expect(normalizePlatforms(['myspace'], connected)).toEqual([]);
		expect(normalizePlatforms([42, null, 'tiktok'], connected)).toEqual(['tiktok']);
	});

	it('platform names are case-normalized against connections', () => {
		expect(normalizePlatforms(['Instagram', 'TIKTOK'], connected)).toEqual([
			'instagram',
			'tiktok'
		]);
	});
});

describe('selectRunProduct — product semantic context is a policy, not an accident', () => {
	const products = [
		{ id: 'a', name: 'No-photo first', photoUrl: null },
		{ id: 'b', name: 'Has photo', photoUrl: 'https://x/b.jpg' },
		{ id: 'c', name: 'Also photo', photoUrl: 'https://x/c.jpg' }
	];

	it('a product-free operation NEVER auto-selects a product, even with a brand brief', () => {
		expect(selectRunProduct(products, undefined, false)).toBeNull();
		// Even a stray explicit id must not smuggle product context in.
		expect(selectRunProduct(products, 'b', false)).toBeNull();
	});

	it('brand/legacy behavior is retained: requested id, else first with a photo, else first', () => {
		expect(selectRunProduct(products, 'c', true)?.id).toBe('c');
		expect(selectRunProduct(products, undefined, true)?.id).toBe('b');
		expect(selectRunProduct([{ id: 'a', name: 'x', photoUrl: null }], undefined, true)?.id).toBe(
			'a'
		);
	});

	it('an unknown requested id resolves to nothing rather than a silent substitute', () => {
		expect(selectRunProduct(products, 'missing', true)).toBeNull();
	});

	it('an empty catalog resolves to nothing', () => {
		expect(selectRunProduct([], undefined, true)).toBeNull();
	});
});

describe('resolveRunFormat — the talking-head branch requires a face contract', () => {
	it('auto defers to the Director, biased to spokesperson', () => {
		expect(resolveRunFormat('auto', 'broll', 'photo', true).format).toBe('broll');
		expect(resolveRunFormat('auto', 'spokesperson', 'photo', true).format).toBe('spokesperson');
		expect(resolveRunFormat('auto', undefined, 'photo', true).format).toBe('spokesperson');
	});

	it('an explicit preference wins over the Director', () => {
		expect(resolveRunFormat('broll', 'spokesperson', 'photo', true).format).toBe('broll');
		expect(resolveRunFormat('spokesperson', 'broll', 'photo', true).format).toBe('spokesperson');
	});

	it('a graphic card has no face to animate — spokesperson coerces to b-roll', () => {
		const r = resolveRunFormat('spokesperson', undefined, 'graphic', false);
		expect(r.format).toBe('broll');
		expect(r.coerced).toBe('graphic-still');
	});

	it('a composition that EXCLUDES the persona cannot run a talking head', () => {
		const r = resolveRunFormat('spokesperson', undefined, 'photo', false);
		expect(r.format).toBe('broll');
		expect(r.coerced).toBe('no-character');
		// auto + Director picking spokesperson is coerced the same way.
		expect(resolveRunFormat('auto', 'spokesperson', 'photo', false).format).toBe('broll');
	});

	it('b-roll is unaffected by the character policy', () => {
		const r = resolveRunFormat('broll', undefined, 'photo', false);
		expect(r.format).toBe('broll');
		expect(r.coerced).toBeNull();
	});
});

describe('campaignEligibility — slots preflight their reference requirements', () => {
	it('without a product photo, product-compositing and cinematic slots are excluded', () => {
		const avail = { hasProductPhoto: false };
		expect(campaignEligibility('tv-spot', avail).eligible).toBe(false);
		expect(campaignEligibility('wild-card', avail).eligible).toBe(false);
		expect(campaignEligibility('hyper-motion', avail).eligible).toBe(false);
		expect(campaignEligibility('before-after-still', avail).eligible).toBe(false);
		expect(campaignEligibility('creator-recommendation', avail).eligible).toBe(false);
	});

	it('channel slots stay eligible without any product (their contract needs none)', () => {
		const avail = { hasProductPhoto: false };
		expect(campaignEligibility('quote-card', avail).eligible).toBe(true);
		expect(campaignEligibility('the-rant', avail).eligible).toBe(true);
		// Character references auto-generate server-side (pinned face), so a
		// character-only slot never needs preflight material.
		expect(campaignEligibility('lifestyle-still', avail).eligible).toBe(true);
	});

	it('with a product photo, every catalog template is eligible', () => {
		for (const t of STUDIO_TEMPLATES) {
			expect(campaignEligibility(t.id, { hasProductPhoto: true }).eligible, t.id).toBe(true);
		}
	});

	it('an unknown template is never silently substituted', () => {
		const r = campaignEligibility('deleted-template', { hasProductPhoto: true });
		expect(r.eligible).toBe(false);
	});
});

describe('operationProvenance — result forensics stamped into content JSON', () => {
	it('captures operation id/version, expected result kind, reference policy, delivery', () => {
		const p = operationProvenance(resolveStudioContract('quote-card')!, 'review');
		expect(p).toEqual({
			id: 'quote-card',
			version: 1,
			expect: 'graphic-image',
			refs: { character: false, product: false, productContext: false },
			deliver: 'review'
		});
	});

	it('generic runs are stamped as generic-post with their variant expectation', () => {
		const p = operationProvenance(resolveGenericContract({ media: 'cinematic' }), 'publish-flow');
		expect(p.id).toBe('generic-post');
		expect(p.expect).toBe('cinematic-video');
		expect(p.refs).toEqual({ character: true, product: true, productContext: true });
		expect(p.deliver).toBe('publish-flow');
	});
});
