# §4 — System audit (visual design system values)

Read-only source analysis of `personagen-svelte`. No app run, no tests, no typecheck.

**Corpus.** 61 `.svelte` files, 20 `src/routes/**/+page.svelte`, 1 stylesheet (`src/app.css`, 1240 lines). All `<style>` blocks were parsed to declaration level (comments stripped, multi-line declarations joined): **15,604 CSS declarations** inside component `<style>` blocks, plus 4,648 `var(--…)` references across the tree.

Every number below is a count over that parse or over an exhaustive `grep`. Where a number is a sample it says so. Line numbers are the line the declaration or selector begins on.

---

## 0. Headline counts

| Dimension | Distinct values in use | Tokenized share |
|---|---|---|
| Neutral/gray hex literals hardcoded in components | **20** (+14 neutral token values = 34 total neutrals) | — |
| All hex literals in components | **81** distinct (333 occurrences) | — |
| `rgba()` literals in components | **89** distinct (172 occurrences) | — |
| Font sizes | **76** distinct expressions; **65** are hardcoded literals | 22% (229/1027 decls) |
| Font weights | **12** distinct | 7% (35/526) |
| Line heights | **20** distinct | 14% (21/159) |
| Letter spacings | **19** distinct | 10% (12/130) |
| Atomic spacing lengths (padding/margin/gap) | **71** hardcoded (52 `rem` + 19 `px`) + 11 token refs | 9% (181/1971 non-trivial decls) |
| Border-radius computed values | **20** distinct; **40** distinct spellings | 40% (286/720) |
| Border widths | **5** (1, 1.5, 2, 2.5, 3 px) | n/a |
| Box-shadows | **80** distinct across 127 decls | 24% use a `--shadow-*` token (30/127) |
| Transition/animation durations | **29** distinct | — |
| Easings | **13** distinct (7 distinct `cubic-bezier`) | 6% (17/292 decls use `--ease-*`) |
| Button-role class names | **128** | `ui/Button.svelte` imported by 3 of 20 routes |
| Chip/pill/badge/tag class names | **117** | global `.badge-*` primitives used **0** times |
| Card-role class names | **95** | `ui/Card.svelte` imported by 3 of 20 routes |
| Modal/overlay/drawer class names | **71**; 13 distinct scrim implementations | `ui/Modal.svelte` imported by 4 files |
| Empty-state class names | **39** | no shared component |
| Toolbar/header class names | **54** | no shared component |

---

## 1. Colour

### 1.1 Tokens defined

`src/app.css` defines **128** custom properties on `:root` (`src/app.css:20-253`) with a dark override at `src/app.css:256-317`.

Colour tokens, light mode (`src/app.css:22-128`):

| Token | Value | Line |
|---|---|---|
| `--bg` | `#f8f9fc` | 22 |
| `--surface` | `#ffffff` | 23 |
| `--surface-2` | `#f1f3f9` | 24 |
| `--surface-3` | `#e6e9f2` | 25 |
| `--border` | `rgba(15,23,42,0.08)` | 28 |
| `--border-hover` | `color-mix(… --accent 35% …)` | 29 |
| `--border-strong` | `rgba(15,23,42,0.15)` | 30 |
| `--text` | `#0f172a` | 33 |
| `--text-muted` | `#334155` | 34 |
| `--text-dim` | `#556170` | 39 |
| `--muted` | alias → `--text-dim` | 45 |
| `--danger` | alias → `--error` | 46 |
| `--bg-card-dark` | alias → `--surface-2` | 49 |
| `--accent` | `#7c6aed` (+ `-soft/-mid/-dark/-light`) | 52-56 |
| `--accent-text` / `--cyan-text` | derived `color-mix(… 55% #000)` | 72-73 |
| `--success-text` `--warning-text` `--rose-text` `--error-text` `--info-text` | `#047857 #a04607 #be185d #b91c1c #1d4ed8` | 74-78 |
| `--cyan` | `#0ea5e9` (+ `-soft/-mid`) | 89-91 |
| `--gold` `--success` `--rose` `--error` `--warning` `--info` (+ `-soft` each) | `#b45309 #059669 #db2777 #dc2626 #d97706 #2563eb` | 94-115 |
| 4 gradients (`--gradient`, `-warm`, `-full`, `-subtle`) + `--gradient-cta` | — | 82-128 |

Dark override (`src/app.css:258-316`) restates 21 of them; a **third** mechanism, `.theme-dark-context` (`src/app.css:1127-1143`), restates 8 of the same values a third time as a local-context class.

Neutral token values total **14** (7 light + 7 dark surface/text).

### 1.2 Hardcoded colour in components

**81 distinct hex literals, 333 occurrences; 89 distinct `rgba()` literals, 172 occurrences. No `hsl()` anywhere.**

Hex literals by file (top 10):

| File | Hex occurrences |
|---|---|
| `src/routes/+page.svelte` | 35 |
| `src/routes/(portal)/personas/[agentId]/+page.svelte` | 30 |
| `src/lib/components/feed/PostCard.svelte` | 27 |
| `src/routes/(portal)/generator/+page.svelte` | 26 |
| `src/routes/(portal)/settings/+page.svelte` | 18 |
| `src/routes/(portal)/developer/+page.svelte` | 15 |
| `src/routes/(portal)/brand-brief/+page.svelte` | 14 |
| `src/lib/components/dashboard/AnalyticsPanel.svelte` | 14 |
| `src/lib/components/feed/PostDrawer.svelte` | 11 |
| `src/routes/(portal)/models/+page.svelte` | 10 |

### 1.3 Distinct grays

Classifying hex literals with RGB spread ≤ 30 as neutral: **20 distinct neutral hex literals hardcoded in components**, on top of the 14 neutral token values — **34 distinct neutrals in the codebase**.

| Hex | Uses | Luma | Nearest token |
|---|---|---|---|
| `#ffffff` / `#fff` | 153 | 255 | `--surface` (exact) |
| `#f7f8fc` | 1 | 248 | `--bg` `#f8f9fc`, d=1.4 |
| `#f5f4fb` | 1 | 245 | `--surface-2` `#f1f3f9`, d=4.6 |
| `#f3f4f6` | 1 | 244 | `--surface-2`, d=3.7 |
| `#e6e8f0` | 3 | 232 | `--surface-3` `#e6e9f2`, d=2.2 |
| `#d9dbe3` | 2 | 219 | `--surface-3`, d=24.3 |
| `#d8dbe8` | 1 | 220 | `--surface-3`, d=22.2 |
| `#8a8a8a` | 1 | 138 | dark `--text-dim` `#82809a`, d=20.5 |
| `#71767b` | 1 | 117 | — |
| `#6b7280` | 2 | 114 | — |
| `#333` | 1 | 51 | — |
| `#2b3247` | 1 | 50 | `--text-muted` `#334155`, d=22.0 |
| `#1f2433` | 1 | 36 | dark `--surface-3` `#1e1e2e`, d=7.9 |
| `#111827` | 1 | 24 | `--text` `#0f172a`, d=3.7 |
| `#14172b` | 2 | 24 | `--text`, d=5.1 |
| `#1a1205` | 1 | 19 | dark `--surface`, d=21.2 |
| `#0e0e16` | 2 | 15 | dark `--surface` (exact) |
| `#0b0f1a` | 1 | 15 | dark `--surface`, d=5.1 |
| `#0b0713` | 2 | 10 | dark `--bg` (exact) |
| `#000` | 16 | 0 | — |

Four near-whites inside 4 RGB units of each other are in use simultaneously: `--bg` `#f8f9fc`, `#f7f8fc`, `#f5f4fb`, `#f3f4f6`. Three light borders/dividers inside 3 units: `--surface-3` `#e6e9f2`, `#e6e8f0`, `#d8dbe8`.

### 1.4 Hex literals that are exact duplicates of a live token

16 hex literals in components are **byte-identical to a token that already exists**, so those call sites are frozen against theme changes:

`#ffffff` (=`--surface`), `#7c6aed` (=`--accent`), `#0ea5e9` (=`--cyan`), `#22d3ee` (=dark `--cyan`), `#059669` (=`--success`), `#34d399` (=dark `--success`), `#dc2626` (=`--error`), `#ef4444` (=dark `--error`), `#d97706` (=`--warning`), `#f59e0b` (=dark `--warning`), `#2563eb` (=`--info`), `#3b82f6` (=dark `--info`), `#f472b6` (=dark `--rose`), `#d4a853` (=dark `--gold`), `#0b0713` (=dark `--bg`), `#0e0e16` (=dark `--surface`).

### 1.5 Dead token fallbacks that disagree with the token

`var(--token, fallback)` where the token is always defined, so the fallback is unreachable **and** wrong:

