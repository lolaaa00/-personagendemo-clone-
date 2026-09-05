# PersonaGen — Admin Activity Log & User Behaviour Insights: Assessment & Plan

**Date:** 2026-09-05
**Companion to:** [credit-system-forensic-assessment-and-plan.md](credit-system-forensic-assessment-and-plan.md) (the credits plan defines `platform_admins`, the Platform tab on `/admin`, and `credit_ledger`; this plan reuses all three).
**Goal:** a platform admin can see, per user and across the platform: when they last logged in (or that they never have), who is online now, what they did, what executed on their behalf, what it cost, whether it succeeded, and exactly when — from a durable, append-only, pseudonymous event store that survives account deletion without keeping personal data.

**Interpretation of "de-identified":** event rows carry only the user's UUID (a pseudonym), never email, name, raw IP, or full user agent. Identity is resolved at display time, only for platform admins, only through the service role. When an account is deleted the rows survive with the UUID replaced by a one-way hash, so history and aggregates remain intact but can no longer be tied to a person. If you instead meant "identified" (admin sees emails), that is exactly what the admin panel shows — the two are not in conflict.

---

## 0. Executive verdict

**Today the platform can answer "what did this user do?" for three actions only** — generate, approve/reject, publish — and only inside one workspace, only by joining three domain tables at page-load time. It cannot answer "when did they log in", "are they online", "what page did they visit", "did the request fail", "how long did it take", "what did the autopilot run for them", or "what did the admin change". There is no activity table, no structured logger (200 `console.*` calls), and no request-level capture.

**The good news is structural.** Every request in the app passes through one function — `handle` in [hooks.server.ts](../../personagen-svelte/src/hooks.server.ts) — and every mutation lands in one of 38 API route files plus one engine route with 28 named actions. That is a small, enumerable surface. One capture point in `hooks`, one helper called from those routes, and one table gives complete coverage without touching the UI.

**The auth trail already exists but is half-blind.** Supabase's GoTrue keeps `auth.audit_log_entries` (1,119 rows since June) and `auth.sessions`. They are the source of truth for *login happened*. They are useless for *from where* — the app proxies sign-in through the SvelteKit server, so every entry records the server's own Docker IP and the user agent `node`. Real client IP and browser have to be captured by the app itself.

Three phases. Phase A (request log, presence, auth events, the Users table on the admin panel) is a one-day build and delivers most of what was asked. Phases B and C add semantic domain events, execution tracking, roll-ups, retention, and export.

---

## 1. What exists today — verified inventory

### 1.1 Behaviour data already in the database

| source | what it holds | timestamps | gap |
|---|---|---|---|
| `auth.users` | `created_at`, `last_sign_in_at` | ✅ | "never logged in" = `last_sign_in_at IS NULL` — already true for `matt@` and `claire@` |
| `auth.audit_log_entries` (GoTrue) | 1,119 rows: `login` 307, `logout` 16, `token_refreshed` 330, `token_revoked` 253, `user_signedup` 88, `user_deleted` 78, `user_modified` 31, `user_recovery_requested` 13, `user_updated_password` 3 | ✅ `created_at` | `ip_address` is **empty on every row**; not exposed through PostgREST (auth schema) |
| `auth.sessions` | one row per issued session; `created_at`, `refreshed_at`, `user_agent`, `ip` | ✅ | `user_agent` = `node`, `ip` = `172.22.0.1` (the app container) on every row — server-side sign-in hides the client. 8 stale sessions for one user; cannot answer "online now" |
| `generation_events` | every metered generation: provider, model, operation, cost, asset | ✅ | actor only; no duration, no outcome, no request linkage |
| `post_reviews` | approve/reject with reason and content snapshot | ✅ | complete for its scope |
| `posts` | status lifecycle (`draft → generating → scheduled → publishing → published/failed/partial`), `published_at`, `deleted_at` | ✅ | transitions are overwritten, not journaled — you see the current state, not when each change happened or by whom |
| `agents` / `agent_configs` | `created_at`, `updated_at`, `status`, autonomy settings | partial | no record of *who* changed what |
| `api_keys.last_used_at` | machine access | ✅ | 0 rows in prod |
| `workspace_invites` | invited / accepted / declined with `accepted_by`, `accepted_at` | ✅ | complete |
| `scheduler_leases` | which host holds the publish lease | ✅ | not a run log; autopilot has **no run history table** |
| `chat_sessions` / `chat_messages` | legacy chat feature | ✅ | not in current UI |

