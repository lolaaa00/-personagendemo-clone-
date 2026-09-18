# Portal map — the authenticated product

**App:** PersonaGen · SvelteKit 5 (runes) + Supabase · `personagen-svelte/`
**Scope:** every route behind authentication. The marketing page, `/login` and `/signup` are **out of scope** and are not edited by this work.
**Written:** 2026-09-13, Phase 0 of the portal UX overhaul.

**Companion documents**
- [state-matrix.md](state-matrix.md) — every data surface × every state it must render
- [system-audit.md](system-audit.md) — tokens, components, terminology (current state)
- [audit-interactions.md](audit-interactions.md) · [audit-system.md](audit-system.md) — the exhaustive source census from 2026-09-11, cited rather than repeated
- [design-system.md](design-system.md) — the target system (written during Phase 1)

**How this was produced.** Two exhaustive read passes over `src/routes/(portal)/**`, `src/routes/invite/[token]/` and `src/lib/components/**`, plus a live seeded tenant driven as all seven roles. Claims carry `file:line`.

---

## 0. Roles — seven distinct experiences

The portal has more role surface than any single page reveals. `workspace_members.role` carries four tiers, `workspaces.owner_id` a fifth, `platform_admins` a sixth, and "no workspace at all" is a seventh.

| Role | Source of truth | What it means here |
|---|---|---|
| **Platform admin** | `platform_admins` table → `isPlatformAdmin` | Admin Console *and* Model Manager. Global switches, every tenant's wallet. |
| **Workspace owner** | `workspaces.owner_id` | Owns the container and the personas. Only role that may rename/delete the workspace or delete a persona. |
| **Workspace admin** | `workspace_members.role = 'admin'` | Full operational control; may manage seats. Cannot delete the workspace or a persona. |
| **Workspace manager** | `role = 'manager'` | Approve/publish, connections, spend visibility. Cannot manage seats. |
| **Workspace creator** | `role = 'creator'` | Generate and draft. |
| **Workspace viewer** | `role = 'viewer'` | Read-only. **The role most likely to be shown a control that will 403.** |
| **Personal account** | no workspace row | The default post-signup state; `badgeLabel` renders "Personal account". |

`isWorkspaceAdmin` is computed as *owner OR admin* (`(portal)/+layout.server.ts`), and it is the only gate on the Admin Console nav entry. Manager, creator and viewer are **never distinguished in the shell** — see finding F-7.

### The audit tenant

`scripts/ux/audit-tenant.mjs` creates one account per role plus a brand-new empty account, a workspace (`UX Audit Co`) seating four of them, and realistic content owned by the owner: 6 personas across all 3 statuses, 30 posts across all 8 statuses, 2 brand briefs, 5 connections across 4 connection states, a persona group, a pending invite, and a credit ledger. `creator` is given a deliberately thin wallet (40 credits) so the out-of-credits path is reviewable; `fresh` owns nothing so every surface renders its zero state.

Accounts are created with the service role, never through `/api/auth/signup`, so the welcome-credit hourly cap that protects real signups is untouched. `destroy` removes exactly those users; every dependent row cascades from `auth.users`.

---

## 1. Route inventory

17 authenticated routes. "Reachable by clicking" means: from the portal entry (`/dashboard`), without typing a URL.

