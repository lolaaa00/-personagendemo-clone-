/**
 * Activity log — pseudonymous, append-only record of what users (and the
 * system on their behalf) did.
 *
 * Capture is fail-SOFT and never blocks a request (durable plan, D2): events
 * are queued in memory, flushed in batches through the service client, retried
 * once, and counted as dropped if the database stays unreachable. The dropped
 * counter is exposed on /api/health and the admin panel so blindness is
 * visible. On SIGTERM the queue is flushed via lifecycle.ts (D8).
 *
 * Nothing personal enters a row (D7): user UUID, hashed IP (daily salt +
 * pepper), browser FAMILY only, session hash, and a sanitised, size-capped
 * `meta` that drops emails, keys and long strings. Identity is resolved at
 * render time by admin routes through the service role.
 *
 * Switch: ACTIVITY_LOG=on (flags.ts). Off = every function here is a no-op.
 */

import { createHash } from 'node:crypto';
import { getServiceSupabase } from './service-supabase';
import { activityLogEnabled, activityPepper } from './flags';
import { onShutdown } from './lifecycle';

// ── vocabulary ───────────────────────────────────────────────────────────────
/** action → category. Typed so an unknown action does not compile. */
export const ACTIVITY_ACTIONS = {
	'auth.login.success': 'auth',
	'auth.login.failed': 'auth',
	'auth.logout': 'auth',
	'auth.signup': 'auth',
	'auth.signup.failed': 'auth',
	'auth.oauth.callback': 'auth',
	'auth.password.changed': 'auth',
	'auth.email.changed': 'auth',
	'account.deleted': 'auth',
	'nav.page.view': 'nav',
	'persona.created': 'persona',
	'persona.updated': 'persona',
	'persona.deleted': 'persona',
	'persona.avatar.generated': 'persona',
	'persona.kit.generated': 'persona',
	'persona.identity_kit.generated': 'persona',
	'post.generate.requested': 'generation',
	'post.generate.completed': 'generation',
	'post.generate.failed': 'generation',
	'post.refine.requested': 'generation',
	'post.deleted': 'publish',
	'post.restored': 'publish',
	'review.decision': 'review',
	'review.approved': 'review',
	'review.rejected': 'review',
	'publish.requested': 'publish',
	'publish.succeeded': 'publish',
	'publish.failed': 'publish',
	'autopilot.run.started': 'scheduler',
	'autopilot.run.finished': 'scheduler',
	'autopilot.slot.generated': 'scheduler',
	'autopilot.slot.failed': 'scheduler',
	'scheduler.publish.attempted': 'scheduler',
	'brief.saved': 'brief',
	'brief.scraped': 'brief',
	'settings.updated': 'settings',
	'settings.api_key.saved': 'settings',
	'settings.api_key.removed': 'settings',
	'settings.zernio_key.saved': 'settings',
	'team.workspace.created': 'team',
	'team.invite.sent': 'team',
	'team.invite.accepted': 'team',
	'team.invite.declined': 'team',
	'team.seat.updated': 'team',
	'team.seat.removed': 'team',
	'billing.credits.debited': 'billing',
	'billing.credits.blocked': 'billing',
	'billing.checkout.started': 'billing',
	'billing.purchase.completed': 'billing',
	'billing.welcome.withheld': 'billing',
	'billing.subscription.started': 'billing',
	'billing.subscription.renewed': 'billing',
	'billing.subscription.ended': 'billing',
	'admin.credits.granted': 'admin',
	'admin.credits.set': 'admin',
	'admin.credits.adjusted': 'admin',
	'admin.mode.changed': 'admin',
	'admin.user.viewed': 'admin',
	'admin.export.downloaded': 'admin',
	'admin.models.changed': 'admin',
	'admin.settings.changed': 'admin',
	'admin.persona_backfill.run': 'admin',
	'engine.action': 'engine',
	'api.request': 'api',
	'api.key.created': 'api',
	'api.key.revoked': 'api',
	'system.activity.dropped': 'system',
	'system.reconciliation': 'system',
	'system.maintenance': 'system'
} as const;

export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;
export type ActorKind = 'user' | 'api_key' | 'system' | 'admin' | 'anonymous';
export type Outcome = 'ok' | 'error' | 'denied' | 'blocked';

export function categoryFor(action: string): string {
	return (ACTIVITY_ACTIONS as Record<string, string>)[action] ?? 'api';
}

// ── request context reduction (no PII) ──────────────────────────────────────
export interface RequestContext {
	ipHash: string | null;
	country: string | null;
	uaFamily: string | null;
	device: string | null;
}

