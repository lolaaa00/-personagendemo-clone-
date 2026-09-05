import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { isPlatformAdmin, requirePlatformAdmin } = await import('./platform-admin');

const user = (email: string, id = 'u-1') => ({ id, email }) as any;
const rpc = (result: { data?: any; error?: any } | Error) => ({
	rpc: vi.fn(async () => {
		if (result instanceof Error) throw result;
		return result;
	})
});

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('isPlatformAdmin', () => {
	it('is false for no user', async () => {
		expect(await isPlatformAdmin(rpc({ data: true }), null)).toBe(false);
	});

	it('env bootstrap list grants admin without touching the DB', async () => {
		mockEnv.PLATFORM_ADMIN_EMAILS = 'Ops@Example.com';
		const sb = rpc({ data: false });
		expect(await isPlatformAdmin(sb, user('ops@example.com'))).toBe(true);
		expect(sb.rpc).not.toHaveBeenCalled();
	});

	it('a platform_admins row grants admin via is_platform_admin()', async () => {
		const sb = rpc({ data: true });
		expect(await isPlatformAdmin(sb, user('someone@example.com'))).toBe(true);
		expect(sb.rpc).toHaveBeenCalledWith('is_platform_admin', { p_user: 'u-1' });
	});

	it('fails CLOSED on rpc error or throw', async () => {
		expect(await isPlatformAdmin(rpc({ error: { message: 'boom' } }), user('a@b.c'))).toBe(false);
		expect(await isPlatformAdmin(rpc(new Error('network')), user('a@b.c'))).toBe(false);
	});

	it('anything but a literal true is not admin', async () => {
		expect(await isPlatformAdmin(rpc({ data: 'true' }), user('a@b.c'))).toBe(false);
		expect(await isPlatformAdmin(rpc({ data: null }), user('a@b.c'))).toBe(false);
	});
});

describe('requirePlatformAdmin', () => {
	it('401 without a session', async () => {
		const res = await requirePlatformAdmin({
			supabase: rpc({ data: true }),
			safeGetSession: async () => ({ session: null, user: null })
		});
		expect(res).toEqual({ ok: false, status: 401, message: 'Unauthorized' });
	});

	it('403 for a signed-in non-admin', async () => {
		const res = await requirePlatformAdmin({
			supabase: rpc({ data: false }),
			safeGetSession: async () => ({ session: {}, user: user('x@y.z') })
		});
		expect(res.ok).toBe(false);
		expect((res as any).status).toBe(403);
	});

	it('ok with the user for an admin', async () => {
		const res = await requirePlatformAdmin({
			supabase: rpc({ data: true }),
			safeGetSession: async () => ({ session: {}, user: user('x@y.z') })
		});
		expect(res.ok).toBe(true);
		expect((res as any).user.id).toBe('u-1');
	});
});