### 1.2 Capture surface

- **Single choke point:** `handle` in `hooks.server.ts` sees every request, resolves the session for protected prefixes, and has `event.route.id` (e.g. `/(portal)/personas/[agentId]`, `/api/agent/[agentId]/generate-post`). Client-side navigations still hit the server as `__data.json` requests for the page's server load, so page views are capturable **server-side without any client code**.
- **API-key requests** (`pg_live_…`) are resolved to a user in the same function — they are attributable identically, with `actor_kind='api_key'`.
- **Mutating routes:** 38 files export `POST/PATCH/PUT/DELETE`; `/api/engine` multiplexes 28 actions by a body field the hooks layer cannot see, so the engine must self-report the action name.
- **Background actors:** the scheduler and autopilot run under the service role with no request; they attribute to `agent.user_id`. They need an explicit `actor_kind='system'` emitter.
- **Client:** the portal layout has an `afterNavigate` hook (used only to move focus for accessibility). A beacon could hang off it later; not required for Phase A.

### 1.3 The existing admin "Activity log"

[admin/+page.server.ts](../../personagen-svelte/src/routes/(portal)/admin/+page.server.ts) builds a feed at page load by unioning `generation_events` (last 400), `post_reviews` (last 100), and published `posts` (last 100), scoped to the caller's workspaces, resolving emails through `auth.admin.getUserById` per unknown actor. It is a sound pattern (service role, scoped first, PII resolved at render) but it is:

- **workspace-scoped**, not platform-wide;
- **three event types**, no auth, navigation, settings, persona, or admin actions;
- **recomputed per page load** with hard row caps — it will silently truncate at 400 generations;
- **not filterable by user or time**, and has no per-user drill-down.

### 1.4 Infrastructure available on the production Postgres

| extension | state | use |
|---|---|---|
| `pg_net` | installed 0.14.0 | not needed |
| `pg_cron` | **available, not installed** | nightly roll-ups and retention pruning without a Node job |
| `pgaudit` | available, not installed | not recommended — logs SQL, not user intent; noisy |
| `pg_partman` | not available | monthly partitions will be created by a function instead |

Production is a single self-hosted Supabase on EasyPanel (`l2g-supabase.zi1cc5.easypanel.host`). The `/pg/query` endpoint the migration runner already uses can install `pg_cron` with one statement.

---

## 2. What the admin needs to see — the questions the system must answer

| question | answered by |
|---|---|
| Who has never logged in? | `auth.users.last_sign_in_at IS NULL` + zero `auth.login` events |
| When did X last log in, from what browser/country? | our `auth.login` event (real client IP hash + UA family); GoTrue entry as corroboration |
| Who is online right now? | `user_presence.last_seen_at > now() − 5 min` (maintained by the hooks layer) |
| What did X do yesterday, in order? | per-user timeline over `user_activity_events` |
| What ran for X without them clicking? | events with `actor_kind='system'` attributed to their `user_id` (autopilot, scheduler) |
| What did it cost / how many credits? | `est_cost_usd` and `credits_delta` on the event, linked to `generation_events.id` and `credit_ledger.id` |
| Did it work? How long did it take? | `outcome`, `status_code`, `duration_ms` |
| What did an admin change, and for whom? | `category='admin'` events with `target_user_id` (grants, mode changes, seat changes) |
| Which features are actually used? | roll-up by `action` per day |
| Where do users drop off? | roll-up by `route_id` per user per day |
| What broke, for whom? | `outcome='error'` feed with `error_code` |

---

## 3. Design

### 3.1 One table, append-only, pseudonymous

