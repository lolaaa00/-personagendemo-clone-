# PersonaGen — UX Assessment & Makeover Plan

Assessed with the `ui-ux-pro-max` design-intelligence skill against the live SvelteKit portal.
Stack detected: **SvelteKit / Svelte 5 runes**. Date: 2026-07-25.

---

## 0. Verdict

The app is **not** in need of a visual redesign. The token system (`app.css`) is genuinely good:
a 12-step spacing scale, a radius scale, a z-index scale, semantic colour tokens, full light/dark,
and a `prefers-reduced-motion` block. The skill's palette recommendation for this product type
(`#7C3AED` AI-purple + generation-pink accent, "Soft UI Evolution" style, WCAG AA+) is *already
what you're running*. Do not touch the paint.

What is broken is **disclosure architecture** — the rules for *where* a piece of UI appears.
Right now there are five competing surfaces (page, tab, `<details>`, hand-rolled overlay, drawer)
with no rule governing which is used, so the same weight of content lands in a modal on one screen
and a collapsible on the next. That is what makes it feel unsmooth, not the styling.

**The makeover is viable and mostly mechanical.** ~80% of the win comes from three changes:
one dialog primitive, one disclosure rule applied consistently, and moving two workspaces out of
collapsibles. None of it requires re-theming.

---

## 1. Current surface inventory

| Route | Lines | Disclosure surfaces in use |
|---|---:|---|
| `personas/[agentId]` | 5,826 | hero + 3 tabs + **6 `<details>`** + **7 hand-rolled overlays** |
| `brand-brief` | 4,441 | 7 tabs + **a 5-step wizard nested inside a tab** + 2 overlays |
| `calendar` | 2,966 | toolbar + Day/Week/Month + personas rail + **3 overlays, one stacked on another** |
| `settings` | 1,778 | **7 always-open cards**, no collapse, no sub-nav + 1 modal |
| `generator` | 1,751 | 3-step wizard + **Persona Vault modal** |
| `PostDrawer` | 1,338 | right drawer + 1 nested `<details>` |
| `review` | 832 | filter bar + bulk bar + **inline reject picker** + drawer |
| `(portal)/+layout` | 1,057 | sidebar (4 sections) + header + user dropdown |

Total: **9 distinct dialog implementations**, of which **2** use the shared `Modal.svelte`.

---

## 2. The disclosure rule (adopt this, apply everywhere)

The single missing artifact. Pin it and every "modal or collapsible?" question answers itself.

| Surface | Use when | Never use for |
|---|---|---|
| **Route / page** | Content has its own identity, deserves a URL, is returned to | Transient confirms |
| **Tabs** | 2–4 mutually exclusive views of the *same* object, roughly equal weight. Must sync to `?tab=` | Sequential steps |
| **Right drawer** | Inspecting or editing **one item from a list** while the list stays visible | Whole-page forms |
| **Collapsible `<details>`** | Independent groups in a form you own, **≤ ~1 screen each**, user may want several open | Anything that is itself a workspace |
| **Modal** | Blocking decision, **≤1 screen, ≤2 fields**, or destructive confirm. Also: focused wizards | Browsing, long forms, anything that can stack |
| **Popover / inline expander** | Micro-decisions anchored to their trigger (reason picker, variant chooser) | Anything needing its own scroll |

Two hard constraints that follow from it:
- **Modals never stack.** If a modal needs to open another surface, it was the wrong surface.
- **Every dialog goes through one component.** No exceptions.

---

## 3. Modal → Collapsible / Inline (things that should stop being modals)

### 3.1 Calendar day modal — **highest-value single fix**
`calendar/+page.svelte:1290` — clicking a month cell opens `.day-modal`, which lists posts, and
clicking one sets `selectedPost` → opens `PostDrawer` **on top of the modal**. Two blocking layers
for one drill-down. The `.z-top` class at line 1363 is the scar tissue from that fight.

**Change:** month cell click → either expand the day inline within the grid row, or `setView('day')`
scrolled to that date (you already have a working Day view — use it). Post click → `PostDrawer`
directly. Deletes an entire modal layer and one z-index escalation.

### 3.2 Persona "Restore profile picture" + "Restore <stage>" — two modals, one job
`personas/[agentId]:3907` and `:3948`. Same interaction (pick a historical image), two
implementations, two mental models. **Change:** one restore drawer with a stage selector. `-1` dialog.

### 3.3 Generator "Persona Vault" modal
`generator/+page.svelte:840` — a browse-and-pick list that feeds the wizard form behind it. You need
to see what you're filling. **Change:** right drawer. Modal is wrong for browsing.

### 3.4 "Generate drafts for X?" confirm
`personas/[agentId]:3824`, with a "skip next time" checkbox. Costs money, so a confirm is defensible —
but a full-screen blocking modal for a 2-line yes/no is heavy. **Change:** popover anchored to the
button, or fire-and-offer-Undo in the toast.

### 3.5 "Publish to a connected platform" fallback modal
`personas/[agentId]:4038` — duplicates actions already in `PostDrawer`'s footer.
**Change:** inline expander inside the drawer footer. `-1` dialog.

