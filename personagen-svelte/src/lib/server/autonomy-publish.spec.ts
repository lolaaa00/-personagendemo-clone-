/**
 * A persona only publishes by itself when its owner said it may.
 *
 * generate-post used to publish the moment generation finished, without ever
 * reading autonomy_level. Every connected account in production (2026-09-09:
 * four, across Instagram and TikTok) belongs to a persona set to 'advisor'
 * ("suggests") or 'semi_autonomous' ("drafts and waits for you"), and the
 * pricing page sells "You approve before it posts" — so clicking Generate on
 * any of them posted live, unreviewed, to a real account.
 *
 * The rule is pinned here rather than only in the route, because the route's
 * delivery block is being rewritten by concurrent work and this is the part of
 * it that must not be lost: what may publish itself, and what a held post
 * becomes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The decision the route makes. Mirrors the guard; asserted against it below. */
function mayPublishItself(autonomy: string | null | undefined, publishNow: boolean): boolean {
	return String(autonomy ?? 'advisor') === 'fully_autonomous' || publishNow === true;
}

describe('who may publish without a human', () => {
	it('only a fully autonomous persona publishes on its own', () => {
		expect(mayPublishItself('fully_autonomous', false)).toBe(true);
		expect(mayPublishItself('advisor', false)).toBe(false);
		expect(mayPublishItself('semi_autonomous', false)).toBe(false);
	});

	it('an unreadable or missing setting is treated as advisor, the safest level', () => {
		expect(mayPublishItself(null, false)).toBe(false);
		expect(mayPublishItself(undefined, false)).toBe(false);
		expect(mayPublishItself('', false)).toBe(false);
		expect(mayPublishItself('something_new', false)).toBe(false);
	});

	it('an explicit publish_now is the deliberate "post this now" action, at any level', () => {
		expect(mayPublishItself('advisor', true)).toBe(true);
		expect(mayPublishItself('semi_autonomous', true)).toBe(true);
	});
});

describe('the route implements that rule', () => {
	const route = readFileSync(
		join(__dirname, '..', '..', 'routes', 'api', 'agent', '[agentId]', 'generate-post', '+server.ts'),
		'utf8'
	);

	it('reads autonomy_level before deciding to publish', () => {
		expect(route).toContain("select('autonomy_level')");
		expect(route).toContain("autonomy === 'fully_autonomous' || body.publish_now === true");
	});

	it('holds a post as a DRAFT, never as a scheduled row dated today', () => {
		// A 'scheduled' row with today's date is published by the scheduler's
		// 60-second poll, so holding one that way would leak the same post out a
		// minute later by another path.
		const guard = route.slice(route.indexOf('const mayPublishItself'), route.indexOf("status: 'scheduled'"));
		expect(guard).toContain("status: 'draft'");
		expect(guard).not.toContain('scheduled_date');
		expect(guard).toContain('held for review');
	});

	it('still publishes immediately when it is allowed to', () => {
		expect(route).toContain('await publishPostById(postId);');
	});
});
