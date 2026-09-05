# PersonaGen — Durable Implementation Plan: Credits, Platform Admin, Activity Log

**Date:** 2026-09-05
**Role of this document:** the execution spine. The two companion documents are the specifications — [credit-system-forensic-assessment-and-plan.md](credit-system-forensic-assessment-and-plan.md) (schema, credit unit, Stripe) and [admin-activity-log-plan.md](admin-activity-log-plan.md) (events, presence, admin views). This document says **in what order, behind which switch, with which test, and how it fails safely** — commit by commit. Nothing here changes a decision already made in those two; where it adds a mechanism, it is because the verified runtime needs it.

---

## 0. Durability principles (the invariants every commit is checked against)

| # | invariant | consequence in code |
|---|---|---|
| D1 | **Money fails closed.** A balance mutation either fully commits or the paid call does not start. | `credit_apply()` is one transaction with a row lock; gate runs before the first provider call; debit runs in `finally`. A DB error on the gate is a *block*, never a pass. |
| D2 | **Observability fails soft, but never silently.** Logging must not slow or break a request; loss must be counted and visible. | In-process queue, batched inserts, retry once, dropped counter surfaced on the admin panel and `/api/health`. |
| D3 | **Ledgers are append-only.** No UPDATE/DELETE on `credit_ledger`, `generation_events`, `user_activity_events` from app roles. Corrections are new rows (`adjustment`), never edits. | `REVOKE` in migrations; a DB test asserts the revoke holds for `authenticated`. |
| D4 | **Every external effect is idempotent.** Webhook replays, double-clicks, scheduler retries, and redeploys mid-request must not double-charge or double-log. | Unique `stripe_event_id`; `request_id` on every event; `credit_apply` keyed to `generation_event_id` for debits (unique partial index). |
| D5 | **Every behaviour change ships behind a switch that can be turned off without a deploy.** | `CREDITS_ENFORCE=off|shadow|enforce`, `ACTIVITY_LOG=off|on`, `PLATFORM_ADMIN_EMAILS`. All read at call time from `$env/dynamic/private`, like the existing caps. |
| D6 | **Migrations are forward-only, idempotent, checksummed, and recorded.** The same file applied twice is a no-op; a changed file is refused. | `schema_migrations` table + `scripts/apply-migration.mjs`. `build-bootstrap.mjs` ORDER is the canonical list. |
| D7 | **No PII in event rows.** UUIDs and hashes only; identity resolved at render for platform admins. | Sanitiser is the only path into `meta`; unit-tested against emails, keys, long strings. |
| D8 | **The process can be killed at any moment.** Redeploys are `docker stop` (SIGTERM, 10 s grace). Anything buffered in memory must flush or be reconstructible. | Graceful-shutdown module: stop scheduler, flush activity queue, then exit. Debits are never buffered — they are synchronous DB calls. |
| D9 | **Two ledgers must agree, and disagreement must be detectable by a query, not by a complaint.** | Daily reconciliation query (credits plan §6) runs as a unit test against fixtures and as a scheduled job in production. |
| D10 | **Admin power is auditable.** Every grant, set, mode change, export, and user view writes an activity row with `target_user_id`. | `logActivity` is called inside the admin route, in the same request as the mutation. |

---

## 1. Verified runtime facts that shape the plan