| Site | Written | Token's real value |
|---|---|---|
| `src/lib/components/ui/ImageLightbox.svelte:190`, `src/lib/components/ui/SelectionToolbar.svelte:78,101` | `var(--border, #e6e8f0)` | `rgba(15,23,42,0.08)` |
| `src/lib/components/feed/PostCard.svelte:976,977`; `src/routes/(portal)/favorites/+page.svelte:606,626`; `src/routes/(portal)/generations/+page.svelte:720-722`; `src/routes/(portal)/personas/[agentId]/+page.svelte:8033,8034,8039` (12 occurrences) | `var(--rose, #e84393)` | `#db2777` light / `#f472b6` dark |
| `src/lib/components/ui/SelectionToolbar.svelte:86,87` | `var(--accent, #7c6aed)` | `#7c6aed` (correct, but the brand-theme runtime rewrites `--accent`) |
| `src/lib/components/ui/SelectionToolbar.svelte` (bg) | `var(--surface-2, #f7f8fc)` | `#f1f3f9` |

### 1.6 Colour hardcoded next to tokens in the same rule block

`src/lib/components/feed/PostCard.svelte:758-796` — six status/format chips in one contiguous block, four token-driven and two literal:

```
.tile-format[data-surface='typographic'] { color:#c9b8ff; border-color:#c9b8ff }   :759
.tile-format[data-surface='photo']       { color:#d9dbe3 }                          :763
.tile-format[data-surface='video']       { color:var(--cyan) }                      :767
.tile-format[data-surface='cinematic']   { color:#ffd58a; border-color:#ffd58a }    :771
.tile-status[data-status='draft']        { color:#d9dbe3 }                          :788
.tile-status[data-status='asset']        { color:#c9b8ff }                          :792
```

Also `src/lib/components/feed/PostCard.svelte:923` `background: linear-gradient(135deg, #1f2433, #2b3247)` and `:1024` `color:#7ee8c7` — three more one-off colours in the same file.

### 1.7 Dark-theme handling — three mechanisms

| Mechanism | Where | Scope |
|---|---|---|
| `[data-theme='dark']` attribute on `<html>` | `src/app.css:256`, `src/app.css:1118`; set at `src/lib/stores/ui.svelte.ts:103`; component-level `:global([data-theme='dark'])` at `src/lib/components/shared/BrandWave.svelte:231`, `src/routes/(portal)/settings/+page.svelte:3092,3095` | primary |
| `prefers-color-scheme` | `src/lib/stores/ui.svelte.ts:182` only — a JS read to pick the initial default | initial value only; **no CSS `@media (prefers-color-scheme)` rule exists anywhere** |
| `.theme-dark-context` class | `src/app.css:1119,1127-1143` — redefines 8 surface/text tokens locally | **0 usages in markup** |

Consequence: a page rendered before hydration has no `data-theme` and no media-query fallback, so the light palette is the pre-JS state in every case.

---

## 2. Type

### 2.1 Families — 3 defined, 9 spellings in use

`--font-display: 'Playfair Display', Georgia, serif` (`src/app.css:131`), `--font-body: 'Inter', …` (`:132`), `--font-mono: 'IBM Plex Mono', 'Courier New', monospace` (`:133`).

192 `font-family` declarations, 9 distinct spellings:

| Value | Count |
|---|---|
| `var(--font-mono)` | 71 |
| `var(--font-display)` | 41 |
| `var(--font-body)` | 39 |
| `inherit` | 21 |
| `var(--font-mono, monospace)` | 13 |
| `var(--font-mono, ui-monospace, monospace)` | 2 |
| `var(--font-body, sans-serif)` | 2 |
| `ui-monospace, monospace` (no token) | 2 |
| `var(--font-body, inherit)` | 1 |

Webfont loading: `src/routes/+layout.svelte:41-44` loads Inter 300-700, Playfair Display 400-800, IBM Plex Mono 400-600.

### 2.2 Sizes — a scale exists; 65 literals bypass it

Scale: `--text-xs` 0.65rem → `--text-hero` clamp(2.4rem, 5.5vw, 4.2rem), 9 steps (`src/app.css:136-144`).

**1027 `font-size` declarations. 76 distinct expressions; 10 are token references, 1 is `inherit`, 65 are hardcoded literals. 22% tokenized.**

Most-used values:

| Value | Count | | Value | Count |
|---|---|---|---|---|
| `var(--text-xs)` | 108 | | `0.68rem` | 25 |
| `var(--text-sm)` | 68 | | `0.74rem` | 22 |
| `0.85rem` | 68 | | `0.95rem` | 21 |
| `0.82rem` | 67 | | `0.88rem` | 20 |
| `0.72rem` | 66 | | `0.76rem` | 20 |
| `0.8rem` | 64 | | `0.65rem` | 18 |
| `0.78rem` | 59 | | `0.62rem` | 18 |
| `0.7rem` | 51 | | `0.66rem` | 16 |
| `0.75rem` | 50 | | `0.6rem` | 14 |
| `1rem` | 48 | | `10px` | 11 |
| `var(--text-base)` | 37 | | `11px` | 10 |
| `0.9rem` | 27 | | `9px` | 8 |

**21 distinct sizes live inside the 9.6px–14.4px band alone** (0.6, 0.62, 0.64, 0.65, 0.66, 0.68, 0.7, 0.72, 0.74, 0.75, 0.76, 0.78, 0.8, 0.82, 0.83, 0.84, 0.85, 0.86, 0.875, 0.88, 0.9 rem) — steps as small as 0.32px apart. Small UI text also appears in px (`9px`, `10px`, `11px`, `12px`, `13px`), mixing units for the same role.

9 responsive `clamp()` sizes exist, none of which is `--text-3xl` or `--text-hero`: `clamp(2.4rem,6vw,3.6rem)` `:336` in billing, `clamp(2.4rem,4.4vw,3.55rem)` `src/routes/+page.svelte:1028`, `clamp(2.1rem,9.5vw,2.6rem)` `:2055`, `clamp(1.9rem,4.5vw,3.1rem)` `:1921`, `clamp(1.8rem,3.5vw,2.6rem)` `src/routes/(portal)/dashboard/+page.svelte:293`, `clamp(1.75rem,3.6vw,2.6rem)` `src/routes/+page.svelte:1379`, `clamp(1.6rem,2.6vw,2.1rem)`, plus two container-query clamps.

### 2.3 Weights — 12 values, 5-step scale, 3 off-scale

526 declarations, 12 distinct values, **7% tokenized**:

| Value | Count |
|---|---|
| `600` | 257 |
| `700` | 203 |
| `500` | 35 |
| `var(--weight-semi)` (=600) | 29 |
| `800` | 15 |
| `400` | 8 |
| `var(--weight-bold)` (=700) | 5 |
| `var(--weight-semi, 600)` / `var(--weight-normal)` / `var(--weight-medium)` | 1 each |
| `900` | 1 |
| `650` | 1 |

`600` and `700` are each written as a literal ~8× more often than as their token. Off-scale weights:

- `900` — `src/routes/(portal)/dashboard/+page.svelte:235` `.step-num`, on `var(--font-mono)`; IBM Plex Mono is loaded at 400/500/600 only, so this synthesises.
- `650` — `src/lib/components/generation/GenerationComposer.svelte:3113` `.pane-head h4`, a non-multiple-of-100 weight on a static-weight family.
- `800` × 15 (e.g. `src/routes/(portal)/models/+page.svelte:1450` `.pill`, `src/routes/(portal)/favorites/+page.svelte:456,513`, `src/routes/(portal)/personas/[agentId]/+page.svelte:7928,8203,8771,8976`) — mostly on body text, where Inter is loaded only to 700.

### 2.4 Line height and letter spacing

Line height: 159 declarations, **20 distinct**, 14% tokenized. `1.5`×44, `var(--leading-snug)`×17, `1.4`×17, `1`×17, `1.45`×16, `1.6`×11, `1.55`×9, `1.2`×6, `1.35`×5, `1.7`×4, `1.65`×3, `1.25`×3, `1.3`×2, `1.12`/`1.1`/`1.08`×1. `1.35`, `1.6` and `1.7` duplicate `--leading-snug/normal/relaxed` as literals.

`line-height: 0` appears 4 times: `src/routes/(portal)/calendar/+page.svelte:2140`, `src/routes/(portal)/personas/[agentId]/+page.svelte:8420, 9566, 10040`.