```sql
CREATE TABLE IF NOT EXISTS public.user_activity_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- who (pseudonymous: UUID only; NULL after anonymisation; subject_hash survives)
  user_id       UUID,                                    -- no FK on purpose: rows outlive the user
  subject_hash  TEXT NOT NULL,                           -- sha256(user_id || pepper); stable after deletion
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('user','api_key','system','admin','anonymous')),
  target_user_id UUID,                                   -- admin acts on someone else
  -- where
  workspace_id  UUID,
  agent_id      UUID,
  post_id       UUID,
  -- what
  category      TEXT NOT NULL,                           -- auth|nav|generation|review|publish|persona|brief|settings|team|billing|admin|api|scheduler|engine
  action        TEXT NOT NULL,                           -- dotted, from ACTIVITY_ACTIONS: 'auth.login.success', 'post.generate.requested', ...
  route_id      TEXT,                                    -- SvelteKit event.route.id
  method        TEXT,
  -- how it went
  outcome       TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok','error','denied','blocked')),
  status_code   SMALLINT,
  error_code    TEXT,                                    -- short machine code, never the message body
  duration_ms   INTEGER,
  -- money linkage (authoritative tables stay authoritative)
  generation_event_id UUID,
  credit_ledger_id    UUID,
  est_cost_usd  NUMERIC(10,6),
  credits_delta BIGINT,
  -- client context, reduced
  request_id    TEXT,                                    -- ties all events of one request together
  session_hash  TEXT,                                    -- sha256(access_token jti or cookie id) — never the token
  ip_hash       TEXT,                                    -- sha256(ip || daily salt): same person same day correlates, no IP stored
  ip_prefix     TEXT,                                    -- /24 (v4) or /48 (v6) for coarse geo/abuse — optional, env-gated
  country       TEXT,                                    -- from CF-IPCountry / Cloudflare header when present
  ua_family     TEXT,                                    -- 'Chrome', 'Safari', 'node', 'curl' — no full UA string
  device        TEXT,                                    -- desktop|mobile|tablet|bot|api
  -- free-form, allow-listed, size-capped (see 3.4)
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS idx_uae_user_time     ON public.user_activity_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_subject_time  ON public.user_activity_events (subject_hash, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_time          ON public.user_activity_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_cat_time      ON public.user_activity_events (category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_uae_outcome_time  ON public.user_activity_events (occurred_at DESC) WHERE outcome <> 'ok';
CREATE INDEX IF NOT EXISTS idx_uae_agent_time    ON public.user_activity_events (agent_id, occurred_at DESC) WHERE agent_id IS NOT NULL;

ALTER TABLE public.user_activity_events ENABLE ROW LEVEL SECURITY;
-- A user may read their own history (Settings → Activity, later). Nobody but the service role writes.
CREATE POLICY uae_select_own ON public.user_activity_events FOR SELECT USING (auth.uid() = user_id);
REVOKE UPDATE, DELETE ON public.user_activity_events FROM authenticated, anon;

-- Monthly partitions, created ahead by a function (no pg_partman on this host).
CREATE OR REPLACE FUNCTION public.ensure_activity_partition(p_month DATE) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_from DATE := date_trunc('month', p_month)::date; v_to DATE := (v_from + interval '1 month')::date;
        v_name TEXT := 'user_activity_events_' || to_char(v_from, 'YYYY_MM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    EXECUTE format('CREATE TABLE public.%I PARTITION OF public.user_activity_events FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);
  END IF;
END $$;
SELECT public.ensure_activity_partition(current_date), public.ensure_activity_partition((current_date + interval '1 month')::date);

-- Presence: one row per user, upserted (throttled) by the hooks layer.
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id       UUID PRIMARY KEY,                        -- no FK: cleared on delete, not cascaded
  last_seen_at  TIMESTAMPTZ NOT NULL,
  last_route_id TEXT,
  last_ua_family TEXT,
  last_device   TEXT,
  last_country  TEXT,
  session_hash  TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;   -- service role only

-- Daily roll-up for dashboards (filled nightly; pg_cron if installed, else the scheduler tick).
CREATE TABLE IF NOT EXISTS public.user_activity_daily (
  day           DATE NOT NULL,
  subject_hash  TEXT NOT NULL,
  user_id       UUID,
  category      TEXT NOT NULL,
  action        TEXT NOT NULL,
  events        INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  duration_ms_sum BIGINT NOT NULL DEFAULT 0,
  est_cost_usd  NUMERIC(12,6) NOT NULL DEFAULT 0,
  credits_delta BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject_hash, category, action)
);
ALTER TABLE public.user_activity_daily ENABLE ROW LEVEL SECURITY;  -- service role only

-- Expose GoTrue's audit trail to the admin page without granting the auth schema.
CREATE OR REPLACE FUNCTION public.admin_auth_events(p_user UUID DEFAULT NULL, p_limit INT DEFAULT 200)
RETURNS TABLE (occurred_at TIMESTAMPTZ, action TEXT, actor_id UUID, actor_email TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = auth, public STABLE AS $$
  SELECT a.created_at, a.payload->>'action', (a.payload->>'actor_id')::uuid, a.payload->>'actor_username'
  FROM auth.audit_log_entries a
  WHERE p_user IS NULL OR a.payload->>'actor_id' = p_user::text
  ORDER BY a.created_at DESC LIMIT p_limit
$$;
-- Not granted to authenticated: called only through the service role from admin routes.
```

