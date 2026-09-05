import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { logActivity } from '$lib/server/activity';

/**
 * Permanently deletes the authenticated user's account: all app rows first
 * (FK-safe, child tables before parents), then the auth user itself via the
 * service-role admin API. Most tables cascade from auth.users anyway, but the
 * explicit deletes let us report exactly which step failed on partial failure.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	let supabase;
	try {
		supabase = getServiceSupabase();
	} catch (err) {
		console.error('[Account Delete] Service client unavailable:', err);
		return json(
			{ success: false, error: 'Account deletion is not configured on this server.' },
			{ status: 500 }
		);
	}

	const userId = user.id;
	const failedSteps: string[] = [];

	// Agent IDs are needed for tables keyed only by agent_id (no user_id column).
	let agentIds: string[] = [];
	const { data: agentRows, error: agentListError } = await supabase
		.from('agents')
		.select('id')
		.eq('user_id', userId);
	if (agentListError) {
		failedSteps.push(`list agents: ${agentListError.message}`);
	} else {
		agentIds = (agentRows || []).map((row: { id: string }) => row.id);
	}

	// Children first. Tables with SET NULL references (post_reviews.post_id,
	// generation_events.post_id, tickets.assignee_agent_id) still get deleted
	// outright — this is a full account wipe, nothing should survive.
	const userScopedTables = [
		'generation_events',
		'post_reviews',
		'chat_messages',
		'agent_memories',
		'chat_sessions',
		'connections',
		'posts',
		'agent_configs',
		'tickets',
		'agents',
		'brand_briefs',
		'blueprints',
		'user_api_keys',
		'subscriptions',
		'profiles'
	];

	// processed_rss_items has no user_id column — delete via the agent list.
	if (agentIds.length > 0) {
		const { error } = await supabase.from('processed_rss_items').delete().in('agent_id', agentIds);
		if (error) failedSteps.push(`processed_rss_items: ${error.message}`);
	}

	for (const table of userScopedTables) {
		// profiles is keyed by id (= auth user id) rather than user_id.
		const column = table === 'profiles' ? 'id' : 'user_id';
		const { error } = await supabase.from(table).delete().eq(column, userId);
		// Missing tables (migrations not applied) shouldn't block account deletion.
		if (error && error.code !== '42P01') {
			failedSteps.push(`${table}: ${error.message}`);
		}
	}

	// Activity history is kept but de-identified: user_id → NULL, presence
	// removed, subject_hash retained so aggregates stay stable. Recorded as the
	// last event of this account BEFORE the hash-only rows lose their id.
	logActivity(locals, null, { action: 'account.deleted', actorKind: 'user', hashUserId: userId });
	{
		const { error: anonErr } = await supabase.rpc('anonymize_user_activity', { p_user: userId });
		// A missing function (migration not applied) must not block deletion.
		if (anonErr && !/does not exist|schema cache|PGRST202/i.test(anonErr.message ?? '')) {
			failedSteps.push(`anonymize activity: ${anonErr.message}`);
		}
	}

	// Finally remove the auth user itself. This also cascades any rows the
	// explicit deletes missed (all app tables reference auth.users ON DELETE CASCADE).
	const { error: authError } = await supabase.auth.admin.deleteUser(userId);
	if (authError) {
		failedSteps.push(`auth user: ${authError.message}`);
		console.error('[Account Delete] Failed steps:', failedSteps);
		return json(
			{
				success: false,
				error: 'Account data was removed but the login could not be deleted. Contact support.',
				failedSteps
			},
			{ status: 500 }
		);
	}

	// Clear this browser's session cookies; the user no longer exists so
	// a signOut error here is expected noise, not a failure.
	await locals.supabase.auth.signOut().catch(() => {});

	if (failedSteps.length > 0) {
		console.error('[Account Delete] Completed with partial failures:', failedSteps);
	}

	return json({ success: true, failedSteps });
};
