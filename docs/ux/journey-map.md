# PersonaGen — Journey Map (Phase 0 contract)

**Date:** 2026-09-11
**Conversion goal:** a persona is created **and a post is published**.
**Scope:** all 20 routes. The public funnel (`/`, `/login`, `/signup`) is being reworked
by a parallel session; those three sections are marked ⏳ and refresh when it lands.

**Companion audits** — measured, every claim carrying a `file:line`:
- [audit-system.md](audit-system.md) — §4 System audit (tokens, type, spacing, components)
- [audit-interactions.md](audit-interactions.md) — §2 Interaction inventory, §3 State inventory
- [sweep-baseline.json](sweep-baseline.json) + [shots/before/](shots/before/) — runtime baseline, 20 screens @1280

---

## 0. Runtime baseline — what is already sound

Driven first-hand, authenticated, all 17 portal routes at 1280px:

**Zero console errors · zero 4xx/5xx · zero dead links · exactly one `h1` per route · no horizontal overflow.**

Two more strengths worth protecting rather than "improving":
- `prefers-reduced-motion` honoured globally (`app.css:1196`) plus 20 component blocks.
- Focus rings, borders and font-families are **90–99% tokenized**. The a11y floor is real.

This is not a rotten build. The work is craft, journey and coherence — not repair.

---

## 1. Journeys, ranked

### Journey #1 — Persona created → post published *(the conversion path)*

| # | Route | Element | Expected | Success | Failure | Back out |
|---|---|---|---|---|---|---|
| 1 | `/signup` ⏳ | Create account | Session + wallet | Lands authenticated | — | — |
| 2 | `/generator` | 3-step wizard, **5 fields, 0 required** | Persona row | Persona appears in rail | — | Leave wizard |
| 3 | `/personas/[id]` | Generate / composer | Draft post | Post in Review Queue | provider error | Cancel |
| 4 | `/review` | **Approve & schedule** | Post scheduled | Row leaves queue | reject w/ reason | Reject |
| 5 | live | Publish | Post on the account | Verified publish | platform error | — |

**Step 2 is a genuine strength:** zero required fields to reach a persona is exactly the
"set the ones that matter, leave the rest" pattern the category leader sells. Do not add
required fields to this step.

**Step 5 is never driven in verification.** Publishing writes to real social accounts.
It is exercised only against the seeded harness account, and any report must say so
rather than claim the step passed.

### Journey #2 — Returning operator clears the queue
`/dashboard` → `/review` → approve or reject → `/calendar` confirms the slot.

### Journey #3 — Brand grounding
`/brand-brief` → scrape/populate → products → applied to a persona.

### Journey #4 — Spend comprehension
`/billing` → wallet → top-up. *(Stripe dormant; terminal step not drivable.)*

---

## 2–3. Interaction and state inventory

Full tables in [audit-interactions.md](audit-interactions.md). Headline:

**851 interactive elements. 109 (12.8%) are not simply `wired` — 12 dead, 25 broken, 72 no-feedback.**

The classic dead control **does not exist here**: no `href="#"`, no empty `onclick`, no
console-only handler, and all 493 buttons carry a handler or `type="submit"`. The failures
are subtler and more damaging than dead buttons.

### The pattern that matters: failure renders as emptiness

- **No `+error.svelte` exists anywhere in the tree (0).**
- **9 of 15 server loads never reference `error`** — they destructure `{ data }` and drop the
  other half, so a failed query falls through to the empty state.
- `dashboard/+page.server.ts` is the sharpest case: a broken database renders
  *"Welcome to PersonaGen! Let's initialize your Persona Roster"* — a user with 40 personas is
  told they have none.
- `personas/[agentId]:2902` — the `checkStatuses` catch resets **every** platform to
  `{connected:false}`, so a network blip renders "No platforms connected" **on the screen where
  connections are managed**. The UI asserts the opposite of the truth about live accounts.

### States, by presence

| State | Status |
|---|---|
| loading | present, but usually a bare spinner with no context |
| empty | present — and **doing double duty as the error state**, which is the bug above |
| error | **absent as a designed state**; raw strings or silent absorption |
| success | one channel only: a toast, auto-dismissed at 4s **including errors** |
| offline | **absent** — no `navigator.onLine` anywhere |
| permission-denied | **absent** — `/admin` and `/models` silently redirect to `/dashboard` |

---

## 4. System audit