Why these choices:

- **No FK to `auth.users`.** A cascade would erase the history the admin most wants (what did the deleted user do?). Anonymisation is explicit (§3.5).
- **`subject_hash`** makes per-user aggregates stable across deletion and lets the roll-up table never hold a UUID once the user is gone.
- **Partitioned by month** so retention is `DROP TABLE` on a partition, not a million-row `DELETE`.
- **Money stays in its tables.** `generation_events` and `credit_ledger` are authoritative; the activity row carries their ids and a denormalised cost so the timeline renders without joins.
- **Identity generated as `BIGINT`** for cheap ordering and cursors in the admin UI; `occurred_at` in the PK because of partitioning.

### 3.2 Capture layer 1 — the request log (hooks)

In `handle`, wrap `resolve(event)`:

```
request_id = crypto.randomUUID()            → event.locals.requestId; also X-Request-Id response header
t0 = performance.now()
response = await resolve(event)
if shouldLog(event):                        → enqueue({ ...context, status_code, duration_ms, outcome })
```

`shouldLog` = every request where **any** of these holds: method is not GET/HEAD; path starts with `/api/` (except `/api/health`, and except high-frequency polling routes listed in `ACTIVITY_SKIP`); route id is under `(portal)` or `(auth)` (page loads, including `__data.json`). Skip `/media/*`, `/_app/*`, favicons, and anything with no route id.

Context from the request: `user_id` (via `locals.safeGetSession()` — already called for protected prefixes; cache the result on `locals` so the route does not call it twice), `actor_kind` (`api_key` when the bearer path resolved, else `user`, else `anonymous`), `route_id`, `method`, `ip_hash`/`ip_prefix`/`country` from `CF-Connecting-IP` / `X-Forwarded-For` / `CF-IPCountry`, `ua_family` and `device` from a tiny UA reducer (no library needed: a dozen regexes), `session_hash` from the Supabase access-token `jti` or the auth cookie name — never the token.

Default `category`/`action` are derived from the route id by a lookup (`ROUTE_ACTIONS`): `/(portal)/calendar` → `nav.page.view` with `meta.page='calendar'`; `/api/agent/[agentId]/generate-post` POST → `post.generate.requested`; `/api/review` POST → `review.decision`; etc. A route can override or add to this by calling the helper in §3.3.

**Presence:** on any logged request with a user, upsert `user_presence` at most once per 60 s per user (in-memory `Map<userId, lastWrite>`).

**Never block, never lose quietly:** the emitter pushes into an in-process queue flushed every 2 s or at 200 rows via the service client in one `insert(rows)`. A failed flush retries once, then increments a dropped counter that is itself emitted as a `system.activity.dropped` event when the DB is back, and logged. On `process` `beforeExit`, flush. This is the same "best-effort" posture as the cost ledger, but with buffering and a visible loss counter instead of silence.

### 3.3 Capture layer 2 — domain events (`logActivity`)

`src/lib/server/activity.ts`:

