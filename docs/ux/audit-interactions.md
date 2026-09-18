# UI/UX Overhaul Audit — §2 Interaction Inventory · §3 State Inventory

Read-only source audit of `personagen-svelte`. No app was run; no test or typecheck was executed; no source file was modified by this audit. Every claim below cites `file:line` against the working tree at commit `9872669`.

> **Concurrent-edit notice.** While this audit was running, a separate process rewrote three files — `src/routes/+page.svelte` (2,160 → 2,739 lines), `src/routes/(auth)/login/+page.svelte` and `src/routes/(auth)/signup/+page.svelte`. Every finding for those three was **re-verified against the post-rewrite tree** and all of them survived; the citations below are the current ones. The landing page's interactive count fell from 18 to 15 because literal nav and pricing anchors became `{#each}` loops — the same rendered controls, fewer source occurrences. Nothing else in the tree changed during the audit.

**Scope.** All 20 `src/routes/**/+page.svelte` files, the three `+layout.svelte` files, and all 38 `src/lib/components/**/*.svelte` files — 59 Svelte files, ~59,400 lines. Server `+page.server.ts` loads were read only where a client state depends on them.

**Method.** A brace-and-quote-aware tag parser (not a line regex — Svelte attribute expressions contain `>`) enumerated every opening tag in markup, with `<script>`, `<style>` and HTML comments blanked. That census was then handed to nine parallel deep-read passes, one per file group, each reading its files end to end. Findings that carry weight in the ranked lists were re-verified directly against the source. **Nothing was sampled.** Where a pass declined to read a region it stated so, and in every case the region was a `<style>` tail containing no markup (verified by grep).

---

## §2 Interaction inventory

### 2.0 Census

**851 interactive elements** exist in source markup. This counts each source occurrence once: a control inside `{#each}` is one row, not N. `<label>` (165) and `<svelte:window>` (5) are excluded as non-interactive; `<div>`/`<span>`/`<img>` are counted only when they carry a handler or an interactive `role`.

| tag | count |
|---|---|
| `<button>` | 493 |
| `<input>` | 124 |
| `<a>` | 77 |
| `<select>` | 62 |
| `<textarea>` | 35 |
| non-interactive tag with handler (`div`/`span`/`img`/`section`/`video`) | 37 |
| `<summary>` | 16 |
| `<form>` | 6 |
| **total** | **851** |

659 live in `src/routes/**`, 192 in `src/lib/components/**`.

#### Per-file census (complete — all 851 accounted for)

| file | interactive | breakdown |
|---|---|---|
| `src/routes/(portal)/personas/[agentId]/+page.svelte` | 162 | button 98, select 15, input 11, div 11, a 9, summary 9, textarea 6, img 3 |
| `src/routes/(portal)/brand-brief/+page.svelte` | 98 | button 60, input 23, textarea 10, a 2, div 2, select 1 |
| `src/routes/(portal)/admin/+page.svelte` | 54 | button 37, input 11, a 5, select 1 |
| `src/routes/(portal)/review/+page.svelte` | 49 | button 39, input 5, select 4, textarea 1 |
| `src/routes/(portal)/settings/+page.svelte` | 47 | button 26, input 14, select 5, summary 1, a 1 |
| `src/lib/components/generation/GenerationComposer.svelte` | 44 | button 18, input 10, select 8, textarea 5, a 1, section 1, summary 1 |
| `src/lib/components/calendar/CalendarView.svelte` | 38 | button 32, div 3, select 3 |
| `src/routes/(portal)/guides/+page.svelte` | 36 | button 28, input 5, select 1, form 1, textarea 1 |
| `src/routes/(portal)/generator/+page.svelte` | 30 | button 13, select 6, textarea 5, input 4, div 2 |
| `src/routes/(portal)/+layout.svelte` | 27 | button 12, a 11, input 3, form 1 |
| `src/routes/(portal)/calendar/+page.svelte` | 27 | button 16, input 5, select 4, a 1, textarea 1 |
| `src/lib/components/feed/PostDrawer.svelte` | 25 | button 15, a 3, textarea 3, input 2, div 1, summary 1 |
| `src/routes/(portal)/brand-brief/intel/+page.svelte` | 23 | button 11, input 5, a 3, select 2, textarea 2 |
| `src/routes/(portal)/models/+page.svelte` | 19 | button 8, select 8, input 2, summary 1 |
| `src/routes/+page.svelte` (landing) | 15 | a 14, summary 1 |
| `src/routes/(auth)/signup/+page.svelte` | 17 | a 7, input 5, button 3, form 1, summary 1 |
| `src/routes/(portal)/developer/+page.svelte` | 14 | button 9, input 3, select 1, textarea 1 |
| `src/lib/components/feed/PostCard.svelte` | 10 | button 5, span 2, div 1, input 1, video 1 |
| `src/lib/components/shared/PersonaProjectsModal.svelte` | 10 | button 5, form 2, input 2, select 1 |
| `src/lib/components/generation/CampaignPlanner.svelte` | 9 | button 6, input 2, select 1 |
| `src/lib/components/agents/AgentRoster.svelte` | 7 | input 3, button 2, div 1, a 1 |
| `src/routes/(auth)/login/+page.svelte` | 6 | a 2, input 2, form 1, button 1 |
| `src/routes/(portal)/favorites/+page.svelte` | 6 | button 3, a 3 |
| `src/routes/(portal)/trash/+page.svelte` | 6 | button 6 |
| `src/lib/components/persona/TraitPicker.svelte` | 5 | button 2, div 1, summary 1, input 1 |
| `src/lib/components/feed/ManualDeleteNotice.svelte` | 5 | div 2, button 2, a 1 |
| `src/lib/components/ui/ConfirmDialog.svelte` | 5 | div 2, button 2, input 1 |
| `src/routes/(portal)/billing/+page.svelte` | 5 | button 5 |
| `src/lib/components/ui/ImageLightbox.svelte` | 4 | div 2, a 1, button 1 |
| `src/routes/(portal)/dashboard/+page.svelte` | 4 | a 4 |
| `src/lib/components/docs/KeyRoutingDemo.svelte` | 4 | input 2, label-wrapped |
| `src/lib/components/docs/SidebarMap.svelte` | 3 | button 2, a 1 |
| `src/lib/components/generation/ActivityIndicator.svelte` | 3 | button 3 |
| `src/lib/components/generation/MediaPreviewModal.svelte` | 3 | button 2, a 1 |
| `src/lib/components/ui/Modal.svelte` | 3 | div 2, button 1 |
| `src/lib/components/ui/SelectionToolbar.svelte` | 3 | button 3 |
| `src/routes/invite/[token]/+page.svelte` | 3 | a 3 |
| `src/lib/components/docs/FormatExplorer.svelte` | 2 | button 1, input 1 |
| `src/lib/components/docs/PostLifecycle.svelte` | 2 | button 2 |
| `src/lib/components/generation/GenerationProgress.svelte` | 2 | button 2 |
| `src/lib/components/agents/AgentConnectionStats.svelte` | 1 | a 1 |
| `src/lib/components/dashboard/AnalyticsChart.svelte` | 1 | svg (keyboard-operable) |
| `src/lib/components/dashboard/AnalyticsPanel.svelte` | 1 | button 1 |
| `src/lib/components/docs/ShotFigure.svelte` | 1 | button 1 |
| `src/lib/components/shared/Toast.svelte` | 1 | button 1 |
| `src/lib/components/ui/Button.svelte` | 1 | button 1 |
| `src/lib/components/ui/Input.svelte` | 1 | input 1 — **component has zero importers** |
| `KPIGrid` · `PlatformBars` · `SparkChart` · `FitVerdict` · `Card` · `StatusBadge` · `BrandWave` · `LifeDetails` · `StaleNotices` · `ViewerPanel` · `DocsDemo` | 0 | no interactive elements |

### 2.1 Status distribution

| status | count | share |
|---|---|---|
| `wired` | 742 | 87.2% |
| `no feedback` | **72** | 8.5% |
| `broken` | **25** | 2.9% |
| `dead` | **12** | 1.4% |

**109 of 851 controls (12.8%) are `dead`, `broken`, or `no feedback`.** Every one is enumerated below by `file:line` — the counts are the length of the tables in §2.2–§2.4, not an estimate.

A note on what was *not* found, because it reframes the problem: there is **no `href="#"`, no `href=""`, no empty `onclick={() => {}}`, and no console-only click handler anywhere in the codebase**, and **every one of the 493 buttons has a handler or `type="submit"`**. The classic "dead button" does not exist here. The failures are subtler and worse: controls that fire and say nothing, controls whose busy key never matches the one the markup reads, and one control that reports a success that never happened.

### 2.2 `dead` — 12 controls