| fact | verified in | consequence |
|---|---|---|
| One adapter-node container, `CMD ["node","build/index.js"]`, no init process, no signal handlers anywhere in `src/` | `Dockerfile`, grep for `SIGTERM` | SIGTERM today = immediate exit. Buffered activity rows would be lost on every redeploy → D8 requires the shutdown module **before** the activity queue ships. |
| Deploy = `deploy.ps1` runs `npm run check` + unit tests, commits with `git add -A`, pushes `main`; EasyPanel auto-builds the image | `deploy.ps1` | **No migration step exists in the pipeline.** Schema changes are applied by hand via `/pg/query`. Code that assumes a column will 500 if the migration was forgotten → D6 rails, and every new query tolerates a missing table for one release (like `recordCostEvents` already does for `asset_url`). `git add -A` will commit scratch files; narrow it. |
| No migration ledger; `run-migrations.js` embeds SQL and posts it to `${SUPABASE_URL}/pg/query` with the service key | `run-migrations.js:210` | Reuse the endpoint, add the ledger and a generic runner. |
| Vitest `unit` project = `*.spec.ts` with `mock-supabase`; `integration` project = `*.test.ts` "live AI, sequential"; **no database test project** | `vite.config.ts` | `credit_apply` concurrency and RLS revokes cannot be proven with mocks → add a `db` project that runs against the `supabase-db` service in `docker-compose.yml` (already defined, Postgres 15 with Supabase extensions). |
| `RUN_SCHEDULER=false` supports a web/worker split, but production runs one container with the scheduler in-process under a lease | `hooks.server.ts`, `scheduler_leases` | Roll-up and pruning jobs can ride the existing scheduler tick under the same lease if `pg_cron` is not installed. |
| `/api/health` checks config, Supabase, AI keys | `health/+server.ts` | Extend it with `credits` (function callable) and `activity` (dropped counter, queue depth) so EasyPanel's health check sees billing health. |
| Single Supabase host; `pg_cron` available, not installed | prod query | Optional; the scheduler-tick fallback keeps the plan free of a new extension. |
| Production volume: 10 users, ~$0.40/month of generation, 643 ledger rows | prod query | Every design below is over-provisioned for today; that is deliberate — the rails must not need rework at 1 000 users. |

---

## 2. Phase −1 — Harden the rails (must land first, one commit)

**C1 · rails** — no product behaviour changes.

1. **Migration ledger + runner.**
   - `supabase/000_schema_migrations.sql`: `schema_migrations(name TEXT PK, checksum TEXT, applied_at TIMESTAMPTZ, applied_by TEXT)`.
   - `scripts/apply-migration.mjs <file>...`: reads `.env`, computes sha256, refuses if `name` exists with a different checksum, skips if identical, otherwise wraps the file in `BEGIN; … ; INSERT INTO schema_migrations …; COMMIT;` and posts to `/pg/query`. `--dry-run` prints the plan. `--status` lists ORDER from `build-bootstrap.mjs` and marks each applied/pending/drifted.
   - `deploy.ps1`: new step 0 runs `node scripts/apply-migration.mjs --status` and **aborts if any migration in ORDER is pending** unless `-allowPendingMigrations`. Replace `git add -A` with `git add -A -- personagen-svelte docs`.
2. **Graceful shutdown.** `src/lib/server/lifecycle.ts`: `onShutdown(fn)` registry; `process.on('SIGTERM'|'SIGINT')` → stop accepting scheduler ticks, run registered flushers with a 5 s budget, exit 0. Registered from `hooks.server.ts` next to `startScheduler()`. Dockerfile: `CMD ["node","build/index.js"]` stays (exec form already delivers the signal).
3. **Switches.** `src/lib/server/flags.ts`: typed readers for `CREDITS_ENFORCE` (`off` default), `ACTIVITY_LOG` (`off` default), `PLATFORM_ADMIN_EMAILS`, `ACTIVITY_PEPPER`, `ACTIVITY_RETENTION_DAYS`. Read per call; unit-tested defaults.
4. **DB test project.** `vite.config.ts` adds project `db` (`src/**/*.db.spec.ts`) that connects with `pg` to `DATABASE_URL` (defaults to the compose `supabase-db`), applies `client_bootstrap.sql` + pending migrations into a fresh schema per run, and exposes `asRole('authenticated', uid)` / `asService()` helpers. `npm run test:db`. Not part of `deploy.ps1`'s default path yet (opt-in flag), but required by the acceptance gates below.
5. **Health.** `/api/health` gains `checks.migrations` (pending count) — today it will say `0` and prove the ledger works.