| # | Route | Purpose | Roles that can reach it | Click path | Reachable? |
|---|---|---|---|---|---|
| 1 | `/dashboard` | Portal entry. Roster health, KPIs, weekly volume. | all | — (entry) | ✅ |
| 2 | `/generations` | The library — every generated output + profile assets. | all | Sidebar → Library → All Generations | ✅ |
| 3 | `/favorites` | Hearted posts and personas. | all | Sidebar → Library → My Favorites | ✅ |
| 4 | `/trash` | Restore or purge deleted posts (30-day window). | all | Sidebar → Library → Trash | ✅ |
| 5 | `/review` | The approval queue. Approve / reject / edit / delete. | all | Sidebar → Publish → Review Queue | ✅ |
| 6 | `/calendar` | Schedule, compose, bulk-approve, plan a campaign. | all | Sidebar → Publish → Calendar | ✅ |
| 7 | `/brand-brief` | The brand bible that feeds every persona. | all | Sidebar → Setup → Brand Brief | ✅ |
| 8 | `/brand-brief/intel` | 6-step "Content Intelligence" wizard. | all | In-page link on `/brand-brief` | ⚠️ sub-route only |
| 9 | `/generator` | 3-step new-persona wizard. | all | Sidebar → Personas → New Persona | ✅ |
| 10 | `/personas/[agentId]` | The persona's home: identity, connections, content, Studio, autonomy. | all (RLS-scoped) | Sidebar persona rail; cards on 3 other pages | ✅ |
| 11 | `/settings` | Account, notifications, theme, provider keys, team, billing pointer, delete account. | all | Sidebar → Setup → Settings | ✅ |
| 12 | `/developer` | Mint/revoke API keys; live API console. | all (create gated by `apiAccess`) | Sidebar → Setup → Developer API | ✅ |
| 13 | `/guides` | In-app docs, changelog, roadmap, User Voice. | all | Sidebar → Setup → Docs | ✅ |
| 14 | `/billing` | The wallet: balance, plans, packs, ledger. | all | Sidebar credit pill **only** | ⚠️ conditional |
| 15 | `/admin` | Workspace oversight + (platform admins) global switches. | owner, workspace admin, platform admin | Sidebar → Admin Console | ✅ gated |
| 16 | `/models` | Model registry: pricing, defaults, catalog sync. | platform admin only | Sidebar → Model Manager | ✅ gated |
| 17 | `/invite/[token]` | Accept/decline a workspace invite. | anyone with the link (pre-auth) | Emailed link; layout banner | ✅ by design |

### Reachability findings

**F-1 · `/billing` has no first-class nav entry.** The only affordance is the credit pill in the sidebar footer, which renders behind two conditions: `{#if !sidebarState.collapsed}` **and** `{#if data.credits}`. `credits` is null whenever `creditsMode() === 'off'`, which is the code default (`src/lib/server/flags.ts:39`). So on a default install a fully-built Stripe checkout, plan picker and ledger are URL-only. Collapsing the sidebar hides it even when credits are on. The fallback link in Settings sits under a **"Coming Soon"** badge (`settings/+page.svelte:2220`) that contradicts the shipped page two lines below it.

**F-2 · `hooks.server.ts:57` `PROTECTED_PREFIXES` omits `/trash` and `/billing`,** against the instruction in its own comment. Both survive on their per-page `redirect(303, '/login')`, so they skip the outer gate and the placeholder-config interstitial.

**F-3 · `/brand-brief/intel` is reachable but not real.** See F-11.

---

## 2. Task journeys, ranked by frequency

Journey #1 is what a user does every day. Step counts are **clicks from the portal entry**, measured on the seeded tenant at 1280px, and are re-measured after every round.

### Journey #1 — Clear the approval queue *(daily, the core loop)*

The product's premise is that personas generate while you sleep and you approve in the morning. This is the journey that decides whether the product is worth opening.

| # | Route | Element | Expected state change | Success | Failure | Escape hatch |
|---|---|---|---|---|---|---|
| 1 | `/dashboard` | Sidebar → Review Queue | navigate | queue renders | — | — |
| 2 | `/review` | scan the queue | — | pending count visible | empty → "Queue is clear" | — |
| 3 | `/review` | **Approve** (row or `a` key) | `draft → scheduled` | row leaves queue, toast | toast + row stays | undo: none |
| 4 | `/review` | **Reject** (`r`) | `→ rejected` | reason picker, row leaves | toast | undo: none |
| 5 | `/calendar` | confirm the slot | — | post visible on its date | — | reschedule |

