import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const flags = await import('./flags');

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('flags — every switch defaults to today\'s behaviour', () => {
	it('CREDITS_ENFORCE defaults to off and only accepts shadow|enforce', () => {
		expect(flags.creditsMode()).toBe('off');
		mockEnv.CREDITS_ENFORCE = 'SHADOW';
		expect(flags.creditsMode()).toBe('shadow');
		mockEnv.CREDITS_ENFORCE = 'enforce';
		expect(flags.creditsMode()).toBe('enforce');
		mockEnv.CREDITS_ENFORCE = 'yes';
		expect(flags.creditsMode()).toBe('off');
	});

	it('ACTIVITY_LOG defaults off; on/true/1 enable it', () => {
		expect(flags.activityLogEnabled()).toBe(false);
		for (const v of ['on', 'true', '1', 'ON']) {
			mockEnv.ACTIVITY_LOG = v;
			expect(flags.activityLogEnabled()).toBe(true);
		}
		mockEnv.ACTIVITY_LOG = 'off';
		expect(flags.activityLogEnabled()).toBe(false);
	});

	it('CREDIT_MARKUP defaults to 1 (at cost) and only accepts 1–20', () => {
		expect(flags.creditMarkup()).toBe(1);
		mockEnv.CREDIT_MARKUP = '3';
		expect(flags.creditMarkup()).toBe(3);
		expect(flags.creditMarkupSource()).toBe('env');
		mockEnv.CREDIT_MARKUP = '0.5';
		expect(flags.creditMarkup()).toBe(1);
		mockEnv.CREDIT_MARKUP = '99';
		expect(flags.creditMarkup()).toBe(1);
		mockEnv.CREDIT_MARKUP = 'lots';
		expect(flags.creditMarkup()).toBe(1);
	});

	it('PLATFORM_ADMIN_EMAILS is a trimmed, lower-cased list', () => {
		expect(flags.platformAdminEmails()).toEqual([]);
		mockEnv.PLATFORM_ADMIN_EMAILS = ' Owner@Example.com, ops@example.com ,,';
		expect(flags.platformAdminEmails()).toEqual(['owner@example.com', 'ops@example.com']);
	});

	it('is read at call time, not import time', () => {
		expect(flags.creditsMode()).toBe('off');
		mockEnv.CREDITS_ENFORCE = 'enforce';
		expect(flags.creditsMode()).toBe('enforce');
	});

	it('retention defaults to 180 days and rejects junk', () => {
		expect(flags.activityRetentionDays()).toBe(180);
		mockEnv.ACTIVITY_RETENTION_DAYS = '30';
		expect(flags.activityRetentionDays()).toBe(30);
		mockEnv.ACTIVITY_RETENTION_DAYS = '-5';
		expect(flags.activityRetentionDays()).toBe(180);
	});
});