**Acceptance gate G1:** `apply-migration.mjs --status` shows every ORDER file applied on production with matching checksums (this also backfills the ledger for history: run once with `--record-existing`). `kill -TERM` on a local container logs "flushed 0 queues" and exits 0 within a second. `npm run test:db` passes on a clean compose database.

**Rollback:** none needed — additive.

---

## 3. Execution sequence (commits C2–C12)

Each commit lists: scope · migration · switch state after deploy · tests · gate · rollback. Commits are sized to deploy independently; a failed gate stops the sequence, nothing after it is started.

### C2 · Platform admin identity
- **Scope:** `platform_admins` table + `is_platform_admin()`; `src/lib/server/platform-admin.ts` (`requirePlatformAdmin(locals)`, env bootstrap); `isPlatformAdmin` in portal layout; gate `/models` and `/api/models`; seed the first admin.
- **Migration:** `platform_admins_migration.sql`.
- **Switch:** `PLATFORM_ADMIN_EMAILS` set to your address in EasyPanel env.
- **Tests:** unit (env hit, table hit, 403 otherwise, service role never used for the check itself); db (`authenticated` cannot read `platform_admins`; function returns false for unknown).
- **Gate G2:** you see the Platform nav entry; a pilot user gets 403 on `/api/models` and no nav entry.
- **Rollback:** unset env → nobody is admin; `/models` returns 403 for everyone until re-set (acceptable: it is an operator page).

### C3 · Credit schema (dark)
- **Scope:** `credit_accounts`, `credit_ledger`, `generation_events` attribution columns, `credit_apply()`, `subscriptions` RLS lockdown, plus a **unique partial index** `credit_ledger(generation_event_id) WHERE kind='debit'` so a retried debit for the same event is a no-op (D4). No code reads it yet.
- **Migration:** `credits_migration.sql` (credits plan §5, Phase 0.1, plus the index).
- **Switch:** `CREDITS_ENFORCE=off` (nothing calls the function).
- **Tests (db):** two parallel debits against balance 100 → one succeeds; `set` semantics; `unmetered` waives; duplicate `stripe_event_id` rejected; duplicate `generation_event_id` debit rejected; `authenticated` cannot execute `credit_apply`, cannot update `subscriptions`, cannot update/delete `credit_ledger`.
- **Gate G3:** migration recorded; `SELECT count(*) FROM credit_accounts` = 0; db tests green.
- **Rollback:** additive; leave in place.

### C4 · Attribution + shadow debit
- **Scope:** `src/lib/server/credits.ts` (`creditsFor`, `resolveBillingAccount`, `debitForEvents`); `recordCostEvents` stamps `billed_user_id`, `key_source`, `credits`, then — when `CREDITS_ENFORCE≠off` and `key_source='platform'` — calls `credit_apply` through the service client with `p_allow_negative=true` (shadow never blocks, but it *does* write, so the ledger is real from day one). `resolveImageKeys`/`resolveAiClient` report the key source. A failed debit marks the post `failed` with `error_code='CREDIT_DEBIT_FAILED'` (D1) — in shadow it only logs.
- **Migration:** none.
- **Switch:** deploy with `CREDITS_ENFORCE=shadow`.
- **Tests:** unit (rounding table; billing account resolution owner-vs-seat; byo → 0 credits; shadow never throws); db (reconciliation query returns zero rows over a fixture set).
- **Gate G4:** after 24 h in production, the reconciliation query returns zero rows; every new `generation_events` row has `billed_user_id` and `key_source`; the HoneyX owner's `credit_accounts` row exists with a negative balance equal to `-SUM(credits)` of platform-key spend (expected and correct in shadow).
- **Rollback:** `CREDITS_ENFORCE=off` — writes stop, nothing else changes.

