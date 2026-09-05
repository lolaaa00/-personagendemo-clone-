# PersonaGen — Credit Monetization: Forensic Assessment & Implementation Plan

**Date:** 2026-09-05
**Scope:** everything in `personagen-svelte` that touches cost, spend, plans, Stripe, admin authority, and tenant scoping — audited from the code paths that actually run, not from comments or docs, and cross-checked against a read-only snapshot of the production database (§8).
**Companion:** [admin-activity-log-plan.md](admin-activity-log-plan.md) — the admin-visible user activity log (logins, presence, actions, executions) that shares the `platform_admins` role and Platform tab defined here.
**Goal:** a credit-based system where (1) every paid generation debits a per-account credit balance, (2) users buy credits through Stripe, (3) a **platform admin** can grant, set, or override balances from the admin panel without any payment, so the first five pilot users can exercise the whole loop before Stripe is live.

---

## 0. Executive verdict

**There is no credit system, no Stripe integration, and no platform-admin concept in the codebase today.** What exists is a well-built *cost-accounting* layer (a USD estimate ledger plus fail-open spend ceilings) that is the right foundation to build credits on top of — roughly 60% of the hard work is done, and it is the honest part (what actually ran, at what estimated cost).

Three things must be true before this can be monetized:

1. **A credit ledger and balance, with fail-CLOSED enforcement.** The existing cap logic deliberately fails *open* when the ledger read errors. That is correct for a runaway-cost safety net and wrong for money.
2. **A platform-admin identity.** The `/admin` page is a *workspace* admin console (owner/admin seat of a workspace). Nobody in the system can act on *other tenants'* accounts. Granting pilot credits needs a new, explicit authority.
3. **Every paid path must be metered.** Several generation paths bill providers without touching the ledger or the caps (see §2). Credits deducted only on the metered paths would be trivially bypassable.

Everything below is written so it can be executed in order. Phase 0 + 1 (schema, admin grants, shadow-then-enforced deduction, balance UI) is a one-day build and is what the five pilot users need. Stripe is Phase 2 and does not block the pilot.

---

## 1. What exists today — the verified inventory

### 1.1 Cost ledger: `generation_events` (real, running in production)

Schema — [generation_events_migration.sql](../../personagen-svelte/supabase/generation_events_migration.sql), plus `asset_url` from [generation_events_asset_url_migration.sql](../../personagen-svelte/supabase/generation_events_asset_url_migration.sql):

| column | note |
|---|---|
| `user_id` | **the actor** who triggered the generation (a seat), not necessarily who should pay |
| `agent_id`, `post_id` | attribution |
| `provider`, `operation`, `model` | `fal` / `openrouter` / `gemini` / `local`; `image` / `video` / `llm` / `tts` / `talking_head` / `persist` |
| `est_cost NUMERIC(10,6)` | USD **estimate** from the pricing matrix / model registry, never a provider invoice |

RLS: users can only `SELECT`/`INSERT` their own rows. No `UPDATE`/`DELETE` policy — the ledger is append-only for users. Good.

