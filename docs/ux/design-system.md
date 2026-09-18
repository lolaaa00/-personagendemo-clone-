# Portal design system

What the authenticated portal agrees on, and where each agreement is enforced.

This is deliberately short. It documents only the rules that are **checked by a
test**, because four rounds of UX work established conventions that nothing
enforced, and round 4 re-measured the layout numbers to find them unchanged from
round 2. A convention with no test is a preference, and preferences drift.

Every rule below names the file that enforces it. If you want to change a rule,
change it there — a rule you can break without a test failing is not in this
document.

---

## 1. The page frame

**One component owns page width, gutter, masthead and heading scale:**
`src/lib/components/ui/PageShell.svelte`.

A route declares what kind of page it is. It does not choose pixels.

| Prop | Values | Meaning |
|---|---|---|
| `title` | string | The page's name. Becomes the `h1` and the document `<title>`. Must match the sidebar label. |
| `width` | `default` (1200px) · `wide` (1440px) | `wide` only for dense data tables. |
| `description` | string | One or two sentences. Longer belongs in the body. |
| `eyebrow` | string | A small label above the title. Rarely right. |
| `actions` | snippet | Buttons for the page as a whole. |
| `toolbar` | snippet | Filters or tabs, below the masthead. |
| `bare` | boolean | Frame without masthead, for a detail page whose subject is the heading. |

**There are exactly two widths.** Not because two is a magic number, but because
the argument about the third one is what produced ten.

### Before and after

Measured at 1920 across the thirteen portal routes:

| | Before | After |
|---|---|---|
| `h1` left edge | 10 distinct values, spanning 441px | **2** (392 wide · 512 default) |
| `h1` font-size | 7 distinct values, 21.6px – 67.2px | **1** (24px) |
| Container widths | 10, from 800px to `100%` | 2 |
| Gutter values | 4 | 1, stepped at 640 / 1024 |

### A narrow form does not ask for a narrow page

Shrinking the page to narrow a form is what moved the masthead. Wrap the fields:

```svelte
<PageShell title="Create a Persona">
  <div class="page-column">…fields…</div>
</PageShell>
```

`.page-column` (720px) and `.page-column-wide` (960px) live in `app.css`.

### The one exception

`/guides` is a full-bleed docs hub with a sticky bar that the shell's centred
column would break. It is exempt from the shell, and **not** exempt from the
result: it aligns its content to the same column and uses the same `h1` size, so
the heading lands where every other heading lands.

> Enforced by `src/lib/portal-shell.spec.ts` — imports, no per-route container
> width, and no per-route `h1` size (walking every `(portal)` component **and**
> `+error.svelte`, because the 403 page's 41.6px heading escaped a version of
> this rule that only walked `+page.svelte`).
>
> `/guides` alignment is asserted in `scripts/ux/verify-round5.mjs`, not here.
> There was a source-grep version in the spec; it checked that two
> `padding-inline: max(…)` declarations existed, passed, and `/guides` was 32px
> out at 1280 and 1440 the whole time. Alignment is rendered geometry — assert it
> in a browser or not at all. Do not reintroduce a string-matching substitute.

---

## 2. Focus

**A baseline `:focus-visible` ring in `app.css` covers everything focusable.**
`--focus-ring` is an opaque hex, defined once per theme.

The rule that keeps being broken:

```css
/* NO. This drew a ring measuring ~1.2:1 — invisible. */
.thing:focus { outline: none; border-color: var(--accent-mid); }
```

`--accent-mid` is 22% alpha. WCAG 2.2 SC 2.4.11 holds a focus indicator to 3:1.
Five rules shipped this pattern; one of them sat a single selector away from a
rule that had just been fixed for exactly the same reason.

A component rule out-specifies the baseline, so the baseline only holds if
nothing re-adds the suppression.

**Allowed exception:** containers that receive *programmatic* focus (a modal, a
lightbox, the main region after a skip link) may suppress on `:focus`. They are
not controls. They are listed by name in the spec so adding another is a
deliberate act.

