import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PROBLEM_REPORT_TITLE_PREFIX, TOPUP_PENDING_STATUS } from '$lib/server/topup-requests';

/**
 * Report a failed post to the operator.
 *
 * Every failure notice ended "if it keeps failing, tell us" and there was no
 * way to: no support address anywhere in the product, and the only public
 * surface was a feature-voting board other customers read. A round-2 re-audit
 * flagged the dead end.
 *
 * The report is a private `tickets` row (row-level security: the caller reads
 * and writes only their own), written through the caller's OWN client, so the
 * post lookup and the insert are both limited to what they can already see.
 * The platform admin reads open reports in the Admin Console (service role).
 * One report per post: a second click returns the first.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return json({ success: false, error: 'Sign in first.' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { postId?: unknown };
	const postId = typeof body.postId === 'string' && /^[0-9a-f-]{36}$/i.test(body.postId) ? body.postId : null;
	if (!postId) return json({ success: false, error: 'Which post? Open it and try again.' }, { status: 400 });

	// Only a post this account can read (RLS), and only a failed one.
	const { data: post } = await locals.supabase
		.from('posts')
		.select('id, status, content, platforms, created_at, agents(name)')
		.eq('id', postId)
		.maybeSingle();
	if (!post) return json({ success: false, error: 'That post is not available to you.' }, { status: 404 });
	if (post.status !== 'failed' && post.status !== 'partial') {
		return json({ success: false, error: 'Only a failed post can be reported here.' }, { status: 400 });
	}

	const title = `${PROBLEM_REPORT_TITLE_PREFIX} · post ${postId}`;
	// De-duplicated against OPEN reports only: once the operator marks one
	// handled, the same post can be reported again. Matching closed ones too
	// answered "Reported" while nothing reached the Admin list (pre-flight).
	const { data: existing } = await locals.supabase
		.from('tickets')
		.select('id, created_at')
		.eq('user_id', user.id)
		.eq('title', title)
		.eq('status', TOPUP_PENDING_STATUS)
		.limit(1)
		.maybeSingle();
	if (existing) return json({ success: true, duplicate: true });

	// What the customer saw — never raw provider text (the row only ever holds
	// the sanitised sentence; see failure-text.ts).
	const shown = (() => {
		try {
			const c = typeof post.content === 'string' ? JSON.parse(post.content) : post.content;
			return typeof c?.error === 'string' ? c.error.slice(0, 400) : '';
		} catch {
			return '';
		}
	})();
	const persona = (post as { agents?: { name?: string } | null }).agents?.name ?? 'a persona';
	const { error } = await locals.supabase.from('tickets').insert({
		user_id: user.id,
		title,
		description: `${user.email ?? user.id} reported a ${post.status} post for ${persona} (created ${post.created_at}).${shown ? ` They were shown: "${shown}"` : ''}`,
		status: TOPUP_PENDING_STATUS,
		priority: 'medium'
	});
	if (error) {
		console.error('[support/report-failure] insert failed:', error.message);
		return json({ success: false, error: 'The report could not be saved. Try again in a moment.' }, { status: 500 });
	}
	return json({ success: true, duplicate: false });
};