**Baseline:** 2 clicks to the queue, 1 click per decision, keyboard `j/k/a/r/o/z` available. This journey is the portal's strongest surface and the bar the rest should meet.

**Gap:** approve and reject are irreversible with no undo, and rejection is not visible anywhere afterwards except a status filter. There is no "what did I just do" affordance.

### Journey #2 — Create a persona and get the first post out *(onboarding, once per persona)*

| # | Route | Element | Expected | Success | Failure | Escape hatch |
|---|---|---|---|---|---|---|
| 1 | `/dashboard` | New Persona | navigate | wizard step 1 | — | — |
| 2 | `/generator` | 3 steps, **0 required fields** | draft persisted to localStorage | step 3 review | — | leave (draft kept) |
| 3 | `/generator` | Create Persona | `agents` row | redirect to `/personas/[id]` | **toast at the final click** | none |
| 4 | `/personas/[id]` | Generate / composer | preview → quote → confirm | draft post | provider error | Cancel |
| 5 | `/review` | Approve | `→ scheduled` | scheduled | — | — |

**Strength:** zero required fields in step 2 is the right pattern and must not regress.

**F-4 · The plan limit is enforced only at the last click.** `POST /api/agents` calls `personaLimitExceeded`, and `entitlements.personaLimit` is already in `data` on every page — but `/generator` never reads it (`grep -c entitlements` = 0). A limited plan completes all three steps and fails on submit with a toast. Every other gated action in the portal (`developer`, `settings`, `brand-brief`, `calendar`, `personas`) mirrors its gate client-side with a disabled control and a visible reason. This one does not.

### Journey #3 — Schedule a week of content *(weekly)*

| # | Route | Element | Expected | Success | Failure | Escape hatch |
|---|---|---|---|---|---|---|
| 1 | `/dashboard` | Sidebar → Calendar | navigate | month grid | — | — |
| 2 | `/calendar` | Plan Campaign | planner modal | slots proposed with a pre-spend estimate | disabled when 0 personas | Cancel |
| 3 | `/calendar` | composer / Generate Post Now | post rows | drafts appear | toast | Cancel |
| 4 | `/calendar` | Manage posts → bulk approve | `→ scheduled` | rows update | toast | — |

**F-5 · The calendar grid is read-only.** There is no drag-to-reschedule anywhere in the portal; rescheduling requires opening a post and editing a date field. `calendar/+page.svelte:953` documents this as deliberate, but it is the single largest step-count cost in this journey.

### Journeys #4–#7 (lower frequency, still in scope)

4. **Tune a persona** — `/personas/[id]`: identity, appearance, autonomy, connections, Studio. The densest page in the app (10,177 lines; 112 `onclick`).
5. **Maintain the brand brief** — `/brand-brief`: 6 tabs, per-field AI enrich/generate/spin, product and competitor CRUD.
6. **Administer** — `/admin`, `/models`, `/settings → Team`: seats, invites, spend, platform switches.
7. **Money** — `/billing`: balance, plan, packs, ledger.

---

## 3. Interaction inventory

The exhaustive per-element census (851 interactive elements in source markup) lives in [audit-interactions.md](audit-interactions.md) §2 and is not repeated. This section records only elements that are **not `wired`**, since those are what Phase 1 must fix.

Legend: `dead` = no handler or inert · `broken` = handler exists but the effect is wrong or fake · `no feedback` = state changes with no visible acknowledgement · `no persistence` = change is lost on reload.

