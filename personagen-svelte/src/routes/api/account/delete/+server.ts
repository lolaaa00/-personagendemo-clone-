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

	// Generated media lives in storage under `<userId>/…`, and storage does NOT
	// cascade from auth.users — so a "delete my account" that skips this leaves
	// every image and video the user ever made in a PUBLIC bucket, permanently.
	// It has to happen BEFORE the auth row goes: the path prefix is the only
	// link between a file and its owner (storage.objects.owner is NULL on every
	// row in this project), so once the user is gone nothing can say whose files
	// those were. A failure here is reported, not swallowed: the user asked for
	// their data to be gone.
	{
		const bucket = 'ugc-media';
		try {
			let removed = 0;
			// list() pages at 100 by default; keep going until a page is short.
			for (let offset = 0; ; offset += 100) {
				const { data: files, error: listErr } = await supabase.storage.from(bucket).list(userId, { limit: 100, offset });
				if (listErr) {
					failedSteps.push(`storage list: ${listErr.message}`);
					break;
				}
				if (!files?.length) break;
				const paths = files.map((f: { name: string }) => `${userId}/${f.name}`);
				const { error: rmErr } = await supabase.storage.from(bucket).remove(paths);
				if (rmErr) {
					failedSteps.push(`storage remove: ${rmErr.message}`);
					break;
				}
				removed += paths.length;
				if (files.length < 100) break;
			}
			if (removed > 0) console.log(`[Account Delete] removed ${removed} stored file(s) for ${userId}`);
		} catch (err) {
			failedSteps.push(`storage: ${(err as Error).message}`);
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