| file:line | control | why dead |
|---|---|---|
| `src/lib/components/ui/Input.svelte:53` | the entire `Input` component | **Zero importers.** `grep` for `ui/Input` across `src/` returns nothing; login and signup hand-roll native inputs (the file's own comment at :4–10 explains why). Every branch, including the `{error}` render at :79, is unreachable. |
| `src/lib/components/feed/PostCard.svelte:249` | "Retry" on a failed-generation tile | `{#if onRetry}` at :248 can never be true — **no caller passes `onRetry`**. All four `<PostCard>` call sites (favorites:182, generations:434, personas:3616, trash:261) omit it. A failed generation therefore offers the user **no recovery action at all**. |
| `src/lib/components/agents/AgentRoster.svelte:427` | active/paused switch | `<input type="checkbox" checked={agent.active} tabindex="-1">` with no `onchange`, no `bind:`, no name. It is a CSS state hook. The real handler is on the `<label>` at :413, which is not focusable and has no key handler; the row's Enter handler (:304) early-returns unless `e.target === e.currentTarget`. **There is no keyboard path to this switch.** |
| `src/lib/components/calendar/CalendarView.svelte:528` | "N generating" chip | A `<span class="stat-chip">` styled identically to the four sibling filter buttons (same class, `cursor:pointer` at CSS :1145) with no handler. There is no `generating` entry in `STATUS_GROUPS` (:271–276), so it cannot be filtered. Looks clickable, is not, no explanation. |
| `src/routes/(portal)/dashboard/+page.svelte:70` | onboarding step 2, "Awaiting your first persona" | `<span class="step-link disabled">` — not an `<a>`, not a `<button>`. Steps 1 (:64) and 3 (:76) are real links. No `aria-disabled`, not focusable. Its body copy (:69) points at "the Connections tab" — **no route named `connections` exists.** |
| `src/routes/(portal)/billing/+page.svelte:219` | "Coming soon" pack buttons | Genuinely `disabled` when `!data.paymentsOpen`, so not a dead click — but the stated escape hatch at :204 ("message us and we'll load your wallet") is **plain text with no mailto, link, or contact route**, and the page contains zero `<a>` elements. |
| `src/routes/(portal)/calendar/+page.svelte:1370` | "No blueprints yet — analyze a competitor first" | An empty state implemented as a `disabled <option>`. Instruction with no link and no way to act on it. |
| `src/routes/(portal)/review/+page.svelte:1219` | "Enlarge image" (split view) | Rendered unconditionally; `openLightbox` early-returns at :286 when the post has no `media_url`/`poster_url`. Over a "no media" placeholder (:1232) this is a labelled button that silently does nothing. |
| `src/routes/(portal)/review/+page.svelte:1285` | "Enlarge image" (deck view) | Identical defect. |
| `src/routes/(portal)/settings/+page.svelte:1266` | `#profile-email` | `readonly` and focusable. Screen-reader users tab into "Email Address, read only" with no indication that the button at :1273 is the way to change it. |
| `src/lib/components/feed/PostDrawer.svelte:985` | generation thumbnails | Not clickable or enlargeable, unlike the main media at :666 — inconsistent within the same panel. |
| `personas/[agentId]/+page.svelte:4645` | avatar preview tile, no-photo state | `role`, `tabindex` and `aria-label` are all `undefined` when `characterRef` is null (:4649–4651), while `onclick` and `onkeydown` are attached unconditionally — and both short-circuit on `!characterRef`. In that state it is a nameless, unfocusable `<div>` carrying two dead handlers. |

Adjacent, and arguably worse than dead because they masquerade as controls: `src/routes/+page.svelte:443` and `:444` render (and again at `:696`/`:697`) `<span class="lp-chip-btn lp-chip-btn-primary">Approve</span>` and `<span class="lp-chip-btn">Edit</span>` in the hero. They are correctly `aria-hidden` and non-focusable, but sighted users see two button-shaped affordances that do nothing.

### 2.3 `broken` — 25 controls

#### The fabricated success

`src/routes/(portal)/brand-brief/+page.svelte:814` — the **Export** button.

```js
// :688
function exportBrief() {
    showToast('Brand brief exported', 'success');
}
```

The entire handler. Nothing is exported; nothing is even attempted. The user is told the operation succeeded. This is the only handler in the codebase whose body is a bare toast — verified by an AST-ish scan of every function body in all 59 files.

#### The fabricated network call

`src/routes/(portal)/brand-brief/intel/+page.svelte:1057` — "Generate Strategy".

```js
// :489
async function generateIntelStrategy() {
    intelGenerating = true;
    await new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));
    intelStrategyResults = generateIntelStrategyResults();
    intelGenerating = false;
    intelCurrentStep = 6;
}
```

No network call exists. `generateIntelStrategyResults()` (:412–487) returns a hardcoded literal with three string interpolations. The "current" growth metrics at :479–484 — `Total Followers 2,400`, `Engagement Rate 2.1%`, `Avg. Reach / Post 450` — are **invented numbers presented as this brand's own data**. The 2.5–4s delay exists to make it feel like a server call; it therefore "succeeds" fully offline. The busy state (spinner, `aria-busy`, live region at :1084) is well built, which makes the deception more convincing.

#### Busy-key mismatches — 8 AI Generate buttons

`generateField(fieldName, setter)` (brand-brief:589) sets `generating[fieldName]` using the **full prompt string** it was passed. Eight call sites pass a prompt but the markup reads a short key:

| file:line | handler sets `generating[…]` | markup reads `generating[…]` |
|---|---|---|
| `brand-brief/+page.svelte:1368` | `'UGC Video Script Guidelines and Formats for this brand'` | `'UGC Guidelines'` |
| `brand-brief/+page.svelte:1479` | `'Primary Font (suggest a Google Font name…)'` | `'Primary Font'` |
| `brand-brief/+page.svelte:1488` | computed from `fontPrimary` at click time | `'Secondary Font'` |
| `brand-brief/+page.svelte:1585` | `'Sample Social Media Post (write a realistic brand post…)'` | `'Sample Post'` |
| `brand-brief/+page.svelte:1638` | `'Target Audience Demographics'` | `'Demographics'` |
| `brand-brief/+page.svelte:1658` | `'Audience Interests & Behaviors'` | `'Interests'` |
| `brand-brief/+page.svelte:1678` | `'Primary Social Media Platforms for target audience'` | `'Platforms'` |
| `brand-brief/+page.svelte:1695` | `'Customer Pain Points this brand solves'` | `'Pain Points'` |

**8 of 11 Generate buttons never disable and never show their spinner.** Each is re-clickable during flight, firing N parallel paid LLM calls that race into one field, last write wins. The three that work (Tagline :1008, Mission :1032, Traits :1506) prove the pattern was intended. The sibling `spinField` and `extendField` call sites all match correctly — only `generateField` is wrong, and only where someone inlined the prompt instead of a key. The success toast also leaks the prompt: `"Customer Pain Points this brand solves generated!"`.

#### Two buttons, one behaviour, one false promise

`src/routes/(portal)/generator/+page.svelte:892` — "Register Automated Account" is `onclick={createPersonaDirect}` (:897), **the identical handler** as the "Create Persona" button beside it (:847). The card copy promises "automated account creation on Instagram, YouTube, etc. using the Account Factory service". No factory call exists anywhere in the file.

#### Silently discarded user input

`src/routes/(portal)/generator/+page.svelte:569` — the **Market** field is bound, persisted to `localStorage` (:226, :256), and printed back to the user on the Review step (:799). `buildCreatePayload()` (:283–297) does not include it; verified directly — the returned object has `name`, `handle`, `niche`, `platform`, `bio`, `gradient`, `initial`, `skills`, `ugcVoice`, `brandBriefId`, `personaProfile` and no `market`. The user picks a market, sees it confirmed, and it is dropped.

#### Remaining `broken`

| file:line | control | defect |
|---|---|---|
| `src/routes/+page.svelte:769` (×3 via `{#each PLANS}`; targets at :206, :225, :244) | pricing CTAs → `/billing?plan=…` | The landing page bounces signed-in users away (:28–30), so its only audience is logged out. `(portal)/+layout.server.ts:34` throws `redirect(303, '/login')`; `login/+page.svelte:59` hardcodes `goto('/dashboard')`. **No `redirectTo`/`returnUrl` mechanism exists anywhere in the app** (verified by grep across `src/routes` and `src/hooks.server.ts`). All three pricing CTAs silently discard the plan selection and land the user on the dashboard. "Talk to us" (agency tier) points at a self-serve billing page; no contact route exists. |
| `src/routes/invite/[token]/+page.svelte:106`, `:107` | "Log in" / "Sign up" | The adjacent copy (:102–103) says "then come back to this same link", but both destinations `goto('/dashboard')` on success. The invite URL is not preserved. |
| `src/routes/(auth)/signup/+page.svelte:504` | Admin PIN disclosure | The PIN field sits inside a collapsed `<details>`. `canSubmit` (:34–41) does not include `pin`, so submit is enabled; the server rejects with "Admin PIN is required" (`api/auth/signup/+server.ts:82`); that lands in `error` but **no summary list item corresponds to the PIN field** (:225, :231, :237, :242 are name/email/password/confirm), so the user is told "Check the details above" while the offending field is collapsed out of sight. |
| `src/routes/(portal)/guides/+page.svelte:1401` | category collapse toggles | `catOpen()` (:1017) returns `true` unconditionally while `query.trim()` or `provider !== 'all'`. The click mutates `expandedCats`, but the chevron and `aria-expanded` never change and nothing collapses — **inert exactly when the list is longest**. |
| `src/routes/(portal)/settings/+page.svelte:2065` | "Add N selected" | `teamBusy['bulk-…'] = false` (:895) is **not in a `finally`**, and `await loadWorkspaceDetail()` (:894) is outside any `try`. A rejected refetch leaves the button permanently disabled. |
| `src/routes/(portal)/settings/+page.svelte:2307` | delete-account dialog close (×) | Unlike Cancel (:2360–2361) it neither clears `deleteConfirmText` nor disables while `deleteInProgress`. The dialog can be dismissed **mid-deletion**, leaving the user on a page whose account is being destroyed with no progress indicator anywhere. |
| `src/lib/components/shared/PersonaProjectsModal.svelte:264` | per-persona project `<select>` | Uses `value=` not `bind:`, so on failure the DOM value is **never reverted**. The select keeps showing the project the persona was *not* moved to, while a toast says it failed. `settings:552/584/589` does the revert correctly — the pattern exists and was not applied here. |
| `src/routes/(portal)/calendar/+page.svelte:1579` | `cinematicBlocked` plan gate | `data?.entitlements?.cinematic === false`. `entitlements` is not in `PageData` and **`calendar/+page.server.ts` mentions `entitlements` zero times** (verified); its return is `{agents, realPosts, blueprints, autopilotConfigs, allowDemoMode}`. `undefined === false` is always `false`, so `cinematicBlocked` is permanently `null` and the gate can never fire. |
| `src/routes/(portal)/developer/+page.svelte:457` | "Send" (API console) | `riskOf(path, parsed)` (:247) inspects only the path and the body's `action`/`status` — **it never reads `cMethod`**. An HTTP `DELETE` or `PATCH` to any endpoint bypasses the Safe-mode guard and the danger confirm entirely. |
| `src/routes/(portal)/admin/+page.svelte:740` | default-currency `<select>` | `setSwitch` returns at :82 when the audit-note `window.prompt` is cancelled, **without reloading `controls`**. The select keeps showing the new value while the server keeps the old one — silent desync with no reconciliation path. |
| `src/lib/components/generation/GenerationComposer.svelte:1154` | kind radios | `pickKind` (:630–635) does not filter by `buildable`. On a host without ffmpeg, picking "Video" selects `motion-card` (`requires: ['ffmpeg']`), which the format list at :1172 filters out — **no format radio shows as checked**, and `confirm()` submits the unbuildable format anyway. |
| `src/lib/components/dashboard/AnalyticsPanel.svelte:144` | persona tabs | `role="tab"` in `role="tablist"` with `aria-selected`, but **no `aria-controls`, no `role="tabpanel"` anywhere in the file, no roving tabindex, no arrow keys**. Also an un-cancelled fetch in a `$effect` (:58–62) with no `AbortController` — rapid tab switching can land a stale response under the wrong persona. |
| `src/routes/(portal)/generator/+page.svelte:1058`, `:1137` | Vault direction input & idea chips | Unlike their step-1 twins (:447, :487) they do not call `saveProgress()`. A direction typed or picked inside the Vault is lost on refresh. |
| `src/lib/components/agents/StatusBadge.svelte:24` | status badge | `role="status"` — an ARIA **live region** — on a static per-row label rendered ×N (AgentRoster:370). Every badge announces itself on load. |
| `src/lib/components/generation/ActivityIndicator.svelte:78` | activity pill | `aria-controls="ai-activity-panel"` points at an element that only exists inside `{#if open}` (:29) — a dangling IDREF exactly when a user would follow it. |
| `src/routes/(portal)/models/+page.svelte:876` | empty-row cell | `<td colspan="10">` in an 11-column table (`<thead>` :639–651). |
| `src/routes/(portal)/trash/+page.svelte:195` | empty-state branch | Keys off `posts.length === 0` while the grid renders `visible` (:41, :259). A persona filter that matches nothing renders a **blank grid with a "0 posts" toolbar and no message**. |
| `src/routes/(portal)/billing/+page.svelte:207` | the only `{error}` renderer | Sits inside `{#if data.billingMode !== 'unmetered'}` (:198). On an unmetered account a failed subscribe or cancel is **completely invisible**. |
| `src/routes/(portal)/developer/+page.svelte:467` | console response block | A transport failure sets `cResponse` (:324) but leaves `cStatus === null`; the markup gates on `{#if cStatus !== null}`. **A failed request produces no visible output whatsoever.** |
| `src/routes/(portal)/brand-brief/+page.svelte:1842` | lightbox backdrop | `onclick` on a `role="presentation"` div with no `tabindex` and no key handler (Escape at :1837 is the only keyboard exit). |
| `personas/[agentId]/+page.svelte:6849` | "Remove this photo from history" | `disabled={kitRestoringUrl !== null}` gates on the **restore** flag, not a deletion flag. `deleteKitHistoryImage` (:2088–2113) has no in-flight state of its own, so the button stays live and re-clickable through the whole DELETE while showing nothing. Wrong flag, not merely a missing one. |
| `src/lib/components/persona/TraitPicker.svelte:145` | "+N more" expander | `aria-expanded="false"` is **hardcoded** on a control whose only job is to expand — it can never be true, because the button unmounts once `more === 0`. The announced state is the opposite of the truth. |

### 2.4 `no feedback` — 72 controls

These fire real work and tell the user nothing. Grouped by the leg that is missing.

#### (a) The spend button has no in-flight state — 1 control, highest blast radius

`src/lib/components/generation/GenerationComposer.svelte:2102`. `confirm()` (:844–915) sets no busy flag, never disables itself, renders no spinner, and has no success or failure branch. Its `disabled` (:2104) contains no in-flight term. It ends `onConfirm(body)` and returns. The only feedback is a *parent* choosing to close the modal (`calendar/+page.svelte:1587`). **A double-click fires two generations and two charges.** Two silent early-returns (`missingSourceClip` :852, `ownWordsBlocked` :889) make it a visible no-op in cases the `disabled` is supposed to have covered.

#### (b) Busy flag exists, is set, is never rendered — 19 controls

`src/routes/(portal)/review/+page.svelte` is the concentration. `working` is set at :152 and wired to `disabled` in **17 places** (:562, :686, :704, :724, :764, :976, :1000, :1004, :1014, :1151, :1160, :1168, :1255, :1259, :1267, :1328, :1341, :1396) and rendered as a busy *label* in **zero**. Approve, reject and bulk-approve therefore grey out and come back, which reads as "nothing happened". The same file gets it right for caption edit (:965 "Saving…") and bulk delete (:727 "Deleting…") — so the omission is selective, not systemic ignorance.

Also: `admin/+page.svelte:524, :544, :545, :568, :587, :607, :628, :645, :667, :686, :687, :704, :705, :725, :753` — every platform switch is `disabled={controlsBusy}` with no spinner and no label change, behind a thread-blocking `window.prompt` (:81).

#### (c) No busy flag at all on a server mutation — 21 controls

| file:line | control | what runs unguarded |
|---|---|---|
| `admin/+page.svelte:837` | "Grant to selected" | A **sequential loop of N wallet-grant POSTs** (:295) with no flag. The button stays enabled and unchanged throughout; repeat clicks re-fire the whole loop. |
| `admin/+page.svelte:885` | "Comp" / "Un-comp" | Flips a user's billing mode (:284) invisibly. |
| `admin/+page.svelte:369`, `:818`, `:916` | "Live feed" / "Refresh" | `loadLive` (:244) has no flag. |
| `settings/+page.svelte:1354`, `:1374`, `:1394` | the 3 notification switches | `toggleNotification` (:1019) flips optimistically and POSTs with no guard. Rapid clicks fire overlapping writes and the revert logic (:1044–1048) can un-flip the wrong state. |
| `settings/+page.svelte:2014`, `:2094` | workspace persona add/remove | `toggleWorkspacePersona` (:848–864) has **no success toast at all** — the only signal is a refetch redrawing the list. |
| `settings/+page.svelte:1938` | "Revoke" invite | No success toast (:766–782); the row simply vanishes. |
| `trash/+page.svelte:185`, `:247`, `:274`, `:277` | Empty Trash / Restore ×3 | `disabled={busy}` only, no label change. `busy` is global, so acting on one card disables **every** card with no indication which one is in flight. |
| `models/+page.svelte:711`, `:733`, `:750` | inline price / latency / quality edits | Commit-on-change, saving **real pricing**, with `class:row-saving` (:657) — an opacity tint (CSS :1302) — as the only signal. No `aria-busy`, no success confirmation. A non-numeric entry becomes `Number('') === 0` via `numInput` (:496) and silently saves `0`. |
| `developer/+page.svelte:406` | "Revoke" API key | No in-flight disable; double-click fires two DELETEs. |
| `PostDrawer.svelte:1420` | "Reject" | No busy flag, no disable, no label. |
| `PostDrawer.svelte:1459` | "Publish to a connected platform" | Same. |
| `AgentRoster.svelte:413` | active/paused switch | `toggleAgent` (:207) sets no flag; the documented double-fire bug (:417–422) is structurally still possible. |
| `GenerationProgress.svelte:43` | "Retry" | No busy state; the failed card is identical after the click. |
| `CampaignPlanner.svelte:426` | "Stop after this one" | **Nothing changes.** No disable, no relabel; the progress line (:415–418) keeps counting through the in-flight fetch plus a 250 ms sleep. The user cannot tell the click registered. |
| `guides/+page.svelte:1831`, `:1840`, `:1860` | upvote / downvote / delete | No in-flight state; `uvVote` (:1251) and `uvDelete` (:1288) have **no try/catch** and are invoked as `void fn()`, so any network-level failure is an unhandled rejection: the optimistic vote stays on screen permanently and nothing is said. |

#### (d) Work happens, nothing is persisted or shown — 12 controls

| file:line | control | note |
|---|---|---|
| `brand-brief/+page.svelte:1767`, `:1776`, `:1786` | competitor name / URL / notes | Edits mutate `competitors` and **never call `saveAll`**. Typing a competitor and navigating away loses it. `addCompetitor` (:718) also skips `saveAll`. |
| `brand-brief/+page.svelte:849` | "Save" | Toasts `'Brand brief saved'` (:328) **before** the DB round-trip; `persistBriefToDb` is fire-and-forget (`void`, :331). A later failure arrives as a second, contradicting toast. The button never disables. |
| `brand-brief/+page.svelte:1066`, `:1719` | product / competitor bulk bars | `busy` is **not passed** to `SelectionToolbar` — 5 of the 7 call sites pass it (calendar:1020, personas:3609, personas:3669, trash:241, AgentRoster:266); these two do not, so Delete never shows "Deleting…". |
| `brand-brief/+page.svelte:1506` | "Suggest" traits | `res.success === false` → **nothing happens at all**: no toast, spinner just stops (:1510 has no `else`). All-duplicates → silent (:1516). |
| `brand-brief/intel/+page.svelte:1103` | "Start Over" | Resets 12 state vars **and** `localStorage.removeItem` (:497–512) with **no confirm, no undo, no post-action toast** — while `confirmAction` is used three times elsewhere in the sibling file. |
| `guides/+page.svelte:1544` | provider chips inside an article | Only the left index (hidden ≤900px, CSS :2300) and the URL change. The article does not change; no toast, no scroll. |
| `guides/+page.svelte:1773`, `:1800` | feature-request form | On success the form closes (:1281) and the list silently reloads: no toast, no "added", no highlight. `uvSubmit` has `try/finally` with **no catch**, called as `void` — a network failure is swallowed entirely. |
| `SidebarMap.svelte:89` | docs map items | `onmouseenter`/`onfocus`/`onclick` all set `hovered = it`. The hover path works; a **mouse click produces zero visual change** because the value is already set. |
| `GenerationComposer.svelte:1601`, `:1624`, `:1805` | product photo URL / face override URL / own-still URL | A bad URL silently `display:none`s the thumbnail (`hideOnError` :927). No error text, no validity state. `:1805` is worse — any non-empty string flips `supplied:{still:true}` (:347) and **drops a paid stage and its price** with no preview and no validation. |
| `(portal)/+layout.svelte:984` | "Log Out" | All three legs missing: no busy flag, no success signal other than navigation, and both failure paths are `console.error` only (:121, :124). A failed logout leaves the user on the page with zero indication. |
| `generator/+page.svelte:974` | "Next" | On a pristine step 1 both inline errors (:543, :562) are suppressed, so the button is dead-looking with **zero** stated reason. |
| `review/+page.svelte:1092`, `:1121`, `:1332`, `:1372`, `:1398` | open-drawer controls | `drawerLoadingId` is computed for every view and rendered in **only two** (grid :838, split :1263). **Table is the default desktop view** (:456), so the default experience of clicking a row is a dead click until the network returns. |

#### (e) `/personas/[agentId]` — 9 controls, and the unpersisted-edit trap

| file:line | control | missing leg |
|---|---|---|
| `:3513` | "Sync Feed" | Busy flag and spinner are present, but `syncFeed` (:856) only awaits `loadFeed()`, which toasts **on failure only** (:784, :787). A sync that returns identical data is indistinguishable from a dead button. |
| `:4293` | "Download for upload" | `downloadAvatar` (:1345) fetches → blob → synthetic `<a download>`. **No busy flag, no disabled, no success signal.** A slow or silently-failing download looks like nothing happened. |
| `:4479`, `:4486` | username candidate input + "+ Add" | The duplicate path (:1315) **silently clears the input and does nothing** — no toast, no highlight of the existing chip. |
| `:5507` | "Save skill" | Writes local state only (:1432). No success toast, and nothing indicates the skill is **unpersisted** until the distant Save Profile. |
| `:5564` | "Save integration" | Identical (:1451). |
| `:5895` | "Delete Persona" | `deleteAgent` (:2846) confirms with `typeToConfirm`, then DELETEs and navigates — with **no busy flag anywhere**. Between confirm and navigation the button is live, idle-looking and re-clickable. |
| `:6159` | "Set as main handle" | `setMainHandle` (:2961) has no busy flag, no disable and no optimistic fill; the star only moves after the round-trip. |
| `:6233` | "Disconnect {platform}" | **No confirm** — the only destructive action on the page without one (compare :2020, :2850, :2089, :5363, :5438) — no busy flag, and the `catch` (:2956) collapses every failure into a generic "Unable to reach API". |

**The unpersisted-edit trap.** Six clusters — Persona Profile, Character & Visuals, Automation, Skills, Tools and the whole `TraitPicker` — share **one** persistence path: the single "Save Profile" button at `:5886`, at the bottom of a ~2,100-line scroll. **None of them has a dirty/unsaved indicator.** Every trait chip, textarea edit, "Save skill" and "Save integration" therefore *looks* committed and is not. The same file proves the fix exists twice over: the Identity Kit autosaves with a `kit-save-state` readout at `:4149` ("Saving… / Saved ✓ / Save failed", `aria-live`), and the Brand Brief tracks `brandDirty` (:292) and renders "Unsaved change — click **Apply brand brief** to confirm" (:3824).

#### (f) A silent data lie

`src/routes/(portal)/review/+page.svelte:161`. `act()` filters **every** id out of `items` regardless of `d.updated`, then reports `d.updated` in the toast (:166). If the server approves 2 of 5, five cards vanish and the toast says "2 post(s) approved". The delete path in the same file (:262–270) explicitly guards against exactly this and reloads — so the hazard was known.

### 2.5 Keyboard-inoperable handlers

37 non-interactive tags carry handlers. **35 are the correct modal pattern** — a `role="presentation"` backdrop plus a `role="dialog"` panel with `use:dialog`.

`src/lib/actions/dialog.ts` was read: it provides capture-phase Escape (:117–123), a Tab/Shift-Tab wrap **plus** a `focusin` guard that yanks focus back (:125–163), initial focus one rAF late (:207–210), focus restore (:223–226), body + `.portal-content` scroll lock (:83–97), and a proper nesting stack (:58). It does **not** set `role`, `aria-modal`, or background `inert` — callers must, and all six do.

Genuinely keyboard-inoperable:

| file:line | element | gap |
|---|---|---|
| `src/lib/components/agents/AgentRoster.svelte:413` | `<label onclick>` — the only activation path for the active/paused switch | Not focusable, no key handler, and the nested input is `tabindex="-1"`. **No keyboard path exists.** |
| `src/lib/components/ui/Modal.svelte:31` | backdrop `<div onclick={onClose}>` | **The only backdrop in the codebase without `role="presentation"`** — ConfirmDialog:42, ImageLightbox:83, ManualDeleteNotice:14, PostDrawer:590, brand-brief:1842, generator:1000, CalendarView:458/:823 and all six persona backdrops set it. Lint suppressed at :30. |
| `src/lib/components/calendar/CalendarView.svelte:458` | date-picker backdrop | `role="presentation"`, no `tabindex`, no key handler — **and no `use:dialog` on the popover**, so Escape does not close it either. A keyboard user can open the jump-to-date popover and only escape by tabbing through. |
| `src/lib/components/feed/PostCard.svelte:249`, `:419` | retry / publish-fallback chips | Correctly `role="button" tabindex="0"` with `onkeydown`, but handle **Enter only, not Space** — unlike the tile at :151 in the same file. |
| `src/lib/components/agents/AgentRoster.svelte:298` | row `role="link"` | Enter only (correct for link semantics) but **no accessible name**, and `role="link"` inside `role="table"` breaks the row/cell structure. |
| `src/lib/components/generation/GenerationComposer.svelte:1023` | `<section onkeydown>` | Keydown on a non-interactive container with no `tabindex`; works only by bubbling from focused descendants. |

### 2.6 Composite ARIA widgets

Labelling is good; keyboard behaviour is not implemented anywhere.

- **16 `role="radio"`** across 8 `role="radiogroup"` containers. Every group has a real `aria-labelledby` or `aria-label` pointing at rendered text. **Not one has arrow-key handling or a roving `tabindex`.** Every radio is an ordinary tab stop, so GenerationComposer's 8-option Format group costs 8 Tab presses and arrow keys do nothing — precisely what the `radio` role promises a screen-reader user it will do.
- **15 `role="tab"`** across 11 containers. Only **one** `role="tabpanel"` exists in the entire codebase (`brand-brief/+page.svelte:933`). `admin/+page.svelte:364` and `:374` and `developer/+page.svelte:343` declare `role="tablist"` with no `aria-label`. `developer:344–346` and all admin tabs omit `aria-selected`. `AnalyticsPanel:144` and `FormatExplorer:95` assert tab semantics with no panel, no `aria-controls`, no roving tabindex.
- **4 `role="switch"`** (models:869, settings:1363/1383/1403) all carry `aria-checked` — correct.

### 2.7 Accessible names

125 of 165 `<label>` elements carry a `for=`; **every one resolves to an existing `id` in the same file** (0 unresolved). The remaining 40 wrap their control, which is valid — except three that do neither and exist only to be pointed at by `aria-labelledby` (`brand-brief:1570`, `intel:822`, `intel:965`). Those work for AT but are invalid HTML and, more practically, **clicking the visible label does nothing**, a real regression against normal field behaviour.

Controls with no accessible name at all:

| file:line | control |
|---|---|
| `admin/+page.svelte:833` | platform search input (placeholder only) |
| `admin/+page.svelte:836` | bulk-grant note input (placeholder only) |
| `admin/+page.svelte:903` | action note input (placeholder only) |
| `developer/+page.svelte:371` | key label input (placeholder only) |
| `developer/+page.svelte:453` | console method `<select>` |
| `developer/+page.svelte:456` | console path `<input>` |
| `AgentRoster.svelte:427` | active/paused checkbox |
| `AgentRoster.svelte:298` | row `role="link"` |
| `GenerationComposer.svelte:1273` | `<video controls>` |
| `MediaPreviewModal.svelte:45` | `<video controls>` |
| `personas/[agentId]/+page.svelte:6744` | restore-avatar tile — name falls to `<img alt="Generated image">`, **identical for every tile in the grid** |
| `personas/[agentId]/+page.svelte:6834` | kit stage-history tile — `<img alt="Past generation">`, identical for all |
| `personas/[agentId]/+page.svelte:6884` | kit library tile — `<img alt="Library image">`, identical for all |

Three more are technically named but unusable: `review:1121` and `CalendarView:611/:722/:853` name a button with an entire caption, and `generator:1159` names a Vault card with a whole soul paragraph.

`models/+page.svelte:575` wraps **six** separate filter/sort controls in one `<label><span>Sort</span>` — invalid nesting that survives only because each control carries its own `aria-label`; the visible word "Sort" mislabels five filters.

Two cross-cutting cases worth naming separately:

- **`src/lib/components/shared/Toast.svelte:17`** — every toast is a `<button aria-label="Dismiss notification">` whose message lives in a child `<span>` (:37). The `aria-label` **overrides** the content, so the accessible name of every notification in the app is "Dismiss notification". This is the sink for **342 `showToast` call sites**, auto-dismissed after 4 s (`ui.svelte.ts:23`) with no pause-on-hover — errors included.
- **`src/lib/components/ui/Button.svelte:25`** — no `aria-label` prop exists. No current caller passes an icon-only child (login:244, signup:552, invite:116/:119 all pass text), so nothing is unnamed today; the hazard is latent.

### 2.8 Disabled without a stated reason

**221 `disabled` occurrences; 56 carry a `title` or `aria-describedby`; 165 state nothing.** Many of those 165 are self-evident (`disabled={busy}` beside a label that reads "Saving…"). The ones that leave a user stuck:

| file:line | disabled by | why it's opaque |
|---|---|---|
| `GenerationComposer.svelte:2104` | `ownWordsBlocked` | The explanations (:1366, :1368–1374) live on the **Look** step; the dead button is on **Deliver**. `missingSourceClip` gets a `title` — hover-only. |
| `generator/+page.svelte:845`, `:895` | `!step1Valid \|\| !step2Valid` | Step 3 renders **no** validation messaging, and `currentStep` is restorable from the URL (:17) and localStorage (:230) — so a user can land on step 3 with two permanently dead buttons and no explanation. |
| `calendar/+page.svelte:902` | `data.agents.length === 0` | The "create a persona first" prerequisite is never stated; the `title` (:903) describes the feature instead. |
| `brand-brief/+page.svelte` ×13 (1011, 1035, 1038, 1371, 1374, 1588, 1641, 1644, 1661, 1664, 1681, 1698, 1701) | `\|\| !field.trim()` | A greyed AI button with no "write something first" hint. The explanatory toasts at :569/:609 are unreachable — the button is already disabled. |
| `settings/+page.svelte:1648`, `:1659` | `!savedKey` | Nothing says "save a key first". |
| `settings/+page.svelte:1910` | `teamBusy` | The spend-limit input has **no `:disabled` CSS** (`.spend-limit-input` :3207 sets explicit bg/color and no disabled rule) — visually indistinguishable from enabled. |
| `models/+page.svelte:830`, `:867`, `:1025` | various | Reason exists **only in `title`** — invisible on touch and to keyboard users. |
| `intel/+page.svelte:1322` | `!canIntelProceed(n)` | Reason shown on step 1 only (:688–690). Steps 2, 3 and 4 disable "Next" with zero explanation. |
| `trash/+page.svelte:185, 247, 274, 277` | one global `busy` | Acting on one card visibly disables every card, with no indication which is in flight. |
| `billing/+page.svelte:188` | `subscribing !== null` | Clicking any plan disables all plans with no explanation on the others. |
| `PersonaProjectsModal.svelte:155, 193, 230` | one shared `busy` | An unrelated in-flight request greys out every button in the modal. |

Done correctly, for contrast: `signup:555` + `:575–579`, `brand-brief:802` + `:803` + `:808`, `settings:1621` + `:1668`, `settings:2151` + `:2171`, `settings:2343` + `:2352`, `developer:379` + `:389`, `AgentRoster:438–440`.

### 2.9 Swallowed errors

**19 truly empty `catch` blocks** and **2 console-only** catches (bodies parsed, not grepped):

Empty — `brand-brief:40, 282` · `intel:273` · `calendar:102, 830` · `generator:240` · `personas:967, 1118, 1412, 1421, 1573, 1952, 2146, 2373` · `review:466` · `settings:160, 929` · `CalendarView:88` · `PostDrawer:298`.

Console-only — `(portal)/+layout.svelte:123` (logout) · `personas:715` (voice catalog).

Most persona-route ones are defensible parse fallbacks with comments. The ones that cost the user something:

- `settings/+page.svelte:160` — a failed brand-brief fetch leaves the Theme picker showing only "PersonaGen default" **and** renders "No brand briefs saved yet" (:1480). The user is told they have no briefs when the request failed.
- `calendar/+page.svelte:102` — the entire brand-brief localStorage read; products and UGC guidelines are silently empty.
- `calendar/+page.svelte:823` — `Posts.get(...).catch(() => null)` **inside the 10-minute poll loop**. Every network error during polling is indistinguishable from "still generating"; the user waits the full timeout.
- `settings/+page.svelte:883` — `catch { failed++ }`: per-persona reasons destroyed, leaving "Added 3, 2 failed".
- `CampaignPlanner.svelte:277` — `catch { failCount++ }`: a 403 PLAN_FEATURE, a 500 and a dropped connection are all just a number.
- `PostDrawer.svelte:347` — `.catch(() => {})` on the observability fetch; the Generation-details panel silently omits models and spend.
- `PostDrawer.svelte:311` — `if (post?.id === targetId) refineError = …`: if the drawer moved to another post mid-refine, the failure is **dropped entirely** — no toast, no state, no log.
- **`personas/[agentId]/+page.svelte:2902–2907` — the single most consequential swallow in the codebase.** The `checkStatuses` catch resets **every** platform to `{connected: false}`, so a network or auth failure renders the "No platforms connected. Use the buttons above to link your first account." empty state at :6004. The user is told the exact opposite of the truth about their own live accounts, and may reconnect platforms that were never disconnected.
- `personas/[agentId]/+page.svelte:2146` — `loadSpend` catch is empty; a failed fetch renders "No tracked generation spend yet" (:5852).
- `personas/[agentId]/+page.svelte:2373` — `loadKitRestoreLibrary` catch is empty; a failed fetch renders "No stored images found yet" (:6878).
- `personas/[agentId]/+page.svelte:1118` — the identity-kit call chained inside "Generate for brand" is swallowed whole: a kit failure during profile generation is completely invisible.
- `personas/[agentId]/+page.svelte:715` — `loadVoiceCatalog` is `console.error` only; the voice `<select>` then renders its single-option `{:else}` fallback (:5613), indistinguishable from "only one voice exists".

Plus the structural equivalent — **`await` with no rejection path at all**: `guides/+page.svelte` `uvVote` (:1251), `uvSubmit` (:1273, `try/finally` only) and `uvDelete` (:1288) all `await uvApi(...)` with no catch and are invoked as `void fn()` (:1777, :1837, :1846, :1860).

### 2.10 Route reachability

Every one of the 20 routes is reachable from the portal nav (`(portal)/+layout.svelte:129–144`, :777, :807, :840) or from `/brand-brief:901`. No orphaned routes.

Two gaps: **`src/routes/+page.svelte:588` declares `id="features"` that nothing links to** (`NAV`, :67–72, lists only how/compare/pricing/faq), and there is **no `/personas` index route** — `src/routes/(portal)/personas/` contains only `[agentId]`, so a user who trims the URL gets a 404 (see §3.0).

12 `target="_blank"` anchors; **all 12 carry `rel`**; 10 announce nothing about opening a new tab.

---

## §3 State inventory

Seven states per data surface: `loading` · `empty` · `partial` · `error` · `success` · `offline` · `permission-denied`. `raw` means present but rendering an unprocessed server or exception string.

### 3.0 Three findings that apply to every route

**1. There is no error page. `find src -name "+error.svelte"` returns zero.** SvelteKit therefore falls back to its own unstyled black-on-white page for every load failure and every 404 — outside the app shell, with no nav and no way back but the browser's Back button. `personas/[agentId]/+page.server.ts:39` throws `error(500, 'Failed to load personas')` and `:41` throws `error(404, 'Persona not found')` into exactly that.

**2. Nine of fifteen server loads cannot express failure.** The word `error` appears **zero times** in `admin`, `billing`, `dashboard`, `developer`, `favorites`, `generations`, `generator`, `settings` and `invite` `+page.server.ts`. Each destructures `{ data }` and discards the `error` half. Every one of those routes *does* have an empty state:

| route | `error` mentions in server load | empty-state markers in page |
|---|---|---|
| `/dashboard` | 0 | 2 |
| `/generations` | 0 | 7 |
| `/favorites` | 0 | 7 |
| `/admin` | 0 | 6 |
| `/settings` | 0 | 4 |
| `/billing` | 0 | 3 |
| `/developer` | 0 | 1 |
| `/generator` | 0 | 1 |

So **a database outage renders as "you have nothing yet"**, and the empty state then invites the user to create content that may already exist. The sharpest case: `dashboard/+page.server.ts` destructures at :17, :23, :58, :161 and :194 without capturing a single `error`; `:142–145` maps the null result to `agents = []`, which renders **"Welcome to PersonaGen! Let's initialize your Persona Roster"** (`dashboard/+page.svelte:54`). A user with 40 personas and a broken database is told they have none.

**3. `offline` is absent everywhere.** No `navigator.onLine`, no `online`/`offline` listener, no offline banner anywhere in `src/routes` or `src/lib`. The only handling is two hand-rolled regexes — `brand-brief/+page.svelte:342` (`TRANSPORT_FAILURE`, which drives the genuinely good "Saved locally — cloud sync failed" at :360) and `personas:2930` — plus `login:61`/`signup:146`'s single "Network error. Please try again." Everywhere else a dropped connection surfaces as the browser's own `Failed to fetch` or `NetworkError when attempting to fetch resource` in a 4-second toast.

Related: `{#await}` blocks and skeleton loaders do not exist anywhere in the codebase (0 occurrences of each). Every loading state is a hand-rolled `$state` boolean. **`aria-busy` appears 11 times against 493 buttons**, in only five files (brand-brief 2, intel 1, generator 6, `Button.svelte` 1, `SelectionToolbar.svelte` 1).

### 3.1 Per-route state matrix

`✓` present · `—` absent · `raw` present but unprocessed · `~` partial

| route / surface | loading | empty | partial | error | success | offline | perm-denied |
|---|---|---|---|---|---|---|---|
| `/` landing (static) | — | — | — | — | n/a | — | ✓ (:28 reverse redirect) |
| `/login` submit | ✓ :245 | n/a | ~ :141 | raw :235 | raw (toast + `goto`) | raw :61 | raw (401≡400) |
| `/signup` submit | ✓ :559 | n/a | ✓ :198–257 | ✓ :214 (raw payload) | raw (toast + `goto`) | raw :146 | **broken** (PIN) |
| `/invite/[token]` | ~ :116 (Accept only) | ✓ :73 | ✓ :77 | raw (toast only) | raw (toast + `goto`) | — | ✓ :109 but **no control** |
| `/dashboard` KPI/analytics | — | ✓ :34, :137 | ✓ (`'—'` not fake `0`) | **—** | n/a | — | — |
| `AnalyticsPanel` fetch | ✓ :175 | ✓ ×4 | ✓ | raw :182, no retry | — | — | raw :182 |
| `/generations` | **—** | ✓ :398, :456 | — | **—** | toast | — | — |
| `/favorites` | **—** | ✓ :154 (+CTA :176), :204 | — | **—** | disappearance only | — | — |
| `/trash` | ~ (delete only) | ✓ :195 (**bug**, §2.3) | ✓ :111 demotion | raw :191 | toast | — | — |
| `/billing` | ~ per-button | ✓ :131, :251 | ✓ :204 | raw :207, **gated** | ✓ :115 banner | — | — |
| `/developer` keys | — | ✓ :414 | — | — (toast only) | ✓ :359 | — | ✓ :389 |
| `/developer` console | ✓ :457 | — | — | ~ :469 (**HTTP only**) | ✓ :469 | — | — |
| `/admin` controls | ✓ :450, :797 | ✓ :776 | ✓ ×6 env-override | raw :452 | ✓ :381 flash | — | **—** |
| `/admin` platform users | ✓ :819, :841 | ✓ :841 | ✓ :822 | raw :829 | ✓ :381 | — | **—** |
| `/admin` workspace tabs | — | ~ (Seats absent) | — | **—** | n/a | — | **—** |
| `/models` registry | — (SSR only) | ✓ :876, :900 (conflated) | ✓ :545 | ✓ :538 (**written prose**) | n/a | — | — |
| `/models` inline edit | ~ tint only | n/a | n/a | toast + silent revert | **—** | — | — |
| `/guides` static | — | ✓ :1452, :1657 | raw (`<img src="">`) | — | n/a | — | — |
| `/guides` User Voice | ~ first load only | ✓ :1818 | — | raw :1809 | **—** | raw :1228 | raw ("Unauthorized") |
| `/brand-brief` load | — | ~ | ✓ :812 | **—** (swallowed :282) | n/a | — | ✓ :807 |
| `/brand-brief` scrape | ✓ :973–986 | n/a | ✓ :411 | raw :416 | ✓ | **—** | — |
| `/brand-brief` generate ×11 | **✓ 3 / ✗ 8** | n/a | — | raw :598 | ✓ (leaks prompt) | — | — |
| `/brand-brief` save | **—** | n/a | **✓ :360** (best in app) | raw :362 | **premature** :328 | **✓ :341** | ~ |
| `/brand-brief/intel` steps 1-4 | — | **—** | ✓ | **—** | — | — | — |
| `/brand-brief/intel` generate | ✓ :1061–1091 | — | — | **structurally impossible** | ✓ | **fabricated** | — |
| `/calendar` month load | — | ~ (no month/week empty) | — | **—** | n/a | — | ~ silent |
| `/calendar` composer | ✓ :1524, :1545 | n/a | n/a | raw :295 | ✓ (not navigated to) | — | — |
| `/calendar` generate-post | ✓ :930 (no progress) | n/a | n/a | raw :834 (DB blob) | ✓ :792 | **—** | — |
| `/review` queue load | ✓ :584 | ✓ :588 | — | **raw :587** | ✓ | — | — |
| `/review` approve/reject | **—** (§2.4b) | n/a | **✗ lies** (§2.4e) | raw :170 | toast | — | — |
| `/review` delete | ~ (bulk only) | n/a | **✓ :266** | raw :228 | ✓ :207 | — | conflated |
| `/settings` page load | — | — | — | **—** | ✓ | — | ✓ :2172 |
| `/settings` workspace detail | **—** | see below | **—** | **— swallowed** | ✓ | — | — |
| `/settings` provider keys | ~ per-row | ✓ :1565 | ✓ :1521 | raw :1605 | ✓ :1553 | — | ✓ :1668 |
| `/generator` brand gen | ✓ :478, :504 | ✓ :1203 | — | ✓ :927 (raw) | ✓ | — | — |
| `GenerationComposer` preview | ✓ :967 | **— no `{:else}`** | — | raw :976 | implicit | **—** | ~ :540 PLAN_FEATURE |
| `GenerationComposer` submit | **—** | n/a | — | **—** | **—** | — | — |
| `PostDrawer` refine | ✓ :685 (exemplary) | n/a | ✓ :868 | ✓ :892 | **—** | — | ~ |
| `AgentRoster` list | **—** | ✓ :466 (conflated) | **✓ :161** | toast only | toast | — | ~ `is_overseer` |
| `/personas/[agentId]` | ✓ (17 flags, all rendered) | ✓ :3548, :3640, :3820 | ✓ | **✓ exactly once** (:4169) | toast ×103 | — | — |

#### The persona route, measured

`personas/[agentId]/+page.svelte` is the largest surface in the app — 10,177 lines, 162 interactive elements, 98 buttons. It is simultaneously the **best-instrumented** route for busy state and the **worst** for error state:

- 17 named busy flags (`syncingFeed`, `generatingAvatar`, `generatingKit`, `deletingAssets`, `postingNowId`, …), and **every one is rendered in the markup** — verified by counting occurrences after the final `</script>` at line 2999. `generatingKit` appears 17 times, `generatingAvatar` 16, `generatingAllKit` 13.
- **Every spinner is paired with context text** — 18 of them, from "Loading posts…" (:3543) to "Generating (sheet + hero shot, ~30-60s)…" (:4806). No bare spinner anywhere. This is the best loading copy in the product.
- **Zero `aria-busy`** in 10,177 lines.
- **Exactly one error branch in the page's own markup**: `{:else if kitSaveState === 'error'}` at `:4169`. Every other failure goes to a toast — **103 `showToast` calls**, the highest count in the codebase. The route's only other persistent error surface is a component, `StaleNotices.svelte:27` — and **every notice it renders is a dead end**: a title and a detail paragraph (`:63–66`) with no action, no retry, no link, on a component whose entire purpose is reporting things that need fixing.
- **Twenty-five raw error toasts**, two of them completely unwrapped with no prefix and no context: `:2475` `showToast((e as Error).message, 'error')` — which then destroys the publish-fallback modal at :2476, so the user loses the context too — and `:2881` `showToast(err.message, 'error')` on persona deletion. The correct pattern also exists in the same file, at `:2930–2938`, which translates a raw `"Failed to fetch"` into "Couldn't reach the server to start the {platform} connection — try again in a moment."
- **Four surfaces have no loading state at all**: the voice catalog (:709), the spend ledger (:2141), the brand-brief list, and the stage tab of the kit-restore picker (:2380). Three of those four also swallow their errors (§2.9), so each renders a failure as an empty state.
- Good work worth preserving: `:5189–5192` + `:5276` is the only disabled control in the audit that states its reason **both** in `title` and inline; `:6948–6971` is the only empty state in the audit that pairs correct copy with a working CTA in the same block; `:3820` links to `/brand-brief`; `:6334` is an `aria-live` hint that explains the consequence of a radio choice before it is made.

#### `/settings` workspace detail — the sharpest state hole

```js
// settings/+page.svelte:695
async function loadWorkspaceDetail(workspaceId: string) {
    const [membersRes, invitesRes, personasRes] = await Promise.all([ … ]);
    if (membersRes.success) workspaceMembers = …
    if (invitesRes.success) workspaceInvites = …
    if (personasRes.success) workspacePersonas = …
}
```

Three parallel fetches. No busy flag, no `else`, no `catch`, no throw. A 500 on the members call leaves `workspaceMembers[ws.id]` undefined, which renders **"No seats yet — invite someone below."** (:1926). A failed load is presented as a legitimate empty workspace.

### 3.2 Raw error strings rendered to the user

The failure mode is uniform: a server or exception string is interpolated straight into UI text with no mapping. `request()` (`src/lib/services/api.ts:56–72`) can place `HTTP 500`, `Server error (HTTP 503).`, `Failed to fetch`, or an arbitrary engine `data.error` into `res.error`.

**Rendered as page content** (persist on screen):

| file:line | expression | source |
|---|---|---|
| `review/+page.svelte:587` | `{error}` | `e.message` (:127) — a bare `fetch` TypeError or server string, with **no retry inside the error block** |
| `login/+page.svelte:235` | `{error}` | `data.error` ← `api/auth/login/+server.ts:14` `json({ error: error.message })` — **verbatim Supabase GoTrue**. Users see `Invalid login credentials`, `Email not confirmed`, `Email logins are disabled`, `Request rate limit reached` — the last two describe a project configuration the user cannot act on, sitting above copy telling them to re-check their password |
| `signup/+page.svelte:214` | `{error}` | mixed: duplicate-email is mapped (:113, :121, :141), but `api/auth/signup/+server.ts:116` and `:145` pass Supabase through raw. `:145` logs the same string as an internal diagnostic at `:144` |
| `AnalyticsPanel.svelte:182` | `{error}` | `api/analytics/+server.ts:41` `json({ error: error.message })` — **raw PostgREST**. Can render `column posts.publication_results does not exist` or `permission denied for table posts`, leaking schema to the browser |
| `guides/+page.svelte:1809` | `{uvError}` | includes `+server.ts:17` MIGRATION_HINT — *"run `supabase/feature_requests_migration.sql` … against the database"*, a DBA instruction shown to end users, with the Retry button **deliberately hidden** (:1810). Total dead end |
| `billing/+page.svelte:207` | `{error}` | gated out of existence on unmetered accounts (§2.3) |
| `trash/+page.svelte:191` | `{data.loadError}` | raw Supabase `error.message` |
| `admin/+page.svelte:452`, `:829`, `:553`, `:769` | `{controlsError}`, `{platformError}`, `{…lastError}` | raw |
| `admin/+page.svelte:936`, `:982` | `{JSON.stringify(r.meta)}` | a raw event blob dumped into a table cell |
| `models/+page.svelte:543` | `({data.ledgerError})` | raw Supabase |
| `settings/+page.svelte:1605`, `:1735` | `{savedKey.last_error}`, `{key.last_error}` | raw provider error |
| `settings/+page.svelte:1728` | `{key.status}` | the literal enum `untested` / `invalid` / `error` as user-facing status text — while the sibling API-keys card at :1557 maps the same values to "Valid"/"Check key"/"Not set" |
| `GenerationComposer.svelte:976` | `{loadError}` | raw `data.error` or the browser's `"Failed to fetch"`, under the friendly heading "Can't prepare this generation" |
| `GenerationComposer.svelte:1311` | `{sourceError}` | raw |
| `generator/+page.svelte:945` | `{createError}` | raw |
| `PostDrawer.svelte:841`, `:908`, `:1370`, `:1393` | `{truncateError(...)}` | `truncateError` only `.trim()`s and `.slice()`s (`postDisplay.ts:119`) — pure length-clipping |
| `PostCard.svelte:416` | `Failed to post — ${…split('\n')[0]}` | raw provider error, truncated mid-sentence |
| `GenerationProgress.svelte:41`, `ActivityIndicator.svelte:70` | `{job.error}` | raw, CSS-clamped to 3 and 2 lines with no expand |
| `calendar/+page.svelte:834` | `JSON.parse(post.content)?.error` | **a raw provider error persisted in the database, echoed back unfiltered** |
| `calendar/+page.svelte:687` | `` `Post ${status}` `` | a raw DB status token as prose — "Post partial" |

**Via toast** (4 s, then gone): 342 `showToast` call sites, of which the great majority interpolate `res.error`, `err.message`, or `e.message` directly. `review/+page.svelte` alone has 10 (`⚠ ${e.message}` at :170, :228, :238, :254, :275, :340, :375, :411, :439); `calendar/+page.svelte` has 20; `brand-brief/+page.svelte` has 14; `settings/+page.svelte` has ~30.

The one sanitised path, for contrast: `summarizeGenError` (`postDisplay.ts:133`) peels nested JSON, classifies known failure modes, and never emits the raw payload. It is applied to **generation** errors only (PostDrawer:819, PostCard:43). Publish errors and refine errors bypass it entirely.

### 3.3 Spinners with no context text

The codebase is unusually good here — almost every spinner is paired with a word. The exceptions:

| file:line | element | problem |
|---|---|---|
| `brand-brief/+page.svelte:1375, 1480, 1489, 1521, 1645, 1665, 1682, 1702` | `.enrich-spinner` | The busy label is the literal string `...` — three dots, no word. Eight occurrences. The containers are bare `<div>`s with no `role="status"`, no `aria-hidden` and no sr-only text, and the buttons carry no `aria-busy`. |
| `review/+page.svelte:1018` | single-delete busy state | A bare ellipsis `…` as the **entire** busy state. No word, no `aria-busy`, no live region — screen readers announce nothing. |
| `CalendarView.svelte:741` | week-view inline approve | Identical bare `…`. |
| `models/+page.svelte:657` | `class:row-saving` | A pure opacity tint (CSS :1302), no text, no `aria-busy` — the only signal that a real price edit is saving. |
| `invite/[token]/+page.svelte:116` | "Accept invite" | `<Button loading={busy}>` where the **label does not change**. A spinning ring beside unchanged words, with no `aria-live` anywhere on the page. The paired Decline (:119) has no spinner at all — `disabled` only. |
| `settings/+page.svelte:1650, 1661, 1743` | `.spinner` inside `.secondary-btn` | `.spinner` (:2643) is `border: 2px solid rgba(255,255,255,.3); border-top-color:#fff` — **white on a `--surface` background**. Invisible in light theme; only the text survives. |

The larger gap is the surfaces that need a spinner and have none: `settings:695` (three parallel fetches), `settings:148`, `PostDrawer:330` (observability), `AgentRoster:413` and `:434`, `PostDrawer:1421` and `:1459`, `ConfirmDialog:35`, `(portal)/+layout.svelte:114`, `PersonaProjectsModal:69` and `:111`, `admin:244`, `guides:1251/1288`.

### 3.4 Empty states that dead-end

Ranked by how stuck the user is. A dead end here means the state names a next action but provides no control to take it.

| file:line | state | why it's a dead end |
|---|---|---|
| `billing/+page.svelte:131` | "Your wallet is empty… top up to continue." | The top-up button (:219) is **disabled** whenever `paymentsOpen` is false, the contact instruction (:204) is unlinked text, and the page has **zero anchors**. The user cannot pay and cannot ask to pay. |
| `guides/+page.svelte:1807` + `:1810` | User Voice migration error | Retry is **suppressed** in exactly this branch, leaving a SQL instruction and no control. |
| `intel/+page.svelte:1095` | step 6 with null results | Renders **nothing at all**, and nav is hidden by `{#if intelCurrentStep < 6}` (:1295). A blank page with no controls. |
| `intel/+page.svelte:1096–1290` | the generated strategy report | No export, no copy, no download, no "save to brand brief". The only exits are Start Over (destroys it, unconfirmed) and Done (navigates away). The report exists only in `localStorage`. |
| `GenerationComposer.svelte:983` | preview resolves falsy | The `{#if loading}{:else if loadError}{:else if preview}` chain has **no final `{:else}`**. A response that is `ok && success` but carries no `preview` renders a **blank modal body with a live `$0.00` cost footer**. |
| `dashboard/+page.svelte:34–80` + `:137` + `PlatformBars:13` + `AnalyticsPanel:158` | the whole below-the-fold dashboard | Four consecutive terminal empty states with **zero outbound links** between them. `PlatformBars:14` says "Connect at least one social account to a persona" with nothing to click; `AnalyticsPanel:159` says "Create a persona" while sitting on a panel with no path to `/generator`. This is the primary landing screen of the product. |
| `PostCard.svelte:243` | "Generation failed" | Designed to offer Retry at :248 — and **no caller ever passes `onRetry`**, so in production this always dead-ends. A failed generation offers the user nothing, anywhere. |
| `calendar` month grid / week grid | zero posts | **No empty state at all.** A first-run user sees a silent empty grid with no onboarding copy. |
| `CalendarView.svelte:843` | day modal, empty day | `onGenerateForDate` is in scope and unused; the modal offers only "Close" (:900) — while the day *view* has exactly that button at :753. |
| `CalendarView.svelte:812` | empty **past** day | The generate button at :753 only renders for `>= todayStr`. |
| `review/+page.svelte:769` | "No matching posts" | Says "Widen a filter to see them" (:786) but provides **no reset-filters button**; the three selects are in a different region. |
| `generations/+page.svelte:418` | filter-caused empty | No clear-filters button — unlike `models:609`, which has one. |
| `trash/+page.svelte:213` | "Nothing in the Trash" | No link back to the feed or generations. |
| `favorites/+page.svelte:204` | "No favorite personas yet" | No link to any persona. (The sibling posts tab at :176 has the one good CTA in the audit.) |
| `brand-brief/+page.svelte:1797` | "No competitors added yet" | The Add button (:1816) is a sibling **outside** the empty-state block. |
| `brand-brief/+page.svelte:1216` | products empty | Names both next actions in prose — "the Firecrawl Scraper on the Overview tab" — and **neither is a link**. |
| `generator/+page.svelte:436` | "No brand briefs yet — create one in Brand Brief" | The empty state is buried inside a collapsed `<select>`, it disables four buttons (:461, :500, :1069, :1115), and there is **no link to Brand Brief anywhere on the page**. |
| `guides/+page.svelte:1882` | `.uv-lane-empty` | Renders the single word **"Empty"** per board lane — five at once on a fresh account. |
| `guides/+page.svelte:1738` | roadmap lane | Zero items renders a header and nothing. |
| `AgentRoster.svelte:466` | "No personas match this filter." | No clear-filter, no create CTA — **and the same message shows when the account genuinely has zero personas**, so a first-run user is told their filter is wrong. |
| `AgentConnectionStats.svelte:189` | "No Channels Connected Yet… Link one or more channels **above**." | A positional reference with no control; breaks on any reflow, and on mobile "above" may be several screens up. |
| `settings/+page.svelte:2103` | "You don't have any personas to file into a workspace yet." | No link to `/generator`. |
| `settings/+page.svelte:1480` | "No brand briefs saved yet — create one under Brand Brief" | Names the destination; **plain text, not a link**. |
| `models/+page.svelte:876`, `:900` | "Nothing synced yet" / "No wired models yet" | Both **conflate "no data" with "filters exclude everything"** despite `filtersActive` (:161) being available. `:900` also refers to a button by name rather than being one. |
| `(portal)/+layout.svelte:563`, `:602` | "No personas in this project" / "No personas match" | No add affordance, no clear-search. |
| `invite/[token]/+page.svelte:109` | wrong-account branch | Correct diagnosis — "Log out and sign in as the invited address" — with **no log-out control and no link at all**. |
| `personas/[agentId]/+page.svelte:6004` | "No platforms connected." | Points at buttons above but holds no control — **and per §2.9 this is also exactly what a failed `checkStatuses` renders.** |
| `personas/[agentId]/+page.svelte:3564` | "No posts match these filters." | The CTA block is gated on `feedFilter === 'all' && platformFilter === 'all'` (:3568), so the **filtered** state deliberately renders no action — and there is no clear-filters control. |
| `personas/[agentId]/+page.svelte:3638` | "No assets yet" | No button. The user must infer that assets come from generating posts or a profile picture on other tabs. |
| `personas/[agentId]/+page.svelte:6737`, `:6877` | "No stored images found yet." ×2 | The restore modals offer nothing but Close (:6715, :6788); no "generate one instead" path. `:6877` is also the rendering of a swallowed fetch error (:2373). |
| `personas/[agentId]/+page.svelte:4355` | "No candidates yet — hit 'More ideas' or the starter kit above." | Text-only reference to buttons at :4326 / :4173; no inline CTA. |
| `personas/[agentId]/+page.svelte:5851` | "No tracked generation spend yet…" | Acceptable as an empty state — but it is also what a failed `loadSpend` renders (:2146). |
| `StaleNotices.svelte:63` | every warning | Not an empty state but the same failure class: a title and a detail with **no action of any kind**, on the component that exists to report what needs fixing. |

Handled well, for contrast: `favorites:176` (a real `<a href="/generations">`), `personas:3820` (a real link to `/brand-brief`), `settings:1707` and `:1926` and `PersonaProjectsModal:173` (the form is directly below), `admin:1141` (sits above a pointer to `/developer`).

### 3.5 Forms

**There are 6 `<form>` elements in the entire application**, against 124 `<input>`, 62 `<select>` and 35 `<textarea>`. `settings/+page.svelte` — the densest input surface in the app, with 14 inputs and 5 selects across 9 distinct clusters — contains **zero** (`grep -c "<form"` → 0). Consequences that apply everywhere there is no form: **Enter never submits**, and native constraint validation (`required`, `type="email"`, `minlength`) never runs, so those attributes are decorative.

Per cluster. `label ✓` means every field in the cluster has a resolving `<label for>`, a wrapping `<label>`, or an `aria-label`.

| file:line | fields | inline validation | labels | disabled while submitting | visible success |
|---|---|---|---|---|---|
| `login:110` **(form)** | email, password | ~ email on blur (:133→:141); **password none** | ✓ | ✓ :244 + label swap + sr-only live :261 | ✗ toast + `goto` |
| `signup:197` **(form)** | name, email, password, confirm, PIN | ✓ **best in app** — per-field, summary with jump links :198, strength meter :395, focus moved :96 | ✓ | ✓ :552 + reason rendered :575 | ✗ toast + `goto` |
| `invite:116/:119` | none (2 buttons) | n/a | ✓ | ~ Accept spinner only; Decline nothing | ✗ toast + `goto` |
| `(portal)/+layout.svelte:1044` **(form)** | new password, confirm | ~ native only; **no equality check** | ✓ | ✓ :1070 | ✓ toast + gate disappears |
| `settings:1259` | display name, email (ro) | ✗ toast-only (:956) | ✓ | ✓ :1316 | ✓ toast + avatar row |
| `settings:1282` | new email, confirm, password | ✗ **no equality check, no format check** | ✓ | ✓ :1307 | ✓ toast + collapse |
| `settings:1347` | 3 switches | n/a | ✓ | ✗ **no busy flag** | ✓ optimistic + toast |
| `settings:1611` ×6 | provider key | ✗ toast-only (:1092) | ✓ + `aria-invalid`/`aria-describedby` :1623 — **the only inline error bound to its input anywhere** | ✓ :1634 | ✓ chip + toast |
| `settings:1768` | Zernio label, key | ✗ toast-only | ✓ | ✓ :1792 | ✓ row + toast |
| `settings:1886` ×N | role select, spend limit | ✗ toast-only (:808) | ✓ | ✓ but **no `:disabled` CSS** on :1901 | ✓ toast; **value not reverted on failure** |
| `settings:1951` ×N | invite email, role | ✗ **no format check** | ✓ | ~ button only; inputs stay live | ✓ toast + link block |
| `settings:2143` | workspace name | ✗ toast-only | ✓ | ✓ :2159 | ✓ toast |
| `settings:2341` | type-DELETE confirm | ✓ **and the reason is announced** (sr-only :2352 + `aria-describedby`) | ✓ | ✓ :2360, :2370 | ✓ hard redirect |
| `brand-brief:959` | store URL | ✗ toast-only (:378) | ✓ | ✓ :973 | ✓ fields repopulate + toast |
| `brand-brief:1166` ×N | product name/price/desc/photo | ✗ toast-only (:477) | ✓ | n/a | ✓ card + toast |
| `brand-brief:1318` | manual product ×4 | ✗ — required-ness only via disabled | ✓ | n/a | ✓ card + toast |
| `brand-brief:1391` | 2 colour pickers + 2 hex, logo, 2 fonts | ✗ **hex inputs accept any string** (`#gg00zz` is piped into `style=` at :1408); no URL check | ✓ | ✗ both font Suggests have broken keys | ✓ gradient bar |
| `brand-brief:1503` | trait input, 4 radios, sample post | ✗ duplicate trait silently dropped (:695) | ✓ (:1570 is `aria-labelledby`-only) | ✗ Sample Post broken key | ✓ chip + live preview |
| `brand-brief:1633` | 4 textareas | ✗ | ✓ | ✗ **all four Generate keys mismatched** | ✓ text lands |
| `brand-brief:1729` ×N | competitor name/url/notes | ✗ | ✓ | n/a | ✗ **never persisted** (§2.4d) |
| `intel:643` step 1 | company, industry, audience | ~ `aria-invalid` + hint :688 (true on first paint) | ✓ | n/a | ✗ |
| `intel:718` step 2 ×N | competitor url, platform | ✗ `type="url"` outside a form → never validated | ✓ | n/a | ✗ **no reason when Next disables** |
| `intel:809` step 3 | content textarea, 9 toggles | ✗ | ✓ (:822 `aria-labelledby`-only) | n/a | ~ `aria-pressed` |
| `intel:868` step 4 | 2 ranges, tag input, 13 toggles | ✗ **unsubmitted tag text silently lost**; no Add button | ~ :876/:893 `aria-label` **overrides** the visible label at :870 | n/a | ~ live readout |
| `calendar:1306` composer | persona, blueprint, topic, product, content, N platforms, date, time | ✗ **none** — all four checks are post-submit toasts (:250, :254, :258, :262); `composerDate` has **no `min`**, a past date passes | ✓ | ✗ **`composerSubmitting` gates only the two footer buttons**; every field **and Cancel** stay live mid-POST | ✓ toast + close; **calendar is not navigated to the new post's date** |
| `calendar:1330` forge | blueprint, topic, product | ✗ | ✓ | ~ button only | ✓ toast; **no warning that it overwrote existing text** |
| `review:750` reject picker | reason select, note (maxlength 300, no counter) | ✗ | ✓ | ~ Confirm only; select/input/Cancel stay live | ✗ **picker unmounts in `finally` (:173) regardless of outcome** — success and failure look identical |
| `review:954` ×N caption | textarea | ✗ empty caption saves | ✓ | ✓ :960, :963, :965 | ✓ toast + re-render |
| `generator:431` | brief, direction | ✗ | ✓ | ~ button only; inputs stay editable | ✓ fields repopulate + sr-only live :523 |
| `generator:528` | name, niche, market | ✓ :543, :562 (**both suppressed while pristine**) | ✓ | ✗ | ✗ — and **market is discarded** (§2.3) |
| `generator:597` | soul, skills | ✓ char counts + `aria-invalid` | ✓ | ✗ | ✗ |
| `generator:636` | 7 profile fields | ✗ | ✓ | ✗ | ✗ silent localStorage write |
| `GenerationComposer:1320` cards | mode, quotes, look, text, layout, palette | ✓ **live** :1348, :1365, :1368 | ✓ | n/a | ✓ live preview |
| `GenerationComposer:1572` refs | product select, 2 URLs | ✗ bad URL just hides the thumbnail | ✓ | n/a | ~ thumbnail only |
| `GenerationComposer:1943` deliver | platforms, date, time | ✗ no past-date, no date-without-time check | ✓ | ✗ | ✓ `aria-live` hint :2041 |
| `PostDrawer:717` caption | textarea | ✗ empty saves; no counter, no platform limit | ✓ (sr-only `for` :719) | ✓ buttons; textarea stays live | ✗ host toast only |
| `PostDrawer:770` reschedule | date, time | ✗ **past date accepted**, no `min`, no cross-field check | ✓ | ✓ both inputs + button | ✗ host toast only |
| `PostDrawer:845` refine | visual prompt, spoken line | ~ `aria-invalid`/`aria-describedby` on :878 only; **:889 has no error wiring** | ~ by ancestry, not `for` | ✓ | ✗ panel just closes |
| `CampaignPlanner:316` | persona, horizon, cadence, 4 ranges, 4 numbers | ~ only `weightSum <= 0` (:393); `min`/`max` not enforced in JS | ✓ | ✓ **every control** :319, :338, :354, :376, :385 | ✓ :304 with fail count |
| `admin:832` bulk grant | search, credits, note | ✗ required-note and positive-amount checked **after** click, as toasts | ✗ 2 of 3 unnamed | ✗ **none on an N-request loop** | ✓ flash with partial counts |
| `admin:896` single action | credits, note | ~ `disabled={!actionNote.trim()}`, no message | ~ note unnamed | ✓ "Saving…" | ✓ flash + refresh — **the best-behaved mutation in the app** |
| `developer:370` create key | label | ✗ | ✗ unnamed | ✓ :385 | ✓ fresh-key panel |
| `developer:447` console | safe mode, method, path, body | ~ JSON parse → toast; no field marking | ✗ 2 of 4 unnamed | ~ button only | ~ **HTTP only; transport failure invisible** |
| `models:709` ×N inline edit | price, latency, quality | ✗ `Number('') === 0` **silently saves 0** | ✓ | ✗ | ✗ **none** |
| `guides:1773` | title, detail | ✗ native only, and the disabled submit prevents the bubble from ever firing; no counter | ✓ | ~ button only | ✗ |
| `PersonaProjectsModal:146` **(form)**, `:182` **(form)** | project name / rename | ~ disabled on empty, `maxlength` | ✓ | ~ no busy label | ✓ create; ✗ **rename has no success toast** |
| `ConfirmDialog:127` | type-to-confirm | ✓ live match :25 | ✓ | n/a | n/a |
| `personas:3796` brand brief | brief select | ✗ | ✓ | ✓ :3810 + "Applying…" | ✓ dirty hint :3824 + "Applied: …" :3828 + toast |
| `personas:3894` persona profile | name, niche, status, 7 age chips, gender, archetype, focus, target, psych, angle, TraitPicker | ✗ **none** — no required markers, no length caps, no error text | ✓ (9 `<label for>`; age chips via `aria-labelledby` :3929) | ✗ **inputs stay editable during save**; the Save button is ~1,800 lines away at :5886 | ✓ toast only |
| `personas:4226` identity kit | display name, bio, confirmed handle, 2 platform selects | ~ bio counter + over-limit + `aria-invalid` (:4539, :4548); **the confirmed handle is silently sanitised** (:1297) with no message | ✓ | ✗ inputs stay live during the debounced save | ✓ **`kit-save-state` "Saving… / Saved ✓ / Save failed"** with `aria-live` (:4149) — the best success affordance in the app |
| `personas:4478` add username | text + "+ Add" | ~ invalid toasts (:1309); **duplicates swallowed silently** (:1315) | ✓ | ✗ | ~ a chip appears; a rejected duplicate shows nothing |
| `personas:4637` reference upload | file input | ✗ no type/size check beyond `accept` | ✓ (wrapping label :4694) | ✓ :4718 + all four buttons | ✓ image swaps + toast |
| `personas:5473` skill editor | name, markdown | ~ blank-name toast (:1435) | ✓ | n/a (local) | ✗ **nothing says the skill is unpersisted** |
| `personas:5522` integration editor | kind, label, config | ~ blank-label toast (:1454) | ✓ | n/a (local) | ✗ same |
| `personas:5594` automation | timezone, voice, posts/day, autonomy, source cards, RSS URL | ~ posts/day **silently clamped** 1–10 (:5655); RSS `type="url"` never validated; autonomy blocked options carry `title` + inline suffix + `/billing` link | ✓ | ✗ shared Save button | ✓ toast only |
| `personas:6973` publish picker | N platform chips | ✗ empty selection only disables, silently | ✓ | ✓ :6988 + spinner | ✓ toast + `loadFeed()` + close |
| `TraitPicker:108` curated traits | N radiogroup rows | n/a | ✓ `aria-labelledby` :119 | ✗ — a `disabled` prop exists (:30) and the page never passes it (`personas:4067`) | ✗ selection visible; persistence needs Save Profile and nothing says so |
| `TraitPicker:162` advanced traits | N text inputs | ✗ | ✓ (implicit, wrapping label) | ✗ same unused prop | ✗ same |

**The systemic pattern across all 46 clusters:** validation is almost always *post-hoc and transient* — a 4-second toast fired from inside the async handler — while the one place an error message is programmatically bound to its field is `settings:1623`. Conversely, **success is almost never rendered where the action happened**. Every successful mutation in PostDrawer, AgentRoster, settings, review and models reports via a detached toast, while errors in the same flows are rendered inline and persistently. A user who misses a 4-second toast has no way to tell a save succeeded — the surface looks identical before and after.

---

## Ranked list A — dead or feedback-less controls, worst first

Ranked by how badly a user is stuck: fabricated outcomes first, then money and destructive actions, then silent data loss, then ordinary silence.

1. **`brand-brief/+page.svelte:814` — "Export" reports a success that never happened.** `exportBrief()` (:688) is one line: `showToast('Brand brief exported', 'success')`. **Stuck:** the user believes they hold an export, closes the tab, and discovers nothing was produced — possibly long after the brief has changed. This is the only handler in the codebase whose entire body is a toast.
2. **`intel/+page.svelte:1057` — "Generate Strategy" fabricates a server call and invents the brand's own metrics.** A 2.5–4 s `setTimeout` (:491) followed by a hardcoded literal (:412–487), including "current" figures — 2,400 followers, 2.1% engagement, 450 reach/post (:479–484) — presented as this brand's data. **Stuck:** the user makes strategy decisions, or reports numbers to a client, from invented data. The fake latency and the well-built spinner are what make it credible, and the report can only be read on screen — there is no export (§3.4), so it is transcribed by hand.
3. **`GenerationComposer.svelte:2102` — the money button has no in-flight state.** `confirm()` (:844) sets no flag, never disables, shows no spinner, and has no success or failure branch; its `disabled` (:2104) contains no in-flight term. **Stuck:** the click looks like it did nothing, so the user clicks again and is charged twice.
4. **`brand-brief/+page.svelte` — 8 of 11 AI "Generate" buttons never disable and never spin** (busy-key table in §2.3). **Stuck:** the user clicks repeatedly into apparent silence, firing N parallel paid calls that race into one field; the text that lands is whichever finished last. The three that work prove the pattern was intended.
5. **`admin/+page.svelte:837` and `:885` — bulk credit grants and billing-mode flips run with no busy flag at all.** :837 is a sequential loop of N wallet POSTs behind a button that never changes. **Stuck:** the operator re-clicks and double-grants real money to real users.
6. **`personas/[agentId]/+page.svelte` — six input clusters share one Save button and none has a dirty indicator.** Persona Profile, Character & Visuals, Automation, Skills, Tools and `TraitPicker` all persist only via `:5886`, at the bottom of a ~2,100-line scroll. "Save skill" (:5507) and "Save integration" (:5564) close their modals and write local state with no success toast. **Stuck:** the user does a session of work that looks committed, navigates away, and loses all of it. The same file already ships the fix twice — `kit-save-state` autosave (:4149) and `brandDirty` (:3824).
7. **`review/+page.svelte:684, 1000, 1148, 1255, 1338, 1396` — approve and reject across all five views.** `working` is set and wired to `disabled` in 17 places and rendered as a busy label in zero; the deck's primary Approve (:1338) is the worst case. Compounded by :161, which removes every row regardless of `d.updated` while the toast reports the true count. **Stuck:** on a partial server success the user sees five cards vanish and a toast saying two were approved, with no way to tell which three are still pending.
8. **`generator/+page.svelte:892` — "Register Automated Account" is the same handler as the button beside it.** Its copy promises Account Factory automation; `onclick={createPersonaDirect}` (:897). **Stuck:** the user believes social accounts are being provisioned and waits for accounts that will never exist.
9. **`personas/[agentId]/+page.svelte:6233` — "Disconnect {platform}" has no confirmation, no busy flag, and a catch that reports every failure as "Unable to reach API".** It is the **only** destructive action on that route without a `confirmAction` gate (compare :2020, :2850, :2089, :5363, :5438). **Stuck:** a mis-click silently drops a live social connection, and a failed disconnect is indistinguishable from a successful one.
10. **`PostCard.svelte:249` — the Retry on a failed generation is unreachable dead code.** No caller passes `onRetry`; all four call sites omit it. **Stuck:** a generation fails, the tile says so, and there is no retry anywhere in the product.
11. **`models/+page.svelte:711, 733, 750` — real pricing is edited and saved with an opacity tint as the only signal**, and a non-numeric entry silently saves `0` via `numInput` (:496). **Stuck:** a mistyped price is committed platform-wide with no confirmation and no way to tell it landed.
12. **`personas/[agentId]/+page.svelte:5895` — "Delete Persona" has no busy flag at all.** Between the type-to-confirm dialog and the `goto('/dashboard')` the button is live, idle-looking and re-clickable. **Stuck:** the user cannot tell whether an irreversible deletion started.
13. **`(portal)/+layout.svelte:984` — "Log Out" has no busy state and both failure paths are `console.error` only** (:121, :124). **Stuck:** on a failed logout the user believes they have signed out — on a shared machine that is a security problem, not a UX one.
14. **`brand-brief/+page.svelte:1767, 1776, 1786` — competitor fields never call `saveAll`**, and `addCompetitor` (:718) skips it too. **Stuck:** the user types competitor research, navigates away, and it is gone with no warning.
15. **`src/routes/+page.svelte:769` — every pricing CTA discards the plan and lands on the dashboard.** No `redirectTo` exists anywhere in the app. **Stuck:** the one conversion path on the marketing page drops the user somewhere they did not ask to go, with the plan choice lost. "Talk to us" points at self-serve billing; no contact route exists.
16. **`invite/[token]/+page.svelte:106, 107, 109` — the invite funnel strands anyone not already signed in.** Both auth links `goto('/dashboard')`; the wrong-account branch renders prose with **no control at all**. **Stuck:** the invite URL may exist only in an email thread the user has already closed.
17. **`AgentRoster.svelte:413/427` — the active/paused switch has no keyboard path and no accessible name**, and `toggleAgent` (:207) sets no busy flag. **Stuck:** keyboard and screen-reader users cannot pause a persona at all.
18. **`trash/+page.svelte:185, 247, 274, 277` — permanent deletion and restore share one global `busy` with no label.** **Stuck:** clicking Restore on one card greys out every card with no indication which is acting; the user cannot tell whether an irreversible purge started.
19. **`personas/[agentId]/+page.svelte:6849` — the delete-from-history button gates on the *restore* flag**, and `deleteKitHistoryImage` (:2088) has no in-flight state of its own. **Stuck:** the button stays live and re-clickable through the DELETE while showing nothing.
20. **`CampaignPlanner.svelte:426` — "Stop after this one" changes nothing on screen.** **Stuck:** the user clicks Stop, watches the counter keep climbing, and clicks again.
21. **`settings/+page.svelte:2307` — the delete-account dialog can be dismissed mid-deletion** (unlike Cancel at :2360), with no progress indicator anywhere behind it.
22. **`guides/+page.svelte:1831, 1840, 1860` — votes and deletes with no in-flight state and no rejection path** (`void uvVote(...)`). **Stuck:** on any network failure the optimistic vote stays on screen permanently and the page never mentions it.
23. **`developer/+page.svelte:457` — `riskOf` never reads `cMethod`**, so an HTTP `DELETE` bypasses Safe mode entirely; and a transport failure produces no visible output because the markup gates on `cStatus !== null`.
24. **`personas/[agentId]/+page.svelte:3513` and `:4293` — "Sync Feed" and "Download for upload" complete in silence.** `syncFeed` toasts on failure only, so a successful sync looks like a dead button; `downloadAvatar` has no busy flag and no success signal.
25. **`calendar/+page.svelte:1579` — the cinematic plan gate can never fire**; `entitlements` is absent from `PageData` and appears zero times in the route's server load.
26. **`CalendarView.svelte:528` — a `<span>` styled exactly like the four sibling filter chips**, with no handler and no filterable status behind it.
27. **`review/+page.svelte:1219, 1285` — "Enlarge image" over a media-less post is a labelled no-op** (`openLightbox` early-returns at :286).
28. **`dashboard/+page.svelte:70` — onboarding step 2 is a `<span>`**, not keyboard-reachable, with no `aria-disabled`, pointing at a "Connections tab" route that does not exist.
29. **`personas/[agentId]/+page.svelte:4479, 4486` — adding a duplicate username candidate silently clears the input and does nothing** (:1315).
30. **`src/lib/components/ui/Input.svelte` — the entire component is unreachable** (zero importers), including its `role="alert"` error render.

## Ranked list B — missing states, worst first

Ranked by how confidently the UI asserts something false, then by how completely the user is left without recourse.

1. **No `+error.svelte` anywhere — every route.** `find src -name "+error.svelte"` → 0. **Stuck:** a 500 or a 404 drops the user onto SvelteKit's default page with no nav, no branding and no link home. `personas/[agentId]/+page.server.ts:39/:41` throws straight into it, and `/personas` (no index route) 404s the same way.
2. **`personas/[agentId]/+page.svelte:2902` — a failed connection check renders "No platforms connected."** The catch resets **every** platform to `{connected: false}`, producing the empty state at :6004. **Stuck:** the user is told the exact opposite of the truth about their own live accounts, and may reconnect platforms that were never disconnected — on the route where connections are managed.
3. **`/dashboard` — a database failure renders as a first-run welcome.** The server load mentions `error` zero times; :142–145 maps null to `agents = []`, producing "Welcome to PersonaGen! Let's initialize your Persona Roster" (`+page.svelte:54`). **Stuck:** a user with 40 personas and a broken database is told they have none and invited to create their first, with nothing on the page able to distinguish an outage from an empty account.
4. **Nine of fifteen server loads cannot express failure at all** (`admin`, `billing`, `dashboard`, `developer`, `favorites`, `generations`, `generator`, `settings`, `invite`), and every one has an empty state that will absorb the failure. **Stuck:** the whole read side of the product conflates "broken" with "empty", and then tells the user to create content they may already own.
5. **`settings/+page.svelte:695` — three parallel workspace fetches with no busy flag, no `else`, no `catch`.** A 500 on members renders "No seats yet — invite someone below." (:1926). **Stuck:** an admin is shown an empty team and may re-invite people who are already members.
6. **`offline` does not exist in the product.** No `navigator.onLine`, no listener, no banner anywhere in `src/`. **Stuck:** on a dropped connection the user gets `TypeError: Failed to fetch` in a 4-second toast — or, in `calendar:823`, nothing at all for ten minutes while the poll loop treats every network error as "still generating".
7. **Toasts are the app's only success channel, and they are inaccessible and ephemeral.** 342 `showToast` sites funnel into `Toast.svelte:17`, a button whose `aria-label="Dismiss notification"` **overrides the message text**, auto-dismissed after 4 s (`ui.svelte.ts:23`) with no pause-on-hover — errors included. **Stuck:** a screen-reader user never hears what happened; anyone who looks away loses the only confirmation that a save succeeded, and every surface looks identical before and after.
8. **`/personas/[agentId]` — one error branch in 10,177 lines** (`:4169`), against 162 controls and 103 toast calls. Its only other persistent error surface, `StaleNotices.svelte:63`, renders every warning as a title and a paragraph with **no action, no retry, no link**. **Stuck:** on the app's deepest surface, a failure that scrolls past is unrecoverable information, and the component built to report problems offers no way to address one.
9. **Three more persona surfaces render a swallowed failure as an empty state**: spend (`:2146` → :5852), the kit-restore library (`:2373` → :6878), and the voice catalog (`:715` → the single-option `<select>` at :5613). **Stuck:** each tells the user they have nothing when the request simply failed.
10. **`GenerationComposer.svelte:983` — the preview chain has no `{:else}`.** A falsy preview yields a blank modal body with a live `$0.00` footer. **Stuck:** the user faces an empty dialog that quotes a price, with no message, no retry and no explanation.
11. **`/review` approve reports a count it does not honour** (:161 vs :166). **Stuck:** the queue and the toast disagree and the user cannot tell which posts actually moved.
12. **`/billing` — the only `{error}` renderer is gated out of existence on unmetered accounts** (:198 wraps :207). **Stuck:** a failed subscribe or cancel is completely silent, and the empty-wallet state (:131) has no reachable next action at all: the top-up button is disabled, the "message us" instruction is unlinked text, and the page has zero anchors.
13. **`/calendar` month and week grids have no empty state.** **Stuck:** a first-run user sees a silent grid and no indication of what to do.
14. **`/trash:195` keys its empty state off `posts.length` while rendering `visible`.** **Stuck:** a persona filter that matches nothing shows a blank grid, a "0 posts" toolbar, and no message.
15. **`/developer` console shows nothing on transport failure** (`cStatus` stays null, markup gates on it). **Stuck:** a request that never reached the server is indistinguishable from one never sent.
16. **Four surfaces conflate "no data" with "filtered to nothing"** despite having the flag to distinguish them: `AgentRoster:466`, `models:876`, `models:900`, and `personas:3564` — the last of which *deliberately* suppresses its CTA in the filtered state (:3568) and offers no clear-filters control. **Stuck:** a first-run user is told their filter is wrong, and a filtering user is told to go create data they already have.
17. **`/guides` User Voice renders a DBA migration instruction to end users and suppresses the Retry button in exactly that branch** (`:1809` + `:1810`). **Stuck:** the user is shown a SQL file path and given no control whatsoever.
18. **Permission-denied is never a state — only an absence.** `/admin` and `/models` redirect non-admins to `/dashboard` with no explanation; within `/admin`, `isPlatformAdmin === false` silently omits whole tab groups (:362, :438, :800). Elsewhere a 401/403 arrives as raw text: `AnalyticsPanel:182` presents a permission boundary as a load failure, `guides:1809` renders the bare word "Unauthorized" above a Retry that will fail identically. **Stuck:** the user cannot tell a missing feature from a forbidden one, or know whom to ask.
19. **`/brand-brief` save toasts success before the write resolves** (:328, with `void persistBriefToDb` at :331). The partial-failure copy at :360 is the best in the app — and it arrives *after* the user has already been told it worked.
20. **Inline validation is almost absent: 6 `<form>` elements in the whole app, none in `settings`.** Enter never submits and native constraints never run across 9 settings clusters, the calendar composer, every generator step, and the entire persona profile. `settings:1623` is the only inline error programmatically bound to its field. Silent coercions compound it: `models:496` saves `0` for a non-numeric price, `personas:5655` clamps posts-per-day without a word, `personas:1297` rewrites username keystrokes as you type.
21. **Loading states exist but are unannounced: 11 `aria-busy` against 493 buttons**, zero `{#await}` blocks, zero skeletons, and four bare-ellipsis busy states (`review:1018`, `CalendarView:741`, plus eight `...` labels in `brand-brief`). `settings`' `.spinner` is white-on-white inside secondary buttons (:1650, :1661, :1743).
22. **34 empty states dead-end with no next action** (§3.4). **Stuck:** the entire below-the-fold dashboard — the product's primary landing screen — is four consecutive terminal empty states with zero outbound links.
