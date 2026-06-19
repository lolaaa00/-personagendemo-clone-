import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';

// GET: List all sessions for a specific agent and user
export const GET: RequestHandler = async ({ params, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	try {
		const { data: sessions, error } = await db.chatSessions.listForAgent(agentId, user.id);
		if (error) throw error;
		return json({ success: true, sessions });
	} catch (err) {
		console.error('[Sessions API] Error listing sessions:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

// POST: Create a new chat session for an agent
export const POST: RequestHandler = async ({ params, locals, request }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const agentId = params.agentId;
	if (!agentId) {
		return json({ success: false, error: 'Missing agentId' }, { status: 400 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const title = body.title || 'New Chat';
	const db = createDbService(locals.supabase);
	try {
		// Verify agent exists and belongs to the user
		const { data: agent, error: agentErr } = await db.agents.get(agentId);
		if (agentErr || !agent) {
			return json({ success: false, error: 'Agent not found' }, { status: 404 });
		}
		if (agent.user_id !== user.id) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const { data: session, error } = await db.chatSessions.create({
			user_id: user.id,
			agent_id: agentId,
			title
		});
		if (error) throw error;
		return json({ success: true, session });
	} catch (err) {
		console.error('[Sessions API] Error creating session:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

// PATCH: Rename a chat session
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	const { sessionId, title } = body;
	if (!sessionId || !title) {
		return json({ success: false, error: 'Missing sessionId or title' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	try {
		// First verify owner and agent match
		const { data: session, error: getErr } = await db.chatSessions.get(sessionId);
		if (getErr || !session) {
			return json({ success: false, error: 'Session not found' }, { status: 404 });
		}
		if (session.user_id !== user.id || session.agent_id !== params.agentId) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const { data: updatedSession, error: updateErr } = await db.chatSessions.update(sessionId, {
			title
		});
		if (updateErr) throw updateErr;

		return json({ success: true, session: updatedSession });
	} catch (err) {
		console.error('[Sessions API] Error renaming session:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

// DELETE: Delete a chat session and all its messages (cascade)
export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const sessionId = url.searchParams.get('sessionId');
	if (!sessionId) {
		return json({ success: false, error: 'Missing sessionId query param' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);
	try {
		// First verify owner and agent match
		const { data: session, error: getErr } = await db.chatSessions.get(sessionId);
		if (getErr || !session) {
			return json({ success: false, error: 'Session not found' }, { status: 404 });
		}
		if (session.user_id !== user.id || session.agent_id !== params.agentId) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const { error: deleteErr } = await db.chatSessions.delete(sessionId);
		if (deleteErr) throw deleteErr;

		return json({ success: true });
	} catch (err) {
		console.error('[Sessions API] Error deleting session:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
