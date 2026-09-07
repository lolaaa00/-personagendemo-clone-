import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	profileToMarketString,
	serializePersonaProfile,
	type PersonaProfile
} from '$lib/persona-profile-store';
import { writeWithProfileFallback } from '$lib/server/personas-profile-column';

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
		brandBriefId
	} = body;

	if (!name) {
		return json({ success: false, error: 'Missing name parameter' }, { status: 400 });
	}

	try {
		const agentHandle = handle || '@' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
		const defaultGradient = `linear-gradient(135deg, hsl(${Math.floor(Math.random() * 360)}, 70%, 55%), hsl(${Math.floor(Math.random() * 360)}, 80%, 50%))`;
		const agentGradient = gradient || defaultGradient;
		const agentInitial = initial || name.charAt(0).toUpperCase();
		const skillsText = typeof skills === 'string' ? skills : '';
		// The full persona profile (archetype/avatar/appearance/voiceProfile) goes
		// through the normalising gate at birth — same as every later save — then
		// lands in personas_profile JSONB. `market` gets a copy ONLY as the
		// never-brick fallback for a database without the JSONB column; no
		// external service reads it (mcp-bridge verified 2026-09-05).
		const profileToStore: PersonaProfile | undefined =
			personaProfile && typeof personaProfile === 'object'
				? serializePersonaProfile(personaProfile as PersonaProfile)
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
			...(profileToStore
				? {
						personas_profile: profileToStore,
						market: profileToMarketString(profileToStore)
					}
				: {})
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
					: {})
			});
			if (configError) throw configError;
		} catch (configErr) {
			console.error('[API Agents] Could not create agent_configs:', configErr);
		}

		return json({
			success: true,
			data: newAgent
		});
	} catch (err: any) {
		console.error('[API Agents] Critical error:', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