> Enforced by `portal-shell.spec.ts` — scans every `.svelte` and `app.css` for
> `outline: none` inside a focus selector, and asserts `--focus-ring` is opaque
> in both themes.

---

## 3. Status

**One module owns what a status looks like:** `src/lib/status-color.ts`.

It exposes `fill` and `text` separately and they are not interchangeable:

- **`fill`** — the raw brand hue. Stripes, dots, bars. Anything that is not text.
- **`text`** — the AA-safe `-text` variant. Any status rendered *as text*, at any
  size. The raw hues measure 2.77–4.08:1 on a light surface.

**Do not invent status buckets.** The calendar legend used to fold `partial` into
published, `publishing` into scheduled and `rejected` into **failed**. On one
real month the grid held 9 published / 8 scheduled / 3 rejected / 1 partial / 2
failed / 1 publishing / 5 draft, and the legend reported 10 / 9 / 5 / 5.

Telling someone a post they rejected is one the system failed to publish sends
them debugging a provider over their own decision. Counting a post still in
flight as live is the one rounding direction a publishing tool must never take.

The legend is now one chip per status, counted by equality, driven off
`POST_STATUSES` — so a status added to the database constraint gets a chip
instead of being absorbed by a neighbour.

> Enforced by `status-color.spec.ts` (coverage against the SQL CHECK
> constraints) and `portal-shell.spec.ts` (one chip per status, filtering by
> equality).

---

## 4. Numbers

**A number on screen must be countable, and its label must say what it counts.**

This is the rule the portal has broken most often:

- The dashboard scored personas with `70 + engagement×2.5 + connections×4`,
  floored at 70 by a constant, presented as a percentage behind a green bar.
- The persona hero read "0 POSTS" because it derived the count from a feed that
  is only fetched on two of the tabs.
- A KPI tile summed every persona's follower count — paused and pending ones
  included — and called it **Total Reach**. Reach is impressions.
- The Content Plan wizard's predecessor presented invented "current" figures for
  followers and engagement to an account with no connected platforms.

The rules that came out of it:

1. A count comes from a **count query**, not from whatever list is in memory.
2. The label names what was counted (`Published`, not `Posts`; `Total
   Followers`, not `Total Reach`).
3. If there is nothing to measure, say so — `—` with a title, or no column.
4. **A column with no value for any row is not rendered.** QC on `/review` and
   Gen Spend on the dashboard roster are conditional, and return by themselves
   the day something writes them.
5. Never present a projection as a measurement. The Content Plan says in as many
   words: *these are commitments, not predictions.*

---

## 5. Responsive

**Every breakpoint that changes how much width content gets:**

| Breakpoint | What changes | Content width effect |
|---|---|---|
| 640px | shell gutter 16px → 24px | −16px |
| **769px** | **the sidebar becomes persistent** | **−240px** |
| 1024px | shell gutter 24px → 32px | −16px |
| 1280px | `/review` table: compact → full shape | caption −385px |

The 769px row is the one that matters and the one this document used to omit.
It is not the shell's — the sidebar owns it — and it is the largest single
determinant of how much room a page actually has. A layout tested at 768 and at
1280 will pass both and be broken across the whole band between them.

**Measure across the range, not at its endpoints.** `/review`'s caption was
verified at 768 (311px) and 1280 (472px) and was 67px at 769 — about eight of
seventy-six characters — for every width up to ~1100. `verify-round5.mjs` now
samples every 20px from 700 to 2560.

**A column may not come and go freely.** Restoring a column always costs the
caption: at a breakpoint you gain 20px of viewport and pay a whole column width.
So the table has exactly **two shapes** with **one transition**, and the
transition sits where the wide shape can afford it (its chrome costs ~711px, so
below 1280 it starves the caption). Chasing a caption that never narrows is the
wrong target; two identities instead of four is the right one.

