/**
 * The single authoritative operation contract behind every composer button.
 *
 * A "contract" states what an operation actually IS — media kind, pipeline
 * format, still style, which references it feeds, whether product SEMANTIC
 * context may reach the Director, which controls apply, and where its output
 * is allowed to go. Studio contracts derive from the real STUDIO_TEMPLATES
 * catalog (never a second catalog); everything else resolves an explicit
 * generic contract that keeps the legacy composer's flexibility without
 * masquerading as a Studio operation.
 *
 * Client-safe and pure: imported by the composer, the Campaign Planner, and
 * the generate-post endpoint so preview, POST normalization, and the UI all
 * share ONE resolution path.
 */
import { STUDIO_TEMPLATES, type StudioIntent, type StudioSurface } from '$lib/studio-templates';

export const OPERATION_CONTRACT_VERSION = 1;

export type MediaKind = 'image' | 'video' | 'cinematic';
export type RunFormat = 'spokesperson' | 'broll';
export type StillStyle = 'photo' | 'graphic';
/** Where output may go. 'publish-flow' = legacy schedule/publish behavior. */
export type DeliveryPolicy = 'publish-flow' | 'draft' | 'review' | 'asset';
export type ResultKind = 'photo-image' | 'graphic-image' | 'video' | 'cinematic-video';

export interface OperationContract {
	operationId: string;
	version: typeof OPERATION_CONTRACT_VERSION;
	kind: 'studio' | 'generic';
	/** Truthful operation label ("Text card", "Talking head", "Video"…). */
	label: string;
	/** Advertised shelf (studio only). */
	surface: StudioSurface | null;
	intent: StudioIntent | null;
	/** What actually runs. */
	media: MediaKind;
	/** Video pipeline branch; null when media is not 'video'. */
	format: RunFormat | 'auto' | null;
	still: StillStyle;
	/** Reference policy: which images the run may feed the model. */
	characterRef: boolean;
	productRef: boolean;
	/** Whether product SEMANTIC context (product_id, auto-selection, Director
	 *  "Product:" framing) is allowed — separate from the image reference. */
	productContext: boolean;
	/** Talking head requires a face — false whenever characterRef is false. */
	spokespersonEligible: boolean;
	/** Studio operations stay the operation clicked. */
	lockMedia: boolean;
	lockFormat: boolean;
	/** Control applicability — a control that cannot change the run is hidden. */
	videoModelApplies: boolean;
	captionsApply: boolean;
	providerApplies: boolean;
	allowedDelivery: DeliveryPolicy[];
	resultKind: ResultKind;
}

interface ContractShape {
	media?: 'image' | 'cinematic' | string;
	still?: 'photo' | 'graphic' | string;
	format?: 'spokesperson' | 'broll' | string;
	refs?: { character?: boolean; product?: boolean };
}

/** Loose request-body shape both the composer and the endpoint speak. */
export interface GenerationBodyLike extends ContractShape {
	studio_template?: unknown;
	[key: string]: unknown;
}

function resultKindOf(media: MediaKind, still: StillStyle): ResultKind {
	if (media === 'cinematic') return 'cinematic-video';
	if (media === 'video') return 'video';
	return still === 'graphic' ? 'graphic-image' : 'photo-image';
}

/**
 * Shared derivation core — mirrors exactly how generate-post reads a body:
 * only the literal 'image'/'cinematic' change media, only the literal
 * 'graphic' changes the still, cinematic always composites both references,
 * a graphic card feeds none.
 */
function deriveShape(shape: ContractShape) {
	const media: MediaKind =
		shape.media === 'cinematic' ? 'cinematic' : shape.media === 'image' ? 'image' : 'video';
	const still: StillStyle = media !== 'cinematic' && shape.still === 'graphic' ? 'graphic' : 'photo';
	const cinematic = media === 'cinematic';
	const graphic = still === 'graphic';
	const characterRef = cinematic || (!graphic && shape.refs?.character !== false);
	const productRef = cinematic || (!graphic && shape.refs?.product !== false);
	const requestedFormat: RunFormat | 'auto' =
		shape.format === 'spokesperson' || shape.format === 'broll' ? shape.format : 'auto';
	// A composition without a face cannot run a talking head — the resolved
	// contract says b-roll instead of advertising a branch that cannot run.
	const spokespersonEligible = media === 'video' && characterRef;
	const format: RunFormat | 'auto' | null =
		media !== 'video'
			? null
			: requestedFormat === 'spokesperson' && !spokespersonEligible
				? 'broll'
				: requestedFormat;
	return { media, still, characterRef, productRef, format, spokespersonEligible };
}

function applicability(media: MediaKind, format: RunFormat | 'auto' | null) {
	return {
		// 'auto' can still resolve to b-roll at run time, so the picker applies;
		// only a locked spokesperson run can never feed the i2v model.
		videoModelApplies: media === 'video' && format !== 'spokesperson',
		captionsApply: media !== 'image',
		providerApplies: media !== 'cinematic'
	};
}