| # | Screen | Element | `file:line` | Classification | Note |
|---|---|---|---|---|---|
| F-6 | `/dashboard` | "Awaiting your first persona" | `dashboard/+page.svelte:70` | **dead** | A `<span class="step-link disabled">` styled exactly like its two sibling anchors, with `cursor: not-allowed`. Reads as a broken link. |
| F-11 | `/brand-brief/intel` | entire step-5 "Generate strategy" | `brand-brief/intel/+page.svelte` | **broken** | `await new Promise(r => setTimeout(r, 2500 + Math.random()*1500))` then a hardcoded literal. Zero `fetch(` in the file. |
| F-12 | `/brand-brief/intel` | steps 2–4 inputs | same | **no persistence** | Competitor URLs, content types, age range, interests and locations are collected and never read by the result generator, never written to the brief, never sent anywhere. |
| F-13 | `/brand-brief/intel` | step-6 results | same | **no persistence** | The strategy is written only to `localStorage`; "Done" returns to `/brand-brief` with nothing saved. |
| F-14 | `/guides` User Voice | vote up/down | `guides/+page.svelte` | **no feedback** | Optimistic write; on failure only a list-level `uvError` appears. Nothing marks *which* vote was reverted. |
| F-15 | `/admin` | 14 switch + comp controls | `admin/+page.svelte:81, :286` | **inconsistent** | `window.prompt()` for the mandatory audit note. Cannot be styled, cannot show the target row, and is the only prompt in the portal. |
| F-16 | `/billing` | Cancel plan | `billing/+page.svelte:24` | **inconsistent** | Native `confirm()`. The only one left; everything else uses `confirmAction()`. |
| F-17 | `/admin` | "Live feed" tab | `admin/+page.svelte` | **surprising** | Looks like a tab, also fires a fetch as a side effect. |

**F-18 · The fabricated-metrics problem is the most serious item in this table.** `/brand-brief/intel` step 6 presents invented numbers as the user's own baseline — `{ metric: 'Total Followers', current: '2,400', target30: '3,800', target90: '12,500' }`, `{ metric: 'Engagement Rate', current: '2.1%' }` — to a user who has never connected an account. This is not a polish issue; it is the portal telling the user something false about their own business. It fails the mission's **trust** win condition outright.

---

## 4. CRUD integrity

Can each object be created, read, updated and deleted from the UI, and does each survive a hard reload? Runtime columns are verified by `scripts/ux/portal-gate.mjs` (Phase 2) against the seeded tenant.

| Object | Create | Read | Update | Delete | Survives reload | Gaps |
|---|---|---|---|---|---|---|
| Persona (`agents`) | `/generator` | `/personas/[id]`, rail, dashboard | `/personas/[id]` | `/dashboard` roster bulk; owner only | ✅ | Limit enforced only at final click (F-4) |
| Post (`posts`) | composer, Generate Now, campaign | feed, review, calendar, generations | drawer (caption, schedule, status) | soft → `/trash`, purge | ✅ | No undo on approve/reject |
| Brand brief | `/brand-brief` New Brief | same | same, per-field AI | same (confirm) | ✅ | — |
| Content strategy | `/brand-brief/intel` | — | — | — | ❌ **never persisted** | F-11/12/13 |
| Persona group ("Project") | layout modal | sidebar sections | modal | modal | ✅ | Called *project* in UI, `persona_groups` in data |
| Workspace | `/settings → Team` (gated `teams`) | same | rename (owner) | delete (owner) | ✅ | — |
| Seat / invite | `/settings → Team` | same, `/admin → Seats` | role select, spend limit | remove / revoke | ✅ | Managed in Settings, *reported* in Admin — split surface |
| Connection | `/personas/[id] → Connections` | same | reconnect | disconnect | ✅ | 4 states exist; only 2 are styled distinctly |
| API key | `/developer` (gated `apiAccess`) | same | — | revoke | ✅ | — |
| Provider / Zernio key | `/settings` | same | save/test | delete | ✅ | — |
| Wallet / credits | `/billing` packs | pill, `/billing` | — | — | ✅ | Nav affordance is conditional (F-1) |
| Feature request | `/guides → User Voice` | same | vote | delete own | ✅ | Vote failure is silent (F-14) |
| Model registry row | `/models` sync | same | price/quality/default/enabled | — | ✅ | Platform admin only |
| Platform setting | — | `/admin → Controls` | 13 switches | — | ✅ | `window.prompt` for the note (F-15) |

