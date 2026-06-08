import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';

export const POST: RequestHandler = async ({ url, request, locals }) => {
	// Secure check: only allow authenticated users to hit n8n webhooks
	const { session } = await locals.safeGetSession();
	if (!session) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const path = url.searchParams.get('path');
	if (!path) {
		return json({ success: false, error: 'Missing path parameter' }, { status: 400 });
	}

	try {
		const body = await request.json() as any;
		const n8nBase = env.PUBLIC_N8N_URL || 'https://auto.l2gseo.com';
		const n8nUrl = `${n8nBase}/webhook/${path}`;

		const res = await fetch(n8nUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			throw new Error(`n8n webhook returned HTTP ${res.status}`);
		}

		const data = await res.json();
		return json(data);
	} catch (err) {
		console.error(`[n8n Proxy] Forwarding to ${path} failed:`, err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