/** Resolve a Studio template button into its full operation contract. */
export function resolveStudioContract(templateId: string): OperationContract | null {
	const t = STUDIO_TEMPLATES.find((x) => x.id === templateId);
	if (!t) return null;
	const shape = deriveShape(t.baseBody);
	return {
		operationId: t.id,
		version: OPERATION_CONTRACT_VERSION,
		kind: 'studio',
		label: t.pipeline,
		surface: t.surface,
		intent: t.intent,
		media: shape.media,
		format: shape.format,
		still: shape.still,
		characterRef: shape.characterRef,
		productRef: shape.productRef,
		productContext: t.intent === 'brand',
		spokespersonEligible: shape.spokespersonEligible,
		lockMedia: true,
		lockFormat: true,
		...applicability(shape.media, shape.format),
		allowedDelivery: ['review', 'asset'],
		resultKind: resultKindOf(shape.media, shape.still)
	};
}

function genericLabel(media: MediaKind, still: StillStyle): string {
	if (media === 'cinematic') return 'Cinematic (multi-shot)';
	if (media === 'image') return still === 'graphic' ? 'Text card' : 'Still image';
	return 'Video';
}

/**
 * The explicit generic contract behind Persona/Calendar "Generate Now" and
 * legacy API callers. Deliberately flexible (nothing locked), but every
 * VARIANT — media/format/still switch — resolves completely, so switching to
 * cinematic never reuses a previous variant's stale reference policy.
 */
export function resolveGenericContract(body: ContractShape): OperationContract {
	const shape = deriveShape(body);
	return {
		operationId: 'generic-post',
		version: OPERATION_CONTRACT_VERSION,
		kind: 'generic',
		label: genericLabel(shape.media, shape.still),
		surface: null,
		intent: null,
		media: shape.media,
		format: shape.format,
		still: shape.still,
		characterRef: shape.characterRef,
		productRef: shape.productRef,
		productContext: true,
		spokespersonEligible: shape.spokespersonEligible,
		lockMedia: false,
		lockFormat: false,
		...applicability(shape.media, shape.format),
		allowedDelivery: ['publish-flow', 'draft', 'review', 'asset'],
		resultKind: resultKindOf(shape.media, shape.still)
	};
}

/**
 * One resolution path for every caller: a known studio_template resolves its
 * catalog contract; anything else (including a deleted template id) resolves
 * an explicit generic contract from the body's own fields.
 */
export function resolveOperationContract(body: GenerationBodyLike): OperationContract {
	if (typeof body.studio_template === 'string') {
		const studio = resolveStudioContract(body.studio_template);
		if (studio) return studio;
	}
	return resolveGenericContract(body);
}

/**
 * The explicit delivery outcome for a request. Absent/unknown values keep the
 * legacy publish flow for generic callers; a Studio operation is clamped to
 * its contract — Studio output can never race straight to a live platform.
 */
export function resolveDeliveryPolicy(
	requested: unknown,
	contract: OperationContract
): DeliveryPolicy {
	const req: DeliveryPolicy | null =
		requested === 'review' || requested === 'asset' || requested === 'draft'
			? requested
			: requested === 'publish'
				? 'publish-flow'
				: null;
	if (req && contract.allowedDelivery.includes(req)) return req;
	return contract.kind === 'studio' ? 'review' : 'publish-flow';
}

/**
 * Explicit-platform normalization. Absent (or non-array) → null, meaning the
 * caller may apply its defaults. An explicit array is filtered against the
 * agent's connections — an explicit EMPTY array stays empty and must never
 * expand to every connected platform, and invalid values are dropped, never
 * expanded.
 */
export function normalizePlatforms(requested: unknown, connected: string[]): string[] | null {
	if (!Array.isArray(requested)) return null;
	return requested
		.map((p) => String(p).toLowerCase())
		.filter((p) => connected.includes(p));
}

export interface RunProductLike {
	id?: string;
	photoUrl?: string | null;
	[key: string]: unknown;
}

/**
 * The one product-selection seam for every generation pipeline.
 *
 * Product SEMANTIC context is a policy decision, not a side effect of a brand
 * brief existing: when `allowProductContext` is false (channel/product-free
 * operations) NO product is selected — not for the Director prompt, not for
 * grading — even if the brief is full of products or a stray id was sent.
 * With context allowed, legacy behavior is retained: the requested id wins
 * (an unknown id resolves to nothing rather than a silent substitute), else
 * the first product with a photo, else the first product.
 */
export function selectRunProduct<T extends RunProductLike>(
	products: T[],
	productId: string | undefined,
	allowProductContext: boolean
): T | null {
	if (!allowProductContext) return null;
	if (productId) return products.find((p) => p.id === productId) ?? null;
	return products.find((p) => p.photoUrl) ?? products[0] ?? null;
}

export interface ResolvedRunFormat {
	format: RunFormat;
	/** Why a spokesperson request was downgraded, when it was. */
	coerced: 'graphic-still' | 'no-character' | null;
}

