# State matrix — every data surface, every state

**Scope:** authenticated portal only. Companion to [portal-map.md](portal-map.md).
**Written:** 2026-09-13. **Method:** source audit of all 17 authenticated routes plus `src/lib/components/**`, cross-checked against a seeded tenant driven as seven roles before that tenant was removed.

Legend: ✅ designed · ⚠️ partial or inconsistent · ❌ absent · n/a not reachable for that surface.

---

## 0. The three findings that dominate this table

**S-1 · There is not one loading skeleton in the portal.** Every loading state is a spinner or a bare string. There are **15 distinct spinner classes** and `@keyframes spin` is declared **9 times** (once in `app.css:935`, then re-declared in `brand-brief`, `calendar`, `personas`, `settings`, `ActivityIndicator`, `GenerationComposer`, `ui/Button`, and the since-deleted `GenerationProgress`). A spinner tells the user to wait; a skeleton tells them what is coming and reserves its space. Every list in this portal therefore shifts layout as it loads.

**S-2 · No list is paginated, limited in the UI, or virtualised.** `/review`, `/generations`, `/favorites`, `/trash`, `/models`, `/admin` and `/calendar` each render the full server payload. Server caps exist (500 posts, 400 generation events, 150 activity rows) but they are silent truncations, not pagination: the user is never told the list is incomplete, and there is no way to reach row 501. The only pager in the portal moves between **guide pages**.

**S-3 · Eleven of seventeen routes have no page-level error state.** They fail to a toast, which disappears, or to an empty list, which reads as "you have nothing" rather than "we could not load this". `/trash`, `/models`, `/guides`, `/billing` and `/generator` are the exceptions and they are the pattern the rest should copy. `/generations` is the sharpest case: its server load returns `?? []` on failure, so a database error and an empty library are pixel-identical.

---

## 1. Route-by-route

### `/dashboard` — roster health, KPIs, weekly volume

| State | Today | Needed |
|---|---|---|
| Zero | ✅ 3-step onboarding card replaces the roster | keep |
| One | ⚠️ renders, but KPI tiles show a single data point as a trend | suppress trend arrows below 2 points |
| Many | ✅ | keep |
| Too many | ❌ roster renders every persona, no paging | page or virtualise past ~50 |
| Loading | ❌ SSR only; analytics panel spins | skeleton matching the KPI + table layout |
| Stale | ❌ nothing says the numbers are minutes old | "as of HH:MM" on the KPI row |
| Error | ❌ load swallows everything into `agents = []` | distinguish "failed to load" from "no personas" |
| Permission | ✅ *(round 1)* analytics now names the seat instead of a 403 | keep |
| Partial | ⚠️ analytics can fail while KPIs render — correct, but unlabelled | mark the failed panel |

### `/review` — the approval queue *(journey #1)*

| State | Today | Needed |
|---|---|---|
| Zero | ✅ "Queue is clear" | keep |
| Zero-after-filter | ✅ "No matching posts", distinct copy | keep — this is the portal's best empty state |
| One | ✅ | keep |
| Many | ✅ 5 view modes, keyboard triage | keep |
| Too many | ❌ renders all; server caps silently | count + paging; say when truncated |
| Loading | ⚠️ "Loading queue…" string, no skeleton | skeleton rows |
| Stale | ❌ queue can be minutes old; no refresh indicator | last-updated + auto-refresh hint |
| Error | ✅ `role="alert"` block | keep |
| Undo | ❌ approve and reject are irreversible, no undo | undo toast on both |

### `/calendar` — schedule and compose

| State | Today | Needed |
|---|---|---|
| Zero | ⚠️ grid renders empty with no explanation | explain + primary action |
| Too many | ❌ a heavy month renders every post | cap per day cell with "+N more" |
| Loading | ⚠️ per-action spinners only | month-grid skeleton |
| Error | ❌ toasts only | page-level failure state |
| Reschedule | ❌ grid is read-only; no drag | drag-to-reschedule, or an explicit affordance |

### `/generations`, `/favorites`, `/trash` — the library

| State | `/generations` | `/favorites` | `/trash` |
|---|---|---|---|
| Zero | ✅ filter-aware | ✅ with CTA | ✅ |
| Too many | ❌ 500-row silent cap | ❌ | ❌ 500-row cap |
| Loading | ❌ | ❌ | ❌ |
| Error | ❌ **`?? []` makes failure look empty** | ❌ toast only | ✅ `loadError` rendered |
| Expiry | n/a | n/a | ✅ urgent styling under 3 days |

