import { json } from '@sveltejs/kit';
import { personaLimitExceeded } from '$lib/server/plans';
import type { RequestHandler } from './$types';
import { buildStoredProfile } from '$lib/persona-contract/save';
import type { PersonaProfileV2 } from '$lib/persona-contract/schema';
import { writeWithProfileFallback } from '$lib/server/personas-profile-column';
import { isOwnedBucketUrl } from '$lib/server/storage';

export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Authenticate user
	const { session } = await locals.safeGetSession();
	if (!session) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	// personaProfile/skills/ugcVoice/brandBriefId land here when the Agent Generator
	// generated a full brand-tailored persona, so the new creator is born fully
	// configured (profile + voice + brand link) instead of a bare shell.
	const {
		name,
		niche,
		bio,
		handle,
		gradient,
		initial,
		personaProfile,
		skills,
		ugcVoice,
		brandBriefId,
		// The portrait the wizard already generated and the user already paid for
		// (/api/persona-preview). Adopting it is what stops creation re-rendering —
		// and re-billing — a face the user has already approved.
		characterRef
	} = body;

	if (!name) {
		return json({ success: false, error: 'Missing name parameter' }, { status: 400 });
	}

	// Plan persona limit (plans.ts; null = unlimited, which is what 'free' is
	// until the catalog says otherwise). 402 with a billing link, like credits.
	const limitMsg = await personaLimitExceeded(session.user.id).catch(() => null);
	if (limitMsg) {
		return json({ success: false, code: 'PERSONA_LIMIT', error: limitMsg, billingUrl: '/billing' }, { status: 402 });
	}

	try {
		const agentHandle = handle || '@' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
		const defaultGradient = `linear-gradient(135deg, hsl(${Math.floor(Math.random() * 360)}, 70%, 55%), hsl(${Math.floor(Math.random() * 360)}, 80%, 50%))`;
		const agentGradient = gradient || defaultGradient;
		const agentInitial = initial || name.charAt(0).toUpperCase();
		const skillsText = typeof skills === 'string' ? skills : '';
		// The full persona profile (archetype/avatar/appearance/voiceProfile) goes
		// through the same gate as every later save (Persona Model v2, P0.5): v1
		// normalising, upgrade, v2 validation, provenance — and lands as a v2 blob
		// in personas_profile JSONB, its ONLY home since market_restore_migration.sql
		// (P0.6). `market` keeps its column default (a market string).
		const profileToStore: PersonaProfileV2 | undefined =
			personaProfile && typeof personaProfile === 'object'
				? buildStoredProfile(null, personaProfile, { origin: 'ui' })
				: undefined;

		const insertPayload = {
			user_id: session.user.id,
			name: name,
			handle: agentHandle,
			niche: niche || 'Lifestyle',
			status: 'active',
			soul: bio || `Autonomous ${niche || 'lifestyle'} creator.`,
			gradient: agentGradient,
			initial: agentInitial,
			skills: skillsText,
			...(profileToStore ? { personas_profile: profileToStore } : {})
		};

		// Survives a build that ships before personas_profile_migration.sql is
		// applied: on a missing-column error the insert retries without that key and
		// the profile still lands in `market`, which readPersonaProfile falls back to.
		const { data: newAgent, error: agentError } = await writeWithProfileFallback(
			insertPayload,
			(p) => locals.supabase.from('agents').insert(p).select().single()
		);

		if (agentError) {
			console.error('[API Agents] Agent insertion failed:', agentError);
			return json({ success: false, error: agentError.message }, { status: 500 });
		}

		// The previewed portrait, adopted as the pinned face.
		//
		// SECURITY: `characterRef` arrives from the client and is written to
		// `ugc_character_ref`, which later gets handed to fal as an `image_urls`
		// entry and re-fetched server-side — so an arbitrary URL here is the
		// attack `isOwnedBucketUrl` exists to stop (see storage.ts). Only a URL
		// inside THIS user's own folder in our own bucket is accepted; anything
		// else is dropped silently and the persona is simply born without a face,
		// which the lazy `ensureCharacterRef` fills on first generation exactly as
		// it does for a persona created without a preview.
		const adoptedRef =
			typeof characterRef === 'string' && isOwnedBucketUrl(characterRef, session.user.id)
				? characterRef
				: null;

		// Create default agent_configs row (with the pinned voice + brand link when the
		// generator supplied them).
		try {
			const { error: configError } = await locals.supabase.from('agent_configs').insert({
				user_id: session.user.id,
				agent_id: newAgent.id,
				soul: bio || `Autonomous ${niche || 'lifestyle'} creator.`,
				skills: skillsText,
				tools: '',
				timezone: 'Australia/Sydney',
				posts_per_day: 3,
				active_hours_start: 8,
				active_hours_end: 22,
				autonomy_level: 'advisor',
				...(typeof ugcVoice === 'string' && ugcVoice ? { ugc_voice: ugcVoice } : {}),
				...(typeof brandBriefId === 'string' && brandBriefId
					? { brand_brief_id: brandBriefId }
					: {}),
				...(adoptedRef ? { ugc_character_ref: adoptedRef } : {})
			});
			if (configError) throw configError;
		} catch (configErr) {
			console.error('[API Agents] Could not create agent_configs:', configErr);
		}

		return json({
			success: true,
			data: newAgent
		});
	} catch (err) {
		console.error('[API Agents] Critical error:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