```ts
export const ACTIVITY_ACTIONS = {
  'auth.login.success': 'auth', 'auth.login.failed': 'auth', 'auth.logout': 'auth', 'auth.signup': 'auth',
  'auth.password.changed': 'auth', 'auth.email.changed': 'auth',
  'nav.page.view': 'nav',
  'persona.created': 'persona', 'persona.updated': 'persona', 'persona.deleted': 'persona',
  'persona.avatar.generated': 'persona', 'persona.kit.generated': 'persona', 'persona.identity_kit.generated': 'persona',
  'post.generate.requested': 'generation', 'post.generate.completed': 'generation', 'post.generate.failed': 'generation',
  'post.refine.requested': 'generation', 'post.deleted': 'publish', 'post.restored': 'publish',
  'review.approved': 'review', 'review.rejected': 'review',
  'publish.requested': 'publish', 'publish.succeeded': 'publish', 'publish.failed': 'publish',
  'autopilot.run.started': 'scheduler', 'autopilot.run.finished': 'scheduler', 'autopilot.slot.generated': 'scheduler', 'autopilot.slot.failed': 'scheduler',
  'scheduler.publish.attempted': 'scheduler',
  'brief.saved': 'brief', 'brief.scraped': 'brief',
  'settings.api_key.saved': 'settings', 'settings.api_key.removed': 'settings', 'settings.zernio_key.saved': 'settings',
  'team.invite.sent': 'team', 'team.invite.accepted': 'team', 'team.seat.role_changed': 'team', 'team.seat.limit_changed': 'team', 'team.seat.removed': 'team',
  'billing.credits.debited': 'billing', 'billing.credits.blocked': 'billing', 'billing.checkout.started': 'billing', 'billing.purchase.completed': 'billing',
  'admin.credits.granted': 'admin', 'admin.credits.set': 'admin', 'admin.mode.changed': 'admin', 'admin.user.viewed': 'admin', 'admin.export.downloaded': 'admin',
  'engine.<action>': 'engine',           // one per engine action name, validated against the 28 known names
  'api.key.used': 'api',
  'account.deleted': 'auth',
} as const;

export function logActivity(locals, e: { action: keyof typeof ACTIVITY_ACTIONS; outcome?; agentId?; postId?; workspaceId?; targetUserId?; meta?; estCostUsd?; creditsDelta?; generationEventId?; creditLedgerId? })
export function logSystemActivity(e: { userId; action; ... })   // scheduler / autopilot, no request
```

Rules: `action` must be a key of `ACTIVITY_ACTIONS` (typed, so an unknown action does not compile); `category` comes from the map, never from the caller; `meta` passes through the sanitiser (§3.4). The helper reuses `locals.requestId` so the request-log row and the domain rows of one request share it.

**Where it is called (Phase B checklist)** — the 38 mutating routes + the engine + the two background loops:

| area | emit |
|---|---|
| `/api/auth/login`, `signup`, `logout`, `callback` | `auth.*` with real IP/UA — the one place GoTrue cannot see |
| `/api/agent/[id]/generate-post`, `refine-post`, `generate-avatar`, `generate-reference-kit` | requested (sync), completed/failed (from the detached task, with `duration_ms`, `generation_event_id`, cost) |
| `/api/review` | `review.approved` / `review.rejected` with `post_id`, `agent_id` |
| `/api/agent/[id]/publish-post`, `posts` DELETE/restore, `delete-assets` | `publish.*`, `post.deleted`, `post.restored` |
| `/api/agents`, `/api/agents/config` | `persona.created/updated/deleted` with `meta.fields=[…changed keys]` (names only, never values) |
| `/api/engine` | `engine.<action>` per call; the 6 paid actions also carry cost once metered (credits plan Phase 1.4) |
| `/api/settings/*`, `api-keys`, `zernio-keys` | `settings.*` (never the key; provider name only) |
| `/api/workspaces/**` | `team.*` with `target_user_id` |
| `/api/admin/credits` (credits plan) | `admin.*` with `target_user_id`, amount in `meta` |
| `autopilot.ts`, `scheduler.ts` | `logSystemActivity` per run and per slot/publish attempt, attributed to `agent.user_id` |
| `/api/account/delete` | `account.deleted`, then anonymise (§3.5) |

A vitest "touchpoint" test asserts every file that exports a mutating handler imports `logActivity` — the same discipline the persona plan applies to profile fields.

### 3.4 De-identification rules (enforced in code, not by convention)

1. **Rows never contain:** email, name, raw IP, full user agent, tokens, API keys, passwords, prompts, captions, or media URLs. The sanitiser strips any `meta` value matching an email regex, a key prefix (`pg_live_`, `sk-`, `key-`, `Bearer `), or longer than 200 characters, and drops keys not in the per-action allow-list.
2. **IP** is stored as `sha256(ip || YYYY-MM-DD || ACTIVITY_PEPPER)` — correlates one person's requests within a day, cannot be reversed, cannot be joined across days. `ip_prefix` (/24) is optional and off unless `ACTIVITY_STORE_IP_PREFIX=true`.
3. **Session** is a hash of the token id, never the token.
4. **Identity resolution happens only in admin routes**, through the service role, at render time — exactly how the current admin page already resolves emails. Nothing PII-bearing is written to the events table by any path.
5. **The pepper** (`ACTIVITY_PEPPER`) lives in env beside `USER_SECRETS_ENCRYPTION_KEY`; rotating it breaks cross-period correlation on purpose.