const UA_FAMILIES: Array<[RegExp, string]> = [
	[/\bEdg(e|A|iOS)?\/[\d.]+/i, 'Edge'],
	[/\bOPR\/|\bOpera\b/i, 'Opera'],
	[/\bSamsungBrowser\b/i, 'Samsung Internet'],
	[/\bFirefox\/|\bFxiOS\//i, 'Firefox'],
	[/\bCriOS\//i, 'Chrome'],
	[/\bChrome\/|\bChromium\//i, 'Chrome'],
	[/\bSafari\/.*\bVersion\/|\bVersion\/.*\bSafari\//i, 'Safari'],
	[/\bcurl\//i, 'curl'],
	[/\bPostmanRuntime\b/i, 'Postman'],
	[/\bnode\b|\bundici\b|\bnode-fetch\b/i, 'node'],
	[/\bpython-requests\b|\bhttpx\b|\baiohttp\b/i, 'python'],
	[/\bbot\b|\bcrawler\b|\bspider\b|\bslurp\b/i, 'bot']
];

export function reduceUserAgent(ua: string | null | undefined): { family: string | null; device: string | null } {
	if (!ua) return { family: null, device: null };
	let family: string | null = null;
	for (const [re, name] of UA_FAMILIES) {
		if (re.test(ua)) {
			family = name;
			break;
		}
	}
	let device: string;
	if (family === 'bot') device = 'bot';
	else if (family === 'curl' || family === 'node' || family === 'python' || family === 'Postman') device = 'api';
	else if (/\biPad\b|\bTablet\b|\bAndroid(?!.*Mobile)/i.test(ua)) device = 'tablet';
	else if (/\bMobi|\biPhone\b|\bAndroid.*Mobile/i.test(ua)) device = 'mobile';
	else device = family ? 'desktop' : 'unknown';
	return { family: family ?? 'other', device };
}

/** sha256(ip | day | pepper): correlates one client within a day, irreversible, not joinable across days. */
export function hashIp(ip: string | null | undefined, pepper: string, day = new Date()): string | null {
	if (!ip) return null;
	const d = day.toISOString().slice(0, 10);
	return createHash('sha256').update(`${ip}|${d}|${pepper}`).digest('hex').slice(0, 32);
}

export function subjectHash(userId: string | null | undefined, pepper: string): string {
	return createHash('sha256').update(`${userId ?? 'anonymous'}|${pepper}`).digest('hex').slice(0, 32);
}

export function sessionHashOf(token: string | null | undefined): string | null {
	if (!token) return null;
	return createHash('sha256').update(token).digest('hex').slice(0, 24);
}

function clientIp(request: Request): string | null {
	const h = request.headers;
	return (
		h.get('cf-connecting-ip') ||
		h.get('x-real-ip') ||
		(h.get('x-forwarded-for') || '').split(',')[0].trim() ||
		null
	);
}

export function requestContext(request: Request): RequestContext {
	const { family, device } = reduceUserAgent(request.headers.get('user-agent'));
	return {
		ipHash: hashIp(clientIp(request), pepperOrFallback()),
		country: request.headers.get('cf-ipcountry')?.slice(0, 2).toUpperCase() || null,
		uaFamily: family,
		device
	};
}

let warnedNoPepper = false;
function pepperOrFallback(): string {
	const p = activityPepper();
	if (p) return p;
	if (!warnedNoPepper) {
		warnedNoPepper = true;
		console.warn('[activity] ACTIVITY_PEPPER is not set — hashes use a static fallback. Set it in the environment.');
	}
	return 'personagen-activity-fallback-pepper';
}

// ── meta sanitiser ───────────────────────────────────────────────────────────
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SECRET_RE = /\b(pg_live_|sk-|key-|Bearer\s|eyJ[a-zA-Z0-9_-]{10,})/;
const MAX_STR = 200;
const MAX_KEYS = 24;

/** Drops emails, secrets, long strings, nested blobs; caps key count. Never throws. */
export function sanitizeMeta(meta: unknown): Record<string, unknown> {
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
	const out: Record<string, unknown> = {};
	let n = 0;
	for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
		if (n >= MAX_KEYS) break;
		const key = String(k).slice(0, 64);
		if (/email|password|token|secret|api_?key|authorization|prompt|caption|script/i.test(key)) continue;
		if (v === null || v === undefined) continue;
		if (typeof v === 'number' || typeof v === 'boolean') {
			out[key] = v;
			n++;
		} else if (typeof v === 'string') {
			if (v.length > MAX_STR || EMAIL_RE.test(v) || SECRET_RE.test(v)) continue;
			out[key] = v;
			n++;
		} else if (Array.isArray(v)) {
			const arr = v
				.filter((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')
				.map((x) => (typeof x === 'string' ? x.slice(0, 64) : x))
				.filter((x) => typeof x !== 'string' || (!EMAIL_RE.test(x) && !SECRET_RE.test(x)))
				.slice(0, 20);
			out[key] = arr;
			n++;
		}
		// nested objects are dropped
	}
	return out;
}

// ── the event ────────────────────────────────────────────────────────────────
export interface ActivityEvent {
	action: ActivityAction;
	userId?: string | null;
	actorKind?: ActorKind;
	targetUserId?: string | null;
	workspaceId?: string | null;
	agentId?: string | null;
	postId?: string | null;
	routeId?: string | null;
	method?: string | null;
	outcome?: Outcome;
	statusCode?: number | null;
	errorCode?: string | null;
	durationMs?: number | null;
	generationEventId?: string | null;
	creditLedgerId?: string | null;
	estCostUsd?: number | null;
	creditsDelta?: number | null;
	requestId?: string | null;
	sessionHash?: string | null;
	context?: RequestContext | null;
	meta?: Record<string, unknown>;
	/** Hash this id instead of userId (account deletion: row is anonymous, aggregate stays linked). */
	hashUserId?: string | null;
}

type Row = Record<string, unknown>;

function toRow(e: ActivityEvent): Row {
	const ctx = e.context ?? null;
	return {
		user_id: e.userId ?? null,
		subject_hash: subjectHash(e.hashUserId ?? e.userId, pepperOrFallback()),
		actor_kind: e.actorKind ?? (e.userId ? 'user' : 'anonymous'),
		target_user_id: e.targetUserId ?? null,
		workspace_id: e.workspaceId ?? null,
		agent_id: e.agentId ?? null,
		post_id: e.postId ?? null,
		category: categoryFor(e.action),
		action: e.action,
		route_id: e.routeId ?? null,
		method: e.method ?? null,
		outcome: e.outcome ?? 'ok',
		status_code: e.statusCode ?? null,
		error_code: e.errorCode ? String(e.errorCode).slice(0, 64) : null,
		duration_ms: e.durationMs != null ? Math.round(e.durationMs) : null,
		generation_event_id: e.generationEventId ?? null,
		credit_ledger_id: e.creditLedgerId ?? null,
		est_cost_usd: e.estCostUsd ?? null,
		credits_delta: e.creditsDelta ?? null,
		request_id: e.requestId ?? null,
		session_hash: e.sessionHash ?? null,
		ip_hash: ctx?.ipHash ?? null,
		country: ctx?.country ?? null,
		ua_family: ctx?.uaFamily ?? null,
		device: ctx?.device ?? null,
		meta: sanitizeMeta(e.meta)
	};
}

// ── queue ────────────────────────────────────────────────────────────────────
const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_AT = 200;
const MAX_BUFFER = 5_000;
const PRESENCE_THROTTLE_MS = 60_000;

interface PresenceRow {
	user_id: string;
	last_seen_at: string;
	last_route_id: string | null;
	last_ua_family: string | null;
	last_device: string | null;
	last_country: string | null;
	session_hash: string | null;
}

const state = {
	queue: [] as Row[],
	presence: new Map<string, PresenceRow>(),
	presenceLastWrite: new Map<string, number>(),
	timer: null as NodeJS.Timeout | null,
	flushing: false,
	flushed: 0,
	dropped: 0,
	droppedSince: Date.now(),
	lastError: null as string | null,
	lastFlushAt: null as string | null,
	installed: false
};

/** Injectable for tests. */
let clientFactory: () => any = () => getServiceSupabase();
export function _setActivityClientFactory(f: () => any) {
	clientFactory = f;
}
export function _resetActivityForTests() {
	state.queue.length = 0;
	state.presence.clear();
	state.presenceLastWrite.clear();
	state.flushed = 0;
	state.dropped = 0;
	state.lastError = null;
	state.flushing = false;
	if (state.timer) clearTimeout(state.timer);
	state.timer = null;
}

function install() {
	if (state.installed) return;
	state.installed = true;
	onShutdown('activity-queue', () => flushActivity());
}

function schedule() {
	if (state.timer) return;
	state.timer = setTimeout(() => {
		state.timer = null;
		void flushActivity();
	}, FLUSH_INTERVAL_MS);
	state.timer.unref?.();
}

export function enqueueActivity(e: ActivityEvent): void {
	if (!activityLogEnabled()) return;
	install();
	if (state.queue.length >= MAX_BUFFER) {
		state.dropped++;
		return;
	}
	state.queue.push(toRow(e));
	if (state.queue.length >= FLUSH_AT) void flushActivity();
	else schedule();
}

/** Throttled: at most one presence write per user per minute. */
export function touchPresence(userId: string, routeId: string | null, ctx: RequestContext | null, sessionHash: string | null): void {
	if (!activityLogEnabled() || !userId) return;
	install();
	const now = Date.now();
	const last = state.presenceLastWrite.get(userId) ?? 0;
	if (now - last < PRESENCE_THROTTLE_MS) return;
	state.presenceLastWrite.set(userId, now);
	state.presence.set(userId, {
		user_id: userId,
		last_seen_at: new Date(now).toISOString(),
		last_route_id: routeId,
		last_ua_family: ctx?.uaFamily ?? null,
		last_device: ctx?.device ?? null,
		last_country: ctx?.country ?? null,
		session_hash: sessionHash
	});
	schedule();
}

async function insertWithRetry(client: any, rows: Row[]): Promise<boolean> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const { error } = await client.from('user_activity_events').insert(rows);
			if (!error) return true;
			state.lastError = error.message ?? String(error);
			// A missing month partition would be caught by the DEFAULT partition;
			// anything else (network, RLS, schema) gets one retry.
		} catch (e) {
			state.lastError = (e as Error).message;
		}
	}
	return false;
}

export async function flushActivity(): Promise<void> {
	if (state.flushing) return;
	if (state.queue.length === 0 && state.presence.size === 0) return;
	state.flushing = true;
	try {
		let client: any;
		try {
			client = clientFactory();
		} catch (e) {
			state.lastError = (e as Error).message;
			state.dropped += state.queue.length;
			state.queue.length = 0;
			state.presence.clear();
			return;
		}
		if (state.queue.length > 0) {
			const batch = state.queue.splice(0, state.queue.length);
			const ok = await insertWithRetry(client, batch);
			if (ok) state.flushed += batch.length;
			else state.dropped += batch.length;
		}
		if (state.presence.size > 0) {
			const rows = [...state.presence.values()];
			state.presence.clear();
			try {
				const { error } = await client.from('user_presence').upsert(rows, { onConflict: 'user_id' });
				if (error) state.lastError = error.message ?? String(error);
			} catch (e) {
				state.lastError = (e as Error).message;
			}
		}
		state.lastFlushAt = new Date().toISOString();
	} finally {
		state.flushing = false;
		if (state.queue.length > 0) schedule();
	}
}

export function activityStats() {
	return {
		enabled: activityLogEnabled(),
		queued: state.queue.length,
		flushed: state.flushed,
		dropped: state.dropped,
		droppedSince: new Date(state.droppedSince).toISOString(),
		lastError: state.lastError,
		lastFlushAt: state.lastFlushAt
	};
}

// ── route → default action ───────────────────────────────────────────────────
/** Data-request suffix SvelteKit adds for client-side navigations. */
const DATA_SUFFIX = /\/__data\.json$/;

/** Polling / high-frequency GETs that would only add noise. */
export const ACTIVITY_SKIP_ROUTES = new Set<string>([
	'/api/health',
	'/api/posts',
	'/api/agent/[agentId]/post-observability',
	'/api/agent/[agentId]/spend',
	'/api/analytics',
	'/api/voices',
	'/media/[...path]'
]);

export function shouldLog(routeId: string | null, method: string, pathname: string): boolean {
	if (!routeId) return false;
	if (pathname.startsWith('/_app/') || pathname.startsWith('/media/')) return false;
	if (ACTIVITY_SKIP_ROUTES.has(routeId) && method === 'GET') return false;
	if (routeId === '/api/health') return false;
	if (routeId.startsWith('/api/')) return method !== 'GET' || routeId.startsWith('/api/auth/');
	// Page loads (SSR and client-side __data.json) under the app's route groups.
	return method === 'GET' && (routeId.startsWith('/(portal)') || routeId.startsWith('/(auth)') || routeId === '/');
}

/** Default action for a request the route itself did not describe. */
export function routeAction(
	routeId: string,
	method: string,
	status: number
): { action: ActivityAction; meta: Record<string, unknown> } {
	if (routeId.startsWith('/(portal)') || routeId.startsWith('/(auth)') || routeId === '/') {
		return { action: 'nav.page.view', meta: { page: routeId.replace(/^\/\((portal|auth)\)/, '') || '/' } };
	}
	if (routeId === '/api/auth/login') return { action: status < 400 ? 'auth.login.success' : 'auth.login.failed', meta: {} };
	if (routeId === '/api/auth/signup') return { action: status < 400 ? 'auth.signup' : 'auth.signup.failed', meta: {} };
	if (routeId === '/api/auth/logout') return { action: 'auth.logout', meta: {} };
	if (routeId === '/api/auth/callback') return { action: 'auth.oauth.callback', meta: {} };
	if (routeId === '/api/agent/[agentId]/generate-post' && method === 'POST') return { action: 'post.generate.requested', meta: {} };
	if (routeId === '/api/agent/[agentId]/refine-post') return { action: 'post.refine.requested', meta: {} };
	if (routeId === '/api/agent/[agentId]/generate-avatar') return { action: 'persona.avatar.generated', meta: {} };
	if (routeId === '/api/agent/[agentId]/generate-reference-kit') return { action: 'persona.kit.generated', meta: {} };
	if (routeId === '/api/agent/[agentId]/publish-post') return { action: 'publish.requested', meta: {} };
	if (routeId === '/api/review') return { action: 'review.decision', meta: {} };
	if (routeId === '/api/agents' && method === 'POST') return { action: 'persona.created', meta: {} };
	if (routeId === '/api/agents' && method === 'DELETE') return { action: 'persona.deleted', meta: {} };
	if (routeId === '/api/agents/config') return { action: 'persona.updated', meta: {} };
	if (routeId === '/api/engine') return { action: 'engine.action', meta: {} };
	if (routeId.startsWith('/api/settings/api-keys')) return { action: method === 'DELETE' ? 'settings.api_key.removed' : 'settings.api_key.saved', meta: {} };
	if (routeId.startsWith('/api/settings/zernio-keys')) return { action: 'settings.zernio_key.saved', meta: {} };
	if (routeId.startsWith('/api/settings/')) return { action: 'settings.updated', meta: { section: routeId.split('/').pop() } };
	if (routeId.startsWith('/api/workspaces/invites/[token]/accept')) return { action: 'team.invite.accepted', meta: {} };
	if (routeId.startsWith('/api/workspaces/invites/[token]/decline')) return { action: 'team.invite.declined', meta: {} };
	if (routeId.startsWith('/api/workspaces/[id]/invites')) return { action: 'team.invite.sent', meta: {} };
	if (routeId.startsWith('/api/workspaces/[id]/members')) return { action: method === 'DELETE' ? 'team.seat.removed' : 'team.seat.updated', meta: {} };
	if (routeId === '/api/workspaces' && method === 'POST') return { action: 'team.workspace.created', meta: {} };
	if (routeId === '/api/admin/credits' && method === 'POST') return { action: 'admin.credits.adjusted', meta: {} };
	if (routeId === '/api/billing/checkout') return { action: 'billing.checkout.started', meta: {} };
	if (routeId === '/api/admin/credits') return { action: 'admin.user.viewed', meta: {} };
	if (routeId === '/api/models') return { action: 'admin.models.changed', meta: {} };
	if (routeId === '/api/developer/keys') return { action: method === 'DELETE' ? 'api.key.revoked' : 'api.key.created', meta: {} };
	if (routeId === '/api/account/delete') return { action: 'account.deleted', meta: {} };
	return { action: 'api.request', meta: { route: routeId } };
}

export function outcomeFor(status: number): Outcome {
	if (status === 401 || status === 403) return 'denied';
	if (status === 402 || status === 429) return 'blocked';
	if (status >= 400) return 'error';
	return 'ok';
}

export function isDataRequest(pathname: string): boolean {
	return DATA_SUFFIX.test(pathname);
}

// ── convenience emitters ─────────────────────────────────────────────────────
type LocalsLike = {
	requestId?: string;
	activityContext?: RequestContext | null;
	activitySessionHash?: string | null;
};

/** Domain event from inside a route handler; rides the request's id/context. */
export function logActivity(
	locals: LocalsLike,
	userId: string | null | undefined,
	e: Omit<ActivityEvent, 'userId' | 'requestId' | 'context' | 'sessionHash'>
): void {
	enqueueActivity({
		...e,
		userId: userId ?? null,
		requestId: locals.requestId ?? null,
		context: locals.activityContext ?? null,
		sessionHash: locals.activitySessionHash ?? null
	});
}

/** Background actors (scheduler, autopilot): no request, attributed to the persona owner. */
export function logSystemActivity(e: Omit<ActivityEvent, 'actorKind' | 'context' | 'requestId'> & { requestId?: string | null }): void {
	enqueueActivity({ ...e, actorKind: 'system', context: null });
}