### `/personas/[agentId]` — the densest page (10,177 lines)

| State | Today | Needed |
|---|---|---|
| Zero | ✅ per-lens empty states, filter-aware, with CTAs | keep |
| Loading | ✅ per-lens (`feedLoading`, `statusLoading`) | promote to skeletons |
| Error | ❌ page-level; hard errors become SvelteKit 404/500 | in-page failure for lens loads |
| Not found | ✅ 404 via `error(404, 'Persona not found')` | keep |
| Permission | ✅ *(round 1)* spend panel names the seat | extend to publish/connection controls |

### `/brand-brief` and `/brand-brief/intel`

| State | `/brand-brief` | `/brand-brief/intel` |
|---|---|---|
| Zero | ✅ products and competitors | ✅ *(round 1)* an empty brief now yields an explicit admission rather than invented advice |
| Loading | ⚠️ per-button labels | ✅ *(round 1)* real request, honest copy |
| Error | ❌ toast only; server load `console.error`s | ✅ *(round 1)* inline, with retry |
| Persistence | ✅ | ✅ *(round 1)* saved onto the brief; was previously never saved |

### `/settings`, `/developer`, `/guides`, `/billing`

| State | `/settings` | `/developer` | `/guides` | `/billing` |
|---|---|---|---|---|
| Zero | ✅ several | ✅ "No keys yet" | ✅ ×3 | ✅ wallet + ledger |
| Loading | ✅ two sections | ✅ button labels | ✅ | ⚠️ polls, no skeleton |
| Error | ❌ toast only | ✅ HTTP status + body | ✅ with Retry | ✅ `role="alert"` |
| Plan-gated | ✅ visible reason | ✅ visible reason | n/a | ✅ |

### `/admin` and `/models` — operator surfaces

| State | `/admin` | `/models` |
|---|---|---|
| Zero | ✅ ×8 | ✅ ×2 |
| Loading | ✅ labels | ✅ per-action |
| Error | ✅ controls + platform | ✅ **degrades gracefully twice** — the best error handling in the portal |
| Too many | ❌ 150 activity rows, no paging | ❌ 739 registry rows, no paging |
| Crash | ✅ *(round 1)* duplicate-key crash fixed | n/a |

### `/invite/[token]` — the best-covered state machine in the app

Five distinct branches, each with its own copy: not found · already accepted or revoked · expired · not signed in (names the invited address) · signed in as the wrong account (names both addresses). This is the standard the rest of the portal should be held to.

---

## 2. Cross-cutting states

| State | Status | Note |
|---|---|---|
| **Session expired mid-task** | ✅ *(round 1)* | Was a toast that stranded the user on a dead page. Now returns them to the page they were on after signing in. |
| **Deep link while logged out** | ✅ *(round 1)* | Was discarded. Now carried through login, with open-redirect refusal. |
| **Offline** | ❌ | No surface distinguishes "network down" from "server error". Every failure reads as the app's fault. |
| **Permission denied** | ⚠️ | Route-level gating is correct. Control-level is partial: `src/lib/seat.ts` exists and is wired into two surfaces; publish, approve, connection and delete controls are still rendered to seats that cannot use them. |
| **Forced password change** | ✅ | Blocking modal in the portal layout. |
| **Unsaved changes** | ⚠️ | `beforeNavigate` exists on the persona page only. The brand brief and generator keep drafts in `localStorage` instead, which is better, but the two patterns are not explained to the user. |
| **Partial widget failure** | ⚠️ | One failed panel does not blank a page, which is right, but nothing labels the failed panel. |

---

## 3. What Phase 1 owes this table

Ranked by how many surfaces each fixes at once:

1. **One `EmptyState` component** replacing 25 independent implementations, with a required explanation and an optional primary action.
2. **One `Skeleton` primitive** and adoption on the six list routes. This is the single largest perceived-performance win available.
3. **One page-level `ErrorState`** so the 11 routes that fail to a toast can say what failed and offer a retry.
4. **Pagination or virtualisation** on `/review`, `/generations`, `/models`, `/admin`, plus a visible "showing N of M" wherever a server cap bites.
5. **Seat-aware controls** everywhere, completing what `src/lib/seat.ts` started.
6. **Undo** on approve and reject.
