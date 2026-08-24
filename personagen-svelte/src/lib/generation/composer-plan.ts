/**
 * Pure UI plan + payload builder for the GenerationComposer.
 *
 * `composerFieldPlan` decides which controls exist for a resolved operation
 * contract — a control that cannot change the run is not rendered at all.
 * `buildComposerPayload` constructs the whitelisted request body from the
 * contract: hidden or inapplicable UI state is never submitted, so a value a
 * user cannot see can never steer a generation.
 */
import type { DeliveryPolicy, OperationContract } from './contracts';

export interface ComposerFieldPlan {
	mediaSelect: boolean;
	formatChips: boolean;
	spokespersonOption: boolean;
	provider: boolean;
	captions: boolean;
	aiBadge: boolean;
	productPicker: boolean;
	productUrl: boolean;
	characterUrl: boolean;
	videoModel: boolean;
	platforms: boolean;
	schedule: boolean;
	/** Read-only summary of a locked operation, shown instead of dead selectors. */
	operationSummary: string | null;
}

function refsSummary(contract: OperationContract): string {
	if (contract.still === 'graphic')
		return 'the model renders the card’s text as the artwork — no reference images';
	if (contract.characterRef && contract.productRef)
		return 'composites the persona’s face and the product photo';
	if (contract.characterRef) return 'persona face reference only — no product attached';
	if (contract.productRef) return 'product reference only — the persona does not appear';
	return 'no reference images — generated purely from the prompt';
}

export function composerFieldPlan(
	contract: OperationContract,
	delivery: DeliveryPolicy
): ComposerFieldPlan {
	const isVideo = contract.media === 'video';
	return {
		mediaSelect: !contract.lockMedia,
		formatChips: isVideo && !contract.lockFormat,
		spokespersonOption: contract.spokespersonEligible,
		provider: contract.providerApplies,
		captions: contract.captionsApply,
		aiBadge: contract.captionsApply,
		productPicker: contract.productRef,
		productUrl: contract.productRef,
		characterUrl: contract.characterRef,
		videoModel: contract.videoModelApplies,
		platforms: delivery !== 'asset',
		schedule: delivery !== 'asset',
		operationSummary: contract.lockMedia
			? `${contract.label} — ${refsSummary(contract)}.`
			: null
	};
}

/**
 * The explicit delivery outcome the composer will submit. Studio operations
 * follow their Output toggle (review/asset, defaulting to review); generic
 * flows resolve from what the user can SEE: destinations selected → the
 * publish flow, none → an explicit draft (never an inferred one).
 */
export function resolveComposerDelivery(
	baseDeliver: unknown,
	contract: OperationContract,
	hasConnections: boolean,
	selectedPlatformCount: number
): DeliveryPolicy {
	if (contract.kind === 'studio') {
		return baseDeliver === 'asset' ? 'asset' : 'review';
	}
	if (baseDeliver === 'review' || baseDeliver === 'asset' || baseDeliver === 'draft') {
		return baseDeliver;
	}
	return hasConnections && selectedPlatformCount > 0 ? 'publish-flow' : 'draft';
}

export interface ComposerPayloadState {
	isPromptKind?: boolean;
	prompt?: string;
	topic: string;
	scene: string;
	media: string;
	format: string;
	provider: string;
	captions: boolean;
	aiBadge: boolean;
	platforms: string[];
	productId: string;
	productPhotoUrl: string;
	characterRefUrl: string;
	scheduledDate: string;
	scheduledTime: string;
	model: string;
	videoModel: string;
}

/** Wire value for a delivery policy ('publish-flow' travels as 'publish'). */
function deliverWire(delivery: DeliveryPolicy): string {
	return delivery === 'publish-flow' ? 'publish' : delivery;
}

export function buildComposerPayload(
	baseBody: Record<string, unknown>,
	contract: OperationContract,
	delivery: DeliveryPolicy,
	s: ComposerPayloadState
): Record<string, unknown> {
	const body: Record<string, unknown> = { ...baseBody };

	if (s.isPromptKind) {
		// Prompt composers (avatar, reference kit) submit the edited prompt and
		// the model pick — none of the post fields exist for them.
		body.prompt = s.prompt ?? '';
		if (s.model) body.model = s.model;
		if (s.videoModel) body.video_model = s.videoModel;
		return body;
	}

	if (s.model) body.model = s.model;

	body.topic = s.topic || undefined;
	body.scene = s.scene || undefined;

	// Locked operations submit their contract's shape; generic submits the
	// user's visible variant (which IS the contract it was resolved from).
	body.media = contract.lockMedia ? contract.media : s.media;
	if (contract.media === 'video') {
		body.format = contract.lockFormat ? (contract.format ?? 'auto') : s.format;
	} else {
		delete body.format;
	}

	if (contract.providerApplies) body.provider = s.provider;
	else delete body.provider;

	if (contract.captionsApply) {
		body.captions = s.captions;
		body.ai_badge = s.aiBadge;
	} else {
		delete body.captions;
		delete body.ai_badge;
	}

	if (contract.productRef) {
		body.product_id = s.productId || undefined;
		body.product_photo_url = s.productPhotoUrl || undefined;
	} else {
		delete body.product_id;
		delete body.product_photo_url;
	}

	if (contract.characterRef) body.character_ref_url = s.characterRefUrl || undefined;
	else delete body.character_ref_url;

	if (contract.videoModelApplies && s.videoModel) body.video_model = s.videoModel;
	else delete body.video_model;

	if (delivery === 'asset') {
		delete body.platforms;
		delete body.scheduled_date;
		delete body.scheduled_time;
	} else {
		body.platforms = s.platforms;
		body.scheduled_date = s.scheduledDate || undefined;
		body.scheduled_time = s.scheduledTime || undefined;
	}

	body.deliver = deliverWire(delivery);
	return body;
}
