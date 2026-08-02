# PersonaGen — Pre-Implementation Readiness Assessment

**Date:** 2026-07-25
**Purpose:** establish the true current state of the platform before any persona-transformation work begins, so that (a) nothing that works today breaks, (b) the in-flight UI/UX upgrade and the persona direction converge instead of colliding, and (c) the upgrade lands as a structural improvement rather than a coat of paint.
**Companion doc:** [market-gap-assessment.md](market-gap-assessment.md) — what to build and why.

---

## 1. Baseline health — the platform is NOT currently green

Measured 2026-07-25 against the working tree (not HEAD).

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm run test:unit` | 🔴 **4 failed / 69 passed** (73 total, 1 file failing) |
| Typecheck | `npm run check` | 🔴 **1 error**, 168 warnings, 628 files |
| Uncommitted work | `git status` | 🟠 **41 modified files, ~4,700 insertions, all uncommitted** |
| Stray artifact | — | 🟠 `personagen-svelte/verify-manageability-tmp.mjs` untracked |

### 1.1 The four failing tests — all in `autopilot.spec.ts`

```
× autopilot slot idempotency > does NOT regenerate a slot that already has a post
    expected +0 to be 4
× autopilot slot idempotency > aborts the agent after repeated insert failures…
    expected +0 to be 3
× autopilot draft status > semi_autonomous agents get DRAFTS
    expected Set{'generating'} to deeply equal Set{'draft'}
× autopilot draft status > image-only content is not booked onto a video-only platform
    expected [Builder × 6] to have a length of +0
