# PersonaGen MicroSaaS Runtime Alignment Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Remove hallucinated/static onboarding architecture from the product runtime, restore/finish the direct SvelteKit runtime paths that matter, and cut the system to the leanest MicroSaaS shape needed for acquisition, onboarding, AI content generation, scheduling, publishing, and billing.

**Architecture:** Treat SvelteKit as the runtime control plane: web UI, authenticated APIs, direct Stripe webhook handling, direct Supabase persistence, direct Gemini/Composio integration, and a single scheduler/worker path. Keep external automation services (DocuSeal, n8n, account factory, mail server, Hermes daemon/MCP bridge) out of the required MVP path unless explicitly feature-flagged.

**Tech Stack:** SvelteKit 5 + adapter-node, Supabase Auth/Postgres/RLS, Gemini via `@google/genai`, Composio social publishing, Stripe billing, Vitest, Docker Compose.

---

## Audit summary verified on 2026-06-16

### Command results

- `npm run check` in `personagen-svelte`: **exit 0**, `svelte-check found 0 errors and 94 warnings in 11 files`.
- `npm run build` in `personagen-svelte`: **exit 0**, with Svelte accessibility/state warnings.
- `npm run test:unit`: **exit 0**, 1 file / 1 test passed.
- `npm run test:integration`: **exit 1**, 3 failed tests. Root causes observed:
  - expired/invalid Gemini API key caused Gemini-backed tests to error,
  - account factory path expects live service behavior,
  - publish test still expects immediate “successfully published” while runtime now queues for scheduler publish.

### Runtime mismatch verification

1. **Target docs are absent, not updated in place.**
   - `full_application_flow.md` and `userflow_decision_tree.md` were not found in the working tree or `HEAD`.
   - Current git status shows broad documentation deletes and untracked `docs/archive/` backups, not corrections to those named files.

2. **Stripe direct runtime was removed from the working tree.**
   - Current working tree is missing:
     - `personagen-svelte/src/lib/server/stripe.ts`
     - `personagen-svelte/src/routes/api/stripe/checkout/+server.ts`
     - `personagen-svelte/src/routes/api/stripe/portal/+server.ts`
     - `personagen-svelte/src/routes/api/stripe/webhook/+server.ts`
     - `personagen-svelte/src/routes/(portal)/settings/billing/+page.server.ts`
     - `personagen-svelte/src/routes/(portal)/settings/billing/+page.svelte`
   - `HEAD` did include a direct SvelteKit Stripe webhook that verified `stripe-signature` and wrote to the `subscriptions` table.
   - The current working tree still has Stripe residue: `stripe` dependency, `subscriptions` schema/types, env references in compose files, and stale `STRIPE_*` config paths.
   - Decision needed: restore direct Stripe billing, or fully remove billing residue. For MicroSaaS, restore and harden direct Stripe billing.

3. **Onboarding/seeding is correctly native SvelteKit runtime.**
   - `personagen-svelte/src/routes/(portal)/+layout.server.ts` seeds default agents from `/data/agents.json` only when `existingAgents` is empty.
   - `personagen-svelte/src/lib/server/hermes.ts` programmatically creates/normalizes the Hermes overseer and backfills creator agents under it.
   - No runtime n8n bootstrap compiler or DocuSeal contract loop is present.

4. **RSS intake is native SvelteKit runtime, but inefficiently routed.**
   - `personagen-svelte/src/lib/server/scheduler.ts` queries `agent_configs` with `rss_active = true`, validates/fetches RSS, tracks processed items, and sends each new item to `/api/agent/[agentId]/chat` over localhost HTTP using `INTERNAL_API_SECRET`.
   - This is not n8n, but the self-HTTP call should be replaced with a shared server function or job queue for reliability and leanness.

5. **Stale DocuSeal references remain outside runtime.**
   - `README.md` still says inbound webhooks include “Stripe, DocuSeal”.
   - `scripts/sync-secrets.js` still asks for `DOCUSEAL_API_TOKEN` plus unrelated legacy secrets.
   - No `n8n` references were found in current repo text search.

---

## Target lean MicroSaaS shape

Required runtime only:

1. **SvelteKit Node app**
   - Authenticated dashboard/routes.
   - API endpoints for agents, posts, content engine, chat, accounts/connections, billing.
   - Server-only integration services for Gemini, Composio, Stripe, RSS.