### C5 · Admin credits API + Platform tab (pilot can be provisioned here)
- **Scope:** `POST/GET /api/admin/credits`; Platform tab on `/admin`: Users table (email, created, last sign-in from `auth.users`, balance, mode, month debits, waived), Grant / Set / Adjust / Toggle-unmetered, bulk grant. Every action calls `logActivity` (D10) — the helper exists as a no-op stub until C6 and becomes real then, so the call sites land now.
- **Migration:** none.
- **Switch:** still `shadow`.
- **Tests:** unit (route 403 for non-admin; amount validation; note required for `set`); e2e (grant 5 000 → balance shows 5 000; ledger row has `actor_user_id` = admin).
- **Gate G5:** the five `@monarchstack.com` accounts each hold 5 000 credits; `credit_ledger` shows five `grant` rows with your id as actor.
- **Rollback:** remove admin env → API 403s; balances stay.

### C6 · Activity rails: request log, presence, auth events
- **Scope:** `activity_log_migration.sql` (events table partitioned, presence, daily, `admin_auth_events()`, partition/prune functions); `src/lib/server/activity.ts` (queue, flush, sanitiser, UA reducer, `logActivity`, `logSystemActivity`, `ROUTE_ACTIONS`, dropped counter); `hooks.server.ts` (request id, timing, `shouldLog`, presence throttle, register flusher with `onShutdown`); auth routes emit `auth.*` with client IP hash/UA family; `/api/health` reports queue depth and drops; backfill script from GoTrue + domain tables (`meta.backfilled=true`).
- **Switch:** deploy with `ACTIVITY_LOG=on` and `ACTIVITY_PEPPER` set.
- **Tests:** unit (sanitiser; `shouldLog` matrix incl. `__data.json` and `/media` exclusion; ip hash daily rotation; queue flush at 2 s/200, retry once, drop count; presence throttle); db (partition routing; revokes; `admin_auth_events` not executable as `authenticated`); load (10 k events/min locally, p99 request overhead < 1 ms, zero drops).
- **Gate G6:** log in as a pilot user → Users table shows last login within 5 s with browser family; `matt@` shows *never logged in*; presence shows you online; `/api/health` shows `activity: { queued: n, dropped_24h: 0 }`; a forced redeploy loses zero rows (compare counts before/after).
- **Rollback:** `ACTIVITY_LOG=off` — hooks skip enqueue; tables remain.

### C7 · Close the unmetered paid paths
- **Scope:** engine `batch_generate` image through `runBudgetedAssetJob`; metering proxy around `resolveAiClient` (one `llm` event per `generate()`); `scrape` row in `PRICING_MATRIX` and an event per Firecrawl page. Engine self-reports `engine.<action>` activity.
- **Tests:** unit (proxy records exactly one event per call incl. retries; batch image records per variation); e2e (identity kit + avatar produce debits).
- **Gate G7:** for one pilot user, "create persona → identity kit → avatar → one post" yields ledger rows for every step, and the reconciliation query is still empty.
- **Rollback:** none needed; metering is additive. (If the proxy misbehaves, `UGC_PRICING_JSON` can zero the LLM price without a deploy.)

### C8 · Gate + user-facing balance (still shadow)
- **Scope:** `assertCreditsAvailable` beside `assertWithinBudget` (precheck and inner); autopilot hard-stop regex gains `|credits`; composer preflight shows `≈ N credits`; balance pill in the portal layout; Settings → Billing replaced (balance, mode, ledger, disabled "Buy credits"); out-of-credits toast. In `shadow` the gate computes and logs `billing.credits.blocked` **without throwing**, so you can see who *would* have been blocked.
- **Tests:** unit (gate matrix: off/shadow/enforce × credits/unmetered × sufficient/insufficient; DB error on gate in `enforce` → throws); e2e (pill matches `credit_accounts`; preflight credits = `ceil(estimatedCostUsd*100)`).
- **Gate G8:** 24 h of shadow with zero unexpected `billing.credits.blocked` events for the pilots (they hold 5 000 each; any block means a pricing or attribution bug).
- **Rollback:** `CREDITS_ENFORCE=shadow` is already the state; UI reads are harmless.