### 3.6 GenerationComposer — 868 lines and ~15 fields inside `size="lg"` (760px)
Correctly uses the shared `Modal`, but it is far past modal weight, and it's launched from two
different places. **Change:** promote to a right drawer (keeps the calendar/feed visible behind it,
which matters — you're composing *into* a slot you can see) or to `/compose`.

**Keep as modals:** delete-brief, delete-account, delete-agent. Destructive confirms are exactly
what modals are for.

---

## 4. Collapsible → Route / Drawer (things that should stop being collapsibles)

### 4.1 Persona Profile tab — the 6 `<details>` problem
`personas/[agentId]:2624–3824`: Brand Kit · Persona Profile · Platform Identity Kit ·
Character & Visuals · Automation · Spend & Pricing.

Two of these are not form sections, they are **workspaces**:
- **Platform Identity Kit** (~240 lines) — a 13-platform matrix with per-platform LLM calls
  (~11s each), handle candidates, confirm state, debounced autosave.
- **Character & Visuals** (~360 lines) — avatar generation, multi-angle reference kit, skills
  and tools editors (which themselves open sub-editors at `:3391` and `:3414`).

Expanding either pushes ~1,500px of content down and buries everything below it. A collapsible whose
open state destroys the page's scroll model is the wrong container.

**Change:** promote both to sub-routes — `/personas/[id]/identity` and `/personas/[id]/character` —
or to full-height drawers with their own save state. Keep **Brand Kit, Automation, Spend & Pricing**
as collapsibles; they're short and read-mostly. Result: Profile tab becomes scannable in one screen.

### 4.2 Brand Brief "Content Intelligence & Strategy Wizard"
`brand-brief:1979` — a 5-step wizard living inside a *tab* of a 7-tab page. A wizard inside a tab
inside a page has no exit affordance, no progress in the URL, and competes with the page's own
Save button. Wizards are the one case where **modal beats inline**: they demand focus.

**Change:** `/brand-brief/intel` as a focused full-screen flow, or a full-screen modal with explicit
Save-and-exit. Step index in the URL either way.

### 4.3 Settings — 7 always-open cards, zero collapse
`settings:616–1137` — Profile, Notifications, Brand Theme, Provider API Keys, Zernio Key Manager,
Billing, Danger Zone. All expanded, all the time, 1,778 lines of vertical scroll to reach Danger Zone.
This is the canonical case for a **left sub-nav**, not a scroll. (Skill DB, Navigation → *nav-hierarchy*:
primary vs secondary nav must be clearly separated.)

**Change:** sub-nav rail with `?section=` deep links. Fallback if that's too much: collapsible cards
with Profile + Zernio open by default.

### 4.4 Review page reject picker
`review:362` — an inline bar that appears *above* the grid and pushes every card down. That's a
deliberate layout shift on a click. **Change:** popover anchored to the Reject button, or fold it into
the existing `SelectionToolbar`.

---

## 5. Cross-cutting defects (these are what "unsmooth" actually is)

### 5.1 Dialog anarchy — CRITICAL
`Modal.svelte` exists, handles Escape and background scroll-lock, and has **2 consumers**
(`MediaPreviewModal`, `GenerationComposer`). Eight other files hand-roll `.modal-overlay` /
`.modal-backdrop` / `.composer-overlay`. Verified by grep: the string `Escape` appears in exactly
**two** components in the entire app. So:
- 7 of 9 dialogs **do not close on Escape**
- 7 of 9 **do not lock background scroll** — the page scrolls behind the dialog
- Backdrop-click-to-close is implemented ad hoc, sometimes on `role="presentation"`, sometimes not

### 5.2 No focus management anywhere — CRITICAL
`Modal.svelte`'s own comment claims "focus-trap-ish behaviour". There is no trap, no initial focus,
and no focus restore on close. Every dialog in the app lets keyboard focus tab straight into the
page behind it, and returns focus to `<body>` on close. Skill priority #1 (Accessibility) and the
DB's *Keyboard Navigation* rule (severity: High).

### 5.3 z-index anarchy — and one real bug
`app.css` defines a clean scale (`--z-modal: 200`, `--z-drawer: 999`, `--z-overlay: 1000`,
`--z-toast: 300`). **No dialog uses it.** Actual hardcoded values in the wild:

```
Modal.svelte            1000     PostDrawer            1000 / 1001
ManualDeleteNotice      1000 / 1100                 ImageLightbox  1200
brand-brief overlay     1100     CalendarView          1000, plus 80/85/90
ActivityIndicator        900     BrandWave           999999   ← 
```

**Concrete bug:** `Toast.svelte:32` uses `var(--z-toast, 300)`. Every dialog sits at 1000+.
**Any toast fired while a dialog is open renders behind the dialog backdrop** — which is precisely
when your longest, most failure-prone operations report their result (generation, publish, scrape).
Users are losing error messages right now.

(DB rule, Layout → *Z-Index Management*, severity High: "Define z-index scale system… don't use
arbitrary large z-index values.")

### 5.4 Emoji used as icons alongside a clean SVG set
The sidebar and layout use proper stroked SVG (Lucide-style, 18px, `currentColor`). But:
`review` (✅ ✕ ✎ ▶ 🎉 🗑 ⚠), `brand-brief` wizard step icons (🏢 🔍 📋 🎯 ⚡), `PostDrawer`
(🖼 🎥 🎬 ⚙ 💰 💬 🎯), `generator` (✨ 💡 🎙 👤 🚀), `dashboard` (🚀 📅 ✨), `PostCard` (↺ 📤 👁 ♥),
`Toast` (✓ ✕ ℹ ⚠).

Emoji render differently on every OS, ignore `currentColor` so they don't follow your theme, can't
be stroke-matched to the SVG set, and won't optically align to an 18px grid. This is the #1 item on
the skill's pre-delivery checklist. **Change:** one Lucide/Heroicons SVG sprite; emoji only in
user-authored content.

### 5.5 Deep-linking is inconsistent
`personas/[agentId]` does it right (`?tab=`, with legacy-value handling and `history.replaceState`).
Nothing else does. Brand-brief's 7 tabs, calendar's Day/Week/Month + current date, review's three
filters, generator's step — all plain `$state`. Refresh, back button, or sharing a link drops the
user back to a default. DB rules: *Deep Linking* and *Back Behavior*.

### 5.6 Touch targets
`min-height: 44px` appears **zero** times on any interactive element in the app. Currently
sub-44px: sidebar collapse button (28×28), review's `.pick` and `.edit-btn`, `.mini-btn`,
`.modal-x`, calendar's day-cell post chips. Skill priority #2, CRITICAL.

### 5.7 Responsive effort is inverted
Media-query counts: `personas/[agentId]` (5,826 lines) → **2**; `settings` (1,778) → **1**;
`brand-brief` (4,441) → **3**; `calendar` (2,966) → 6. Your largest, densest pages have the least
responsive work.

### 5.8 Long-running AI feedback
Every AI operation resolves to a spinner + label ("Scraping Store…", "Generating…") and a transient
toast. Identity Kit runs ~11s *per platform*. DB rule, AI Interaction → *Streaming*: "Don't show
loading spinner for 10s+." And because toasts expire, a 60s job that fails leaves no trace at all.
**Change:** per-item progress in place of a page spinner (`GenerationProgress.svelte` already exists —
use it everywhere), and a persistent failure state on the affected item rather than toast-only.

### 5.9 No header action slot
`(portal)/+layout.svelte:328` computes the page title with an inline IIFE. There's no slot for
page-level actions, which is *why* every page invents its own `page-header` action row —
brand-brief crams a `<select>` + 5 buttons into one line. **Change:** give the portal header an
`actions` snippet slot so primary actions live in one persistent, predictable place.

---

## 6. Phased plan

### Phase 1 — Foundation (highest value / effort ratio)
1. Harden `Modal.svelte`: real focus trap, initial focus, focus restore on close, `--z-modal` token.
2. Add `Drawer.svelte` as a sibling primitive (extract from `PostDrawer`'s proven behaviour).
3. Migrate all 7 hand-rolled overlays onto them. Delete every hardcoded z-index; fix `BrandWave`'s
   999999; **raise `--z-toast` above `--z-overlay`.**
4. One SVG icon set; strip emoji from chrome.

*Effect: Escape works everywhere, background stops scrolling, keyboard users can use the app,
error toasts become visible again. No visual redesign.*

### Phase 2 — Disclosure corrections
5. Calendar: kill the day modal (§3.1).
6. Merge the two restore modals (§3.2); vault → drawer (§3.3); publish-fallback → inline (§3.5).
7. Promote Identity Kit + Character & Visuals out of `<details>` (§4.1).
8. Settings sub-nav (§4.3); Intelligence Wizard to its own focused flow (§4.2).

### Phase 3 — Polish
9. Deep-link every tab / view / filter / step.
10. 44px touch-target sweep; responsive pass on persona + settings + brand-brief.
11. Per-item AI progress; persistent failure states.
12. Header action slot.

---

## 7. Method note

The skill's `--design-system` generator **misrouted** on this product: it returned a
"Newsletter / Content First" landing pattern and a Hebrew font pairing (Noto Sans Hebrew), neither
of which applies to an authenticated content-ops portal. Those two outputs are discarded here.

What *did* match and is used above: the **Soft UI Evolution** style profile (WCAG AA+, 200–300ms
transitions, modern shadows), the **AI-purple / generation-pink** palette (which your `app.css`
already matches), the SaaS/Data-Dense dashboard product profile, the pre-delivery checklist, and the
individual UX guideline records cited inline (Z-Index Management, Keyboard Navigation, Focus States,
Deep Linking, Empty States, Loading States, AI Streaming, nav-hierarchy, progressive-disclosure).

Direct database queries for `modal`, `progressive disclosure`, `accordion`, and `collapsible`
returned **0 results** — the UX guideline set has a `progressive-disclosure` rule indexed in
`quick-reference.md` but no searchable records on modal-vs-collapsible selection. The decision matrix
in §2 is therefore synthesised from Apple HIG / Material (as cited in the quick-reference index) plus
the codebase evidence, **not** a database match.