2. **Supabase**
   - Auth, Postgres, RLS-backed app data.
   - Tables: profiles, agents, agent_configs, connections, posts, chat_messages, agent_memories, tickets if PM remains, blueprints, brand_briefs, subscriptions, processed_rss_items / jobs.

3. **One worker/scheduler lane**
   - Either a separate Node process importing the scheduler, or a single-instance cron/worker deployment.
   - Handles RSS polling, due-post publishing, analytics sync.
   - Uses DB locks/idempotency and queue rows; no self-HTTP.

4. **Direct SaaS integrations**
   - Stripe checkout/customer portal/webhook directly in SvelteKit.
   - Gemini for generation.
   - Composio for social auth/publish/metrics.
   - No DocuSeal/n8n/Hermes daemon/MCP bridge/account factory/mail service in the core MVP path.

Optional/feature-flagged only:

- Account factory and mail services.
- Hermes daemon and MCP bridge.
- PM/tickets module.
- Client delivery/on-prem deployment docs.

---

## Friction points to remove

### P0 — Blocks clarity or core monetization

1. **Stripe runtime deletion while schema/deps remain**
   - Restore direct Stripe routes from `HEAD`, or explicitly remove all billing residue.
   - Recommended: restore direct Stripe, because MicroSaaS needs subscription gating.

2. **Missing canonical runtime docs**
   - The named flow docs are absent. Create canonical, code-grounded docs and delete/ignore static marketing flows.

3. **README and secret bootstrap stale references**
   - Remove DocuSeal from runtime docs and `scripts/sync-secrets.js` unless it is truly required.
   - Align `.env.example` with the selected compose/runtime.

4. **Integration tests depend on live external services**
   - Mock Gemini, factory, Composio, and Stripe in Vitest.
   - Keep a separate manual/live smoke suite for real credentials.

### P1 — Reliability/efficiency friction

5. **Scheduler starts inside `hooks.server.ts`**
   - This can duplicate workers in multi-instance deployments or hot reload.
   - Move to a dedicated worker entrypoint, or gate with `ENABLE_SCHEDULER=true` and DB advisory locks.

6. **RSS self-HTTP call**
   - Replace localhost fetch to `/api/agent/[agentId]/chat` with a shared server function, or enqueue `content_jobs` rows processed by the worker.

7. **Large action-multiplexed endpoints**
   - `api/engine/+server.ts` and `api/posts/+server.ts` route many `action` values through one handler with `any` bodies.
   - Split into route modules or internal service functions with schema validation.

8. **Oversized Svelte pages**
   - Largest page files are 1k–3.7k lines. Extract components/stores to reduce bug surface and speed feature iteration.

9. **Duplicate deployment topologies**
   - Root `docker-compose.yml` and `personagen-svelte/docker-compose.yml` describe different worlds.
   - Choose one default production topology; move the other to `docs/archive/` or mark it experimental.

### P2 — Product focus / MicroSaaS conversion

10. **Feature bloat in default nav**
    - Decide MVP modules: Dashboard, Agents, Content Forge, Calendar, Connections, Billing, Settings.
    - Feature-flag Scout, Trends, PM, Inbox, Account Factory until they directly support activation or retention.

11. **Stale tenant-oriented types**
    - `src/lib/types.ts` still contains `tenant_id`/tenant config shapes while the DB schema is `user_id`-centered.
    - Replace or isolate legacy multi-tenant types.

12. **Accessibility warnings**
    - Fix warnings from `npm run check/build` to reduce UX friction and production polish risk.

---

## Step-by-step implementation plan

### Task 1: Lock the canonical runtime decision in docs

**Objective:** Establish one source of truth for runtime architecture and stop future agents from mixing static marketing/onboarding flows into code docs.

**Files:**
- Create: `docs/runtime-architecture.md`
- Create or recreate: `docs/full_application_flow.md`
- Create or recreate: `docs/userflow_decision_tree.md`
- Modify: `README.md`

**Steps:**
1. Write `docs/runtime-architecture.md` describing the target lean runtime:
   - SvelteKit app/API
   - Supabase
   - scheduler/worker
   - Stripe direct webhook
   - Gemini/Composio
   - optional feature-flagged services