```

**Diagnosis.** `autopilot.ts` was rewritten in the uncommitted work to add an **atomic-ish slot claim**: it now inserts a placeholder `posts` row in status `'generating'` *before* any paid provider call, then either updates it to the real row ([autopilot.ts:408](../../personagen-svelte/src/lib/server/autopilot.ts#L408)) or deletes it ([:357](../../personagen-svelte/src/lib/server/autopilot.ts#L357), [:389](../../personagen-svelte/src/lib/server/autopilot.ts#L389), [:438](../../personagen-svelte/src/lib/server/autopilot.ts#L438)). `autopilot.spec.ts` was **not** updated and still asserts the old contract — zero inserts, terminal status observed on insert.

I traced each failure to a matching delete/update path in the new code, so these read as **stale expectations against a deliberate redesign, not live regressions**. But that distinction doesn't matter operationally:

> **We currently have no working regression net over the autopilot — the single most expensive, most autonomous, most spend-exposed code path in the product.**

Fixing the spec to the new claim protocol is **prerequisite work item #1**. Nothing else should be built on a red suite.

### 1.2 The typecheck error

`src/lib/server/budget.spec.ts:65:26 — Argument of type 'number' is not assignable to parameter of type 'string'.`

Also from the uncommitted work. Small, but it means `npm run check` cannot be used as a pass/fail gate today, which is exactly the gate we need during a rename.

---

## 2. What the in-flight UI/UX agent actually did

Characterising this correctly matters, because it determines whether the persona work conflicts or composes. It **composes** — but with a real merge-collision risk.

### 2.1 Three distinct workstreams in one uncommitted change

**(a) Accessibility hardening — the bulk of it.** Across ~30 files: `aria-invalid`, `aria-describedby`, `aria-required`, `aria-busy`, `aria-pressed`, `aria-controls`, `role="alert"`, `role="status"` + `aria-live="polite"` regions, `sr-only` companions for visual-only markers, keyboard/focus handling in `Modal`/`ImageLightbox`, `tabular-nums` on counters, and semantic heading corrections (`<span class="title">` → `<h3>`).

**(b) Design-system polish.** Emoji → inline SVG icons (`💡` → lightbulb path, `✨` → sparkle path), component hardening in `Button`, `Card`, `Input`, `Modal`, `ImageLightbox`, `SelectionToolbar`. Attributable to the `ui-ux-pro-max` skill (see commit `5dd5ba0`).

**(c) Server-side correctness work — *not* UI at all, and easy to miss.**
- `autopilot.ts`: leader-lease heartbeat between paid units (`shouldContinue`), plus the placeholder slot-claim protocol above. Genuine double-spend prevention.
- `budget.ts`: PostgREST row-limit awareness — a truncated ledger read silently **undercounted** spend, which meant the cap silently stopped being enforced. Now bounded at 100k rows, logs loudly, fails open with an explicit warning.
- `scheduler-lock.ts`, `content/generate.ts` (+391 lines).

**This is good work.** (c) in particular fixes two real money bugs. It should be committed, not carried.

### 2.2 What it did *not* do

No information-architecture changes. No route changes. No data-model changes. **No terminology changes.** It polished the surface of the agent-shaped product without questioning the shape.

That is precisely the seam your persona direction fits into — and precisely why it needs to happen now rather than after.

### 2.3 Collision risk — the one operational hazard

The persona work must touch: `generator/+page.svelte`, `personas/[agentId]/+page.svelte`, `(portal)/+layout.svelte`, `AgentRoster.svelte`, `dashboard/+page.svelte`, `review/+page.svelte`, `persona-profile.ts`. **Every one of those is currently modified and uncommitted.**

> **Mandatory first action: commit or stash the in-flight work as its own changeset before a single persona change is made.** A 4,700-line uncommitted diff is not a safe base to refactor on top of, and if we clobber it we lose two real money-bug fixes along with the a11y pass.

---

## 3. Architecture map — where "agent" actually lives

`agent` appears **2,236 times** across `src/`. A blind find-and-replace would be catastrophic. But the distribution is extremely favourable:

| Layer | Occurrences | Rename? | Rationale |
|---|---|---|---|
| **Database** — tables `agents`, `agent_configs`, `agent_memories`; FK columns `agent_id` on `posts`, `connections`, `chat_sessions`, `chat_messages`; `tickets.assignee_agent_id`; `agents.supervisor_agent_id` | ~10 tables/columns | ❌ **NEVER** | Migration risk with zero user benefit. Also breaks an external consumer — see §3.1. |
| **API route paths** — `/api/agent/[agentId]/*`, `/api/agents/*` | 12 routes | ❌ **NOT NOW** | Every fetch call site, plus any external caller. Could alias later; no user sees these. |
| **Code identifiers** — `Agent` type, `agentId` params, `agent` variables, `agents` props | ~2,000 | ❌ **NOT NOW** | Pure churn. Rename opportunistically inside files you're already rewriting. |
| **CSS class names** — `.dash-agent-cell`, `.agent-item`, `.event-agent`, `.agent-connect-cta` | ~150 | ❌ | Invisible. Leave. |
| **Component/dir names** — `components/agents/`, `AgentRoster`, `AgentConnectionStats` | 3 files | ⚠️ **Later**, low priority | Cosmetic; do it when rewriting those components anyway. |
| **User-visible strings** | **~20** | ✅ **DO THIS — all of it** | The entire perceived transformation lives here. |

**The whole "persona platform not agent platform" change is ~20 strings.** That is the finding that makes this safe.

### 3.1 The one external consumer that constrains us

`services/mcp-bridge/server.js` queries the `agents` table directly by name and exposes an MCP tool literally called `get_managed_agents` ("Fetches all creator agents managed by a specific supervisor agent"). It also reads `agent_id`, `supervisor_agent_id`, `assignee_agent_id`.

**Renaming any table or column breaks this service silently** — no typecheck covers it, no test covers it. This alone settles the question: **DB stays `agent`, UI becomes `persona`.**

### 3.2 The complete user-visible string inventory

Every one, with its file:

| File | Line | Current | → Should read |
|---|---|---|---|
| [routes/+page.svelte](../../personagen-svelte/src/routes/+page.svelte#L14) | 14 | `PersonaGen — AI **Agent**-Powered UGC Creator Management` | *"PersonaGen — AI Personas That Run Your Accounts"* |
| [generator/+page.svelte](../../personagen-svelte/src/routes/(portal)/generator/+page.svelte#L333) | 333 | `<h1>**Agent** Generator</h1>` | **"Create a Persona"** ← *the single worst offender* |
| generator | 516 | `**Agent** Name` | Persona name |
| generator | 591 | `"Who is this **agent**? Their personality, tone…"` | *(field becomes "Personality & Voice")* |
| [dashboard/+page.svelte](../../personagen-svelte/src/routes/(portal)/dashboard/+page.svelte#L26) | 26 | `**Agent** Network Health & Status` | Persona roster health |
| dashboard | 70 | `Awaiting **Agent** Creation` | Awaiting your first persona |
| [AgentRoster.svelte](../../personagen-svelte/src/lib/components/agents/AgentRoster.svelte#L244) | 244 | `<h3>**Agent** Roster</h3>` | Your personas |
| AgentRoster | 449 | `No **agents** match this filter.` | No personas match this filter. |
| [AgentConnectionStats.svelte](../../personagen-svelte/src/lib/components/agents/AgentConnectionStats.svelte#L185) | 185 | `**Agent** Settings` | Persona settings |
| [calendar/+page.svelte](../../personagen-svelte/src/routes/(portal)/calendar/+page.svelte#L853) | 853 | `…across all **agents** and platforms` | …across all personas and platforms |
| calendar | 1112 | `Target **Agent**` | Persona |
| [review/+page.svelte](../../personagen-svelte/src/routes/(portal)/review/+page.svelte#L491) | 491 | `<span>**Agent**</span>` | Persona |
| review | 493 | `All **agents**` | All personas |
| [settings/+page.svelte](../../personagen-svelte/src/routes/(portal)/settings/+page.svelte#L714) | 714 | `alerts about **agent** activity` | persona activity |
| settings | 1044 | `e.g. mia.**agent**@gmail.com` | e.g. mia.persona@gmail.com |

Plus field labels that are jargon rather than the word "agent": **Soul (Personality & Voice)** → *Personality & Voice*; **Skills & Capabilities** → remove from the create flow entirely; **Tools**, **Heartbeat** → remove from UI.

**Evidence the migration is already half-done and inconsistent:** the route is `/personas/[agentId]`, and [CalendarView.svelte:505](../../personagen-svelte/src/lib/components/calendar/CalendarView.svelte#L505) already renders **"All Personas"** while [calendar/+page.svelte:1112](../../personagen-svelte/src/routes/(portal)/calendar/+page.svelte#L1112) two files away says **"Target Agent"**. The product currently contradicts itself on screen. That inconsistency is worse than either choice consistently applied.

---

## 4. The structural blocker: the `market` column

This is the one genuine data-model problem, and it sits directly under the traits work.

```sql
-- supabase/migration.sql:50
CREATE TABLE public.agents (
  ...
  soul       TEXT DEFAULT '',
  skills     TEXT DEFAULT '',
  tools      TEXT DEFAULT '',
  heartbeat  TEXT DEFAULT '',
  market     TEXT DEFAULT 'Australia',   -- ← now holds the ENTIRE persona profile as JSON
  ...
);
```

`market` was a country string. It now stores a JSON blob containing `archetype`, `contentFocus`, `targetAvatar`, `psychProfile`, `contentAngle`, `appearance{}`, `voiceProfile{}`, `ageRanges[]`. Every read is a defensive `typeof a.market === 'string' && a.market.startsWith('{')` + `try/catch` — **18 call sites** across the engine, the persona page, the generator, and content generation.

**Consequences, all of which the traits work will hit:**
- No schema, no constraints, no indexes. Cannot query "all personas with hair colour X".
- Silent data loss: a field missing from `currentPersonaProfile()` is dropped on save — a bug we have already been bitten by (recorded in project memory).
- Adding four new trait dimensions (persona age, skin tone, body, hair length) means four more unvalidated keys in an untyped blob.
- `agent_configs` **duplicates** `soul`/`skills`/`tools` from `agents` — a genuine dual source of truth, unresolved.

**Recommendation — additive, zero-downtime, non-breaking:**

1. Add `personas_profile JSONB` (proper JSONB, not TEXT) alongside `market`.
2. Dual-write both for one release; read `personas_profile` first, fall back to parsing `market`.
3. Backfill existing rows with a one-shot script.
4. Restore `market` to its declared meaning (a country string) or drop it once reads are gone.
5. Introduce a **single typed accessor module** — `lib/persona-profile-store.ts` — that owns parse/serialise/validate. Today that logic is inlined in ~18 places, which is why fields get silently dropped.

**Do this before the trait picker, not after.** Adding four trait fields to an untyped TEXT blob and then migrating is strictly more work than migrating first.

---

## 5. How the trait/wizard upgrade lands safely

### 5.1 The compatibility insight that de-risks everything

`APPEARANCE_FIELDS` in [persona-profile.ts:67](../../personagen-svelte/src/lib/persona-profile.ts#L67) is already the **single source of truth**, mirrored by both the persona page and the generator, and consumed by exactly two functions:

- `coerceAppearance()` — keeps known keys, trims strings
- `appearanceToPromptClause()` — renders `"honey blonde hair, warm brown eyes, …"` into the image prompt

**Both are string-in / string-out.** So if `TraitPicker` emits `hairColor: "Light Brown"` where a user previously typed `"honey blonde"`, **nothing downstream changes** — not the prompt builder, not the portrait builder, not the reference kit, not the LLM profile generator's `coerceAppearance` output path.

> The trait picker is an **input-method change, not a data-format change.** That is what makes it safe, and it is the single most important implementation constraint to preserve.

**Corollary — backward compatibility rule:** existing personas hold free-text values that won't match any curated chip. `TraitPicker` must render an unmatched stored value as a **selected custom chip**, never silently drop it or reset to Best Fit. Dropping it would visibly change existing personas' faces on next generation. This is the #1 regression risk in the whole feature.

### 5.2 Where each new trait dimension goes

| New trait | Storage | Downstream wiring |
|---|---|---|
| `skinTone` | new `APPEARANCE_FIELDS` key | add to `appearanceToPromptClause` |
| `bodyType` | new key | add to clause |
| `hairLength` | new key | add to clause; **must compose with existing `hairstyle`, not replace it** — old personas have combined values like `"long loose waves"` |
| `personaAge` | new key | add to clause **and** to the portrait subject line |

⚠️ **Do not touch `ageRanges`.** It is the *audience's* age bracket, is consumed by the strategy prompt, and is a completely different concept from the persona's own age. Reusing it would corrupt targeting. Name the new field distinctly.

Each addition also needs a matching line in the `generate_persona_profile` prompt's JSON contract ([engine:1910](../../personagen-svelte/src/routes/api/engine/+server.ts#L1910)) so "Best Fit" resolution actually fills it — otherwise Best Fit silently produces nothing.

### 5.3 The wizard change is the bigger structural move

Current: a 3-step text wizard — Identity → Persona → Review & Create — that **commits on text**, then generates the face afterwards on another page ([generator:312](../../personagen-svelte/src/routes/(portal)/generator/+page.svelte#L312)).

Target: **traits → preview → lock → brand → connect**, committing only after the user approves a face.

**This inverts the creation order**, which means it touches:
- `POST /api/agents` (creation currently expects a complete text payload)
- `generate-avatar` (currently runs post-creation; must run pre-commit against a draft)
- the wizard's `saveProgress` localStorage draft shape
- `agent_configs` row creation timing

**Recommendation: build it as a new route (`/personas/new`) rather than mutating `/generator` in place.** Keep `/generator` working and untouched until the new flow is verified, then redirect. This is the difference between a reversible change and a risky one, and it removes the merge collision with the in-flight a11y edits to `/generator` entirely.

### 5.4 What must NOT be disturbed

Load-bearing behaviour with real money or trust attached to it:

| System | Why it's load-bearing |
|---|---|
| **Verified publishing** | Never claims published without platform confirmation. A trust differentiator. Do not refactor. |
| **Autopilot slot claim + lease heartbeat** | Just-added double-spend prevention. Red tests — fix the spec, don't touch the code. |
| **Budget ledger** | Just-fixed silent undercount. Leave alone. |
| **Reference-kit stage pipeline** | Consistency depends on multi-ref ordering + the `multiRef: false` warning. The identity-lock work extends this — it must not replace it. |
| **Gender-from-name inference** | Fixes a real bug where a stale stored gender poisoned face, voice, and kit. The trait picker adds an explicit gender chip — **it must feed the same resolution path**, not bypass it. |
| **Cross-persona differentiation** | The `taken` fingerprint check. New trait fields must be added to that fingerprint or two personas will start converging on the same look. |
| **Manual-delete notice / Zernio key manager / brand-theme opt-in** | Deliberate prior decisions recorded in project memory. Do not "simplify" them. |

---

## 6. Recommended sequence

Each phase ends green (`npm run test:unit` and `npm run check` both clean) before the next begins.

### Phase 0 — Stabilise *(do before anything else)*
1. Commit the in-flight UI/UX + server-hardening work as its own changeset.
2. Update `autopilot.spec.ts` to the new placeholder-claim contract → **4 tests green**.
3. Fix `budget.spec.ts:65` type error → **`npm run check` clean**.
4. Remove `verify-manageability-tmp.mjs`.
5. Tag/branch this as the known-good base.

### Phase 1 — Terminology *(low risk, high perceived impact)*
6. Rewrite the ~20 user-visible strings in §3.2. UI only — no identifiers, no routes, no DB.
7. Remove `Skills`, `Tools`, `Heartbeat` from the create flow; relabel `Soul` → *Personality & Voice*.
8. Verify: no route change, no fetch change, tests still green.

### Phase 2 — Data model *(the enabler)*
9. Add `personas_profile JSONB`; dual-write; read-with-fallback.
10. Introduce `lib/persona-profile-store.ts` as the single typed accessor; migrate all 18 call sites to it.
11. Backfill script; verify against production-shaped data.

### Phase 3 — Traits
12. Extend `APPEARANCE_FIELDS` with curated option sets + `Best Fit` + the four new dimensions.
13. Build `TraitPicker.svelte` against existing tokens; **custom-chip fallback for legacy free-text values**.
14. Extend `appearanceToPromptClause`, the portrait subject line, the `generate_persona_profile` JSON contract, and the cross-persona `taken` fingerprint.
15. Mount in the persona page first (lower risk than the wizard), verify against existing personas.

### Phase 4 — Wizard
16. New route `/personas/new` — traits → preview → lock → brand → connect, with elapsed-time badges.
17. Pre-commit avatar generation against a draft persona.
18. Verify, then redirect `/generator` → `/personas/new`.

### Phase 5 — Everything else
Landing page · billing · locked identity (LoRA) · pre-made personas.

---

## 7. Verification gates

Before each phase is called done:

```bash
npm run test:unit     # must be 73/73
npm run check         # must be 0 errors
npm run lint
```

Plus manual regression on the paths no test covers:
- Create a persona end-to-end; confirm the face matches the chosen traits.
- Open an **existing** persona; confirm no trait value was lost or changed.
- Run autopilot for one agent; confirm exactly one post per slot and correct spend in the ledger.
- Publish one post; confirm status only reaches `published` after platform confirmation.
- Confirm `services/mcp-bridge` still resolves personas (no table/column moved).

---

## 8. Bottom line

**The persona transformation is far less dangerous than it looks — and the platform is in worse shape than it looks.**

The rename is ~20 strings, because 2,236 occurrences of "agent" are identifiers, CSS, and props that no user will ever see. The trait picker is an input-method change over a string-in/string-out contract that already exists. Neither requires touching the database, the API surface, or any load-bearing system.

The real risks are elsewhere, and all three are fixable this week:

1. **The autopilot has no working test net right now** — 4 red tests over the most spend-exposed code in the product.
2. **4,700 lines are uncommitted**, including two genuine money-bug fixes that would be lost if clobbered.
3. **The `market` column is a typed-field-turned-untyped-blob** with 18 hand-rolled parse sites and a known silent-data-loss failure mode — and it is exactly where the new trait fields would land.

Fix those three first. Then the persona upgrade is additive, reversible, and safe at every step.

---

## 9. Re-assessment — 2026-07-28

### 9.1 Platform health: green, verified

| Check | 2026-07-25 | **Now** |
|---|---|---|
| `npm run test:unit` | 🔴 4 failed / 69 passed | 🟢 **77 passed / 77** |
| `npm run check` | 🔴 1 error, 168 warnings | 🟢 **0 errors**, 148 warnings |
| Uncommitted | 🟠 41 files, ~4,700 lines | 🟢 clean (6 stray scripts only) |

**Phase 0 complete.** **Phase 1 complete** — ~30 user-visible strings converted across 8 files; a full sweep for rendered "agent" text now returns zero hits.

### 9.2 Concurrent session — still active

Branch is `ux-makeover` (was `main`). Two further commits since Phase 1 landed: `50004df` (manageability contract) and `3fe6a53` (README walkthroughs). That session also cleaned up its own `probe-*-tmp.mjs` files. Six new untracked scripts are in the tree (`drive-verify*.mjs`, `verify-tmp.mjs`, `supabase/build-bootstrap.mjs`, `supabase/client_bootstrap.sql`).

**Unchanged conclusion:** Phase 2 (the `market` → `personas_profile JSONB` migration) must not run on a shared tree with an active second writer.

### 9.3 NEW — Higgsfield is now reachable as a supplier, not just a competitor

A Higgsfield MCP connector came online in this session. Verified read-only:

- **Soul 2.0 (`soul_2`)** — trained identity, `soul_id` parameter. Training is **5–20 reference images, ~10 min** (fewer than the 20+ their marketing states). Usable *only* with `text2image_soul_v2` and `soul_cinema_studio`; **one `soul_id` per generation** — multi-character shots require their separate Reference Elements path.
- **Seedance 2.0** (ByteDance) — identity-consistent video, **4–15s, up to 4K, native audio**, image/video/audio reference roles. This materially outclasses our current Kling o3 ~5s path.
- **Wan 2.7** — synchronised audio, character-consistent, 2–15s.
- Account state: **free plan, 3 credits.** No budget to validate at scale.

**Buy-vs-build reframe for P0 "trained identity":** the assumption was that we build LoRA training on fal. Two cheaper options now exist — (a) use this MCP to *benchmark* Soul 2.0 against our 5-stage reference kit before committing engineering, and (b) check whether Seedance 2.0 is exposed on **fal**, where we already hold server-side keys.

**Two constraints that bound this hard:**

1. **The MCP cannot power autopilot.** It is an interactively-authenticated claude.ai connector; it is not available to our SvelteKit server process or to scheduled/headless runs. Autopilot is server-side and unattended. So this is viable for evaluation and possibly a manual-mode feature — **never** for the always-on path that is our actual differentiator.
2. **Strategic dependency risk.** Higgsfield is a direct competitor in the exact category. Routing our identity pipeline through their rails gives them a kill switch and full visibility into our volume.

**Recommendation:** treat the MCP as a **free benchmarking instrument**, not a supply line. Use it to answer "how much better is a trained Soul than our reference kit, really?" before spending weeks on LoRA training. Separately, probe fal's live spec for Seedance 2.0 — a 4–15s, 4K, native-audio, identity-consistent model on infrastructure we already own would be a larger and safer win than anything in the Higgsfield path.
