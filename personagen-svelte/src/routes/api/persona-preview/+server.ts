import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { buildStoredProfile } from '$lib/persona-contract/save';
import {
	resolveImageKeys,
	resolvePersonaGender,
	generateHeroPortraitImage,
	buildHeroPortraitPrompt,
	loadBriefForAgent,
	recordCostEvents
} from '$lib/server/content/generate';
import {
	loadRegistry,
	effectiveOptions,
	effectiveResolve,
	type RegistryRow
} from '$lib/server/model-registry';
import { enhanceImage, upscaleUsd } from '$lib/server/content/enhance';
import { enhanceChain } from '$lib/server/flags';
import { assertWithinBudget } from '$lib/server/budget';
import { assertCreditsAvailable, resolveBillingAccount, creditsFor, isCreditsError } from '$lib/server/credits';

/**
 * The persona preview — one portrait for a persona that does NOT exist yet.
 *
 * WHY THIS IS NOT `/api/agent/[agentId]/generate-avatar`. That route needs an
 * agent row: it checks access against one, pins the finished shot into
 * `agent_configs.ugc_character_ref`, and rebuilds the reference kit around it.
 * None of that can happen for a draft in the creation wizard, and creating a
 * throwaway persona just to render a face would leave orphans behind every time
 * someone abandoned the wizard.
 *
 * SYNCHRONOUS, unlike generate-avatar's detached job — and for the same reason
 * source-clip is. That route is detached because it chains three paid images
 * (portrait → character sheet → full body) and runs past the proxy timeout.
 * A preview is ONE text-to-image call; the response IS the picture the user is
 * waiting to look at, so a 202-and-poll would add a polling loop to the wizard
 * for no benefit. The full chain still runs later, once, at creation.
 *
 * THE PREVIEW MUST BE THE REAL THING. The prompt is built by
 * `buildHeroPortraitPrompt` — the same function the post-creation portrait uses
 * — off a profile put through `buildStoredProfile`, the same gate the create
 * route writes with. A preview built from a different shape than the persona is
 * later born with would be a lie told at the exact moment the user is deciding
 * whether to trust the product.
 *
 * IT IS PAID WORK AND IS BILLED AS SUCH. Both gates run agentless: the budget
 * check skips only its per-agent daily cap, and the ledger row lands with
 * `agent_id: null`. Under `credits_mode=enforce` an unmetered path is a free
 * path, and a preview that regenerates on a button is exactly the surface that
 * would be abused.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}) as any);

	const { falKey } = await resolveImageKeys(locals.supabase, user.id);
	if (!falKey) {
		return json(
			{ success: false, error: 'No fal.ai key configured. Add one in Settings.' },
			{ status: 400 }
		);
	}

	let svc: any;
	try {
		svc = getServiceSupabase();
	} catch {
		return json(
			{ success: false, error: 'Storage service is not configured on this server.' },
			{ status: 500 }
		);
	}

	// Model Manager: honour registry enable/disable + defaults; static fallback,
	// exactly as generate-avatar does — a preview the operator disabled the model
	// for must not quietly run on a different one.
	let registryRows: RegistryRow[] = [];
	try {
		registryRows = await loadRegistry(locals.supabase, user.id);
	} catch (e) {
		console.error('[persona-preview] Registry unavailable, using static catalog:', e);
	}
	const selected = effectiveResolve(registryRows, 'image_t2i', body.model);

	// The draft, shaped like the agent row it is about to become. `personas_profile`
	// goes through buildStoredProfile so the prompt reads the v2 blob the create
	// route would have written — not the looser UI record.
	const profileToStore =
		body.personaProfile && typeof body.personaProfile === 'object'
			? buildStoredProfile(null, body.personaProfile, { origin: 'ui' })
			: undefined;
	const draftAgent = {
		name: typeof body.name === 'string' ? body.name : '',
		soul: typeof body.bio === 'string' ? body.bio : '',
		...(profileToStore ? { personas_profile: profileToStore } : {})
	};

	const gender = resolvePersonaGender(
		draftAgent,
		typeof body.ugcVoice === 'string' ? body.ugcVoice : undefined
	);

	const db = createDbService(locals.supabase);
	const briefRow = await loadBriefForAgent(
		db,
		user.id,
		typeof body.brandBriefId === 'string' ? body.brandBriefId : null
	);
	const briefData = briefRow?.data || null;

	const resolvedPrompt = buildHeroPortraitPrompt(briefData, draftAgent, gender);

	// What this run actually costs: the still, PLUS the enhancement pass when it
	// is both switched on and priced. Quoting the still alone would gate on less
	// than `recordCostEvents` below debits, and would print a smaller number on
	// screen than the wallet is charged — the same asymmetry that shipped as the
	// format explorer's 3x under-quote and the forged clip duration. One value
	// feeds the quote, both gates and both responses so they cannot drift.
	const enhanceUsd = enhanceChain() === 'upscale' ? (upscaleUsd() ?? 0) : 0;
	const quotedUsd = selected.usd + enhanceUsd;

	// `preview: true` costs nothing and generates nothing — the composer's
	// look-before-you-pay contract, kept identical to generate-avatar's.
	if (body.preview === true) {
		return json({
			success: true,
			preview: {
				mode: 'from_scratch',
				prompt: resolvedPrompt,
				provider: 'fal',
				gender: gender ?? null,
				modelKind: 'image_t2i',
				model: selected.id,
				modelOptions: effectiveOptions(registryRows, 'image_t2i'),
				editable: ['model'],
				estimatedCostUsd: quotedUsd
			}
		});
	}

	const quotedCredits = creditsFor(quotedUsd);
	try {
		// Agentless on purpose: assertWithinBudget's per-agent daily cap simply
		// does not apply to a persona that does not exist, and the monthly
		// per-user cap — the one that matters here — still does.
		await assertWithinBudget(locals.supabase, user.id, undefined, quotedCredits);
		const billedUserId = await resolveBillingAccount(locals.supabase, undefined, user.id);
		await assertCreditsAvailable(locals.supabase, billedUserId, quotedCredits);
	} catch (err) {
		if (isCreditsError(err)) {
			return json(
				{ success: false, code: 'INSUFFICIENT_CREDITS', error: (err as Error).message, billingUrl: '/billing' },
				{ status: 402 }
			);
		}
		return json({ success: false, error: (err as Error).message }, { status: 402 });
	}

	try {
		const url = await generateHeroPortraitImage(
			svc,
			user.id,
			falKey,
			briefData,
			draftAgent,
			gender,
			undefined,
			selected.id
		);

		// The enhancement chain (P0.1). Off unless an operator has switched it on
		// AND priced it, and it returns the original on any failure — so this line
		// can only improve the portrait or leave it exactly as it was.
		const enhanced = await enhanceImage(svc, user.id, url, falKey);

		// Recorded AFTER the image exists, so a provider call that threw is not
		// billed — the bug fixed in c55c353 for the generation path, not repeated
		// here. `assetUrl` keeps the spent generation recoverable from the ledger
		// even if the user abandons the wizard without creating anything.
		//
		// The enhancement's own events ride the SAME call rather than a second
		// one: one run, one ledger write, and a stage that cannot bill through a
		// private path of its own.
		await recordCostEvents(locals.supabase, user.id, undefined, [
			{
				provider: 'fal',
				operation: 'image',
				model: `${selected.label} (persona preview)`,
				usd: selected.usd,
				assetUrl: url
			},
			...enhanced.costEvents
		]);

		return json({
			success: true,
			data: {
				url: enhanced.url,
				model: selected.id,
				modelLabel: selected.label,
				// What RAN, not what was quoted. `quotedUsd` assumes the enhancement
				// pass happens; it never-bricks to the original, and a pass that fell
				// back returns no cost events. Reporting the quote here would tell the
				// user they were charged for a stage that did not run.
				estimatedCostUsd: selected.usd + enhanced.costEvents.reduce((t, e) => t + e.usd, 0),
				// The stages that actually ran, for the same reason.
				enhanced: enhanced.applied
			}
		});
	} catch (err) {
		console.error('[persona-preview] Preview generation failed:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