---

## 5. Shell — what every screen shares, and does not

One sidebar, one header, one toast stack, one confirm dialog are mounted in `(portal)/+layout.svelte`. Below that line the consistency stops:

- **9 page-header patterns, 8 `h1` sizes, 10 subtitle class names.** `.page-header` itself is redeclared in 5 files with different rules.
- **12 container shells.** Four pages use the class `.page` with four different max-widths (800 / 960 / 1240 / 1400). None of the five `--container-*` tokens is referenced by any portal page.
- **3 toast systems** at 3 positions and 3 z-indexes; the `/admin` one sits at `z-index: 50` and renders *behind* every dialog.
- **13 modal shells** for one job; 5 of them live inside a class named `lightbox-backdrop` on the persona page.
- **9 tab implementations** with 4 different ARIA contracts, one with no roles at all.

Full tables in [system-audit.md](system-audit.md).

---

## 6. Open findings, ranked for Phase 1

| Rank | ID | Severity | Finding |
|---|---|---|---|
| 1 | F-11/12/13/18 | **blocker** | `/brand-brief/intel` simulates work and presents fabricated metrics as the user's own. |
| 2 | F-4 | **major** | Persona limit fails at the last click of a 3-step wizard. |
| 3 | F-1 | **major** | `/billing` has no reliable nav entry; Settings calls it "Coming Soon". |
| 4 | F-7 | **major → partial** | Manager / creator / viewer are not distinguished in the shell; read-only roles are shown write controls. *Round 1:* the spend surface is closed with the **server's** verdict — the composer's preview call already refuses seats below creator with 403, and that refusal now renders as a designed seat denial ("Your seat cannot generate for this persona", the server's per-persona reason, who can change it, **no Retry**) instead of "Can't prepare this generation — Retry" (`composer-seat-gate.spec.ts`). A client-side gate on `$page.data.seat` was tried and removed the same round: access is per persona (`agent_access_role`) while the layout seat is the account's *highest* membership seat, so it could block a Viewer generating for personas they own. Route-level denial on `/admin` and `/models` is now a designed 403 inside the portal shell instead of a silent bounce to `/dashboard` (`portal-permission-denied.spec.ts`). *Round 2 (one deeper):* `/review` was not a rendering gap but an **owner-scoped queue** — `/api/review` filtered `user_id = me` on GET and POST, so every member seat (admin, manager, creator, viewer) saw "Queue is clear" over the workspace's nine drafts, and a manager's decision was answered 404 "already reviewed?". Now: GET lists what RLS lets the seat see and carries the seat's role per post; POST checks manager access per persona and refuses the batch with the seat sentence; every decision control (grid, table, split, deck, bulk, drawer) is disabled with the reason for rows the seat cannot decide, and a read-only seat is told once, up front (`review-seat.spec.ts`). The persona page's `seat` is now that persona's role (`personas/[agentId]/+page.server.ts`), not the layout's upper bound. **Still open:** Delete Persona / Disconnect / Publish now on `/personas/[id]` render to seats that cannot use them — that page file was mid-edit by another session this round. |
| 5 | F-19 | **major** | No loading skeletons anywhere; 15 spinner variants; no page-level error state on 11 of 17 routes. |
| 6 | F-20 | **major** | No pagination or virtualization on any list; every list renders the full payload (`/review`, `/generations`, `/models`, `/admin`, `/calendar`). |
| 7 | F-6/14/15/16/17 | minor | Dead link-alike, silent vote failure, `window.prompt`, native `confirm`, tab-with-side-effect. |
| 8 | F-2 | minor | `PROTECTED_PREFIXES` out of sync with the route tree. |
| 9 | — | minor | Terminology: one object is called generation / content output / post / draft / asset; one container is workspace / team / brand / project / organization. |