2. Recreate `docs/full_application_flow.md` only from inspected code paths.
3. Recreate `docs/userflow_decision_tree.md` only from actual route/API behavior.
4. In `README.md`, remove the DocuSeal runtime webhook statement and broken links to deleted onboarding docs, or point them to `docs/archive/`.
5. Verification: run a repo text search for `DocuSeal`, `n8n`, `bootstrap compiler`, and ensure any remaining references are explicitly marked non-runtime/archived.

### Task 2: Restore direct Stripe MicroSaaS billing path

**Objective:** Bring back direct SvelteKit Stripe billing while keeping n8n/DocuSeal out of runtime.

**Files:**
- Restore/modify: `personagen-svelte/src/lib/server/stripe.ts`
- Restore/modify: `personagen-svelte/src/routes/api/stripe/checkout/+server.ts`
- Restore/modify: `personagen-svelte/src/routes/api/stripe/portal/+server.ts`
- Restore/modify: `personagen-svelte/src/routes/api/stripe/webhook/+server.ts`
- Restore/modify: `personagen-svelte/src/routes/(portal)/settings/billing/+page.server.ts`
- Restore/modify: `personagen-svelte/src/routes/(portal)/settings/billing/+page.svelte`
- Modify: `personagen-svelte/supabase/migration.sql`
- Modify/add migration: `personagen-svelte/supabase/billing_migration.sql` if needed

**Steps:**
1. Restore the deleted Stripe files from `HEAD`.
2. Fix schema/type mismatch before runtime use:
   - Either add `current_period_start TIMESTAMPTZ` to `subscriptions`, or remove all code expecting it.
   - Align `SubscriptionRow` in `src/lib/server/db.ts`.
3. Ensure webhook uses service-role client only in webhook handling.
4. Ensure checkout writes `supabase_user_id` and `plan` metadata.
5. Add unit tests for webhook event handling with a mocked Stripe signature/event object.
6. Verification:
   - `npm run check`
   - `npm run build`
   - targeted Stripe webhook tests

### Task 3: Clean secret/env/config drift

**Objective:** Make local/prod setup match the lean runtime and remove stale secret prompts.

**Files:**
- Modify: `.env.example`
- Modify: `scripts/sync-secrets.js`
- Modify: `docker-compose.yml`
- Modify or archive: `personagen-svelte/docker-compose.yml`

**Steps:**
1. Pick one default deployment topology.
2. Update `.env.example` with all required keys for that topology.
3. Remove `DOCUSEAL_API_TOKEN`, `CLICKUP_API_KEY`, and unrelated legacy prompts from `scripts/sync-secrets.js` unless intentionally feature-flagged.
4. Standardize naming: use `STRIPE_SECRET_KEY`, not `STRIPE_API_KEY`, if that is what runtime reads.
5. Verification: run a script comparing `${ENV_VAR}` references in compose files against `.env.example`; missing required keys should be zero except intentionally internal/generated container vars.

### Task 4: Split scheduler into an explicit worker lane

**Objective:** Prevent duplicate scheduler loops and make background behavior deployable.

**Files:**
- Modify: `personagen-svelte/src/hooks.server.ts`
- Modify: `personagen-svelte/src/lib/server/scheduler.ts`
- Create: `personagen-svelte/src/lib/server/worker.ts` or `personagen-svelte/src/worker.ts`
- Modify: `personagen-svelte/package.json`
- Modify: selected compose file

**Steps:**
1. Remove unconditional `startScheduler()` from `hooks.server.ts`.
2. Add env guard: `ENABLE_SCHEDULER=true` for the worker process only.
3. Add a worker entrypoint that imports and starts the scheduler.
4. Add DB lock/advisory lock or lease row to prevent duplicate ticks.
5. Verification:
   - `npm run check`
   - local app starts without scheduler logs when `ENABLE_SCHEDULER` is false
   - worker process starts scheduler when `ENABLE_SCHEDULER` is true

### Task 5: Replace RSS self-HTTP with a server function or queue

**Objective:** Remove internal localhost HTTP overhead and improve idempotency/retries.

**Files:**
- Modify: `personagen-svelte/src/lib/server/scheduler.ts`
- Extract/create: `personagen-svelte/src/lib/server/agent-chat.ts`
- Modify: `personagen-svelte/src/routes/api/agent/[agentId]/chat/+server.ts`
- Optional migration: `personagen-svelte/supabase/content_jobs_migration.sql`

