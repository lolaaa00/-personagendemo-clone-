import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { POST } from './+server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load .env variables into process.env manually before any imports run,
// to ensure SvelteKit's dynamic env has them
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
	const envContent = fs.readFileSync(envPath, 'utf-8');
	envContent.split('\n').forEach((line) => {
		const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (match) {
			let val = match[2].trim();
			if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
			if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
			process.env[match[1]] = val;
		}
	});
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const testUserId = '1a0b8d42-89e9-4e94-bc4e-ee6f58ff7159'; // Sofia Rivera's user_id from check-auth

const dbClient = createClient(supabaseUrl, serviceRoleKey, {
	auth: { autoRefreshToken: false, persistSession: false }
});

describe('Engine Local Endpoint End-to-End Tests', { timeout: 30000 }, () => {
	let createdAgentId: string | null = null;
	let createdPostId: string | null = null;

	// Cleanup any potential leftovers from crashed tests
	beforeAll(async () => {
		expect(supabaseUrl).toBeTruthy();
		expect(serviceRoleKey).toBeTruthy();
	});

	afterAll(async () => {
		// Clean up created agent
		if (createdAgentId) {
			console.log(`[Test Cleanup] Deleting test agent: ${createdAgentId}`);
			await dbClient.from('agent_configs').delete().eq('agent_id', createdAgentId);
			await dbClient.from('agents').delete().eq('id', createdAgentId);
		}
		// Clean up created post
		if (createdPostId) {
			console.log(`[Test Cleanup] Deleting test post: ${createdPostId}`);
			await dbClient.from('posts').delete().eq('id', createdPostId);
		}
	});

	// Helper to build SvelteKit request mock event
	function createMockEvent(pathParam: string, body: any) {
		const url = new URL(`http://localhost/api/engine?path=${pathParam}`);
		const req = new Request(url.href, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		const mockLocals = {
			supabase: dbClient,
			safeGetSession: async () => ({
				session: {
					user: { id: testUserId },
					access_token: 'mock-access-token'
				},
				user: { id: testUserId }
			})
		};

		return {
			url,
			request: req,
			locals: mockLocals,
			cookies: {} as any,
			params: {},
			route: { id: '/api/engine' },
			isSubRequest: false,
			isDataRequest: false,
			platform: {}
		} as any;
	}

	// 1. Account Factory Tests
	describe('PATH: personagen-account-factory', () => {
		it('should create an agent and config in database', async () => {
			const body = {
				action: 'create_account',
				persona: {
					name: 'Vitest Automated Agent',
					handle: '@vitest_agent_test',
					niche: 'SaaS Engineering',
					soul: 'Analytical, efficient, and precise.',
					skills: 'Continuous integration, automated unit testing, static analysis.',
					market: 'US',
					gradient: 'from-blue-600 to-cyan-500',
					initial: 'V'
				}
			};

			const event = createMockEvent('personagen-account-factory', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.accountId).toBeTruthy();
			expect(resJson.data.status).toBe('active');

			createdAgentId = resJson.data.accountId;

			// Verify in DB that agent row was created
			const { data: agentRow, error: agentErr } = await dbClient
				.from('agents')
				.select('*')
				.eq('id', createdAgentId)
				.single();

			expect(agentErr).toBeNull();
			expect(agentRow).toBeTruthy();
			expect(agentRow.name).toBe(body.persona.name);
			expect(agentRow.handle).toBe(body.persona.handle);

			// Verify in DB that config row was created
			const { data: configRow, error: configErr } = await dbClient
				.from('agent_configs')
				.select('*')
				.eq('agent_id', createdAgentId)
				.single();

			expect(configErr).toBeNull();
			expect(configRow).toBeTruthy();
			expect(configRow.autonomy_level).toBe('semi_autonomous');
		});

		it('should handle status check', async () => {
			const event = createMockEvent('personagen-account-factory', { action: 'check_status' });
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.status).toBe('active');
			expect(resJson.data.progress).toBe(100);
		});
	});

	// 2. Channel Decode Tests
	describe('PATH: personagen-channel-decode', () => {
		it('should run strategy audits and return a 9-layer scorecard', async () => {
			const body = {
				action: 'decode',
				url: 'https://youtube.com/c/Fireship',
				platform: 'youtube'
			};

			const event = createMockEvent('personagen-channel-decode', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.channelName).toBe('Fireship');
			expect(resJson.data.platform).toBe('youtube');
			expect(typeof resJson.data.overallScore).toBe('number');
			expect(resJson.data.layers).toBeInstanceOf(Array);
			expect(resJson.data.layers.length).toBe(9);

			// Validate schema of layers
			resJson.data.layers.forEach((layer: any) => {
				expect(layer.title).toBeTruthy();
				expect(typeof layer.score).toBe('number');
				expect(layer.findings).toBeInstanceOf(Array);
				expect(layer.findings.length).toBeGreaterThan(0);
				expect(typeof layer.confidence).toBe('number');
			});
		});
	});

	// 3. Content Forge Tests
	describe('PATH: personagen-content-forge', () => {
		it('should forge a standard post copy with hashtags and hook score', async () => {
			const body = {
				action: 'generate',
				topic: 'Mastering TypeScript in 2026',
				platforms: ['x']
			};

			const event = createMockEvent('personagen-content-forge', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.type).toBe('post');
			expect(resJson.data.platform).toBe('x');
			expect(resJson.data.content).toContain('TypeScript');
			expect(resJson.data.hashtags).toBeInstanceOf(Array);
			expect(typeof resJson.data.hookScore).toBe('number');
		});

		it('should forge a structured script', async () => {
			const body = {
				action: 'script',
				topic: 'Why Svelte 5 is amazing',
				platforms: ['youtube']
			};

			const event = createMockEvent('personagen-content-forge', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.type).toBe('script');
			expect(resJson.data.content).toBeTruthy();
			expect(typeof resJson.data.hookScore).toBe('number');
		});

		it('should forge brainstormed titles', async () => {
			const body = {
				action: 'titles',
				topic: 'How to build AI agents',
				platforms: ['tiktok']
			};

			const event = createMockEvent('personagen-content-forge', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.type).toBe('titles');
			expect(resJson.data.titles).toBeInstanceOf(Array);
			expect(resJson.data.titles.length).toBe(8);
		});

		it('should forge thumbnail briefs', async () => {
			const body = {
				action: 'thumbnail_brief',
				topic: 'The future of remote work',
				platforms: ['youtube']
			};

			const event = createMockEvent('personagen-content-forge', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.type).toBe('thumbnail');
			expect(resJson.data.thumbnailNotes).toBeInstanceOf(Array);
			expect(resJson.data.thumbnailNotes.length).toBe(6);
		});
	});

	// 4. AI Generate Tests
	describe('PATH: personagen-ai-generate', () => {
		it('should generate content custom-tailored to agent personality', async () => {
			const body = {
				prompt: 'Give a quick tip about productivity',
				persona_id: 'a806d51a-4c00-4d27-874b-155421e5c851', // Sofia Rivera
				platforms: ['instagram']
			};

			const event = createMockEvent('personagen-ai-generate', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.content).toBeTruthy();
		});
	});

	// 5. Social Publishing Tests (Live DB Write)
	describe('PATH: personagen-publish', () => {
		it('should mark a post as published and update databases', async () => {
			// First, create a mock draft post in the database
			const { data: post, error: postErr } = await dbClient
				.from('posts')
				.insert({
					user_id: testUserId,
					agent_id: 'a806d51a-4c00-4d27-874b-155421e5c851', // Sofia Rivera
					content: 'Draft content to be published during automated testing',
					platforms: ['instagram'],
					status: 'draft'
				})
				.select()
				.single();

			expect(postErr).toBeNull();
			expect(post).toBeTruthy();
			createdPostId = post.id;

			// Call personagen-publish action for this post
			const body = {
				post_id: createdPostId
			};

			const event = createMockEvent('personagen-publish', body);
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.message).toContain('successfully published');
			expect(resJson.data.publishedAt).toBeTruthy();

			// Double-check the post status in Supabase DB to ensure live state update works perfectly
			const { data: updatedPost, error: getErr } = await dbClient
				.from('posts')
				.select('*')
				.eq('id', createdPostId)
				.single();

			expect(getErr).toBeNull();
			expect(updatedPost).toBeTruthy();
			expect(updatedPost.status).toBe('published');
			expect(updatedPost.published_at).toBeTruthy();
		});
	});

	// 6. Trends Calculations Tests
	describe('PATH: personagen-trends', () => {
		it('should run trend calculations successfully', async () => {
			const event = createMockEvent('personagen-trends', {});
			const response = await POST(event);
			const resJson = (await response.json()) as any;

			expect(response.status).toBe(200);
			expect(resJson.success).toBe(true);
			expect(resJson.data.message).toBe('Trends recalculated and matched');
			expect(resJson.data.timestamp).toBeTruthy();
		});
	});

	// 7. Hermes Alignment & Supervision Tests
	describe('Hermes Supervision Alignment (ICM)', () => {
		it('should ensure Hermes is seeded once and creators are linked', async () => {
			const { getOrCreateHermes, ensureHermesConfig, ensureAgentsManagedByHermes } = await import(
				'../../../lib/server/hermes'
			);

			// 1. Seed Hermes
			const hermes = await getOrCreateHermes(dbClient, testUserId);
			expect(hermes).toBeTruthy();
			expect(hermes.is_overseer).toBe(true);
			expect(hermes.name).toBe('Hermes');

			// 2. Ensure Hermes config exists
			const config = await ensureHermesConfig(dbClient, testUserId, hermes.id);
			expect(config).toBeTruthy();

			// 3. Create a test creator agent that is not managed
			const { data: creator, error: creatorErr } = await dbClient
				.from('agents')
				.insert({
					user_id: testUserId,
					name: 'Hermes Monitored Test Creator',
					handle: '@hermes_test_creator',
					niche: 'Fitness',
					initial: 'T',
					gradient: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
					status: 'active',
					is_overseer: false,
					soul: 'Test soul'
				})
				.select()
				.single();

			expect(creatorErr).toBeNull();
			expect(creator).toBeTruthy();

			try {
				// 4. Run central backfill helper
				await ensureAgentsManagedByHermes(dbClient, testUserId, hermes.id);

				// 5. Fetch updated creator agent and verify linkage
				const { data: updatedCreator, error: getErr } = await dbClient
					.from('agents')
					.select('*')
					.eq('id', creator.id)
					.single();

				expect(getErr).toBeNull();
				expect(updatedCreator.supervisor_agent_id).toBe(hermes.id);
				expect(updatedCreator.managed_by_overseer).toBe(true);
				expect(updatedCreator.runtime_owner).toBe('hermes-orchestrated');
			} finally {
				// Clean up the temporary creator
				await dbClient.from('agents').delete().eq('id', creator.id);
			}
		});
	});
});