Full tables in [audit-system.md](audit-system.md). The finding that reframes the work:

> **The design system is not missing. It is bypassed.**

A July 2026 assessment concluded the token layer was good and said *"do not touch the paint."*
It was right. What it could not see is that components do not consume it:

| | |
|---|---|
| `var(--space-*)` references | **230** |
| Hardcoded `padding:` literals | **636** |
| Spacing declarations using a token | **9%** of 2,235 |
| Font sizes tokenized | **22%** (65 of 76 hardcoded) |
| Button-role class names | **128** |
| `ui/Button.svelte` importers | **3 of 20 routes** — all three *outside* the portal |
| `ui/Input.svelte` importers | **0** |
| `--container-*` layout tokens with consumers | **0 of 11** |
| Distinct neutrals | **34** (four near-whites within 4 RGB units) |

So the overhaul is **adoption of a system that already exists** — mechanical and low-risk —
not a re-theme. No new visual language needs inventing.

**Worst single inconsistency: page titles change size on every navigation.** `h1` renders at
1.35 / 1.4 / 1.45 / 1.5 / 1.6 / 2.6 / 3.6 / 4.2rem by route, and `/dashboard` has no visible
`h1` at all (`sr-only`). `.section-title` resolves to `clamp(…2.6rem)` on `/dashboard` but
`1rem` on `/personas` — same class, 2.8× apart — which makes Dashboard's `h2` larger than every
other page's `h1`. Hierarchy is inverted across the product.

**Disclosure architecture has gotten worse since July**, which named five competing surfaces
(page / tab / `<details>` / hand-rolled overlay / drawer) with no rule for which to use.
Since then `personas/[agentId]` has grown **5,826 → 10,177 lines** and `settings`
**1,778 → 3,577**. 13 separate modal-scrim implementations exist.

---

## 5. Friction list — where the journey loses people

Ranked by cost to the conversion path.

1. **`/review` rows are dead to the click.** Clicking a queue row changes nothing — no URL
   change, no dialog, not one character of page text. Entry is a small icon button only, and
   the row is `tabIndex: -1`, so it is not keyboard-reachable. This is step 4 of journey #1,
   and clicking the row is the first thing anyone tries on a queue.
2. **The spend button has no in-flight state** (`GenerationComposer:2102`) — a double-click
   double-charges. Money, not polish.
3. **8 of 11 AI Generate buttons never disable.** The handler writes
   `generating[<full prompt>]` while the markup reads `generating['Short Key']`, so the guard
   never matches. Same double-fire exposure as (2).
4. **Failure is indistinguishable from emptiness** (see §2–3). The user is told there is
   nothing, not that something broke, and is offered no retry — `PostCard`'s `onRetry` is never
   passed by any of its four call sites, so **a failed generation offers no retry anywhere**.
5. **`exportBrief()` (`brand-brief:688`) is one line: a success toast.** It reports success for
   work it never did.
6. **`/brand-brief/intel:491` fabricates data.** It fakes a 2.5–4s network delay and presents
   invented follower/engagement numbers as the brand's own. Not a UX defect — a truth defect.
7. **`/billing`'s `h1` is "$0.00"** — a number where the page name belongs. Fails the
   5-second "where am I?" test by construction.
8. **`/review` offers five view modes** (Table · Split · Deck · Board · Grid) on the one screen
   whose job is to empty a queue. Competing affordances where one obvious path belongs.
9. **Toasts are the only success channel** — 342 `showToast` sites into a component whose
   dismiss button carries `aria-label="Dismiss notification"`, which **overrides the message**
   for screen readers. Errors auto-dismiss at 4s.
10. **Permission denial is a silent teleport** — `/admin`, `/models` → `/dashboard`, unexplained.

---

## 6. Out of scope for the UI pass, raised anyway

Three items are defects rather than design, and should not wait for a design round:

- **Double-charge on double-click** (friction #2, #3) — money.
- **Fabricated intel numbers** (friction #6) — the product's own integrity claim.
- **`exportBrief` reporting success it did not perform** (friction #5).

---

## 7. Known-unfixed, carried in

- `money-display.spec.ts` fails on `components/docs/FormatExplorer.svelte` (renders a provider
  figure as money). Inherited from `4e4ba27`; the fix is a pricing-truth decision for its author.
- Merge `9872669` is committed locally and unpushed because it carries another session's work.
