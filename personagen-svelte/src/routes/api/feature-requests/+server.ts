import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * User Voice API — feature requests + votes behind the Docs page's tab.
 *
 * Shared-board semantics: every authenticated user reads every request (RLS
 * allows it deliberately); creates/votes/deletes are owner-scoped. Status is
 * team-managed — a DB trigger silently keeps the old status on client updates,
 * so no client can move Kanban cards.
 *
 * Failure posture (repo convention): if the table doesn't exist yet the
 * migration simply hasn't been applied — respond with `needsMigration: true`
 * and a human sentence instead of a 500, so the tab explains itself.
 */

const MIGRATION_HINT =
	'User Voice needs its database table — run supabase/feature_requests_migration.sql (or the full client_bootstrap.sql) against the database, then reload.';

function missingTable(err: unknown): boolean {
	const e = err as { code?: string; message?: string } | null;
	// 42P01 = undefined_table; PostgREST surfaces the same failure as a
	// "relation ... does not exist" / schema-cache message.
	return (
		e?.code === '42P01' ||
		/relation .* does not exist|could not find the table|schema cache/i.test(e?.message ?? '')
	);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		/* empty body → action check below rejects */
	}
	const action = body.action;

	try {
		if (action === 'list') {
			const [{ data: requests, error: reqErr }, { data: votes, error: voteErr }] =
				await Promise.all([
					locals.supabase
						.from('feature_requests')
						.select('id, user_id, title, detail, status, created_at')
						.order('created_at', { ascending: false }),
					locals.supabase.from('feature_request_votes').select('request_id, user_id, value')
				]);
			if (reqErr) throw reqErr;
			if (voteErr) throw voteErr;

			const items = (requests ?? []).map((r: any) => {
				const rv = (votes ?? []).filter((v: any) => v.request_id === r.id);
				return {
					id: r.id,
					title: r.title,
					detail: r.detail,
					status: r.status,
					created_at: r.created_at,
					mine: r.user_id === user.id,
					score: rv.reduce((s: number, v: any) => s + v.value, 0),
					up: rv.filter((v: any) => v.value === 1).length,
					down: rv.filter((v: any) => v.value === -1).length,
					myVote: rv.find((v: any) => v.user_id === user.id)?.value ?? 0
				};
			});
			return json({ success: true, items });
		}

		if (action === 'create') {
			const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
			const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, 2000) : '';
			if (title.length < 3) {
				return json(
					{ success: false, error: 'Give the request a title (at least 3 characters).' },
					{ status: 400 }
				);
			}
			const { data, error } = await locals.supabase
				.from('feature_requests')
				.insert({ user_id: user.id, title, detail })
				.select('id')
				.single();
			if (error) throw error;
			// The author's upvote comes with the request — a new idea starts at +1,
			// matching what every user-voice product does.
			await locals.supabase
				.from('feature_request_votes')
				.upsert(
					{ request_id: data.id, user_id: user.id, value: 1 },
					{ onConflict: 'request_id,user_id' }
				);
			return json({ success: true, id: data.id });
		}

		if (action === 'vote') {
			const id = typeof body.id === 'string' ? body.id : null;
			const value = body.value === 1 || body.value === -1 || body.value === 0 ? body.value : null;
			if (!id || value === null) {
				return json({ success: false, error: 'Missing id or vote value' }, { status: 400 });
			}
			if (value === 0) {
				const { error } = await locals.supabase
					.from('feature_request_votes')
					.delete()
					.eq('request_id', id)
					.eq('user_id', user.id);
				if (error) throw error;
			} else {
				const { error } = await locals.supabase
					.from('feature_request_votes')
					.upsert(
						{ request_id: id, user_id: user.id, value },
						{ onConflict: 'request_id,user_id' }
					);
				if (error) throw error;
			}
			return json({ success: true });
		}

		if (action === 'delete') {
			const id = typeof body.id === 'string' ? body.id : null;
			if (!id) return json({ success: false, error: 'Missing id' }, { status: 400 });
			// RLS restricts the delete to the caller's own rows; deleting someone
			// else's request is a silent no-op, which the count exposes honestly.
			const { error, count } = await locals.supabase
				.from('feature_requests')
				.delete({ count: 'exact' })
				.eq('id', id)
				.eq('user_id', user.id);
			if (error) throw error;
			if (!count) {
				return json(
					{ success: false, error: 'Not found, or this request is not yours to delete.' },
					{ status: 404 }
				);
			}
			return json({ success: true });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err: any) {
		if (missingTable(err)) {
			return json({ success: false, needsMigration: true, error: MIGRATION_HINT });
		}
		console.error('[feature-requests] action failed:', err);
		return json({ success: false, error: err?.message || 'Request failed' }, { status: 500 });
	}
};