Letter spacing: 130 declarations, **19 distinct**, 10% tokenized: `0.08em`×26, `0.06em`×18, `0.1em`×12, `var(--tracking-wider)`×11, `0.04em`×11, `0.05em`×10, `-0.02em`×7, `-0.01em`×7, `0.09em`×6, `normal`×5, `0`×5, `0.12em`×4, `0.03em`×3, `0.02em`×3, `0.07em`×2, `0.01em`×1, plus 3 token/inherit forms. The token scale has 5 steps; 14 literal values sit between and around them. `0.06em`, `0.1em`, `0.12em` are exact literal restatements of `--tracking-wide/-wider/-widest`.

### 2.5 Heading hierarchy per route

Global rules: `h1 = --text-hero` clamp(2.4rem,5.5vw,4.2rem) (`src/app.css:435`), `h2 = --text-3xl` clamp(1.9rem,3.5vw,2.6rem) (`:440`), `h3 = --text-xl` 1.5rem (`:444`), `h4 = --text-lg` 1.15rem (`:448`), all `--font-display` serif at weight 600 (`:423-433`).

Almost every route overrides `h1`, to **8 different sizes**:

| Route | `h1` rendered size | Rule |
|---|---|---|
| `/brand-brief` | `--text-3xl` = clamp(1.9,3.5vw,2.6rem) | `brand-brief/+page.svelte:2147` |
| `/brand-brief/intel` | `--text-3xl` | `brand-brief/intel/+page.svelte:1359` |
| `/generator` | `--text-3xl` | `generator/+page.svelte:1377` |
| `/settings` | `--text-3xl` | `settings/+page.svelte:2392` |
| `/admin` | `1.6rem` | `admin/+page.svelte:1170` |
| `/developer` | `1.6rem` | `developer/+page.svelte:487` |
| `/calendar` | `var(--text-xl)` = 1.5rem | `calendar/+page.svelte:1627` |
| `/favorites` | `1.5rem` (literal) | `favorites/+page.svelte:340` |
| `/generations` | `1.5rem` (literal) | `generations/+page.svelte:543` |
| `/models` | `1.5rem` (literal) | `models/+page.svelte:1080` |
| `/personas/[id]` | `1.5rem` (`.hero-name`) | `personas/[agentId]/+page.svelte:7979` |
| `/guides` | `1.45rem` | `guides/+page.svelte:1918` |
| `/review` | `1.4rem` | `review/+page.svelte:1454` |
| `/trash` | `1.35rem` | `trash/+page.svelte:310` |
| `/billing` | `clamp(2.4rem,6vw,3.6rem)` (`.amount`) | `billing/+page.svelte:336` |
| `/` (landing) | `clamp(2.4rem,4.4vw,3.55rem)` | `routes/+page.svelte:1028` |
| `/login`, `/signup`, `/invite/[token]` | **unset** → `--text-hero` clamp(2.4,5.5vw,4.2rem) | — |
| `/dashboard` | `h1` is `.sr-only` (`dashboard/+page.svelte:23`) — no visible h1 | — |

Range of the *visible* portal `h1`: **1.35rem → 2.6rem, a 1.9× spread**. Calendar and favorites render the same 1.5rem via two different spellings (token vs literal).

`h2` is overridden to **15 different sizes**, and its family flips between serif and sans:

| Route / scope | `h2` size | Family | Rule |
|---|---|---|---|
| `/dashboard` `.section-title` | clamp(1.8rem,3.5vw,2.6rem) | display (serif) | `dashboard/+page.svelte:293` |
| `/guides` `.gd-article h2` | `1.7rem` | inherited display | `guides/+page.svelte:2099` |
| `/brand-brief` `.panel h2` | `--text-xl` = 1.5rem | display | `brand-brief/+page.svelte:2345` |
| `/generator` `.panel-header h2` | `--text-xl` | display | `generator/+page.svelte:1480` |
| `/(portal) .pw-gate-card h2` | `1.25rem` | display | `+layout.svelte:1731` |
| `/developer` `.dev-card h2` | `1.15rem` | display | `developer/+page.svelte:526` |
| `/billing h2` | `1.15rem` | display | `billing/+page.svelte:368` |
| `/settings` `.card-header h2`, `.modal-header h2` | `--text-lg` = 1.15rem | display | `settings/+page.svelte:2534, 3440` |
| `/calendar` `.composer-header h2` | `--text-lg` | display | `calendar/+page.svelte:1836` |
| `/brand-brief/intel .section-title` | `1.1rem` | display | `intel/+page.svelte:2105` |
| `/admin` `.admin-card h2` | `1.05rem` | display | `admin/+page.svelte:1203` |
| `/favorites` `.fav-empty h2`, `/generations` `.gen-empty h2` | `1.05rem` | display | `favorites:650`, `generations:896` |
| `/models` `.mm-section-title` | `1.02rem` | **body (sans)** | `models/+page.svelte:1239` |
| `/calendar` `.modal-header h2` | `--text-md` = 1rem | display | `calendar/+page.svelte:1712` |
| `/personas` `.section-title`, `.feed-empty h2`; `/trash` `.trash-empty h2` | `1rem` | display | `personas:8575, 8421`; `trash:492` |

`.section-title` is defined in two route files with wildly different results: `clamp(1.8rem,3.5vw,2.6rem)` (`dashboard/+page.svelte:293`) vs `1rem` (`personas/[agentId]/+page.svelte:8575`) — **a 2.8× difference for the same class name and the same structural role.**

The hierarchy also inverts: `/dashboard`'s `h2` (up to 2.6rem) is larger than `/trash`'s `h1` (1.35rem) and larger than every other route's `h1` except the landing page.

Heading family is inconsistent by rule: the global rule makes every heading Playfair serif, but `models/+page.svelte:1239` (`h2`) and `generator/+page.svelte:1572` (`.profile-section-title`, 0.72rem weight 700) force `var(--font-body)`. Six route files never mention `--font-display` at all (`admin`, `billing`, `developer`, `guides`, `review`, `trash`).

---

## 3. Spacing

### 3.1 Scale defined vs used

Token scale: `--space-1` … `--space-24`, 12 steps on a 4px grid (`src/app.css:177-188`). There is **no `--space-7`**.

Across `padding` / `margin` / `gap` (all longhands): **2,639 atomic non-zero lengths**, of which **215 (8.1%) are token references** and **2,424 are literals**.

**71 distinct hardcoded spacing lengths: 52 `rem` values and 19 `px` values.**

`rem` values in use (value → occurrences):

`0.05`×3, `0.1`×24, `0.12`×1, `0.15`×22, `0.16`×1, `0.18`×2, `0.2`×39, `0.22`×1, `0.25`×88, `0.28`×4, `0.3`×52, `0.32`×5, `0.35`×113, `0.4`×141, `0.42`×7, `0.45`×56, `0.5`×286, `0.55`×42, `0.6`×172, `0.65`×23, `0.7`×52, `0.75`×162, `0.8`×42, `0.85`×35, `0.9`×81, `0.95`×4, `1`×196, `1.05`×2, `1.1`×22, `1.15`×2, `1.2`×15, `1.25`×95, `1.3`×9, `1.4`×13, `1.5`×104, `1.6`×6, `1.75`×13, `1.8`×1, `1.9`×2, `2`×46, `2.2`×1, `2.25`×2, `2.4`×1, `2.5`×9, `3`×8, `3.2`×1, `3.5`×4, `4`×5, `4.5`×1, `5`×2, `5.5`×1, `6`×1.

`px` values: `1`×19, `2`×68, `3`×13, `4`×57, `5`×12, `6`×56, `7`×18, `8`×64, `9`×4, `10`×34, `12`×24, `14`×14, `16`×10, `18`×3, `20`×1, `22`×1, `24`×1, `28`×2, `52`×3.

### 3.2 Grid conformance

Against a 4px (0.25rem) grid: **17 of 52 `rem` values and 8 of 19 `px` values are on-grid. 46 of 71 distinct spacing values (65%) are off the 4pt grid.**

The densest off-grid cluster is the 5.6px–9.6px band, where **eight** distinct values coexist: `0.35rem` (113 uses), `0.4rem` (141), `0.42rem` (7), `0.45rem` (56), `0.5rem` (286), `0.55rem` (42), `0.6rem` (172), plus `6px` (56) and `7px` (18). The token scale offers exactly two steps there (`--space-1` 4px, `--space-2` 8px).

Token usage is concentrated in a handful of steps: `--space-4`×47, `--space-2`×36, `--space-3`×34, `--space-5`×31, `--space-6`×24, `--space-8`×23, `--space-1`×13, `--space-16`×4, `--space-10`×1, `--space-12`×1. `--space-20` and `--space-24` are never used.

**Broken reference:** `src/routes/(portal)/models/+page.svelte:1264` → `margin-bottom: var(--space-7)`. `--space-7` is not defined anywhere, so the declaration is invalid at computed-value time and the margin collapses to 0.

### 3.3 Card-surface interior padding