**A property's rules live together.** Three separate times in `review/+page.svelte`
a declaration was silently beaten by another at equal specificity written later
in the file — the fold spans, the caption's base state, the deck crop. Each
looked correct in isolation and did nothing. The fix is adjacency, never
`!important`.

**A decision must be possible without scrolling.** On the widths Deck renders at,
`/review` keeps the caption and the approve control inside the first viewport,
verified at seven real device sizes. Where trimming chrome cannot achieve it —
the card's own height pushes the controls down — the controls are pinned.

---

## 5b. Older responsive notes

The portal has a **16px minimum side gutter at every width**, owned by the shell.

**Column priority runs from the content outward.** `/review` used to hide
CAPTION, PLATFORMS and STATUS below 900px, leaving QC — permanently `—` — as the
only content-bearing column. At 768 you were approving posts you could not read.

Priority now: platforms and the media thumbnail go first; persona and slot fold
into a meta line under the caption; **the caption never goes.**

A flexible column (`width: 100%` + `max-width: 0`) absorbs the table's slack so
it fits its container instead of overflowing — which is also what stopped the
sticky actions column from parking on top of the status and the scheduled time.

Only tables, diagrams and code blocks may scroll horizontally, each in their own
container. The page body never does.

---

## 6. Copy

- **No `(s)`.** `post(s)` is a placeholder, and it shipped on the most-repeated
  confirmation in the product. Use `plural()` / `countLabel()` from `$lib/plural`.
- **One word per thing.** The wallet balance was "Credits" in the sidebar and
  "Your balance" on `/billing`.
- **A disabled control says what would enable it.** A disabled Next that explains
  nothing is a dead end: the user cannot tell a missing field from a broken page.
- **Every CTA has a destination.** "Message us and we'll load your wallet" named
  no address, link or form.
- **Do not promise persistence you do not deliver.** The Content Plan wizard told
  users their answers were kept, wrote the plan to
  `brand_briefs.data.contentStrategy`, and nothing read it back.

> `(s)` is enforced by `portal-shell.spec.ts`. The rest are review rules.

---

## 7. Destructive actions

**Every destructive action needs a way back, or a confirmation that names the
target.**

Reject was the only action on `/review` with no way back: undoing a mis-click
meant deleting the post and regenerating it, which costs real money. `restore`
returns a rejected post to draft and deliberately writes **no** `post_reviews`
row — the rejection happened and stays in the training log; restoring is a status
change, not a verdict, and recording it as one would put an approval in the log
that no reviewer ever gave.

**A row action must not arm a bulk action.** Row Reject used to do
`selected = new Set([item.id])`, which ticked that row's checkbox and enabled
Approve, Reject and Delete for a selection the user never made.

**An affordance must do what it looks like.** The Board view rendered columns
headed "NEEDS REVIEW 5" — the universal signal for a draggable board — with zero
draggable elements and no drop targets. It drags now, and every move maps onto an
API action the buttons already use.

---

## Running the checks

```bash
npx vitest run src/lib/portal-shell.spec.ts     # the invariants above
npx vitest run src/lib/status-color.spec.ts     # status coverage vs SQL

# Against a running portal (see the header of each script):
node --import ./scripts/ux/dns-fix.mjs scripts/ux/verify-round5.mjs
node --import ./scripts/ux/dns-fix.mjs scripts/ux/verify-round3.mjs
node --import ./scripts/ux/dns-fix.mjs scripts/ux/portal-gate.mjs
```

**Start the audit server with the scheduler off:**

```bash
RUN_SCHEDULER=false PORT=4180 node --env-file=.env \
  --import ./scripts/ux/dns-fix.mjs build/index.js
```

Without `RUN_SCHEDULER=false` a local server boots a publishing worker against
the **shared** database and will publish due posts to real platforms. Without
`--env-file=.env` every route renders "Configuration Required", and a verifier
that does not check for it will measure that page and pass.