**Steps:**
1. Extract chat-turn processing from route handler into `runAgentChatTurn({ agentId, userId, message, supabaseClient, isServiceCall })`.
2. Have the route call the service function.
3. Have `scheduler.ts` call the same service function directly, not `fetch('http://127.0.0.1:...')`.
4. Add retry/idempotency:
   - mark RSS item processing started/completed,
   - only set `rss_last_polled_at` after successful feed fetch or store separate `last_attempted_at`.
5. Verification: add tests for RSS parser and scheduler-to-chat service invocation with mocked Supabase/fetch.

### Task 6: Refactor `api/engine` into services with validation

**Objective:** Reduce runtime risk from a 917-line action multiplexer.

**Files:**
- Modify: `personagen-svelte/src/routes/api/engine/+server.ts`
- Create: `personagen-svelte/src/lib/server/engine/account-factory.ts`
- Create: `personagen-svelte/src/lib/server/engine/channel-decode.ts`
- Create: `personagen-svelte/src/lib/server/engine/content-forge.ts`
- Create: `personagen-svelte/src/lib/server/engine/brand-brief.ts`
- Create: `personagen-svelte/src/lib/server/engine/publish.ts`
- Optional: add validation helpers/types

**Steps:**
1. Move each `path === ...` branch into a service function.
2. Add request validation for each action.
3. Keep route as a small dispatcher during migration, or replace with resourceful routes later.
4. Update tests to call services directly where possible.
5. Verification: unit tests pass with mocked external APIs.

### Task 7: Fix integration tests into deterministic suites

**Objective:** Make CI/test results meaningful without live credentials.

**Files:**
- Modify: `personagen-svelte/src/routes/api/engine/engine.test.ts`
- Add mocks under `personagen-svelte/src/lib/server/**/__mocks__` or Vitest setup
- Modify: `personagen-svelte/vite.config.ts` if setup file is needed

**Steps:**
1. Mock Gemini responses for decode/content/title/thumbnail/generate paths.
2. Mock `AccountFactoryClient` responses.
3. Mock Composio publish/metrics where tested.
4. Update publish test expectation from immediate “successfully published” to queued scheduler behavior, or add a separate scheduler publish test.
5. Keep live E2E tests behind `RUN_LIVE_E2E=true`.
6. Verification:
   - `npm run test:unit`
   - `npm run test:integration`

### Task 8: Feature-flag or archive non-MVP services

**Objective:** Cut operational surface area for the lean MicroSaaS launch.

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify route nav in `personagen-svelte/src/routes/(portal)/+layout.svelte`
- Optional feature flag module: `personagen-svelte/src/lib/features.ts`

**Steps:**
1. Define feature flags for Account Factory, Mail, MCP Bridge, Hermes daemon, PM, Inbox, Scout/Trends if not required for MVP conversion.
2. Remove optional services from default compose or place behind compose profiles.
3. Hide optional nav items when flags are false.
4. Verification: default app starts with only required services and no broken links/routes.

### Task 9: Reduce frontend maintenance hotspots

**Objective:** Improve development velocity and reduce accidental regressions.

**Files:**
- Split large files under `personagen-svelte/src/routes/(portal)/**/+page.svelte`
- Create components under `personagen-svelte/src/lib/components/**`
- Create stores under `personagen-svelte/src/lib/stores/**`

**Steps:**
1. Prioritize pages over 1,000 lines: `brand-brief`, `persona-config`, `inbox`, `calendar`, `scout`, `content-forge`, `chat`.
2. Extract forms, cards, modals, and sidebars into components.
3. Keep behavior unchanged; use small commits.
4. Verification: `npm run check`, `npm run build`, and targeted browser smoke tests.

---

## Definition of done

- The repo contains canonical, code-grounded runtime flow docs.
- No required runtime docs claim n8n/DocuSeal bootstrap or webhook loops.
- Direct Stripe billing works or is fully removed by deliberate product decision.
- RSS intake does not self-HTTP into the same app.
- Scheduler cannot run duplicate loops in multi-instance production.
- Tests do not fail because of expired/live external credentials.
- Default deployment path is one SvelteKit app + Supabase + one worker, with optional services behind feature flags/profiles.
- `npm run check`, `npm run build`, `npm run test:unit`, and `npm run test:integration` pass in default mocked/local mode.
