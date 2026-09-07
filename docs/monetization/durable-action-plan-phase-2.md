# PersonaGen — Durable Action Plan, Phase 2: First Dollar to Steady State

**Date:** 2026-09-07
**Role of this document:** the execution spine for everything after the credit rails. Phase 1 ([durable-implementation-plan.md](durable-implementation-plan.md)) built the wallet, ledger, switches, admin console and activity log and proved them live. Phase 2 turns them into revenue: payments open, enforcement on, every spend path metered, plans sold, the system running unattended. Same discipline: every step behind a switch, with a test, a gate, and a rollback; nothing after a failed gate starts.
**Companions:** [conversion-and-margin-design.md](conversion-and-margin-design.md) (prices, packs, plans), [credit-roles-and-policies.md](credit-roles-and-policies.md) (who may do what), [viability-assessment-2026-09-07.md](viability-assessment-2026-09-07.md) (why).

---

## 0. Invariants (carried forward, plus three new ones)

| # | invariant | consequence in code |
|---|---|---|
| D1–D10 | unchanged from Phase 1: money fails closed, observability fails soft but never silently, ledgers are append-only, every external effect is idempotent, every behaviour change has a switch, migrations are forward-only and checksummed, no PII in event rows, the process can die at any moment, two ledgers must agree by query, admin power is auditable | already in place; the verifiers below assert them on every deploy |
| D11 | **Every provider call is metered or explicitly free.** A path that spends provider money either runs through gate → record → debit, or is listed in `FREE_PATHS` with a reason. | `scripts/audit-metering.mjs` (C2) greps every provider client call site and fails if one is in neither set. |
| D12 | **A stamped migration is a verified migration.** `--record-existing` is never trusted alone. | `verify-recorded-migrations.mjs --strict` runs in `deploy.ps1` step 0. |
| D13 | **The live smoke is the definition of "deployed".** A billing deploy is not done until `e2e-smoke.mjs` passes on the new build. | `deploy.ps1` prints the command; the runbook requires it. |

---

## 1. Verified facts that shape this phase

| fact | verified | consequence |
|---|---|---|
| Stripe module works over fetch with signed webhooks; purchases keyed by session id, refunds by event id; promo codes and Adaptive Pricing tolerated | `stripe.spec.ts`, 2026-09-07 | opening payments is configuration, not code |
| Production has never seen a card payment; `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are unset; the ops-gateway connector exposes `stripe` and `monarch_stripe` namespaces, so keys exist somewhere | health, `.env.example`, connector schema | S1 needs the keys placed in the EasyPanel UI, never via the API (it replaces the whole env) |
| Shadow mode has recorded real debits (the smoke's throwaway accounts); reconciliation is clean at 3× | `e2e-smoke.mjs` runs 2–4 | enforce has evidence; the "day of clean shadow" gate is met by a smoke, not by waiting |
| Signup is open (`ADMIN_PIN` unset); each account costs $3.33 of welcome credit; the signup route has an IP rate limiter for the PIN path only | `signup/+server.ts` | S3 is one env var plus one setting |
| `/api/engine` has ~15 unmetered actions, `batch_generate` up to 100 stills per request; `/api/voices` unmetered; both files plus `ai-client.ts`, `generate.ts`, `settings/+page.svelte`, `signup/+server.ts`, `deploy.ps1` are under uncommitted edit by another session | `git status`, metering audit | C1–C3 must land as hunk-filtered commits (the `git hash-object` + `update-index` pattern used twice already) or after that session commits |
| `subscriptions.plan` is constrained to `free | starter | pro | enterprise`; the landing sells Studio / Brand / Agency | `client_bootstrap.sql:423` | C4 needs a migration widening the check (never rename values in place) |
| The scheduler ticks every 60 s under a lease and already hosts autopilot; `pg_cron` is available but not installed | `scheduler.ts:881`, Phase 1 §1 | roll-ups, reconciliation and retention ride the scheduler tick (C6); no new extension |
| Three verifiers exist and are rollback-safe on production: credits (15), activity (9), roles (23); plus the recorded-migration verifier and the live smoke (23) | this repo | every gate below is a command, not an opinion |

---

## 2. Phase 2 sequence

Two tracks. **S-steps** are operator switches — minutes, no deploy, reversible from the console or one env var. **C-steps** are commits — each deploys independently, each has a gate.

### S1 · Open payments (operator, 30 min)

1. In the Stripe dashboard: create a webhook endpoint `https://honeyx.monarchstack.com/api/billing/webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`. Copy the signing secret.
2. In EasyPanel → personagen-app → Environment (UI only): add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Save → container restarts (~40 s).
3. Verify: `/billing` shows "Buy $10.00" instead of "Coming soon"; `curl -X POST /api/billing/webhook` returns 400 (signature) not 503.
4. Buy the $10 pack with a Stripe test card (use test-mode keys first, then live). Confirm on Admin Console → Users & Credits: one `purchase` row, +1,000. In the Stripe dashboard resend the event: the ledger must not gain a second row.
5. Refund the test purchase in Stripe: one `refund` row, −1,000.

