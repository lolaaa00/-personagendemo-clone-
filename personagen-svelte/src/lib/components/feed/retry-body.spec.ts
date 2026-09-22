/**
 * Retry rebuilds what the failed post set out to do — and says only what it
 * actually carried. Round-2 re-audit: an Instagram-only post scheduled for
 * 10:05 retried as Instagram + Threads, unscheduled, under "the failed post's
 * settings are filled in".
 */
import { describe, it, expect } from 'vitest';
import { retryBodyFromFailedPost, retryCarriedSummary } from './postDisplay';

const content = JSON.stringify({ topic: 'Morning rituals', intended: { media: 'image', format: 'photo' } });
const now = new Date('2026-09-22T08:00:00');

describe('retryBodyFromFailedPost', () => {
	it('carries the platforms the failed post targeted', () => {
		const body = retryBodyFromFailedPost({ content, platforms: ['instagram'] }, now);
		expect(body?.platforms).toEqual(['instagram']);
	});

	it('carries a schedule that is still ahead', () => {
		const body = retryBodyFromFailedPost(
			{ content, platforms: ['instagram'], scheduled_date: '2026-09-22', scheduled_time: '10:05:00' },
			now
		);
		expect(body?.scheduled_date).toBe('2026-09-22');
		expect(body?.scheduled_time).toBe('10:05');
	});

	it('does not carry a schedule that has passed (no accidental "post now")', () => {
		const body = retryBodyFromFailedPost(
			{ content, scheduled_date: '2026-09-21', scheduled_time: '10:05:00' },
			now
		);
		expect(body?.scheduled_date).toBeUndefined();
		expect(body?.scheduled_time).toBeUndefined();
	});

	it('keeps the format and topic, and refuses a row it cannot rebuild', () => {
		expect(retryBodyFromFailedPost({ content }, now)).toMatchObject({
			media: 'image',
			format: 'photo',
			topic: 'Morning rituals'
		});
		expect(retryBodyFromFailedPost({ content: '{}' }, now)).toBeNull();
	});
});

describe('retryCarriedSummary', () => {
	it('names exactly what was carried', () => {
		const body = retryBodyFromFailedPost(
			{ content, platforms: ['instagram'], scheduled_date: '2026-09-22', scheduled_time: '10:05' },
			now
		)!;
		expect(retryCarriedSummary(body)).toMatch(/format, topic, platforms and schedule are filled in/);
	});

	it('says when the original time has passed instead of implying it was kept', () => {
		const failed = { content, scheduled_date: '2026-09-21', scheduled_time: '10:05' };
		const body = retryBodyFromFailedPost(failed, now)!;
		const text = retryCarriedSummary(body, failed);
		expect(text).not.toMatch(/schedule are/);
		expect(text).toMatch(/original time has passed/);
	});

	it('never claims "settings" wholesale', () => {
		const body = retryBodyFromFailedPost({ content: JSON.stringify({ intended: { media: 'video' } }) }, now)!;
		expect(retryCarriedSummary(body)).toMatch(/^The failed post’s format is filled in below\./);
	});
});
