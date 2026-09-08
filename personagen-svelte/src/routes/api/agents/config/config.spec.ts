/**
 * Persona profile save path (Persona Model v2, P0.5).
 *
 * Pins the storage flip: a v1 form posted by the persona page is stored as a
 * v2 blob with provenance, merged over whatever was there (v1 or v2) without
 * losing fields the patch does not mention. This is the route-level version
 * of the data-loss regression guard that used to live only in the v1 store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PersonaProfileV2 } from '$lib/persona-contract/schema';

const { updates, agentRow } = vi.hoisted(() => ({
	updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
	agentRow: { value: null as null | Record<string, unknown> }
}));

vi.mock('$lib/server/db', () => ({
	createDbService: () => ({
		agents: {
			get: async () => ({ data: agentRow.value, error: null }),
			update: async (id: string, payload: Record<string, unknown>) => {
				updates.push({ id, payload });
				return { data: null, error: null };
			}
		},
		agentConfigs: { mergeUpsert: async () => ({ data: null, error: null }) }
	})
}));
vi.mock('$lib/server/workspaces', () => ({
	checkAgentAccess: async () => ({ ok: true })
}));
vi.mock('$lib/server/personas-profile-column', () => ({
	writeWithProfileFallback: async (payload: Record<string, unknown>, write: (p: Record<string, unknown>) => Promise<unknown>) => write(payload)
}));

const { POST } = await import('./+server');

function event(body: Record<string, unknown>) {
	return {
		request: { json: async () => body },
		locals: {
			safeGetSession: async () => ({ session: { user: { id: 'user-1' } }, user: { id: 'user-1' } }),
			supabase: {}
		}
	} as never;
}

const V1_STORED = {
	ageRanges: ['25–34'],
	gender: 'female',
	archetype: 'The Educator',
	appearance: { hairColor: 'honey blonde', wardrobe: 'linen' },
	bios: { tiktok: 'old bio' },
	displayName: 'Jenny Tran'
};

beforeEach(() => {
	updates.length = 0;
	agentRow.value = { id: 'agent-1', user_id: 'user-1', personas_profile: V1_STORED, market: JSON.stringify(V1_STORED) };
});

describe('POST /api/agents/config — personaProfile', () => {
	it('stores a v2 blob with provenance when the page posts its v1 form', async () => {
		const res = await POST(event({ agentId: 'agent-1', personaProfile: { bios: { tiktok: 'new bio' } } }));
		expect(res.status).toBe(200);
		expect(updates).toHaveLength(1);
		const stored = updates[0].payload.personas_profile as PersonaProfileV2;
		expect(stored.meta.schemaVersion).toBe(2);
		expect(stored.meta.generator).toBe('manual');
		expect(typeof stored.meta.generatedAt).toBe('string');
		// The patch landed…
		expect(stored.identityKit?.bios).toEqual({ tiktok: 'new bio' });
		expect(stored.meta.fieldSources?.['identityKit.bios']).toBe('user');
		// …and NOTHING the patch didn't mention was lost (the original data-loss bug).
		expect(stored.strategy?.archetype).toBe('educator');
		expect(stored.look?.hair?.colorText).toBe('honey blonde');
		expect(stored.look?.wardrobe).toBe('linen');
		expect(stored.creator?.displayName).toBe('Jenny Tran');
		expect(stored.audience?.ageRanges).toEqual(['25_34']);
		// P0.6: the profile lives ONLY in personas_profile — `market` is a market
		// string again and a profile save must not touch it.
		expect(updates[0].payload).not.toHaveProperty('market');
	});

	it('accepts the legacy stringified transport', async () => {
		const res = await POST(event({ agentId: 'agent-1', personaProfile: JSON.stringify({ archetype: '  the creator ' }) }));
		expect(res.status).toBe(200);
		const stored = updates[0].payload.personas_profile as PersonaProfileV2;
		expect(stored.strategy?.archetype).toBe('creator');
		expect(stored.identityKit?.bios).toEqual({ tiktok: 'old bio' });
	});

	it('keeps the v1 gate semantics: a named target avatar is stripped, an off-list archetype is kept verbatim', async () => {
		await POST(
			event({
				agentId: 'agent-1',
				personaProfile: { targetAvatar: 'Beatrice, a 36-year-old mom who audits every ingredient', archetype: 'Mentor' }
			})
		);
		const stored = updates[0].payload.personas_profile as PersonaProfileV2;
		expect(stored.audience?.targetAvatar).toBe('A 36-year-old mom who audits every ingredient');
		expect(stored.strategy?.archetype).toBeUndefined();
		expect(stored.strategy?.archetypeText).toBe('Mentor');
	});

	it('merges over an EXISTING v2 blob and preserves sampled provenance on unchanged values', async () => {
		agentRow.value = {
			id: 'agent-1',
			user_id: 'user-1',
			personas_profile: {
				meta: { schemaVersion: 2, fieldSources: { 'creator.age': 'sampled', 'creator.work.title': 'sampled' } },
				creator: { age: 34, work: { title: 'Physiotherapist' }, displayName: 'Jenny' },
				strategy: { archetype: 'educator' }
			}
		};
		// The page re-sends displayName unchanged and changes the archetype.
		await POST(event({ agentId: 'agent-1', personaProfile: { displayName: 'Jenny', archetype: 'The Creator' } }));
		const stored = updates[0].payload.personas_profile as PersonaProfileV2;
		expect(stored.creator?.age).toBe(34);
		expect(stored.meta.fieldSources?.['creator.age']).toBe('sampled');
		expect(stored.creator?.work?.title).toBe('Physiotherapist');
		expect(stored.strategy?.archetype).toBe('creator');
		expect(stored.meta.fieldSources?.['strategy.archetype']).toBe('user');
		expect(stored.meta.fieldSources?.['creator.displayName']).toBe('user');
	});

	it('an explicit empty clears; omitted personaProfile writes nothing to the profile', async () => {
		await POST(event({ agentId: 'agent-1', personaProfile: { bios: {} } }));
		const stored = updates[0].payload.personas_profile as PersonaProfileV2;
		expect(stored.identityKit).toBeUndefined();
		expect(stored.strategy?.archetype).toBe('educator');

		updates.length = 0;
		await POST(event({ agentId: 'agent-1', name: 'Renamed' }));
		expect(updates[0].payload.personas_profile).toBeUndefined();
		expect(updates[0].payload.name).toBe('Renamed');
	});

	it('the v1 reader sees the stored v2 blob as the same v1 profile the page expects', async () => {
		const { readPersonaProfile } = await import('$lib/persona-profile-store');
		await POST(event({ agentId: 'agent-1', personaProfile: { contentFocus: 'Tutorials & Demos' } }));
		const stored = updates[0].payload.personas_profile;
		const v1 = readPersonaProfile({ personas_profile: stored });
		expect(v1.archetype).toBe('The Educator');
		expect(v1.contentFocus).toBe('Tutorials & Demos');
		expect(v1.appearance).toEqual({ hairColor: 'honey blonde', wardrobe: 'linen' });
		expect(v1.ageRanges).toEqual(['25–34']);
		expect(v1.ageMin).toBe(25);
		expect(v1.bios).toEqual({ tiktok: 'old bio' });
	});
});