**Gate G-S1:** one purchase, one replay ignored, one refund, all visible in the ledger and the activity live feed. **Rollback:** remove the two env vars → `/billing` returns to "Coming soon", webhook returns 503. Nothing in the database needs undoing.

### S2 · Enforce (operator, 5 min)

1. Run `node scripts/e2e-smoke.mjs` once more on the current build (it already exercises the 402 path by flipping enforce for ~20 s and restoring).
2. Admin Console → Controls & Health → credits mode → `enforce`, note "go-live 2026-09-…".
3. Verify: `/api/health` reports `credits: enforce (database)`; a pilot with an empty wallet gets the 402 with the billing link.

**Gate G-S2:** health says enforce; the smoke passes with `credits_mode=enforce` (its enforce test becomes a no-op flip). **Rollback:** the same control → `shadow`, live within 15 s on every instance.

### S3 · Close the free door (operator, 5 min)

1. Set `ADMIN_PIN` in EasyPanel (invite-only signup) **or** leave signup open and lower welcome credit to 500 from Controls & Health. Recommended: PIN until S1 has taken real money for a week.
2. Verify: `/signup` asks for the PIN; the activity log shows `auth.signup.failed` for a wrong PIN with the IP limiter engaging after 5 tries.

**Gate G-S3:** a signup without the PIN fails; a signup with it receives exactly `signup_credits`. **Rollback:** unset the env var.

### C1 · Engine metering (commit, 4 h) — closes the largest leak

- **Scope:** every action in `/api/engine` that calls a provider runs through the existing `runBudgetedAssetJob` shape: `assertWithinBudget(user, agent?, creditsFor(estimate))` → call → `recordCostEvents` in `finally` (which debits). `batch_generate`: `count` capped at 12 per request, `assertWithinBudget` quoted for the whole batch, one cost event per still. `scrape_store` / `scrape_product`: Firecrawl priced from the matrix (add `firecrawl/scrape` at $0.01 raw per page — confirm against the Firecrawl invoice before merge). `read_appearance_from_image`: priced as one LLM call plus image tokens (`priceOf('openrouter','llm') × 5` until measured). `/api/voices` preview: TTS price, rate-limited to 10 per minute per user.
- **Files:** `engine/+server.ts`, `voices/+server.ts`, `pricing.ts`, `ai-client.ts` (LLM proxy records through `trackAi` so every engine text call self-records). Under concurrent edit → land as filtered hunks or after that session commits; never `git add` the whole file.
- **Switch:** none new — `credits_mode` already governs; in `shadow` these paths record and debit without blocking.
- **Tests:** unit — each engine action's estimate equals Σ per-step retail credits; `batch_generate` refuses `count > 12`. DB — none. Live — `e2e-smoke.mjs` gains one engine action (`generate_profile`, $0.002) and asserts a cost event with `key_source` and `credits` and one debit.
- **Gate G-C1:** `scripts/audit-metering.mjs` (below) reports 0 unmetered provider call sites; the smoke's engine step passes; reconciliation query returns 0 rows for 24 h.
- **Rollback:** revert the commit; nothing in the schema changes.

### C2 · Metering audit as code (commit, 2 h) — makes D11 checkable

- **Scope:** `scripts/audit-metering.mjs`: greps `src/` for provider call sites (`fal.`, `openrouter`, `chatCompletion`, `firecrawl`, `elevenlabs`, `fetch(` to provider hosts) and requires each file:line to be inside a function that calls `assertWithinBudget`/`runBudgetedAssetJob` and `recordCostEvents`, or to be listed in `FREE_PATHS` with a reason (model listing, key validation ping, card renderer). Exits 1 otherwise. Wired into `npm run check:money` and `deploy.ps1` step 0.
- **Gate G-C2:** the audit passes on main; deliberately unmetering a call in a branch makes it fail.
- **Rollback:** none needed.

### C3 · Deploy pipeline hardening (commit, 1 h)

- **Scope:** `deploy.ps1` step 0 runs, in order: `apply-migration.mjs --status --strict`, `verify-recorded-migrations.mjs --strict`, `audit-metering.mjs`, unit tests, svelte-check. After the build is confirmed live, it prints the smoke and verifier commands and, with `-verify`, runs `e2e-smoke.mjs` + the three DB verifiers against the new build. Under concurrent edit → hunk-filtered commit.
- **Gate G-C3:** a deploy with a pending migration aborts before `git push`; a deploy with `-verify` ends with "23/23", "15/15", "9/9", "23/23".
- **Rollback:** none.