### C9 · Enforce (environment change only, no deploy)
- Set `CREDITS_ENFORCE=enforce`. Run the pilot acceptance script: one account to zero → blocked with Billing link; grant → unblocked; set `unmetered` → runs and records waived; concurrency (10-slot campaign, balance for 3) → exactly 3 queue.
- **Gate G9:** all four pass; reconciliation empty; no `CREDIT_DEBIT_FAILED` posts.
- **Rollback:** `CREDITS_ENFORCE=shadow`. Seconds, no deploy, no data change.

### C10 · Domain events, timeline, executions, errors, anonymisation
- **Scope:** `logActivity` in the 38 mutating routes per the activity plan §3.3; autopilot/scheduler system events; account-delete anonymisation step; admin views: user timeline with filters, Live, Executions, Errors; workspace Activity tab re-pointed at the events table; touchpoint test (every mutating route imports `logActivity`).
- **Gate G10:** e2e pilot scenario from the activity plan §5 passes end to end; deleting a throwaway account leaves its rows with `user_id NULL` and intact `subject_hash`.
- **Rollback:** `ACTIVITY_LOG=off`.

### C11 · Stripe top-ups
- **Scope:** `stripe` dep; `/api/billing/checkout`; `/api/stripe/webhook` (raw-body signature check, `checkout.session.completed` → `credit_apply(+n,'purchase',stripe_event_id)`, `charge.refunded` → refund with `allow_negative`); `stripe_customer_id` on `credit_accounts`; "Buy credits" enabled; `billing.*` activity events.
- **Tests:** unit (signature failure → 400, no ledger write; malformed metadata → 400 and alert); db (replayed event id → no double credit); Stripe CLI test-mode e2e.
- **Gate G11:** test-mode purchase credits once; replay three times credits zero more; refund debits once.
- **Rollback:** remove `STRIPE_SECRET_KEY` → checkout 503, webhook 503 (Stripe retries for 3 days, so nothing is lost — re-enable and the retries land, idempotently).

### C12 · Roll-ups, retention, export, plan copy
- **Scope:** `rollup_activity_daily`, `prune_activity_partitions`, next-month partition creation — scheduled by `pg_cron` if you approve `CREATE EXTENSION pg_cron`, else by the scheduler tick under its lease once per day; Usage dashboards; CSV export (logged); landing PLANS/FAQ copy per credits plan §4.4.
- **Gate G12:** roll-up idempotent (run twice, same totals); a partition older than the window is dropped and the row counts in `user_activity_daily` are unchanged.

---

## 4. Failure-mode matrix