/**
 * Resolve the video branch that will actually run. A talking head requires a
 * face: a graphic card has none to animate, and a composition whose contract
 * EXCLUDES the persona (useCharacterRef === false) must not run the
 * spokesperson branch either — both coerce to b-roll, explicitly.
 */
export function resolveRunFormat(
	pref: 'auto' | 'spokesperson' | 'broll',
	directorPick: string | undefined,
	stillStyle: StillStyle,
	useCharacterRef: boolean
): ResolvedRunFormat {
	let format: RunFormat =
		pref === 'auto' ? (directorPick === 'broll' ? 'broll' : 'spokesperson') : pref;
	let coerced: ResolvedRunFormat['coerced'] = null;
	if (format === 'spokesperson' && stillStyle === 'graphic') {
		format = 'broll';
		coerced = 'graphic-still';
	} else if (format === 'spokesperson' && useCharacterRef === false) {
		format = 'broll';
		coerced = 'no-character';
	}
	return { format, coerced };
}

export interface CampaignReferenceAvailability {
	/** Whether the persona's brand kit has at least one product with a photo. */
	hasProductPhoto: boolean;
}

export type CampaignEligibility =
	| { eligible: true }
	| { eligible: false; reason: 'needs-product-photo' | 'unknown-operation' };

/**
 * Per-slot reference preflight for bulk campaigns. A slot whose operation
 * composites the product photo (productRef) — and cinematic, which hard-fails
 * without one — is only eligible when a product photo exists; the planner
 * excludes it visibly instead of launching doomed slots or silently
 * substituting a different reference policy. Character references never gate
 * eligibility: the pipeline auto-generates and pins a persona face on first
 * run.
 */
export function campaignEligibility(
	templateId: string,
	avail: CampaignReferenceAvailability
): CampaignEligibility {
	const contract = resolveStudioContract(templateId);
	if (!contract) return { eligible: false, reason: 'unknown-operation' };
	if ((contract.productRef || contract.media === 'cinematic') && !avail.hasProductPhoto) {
		return { eligible: false, reason: 'needs-product-photo' };
	}
	return { eligible: true };
}

export interface OperationProvenance {
	id: string;
	version: number;
	/** Expected result kind — what this operation SET OUT to produce. */
	expect: ResultKind;
	/** Expected reference policy, including the semantic-context decision. */
	refs: { character: boolean; product: boolean; productContext: boolean };
	/** Requested delivery behavior at generation time. */
	deliver: DeliveryPolicy;
}

/**
 * The forensic stamp persisted inside the post's content JSON (no schema
 * migration — older rows simply lack the key and every reader treats it as
 * optional): which operation ran, what it was expected to produce, which
 * references it was allowed, and where its output was asked to go.
 */
export function operationProvenance(
	contract: OperationContract,
	delivery: DeliveryPolicy
): OperationProvenance {
	return {
		id: contract.operationId,
		version: contract.version,
		expect: contract.resultKind,
		refs: {
			character: contract.characterRef,
			product: contract.productRef,
			productContext: contract.productContext
		},
		deliver: delivery
	};
}

export interface NormalizedGeneration {
	contract: OperationContract;
	delivery: DeliveryPolicy;
	body: GenerationBodyLike;
}

/**
 * Contract-enforced request normalization, shared by preview and POST.
 *
 * For a Studio operation the catalog contract overrides the client's locked
 * fields (media/format/still/refs) — a template button stays the operation
 * clicked even against a tampered payload. For every operation, controls the
 * resolved variant ignores are stripped so stale hidden UI state can never
 * steer a run: no hidden product id on a product-free composition, no video
 * model on a run that feeds none, no captions on a still.
 */
export function normalizeGenerationBody(raw: GenerationBodyLike): NormalizedGeneration {
	const contract = resolveOperationContract(raw);
	const body: GenerationBodyLike = { ...raw };

	// Locked shape: the contract is the request.
	body.media = contract.media;
	body.still = contract.still;
	body.format = contract.media === 'video' ? (contract.format ?? 'auto') : undefined;
	body.refs = { character: contract.characterRef, product: contract.productRef };

	// Reference/semantic whitelisting.
	if (!contract.productRef && !contract.productContext) {
		delete body.product_id;
		delete body.productId;
		delete body.product_photo_url;
	}
	if (!contract.characterRef) delete body.character_ref_url;

	// Control applicability.
	if (!contract.videoModelApplies) delete body.video_model;
	if (!contract.captionsApply) {
		body.captions = false;
		body.ai_badge = false;
	}
	if (!contract.providerApplies) delete body.provider;

	const delivery = resolveDeliveryPolicy(raw.deliver, contract);
	if (delivery === 'asset') {
		// A standalone asset has no destination and no slot — submitting them
		// would imply controls this outcome ignores.
		body.platforms = [];
		delete body.scheduled_date;
		delete body.scheduled_time;
	}

	return { contract, delivery, body };
}