### C4 · Plans (commit, 1.5 days) — recurring revenue

- **Migration `plans_migration.sql`:** widen `subscriptions.plan` CHECK to add `studio | brand | agency` (keep the old values; do not rename); add `subscriptions.included_credits BIGINT`, `subscriptions.persona_limit INT`, `subscriptions.current_period_start`; unique partial index on `stripe_subscription_id`; a `plan_catalog` table (`plan, price_usd_cents, included_credits, persona_limit, brand_brief_limit, features JSONB`) seeded Studio $79 / 4,000 cr / 3 personas, Brand $299 / 18,000 cr / 10 personas, Agency $899 / 60,000 cr / unlimited. Catalog values are editable from Controls & Health (same `platform_setting_set` pattern, or direct service writes with history).
- **Code:** `POST /api/billing/subscribe {plan}` → Stripe Checkout `mode: 'subscription'` with the price created from the catalog (`price_data.recurring`), metadata `user_id, plan`. Webhook gains `invoice.paid` → grant `included_credits` with `stripe_event_id = invoice.id`, kind `grant`, note "Studio plan, period …"; `customer.subscription.updated/deleted` → update `subscriptions` status/plan; `invoice.payment_failed` → status `past_due` (no clawback; the wallet keeps what it has). Persona creation checks `persona_limit` (server-side in `/api/agents` POST; 402-style refusal with `billingUrl`). Landing plan cards link to `/billing?plan=studio`; Billing page gains a Plans section above the packs.
- **Decision recorded:** included monthly credit **resets** (industry norm, keeps the plan price predictable): on `invoice.paid`, before granting, an `adjustment` removes the unspent remainder of the *previous period's included grant* (tracked as `min(included_credits, balance)` — never touches purchased credit, which never expires). Purchased and welcome credit are never clawed by the reset.
- **Tests:** unit — reset arithmetic (three cases: nothing spent, partly spent, overspent into purchased credit); webhook idempotency on `invoice.paid` replay; persona limit refusal. DB — `verify-credits-db.mjs` gains the reset case. Live — smoke gains "subscribe to Studio with a test card → +4,000, persona limit 3".
- **Gate G-C4:** one real subscription billed, replay inert, one renewal simulated with Stripe's test clock, reset arithmetic matches the ledger.
- **Rollback:** feature flag `plans_enabled` (platform setting, default off) hides the Plans UI and makes `/api/billing/subscribe` return 503; existing subscriptions keep working through the webhook.

### C5 · Settings → Billing + preferences (commit, 3 h)

- **Scope:** replace the "Subscription management is on the way" placeholder in `settings/+page.svelte` with a card that shows the balance, links to `/billing`, and offers the display-currency selector (`profiles.display_currency`, already in the schema). Composer: when the 402 says `billedTo: 'workspace_owner'`, show the workspace owner's name from `workspace_wallets()` rather than the generic message. Under concurrent edit → wait for that session or filter hunks.
- **Gate G-C5:** a user changes currency and the pill follows on the next navigation; a creator seat sees the owner's name in the refusal.

### C6 · Unattended operation (commit, 4 h)

- **Scope:** on the scheduler tick under the existing lease: nightly `rollup_activity_daily(yesterday)`, `ensure_activity_partition(next month)`, `prune_activity_partitions(retention)`; hourly reconciliation query (credits plan §6, markup-aware form in conversion design §7) writing a `billing.reconciliation` activity row with the mismatch count; `/api/health` gains `checks.reconciliation` (last run age and mismatches). Low-balance nudge at < 300 credits: the pill is already amber; C6 adds a `billing.low_balance` activity row once per 7 days (`credit_accounts.low_balance_notified_at` already exists) so the admin timeline shows who is about to hit the wall. There is no outbound mail path in the codebase today; an email nudge waits for a mail provider decision and is not on this plan's critical path.
- **Tests:** unit — tick scheduling and once-per-day guards; DB — roll-up idempotency (already in the activity verifier).
- **Gate G-C6:** health shows a reconciliation run under 2 h old with 0 mismatches for 3 consecutive days; partitions exist for next month before the month starts.
- **Rollback:** `activity_log` switch off stops roll-ups; reconciliation is read-only.

### C7 · Abuse and cost ceilings (commit, 3 h)

