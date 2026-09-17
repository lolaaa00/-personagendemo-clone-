# Portal UX changelog

Changes to the authenticated portal, newest first. Landing, pricing, signup and
login are out of scope and untouched throughout.

Scores are from an independent critic who logs in as each role, drives the real
portal, and takes its own screenshots. Rubric: four dimensions × 0–10.
**>8.5 = AAA · 7 = good indie · 5 = programmer art · 3 = actively broken.**
Pass gate: ≥34/40, no dimension below 8.0, zero blocker/major issues.

| Round | Visual | Efficiency | Integrity | Coherence | Total |
|---|---|---|---|---|---|
| 1 | 5.5 | 5.5 | 5.5 | 5.5 | **22.0** |
| 2 | 6.0 | 6.0 | 6.0 | 6.0 | **24.0** |
| 4 | 6.0 | 6.0 | 6.5 | 6.0 | **24.5** |
| 5 | — | — | — | — | *not yet scored* |

---

## Round 5 — the factory, not the output

Round 4 scored 24.5/40 and verified nine of eleven claimed fixes. The total
barely moved, and the reason was visible in the measurements: **the layout
numbers were identical to round 2.** Four rounds had fixed instances while the
things producing them stayed in place. This round changed the producers.

### Structural

**One page shell.** `PageShell` owns width, gutter, masthead and `h1` scale for
every portal route. Measured at 1920:

| | Before | After |
|---|---|---|
| `h1` left edge | 10 values, spanning 441px | **2** (392 · 512) |
| `h1` font-size | 7 values, 21.6–67.2px | **1** (24px) |
| Container widths | 10 (800px → `100%`) | 2 |

`/guides` keeps its full-bleed sticky docs chrome but aligns its content to the
same column, so its heading lands with the others.

**One focus ring.** A baseline `:focus-visible` rule in `app.css`, plus removal
of the five rules that paired `outline: none` with a 22%-alpha border — an
indicator measuring ~1.2:1 against WCAG 2.2's 3:1 floor. One of them sat a
single selector away from a rule fixed in round 3 for the same reason.

**Invariants, not conventions.** `src/lib/portal-shell.spec.ts` asserts all of
the above against the source, so the next page added has to obey them. Nine
checks; each failed before the change it guards. Two of them caught leftovers
this round's own work had missed.

### Blockers

**`/review` hid the caption below 1024.** CAPTION, PLATFORMS and STATUS were
`display: none` below 900px, leaving QC — `null` for every post, forever — as the
only content-bearing column. At 768 a reviewer was approving posts they could not
read. Column priority now runs from the content outward and the caption never
goes. *Verified: 14 of 14 caption cells render at 768, minimum width 169px.*

**The calendar legend mis-bucketed three statuses.** `partial` counted as
published, `publishing` as scheduled, `rejected` as **failed**. One chip per
status now, counted by equality and driven off `POST_STATUSES`. *Verified: 9
published · 1 partly published · 5 scheduled · 1 publishing · 9 draft · 1
generating · 1 rejected · 2 failed — each its own chip.*

### Integrity

- The persona hero read **"0 POSTS"** for a persona with three published, because
  it derived the count from a feed only fetched on two of the tabs. It is a count
  query now, labelled `Published`. *Verified: reports 3.*
- The sticky actions column no longer sits on top of STATUS and the scheduled
  time at 1280 — the caption column absorbs the table's slack instead of forcing
  an overflow. *Verified: zero occluded cells.*
- QC on `/review` and Gen Spend on the dashboard roster render only when
  something has a value.
- Board lanes are real statuses (Scheduled was `status !== 'draft'`, which filed
  every rejected post under it), and the board **actually drags** — every move
  maps onto an API action the buttons already use.
- `restore` returns a rejected post to draft. It writes no `post_reviews` row:
  the rejection happened and stays in the training log.
- A row's Reject no longer overwrites the bulk selection. *Verified: no checkbox
  ticked, bulk bar stays hidden, picker names its target post.*
- The Content Plan is readable outside the wizard — a tab on `/brand-brief`
  renders pillars, schedule, platform order and provenance. The wizard had been
  promising in writing that answers were kept while nothing read them back.

### Copy and contrast

- `/guides` described the pre-fix product: three names for the Content Plan, a
  button that does not exist, "Growth Targets" the page deliberately refuses to
  invent, and a sidebar missing Trash, Developer API and Billing.
- Platform badges were white on the raw brand hue at 9px — 3.68:1 for TikTok —
  beside status badges already at 11px on a dark scrim. Same treatment now, brand
  colour kept as the dot.
- Selected filter chips measured 3.27:1 and count pills 2.95:1 **in light theme
  only**; the wallet balance 2.97:1 from a hardcoded hex. All now use the
  per-theme `-text` tokens.
- `post(s)` → `plural()`. "Total Reach" (a follower sum) → "Total Followers".
  "New Post" (which opened the calendar) → "Open calendar". "Credits" → "Balance",
  matching `/billing`. The `/billing` top-up CTA names a real destination.
- Every disabled Next in the Content Plan wizard states what would enable it, and
  the stepper no longer offers a step it will refuse.

### Not changed, and why

- **The never-settling dashboard animation.** `app.css` already stops all
  infinite animation under `prefers-reduced-motion`. The screenshot timeout is a
  tooling artifact — pass `animations: 'disabled'`.
- **Sixty-nine other `color: var(--accent)` sites.** Only the ones measured as
  failing were changed. A blanket sweep without measurement is how a blind visual
  change ships.
- **`docs/ux/*` "missing".** Round 4 reported these files absent; they are at the
  repo root, not under `personagen-svelte/docs/`. No change needed.

---

## Round 4 — trust, legibility and dead ends

Round 2's ranked list, taken deeper. Status-badge legibility (on-dark palette,
`rejected`/`generating` rules, 11px, denser scrim); pre-paint theme in
`app.html`; rejections made reachable (`/api/review` returns `rejected` with its
reason, filter option, reason no longer pre-selected); `/billing` names itself;
`src/routes/+error.svelte`; a UUID shape check turning a 500 into a 404; one
title convention across all 16 routes.

## Round 3 — measurement, not invention

Removed the dashboard's invented score (`70 + engagement×2.5 + connections×4`,
floored at 70 by a constant) in favour of a Published count. Made the `/review`
actions column reachable at 1280 (it sat 149px off-screen). Approving a post
updates the row in place instead of removing it and reporting a count a reload
contradicted. Removed a third party's domain shipped as a form *value*.

## Rounds 1–2 — audit and first pass

Route inventory, state matrix and system audit. One status-colour source. Seat
capabilities and return-to-after-login. A deterministic Content Plan replacing a
wizard that ran `setTimeout(2500 + random*1500)` and returned a hardcoded literal
— including a "targets" table presenting invented figures as the user's own
current performance.