Restricting to rules whose selector ends in `.*card` or `.*panel` **and** that paint a background or border **and** declare padding: 53 such surfaces, **29 distinct paddings**.

| Padding | Count | Example |
|---|---|---|
| `1.5rem` | 5 | `.stats-card-container` `agents/AgentConnectionStats.svelte:215` |
| `1rem` | 5 | `.competitor-card` `brand-brief/+page.svelte:2667` |
| `1.75rem 1.75rem 1.5rem` | 4 | `.analytics-panel` `dashboard/AnalyticsPanel.svelte:261` |
| `0.75rem` | 4 | `.ai-panel` `generation/ActivityIndicator.svelte:129` |
| `2rem` | 3 | `.step-card` `brand-brief/intel/+page.svelte:1527` |
| `0` | 3 | `.modal-post-card` `calendar/CalendarView.svelte:2006` |
| `1.75rem` | 2 | `.pw-gate-card` `(portal)/+layout.svelte:1720` |
| `1.25rem` | 2 | `.review-item` `brand-brief/intel/+page.svelte:1887` |
| `1.25rem 1.4rem` | 1 | `.admin-card` `admin/+page.svelte:1196` |
| `1.4rem 1.5rem` | 1 | `.confirm-card` `personas/[agentId]/+page.svelte:7798` |
| `1.5rem 2rem` | 1 | `.results-header-card` `brand-brief/intel/+page.svelte:2025` |
| `1rem 1.25rem` | 1 | `.plat-card` `brand-brief/intel/+page.svelte:2273` |
| `16px 24px` | 1 | `.magical-toast-card` `shared/BrandWave.svelte:208` |
| `0.8rem 0.9rem` | 1 | `.home-card` `guides/+page.svelte:3019` |
| `0.7rem 0.8rem` | 1 | `.vp-card` `personas/ViewerPanel.svelte:149` |
| `0.65rem 0.8rem` | 1 | `.stepcard` `generation/GenerationComposer.svelte:2270` |
| `0.55rem` | 1 | `.lane-card` `review/+page.svelte:2561` |
| `0.42rem 0.75rem 0.42rem 0.6rem` | 1 | `.lp-card-tag` `routes/+page.svelte:1135` |
| `var(--space-4)` | 1 | `.rm-card` `guides/+page.svelte:2721` |
| `var(--space-3)` | 1 | `.uv-card` `guides/+page.svelte:2836` |
| …9 more, 1 use each | 9 | — |

The global `.glass-card` primitive (`src/app.css:789`) pads at `1.75rem` — a 21st distinct value, used 6 times in markup.

### 3.4 Gaps

815 `gap`/`row-gap`/`column-gap` declarations, **60 distinct values**; only 68 (8%) reference `--space-*`. `0.5rem`×133, `0.4rem`×81, `0.75rem`×74, `1rem`×69, `0.6rem`×52, `0.35rem`×45, `0.25rem`×33, `8px`×23, `6px`×22, `4px`×22, `1.25rem`×20, `var(--space-4)`×18, `0.3rem`×18, `var(--space-3)`×14, `2px`×14, `0.55rem`×14, `0.45rem`×13, `var(--space-2)`×12, then 42 more. `var(--space-3)` (0.75rem) and the literal `0.75rem` both appear, at 14 and 74 uses respectively.

---

## 4. Radius, borders, elevation

### 4.1 Border radius — 20 computed values, 40 spellings

745 `border-radius` declarations. Token scale has 7 steps (`src/app.css:168-174`): xs 6, sm 10, md 14, base 16, lg 20, xl 28, full 9999.

| Computed | Occurrences | Reached via |
|---|---|---|
| `2px` | 11 | literal |
| `3px` | 2 | literal |
| `4px` | 16 | literal |
| `5px` | 6 | literal |
| `6px` | 100 | `var(--radius-xs)` ×70, literal `6px` ×37 |
| `7px` | 15 | literal |
| `8px` | 78 | literal only |
| `9px` | 14 | literal |
| `10px` | 167 | `var(--radius-sm)` ×119, literal `10px` ×48 |
| `12px` | 24 | literal |
| `13px` | 1 | literal |
| `14px` | 41 | `var(--radius-md)` ×23, literal `14px` ×6, plus `.btn-primary`/`.btn-ghost` at `12px` (`src/app.css:528, 575`) |
| `16px` | 30 | `var(--radius)` ×29, literal `16px` ×1 |
| `18px` | 4 | literal |
| `20px` | 13 | `var(--radius-lg)` ×7, literal `20px` ×6 |
| `22px` | 2 | literal |
| `28px` | 1 | literal (`--radius-xl` itself is never referenced) |
| `50%` | 78 | literal |
| `999px` | 96 | literal |
| `9999px` | 46 | `var(--radius-full)` |

Pill shape has **three** spellings in parallel — `var(--radius-full)` (9999px, 46 uses), literal `999px` (90 uses), `var(--radius-full, 999px)` (6 uses) — and circles a fourth (`50%`, 78 uses).

**Token fallbacks that contradict the token** (all unreachable, all misleading to a reader):

| Written | Token's actual value | Sites |
|---|---|---|
| `var(--radius-md, 12px)` | 14px | `docs/DocsDemo.svelte:31`, `docs/ShotFigure.svelte:73`, `guides/+page.svelte:2978, 3026, 3065` |
| `var(--radius-md, 14px)` | 14px | 2 sites (correct) |
| `var(--radius-md, 10px)` | 14px | 1 site |
| `var(--radius-sm, 8px)` | 10px | `dashboard/AnalyticsChart.svelte:432` |
| `var(--radius-sm, 10px)` | 10px | 3 sites (correct) |
| `var(--radius, 12px)` | 16px | `ui/ImageLightbox.svelte:141` |
| `var(--radius-full, 999px)` | 9999px | `personas/LifeDetails.svelte:178,196`, `personas/ViewerPanel.svelte:173,205`, `guides/+page.svelte:2377`, +1 |

Card surfaces alone carry **13 distinct radius spellings** across 7 visual radii (§3.3 corpus).

### 4.2 Borders

732 shorthand `border*` declarations, **96 distinct**, 90% token-referencing. This is the most consistent axis in the system: `1px solid var(--border)` ×360 and `1px solid var(--border-strong)` ×66 account for 58% of all borders.

Widths: **5 distinct** — `1px` ×557, `2px` ×31, `3px` ×16, `1.5px` ×5 (`src/routes/(portal)/...` toolbar/segment controls), `2.5px` ×1.

Styles: `solid` dominant, `dashed` ×21 (12 with `--border`, 9 with `--border-strong`).

### 4.3 Elevation

127 `box-shadow` declarations, **80 distinct values**. Only **30 (24%) use a `--shadow-*` token**; 3 more compose a token with a bespoke layer (`calendar/+page.svelte:1697, 1787, 1796`).

Token shadows (`src/app.css:208-213`): `--shadow-sm/md/lg/accent/cyan/glow`. `--shadow-cyan` and `--shadow-glow` are **never referenced**.

Token usage: `--shadow-accent` ×11, `--shadow-md` ×7, `--shadow-lg` ×6, `--shadow-sm` ×6.

The 77 bespoke shadows include **18 different "large dialog / floating panel" shadows**, e.g.:

| Value | Site |
|---|---|
| `0 24px 70px rgba(15,18,32,0.32)` | `ui/Modal.svelte:96` |
| `0 20px 25px -5px rgba(0,0,0,0.35), 0 0 50px color-mix(…--tone 14%…)` | `ui/ConfirmDialog.svelte:185` |
| `0 20px 25px -5px rgba(0,0,0,0.3), 0 0 50px color-mix(…--accent 15%…)` | `feed/ManualDeleteNotice.svelte:100` |
| `var(--shadow-lg), 0 20px 25px -5px rgba(0,0,0,0.3)` | `calendar/CalendarView.svelte:1932` |
| `0 20px 60px rgba(0,0,0,0.25)` | `(portal)/+layout.svelte:1730` |
| `0 20px 60px rgba(0,0,0,0.3)` | `personas/[agentId]/+page.svelte:7806` |
| `0 20px 60px rgba(0,0,0,0.4)` | `personas/[agentId]/+page.svelte:9120` |
| `0 8px 32px rgba(0,0,0,0.24)` | `dashboard/+page.svelte:183` |
| `0 8px 32px rgba(0,0,0,0.15)` | `agents/AgentConnectionStats.svelte:224` |
| `0 16px 44px rgba(15,18,32,0.2)` | `generation/ActivityIndicator.svelte:135` |
| `0 10px 30px rgba(0,0,0,0.4)` | `admin/+page.svelte:1388` |

Focus rings, by contrast, are the single most consistent primitive in the codebase: 75 `outline` declarations, **6 distinct**, with `2px solid var(--accent)` at 50 uses and `none` at 17 (the remaining 8 are deliberate error/tone variants).

