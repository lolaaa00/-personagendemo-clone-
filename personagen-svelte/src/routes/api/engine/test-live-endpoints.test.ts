import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { POST as accountsPost } from '../accounts/+server';
import { POST as syncPost } from '../agent/[agentId]/sync/+server';
import { POST as chatPost } from '../agent/[agentId]/chat/+server';
import { POST as enginePost } from '../engine/+server';
import { POST as generatePost } from '../agent/[agentId]/generate-post/+server';
import fs from 'fs';
import path from 'path';

// Setup Mock SvelteKit RequestEvent helpers
function createMockEvent(params: any, payload: any, userId: string, supabase: any, urlString: string = 'http://localhost/api') {
  const request = new Request(urlString, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const url = new URL(urlString);

  const locals = {
    supabase,
    safeGetSession: async () => ({
      session: { user: { id: userId } },
      user: { id: userId }
    })
  };

  return { params, locals, request, url, fetch: globalThis.fetch } as any;
}

describe('Direct Endpoint Testing', () => {
  let supabaseUrl = '';
  let serviceRoleKey = '';
  let supabase: any;
  const targetAgentId = '08229e1e-9a30-4f2f-89d4-0cf47eb72ade'; // Ratio Agent
  let userId = '';

  beforeAll(async () => {
    // Load .env variables manually to ensure process.env has them
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

    supabaseUrl = process.env.PUBLIC_SUPABASE_URL || '';
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get Agent details to find the correct user_id
    const { data: agent } = await supabase
      .from('agents')
      .select('user_id')
      .eq('id', targetAgentId)
      .single();

    if (agent) {
      userId = agent.user_id;
    }
  });

  it('1. should check accounts status without bypass', async () => {
    expect(userId).toBeTruthy();
    const event = createMockEvent({}, { action: 'check_status', persona_id: targetAgentId }, userId, supabase);
    const res = await accountsPost(event);
    const resJson = await res.json();
    console.log('[TEST] Accounts Status:', JSON.stringify(resJson, null, 2));
    expect(res.status).toBe(200);
    expect(resJson.success).toBe(true);
  });

  it('2. should run sync endpoint successfully', async () => {
    const event = createMockEvent({ agentId: targetAgentId }, {}, userId, supabase);
    const res = await syncPost(event);
    const resJson = await res.json();
    console.log('[TEST] Sync Result:', JSON.stringify(resJson, null, 2));
    expect(res.status).toBe(200);
    expect(resJson.success).toBe(true);
  });

  it('3. should process chat agent query', async () => {
    const event = createMockEvent(
      { agentId: targetAgentId },
      { message: 'Hello! Introduce yourself.' },
      userId,
      supabase
    );
    const res = await chatPost(event);
    const resJson = await res.json();
    console.log('[TEST] Chat Response:', resJson.response);
    expect(res.status).toBe(200);
    expect(resJson.success).toBe(true);
  }, 30000);

  it('4. should run brand brief store scraper', async () => {
    const event = createMockEvent(
      {},
      {
        action: 'scrape_store',
        url: 'https://fireship.io'
      },
      userId,
      supabase,
      'http://localhost/api/engine?path=personagen-brand-brief'
    );
    const res = await enginePost(event);
    const resJson = await res.json();
    console.log('[TEST] Scraper Data:', JSON.stringify(resJson.data, null, 2));
    expect(res.status).toBe(200);
    expect(resJson.success).toBe(true);
  }, 20000);

  it('5. should run manual generate post flow and print post details with links', async () => {
    const event = createMockEvent({ agentId: targetAgentId }, {}, userId, supabase);
    const res = await generatePost(event);
    const resJson = await res.json();
    console.log('[TEST] Generated Post Response:', JSON.stringify(resJson, null, 2));
    expect(res.status).toBe(200);
    expect(resJson.success).toBe(true);
    if (resJson.post) {
      console.log('[TEST] Generated Post Content:', resJson.post.content);
      console.log('[TEST] Publication Results:', JSON.stringify(resJson.post.publication_results, null, 2));
    }
  }, 50000); // 50s timeout because Gemini + Composio takes a while

  it('6. should allow Hermes agent to invoke update_brand_brief tool', async () => {
    // 1. Get or create Hermes overseer agent ID
    const { data: hermesAgent } = await supabase
      .from('agents')
      .select('id')
      .eq('user_id', userId)
      .eq('is_overseer', true)
      .maybeSingle();

    let hermesId = '';
    if (hermesAgent) {
      hermesId = hermesAgent.id;
    } else {
      // Seed if missing
      const { data: seeded } = await supabase
        .from('agents')
        .insert({
          user_id: userId,
          name: 'Hermes',
          handle: '@hermes_overseer',
          initial: 'H',
          gradient: 'linear-gradient(135deg, #10B981, #06B6D4)',
          status: 'active',
          is_overseer: true,
          soul: 'Overseer',
          skills: 'Reporting',
          tools: 'update_brand_brief'
        })
        .select()
        .single();
      hermesId = seeded.id;
    }

    expect(hermesId).toBeTruthy();

    const event = createMockEvent(
      { agentId: hermesId },
      { message: 'Please update the brand brief with brandName: "Aura Luxury", tagline: "Elegance defined", traits: ["minimalist", "luxury"]' },
      userId,
      supabase
    );
    const res = await chatPost(event);
    const resJson = await res.json();
    console.log('[TEST] Hermes Update Brief Response:', JSON.stringify(resJson, null, 2));
    expect(res.status).toBe(200);
    expect(resJson.success).toBe(true);

    // Verify database record was updated
    const { data: brief } = await supabase
      .from('brand_briefs')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    expect(brief).toBeTruthy();
    expect(brief.data.brandName).toBe('Aura Luxury');
    expect(brief.data.tagline).toBe('Elegance defined');
  }, 30000);
});