Writer — `recordCostEvents` in [generate.ts:1866](../../personagen-svelte/src/lib/server/content/generate.ts#L1866): **best-effort**, wrapped in `try/catch`, called from a `finally` so a generation that dies mid-way still records what it paid for. If the insert fails, generation still succeeds and the spend is silently lost (logged with `console.warn`). Acceptable for analytics; **not acceptable for a debit**.

### 1.2 Pricing truth: `pricing.ts` + `model_registry`

- [pricing.ts](../../personagen-svelte/src/lib/pricing.ts) — static per-call USD matrix (image $0.08, Kling O3 clip $0.42, cinematic $1.60, TTS $0.03, talking head $0.70, LLM flat $0.002). Client-safe, tunable via `UGC_PRICING_JSON`.
- `model_registry.price_usd` ([model-registry.ts](../../personagen-svelte/src/lib/server/model-registry.ts)) overlays live/audited prices per model (`price_source: seed|parsed|manual`). `registryPrice()` means the model id and its price come from one row.
- LLM cost is a **flat $0.002 per call**, not token-counted. `ai-client.ts` has no usage/token capture at all. This is the one place where "tokenization" in the literal sense does not exist — a credit unit must therefore be defined in **USD-estimate cents**, not model tokens (§4.1).

### 1.3 Spend ceilings: `budget.ts` (safety net, not billing)

[budget.ts](../../personagen-svelte/src/lib/server/budget.ts) — `assertWithinBudget(supabase, userId, agentId)`:

| cap | source | default |
|---|---|---|
| daily per persona | `MAX_DAILY_SPEND_PER_AGENT_USD` | $15 |
| monthly per user | `MAX_MONTHLY_SPEND_PER_USER_USD` | $300 |
| monthly per seat in a workspace | `workspace_members.spend_limit_usd` (Settings → Team) | unlimited |

Properties that matter for credits:

- **Fails OPEN** on any ledger read error (returns 0 spent). Documented and tested ([budget.spec.ts](../../personagen-svelte/src/lib/server/budget.spec.ts)).
- Sums rows **in JavaScript** with a 100 000-row limit. Fine at today's volume; a credit balance should be a single cached number updated transactionally, not a re-sum.
- **Not atomic.** Two concurrent requests both pass the check, then both spend. generate-post prechecks synchronously ([generate-post/+server.ts:494](../../personagen-svelte/src/routes/api/agent/[agentId]/generate-post/+server.ts#L494)) and asserts again inside the detached task. Fine for a ceiling, wrong for a balance that must never go negative.
- Caps are **USD**, keyed to the **actor's** `user_id`.

**Keep these caps.** They remain the runaway-loop guard underneath credits. They are not the billing system.

### 1.4 `subscriptions` table — dormant, and unsafe to use as-is

[client_bootstrap.sql:383-425](../../personagen-svelte/supabase/client_bootstrap.sql#L383-L425): `plan` (`free|starter|pro|enterprise`), `status`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`. Auto-created with `plan='free'` by the `handle_new_user` signup trigger.

- **Nothing reads it.** The only reference in app code is the account-delete wipe list. The portal layout comment says it outright: *"there's no plan/subscription system"* ([+layout.server.ts](../../personagen-svelte/src/routes/(portal)/+layout.server.ts)).
- **RLS lets a user `UPDATE` their own row.** If any gate ever read `subscriptions.plan`, a user could set themselves to `enterprise` from the browser with the anon key. Writes to this table must be **service-role only** before it gates anything (§5, Phase 0.1).
- The plan names (`starter/pro/enterprise`) do not match the landing page (`Studio/Brand/Agency`).
- **Verified in production:** the table exists with 9 rows, all `free / active`, no Stripe ids (§8). One of the 10 auth users has no row at all.

### 1.5 Stripe: zero integration

- `package.json` dependencies: `@google/genai`, `@supabase/ssr`, `@supabase/supabase-js`, `undici`. **No `stripe`.**
- `.env` has no `STRIPE_*` variables.
- No `/api/stripe/*` or webhook route. `README.md` mentions "inbound webhook payloads (e.g., Stripe, DocuSeal)" as architecture intent only.
- Settings → **Billing & Plan** renders a "Subscription management is on the way" placeholder ([settings/+page.svelte:2151-2176](../../personagen-svelte/src/routes/(portal)/settings/+page.svelte#L2151-L2176)).
- Changelog entries from May/June 2026 mention "Stripe billing" and "Stripe links" (payment links on the HoneyX marketing site). None of that code is in this app.

### 1.6 Admin authority: workspace-scoped only

- [admin/+page.server.ts](../../personagen-svelte/src/routes/(portal)/admin/+page.server.ts): a read-heavy oversight page for workspaces the caller **owns or holds an `admin` seat in**. It uses the service role, but every query is scoped to those workspace ids first. It cannot see or touch other tenants.
- There is **no platform-admin / superuser** flag anywhere: not in `profiles`, not in env, not in `hooks.server.ts`. `ADMIN_PIN` only gates *signup* when set, and it is **not set** in the current `.env`, so signup is open.
- The model manager (`/models`, `/api/models`) is reachable by **any signed-in user** — it is a platform-level surface with no admin gate. Worth closing in the same pass.

### 1.7 Multi-tenancy model and the "who pays" gap

Tenant graph (from [workspaces_migration.sql](../../personagen-svelte/supabase/workspaces_migration.sql) and [workspace_admin_role_migration.sql](../../personagen-svelte/supabase/workspace_admin_role_migration.sql)):

```
auth.users ─┬─ profiles (1:1)           personal account = default tenant
            ├─ subscriptions (1:1)      dormant
            ├─ agents (personas)  ── workspace_id (nullable) ──► workspaces (owner_id)
            └─ workspace_members (seat: admin > manager > creator > viewer, spend_limit_usd)
```

- Access is enforced by RLS + `agent_access_role()`; app routes call `checkAgentAccess()` ([workspaces.ts:62](../../personagen-svelte/src/lib/server/workspaces.ts#L62)).
- API-key auth (`pg_live_…`) mints a user JWT so RLS applies identically ([hooks.server.ts](../../personagen-svelte/src/hooks.server.ts)). Credits will apply identically too — no special path needed.
- **Gap:** spend is attributed to the *actor*. When a `creator` seat generates against the owner's persona, `generation_events.user_id` is the seat, the owner's monthly cap is untouched, and there is no notion of a billing account. A credit system has to answer "whose balance?" explicitly. Recommendation: **the workspace owner pays** for anything generated against a workspace persona; personal personas bill their owner (§4.2). **In production this is already the case for 100% of spend:** every ledger row belongs to an admin seat, the workspace owner shows $0 (§8).
- Autopilot runs under the **service role** and attributes to `agent.user_id` (the persona owner) — [autopilot.ts:164](../../personagen-svelte/src/lib/server/autopilot.ts#L164). Consistent with "owner pays".

### 1.8 Bring-your-own keys vs platform keys

`resolveImageKeys` ([generate.ts:224](../../personagen-svelte/src/lib/server/content/generate.ts#L224)) and `resolveAiClient` prefer the user's own encrypted key (`user_api_keys`) and fall back to the platform env key. The ledger records `est_cost` **either way** and does not record which key paid. Credits must not be charged for provider cost the user already paid with their own key — so events need a `key_source` (`platform|byo`) column (§4.3). Landing copy already promises "Bring your own keys at cost" on Agency.

### 1.9 Landing page and docs already commit to a pricing stance

[+page.svelte:115-171](../../personagen-svelte/src/routes/+page.svelte#L115-L171): Studio **$79**, Brand **$299**, Agency **$899** per month, per brand. Copy: *"Priced per brand. Not per credit."*, FAQ *"Why don't you sell credits?"*, feature line *"No credits. No expiry. No guessing."* The competitive doc ([market-gap-assessment.md §9.5](../competitive/market-gap-assessment.md)) argues the same.

**This is a direct conflict with a credit-based system.** It is a product decision, not a code decision. Resolution recommended in §4.4: sell **plans that include a monthly credit allowance** plus **top-up packs**, keep "no expiry" for purchased top-ups, and rewrite the three copy lines. Credits stay the internal metering unit; the public price stays per brand.

---

## 2. Metering coverage — which paid paths are ledgered and capped

| path | entry | budget cap | ledger | verdict |
|---|---|---|---|---|
| Post generation (composer, campaigns) | `generate-post` → `generateUgcPack` / `generateCinematicUgcPack` | ✅ precheck + inner assert | ✅ in `finally` | metered |
| Refine media | `refine-post` → `refineUgcMedia` | ✅ | ✅ | metered |
| Avatar / reference kit | `generate-avatar`, `generate-reference-kit` → `runBudgetedAssetJob` | ✅ | ✅ | metered |
| Autopilot | `autopilot.ts` → `generateUgcPack` (service role) | ✅ (treats "budget" as hard stop) | ✅ | metered |
| Engine `generate` action | `/api/engine` → `generateUgcPack` | ✅ | ✅ | metered |
| **Engine `batch_generate`** | [`/api/engine:620`](../../personagen-svelte/src/routes/api/engine/+server.ts#L620) → `generateUgcImage(prompt, orKey, falKey)` **directly** | ❌ | ❌ | **unmetered paid image per variation** |
| **Engine LLM actions** (`script`, `titles`, `thumbnail_brief`, `repurpose`, `generate_persona_profile`, `generate_identity_kit`, `generate_full_persona`, `suggest_directions`, `read_appearance_from_image`, `generate_field`, `spin_field`, `extend_field`, LLM steps inside `scrape_*`) | `/api/engine` → `resolveAiClient().generate()` | ❌ | ❌ | **unmetered LLM** (cheap per call, unbounded in count; identity kit is ~11 s of LLM per platform) |
| Scrape (Firecrawl) | `scrape_store`, `scrape_product` | ❌ | ❌ | third-party cost, unmetered |
| Publishing (Zernio) | `publish-post`, scheduler | n/a | n/a | per-connected-account cost, not per-call — price into plans, not credits |
| Typographic card | `card-renderer.ts` (ffmpeg) | ✅ | ✅ at $0 | free by design |

Bottom line: post/media generation is solid; **persona creation and the engine's ad-hoc LLM/image paths are the holes.** They are exactly what a pilot user touches first (create persona → identity kit → avatar), so they must be metered before enforcement (Phase 1.4).

---

## 3. Risk register for turning this into money

| # | risk | severity | where |
|---|---|---|---|
| R1 | Cap logic fails open on DB error → free generation | High for credits, by design for caps | `budget.ts` `sumSpend` |
| R2 | Non-atomic check-then-spend → balance can go negative under concurrency | High | `generate-post` precheck + detached task |
| R3 | Ledger write is best-effort → spend can be lost, credits never debited | High | `recordCostEvents` |
| R4 | Users can UPDATE their own `subscriptions.plan` | High if ever gated on | RLS policies in `client_bootstrap.sql` |
| R5 | Unmetered paid paths (§2) | High | `/api/engine` |
| R6 | No platform-admin identity; any grant mechanism needs one | Blocking | — |
| R7 | Actor-vs-payer attribution for workspace seats | Medium | `generation_events.user_id` |
| R8 | BYO-key spend indistinguishable from platform-key spend | Medium | no `key_source` on events |
| R9 | `est_cost` is an estimate; provider invoices will drift (a ~3.9× under-billing bug on OpenRouter images was already fixed once) | Medium | `pricing.ts`, registry |
| R10 | Open signup (`ADMIN_PIN` unset) → anyone can create accounts; combined with a signup credit grant this is a free-credit faucet | Medium | `/api/auth/signup` |
| R11 | `/models` manager reachable by every user | Low–Medium | `models/+page.server.ts` |
| R12 | Landing copy promises "no credits" | Product | `+page.svelte`, competitive doc |

---

## 4. Design decisions (recommended, with reasoning)

### 4.1 The credit unit

**1 credit = 1 cent (USD $0.01) of *estimated provider cost*.** `credits_debited = ceil(est_cost_usd × 100)` per generation event.

Why: the ledger already stores `est_cost` in USD with six decimals, the composer preflight already quotes `estimatedCostUsd` per step, and the model registry already audits per-model prices. Mapping 1:1 to cents means **no second pricing table to drift** and every credit debit is traceable to a ledger row. Margin lives in the **Stripe price of a credit pack**, not in the deduction rule (e.g. 1 000 credits = $10 of provider cost sold for $25 = 2.5× gross). Rounding up per event is the only "markup" in code.

Rejected: model-token metering. LLM usage is not captured anywhere and is <1% of spend; images/video dominate. Not worth building token capture for.

### 4.2 The billing account

`billed_user_id = workspaces.owner_id` when the persona has a `workspace_id`, else `agents.user_id`. Resolved server-side in one helper (`resolveBillingAccount(supabase, agentId)`), stamped on every `generation_events` row alongside the existing actor `user_id`. Seat spend limits keep working on the actor column; credits and plans key on `billed_user_id`.

### 4.3 What is free

- `provider='local'` events (typographic cards) — already $0.
- Events where the provider call used a **BYO key** — record `key_source='byo'`, debit 0 credits.
- Accounts with `billing_mode='unmetered'` (admin-comped) — events still recorded, credits still computed and written to the ledger as `debit` rows with `delta=0` and `waived_credits=n`, so the admin can see what a comped account *would* have cost.

### 4.4 Public pricing shape (resolves R12)

Keep "per brand" as the headline. Each plan **includes a monthly credit allowance** sized from the cost model in the competitive doc (Brand at 10 personas × 180 posts ≈ $150–200 provider cost ≈ 15 000–20 000 credits/mo). Overage via **top-up packs that never expire**. Copy changes: *"Priced per brand, with a generous generation allowance"*; FAQ becomes *"What happens if I exceed my allowance?"*. This preserves the competitive wedge (no expiring credits, no meter anxiety at normal cadence) while making the pilot's credit mechanics the real system.

Phase 2 sells top-up packs only (one-time Checkout). Phase 3 adds plan subscriptions that grant allowance monthly via webhook.

### 4.5 Enforcement modes

Per-account `billing_mode` plus one global switch:

| mode | behaviour |
|---|---|
| `credits` (default) | fail-closed: gate on quoted estimate before spend, debit actual after |
| `unmetered` | admin-comped; records would-be debits, never blocks |
| env `CREDITS_ENFORCE=shadow` | computes and writes debits but never blocks. **Ship in this mode first**, flip to `enforce` once the ledger reconciles for a day |

---

## 5. Implementation plan

### Phase 0 — Foundation (schema + platform admin + ledger correctness) — ~half a day

**0.1 Migration `credits_migration.sql`** (add to `build-bootstrap.mjs` ORDER; apply with the `run-migrations.js` pattern via `/pg/query`):

```sql
-- Platform admins: the only identity allowed to act on other tenants' balances.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. A user asks "am I admin?" through the function, never by reading the table.
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user) $$;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;

-- One credit account per billing user (workspace owner or personal account).
CREATE TABLE IF NOT EXISTS public.credit_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_credits BIGINT NOT NULL DEFAULT 0,
  billing_mode TEXT NOT NULL DEFAULT 'credits' CHECK (billing_mode IN ('credits','unmetered')),
  stripe_customer_id TEXT,
  low_balance_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_accounts_select_own ON public.credit_accounts FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies for users. Balance moves only through credit_apply().

-- Append-only money trail. balance_credits is a cache of SUM(delta) enforced by credit_apply().
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta BIGINT NOT NULL,                         -- +grant/purchase/refund, -debit
  kind TEXT NOT NULL CHECK (kind IN ('grant','purchase','debit','refund','adjustment','set')),
  balance_after BIGINT NOT NULL,
  waived_credits BIGINT NOT NULL DEFAULT 0,      -- unmetered/byo: what this would have cost
  generation_event_id UUID REFERENCES public.generation_events(id) ON DELETE SET NULL,
  post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  stripe_event_id TEXT,                          -- idempotency for webhook credits
  actor_user_id UUID REFERENCES auth.users(id),  -- who caused it (seat, admin; NULL = webhook/system)
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON public.credit_ledger(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_stripe_event
  ON public.credit_ledger(stripe_event_id) WHERE stripe_event_id IS NOT NULL;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_ledger_select_own ON public.credit_ledger FOR SELECT USING (auth.uid() = user_id);

-- Attribution columns on the existing spend ledger.
ALTER TABLE public.generation_events ADD COLUMN IF NOT EXISTS billed_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.generation_events ADD COLUMN IF NOT EXISTS key_source TEXT CHECK (key_source IN ('platform','byo','none'));
ALTER TABLE public.generation_events ADD COLUMN IF NOT EXISTS credits BIGINT;   -- ceil(est_cost*100); 0 when waived
CREATE INDEX IF NOT EXISTS idx_generation_events_billed ON public.generation_events(billed_user_id, created_at);

-- Atomic, fail-closed balance mutation. Returns the new balance; raises on insufficient funds.
CREATE OR REPLACE FUNCTION public.credit_apply(
  p_user UUID, p_delta BIGINT, p_kind TEXT, p_note TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL, p_event UUID DEFAULT NULL, p_post UUID DEFAULT NULL,
  p_agent UUID DEFAULT NULL, p_stripe_event TEXT DEFAULT NULL, p_waived BIGINT DEFAULT 0,
  p_allow_negative BOOLEAN DEFAULT false
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bal BIGINT; v_mode TEXT;
BEGIN
  INSERT INTO public.credit_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_credits, billing_mode INTO v_bal, v_mode
    FROM public.credit_accounts WHERE user_id = p_user FOR UPDATE;
  IF p_kind = 'set' THEN
    p_delta := p_delta - v_bal;   -- caller passes the TARGET balance in p_delta
  END IF;
  IF p_delta < 0 AND v_mode = 'unmetered' THEN
    p_waived := p_waived + (-p_delta); p_delta := 0;
  END IF;
  IF p_delta < 0 AND NOT p_allow_negative AND v_bal + p_delta < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS: balance % < required %', v_bal, -p_delta USING ERRCODE = 'P0001';
  END IF;
  v_bal := v_bal + p_delta;
  UPDATE public.credit_accounts SET balance_credits = v_bal, updated_at = now() WHERE user_id = p_user;
  INSERT INTO public.credit_ledger (user_id, delta, kind, balance_after, waived_credits, generation_event_id,
                                    post_id, agent_id, stripe_event_id, actor_user_id, note)
  VALUES (p_user, p_delta, p_kind, v_bal, p_waived, p_event, p_post, p_agent, p_stripe_event, p_actor, p_note);
  RETURN v_bal;
END $$;
-- Deliberately NOT granted to `authenticated`: every caller is a server route or the webhook using the service role.

-- Lock down the dormant subscriptions table before anything reads it (R4).
DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_delete_own" ON public.subscriptions;
```

Reservation/settlement can be added later. Phase 1 **gates on `balance ≥ quoted estimate`** up front and **debits the actual cost** in the `finally` with `p_allow_negative=true`. With the row lock inside `credit_apply`, concurrent debits serialize and any further generation is blocked once the balance is ≤ 0. Small transient overdrafts between quote and settle are tolerated (the account shows negative until topped up). That is the standard trade-off and it is honest.

**0.2 Platform admin bootstrap**
- New `src/lib/server/platform-admin.ts`: `requirePlatformAdmin(locals)` → 403 unless `is_platform_admin(user.id)` OR email ∈ `PLATFORM_ADMIN_EMAILS` (env bootstrap so the first admin exists before the table has rows).
- Seed your own account into `platform_admins` in the migration or via the admin endpoint once.
- Expose `isPlatformAdmin` from `(portal)/+layout.server.ts` for the nav entry (mirrors the existing `isWorkspaceAdmin`).
- Put `/models` and `/api/models` behind the same check (R11).

**0.3 Ledger correctness**
- `recordCostEvents` gains `billedUserId`, `keySource`, computes `credits`, and — for `billing_mode='credits'` and `key_source='platform'` — calls `credit_apply(-credits, 'debit')` via the **service** client. A failed debit becomes a **logged error that marks the post `failed`** rather than a warning (R3). The analytics insert keeps its best-effort behaviour.
- `resolveImageKeys` / `resolveAiClient` return which source they picked so `key_source` is truthful (R8).
- New `resolveBillingAccount(supabase, agentId)` (§4.2, R7).

### Phase 1 — Admin distribution + gate + balance UI (pilot-ready) — ~half a day

**1.1 Admin API** — `POST /api/admin/credits` (platform admin only):

```json
{ "userId": "…", "op": "grant" | "set" | "adjust" | "mode", "credits": 5000, "mode": "unmetered", "note": "pilot cohort 1" }
```
Maps to `credit_apply(kind='grant'|'set'|'adjustment', actor=admin)` or updates `billing_mode`. Every call lands in `credit_ledger` with the admin's id as `actor_user_id`, so grants are auditable and reversible. `GET /api/admin/credits?userId=` returns balance + last 100 ledger rows. `GET /api/admin/credits` (no id) lists every account.

**1.2 Admin UI** — new **"Platform"** tab on the existing Admin Console (`/admin`), visible only to platform admins:
- table of all accounts (service role `auth.admin.listUsers` joined to `credit_accounts`): email, created, last sign-in, balance, mode, this-month debits, lifetime waived
- per-row actions: **Grant**, **Set balance**, **Toggle unmetered**, view ledger
- bulk: "grant N credits to selected" — this is the five-pilot-user button

**1.3 Gate** — a sibling of `assertWithinBudget` named `assertCreditsAvailable(supabase, billedUserId, quotedCredits)`, called in the same places (synchronous precheck in `generate-post`, and inside `generateUgcPack` / `generateCinematicUgcPack` / `refineUgcMedia` / `runBudgetedAssetJob`). If `CREDITS_ENFORCE=enforce` and mode is `credits` and balance < quote, throw `INSUFFICIENT_CREDITS` with a user-facing message that links to Settings → Billing. Autopilot's hard-stop regex ([autopilot.ts:493](../../personagen-svelte/src/lib/server/autopilot.ts#L493)) gets `|credits` added so an empty account stops the loop cleanly instead of failing every slot.

**1.4 Close the unmetered paths (R5)** — before flipping to enforce:
- `/api/engine` `batch_generate`: route the per-variation image through `runBudgetedAssetJob` with a `CostEvent` from `priceOf('fal','image')` / the registry.
- Engine LLM actions: wrap the client from `resolveAiClient` in a metering proxy that records one `llm` event per `generate()` call (flat matrix price) against the billing account. One change in `resolveAiClient` covers all ~15 actions.
- Scrapes: record a fixed `scrape` operation at Firecrawl's per-page rate (add a row to `PRICING_MATRIX`).

**1.5 User-facing balance**
- `(portal)/+layout.server.ts` loads `credit_accounts` for the session user → **balance pill** in the top bar next to the account badge.
- Settings → Billing replaces the "coming soon" card with: balance, mode, last 30 ledger rows, "Buy credits" (disabled until Phase 2), and the existing spend figures re-expressed in credits.
- Composer preflight shows **"≈ N credits"** beside `estimatedCostUsd`; the confirm-before-spend rule already exists on every generate action.
- Out-of-credits toast with a link to Billing.

**1.6 Rollout for the five pilot users**
1. Apply the migration; seed yourself as platform admin.
2. Deploy with `CREDITS_ENFORCE=shadow`. Every generation now writes debits; nothing blocks.
3. Create/identify the five accounts. Grant each e.g. **5 000 credits** (= $50 of estimated provider cost) from the Platform tab.
4. Have them create a persona, identity kit, avatar, a few posts. Compare `credit_ledger` debits with `generation_events.credits` — they must reconcile row for row (§6 query).
5. Flip to `CREDITS_ENFORCE=enforce`. Run one account to zero to confirm the block, then grant more to confirm the unblock. Set one account to `unmetered` to confirm comped mode.

Signup grant: **do not** auto-grant credits on signup while signup is open (R10). Either set `ADMIN_PIN` for the pilot or grant manually.

### Phase 2 — Stripe top-ups — ~1 day

- `npm i stripe`. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_PACK_1K/5K/20K`.
- `POST /api/billing/checkout` → Stripe Checkout Session (mode `payment`, `client_reference_id = user.id`, metadata `credits`). Success/cancel URLs to Settings → Billing.
- `POST /api/stripe/webhook` — **raw body** signature verification (read `request.text()` before any JSON parsing), handle `checkout.session.completed` → `credit_apply(+credits, 'purchase', stripe_event_id=event.id)`. The unique index on `stripe_event_id` makes retries idempotent. Return 200 fast; the ledger write is one row.
- `charge.refunded` → `credit_apply(-credits, 'refund', allow_negative=true)`.
- Store `stripe_customer_id` on `credit_accounts` so the Customer Portal link works.
- Settings → Billing "Buy credits" enabled: three packs, prices set in Stripe, not in code.

### Phase 3 — Plans (subscriptions) + workspace billing — ~1–2 days

- Stripe Products for Studio/Brand/Agency with monthly credit allowance in metadata; `customer.subscription.created/updated/deleted` and `invoice.paid` → write `subscriptions` (service role only) and grant the monthly allowance as `kind='grant'` with the invoice id as `stripe_event_id`.
- Plan limits that are not credits (persona count, brand briefs, autonomy levels) gate in the routes that create those objects, reading `subscriptions.plan` — safe now that R4 is closed.
- Landing copy update per §4.4.

---

## 6. Test plan

**Unit (vitest, `mock-supabase` pattern from `budget.spec.ts`)**
- `creditsFor(est_cost)` rounding: 0 → 0, 0.001 → 1, 0.08 → 8, 0.42 → 42, 1.6 → 160.
- `resolveBillingAccount`: personal persona → owner; workspace persona → workspace owner, regardless of actor.
- `key_source` selection: user key present → `byo` and 0 credits; env key → `platform`.
- Gate: enforce + insufficient → throws `INSUFFICIENT_CREDITS`; shadow → never throws; unmetered → never throws and records waived.
- `requirePlatformAdmin`: table hit, env bootstrap hit, otherwise 403.

**DB (integration project, real Postgres)**
- `credit_apply` concurrency: two parallel debits of 60 against balance 100 → exactly one succeeds, one raises; `balance_after` chain is monotonic and `SUM(delta) = balance_credits`.
- Duplicate `stripe_event_id` → second call raises unique violation, balance unchanged.
- `set` semantics: target balance, ledger delta = target − previous.

**End-to-end (Playwright, five pilot accounts)**
1. Admin grants 5 000 → pill shows 5 000.
2. Generate image post → pill drops by the quoted credits; ledger row links to the `generation_events` row and the post.
3. Identity kit + avatar → debits appear (proves Phase 1.4 closed the holes).
4. Set balance to 5 → generate → blocked with Billing link; admin grants 500 → succeeds.
5. Toggle `unmetered` → generation succeeds at 5 credits, ledger shows `waived_credits`.
6. Add own fal key → image debits 0 with `key_source=byo`.
7. Concurrency: launch a 10-slot campaign with balance for 3 → exactly 3 succeed, 7 fail to queue with the credits message (the synchronous precheck path).
8. Stripe test mode (Phase 2): buy 1 000 → webhook → +1 000; replay the webhook → no double credit.

**Reconciliation query (run daily during the pilot)**
```sql
SELECT ge.billed_user_id, SUM(ge.credits) AS metered, COALESCE(-SUM(cl.delta),0) AS debited
FROM generation_events ge
LEFT JOIN credit_ledger cl ON cl.generation_event_id = ge.id AND cl.kind='debit'
WHERE ge.created_at >= now() - interval '1 day' AND ge.key_source='platform'
GROUP BY 1 HAVING SUM(ge.credits) <> COALESCE(-SUM(cl.delta),0);
```
Zero rows = the two ledgers agree.

---

## 7. Files touched (checklist)

| area | file |
|---|---|
| schema | `supabase/credits_migration.sql` (new), `supabase/build-bootstrap.mjs` (ORDER) |
| server | `src/lib/server/credits.ts` (new: `creditsFor`, `resolveBillingAccount`, `assertCreditsAvailable`, `debitForEvents`), `src/lib/server/platform-admin.ts` (new), `src/lib/server/budget.ts`, `src/lib/server/content/generate.ts` (`recordCostEvents`, `resolveImageKeys`, `runBudgetedAssetJob`), `src/lib/server/ai-client.ts` (metering proxy), `src/lib/server/autopilot.ts` (hard-stop regex), `src/routes/api/engine/+server.ts` (`batch_generate`) |
| admin | `src/routes/api/admin/credits/+server.ts` (new), `src/routes/(portal)/admin/+page.server.ts` + `+page.svelte` (Platform tab), `src/routes/(portal)/+layout.server.ts` (`isPlatformAdmin`, balance), `src/routes/(portal)/models/+page.server.ts` + `src/routes/api/models/+server.ts` (admin gate) |
| user UI | `src/routes/(portal)/+layout.svelte` (balance pill), `src/routes/(portal)/settings/+page.svelte` (Billing section), composer preflight display |
| Stripe (P2) | `src/routes/api/billing/checkout/+server.ts`, `src/routes/api/stripe/webhook/+server.ts`, `package.json`, `.env` |
| copy (P3) | `src/routes/+page.svelte` PLANS/FAQ, `docs/competitive/market-gap-assessment.md §9.5` |
| tests | `src/lib/server/credits.spec.ts`, `platform-admin.spec.ts`, integration `credit_apply.spec.ts`, e2e pilot spec |

---

## 8. Production baseline (verified 2026-09-05, read-only snapshot of `l2g-supabase.zi1cc5.easypanel.host`)

| table | rows |
|---|---|
| auth users | 10 |
| profiles / subscriptions | 9 / 9 |
| workspaces / seats | 1 / 6 |
| agents / posts | 15 / 113 |
| generation_events | 643 |
| user_api_keys | 4 |
| api_keys (developer keys) | 0 |
| model_registry | 361 |

**Accounts**

| email | created | last sign-in | role today |
|---|---|---|---|
| monarchstackteam@gmail.com | 2026-06-09 | 2026-09-04 | admin seat in HoneyX; **all spend to date** |
| hnyx.user3@gmail.com | 2026-06-16 | 2026-07-22 | **owner** of the HoneyX workspace |
| ratiogamo@gmail.com | 2026-07-22 | 2026-07-22 | personal |
| verify-kit-69a88f@personagen.test | 2026-07-22 | 2026-07-22 | test fixture |
| hq@hexenergy.au | 2026-08-24 | 2026-08-24 | personal |
| kelvin@monarchstack.com | 2026-08-27 | 2026-09-01 | admin seat, own OpenRouter key |
| matt@monarchstack.com | 2026-08-27 | never | admin seat |
| ly@monarchstack.com | 2026-08-27 | 2026-08-28 | creator seat |
| abby@monarchstack.com | 2026-08-27 | 2026-08-27 | creator seat |
| claire@monarchstack.com | 2026-08-27 | never | creator seat |

**Ledger**

| | est. USD |
|---|---|
| all-time | 26.26 |
| this month (Sep) | 0.38 |
| video | 12.95 |
| image | 6.30 |
| talking head | 6.00 |
| llm | 0.71 |
| tts | 0.30 |
| by provider | openrouter 15.04 · fal 11.22 |

**What the snapshot proves, and what it changes in the plan**

1. **Nothing is deductible today because there is nothing to deduct from.** 643 ledger rows exist and not one of them touched a balance — there is no balance column, table, or function anywhere in the schema. The ledger is a receipt, not a wallet. Phase 0.1 creates the wallet; Phase 0.3 makes every receipt debit it.
2. **The actor-vs-payer gap (R7) is live in production, not theoretical.** 100% of spend ($26.26) is attributed to `monarchstackteam@gmail.com`, an *admin seat*. The workspace owner `hnyx.user3@gmail.com` shows $0. Under "owner pays" (§4.2) that entire history belongs to the owner's account. Decide before backfilling `billed_user_id`.
3. **BYO-key ambiguity (R8) is also live.** `monarchstackteam` holds its own OpenRouter key and OpenRouter is $15.04 of the $26.26. Some or all of that was paid by the user's key, not the platform, and the ledger cannot tell. `key_source` must be recorded going forward; the historical split is unrecoverable.
4. **The five pilot users already exist.** The five `@monarchstack.com` accounts created 2026-08-27 are the cohort. Two (`matt`, `claire`) have never signed in. Their credit accounts should be created by the admin grant, not by signup (`credit_apply` upserts the account row on first touch — no trigger dependency).
5. **The signup trigger is not universal.** 10 auth users but 9 profiles / 9 subscriptions: `monarchstackteam@gmail.com` (the heaviest user) has **no** `profiles` or `subscriptions` row. It predates the trigger. Any credit design that assumes a row exists per user will 500 on the one account that matters — hence the upsert inside `credit_apply` and lazy loads in the layout.
6. **`subscriptions` does exist in prod** — all 9 rows `free / active`, no Stripe ids. The RLS lockdown in Phase 0.1 applies to a real table.
7. **Spend mix confirms the credit unit.** Video + image + talking head = 96% of cost; LLM is 2.7%. Metering by USD-cents of estimate is right; token-level metering would be effort spent on 3% of the bill.
8. **No seat has a spend limit set.** The one existing cap mechanism has never been used by the customer.
9. **Volume is tiny.** $0.38 this month. The pilot is about proving the loop, not about scale — shadow mode for one day is enough before enforcing.

**Still open:** whether the separate **EasyPanel client deployment** should carry the same credit schema. `build-bootstrap.mjs` will include it automatically once the migration is in ORDER.