### 3.5 Durability and lifecycle

- **Append-only:** `UPDATE`/`DELETE` revoked from app roles; only the retention function drops partitions.
- **Anonymise on account delete:** `UPDATE user_activity_events SET user_id = NULL, target_user_id = NULL WHERE user_id = $1` (subject_hash remains) and `DELETE FROM user_presence`. Add this step to the existing wipe list in `/api/account/delete`.
- **Retention:** raw events 180 days (env `ACTIVITY_RETENTION_DAYS`), roll-ups indefinitely. `prune_activity_partitions()` drops partitions older than the window and creates next month's; scheduled by `pg_cron` (`CREATE EXTENSION pg_cron` — available on this host) or, if you prefer no new extension, by the existing scheduler tick once a day under its lease.
- **Roll-up:** `rollup_activity_daily(day)` upserts `user_activity_daily` from the raw partition; idempotent, re-runnable.
- **Backfill from history (one-off, Phase A):** `auth.audit_log_entries` (`login`, `logout`, `user_signedup`, `user_deleted`), `generation_events`, `post_reviews`, and `posts.published_at` are transformed into activity rows with `meta.backfilled=true`, so the timeline is not empty on day one (307 logins, 643 generations, every review, every publish).
- **Loss visibility:** dropped-row counter surfaces on the admin Platform tab as "activity events dropped in last 24 h" — the system tells you when it is blind instead of pretending.

### 3.6 Admin panel — the surfaces

All on the platform-admin-only tab from the credits plan; every view is a server load or an `/api/admin/activity` route (service role, `requirePlatformAdmin`). Every admin view itself emits `admin.user.viewed` / `admin.export.downloaded`.

1. **Users** — one row per auth user: email, created, **last login** (from our `auth.login.success`, falling back to `auth.users.last_sign_in_at`), login count, **last seen** and **online now** (presence within 5 min), status pill (`never logged in` / `active 7d` / `dormant 30d` / `deleted`), workspace + role, credits balance, spend this month, generations, published posts, errors 24 h. Sortable, searchable. Click → timeline.
2. **User timeline** — reverse-chronological events for one user with filters (category, outcome, date range), each row: time, action, persona, outcome, duration, cost/credits, route, device, country; expand → sanitised `meta` and linked records (post, generation event, ledger row). Also a small "sessions" strip from `auth.sessions` + our presence.
3. **Live** — everyone with presence in the last 5 minutes and their last route; a streaming tail of the last 100 events across the platform (polling every 10 s is enough at this scale).
4. **Executions** — generation and autopilot runs only: who/what/when, duration, outcome, cost, credits; group by persona; failure rate per day.
5. **Errors** — `outcome <> 'ok'` feed with `error_code`, route, user, count per hour.
6. **Usage** — from `user_activity_daily`: actions per day, feature adoption (which actions each user has ever done), drop-off by route.
7. **Export** — CSV of any filtered view; pseudonymous by default, with an "include emails" toggle that is itself logged.

The existing workspace-scoped Activity tab stays for workspace admins; it should be re-pointed at `user_activity_events` filtered by workspace so both audiences read the same source.

---

## 4. Phases

### Phase A — request log, presence, auth events, Users table (~1 day)
1. Migration: `user_activity_events` (+ partitions), `user_presence`, `user_activity_daily`, `admin_auth_events()`, `ensure/prune` functions. Add to `build-bootstrap.mjs` ORDER.
2. `activity.ts`: queue, flush, sanitiser, UA reducer, `logActivity`, `logSystemActivity`, `ROUTE_ACTIONS`.
3. `hooks.server.ts`: request id, timing, `shouldLog`, presence throttle. Add `requestId` and a cached session to `App.Locals` in `app.d.ts`.
4. Auth routes emit `auth.*` with client IP/UA.
5. Backfill script from GoTrue + domain tables.
6. Admin: Users table + Live view + Executions view (executions come free from `generation_events` join).
7. Tests: sanitiser (emails, keys, long strings), `shouldLog` matrix, presence throttle, queue flush/retry/drop counter, `requirePlatformAdmin` on every new route.

