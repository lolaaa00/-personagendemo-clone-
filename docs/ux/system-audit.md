# System audit — what the portal is actually built from

**Scope:** `src/routes/(portal)/**` and `src/lib/components/**`. Marketing, login and signup excluded.
**Written:** 2026-09-13. Companion to [portal-map.md](portal-map.md) and [state-matrix.md](state-matrix.md).

The exhaustive declaration-level parse (15,604 CSS declarations, 4,648 `var()` references) lives in [audit-system.md](audit-system.md) and is cited rather than repeated. This document is the summary Phase 1 is scored against, plus what round 1 changed.

**Corpus:** 17 authenticated route files, ~41,000 lines. 36 components, ~16,300 lines. One stylesheet, `src/app.css`.

---

## 1. Headline: the token layer exists and is largely unused

`app.css` defines a complete system: a colour scale, `--text-*` type scale, `--space-*` spacing, `--radius-*`, `--shadow-*`, `--ease-*` motion, and five `--container-*` widths. Adherence by dimension:

| Dimension | Tokenised | Raw values in use |
|---|---:|---|
| Colour (`color:`) | ~95% | 172 hardcoded hex, 150 `rgb()/rgba()` |
| Border radius | 43% | 352 raw px |
| Typography (`font-size:`) | 23% | 769 literals; 7 below the smallest token |
| Spacing (padding/margin/gap) | ~6% | ~1,490 literals |
| Motion (`transition:`) | **0.5%** | **216 of 217 raw durations** |
| Container width | **0%** | 9 distinct max-widths, none matching a token |

The colour layer is genuinely good and is why the portal reads as one product at a glance. Everything measured in pixels or milliseconds is effectively untokenised, which is why it stops reading as one product the moment you compare two screens side by side.

**Worst offenders by combined raw-value count:** `personas/[agentId]` (446), `brand-brief` (225), `GenerationComposer` (212), `guides` (173), `generator` (171), `review` (160).

---

## 2. One job, many implementations

| Job | Implementations | Note |
|---|---:|---|
| Table / data grid | **10** | 6 real `<table>` variants, 2 div-grids with ARIA, 2 div-grids with none |
| Modal / dialog / drawer | **13** | 1 shared `ui/Modal` used by 4 components and **zero pages**; 5 hand-rolled dialogs on the persona page live inside a class named `lightbox-backdrop` |
| Empty state | **25** | no shared component; 4 pages re-implement the same `.empty-icon` slot |
| Page header | **9** | plus 8 `h1` sizes and 10 subtitle class names |
| Container shell | **12** | 4 pages use the class `.page` with 4 different max-widths |
| Tabs | **9** | 4 different ARIA contracts; one has no roles at all |
| Badge / pill / chip | **~60** | while `app.css`'s own badge primitives had **zero** references |
| Avatar | **11** | each re-deriving the same gradient-plus-initial fallback |
| Post tile | **7** | `PostCard` plus five hand-rolled in `/review` and one in `/calendar` |
| Spinner | **15** | and no skeleton anywhere |
| Pagination | **1** | and it is for guide pages |

**Status colour is defined four times, with different palettes for the same state** — `personas/[agentId]:2994`, `CalendarView:361`, `PostDrawer:521`, `StatusBadge:8`. A post that is `failed` is not the same colour in the feed, the calendar and the drawer.

**`src/lib/components/ui/` is not the design system.** Of its seven files, `Button` and `Card` are used by **zero** portal pages, `Modal` by zero pages, and `Input` was imported nowhere at all. The portal hand-rolls ~185 `class="btn…"` elements and ~216 card-shaped rules instead. `.btn-primary` and `.btn-ghost` are defined globally **and shadowed locally in five files each**, so the same class name renders differently depending on which page you are on.

---

## 3. Terminology — one thing, many names

| Concept | Names in live UI copy |
|---|---|
| A generated post | **generation** (sidebar) · **content output** (its own tab) · **post** (Favorites) · **content** (persona page) · **draft** (status) · **asset** |
| The container | **workspace** (data, admin) · **team** (Settings) · **brand** (a filter) · **project** (sidebar groups) · **organization** (guides) |
| A linked social account | **connection** (tab) · **account** (copy beside it) · **platform** (stat) · **channel** (`AgentConnectionStats`) |
| The AI character | **persona** (canonical) · **agent** (`?agent=` URL param, components, props) · **creator** (dashboard copy) · **character** (persona section) |
| Money | **credits** (pill) · **balance** (billing) · **wallet** (prose) · **cr** (admin) · **spend** / **cost** / **charge** (three column headers) |

Two are actively harmful rather than merely untidy:

- **"creator"** means *a persona* in the dashboard's own copy and *a human seat that may draft but not publish* in Settings → Team. Both appear in the same product.
- **`AgentRoster`** heads a column **"Gen Spend"**, renders a currency amount, and appends a raw **LLM token count** in parentheses. Three different units under one heading.

`admin/+page.svelte:343` contains the collision in a single sentence: *"Seat management for a **workspace** still lives in Settings → **Team**."*

---

## 4. What round 1 changed

| Change | Effect |
|---|---|
| `--space-7` defined | It was referenced by `/models` and missing, so the margin silently collapsed. Same class of bug `app.css` had already patched four times. |
| Toast systems 3 → 1 | `/admin`'s own stack sat at `z-index: 50`, behind every dialog, so failures raised from inside a modal were invisible. `/review` shadowed the global `showToast` with a local one. |
| `window.prompt` ×14 and the last native `confirm()` removed | Replaced by the shared dialog, which gained an optional text prompt so the Admin Console's mandatory audit note is captured in something that can be styled and can name the row being changed. |
| `ui/Input.svelte`, `generation/GenerationProgress.svelte` deleted | Imported nowhere. |
| `src/lib/seat.ts` added | First shared source for what a seat may do, mirroring `ROLE_RANK` and `public.role_rank()`. Wired into two surfaces so far. |
| `src/lib/return-to.ts` added | One definition of where a user goes after signing in, used by the hooks gate, the portal layout and the 401 path. |

---

## 5. What Phase 1 still owes, ranked by reach

1. **`PageHeader`** — one component retires 9 header patterns, 8 `h1` sizes and 10 subtitle names. Highest coherence gain per line changed.
2. **One container shell** — adopt `--container-*` and delete 12 bespoke wrappers, including the four different `.page` definitions.
3. **`EmptyState`, `Skeleton`, `ErrorState`** — the three primitives [state-matrix.md](state-matrix.md) is blocked on.
4. **One status-colour source** — a single map, imported by the feed, calendar, drawer and badge.
5. **Motion tokens** — 216 raw durations onto `--ease-fast/std/slow`. Mechanical, and it is why hover timings differ between pages.
6. **Adopt or delete `ui/Button` and `ui/Card`** — a design-system folder no page imports is worse than none, because it looks like the system is covered.
7. **Terminology pass** — pick one word per concept and enforce it in nav, headings, buttons, toasts, errors and `/guides`.

**Sequencing note.** Items 1, 2 and 5 touch every route's `<style>` block and cannot be verified by type-checking alone; they need a running portal and screenshots at four viewports. They are deliberately **not** attempted until an environment exists to verify them in, because a sweeping unverifiable CSS rewrite is how a coherence pass becomes a regression.