`backdrop-filter`: 37 declarations, **9 distinct** — `blur(4px)`×14, `blur(8px)`×7, `blur(12px)`×4, `blur(6px)`×4, `blur(2px)`×3, `blur(16px) saturate(180%)`×2, `blur(3px)`, `blur(20px) saturate(180%)`, `blur(14px) saturate(140%)`.

---

## 5. Motion

292 `transition`/`animation` declarations. **17 (5.8%) reference an `--ease-*` token.**

### 5.1 Durations — 29 distinct

| ms | Count | | ms | Count |
|---|---|---|---|---|
| 0 | 2 | | 700 | 2 |
| 140 | 1 | | 800 | 10 |
| **150** | **160** | | 900 | 1 |
| 160 | 1 | | 1000 | 1 |
| 180 | 16 | | 1200 | 1 |
| **200** | **155** | | 1500 | 3 |
| 250 | 11 | | 1800 | 1 |
| 280 | 2 | | 2000 | 5 |
| 300 | 22 | | 4000 | 1 |
| 350 | 1 | | 7000/8000/9000 | 1 each |
| 400 | 2 | | 18000 | 2 |
| 500 | 1 | | 20000 | 2 |
| 550 | 2 | | 25000 | 2 |
| 600 | 4 | | | |

`--ease-fast` is `0.15s ease` and `--ease-std` is `0.3s ease` (`src/app.css:218-219`), yet `0.15s` appears as a literal 160 times and `0.3s` 22 times, while `--ease-fast` is referenced 3 times and `--ease-std` **never**. `--ease-slow` (`0.5s ease`) is also never referenced.

### 5.2 Easings — 13 distinct, 7 distinct curves