### Phase B — domain events, timeline, errors (~1 day)
1. `logActivity` calls per the §3.3 checklist; engine self-reports `engine.<action>`.
2. Autopilot/scheduler system events.
3. Account-delete anonymisation.
4. Admin: per-user timeline with filters, Errors feed.
5. Touchpoint test: every mutating route logs.

### Phase C — roll-ups, retention, usage, export (~0.5–1 day)
1. `CREATE EXTENSION pg_cron`; schedule nightly roll-up, partition creation, pruning. Fallback: scheduler tick.
2. Admin: Usage dashboards and CSV export.
3. Optional client beacon (`/api/telemetry`, `sendBeacon` from `afterNavigate` and a short allow-list of UI events such as composer opened / template chosen) — only if server-side page views prove insufficient.
4. Settings → Activity for end users (their own rows via the RLS policy) — transparency, and it doubles as a self-serve "was that me?" security page.

---

## 5. Test plan

- **Unit:** sanitiser strips email/key/long values and unknown keys; UA reducer maps 20 known strings; `ip_hash` differs across days and matches within a day; `shouldLog` includes `POST /api/*`, `(portal)` page loads, `__data.json`, excludes `/media`, `/api/health`, polling routes; queue flushes at 2 s and 200 rows, retries once, counts drops.
- **DB:** partition routing by month; `REVOKE` blocks update/delete as `authenticated`; `admin_auth_events()` not executable as `authenticated`; anonymise leaves `subject_hash` and removes `user_id`; roll-up idempotent.
- **E2E (pilot cohort):** log in as `ly@` → Users table shows last login within seconds with browser family and country; `matt@` shows *never logged in*; generate a post → timeline shows requested → completed with duration and credits; approve it → `review.approved`; autopilot tick → `autopilot.slot.generated` attributed to the persona owner with `actor_kind=system`; admin grants credits → `admin.credits.granted` with `target_user_id`; delete a test account → its rows remain with `user_id NULL`; export CSV contains no emails unless toggled.
- **Load:** 10 k synthetic events/min for 5 min → no request latency change (>1 ms), no drops.

---

## 6. Files touched

| area | file |
|---|---|
| schema | `supabase/activity_log_migration.sql` (new), `supabase/build-bootstrap.mjs` |
| server | `src/lib/server/activity.ts` (new), `src/hooks.server.ts`, `src/app.d.ts`, `src/lib/server/autopilot.ts`, `src/lib/server/scheduler.ts`, auth routes, the 38 mutating routes, `src/routes/api/engine/+server.ts`, `src/routes/api/account/delete/+server.ts` |
| admin | `src/routes/api/admin/activity/+server.ts` (new), `src/routes/api/admin/users/+server.ts` (new), `src/routes/(portal)/admin/+page.server.ts` + `+page.svelte` (Users, Timeline, Live, Executions, Errors, Usage, Export) |
| ops | `scripts/backfill-activity.ts` (new), env: `ACTIVITY_PEPPER`, `ACTIVITY_RETENTION_DAYS`, `ACTIVITY_STORE_IP_PREFIX`, `ACTIVITY_SKIP` |
| tests | `src/lib/server/activity.spec.ts`, hooks spec, admin route specs, e2e pilot spec |

---

## 7. Production baseline for this plan (verified 2026-09-05)

| fact | value | consequence |
|---|---|---|
| GoTrue audit rows | 1,119 (login 307, signup 88, deleted 78) | login history exists from 2026-06-09 — backfill it |
| IP on those rows | empty on all; sessions show `172.22.0.1` / `node` | app must capture client IP/UA itself |
| never logged in | `matt@`, `claire@` (`last_sign_in_at NULL`, 0 logins) | the "never" state is already derivable |
| logins per user | monarchstackteam 138 · hnyx.user3 5 · ly 3 · verify-kit 3 · kelvin 1 · abby 1 · hq 1 · ratiogamo 0 | one account is ~90% of all activity |
| stale sessions | 8 open sessions for one user | `auth.sessions` cannot answer "online now"; presence table can |
| signup/delete churn | 88 signups, 78 deletions vs 10 users | heavy test churn; anonymisation must not cascade-delete history |
| `pg_cron` | available, not installed | one statement enables nightly roll-up and pruning |