| failure | component | what happens | why it is safe |
|---|---|---|---|
| DB unreachable during gate | credits, `enforce` | generation refused with a retryable message; autopilot skips the slot | D1 — the alternative is free generation |
| DB unreachable during debit (after spend) | credits | post marked `failed` with `CREDIT_DEBIT_FAILED`; provider cost already incurred | bounded by the existing USD caps; reconciliation flags it; admin `adjustment` fixes the balance |
| DB unreachable during activity flush | activity | rows retried once, then counted as dropped; `/api/health` and the Platform tab show the count | D2 — requests unaffected |
| Container killed mid-flight | all | debits are synchronous (no loss); activity queue flushed on SIGTERM within 5 s; anything still unflushed is counted at next boot from a persisted `dropped` marker | D8 |
| Two concurrent requests, balance for one | credits | row lock serialises; second raises `INSUFFICIENT_CREDITS` | D1/D4 |
| Detached task retried after a crash, same `generation_event_id` | credits | unique partial index rejects the second debit | D4 |
| Stripe webhook replayed / delivered twice | Stripe | unique `stripe_event_id` → second call raises, handler returns 200 (already applied) | D4 |
| Stripe signature invalid | Stripe | 400, no side effect, `billing.webhook.rejected` activity row | D4/D10 |
| Estimate drifts from real provider cost | credits | overs/unders are per-model and visible in the model registry's audited `price_basis`; fix the registry price, never the ledger | D3 — history stays honest; only future debits change |
| Migration forgotten before deploy | rails | `deploy.ps1` step 0 aborts; if bypassed, first-release code tolerates missing columns (retry-without-column pattern) and `/api/health` shows `migrations.pending > 0` | D6 |
| Migration file edited after apply | rails | runner refuses (checksum drift) → write a new migration instead | D6 |
| Missing partition for a new month | activity | `ensure_activity_partition` runs at boot for current + next month and nightly; if insert still fails, rows are dropped and counted | D2 |
| Pepper rotated | activity | cross-day correlation breaks by design; hashes for the day of rotation are inconsistent for that day only | D7 |
| Admin grants the wrong user | admin | `adjustment` with a note reverses it; both rows remain; both are activity events with `target_user_id` | D3/D10 |
| Account deleted | all | credit rows cascade (money for a deleted user is moot; `credit_ledger` keeps `user_id` via cascade delete — if you want financial retention, change the FK to `SET NULL` before C3); activity rows anonymised, not deleted | D7 |
| Service-role key leaks | all | every function is `SECURITY DEFINER` and callable by the service role — a leaked key is total compromise **already today**; rotate via Supabase and EasyPanel env; the activity log shows what was done in the window | not new; the log makes the blast radius visible |
| Non-admin hits an admin route | admin | 403 before any query; the attempt is logged with `outcome='denied'` | D10 |
| Clock skew between app and DB | all | all timestamps default in the DB (`now()`), the app never writes `occurred_at`/`created_at` | ordering stays consistent |

---

## 5. Runbooks

**Apply a migration**
```
cd personagen-svelte
node scripts/apply-migration.mjs --status
node scripts/apply-migration.mjs supabase/credits_migration.sql
node supabase/build-bootstrap.mjs      # regenerate client_bootstrap.sql after adding to ORDER
```

**Provision the pilot cohort** — Platform tab → select the five accounts → Grant 5 000 → note "pilot cohort 1, 2026-09". Verify: `SELECT user_id, balance_credits FROM credit_accounts`.

**Flip enforcement** — EasyPanel env `CREDITS_ENFORCE=enforce` → container restarts (~30 s; scheduler lease re-acquired). Revert the same way.

**Daily reconciliation (until C12 automates it)** — run the query from the credits plan §6; zero rows expected. Any row → inspect `generation_events` for that user/day, then `adjustment`.

**Rotate `ACTIVITY_PEPPER`** — set new value, restart; document the date; accept a one-day correlation gap.

**Blindness check** — `/api/health` → `activity.dropped_24h` must be 0. If not: check DB health, then partitions (`SELECT relname FROM pg_class WHERE relname LIKE 'user_activity_events_%'`).

**Emergency stop of all metering and logging** — `CREDITS_ENFORCE=off`, `ACTIVITY_LOG=off`. Generation continues under the USD caps exactly as today.

---

## 6. Definition of done

| phase | done when |
|---|---|
| Rails (C1) | G1 green; ledger records every existing migration; SIGTERM flushes cleanly |
| Credits pilot (C2–C9) | Five pilot accounts hold granted credits, every paid path debits, reconciliation is empty for 3 consecutive days in `enforce`, an admin can grant/set/comp from the panel, and turning the switch to `shadow` restores today's behaviour in seconds |
| Activity (C6, C10) | Admin sees last login / never / online now / per-user timeline / executions / errors; zero drops across a redeploy; deleted accounts remain analysable without PII |
| Revenue (C11) | A real card buys credits once and only once; a refund reverses once; Stripe replays are inert |
| Steady state (C12) | Roll-ups and pruning run unattended; export works; public pricing copy matches the system |

**Calendar:** Day 1 → C1–C5 (pilots provisioned by end of day, shadow). Day 2 → C6–C8 (activity live, gate visible). Day 3 → C9 (enforce) + C10. Day 4 → C11. Day 5 → C12. Each day ends on a green gate or the next day starts with the fix.