| Easing | Count |
|---|---|
| `ease` | 188 |
| `ease-out` | 23 |
| `linear` | 18 |
| `var(--ease-out)` | 18 |
| `ease-in-out` | 13 |
| `cubic-bezier(0.16, 1, 0.3, 1)` — **identical to `--ease-out`, retyped** | 10 |
| `var(--ease-fast)` | 3 |
| `cubic-bezier(0.4, 0, 0.2, 1)` | 2 |
| `cubic-bezier(0.22, 1, 0.36, 1)` | 2 |
| `cubic-bezier(0.1, 0.8, 0.15, 1)` | 2 |
| `cubic-bezier(0.25, 1, 0.5, 1)` | 1 |
| `cubic-bezier(0.19, 1, 0.22, 1)` | 1 |
| `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot) | 1 |

Most-used transition shorthands: `all 0.15s ease` ×15, `all 0.2s ease` ×9, `background 0.15s ease, color 0.15s ease` ×7. 111 distinct `transition` shorthand strings in total; `transition: all …` is used 24+ times, which animates every animatable property including layout.

### 5.3 `prefers-reduced-motion`

**Honoured.** A global reset lives at `src/app.css:1196-1205` (`animation-duration: 0.01ms !important`, `transition-duration: 0.01ms !important`, `scroll-behavior: auto !important` on `*`, `*::before`, `*::after`).

20 additional component-level blocks opt specific effects out:

`agents/AgentConnectionStats.svelte:377, 541` · `agents/AgentRoster.svelte:715` · `agents/StatusBadge.svelte:72` · `dashboard/AnalyticsPanel.svelte:441` · `dashboard/PlatformBars.svelte:118` · `ui/ConfirmDialog.svelte:198` · `ui/Modal.svelte:241` · `(auth)/login/+page.svelte:369, 548` · `(auth)/signup/+page.svelte:688, 858, 960` · `guides/+page.svelte:2516, 3125` · `personas/[agentId]/+page.svelte:7546` · `review/+page.svelte:2512` · `settings/+page.svelte:3176` · `routes/+page.svelte:2136`. One JS guard at `routes/+page.svelte:39` (`matchMedia('(prefers-reduced-motion: reduce)')`).

`src/app.css:1213-1239` also handles `@media (forced-colors: active)` for 9 primitives.

---

## 6. Where tokens live

**Single token file: `src/app.css`** (1240 lines), imported once at `src/routes/+layout.svelte:2`. It defines **128 custom properties** and also carries ~30 global component classes (buttons, badges, glass cards, toasts, inputs, utilities).

| Metric | Value |
|---|---|
| Tokens defined in `app.css` | 128 |
| Distinct tokens referenced anywhere | 125 |
| Total `var(--…)` references | 4,648 |
| Component-scoped custom properties defined outside `app.css` | 10 |
| **Tokens defined but never referenced** | **26** |
| Tokens referenced but never defined | 13 (12 are inline-style-driven dynamic props; 1 is a bug) |

**Dead tokens (26):** `--gold-soft`, `--gradient-full`, `--leading-loose`, `--tracking-normal`, `--tracking-widest`, `--weight-light`, `--radius-xl`, `--space-20`, `--space-24`, `--container-sm`, `--container-md`, `--container-lg`, `--container-xl`, `--container-2xl`, `--gap-sm`, `--gap-md`, `--gap-lg`, `--gap-xl`, `--section-py`, `--section-py-sm`, `--shadow-cyan`, `--shadow-glow`, `--ease-std`, `--ease-slow`, `--z-base`, `--z-ambient`.

Note: **every layout token is dead** — all 5 `--container-*`, all 4 `--gap-*`, both `--section-py*` (11 tokens, 0 consumers). The layout layer of the design system does not exist in practice.

**Undefined references (13):** `--bar-pct`, `--plat-color`, `--perf-pct`, `--stat-color`, `--platform-pct`, `--kpi-color`, `--plat-pct`, `--p-color`, `--mark-tint`, `--reveal-delay`, `--hue`, `--i` (all set via inline `style=` from markup — legitimate) and **`--space-7`** (`models/+page.svelte:1264` — a real dead declaration).

### Tokenization ratio by property group

Over all 15,604 component-style declarations, counting a declaration as "tokenized" if its value references any `var(--…)`, and excluding trivial values (`0`, `none`, `auto`, `inherit`, `transparent`, `normal`):

| Group | Declarations | Token | Hardcoded | Tokenized |
|---|---|---|---|---|
| `font-family` | 192 | 169 | 2 | **99%** |
| colour (`color`/`background*`/`border-color`/`fill`/`stroke`) | 2,735 | 2,329 | 261 | **90%** |
| `border` shorthand | 693 | 523 | 58 | **90%** |
| `box-shadow` | 127 | 89¹ | 34 | 72%¹ (24% use a shadow token) |
| `border-radius` | 721 | 286 | 434 | **40%** |
| `font-size` | 1,027 | 229 | 797 | **22%** |
| `line-height` | 159 | 21 | 133 | **14%** |
| `letter-spacing` | 130 | 12 | 107 | **10%** |
| spacing (`padding`/`margin`/`gap`) | 2,235 | 181 | 1,790 | **9%** |
| `transition`/`animation` | 292 | 18 | 254 | **7%** |
| `font-weight` | 526 | 35 | 491 | **7%** |

¹ counts any `var()` inside the shadow, including colour tokens in bespoke shadows.

The system is effectively **a colour system only**. Colour, family and border are 90%+ tokenized; every *shape, rhythm and motion* axis is 7–40%.

### Per-file tokenization (files with ≥20 colour+spacing+type declarations, 46 files)

Worst 10 and best 5:

| File | token refs | hardcoded | tokenized |
|---|---|---|---|
| `lib/components/feed/PostCard.svelte` | 36 | 72 | 33% |
| `routes/(portal)/admin/+page.svelte` | 20 | 38 | 34% |
| `lib/components/dashboard/AnalyticsChart.svelte` | 12 | 13 | 48% |
| `lib/components/ui/Modal.svelte` | 12 | 13 | 48% |
| `routes/(portal)/dashboard/+page.svelte` | 35 | 38 | 48% |
| `lib/components/agents/AgentConnectionStats.svelte` | 43 | 41 | 51% |
| `lib/components/dashboard/AnalyticsPanel.svelte` | 25 | 22 | 53% |
| `lib/components/dashboard/SparkChart.svelte` | 13 | 11 | 54% |
| `routes/+page.svelte` | 149 | 129 | 54% |
| `lib/components/dashboard/PlatformBars.svelte` | 11 | 9 | 55% |
| … | | | |
| `routes/(portal)/guides/+page.svelte` | 318 | 56 | 85% |
| `lib/components/shared/Toast.svelte` | 20 | 3 | 87% |
| `lib/components/persona/TraitPicker.svelte` | 20 | 2 | 91% |
| `lib/components/docs/PostLifecycle.svelte` | 32 | 2 | 94% |
| **Overall** | **3,519** | **1,693** | **68%** |

`ui/Modal.svelte` — the app's own modal primitive — is in the worst five.

### Adoption of the global classes defined in `app.css`

| Global class | Defined at | Uses in markup |
|---|---|---|
| `.btn` | `src/app.css:1070` | 313 |
| `.btn-ghost` | `src/app.css:568` | 17 |
| `.btn-primary` | `src/app.css:521` | 15 |
| `.btn-sm` | `src/app.css:695` | 11 |
| `.btn-danger` | `src/app.css:646` | 3 |
| `.btn-lg` | `src/app.css:690` | 2 |
| `.btn-secondary` | `src/app.css:612` | **0** |
| `.btn-full` | `src/app.css:686` | **0** |
| `.badge-primitive` | `src/app.css:1146` | **0** |
| `.badge-accent` / `-success` / `-warning` / `-error` / `-neutral` | `src/app.css:1162-1190` | **0 each** |
| `.glass-card` | `src/app.css:785` | 6 |
| `.glass-panel` | `src/app.css:1103` | 1 |
| `.input-field` | `src/app.css:1038` | 8 |
| `.grad-text` / `.grad-text-warm` | `src/app.css:496, 503` | **0** |
| `.text-accent` | `src/app.css:968` | **0** |
| `.truncate` | `src/app.css:1010` | **0** |
| `.theme-dark-context` | `src/app.css:1119` | **0** |
| `.sr-only` | `src/app.css:948` | 60 |
| `.tabular-nums` | `src/app.css:982` | 11 |

**14 of the 25 global utility/primitive classes have zero markup usage** — roughly 120 lines of `app.css` (the whole badge system, the gradient-text utilities, two button variants, the dark-context class, the truncate helper) are never reached.

---

## 7. Component duplication — "one component per job"

### 7.1 Shared primitives and their actual reach

| Primitive | File | Imported by |
|---|---|---|
| `Button` | `src/lib/components/ui/Button.svelte` (70 ln) | **3** files — `(auth)/login`, `(auth)/signup`, `invite/[token]` |
| `Card` | `src/lib/components/ui/Card.svelte` (96 ln) | **3** files — same three |
| `Input` | `src/lib/components/ui/Input.svelte` (136 ln) | **0** files — dead component |
| `Modal` | `src/lib/components/ui/Modal.svelte` (246 ln) | 4 files (`CampaignPlanner`, `GenerationComposer`, `MediaPreviewModal`, `PersonaProjectsModal`) |
| `ConfirmDialog` | `src/lib/components/ui/ConfirmDialog.svelte` (420 ln) | 1 file (`(portal)/+layout.svelte`) |
| `ImageLightbox` | `src/lib/components/ui/ImageLightbox.svelte` (208 ln) | 8 files |
| `SelectionToolbar` | `src/lib/components/ui/SelectionToolbar.svelte` (140 ln) | 5 files |
| `StatusBadge` | `src/lib/components/agents/StatusBadge.svelte` (94 ln) | 1 file |

**The three files that use `Button` and `Card` are exactly the three routes outside the portal.** No portal route imports either. The 16 portal routes hand-roll buttons and cards.

### 7.2 Buttons — 1 component, 8 global classes, 128 class names

**128 distinct button-role class names** are defined across component `<style>` blocks. Four families coexist for the same job:

1. `ui/Button.svelte` (3 route files)
2. Global `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-lg`, `.btn-full` (`src/app.css:521-698, 1070`)
3. Per-page re-declarations of the *same names*: `.btn-primary` is re-styled in **15 places** and `.btn-ghost` in **13** (e.g. `calendar/CalendarView.svelte:2105, 2126`, `generation/GenerationComposer.svelte:2771`), so the global variant's appearance is not stable across routes.
4. 120 bespoke names: `.action-btn`, `.close-btn`, `.delete-btn`, `.edit-btn`, `.save-btn`, `.cancel-btn`, `.done-btn`, `.mini-btn`, `.row-btn`, `.pager-btn`, `.nav-btn`, `.view-btn`, `.filter-btn`, `.seg-btn`, `.tab-btn`, `.sel-btn`, `.lp-btn`, `.lp-btn-ghost`, `.lp-btn-invert`, `.lp-btn-lg`, `.lp-btn-sm`, `.mm-edit-btn`, `.mm-probe-btn`, `.mm-swap-btn`, `.mm-sync-btn`, …

Semantically identical pairs under different names:

| Job | Implementations |
|---|---|
| Destructive | `.btn-danger` (`app.css:646`), `.btn-danger` again (`personas/[agentId]/+page.svelte:9375`), `.btn-danger-ghost` (`:9252`), `.btn-delete` (`review/+page.svelte:1597`), `.delete-btn`, `.btn-drawer-delete` (`feed/PostDrawer.svelte:2158`), `.confirm-delete-btn`, `.btn-purge` (`trash/+page.svelte:450`), `.danger-inline-btn`, `.kit-del-btn` |
| Cancel / dismiss | `.btn-cancel` (`ui/ConfirmDialog.svelte:391`), `.btn-cancel` again (`personas/[agentId]:7824`), `.cancel-btn`, `.close-btn`, `.btn-drawer-close` (`PostDrawer:2204`), `.drawer-close`, `.modal-close`, `.modal-x`, `.btn-notice-dismiss` (`feed/ManualDeleteNotice.svelte:232`), `.overlay-dismiss` |
| Approve | `.btn-approve` (`review/+page.svelte:1893`), `.btn-drawer-approve` (`PostDrawer:2187`), `.lp-chip-approve` |
| Small/compact | `.btn-sm` (`app.css:695`), `.btn-sm` again (`CalendarView:2137`), `.btn-xs` (`personas/[agentId]:9175`), `.mini-btn`, `.lp-btn-sm` |

### 7.3 Chips / pills / badges / tags — 117 class names, 4 vocabularies

Four words are used for one visual role. Sampling the 26 rules whose class name is exactly one of `chip`/`pill`/`badge`/`tag` or a `*-badge`/`*-pill`/`*-chip`/`*-tag`:

- **14 distinct font sizes** for one role: `9px`, `10px`, `11px`, `0.6rem`, `0.62rem`, `0.65rem`, `0.7rem`, `0.72rem`, `0.74rem`, `0.75rem`, `0.8rem`, `0.82rem`, `0.88rem`, `var(--text-xs)`.
- **18 distinct paddings**: `1px 5px`, `1px 7px`, `2px 6px`, `2px 8px`, `4px 10px`, `4px 14px`, `6px 12px`, `10px 18px`, `0.1rem 0.42rem`, `0.15rem 0.6rem`, `0.2rem 0.5rem`, `0.2rem 0.55rem`, `0.25rem 0.55rem`, `0.3rem 0.85rem`, `0.32rem 0.8rem`, `0.4rem 0.75rem`, `0.5rem 1rem`, and `4px 8px` (the unused `.badge-primitive`).
- **7 radius spellings** across 5 shapes: `4px`, `6px`, `10px`, `999px`, `var(--radius-full)`, `var(--radius-xs)`, `var(--radius-sm)`.

Near-duplicate pairs with no visible design intent between them:

| Pair | Difference |
|---|---|
| `.chip` `generation/GenerationComposer.svelte:2559` vs `.chip` `persona/TraitPicker.svelte:207` | padding `0.3rem 0.85rem` vs `0.32rem 0.8rem`; font-size `0.8rem` vs `0.82rem`; otherwise identical |
| `.platform-badge` `feed/ManualDeleteNotice.svelte:194` vs `calendar/+page.svelte:1756` | identical computed values, one spelled in literals (`0.65rem`, `6px`), one in tokens (`var(--text-xs)`, `var(--radius-xs)`) |
| `.status-badge` `calendar/CalendarView.svelte:1892` vs `review/+page.svelte:1541` | radius `4px` + `1px solid currentColor` vs radius `999px`, no border; font `0.65rem` vs `0.62rem` |
| `.stat-chip` `calendar/CalendarView.svelte:1131` vs `personas/[agentId]/+page.svelte:8070` | pill (`999px`, pad `0.4rem 0.75rem`) vs rounded rect (`10px`, pad `0.5rem 1rem`) |
| `.badge` `generation/MediaPreviewModal.svelte:109` vs `billing/+page.svelte:403` | outline chip (`--border`, `--muted`) vs solid accent fill on white |

### 7.4 Modals / overlays — 13 implementations, 8 scrims, 4 blurs

| Component | Scrim | Blur | Padding | z-index | Site |
|---|---|---|---|---|---|
| `ui/Modal.svelte` | `rgba(15,18,32,0.62)` | 4px | 1.25rem | `--z-modal` | `:79` |
| `ui/ConfirmDialog.svelte` | `rgba(15,23,42,0.75)` | 8px | 1.5rem | `--z-overlay` | `:154` |
| `ui/ImageLightbox.svelte` | `rgba(10,14,26,0.88)` | 6px | 1.5rem | `--z-lightbox` | `:124` |
| `calendar/CalendarView.svelte` `.modal-backdrop` | `rgba(15,23,42,0.75)` | 8px | 1.5rem | `--z-modal` | `:1908` |
| `feed/ManualDeleteNotice.svelte` `.modal-backdrop` | `rgba(15,23,42,0.75)` | 8px | 1.5rem | `--z-modal` | `:74` |
| `feed/PostDrawer.svelte` `.drawer-backdrop` | `rgba(15,23,42,0.55)` | 4px | — | `--z-drawer` | `:1489` |
| `feed/PostDrawer.svelte` `.refine-overlay` | `rgba(10,14,24,0.78)` | 3px | 1rem | `2` | `:1741` |
| `calendar/+page.svelte` `.modal-backdrop` | `rgba(15,23,42,0.75)` | 8px | 1.5rem | `--z-modal` | `:1654` |
| `calendar/+page.svelte` `.composer-overlay` | `rgba(0,0,0,0.6)` | 4px | 1rem | `--z-modal` | `:1799` |
| `brand-brief/+page.svelte` `.lightbox-backdrop` | `rgba(10,14,26,0.88)` | 6px | 1.5rem | `--z-lightbox` | `:1882` |
| `personas/[agentId]/+page.svelte` `.lightbox-backdrop` | `rgba(10,14,26,0.88)` | 6px | 1.5rem | **`--z-modal`** | `:7786` |
| `personas/[agentId]/+page.svelte` `.gen-confirm-overlay` | `rgba(0,0,0,0.55)` | — | 1rem | `--z-modal` | `:9102` |
| `generator/+page.svelte` `.modal-overlay` | `rgba(0,0,0,0.4)` | 8px | 1rem | `--z-overlay` | `:1841` |
| `settings/+page.svelte` `.modal-overlay` | `rgba(0,0,0,0.6)` | 4px | 1rem | `--z-modal` | `:3373` |
| `(portal)/+layout.svelte` `.sidebar-overlay` | `rgba(0,0,0,0.6)` | 4px | — | `calc(--z-drawer - 1)` | `:1108` |

**8 distinct scrim colours, 4 distinct blur radii, 4 distinct padding values, 6 distinct stacking layers** for one job. The two `.lightbox-backdrop` implementations are byte-identical in colour/blur/padding but sit on different z-layers.

Modal *content* shells are equally split: `.modal` / `.day-modal` / `.confirm-modal` / `.confirm-card` / `.notice-modal` / `.restore-modal` / `.editor-modal` / `.pubfb-modal` / `.lb-content` / `.post-drawer` — 10 names, radius `var(--radius)` in 4 and bespoke elsewhere.

### 7.5 Empty states — 39 class names, no component

18 base implementations. **15 distinct paddings**, colour split three ways, border present in only 3:

| Class | Padding | Border | Colour | Site |
|---|---|---|---|---|
| `.dash-empty` | `2rem` | — | `--text-dim` | `agents/AgentRoster.svelte:905` |
| `.day-empty` | `2.5rem 1rem` | `1px dashed var(--border)` | `--text-dim` | `calendar/CalendarView.svelte:1879` |
| `.panel-empty` | `1.5rem 0` | — | `--text-dim` | `calendar/CalendarView.svelte:1989` |
| `.mobile-list-empty` | `1.5rem 0` | — | `--text-dim` | `calendar/CalendarView.svelte:2207` |
| `.chart-empty` | `2.25rem 1.5rem` | — | `--text-dim` | `dashboard/AnalyticsChart.svelte:392` |
| `.chart-empty` (again) | `2.5rem 1.5rem` | — | `--text-dim` | `dashboard/+page.svelte:411` |
| `.panel-empty` (again) | `2.5rem 1.5rem` | — | `--text-dim` | `dashboard/AnalyticsPanel.svelte:454` |
| `.plat-empty` | `1.75rem 1rem` | — | `--text-dim` | `dashboard/PlatformBars.svelte:132` |
| `.spark-empty` | `2.25rem 1rem` | — | `--text-dim` | `dashboard/SparkChart.svelte:265` |
| `.empty` | `2rem 0` | — | `--muted` | `generation/MediaPreviewModal.svelte:143` |
| `.proj-empty` | — | — | `--text-dim` | `shared/PersonaProjectsModal.svelte:369` |
| `.empty-state` | `2.5rem 1rem` | — | `--text-dim` | `brand-brief/+page.svelte:2754` |
| `.products-empty` | `3.5rem 1.5rem` | `1px dashed var(--border-strong)` | `--text-dim` | `brand-brief/+page.svelte:3087` |
| `.manage-empty` | `1.25rem 0` | — | `--text-dim` | `calendar/+page.svelte:2269` |
| `.fav-empty` | `var(--space-8) var(--space-4)` | `1px dashed var(--border)` | `--text-muted` | `favorites/+page.svelte:632` |
| `.gen-empty` | `var(--space-8) var(--space-4)` | `1px dashed var(--border)` | `--text-muted` | `generations/+page.svelte:878` |
| `.index-empty` | — | — | `--text-dim` | `guides/+page.svelte:2074` |
| `.trash-empty` | (heading only, 1rem/600) | — | — | `trash/+page.svelte:492` |

`.chart-empty` and `.panel-empty` are each defined twice with different paddings. `.fav-empty` / `.gen-empty` are byte-identical — a clean copy-paste of the same block into two routes.

### 7.6 Toolbars — 8 implementations

| Class | `gap` | `margin-bottom` | Site |
|---|---|---|---|
| `.cal-toolbar` | `1rem` | `0.9rem` | `calendar/CalendarView.svelte:907` |
| `.sel-toolbar` | `0.75rem` | `0.9rem` | `ui/SelectionToolbar.svelte:69` |
| `.products-toolbar` | `0.75rem` | `0.9rem` | `brand-brief/+page.svelte:1947` |
| `.gen-toolbar` | `var(--space-3)` (0.75rem) | `var(--space-5)` (1.25rem) | `generations/+page.svelte:614` |
| `.mm-toolbar` | `var(--space-3)` | `var(--space-5)` | `models/+page.svelte:1158` |
| `.modal-toolbar` | `1rem` | `1.25rem` | `generator/+page.svelte:1918` |
| `.feed-toolbar` | `1rem` | `1.25rem` | `personas/[agentId]/+page.svelte:8269` |
| `.persona-picker-toolbar` | `0.75rem` | `0.6rem` | `settings/+page.svelte:2935` |

`0.75rem` appears in both token and literal spelling; `1.25rem` likewise. Only `.sel-toolbar` paints a surface (bg + border + radius); the other seven are bare flex rows.

### 7.7 Directory-level duplication

`src/lib/components/persona/` (1 file: `TraitPicker.svelte`) and `src/lib/components/personas/` (3 files: `LifeDetails`, `StaleNotices`, `ViewerPanel`) are two sibling directories for the same domain.

---

## 8. Page skeleton consistency

Route group chrome:
- `src/routes/+layout.svelte` — fonts, `<Toast />`, `<ActivityIndicator />`, no visual shell.
- `src/routes/(portal)/+layout.svelte` — `<aside class="sidebar">` (`:219`), `<nav class="sidebar-nav">` (`:276`), `<header class="portal-header">` height `var(--header-height)` 60px (`:861`), `<main class="portal-content">` with `padding: var(--space-8)` = 2rem (`:1635`); 1rem at ≤768px (`:1821`), 1.5rem at 769–1024px (`:1841`).
- `src/routes/(auth)/+layout.svelte` — bare `<main>`, no nav, no header.
- `src/routes/+page.svelte` — its own `<header class="lp-nav">` (`:317`) + `<nav class="lp-nav-links">` (`:326`).

`.portal-header` always renders a page title (`portal-header-title`, `(portal)/+layout.svelte:884-901`), and 15 of 16 portal routes *also* render their own `<h1>` with substantially the same text — so the page name appears twice, at two different sizes and two different families.

### Route table

Gutter = `.portal-content` 2rem + the page shell's own padding.

| Route | Shell class | Max width | Own padding | **Effective gutter** | Header block | Header→body gap | Nav |
|---|---|---|---|---|---|---|---|
| `/` | `.lp-*` | `var(--lp-max)` = 74rem (`+page.svelte:712`) | section-local | n/a | `.lp-hero` `:338` | — | own `.lp-nav` `:317` |
| `/login` | `.login-container` `:383` | **420px** | — | n/a | bare `<h1>` `:103` | — | none |
| `/signup` | `.signup-container` `:702` | **420px** | — | n/a | bare `<h1>` `:190` | — | none |
| `/invite/[token]` | `.login-container` `:175` | **440px** | — | n/a | 4 branch `<h1>`s `:74-80` | — | none |
| `/admin` | `.admin-page` `:1162` | **1100px** | `var(--space-6)` 1.5rem | **3.5rem** | `.admin-head` (no margin rule) | — | portal |
| `/billing` | `.billing` `:291` | **1040px** | `1.5rem 1.25rem 4rem` | **3.25rem** | `.hero` `:320` (pad 2rem) | — | portal |
| `/brand-brief` | `.page` `:1877` | **960px** | `2rem` | **4rem** | `.page-header` `:2136` | 1.5rem | portal |
| `/brand-brief/intel` | `.page` `:1343` | **960px** | `2rem` | **4rem** | `.page-header` `:1348` | 1.5rem | portal |
| `/calendar` | `.page` `:1608` | **1400px** | `2rem` | **4rem** | `.page-header` `:1617` | 1.5rem | portal |
| `/dashboard` | (none) | **none** | — | **2rem** | none — `h1` is `.sr-only` `:23` | 0.75rem (`.section-title`) | portal |
| `/developer` | `.dev-page` `:479` | **900px** | `var(--space-6)` | **3.5rem** | `.dev-head` | — | portal |
| `/favorites` | `.fav-page` `:336` | **1280px** | — | **2rem** | `.fav-header` `:340` | — | portal |
| `/generations` | `.gen-page` `:539` | **1280px** | — | **2rem** | `.gen-header` `:543` | — | portal |
| `/generator` | `.page` `:1217` | **800px** | `2rem` | **4rem** | `.page-header` `:1372` | 2rem | portal |
| `/guides` | `.guides-page` `:1893` | none (`.cl-body` 980px, `.uv-body` 1080px) | `margin: calc(-1 * var(--space-8))` — **cancels the shell padding** | **0** | `.gd-top-titles` `:1918` | — | own in-page `SidebarMap` |
| `/models` | `.mm-page` `:1067` | **1280px** | — | **2rem** | `.mm-header` `:1071` | `var(--space-5)` 1.25rem | portal |
| `/personas/[agentId]` | `.persona-page` `:7193` | **100%** | — | **2rem** | `.persona-hero` `:7897` | 1.5rem | portal |
| `/review` | `.review-page` `:1442` | **1200px** | `1.5rem` | **3.5rem** | `.review-header` `:1447` | 1.25rem | portal |
| `/settings` | `.page` `:2383` | **1240px** | `2rem` | **4rem** | `.page-header` `:2388` | 2rem | portal |
| `/trash` | `.trash-page` `:297` | **none** | — | **2rem** | `.trash-headline` `:310` | — | portal |

Measured consequences:

- **9 distinct page container widths in the portal** — 800, 900, 960, 1040, 1100, 1200, 1240, 1280, 1400 px — plus 4 routes with no cap at all. **None of the 5 `--container-*` tokens (640/880/1080/1200/1320) is used**; the one width that matches a token (`1200px`, `/review`) is written as a literal.
- **4 distinct effective outer gutters**: 0 (guides), 2rem (favorites, generations, models, personas, trash, dashboard), 3.25–3.5rem (billing, admin, developer, review), 4rem (brand-brief, intel, calendar, generator, settings). The left edge of page content moves by up to 64px as the user navigates between sidebar items.
- **8 distinct page-header wrapper class names** — `.page-header` (5 routes), `.fav-header`, `.gen-header`, `.mm-header`, `.review-header`, `.admin-head`, `.dev-head`, `.trash-headline`, `.persona-hero`, `.hero`, `.gd-top-titles` — with **4 distinct header→body gaps** (1.25, 1.25 via token, 1.5, 2rem) and 6 routes with no gap rule at all.
- Every route re-invents its own shell class rather than sharing one; `.page` is the only name reused, in 5 routes, and it carries different max-widths in each (960, 960, 1400, 800, 1240).

---

## 9. Top 10 system inconsistencies, ranked by visibility to a user

1. **Page titles change size on every navigation.** `h1` renders at 8 different sizes across the portal — 1.35rem on `/trash`, 1.4rem on `/review`, 1.45rem on `/guides`, 1.5rem on `/calendar` `/favorites` `/generations` `/models` `/personas`, 1.6rem on `/admin` `/developer`, clamp-to-2.6rem on `/brand-brief` `/generator` `/settings`, clamp-to-3.6rem on `/billing`, and the untouched clamp-to-4.2rem on `/login` `/signup` `/invite`. `/dashboard` has no visible `h1` at all (`dashboard/+page.svelte:23`). Cited in full at §2.5.

2. **The page content's left edge jumps by up to 64px between routes.** Effective gutters are 0 (`guides/+page.svelte:1893` cancels the shell padding with a negative margin), 2rem (6 routes), 3.25–3.5rem (4 routes), 4rem (5 routes). §8.

3. **Section headings are not a hierarchy.** `h2` renders at 15 sizes from 1rem to 2.6rem, and `.section-title` means clamp(1.8rem,3.5vw,2.6rem) on `/dashboard` (`:293`) but 1rem on `/personas` (`:8575`). On `/dashboard`, `h2` is larger than `h1` on every other portal route.

4. **Modals dim the page by eight different amounts.** 13 overlay implementations, 8 scrim colours from `rgba(0,0,0,0.4)` (`generator/+page.svelte:1841`) to `rgba(10,14,26,0.88)` (`ui/ImageLightbox.svelte:124`), and 4 blur radii (3, 4, 6, 8px). Opening a lightbox versus a confirm dialog darkens the page visibly differently. §7.4.

5. **Status chips are a different size and shape on every screen.** 117 chip/pill/badge/tag class names, 14 font sizes (9px → 0.88rem), 18 paddings, 7 radius spellings, 4 vocabularies. `.chip` alone exists twice with `0.3rem 0.85rem` / 0.8rem vs `0.32rem 0.8rem` / 0.82rem. §7.3.

6. **Small text has no scale.** 21 distinct font sizes occupy the 9.6–14.4px band (0.6 → 0.9rem in ~0.02rem steps), mixed with `9px`/`10px`/`11px`/`12px`/`13px`. 65 of 76 font sizes are hardcoded literals. §2.2.

7. **Cards and panels never agree on interior padding or corner radius.** 29 distinct paddings and 13 radius spellings across 53 card/panel surfaces; `10px`, `12px`, `14px` and `16px` corners sit side by side. The `.glass-card` primitive (1.75rem) is used 6 times. §3.3, §4.1.

8. **Corner radius has two parallel vocabularies that disagree.** Pills are `999px` (90 uses), `var(--radius-full)` = 9999px (46), `var(--radius-full, 999px)` (6) and `50%` (78). `--radius-md` = 14px but is written as `var(--radius-md, 12px)` at 5 sites and `var(--radius-md, 10px)` at 1; `--radius` = 16px but appears as `var(--radius, 12px)` (`ui/ImageLightbox.svelte:141`); `--radius-sm` = 10px but appears as `var(--radius-sm, 8px)` (`dashboard/AnalyticsChart.svelte:432`). §4.1.

9. **Empty states look like they come from different products.** 18 implementations, 15 paddings, 3 different muted-text tokens, dashed border on 3 of 18. `.fav-empty` and `.gen-empty` are byte-identical duplicates in two routes; `.chart-empty` and `.panel-empty` are each defined twice with different padding. §7.5.

10. **Elevation is ad-hoc and the token shadows are mostly bypassed.** 80 distinct box-shadows, only 24% using a `--shadow-*` token, with 18 different "floating panel" shadows — `0 20px 60px rgba(0,0,0,0.25)`, `…0.3`, `…0.4` appear in three different files for the same kind of surface (`(portal)/+layout.svelte:1730`, `personas/[agentId]/+page.svelte:7806, 9120`). §4.3.

Runners-up worth recording, not user-visible on their own: the entire layout token layer is dead (11 tokens, 0 consumers, §6); 14 of 25 global utility classes are never used in markup, including the whole `.badge-*` system (§6); `var(--space-7)` at `models/+page.svelte:1264` is an undefined token that silently zeroes a margin (§3.2); `line-height: 0` at 4 sites (§2.4); font-weights `650`, `800` and `900` requested against families loaded only to 600/700/800 (§2.3).

**Consistent by measurement, for the record:** focus rings (6 values, 50/75 identical), border colour/width (90% tokenized, `1px solid var(--border)` at 58% of all borders), font families (99% tokenized), and `prefers-reduced-motion`, which is honoured globally at `src/app.css:1196` plus 20 component-level blocks.