- **Scope:** per-user daily generation counter in `user_activity_daily` (already rolled up) surfaced on the Users & Credits table; platform-level daily provider spend ceiling as a platform setting (`daily_platform_spend_usd`, default $200) checked in `assertWithinBudget` against `generation_events` for the day — fails closed in enforce; welcome-credit abuse guard: no grant when another account from the same daily-salted IP hash signed up in the last 24 h (uses the activity log's `subject_hash`, no PII).
- **Gate G-C7:** a second signup from the same address within a day receives 0 welcome credits and the admin timeline shows why; the platform ceiling blocks at the configured amount in the smoke's enforce test.

---

## 3. Order and calendar

| day | steps | done when |
|---|---|---|
| 1 (operator) | S1 → S2 → S3 | real money in, enforce on, door closed; smoke 23/23 on the live build |
| 2 | C1, C2 | 0 unmetered call sites; smoke's engine step passes |
| 3 | C3, C5, C6 | pipeline refuses bad deploys; reconciliation running; billing settings live |
| 4–5 | C4 | first subscription billed and renewed on a test clock |
| 6 | C7 | ceilings and abuse guard live; day-1 pilots re-run the smoke |

S-steps need no engineering and can happen today. C1 is the only step where waiting has a cost: every day the engine is unmetered is a day a user can spend $7.90 per click unbilled.

---

## 4. Failure modes this phase adds

| failure | where | behaviour | invariant |
|---|---|---|---|
| Stripe keys set but webhook secret wrong | S1 | every event returns 400; money is taken, no credit lands; Stripe retries for 3 days | Ledger stays consistent; fix the secret, Stripe redelivers, session-id idempotency prevents doubles. Health does not see this → C6 adds "purchases in Stripe vs purchases in ledger" to reconciliation. |
| Card paid, webhook never arrives | S1 | balance unchanged | Billing page polls 12 s then says "taking longer than usual, you were charged, credit lands automatically"; reconciliation flags the session; admin grants with the session id as note. |
| Enforce on, ledger read fails | S2 | generation refuses with a budget message (fail closed) | D1; health `supabase` check goes red first. |
| Pilot hits the wall mid-campaign | S2 | 402 per slot; the campaign planner counts "N failed to queue" | Already handled; the message links to billing. |
| Engine metering deployed with a wrong estimate | C1 | quote too low → small overdraw absorbed by allow_negative; too high → refusal with a clear message | reconciliation shows the delta between quote and debit; fix the matrix row, no schema change. |
| Plan renewal reset removes credit the user thinks is theirs | C4 | support ticket | reset touches only the previous included grant, never purchased or welcome credit; the ledger row says so; billing page explains before checkout. |
| Two sessions edit the same file | all C-steps | conflicting commits | hunk-filtered staging; never `git add` a file the other session has open; `git diff --cached --stat` before every commit. |

---

## 5. Runbooks

**Open payments** — S1 above, in order; never paste keys into chat, a script, or the connector.

**Flip enforce / back to shadow** — Controls & Health → credits mode → note required. Live within 15 s. Health confirms.

**Verify a billing deploy** — after the version changes:
```
cd personagen-svelte
node scripts/e2e-smoke.mjs                      # 23/23, ≤ $0.01 of spend, cleans up
node scripts/verify-credits-db.mjs              # 15/15
node scripts/verify-roles-db.mjs                # 23/23
node scripts/verify-activity-db.mjs             # 9/9
node scripts/verify-recorded-migrations.mjs --strict
```

**Apply a migration** — `apply-migration.mjs <file>` (it reloads the PostgREST cache); then `--status --strict`. If `--record-existing` was ever used, run the recorded-migration verifier.

**Reconcile by hand (until C6)** — conversion design §7 query; zero rows expected; any row → inspect the event, then `adjustment` with a note from Users & Credits.

**Refund** — do it in Stripe; the webhook claws back proportionally and idempotently. Never adjust the wallet by hand for a Stripe refund.

**Emergency stop** — Controls & Health: credits mode `off` stops all debits and gates; `ACTIVITY_LOG=off` env stops logging. Generation continues under the USD caps. Remove the Stripe env vars to stop taking money.

---

## 6. Definition of done

| step | done when |
|---|---|
| S1 | a live card purchase, a replay, and a refund each produced exactly one ledger row |
| S2 | health says `enforce`; smoke 23/23 with enforce on; no support ticket that the wall was unexplained |
| S3 | zero signups without the PIN (or welcome cost ≤ $1.67 per account) |
| C1–C2 | audit reports 0 unmetered provider call sites; reconciliation 0 rows for 24 h including engine traffic |
| C3 | a deploy cannot ship with a pending or unverified migration; `-verify` runs all five checks |
| C4 | first subscription billed, renewed on a test clock, reset arithmetic matches the ledger, persona limit enforced |
| C5 | billing reachable from Settings; currency preference honoured; owner named in a seat's refusal |
| C6 | reconciliation and roll-ups run unattended for 3 days with 0 mismatches; next month's partition exists |
| C7 | platform ceiling and welcome-abuse guard proven by the smoke |

Each day ends on a green gate or the next day starts with the fix.
