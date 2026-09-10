# Persona Model v2 — Executable Action Plan

**Date:** 2026-09-05
**Strategy doc:** [persona-model-v2-plan.md](persona-model-v2-plan.md) — read §3 (contract) and §4 (sampler) before starting any task below.
**UX & rollout doc:** [persona-model-v2-ux-and-rollout.md](persona-model-v2-ux-and-rollout.md) — provenance, silent backfill, the `PERSONA_BACKBONE` staged flag, and the verification ladder. Tasks P0.7, P1.7, P1.8, P5.0 below come from it.
**Runbook (start here from 2026-09-07):** [persona-model-v2-runbook.md](persona-model-v2-runbook.md) — the ordered, command-level sequence from today's interleaved tree to Phase 1: session preflight, landing two uncommitted streams without losing either, production proof of the security fix, worktree isolation, then Phase 0 with the new rails. Supersedes "Suggested order" below for sequencing.
**Working directory for all commands:** `personagen-svelte/`
**Branch model:** one branch per phase (`persona-v2/phase-0` …), one PR per phase, squash-merge to `main`. The repo pre-commit hook (`scripts/hooks/pre-commit`) runs on every commit.

Every task has: files, the change, the test that proves it, the command that gates it, a done-criterion, and a rollback. A task is not done until its gate is green **and** the full unit suite is green.

---

## Baseline — measured 2026-09-05

| Check | Result |
|---|---|
| `npm run test:unit` | 🔴 1 failed / 198 passed — `budget.spec.ts › assertWithinBudget › a cap of 0 disables the check › never throws AND never queries the ledger when both caps are 0` (expected 0 ledger queries, got 1) |
| Working tree | clean apart from `graphify-out/cache` and the two plan docs |
| `services/mcp-bridge/server.js` | **Verified: does NOT read `agents.market` or `agents.personas_profile`.** It selects `id, name, handle, niche, status, managed_by_overseer, runtime_owner, is_overseer, supervisor_agent_id, user_id` only. The dual-write comments in `agents/+server.ts`, `agents/config/+server.ts`, `persona-profile-store.ts`, `types.ts`, and the migration are stale. |

**Consequence:** `market` retirement is no longer blocked by an external consumer. It becomes task P0.6 instead of a distant follow-up.

---

## Reassessment — 2026-09-07

Two days of concurrent work landed rails this plan must now build on instead of around. Measured against the working tree and `main` at `4f2bb07`.

| Check | 2026-09-05 | 2026-09-07 |
|---|---|---|
| `npm run test:unit` | 🔴 1 failed / 198 | 🟢 **418 passed / 29 files** |
| `npm run check` | 0 errors / 122 warnings | 0 errors / 116 warnings |
| Orphan audit (`docs/audit/orphan-problems-2026-09-05.md`) | 11 open | 9 closed; graphify cache (87 files) and persona-page stale-state (44) remain |
| This plan's own prerequisites | none done | **P0.0 done** (suite green); **P0.7 half done** (9 byte-level prompt snapshots in `prompt-regression.spec.ts`; provenance not started) |

**Rails that now exist and change how tasks below are executed:**

1. **Runtime flags have a precedence contract** — `src/lib/server/flags.ts`: env var (if set) → `platform_settings` row flipped from the Admin Console (`getSettings()`, 15 s cache) → default. **Every flag this plan introduces (`PERSONA_GENERATOR`, `PERSONA_BACKBONE`, `PERSONA_FIT_JUDGE`) follows that module, not the env-only card-renderer pattern.** The database is the normal control surface, so the rollout doc's promotions `off → shadow → fill → on` become Admin Console flips with no redeploy; the env var is the host-level emergency override. Add each flag to `PlatformSettings` in `settings.ts` and to `SETTING_KEYS`.
2. **Migrations are a ledger, not a list** — `supabase/migrations.json` is the single ORDER (shared by `build-bootstrap.mjs` and `scripts/apply-migration.mjs`); `000_schema_migrations.sql` records name + sha256 per applied file; a changed checksum is refused; `deploy.ps1` aborts on pending or drifted migrations; `migrations-coverage.spec.ts` fails when a `.sql` file is neither ordered nor excluded with a reason. **P0.6 and P3.3 register their files in `migrations.json` and ship through `apply-migration.mjs --all`; never hand-edit `client_bootstrap.sql`.**
3. **Paid steps have a credit gate on top of the budget gate** — `src/lib/server/credits.ts`: `assertCreditsAvailable()` before the call, `debitForEvents()` after, 1 credit = 1 retail cent, markup from `creditMarkup()`. `generate.ts` already routes through it. **Every LLM call this plan adds (P1.4 prose, P1.7 Tier 2 reconciliation, P3.3 fit judge) calls both gates and writes a `generation_events` row so it is metered and debited like any other generation.** Under `credits_mode=enforce` an unmetered path is a free path.
4. **Platform admins and the Admin Console exist** (`platform-admin.ts`, `platform_admins` table, `/admin`). The optional registry DB overlay (P1.1b) should live under `platform_settings` / an admin-only table, not a per-user table.
5. **Env documentation is enforced** — `env-docs.spec.ts` fails when code reads a variable the root `.env.example` does not document. Each new flag needs its `.env.example` line in the same PR or the suite goes red.
6. **Migrations are excluded with reasons** — `migrations-excluded.json` already records the archived `update_user.sql`; add nothing there for this plan.
7. **Pre-commit hook grew guards** (non-portable filenames). The `REGISTRY_VERSION` bump check from P1.1 goes into the same hook file, after the existing guards.
8. **Graceful shutdown registry** — `lifecycle.ts`. Anything this plan runs in-process in the background (none planned; the backfill is a script) must register there.

Task-level deltas are marked **[09-07]** inline below.

---

## Phase 0 — Contract, metadata, lazy upgrade (no user-visible change)

**Branch:** `persona-v2/phase-0` · **Flag:** none needed (pure data-model) · **Estimate:** 2–3 days

### P0.0 Green the suite — **[09-07] DONE** (418 passing; the budget spec now asserts "no ledger query", seat-cap lookup allowed)
- **Files:** `src/lib/server/budget.spec.ts` or `src/lib/server/budget.ts`
- **Change:** read the failing assertion; decide whether `assertWithinBudget` must skip the ledger query when both caps are 0 (spec intent) or the spec is stale against a deliberate change. Fix the side that is wrong; do not delete the test.
- **Gate:** `npm run test:unit` → 0 failed. `npm run check` → 0 errors.
- **Done:** suite green on `main` before any Phase 0 code.
- **Commit:** `fix(budget): restore zero-cap short-circuit (or: update spec to ledger-first contract)`

### P0.1 Contract module
- **Files (new):** `src/lib/persona-contract/schema.ts`, `tokens.ts`, `labels.ts`, `index.ts`
- **Change:** `PersonaProfileV2` type exactly as strategy §3. `tokens.ts` exports every enum as `as const` arrays of snake_case tokens (`AGE_RANGE_TOKENS = ['13_17','18_24',…]`, `FACIAL_HAIR_TOKENS`, `EYEWEAR_TOKENS`, `PRICE_FRAME_TOKENS`, …). `labels.ts` exports `label(fieldPath, token): string` and `LABELS` map; the current display strings (`'25–34'`, `'Fair/Light'`) become label values here, never storage values. Client-safe: no `$env`, no `lib/server` imports (same rule as `persona-profile-store.ts`).
- **Test (new):** `src/lib/persona-contract/tokens.spec.ts` — every token list has a label for every token; no token contains a non-`[a-z0-9_]` character; no two lists share a token that means different things (`'none'` is allowed to repeat).
- **Gate:** `npx vitest run --project=unit src/lib/persona-contract`
- **Done:** module compiles, zero runtime behaviour touched.
- **Commit:** `feat(persona-contract): v2 schema, token enums, label registry`

### P0.2 Pure upgrade function
- **Files (new):** `src/lib/persona-contract/upgrade.ts`, `upgrade.spec.ts`
- **Change:** `upgradeV1toV2(v1: PersonaProfile): PersonaProfileV2`. Mapping table:

  | v1 | v2 |
  |---|---|
  | `ageRanges` `'25–34'` | `audience.ageRanges` `'25_34'` (en-dash and hyphen both accepted) |
  | `ageMin/ageMax` only | `audience.ageRanges` via existing `deriveAgeRanges` |
  | `gender` | `creator.gender` |
  | `appearance.ethnicity` | `creator.heritage` (free text kept verbatim as `heritageText`; token only when it matches `HERITAGE_TOKENS` label) |
  | `appearance.personaAge` `'30–35'` | `creator.age` = bucket midpoint, `creator.ageSource: 'bucket'` |
  | `appearance.{skinTone,bodyType,hairLength,hairstyle,hairColor,eyeColor,wardrobe,outfitColors,headwear,distinctiveFeatures,styling}` | `look.*` — strings kept **verbatim** (the "never snap a stored value" rule) |
  | `voiceProfile` | `voice` |
  | `archetype, contentFocus, contentAngle` | `strategy.*` |
  | `targetAvatar, psychProfile` | `audience.*` |
  | `bios, handleCandidates, confirmedHandles` | `identityKit.*` |
  | `displayName` | `creator.displayName` |
  | unknown keys | carried to `_legacy` |
  | — | `meta: { schemaVersion: 2, generator: 'manual', upgradedFrom: 1 }` |

  Also `isV2(profile)` guard. **Pure**: no I/O, no mutation of input.
- **Test:** three golden fixtures captured from real shapes — (a) `ageMin/ageMax` only, pre-bucket; (b) full v1 with identity kit; (c) appearance with legacy combined `hairstyle: 'long loose waves'` and off-list `hairColor: 'honey blonde'`. Assert exact v2 output. Assert idempotent: `upgrade(upgrade(x)) === upgrade(x)` when input is already v2.
- **Gate:** `npx vitest run --project=unit src/lib/persona-contract`
- **Commit:** `feat(persona-contract): pure, idempotent v1→v2 upgrade with golden fixtures`

### P0.3 Store returns v2
- **Files:** `src/lib/persona-profile-store.ts`, `persona-profile-store.spec.ts`
- **Change:**
  - `readPersonaProfile()` → returns `PersonaProfileV2` (upgrading in memory if v1). Signature and never-throws contract unchanged.
  - `PERSONA_PROFILE_KEYS` → the v2 top-level keys (`meta, creator, look, voice, audience, strategy, identityKit, description, _legacy`).
  - `serializePersonaProfile()` → accepts v1 or v2 patch (upgrades v1 first), normalises tokens through `tokens.ts`, keeps verbatim strings for `look.*` free-text.
  - `mergePersonaProfile()` → merges **per sub-object, one level deep**: a patch with `identityKit` cannot clear `look`; inside a sub-object the existing rule holds (absent/null preserves, explicit empty clears). `audience.ageRanges` re-derivation replaces the old `ageMin/ageMax` special case.
  - `meta.generatedAt` stamped on every serialize; `meta.generator` defaults to `'manual'` unless the patch sets it.
- **Test:** keep every existing spec passing (they are the regression net for the data-loss bug) by rewriting fixtures to v2; add: v1 patch onto v2 existing merges correctly; sub-object isolation; `meta` stamped.
- **Gate:** full store spec + `npm run check`.
- **Commit:** `feat(persona-store): read/merge/serialize on the v2 contract, lazy v1 upgrade`

### P0.4 Typed page builder replaces the hand-written literal
- **Files:** `src/routes/(portal)/personas/[agentId]/+page.svelte` (`currentPersonaProfile()` ~L2027, the `pp*` state block, the profile seeding on load ~L235)
- **Change:** replace `currentPersonaProfile()` with `buildProfilePatch()` that assembles v2 sub-objects from the `pp*` state; seed the `pp*` state from `readPersonaProfile(agent)` v2 paths. Chip keys render through `label()`; stored values are tokens.
- **Test:** none unit-testable in the page; covered by P0.5 route test.
- **Gate:** `npm run check`; manual: open a persona, edit one look field, save, reload, every other field intact.
- **Commit:** `refactor(persona-page): typed v2 profile patch, labels via registry`

### P0.5 Save and create paths
- **Files:** `src/routes/api/agents/config/+server.ts` (~L103–108), `src/routes/api/agents/+server.ts` (~L30–56)
- **Change:** no logic change beyond types; the merge already flows through the accessor. Remove the stale "mcp-bridge reads market" comments; replace with "market dual-write retained until P0.6".
- **Test (new, integration project):** `src/routes/api/agents/config/profile.test.ts` — POST a v1-shaped `personaProfile` string body and a v2 object body against a stubbed `db`; assert stored `personas_profile` is v2 and untouched sub-objects survive.
- **Gate:** `npm run test:integration`
- **Commit:** `chore(agents-api): v2 types on save/create; correct stale dual-write comments`

### P0.6 Retire `market` as the profile's home (own migration)
- **Precondition:** `grep -rn "\.market\b" src services` shows only the accessor's fallback and the two dual-write sites. (Verified today for `services/`.)
- **Files (new):** `supabase/market_restore_migration.sql` **[09-07] registered as a new last entry in `supabase/migrations.json` with a description; `client_bootstrap.sql` is regenerated by `build-bootstrap.mjs`, never edited; applied to prod with `node scripts/apply-migration.mjs market_restore_migration.sql` (transactional, recorded)**; edits to `agents/+server.ts`, `agents/config/+server.ts`, `persona-profile-store.ts` (`profileToMarketString` deleted), `types.ts`
- **Change:** migration sets `market = creator.market label` (e.g. `'Australia'`) for rows whose `market` starts with `{` **and** whose `personas_profile IS NOT NULL`; leaves any row where `personas_profile IS NULL` untouched (the never-brick fallback still needs it). Idempotent, NULL-guarded, written in the same style as `personas_profile_migration.sql` so `build-bootstrap.mjs` can concatenate it. App stops writing JSON to `market`.
- **Test:** store spec: fallback-to-`market` still works for a row with `personas_profile: null` (kept until the migration is confirmed on every DB, including the client EasyPanel DB noted in memory).
- **Gate:** run migration on prod after the app deploy that stops writing JSON; then verify `SELECT count(*) FROM agents WHERE market LIKE '{%' AND personas_profile IS NOT NULL` = 0.
- **Rollback:** the migration is additive to `market` values only; readers still fall back; re-enabling `profileToMarketString` is one revert.
- **Commit:** `feat(schema): agents.market returns to a market string; profile lives only in personas_profile`

### P0.7 Field provenance + zero-regression prompt snapshot — **[09-07] snapshot half DONE** (`src/lib/server/content/prompt-regression.spec.ts`, 9 snapshots over the three fixtures below, `buildRichAgentContext` exported; provenance still to do)
- **Files:** `schema.ts` (`meta.fieldSources`), `persona-profile-store.ts`, `persona-profile-store.spec.ts`; new `src/lib/server/persona/prompt-regression.spec.ts`
- **Change:** `meta.fieldSources: Record<leafPath, 'user'|'sampled'|'extracted'|'derived'>`. `serializePersonaProfile` marks every leaf changed by a UI patch `user`; `upgradeV1toV2` marks every v1 leaf `user`. `mergePersonaProfile` accepts an `origin` option (`'ui'|'sampler'|'backfill'`); sampler/backfill origins are rejected for leaves whose source is `user` or `extracted` (the leaf is skipped, not the patch).
- **Test:** provenance invariants (UX doc §3). **Zero-regression snapshot:** three real v1 fixtures → `buildRichAgentContext`, `buildHeroPortraitPrompt`, `buildPortraitEditPrompt`, identity-kit prompt builder; snapshots captured on `main` **before** this PR and committed; the test asserts byte equality with `PERSONA_BACKBONE=off`. This file must stay green through every later phase.
- **Commit:** `feat(persona-store): per-field provenance; byte-level prompt regression snapshots`

### Phase 0 — status 2026-09-08

| Task | Landed | Notes |
|---|---|---|
| P0.0 | `4ad3521`/`754a38f` | suite green |
| P0.1 | `fe824cd` | contract module: tokens, labels (byte-identical to legacy lists), schema; 20 invariants |
| P0.2 | `48bf0b7` | pure upgrade/downgrade, golden fixtures, 200-profile round trip |
| P0.3 | `58b7206` | **dual-shape bridge** instead of a hard cut: v1 read downgrades v2 blobs; v2 read/serialize/merge beside it; provenance rule in merge; age helpers to a leaf module (no import cycle). Built + smoked live. |
| P0.4 | deferred (G11) | page rewrite moved to Phase 5; the bridge made it unnecessary for the flip |
| P0.5 | `d48fa5e` | save routes write v2 via `persona-contract/save.ts`; page untouched; `stored` vs `patch` modes so records at rest carry no clear markers; token/text pairs are one field. Browser-proven (edit → save → reload; blob inspected). Built + smoked live. |
| P0.6 | `5f2aa33` | `market_restore_migration.sql` (ledger 39) applied to prod 2026-09-08: 0 rows still hold JSON in `market`; app no longer writes it |
| P0.7 | this commit | provenance landed with P0.3/P0.5; **zero-regression proof**: a v2-stored persona produces byte-identical prompts to its v1 original for every bucketed profile; the pre-bucket shape converges to what the page would have saved (documented in the spec) |

**Phase 0 definition of done:** suite green, typecheck green, a persona created before Phase 0 opens, edits, saves, regenerates portrait identically; `meta.schemaVersion: 2` visible on the next save of any persona.

### Phase 1 — status 2026-09-08

| Task | Landed | Notes |
|---|---|---|
| P1.1 | `7b1240b` | seeded PRNG with per-field `fork(label)` streams; local Trait Registry (generic + au/us/uk), `REGISTRY_VERSION` stamped into every persona. No external persona API, ever. |
| P1.2 | `7b1240b` | `samplePersonaSkeleton` — facts drawn in dependency order; look priors are AUTHORITATIVE for the group they name, not a re-weighting (a 'white' heritage could otherwise still draw a deep skin tone at base weight) |
| P1.3 | `7b1240b` | `briefToConstraints` reads what the brief already says; creator gender from the whole document, audience age and gender skew only from the audience fields |
| P1.4 | `3bbff90` | **the flip**: `generate-v2.ts` samples first and asks the model for PROSE ONLY, then discards non-prose in code. Wired into `generate_persona_profile` behind a single early `personaGenerator() === 'v2'` branch, so v1 is untouched and the switch is a true revert. Registry 1.1.0 adds archetype + contentFocus so a persona created with no provider key is complete. |
| P1.5 | `258b141` + this commit | `rerollField` re-samples one group, pinning the rest; blast radius is an explicit table, not a derived graph. Wired as the `reroll_field` engine action — no model, no spend, returns a patch and does not persist. `education` became a pinnable constraint because occupations are gated on it. |
| P1.6 | pending | `personaGenerator()` exists and is flippable from the Admin Console (`fd276bc`); the DEFAULT is still `v1`. Gated on P1.7/P1.8 per the note in P1.8. |
| P1.7 | `258b141` (Tier 1) | `backfillTier1` is a pure function of data the profile already holds — no sampling, no extraction, no model, so it can run on read without a flag, a key or a budget. Tier 2, the CLI script and the audit report are **not** written. |
| P1.8 | partial | `personaBackbone()` exists with `off/shadow/fill/on` and is flippable; **no consumer reads it yet**, so the staged rollout is declared but not wired. |

**Three defects the wiring exposed, all fixed in `3bbff90`:**

1. A brief's age band, gender skew, life stage and price positioning describe the AUDIENCE and were being fed in as CREATOR constraints — "we sell to 45-54s" became a 49-year-old creator nobody asked for. The test guarding this had encoded the bug as expected behaviour.
2. Model-written prose was marked `user` in `meta.fieldSources`, which under the store's own rule froze a model's guess against the customer's re-generate while telling the UI a person had chosen it.
3. An empty v1 `appearance`/`voiceProfile` in a patch became an empty SECTION, which the merge read as a whole-section clear and used to delete v2-only siblings. A shape may only clear what it can describe.

**Live proof, 2026-09-08**, against a running server with no AI provider configured: `generate_persona_profile` returns 200 with a coherent creator, deterministic across two calls; a brief stating "Australian women 45-54" yields `audience.ageRanges: ['45_54']` while the creator stays 32; `reroll_field` moves the job and its economics only, reproduces for a given nonce, and answers a non-rerollable path with a 200 no-op.

**Kill switch proven, not assumed (2026-09-08).** Two dev servers, same request, same persona. With `PERSONA_GENERATOR=v2` the engine returns 200 and a complete sampled creator with no provider configured. With the flag at its DEFAULT (`v1`) the identical request takes the old path and fails at the provider — `502 Generation failed via openrouter: HTTP 401` against a deliberately fake key — with no `_v2` payload and no spend. That is what "a true revert" has to look like: not a claim about a single early branch, but the old failure mode reproduced on demand.

**Phase 1 remaining:** P1.6 default flip only. P1.7 is complete — Tier 1 and Tier 2 both shipped, and the "backfill script" is `npm run backfill:persona-v2` driving `POST /api/admin/persona-backfill` (see the resolved blocker above). P1.8's consumer shipped with the backbone prompt block.

### Phases 2, 3 and 5 — status 2026-09-09

| Task | Landed | Notes |
|---|---|---|
| P1.7 Tier 1 | shipped + **RUN on production** | 18 personas scanned, 9 filled, 0 failures, 0 contract violations, 0 portrait-prompt drift, and the pass converges. It did NOT converge at first: the cached look clause is written with a leading space and the store trims every string leaf, so it re-derived forever. The idempotency test called the function twice IN MEMORY; production is read → backfill → SERIALIZE → store → read. |
| P1.7 Tier 2 | shipped, **not run at scale** | Reconcile-then-complete. Live-proven on one throwaway persona: the credit gate refused at a zero balance, and with a balance the call read 9 facts off the prose and discarded none. |
| P2.2 / P2.3 | shipped | The clause accepts a v2 look; the hero subject states facial hair and eyewear and the edit prompt says to keep them. Switches on PER-LOOK, never per schemaVersion — every v1 persona is upgraded on read, so keying on the version would flip the whole estate at once. |
| P3.2 viewer panel | shipped (module) | Deterministic panel of concrete viewers. Age bands are cycled so a two-band audience yields both; gender is a panel QUOTA, because independent per-viewer draws let a "mixed" panel come out all-female. |
| P0.4 / P5 stale state | shipped (module) | Only the cases something actually writes evidence for. Plus the portrait fingerprint below, which created the evidence for the one that mattered most. |

**The portrait-staleness evidence gap is CLOSED.** Nothing recorded what a portrait was generated from, so "your portrait predates your appearance edits" could not be detected — and no timestamp could stand in, because `meta.generatedAt` is bumped by every save. The avatar route now fingerprints the appearance BEFORE the detached run starts and stores it on success only. The fingerprint covers the INPUTS, not the rendered prompt: hashing the prompt would make a wording improvement declare every portrait in the estate stale at once.

### Phase 4 — status 2026-09-09

| Task | Landed | Notes |
|---|---|---|
| P4.1 | shipped | Backbone block grew 6 → 9 facts: Local (currency + hemisphere from `market`; no clock-derived season, which would break the "same string forever" rule), Credibility (the day job as the source of first-hand knowledge), Manner (Big Five as directives, never numbers). |
| P4.2 | shipped | Identity kit reads city / job / household, **gated behind `personaBackboneEmits()`** — the plan did not ask for that, and it matters: the kit is not otherwise flag-gated, so without it every customer's bios changed on deploy. Byte-identity below `on` proven against a verbatim copy of the old template kept as an oracle. Voice picker takes an age band, inert until the catalog carries tags. |
| P4.3 | shipped | `touchpoints.ts` — which consumers may read each field, checked three ways: completeness against leaves real personas carry, honesty against the builder sources, and the brand-safety class asserted not to EXIST as a field. |

**Two fields deliberately NOT emitted, each recorded rather than quietly skipped:** `creator.neverDiscusses` is typed, validated, labelled and rendered by the persona page, and **nothing in the repo writes it** — emitting it would be a dead line with a live-looking test. `audience.ageRanges` already reaches the script through the v1 downgrade, several lines above the backbone; two tests now pin that existing line instead of adding a second one.

**The contract caught four false claims within an hour of existing**, all mine: raw Big Five scores, `creator.displayName`, `creator.heritage` and `creator.economic.priceFrame` do not reach the script. Heritage is left to the portrait pair on purpose — repeating it into a script prompt invites the model to write an accent.

**The honesty check had to be fixed twice before it could catch anything.** First `includes()` matched "education" inside "educational". Then, fixed, it read `creator.languages` in a header comment written precisely to say languages are NOT sent — a comment denying something being read as evidence for it. It strips comments now. A REVERSE check (does a builder read anything ungranted?) was attempted and removed: it cannot work at file granularity, because `generate.ts` hosts the script builder, both portrait builders and the fit judge. The probe that first called it clean was itself broken — `` inside a template literal is a backspace escape, not a word boundary.

**Still open — all of these are DECISIONS, not implementation:** flipping `PERSONA_BACKBONE` up the staged ladder (`off` → `shadow` → `fill` → `on`); P1.6's `PERSONA_GENERATOR` default flip, gated on the backbone reaching fill/on; running Tier 2 across the estate, which costs one paid call per persona with prose; and `PERSONA_FIT_JUDGE=auto`, which is the only fit-judge setting that spends unasked.





**[09-09] The backfill CLI blocker is RESOLVED — by not writing that CLI.** The blocker was real: every script here runs under `node --experimental-strip-types`, which resolves no `$lib` alias, and no existing script imports app library code, so there was no pattern to copy. Both recorded options were bad — relative imports everywhere fights the SvelteKit convention, and adding `vite-node` puts a new dependency on an ops path. The third option is better than either: put the OPERATION where the code already lives. `POST /api/admin/persona-backfill` runs it behind `requirePlatformAdmin`, and `scripts/backfill-persona-v2.mjs` is a thin HTTP client like every other script in this repo (`npm run backfill:persona-v2 -- --mode shadow`). The app resolves its own aliases, already holds the service client, and — when Tier 2 lands — already holds the budget gate, the credit gate and the generation-events ledger that P1.7 requires every paid backfill call to pass through. A CLI would have had to reimplement all of that or reach around it.

**Tier 1 shadow pass over production, 2026-09-09** — 18 personas scanned, 9 would change, 0 failures, **0 contract violations**, which is the stated gate to `fill`. Two findings that only real data could produce: (1) **all 18 personas are still stored as v1** — nothing has been saved through the P0.5 write path since it shipped, so the dual-shape bridge is carrying every read; (2) most display names carry a tagline the user typed into the same field ("Lexi Connor | Virtual Creator"), which made the derived sentence read "Lexi Connor | Virtual Creator is 27 years old." Fixed in `describe.ts`: a pipe is treated as a separator, a dash or comma is not, because those appear in real names.

---

## Phase 1 — Skeleton sampler and the generator flip

**Branch:** `persona-v2/phase-1` · **Flag:** `PERSONA_GENERATOR=v1|v2` (default `v1` until P1.6) · **Estimate:** 4–6 days

### P1.1 Seeded PRNG + local Trait Registry
- **Decision (2026-09-05):** no external persona API, no adapter, no `SkeletonSource` interface. The registry is the only source of sampled values and lives in the repo.
- **Files (new):**
  - `src/lib/persona-contract/rng.ts` — mulberry32 over a string hash; `rng(seed).next()`, `.pick(arr)`, `.weighted(entries)`, `.gauss(mean, sd)`.
  - `src/lib/persona-contract/registry/index.ts` — `REGISTRY_VERSION` (semver constant), `registry.for(market)`, `registry.pick(table, rng, context)` (applies `Gate`s then weights; throws never, falls back to generic table then to the first ungated entry).
  - `registry/types.ts` — `RegistryEntry { token, label, weight, gates?: Gate }`, `Gate { minAge?, maxAge?, gender?, niches?, incomeBands?, educations?, marketOnly? }`, `RegistryTable`, `MarketRegistry`.
  - `registry/generic/*.ts`, `registry/au/*.ts`, `registry/us/*.ts`, `registry/uk/*.ts` — one file per table: `regions.ts` (region → cities with `geographicContext` + IANA timezone), `heritage.ts`, `names.ts` (first/last per heritage × gender, ≥ 30 each), `education.ts`, `occupations.ts` (domain × titles with `niches` affinity, `minAge`, seniority gates), `income.ts` (bands gated by education × seniority), `housing.ts` (gated by age × income), `pets.ts` (niche-weighted), `diet.ts`, `look.ts` (skin/hair/eye priors per heritage, gray coverage by age, facial hair by gender, eyewear rate).
- **Header comment (mandatory, every table file):** "Curated plausibility weights, NOT census statistics."
- **Versioning rule:** any change to an entry, weight, or gate bumps `REGISTRY_VERSION`; the sampler stamps `meta.registryVersion` on every skeleton. The pre-commit hook gains a check: if any file under `registry/` changed and `REGISTRY_VERSION` did not, the commit fails.
- **Test:** `rng.spec.ts` — same seed same sequence; different seeds diverge; `weighted` respects weights over 10k draws within ±3 %. `registry.spec.ts` — every market has every table or falls back to generic; every table non-empty; every occupation names ≥ 1 niche from `NICHE_OPTIONS`; every heritage has names for both genders; every token in every table has a label in `labels.ts`; gates reference only known tokens; `registry.for('xx')` returns generic; `pick` with a context that excludes every entry still returns an entry.
- **Commit:** `feat(persona-contract): seeded rng and versioned local trait registry (au/us/uk/generic)`

### P1.1b Registry DB overlay *(optional, later — not on the critical path)*
- **Pattern:** identical to `model_registry` — DB rows overlay the static registry, static registry is the never-brick fallback when the table is missing or empty.
- **Files (later):** `supabase/persona_registry_migration.sql` (`persona_registry(user_id NULL for global, market, table_name, token, label, weight, gates JSONB, enabled)`), `src/lib/server/persona/registry-overlay.ts`, merge into `registry.for(market, overlay?)`.
- **Use:** a client's real city list, house-style names, disabled entries. Do not build until a client asks.

### P1.2 Creator sampler
- **Files (new):** `src/lib/persona-contract/sampler.ts`, `sampler.spec.ts`
- **Change:** `samplePersonaSkeleton(seed, constraints)` in the exact order of strategy §4 (market → location → gender → age → heritage/name → education → work → economic → household → lifestyle → bigFive → look → description). Every draw goes through `registry.pick(...)`; the sampler holds no literal values of its own. Output carries `meta.registryVersion`. `constraints` supports `{ market, name, gender, ageRange, heritage, nicheKey, archetype, incomeBand, lifeStage }`; a supplied `name` is conditioned on via `inferGenderFromName` (import from `$lib/server/content/generate` is server-only — move `inferGenderFromName` + its table to `src/lib/name-gender.ts`, client-safe, re-export from the old location) and a heritage lookup. `description.short` + `frame` templated from tokens via `label()`.
- **Test:** determinism (1,000 seeds twice, deep-equal); invariants over 1,000 seeds — child age bands ≤ parent age − 16, seniority gates, homeowner only if age ≥ 23, no `facialHair ≠ 'none'` when gender female, `grayCoverage ≠ 'none'` only if age ≥ 35; name/gender agreement; distribution guard — no age bucket > 40 %, no heritage > 45 %, ≥ 6 distinct occupation domains; constraints honoured 100 % (`gender: 'male'` → all male); dependency not overridable (`ageRange: [20,22]` never yields `seniority: 'senior'`).
- **Commit:** `feat(persona-contract): deterministic dependency-ordered creator sampler`

### P1.3 Brief → constraints
- **Files (new):** `src/lib/server/persona/brief-constraints.ts`, `brief-constraints.spec.ts`
- **Change:** `briefToConstraints(brief, direction?)`. Reads structured fields when present; otherwise one small extraction prompt over `demographics`/`painPoints` returning `{ market, ageRange, genderMix, incomeBand, lifeStage }`, cached on the brief row under `data._constraints` with the brief `version` it was derived from. No AI key → empty constraints (sampler still runs).
- **Test:** structured brief → no LLM call; cached constraints reused when version unchanged; junk LLM output → empty constraints, never throws.
- **Commit:** `feat(persona): map brand brief to sampler constraints with per-version cache`

### P1.4 Skeleton-conditioned prose prompts
- **Files:** `src/routes/api/engine/+server.ts` (`generate_persona_profile` ~L1955, `generate_full_persona` ~L2280); new `src/lib/server/persona/prose-prompts.ts` holding the prompt builders (exported, so they can be snapshot-tested like `buildHeroPortraitPrompt`)
- **Change:** under `PERSONA_GENERATOR=v2`: seed = `agentId` (profile) or `${briefId}:${index}:${nonce}` (full); skeleton sampled; prompt receives the skeleton JSON + brief + taken-fingerprints + direction and is told to return **only** `soul, strategy.archetype, strategy.contentFocus, strategy.contentAngle, audience.targetAvatar, audience.psychProfile, look.wardrobe, look.outfitColors, look.styling, look.distinctiveFeatures`. Response passes through `applyProseOnly(skeleton, llmJson)` which copies only those paths. `meta.generator: 'skeleton-v1'`, `meta.generatorModel`, `meta.seed` stamped. `taken` fingerprint now includes `creator.heritage`, `creator.age`, `work.domain` so uniqueness pressure applies to the skeleton via constraints (`avoid: [...]`) rather than prompt text.
- **Test:** `prose-prompts.spec.ts` — snapshot of both prompts for a fixed skeleton; `applyProseOnly` discards `creator.age`, `creator.heritage`, `look.facialHair` when the LLM returns them (the P1 invariant); missing prose keys leave skeleton fields untouched.
- **Commit:** `feat(engine): skeleton-first persona generation behind PERSONA_GENERATOR=v2`

### P1.5 No-AI-key creation and per-field re-roll
- **Files:** engine `generate_persona_profile` / `generate_full_persona` (early `!hasAi` return becomes "skeleton only" under v2); new engine action `reroll_field` (`{ agentId, fieldPath, nonce }` → re-sample `fieldPath` with seed `${meta.seed}:${fieldPath}:${nonce}` and re-run only dependents below it; returns a patch)
- **Test:** engine handler unit test with stubbed `ai = null` → 200 with `meta.generator: 'skeleton-v1'`, prose fields empty; `reroll_field('creator.work.title')` changes title, may change income band, never changes age/heritage/name.
- **Commit:** `feat(engine): personas without an AI key; deterministic per-field re-roll`

### P1.6 Flip the default
- **Files:** **[09-07]** `src/lib/server/flags.ts` (add `personaGenerator(): 'v1' | 'v2'` with the module's env → `platform_settings.persona_generator` → default precedence), `settings.ts` (`PlatformSettings` + `SETTING_KEYS`), Admin Console control, root `.env.example` line (or `env-docs.spec.ts` fails), `README.md` (ops note)
- **Change:** default `v2`; `v1` is the kill switch — flipped in the Admin Console normally, `PERSONA_GENERATOR=v1` in the host env as the emergency override. Log one line per generation naming the generator (fits the generation-events ledger).
- **Gate:** generate 3 personas on staging with the demo brand; confirm distinct ages/heritages/jobs; confirm portrait generation reads `look.*`.
- **Rollback:** set `PERSONA_GENERATOR=v1` in EasyPanel env; no redeploy.
- **Commit:** `feat(persona): PERSONA_GENERATOR defaults to v2 (kill switch: v1)`

### P1.7 Silent backfill — Tier 1 (derived) and Tier 2 (reconcile, then sample)
- **Files (new):** `src/lib/server/persona/backfill.ts`, `backfill.spec.ts`, `src/lib/server/persona/reconcile-prompt.ts`; `scripts/backfill-persona-v2.ts`; `package.json` script `backfill:persona-v2`
- **Change:** Tier 1 = pure function of stored data, marks `derived`, runs inside `readPersonaProfile` when `PERSONA_BACKBONE ≠ off` (no I/O, no persistence until next save). Tier 2 = extraction over soul/angle/avatar → `extracted` leaves → sampler with constraints = all `user|extracted|derived` leaves → `sampled` leaves. Script modes `shadow|fill`, idempotent on `meta.backfill.tier` + `meta.registryVersion`, per-user AI key respected, **[09-07] each Tier 2 call passes `assertWithinBudget` AND `assertCreditsAvailable`, writes a `generation_events` row, and is debited via `debitForEvents` — it is a paid generation like any other,** always writes `docs/audit/persona-backfill-<mode>-<date>.md` with tier reached, fields extracted, fields sampled, contradiction count, and the exact prompt diff `on` would introduce.
- **Test:** Tier-1 purity over 200 synthetic v1 blobs (zero visible field changes, only `derived` added); Dubai-soul fixture (city/domain/age extracted, sampler never contradicts them, household plausible for market, `ae` falls back to `generic` never `au`); idempotency (second run is a no-op); missing AI key → Tier 1 only, reported not thrown.
- **Commit:** `feat(persona): reconciliation-first silent backfill with shadow/fill modes and audit report`

### P1.8 `PERSONA_BACKBONE` staged flag
- **Files:** **[09-07]** `src/lib/server/flags.ts` (`personaBackbone(): 'off'|'shadow'|'fill'|'on'`, default `off`, env → `platform_settings.persona_backbone` → default), `settings.ts`, Admin Console control, root `.env.example` line, README ops note; consumers (`buildRichAgentContext`, portrait builders, identity kit) emit backbone leaves only at `on`, and only leaves that are set.
- **Gate to `shadow`:** P0 + P1.1–P1.2 merged, regression snapshot green. **Gate to `fill`:** shadow report shows zero contradictions. **Gate to `on`:** three demo creators reviewed in production, one script each read side-by-side with a pre-v2 script.
- **Rollback:** lower the flag. Persisted backbone data is inert below `on` and never deleted.
- **Note:** `PERSONA_GENERATOR=v2` (P1.6) is enabled only once `PERSONA_BACKBONE` is `fill` or `on`, so new creators get the skeleton-first path and the visible section together.
- **Commit:** `feat(persona): PERSONA_BACKBONE off|shadow|fill|on with set-leaves-only emission`

**Phase 1 definition of done:** three fresh personas differ in age bucket, heritage, and occupation domain; a persona can be created with all provider keys removed; re-roll of a job never changes the face; `PERSONA_GENERATOR=v1` restores today's behaviour without redeploy.

---

## Phase 2 — Look v2 and portrait consistency

**Branch:** `persona-v2/phase-2` · **Estimate:** 2 days

### P2.1 New look tokens
- **Files:** `tokens.ts`, `labels.ts`, `schema.ts`, `sampler.ts` (look step)
- **Change:** `facialHair`, `eyewear`, `faceShape`, `browShape`, `hair.texture`, `hair.grayCoverage`, `height.cm`, `clothingSizes`. Sampler conditions `facialHair` on gender, `grayCoverage` on age, `eyewear` ~15 %.
- **Test:** tokens spec auto-covers; sampler invariants extended (already listed in P1.2).

### P2.2 Prompt clause
- **Files:** `src/lib/persona-profile.ts` (`appearanceToPromptClause` → accepts v2 `look`, emits facial hair, eyewear, face shape, gray coverage, height in a fixed order; keeps legacy combined-hairstyle de-duplication), `persona-profile.spec.ts`
- **Change:** `look.promptCues` cached by `serializePersonaProfile`.
- **[09-08] TRAP, recorded before it can fire:** nothing reads `look.promptCues` today. It is WRITTEN by the Tier 1 backfill and CLEARED by a look re-roll, which is harmless only while no consumer exists. The moment this task makes it the portrait source, a re-rolled look emits no clause at all unless Tier 1 has a caller (P1.7/P1.8). Wire the reader and the recompute in the same commit, or read the clause live and treat the cached field as an optimisation rather than the source.
- **Test:** snapshot for a fully populated look; empty look → empty clause; legacy `'long loose waves'` + `length: 'long'` → no duplicate word.

### P2.3 Portrait prompts assert drift-prone attributes
- **Files:** `generate.ts` `buildHeroPortraitPrompt` (~L2233), `buildPortraitEditPrompt` (~L2270)
- **Change:** subject line = `[heritage, gender, age] relatable UGC content creator`; edit prompt adds an explicit "keep: {facialHair}, {eyewear}" sentence when set.
- **Test:** `generate.ts` already exports both builders — add `portrait-prompts.spec.ts` snapshots against a fixed v2 profile.

### P2.4 Vision read-back fills the new tokens
- **Files:** engine `read_appearance_from_image` (~L2494)
- **Change:** prompt lists the token options for `facialHair`, `eyewear`, `faceShape`, `browShape`, `hair.texture`, `grayCoverage`; response coerced through `tokens.ts` (`coerceToOption` on labels → token).
- **Gate:** upload one male-with-beard reference and one glasses reference on staging; tokens populate.

**Commits:** one per task, prefix `feat(look):`.

---

## Phase 3 — Audience v2 and the viewer panel

**Branch:** `persona-v2/phase-3` · **Flag:** `PERSONA_FIT_JUDGE=off|on_demand|auto` (default `on_demand`) · **Estimate:** 3–4 days

### P3.1 Audience tokens + viewer sampler
- **Files:** `tokens.ts` (`PRICE_SENSITIVITY`, `PURCHASE_CHANNEL`, `BRAND_LOYALTY`, `PROMO_RESPONSIVENESS`, `MESSAGE_PROCESSING_STYLE`, `COMMUNICATION_PREFERENCE`, `DIGITAL_CAPABILITY`), `sampler.ts` (`sampleViewerSkeleton(seed, audienceConstraints)`), `sampler.spec.ts`
- **Change:** viewer = subset of creator skeleton (identity, location, work, household, economic, decisioning) — no look, no voice.
- **Test:** determinism; constraints honoured; decisioning coherent with income band (budget band never `price_insensitive`).

### P3.2 Panel on the profile
- **Files:** engine `generate_persona_profile` (v2 path), `schema.ts` (`audience.panel: ViewerSkeleton[]`), persona page (read-only "Who she's talking to" cards)
- **Change:** 4 viewers sampled with seed `${meta.seed}:panel:${i}` from brief constraints; stored; regenerated only by an explicit "Re-roll panel" action.

### P3.3 Fit judge
- **Files (new):** `src/lib/server/persona/fit-judge.ts`, `fit-judge.spec.ts`; edits: `generate.ts` (after caption/script is final), `review-queue` card component, `posts` migration adding `fit_score INT NULL, fit_notes JSONB NULL` (additive, idempotent)
- **Change:** one JSON-mode call: draft + 4 viewers → `[{ viewerIndex, fit: 0–100, objection }]`. **[09-07]** Gated through `assertWithinBudget` and `assertCreditsAvailable`, metered as a `generation_events` row and debited; flag `PERSONA_FIT_JUDGE` lives in `flags.ts` with the env → `platform_settings` → default precedence; the `posts.fit_score` / `fit_notes` migration is registered in `migrations.json` and applied with `apply-migration.mjs`. Skipped silently when flag `off` or no AI; `on_demand` = button on the card; `auto` = runs in the generation pipeline.
- **Test:** flag `off` → no call; budget exhausted → no call, post still created; malformed judge output → post created with `fit_score: null`.
- **Rollback:** flag `off`; columns nullable so older code ignores them.

**Commits:** prefix `feat(audience):`.

---

## Phase 4 — Consumer wiring and the touchpoint contract

**Branch:** `persona-v2/phase-4` · **Estimate:** 2 days

### P4.1 Script context reads the backbone
- **Files:** `generate.ts` `buildRichAgentContext` (~L704)
- **Change:** lines for location + local flavour (currency, season from timezone hemisphere, city), day job as credibility, household facts allowed in content, `neverDiscusses` as a hard rule, Big Five → concrete instructions (thresholds ≥ 65 high / ≤ 35 low per trait, five short directives). `audience.ageRanges` via labels.
- **Test:** `rich-context.spec.ts` snapshot for a fixed v2 profile; a profile with `extraversion: 20` yields the low-extraversion directive and not the high one.

### P4.2 Identity kit and voice
- **Files:** engine `generate_identity_kit` (~L2115), `voices.ts` `pickVoiceForProfile`
- **Change:** kit prompt gets `creator.location.city`, `work.title`, `household` summary; voice picker accepts an optional age band and prefers catalog voices tagged for it (no-op when the catalog has no age tags).
- **Test:** voices spec — age hint with untagged catalog returns the same voice as today (regression guard).

### P4.3 Touchpoint contract
- **Files (new):** `src/lib/persona-contract/touchpoints.ts`, `touchpoints.spec.ts`
- **Change:** `PERSONA_TOUCHPOINTS: Record<leafPath, ('script'|'portrait'|'portrait_edit'|'voice'|'identity_kit'|'fit_judge'|'uniqueness'|'display')[] | 'never_emit'>`. `never_emit` lists the brand-safety class (politics, religion, health claims…) which must not exist as leaf fields at all.
- **Test:** walk the v2 schema (via a runtime leaf list exported from `schema.ts`) — every leaf present in the map exactly once; no leaf marked `never_emit` exists in the schema; every consumer named in the map has a builder that references the field (grep-style check over the builder source strings imported into the test).
- **Commit:** `feat(persona-contract): touchpoint map with completeness test`

---

## Phase 5 — UI

**Branch:** `persona-v2/phase-5` · **Estimate:** 3–4 days

### P5.0 "Life details" section — the only new surface
- **Files:** persona page (insert a `<details class="profile-section">` between Persona Profile and Platform Identity Kit); reuse `TraitPicker` for chip rows; new `src/lib/components/persona/BigFiveSliders.svelte`, `FactStrip.svelte`
- **Change:** collapsed by default, never auto-opens; `<summary>` shows the fact strip from `description.frame` or "Not filled yet — Generate for brand fills this"; four groups (Basics · Work · Home · Character); `auto` / `from soul` provenance tags; per-group **↻ Re-roll** (calls `reroll_field` on the group's top field) and **Reset to auto**; section-foot **Re-roll everything** behind a confirm dialog stating the portrait will no longer match. Look v2 tokens go into the existing Appearance & Wardrobe picker (facial hair + eyewear core, rest under Advanced). Rendered only when `PERSONA_BACKBONE` is `fill` or `on`.
- **Test:** covered by P5.4 flows plus: with the flag `off`, the DOM of the persona page is unchanged (Playwright snapshot of the section list).
- **Commit:** `feat(persona-page): collapsed Life details section with provenance tags and deterministic re-roll`

### P5.1 Regrouped Persona Profile section
- **Files:** persona page (Persona Profile section ~L3696, Character & Visuals ~L4391)
- **Change:** six collapsible cards — Creator · Look · Voice · Audience · Strategy · Identity Kit — in the accordion style already used by Settings provider keys. Chips render `label()`; storage is tokens.

### P5.2 Fact strip
- **Files:** persona page header, personas rail component
- **Change:** render `description.frame` (age · city · job · household · archetype). Regenerated by the store on every save without an LLM.

### P5.3 Re-roll and regenerate controls
- **Change:** per-field "↻" next to sampled fields → `reroll_field`; "Regenerate prose" (LLM, skeleton fixed) and "Re-roll person" (new seed, confirm dialog because the portrait will no longer match) are separate buttons.

### P5.4 Playwright smoke
- **Files (new):** `tests/e2e/persona-v2.spec.ts`
- **Flow:** open an EXISTING persona → no new required fields, Life details collapsed, fact strip or "Not filled yet" → edit an unrelated field, save, reload → backbone untouched → open Life details, re-roll Work, save → name/age/heritage unchanged. Then: create persona with no keys → fact strip visible → set one look field → save → reload → all other fields intact → regenerate prose (stub) → skeleton fields unchanged.
- **Gate:** `npm run test:e2e`

---

## Standing gates for every PR

```
npm run test:unit      # 0 failed (env-docs + migrations-coverage specs included)
npm run check          # 0 errors
npm run lint
node scripts/apply-migration.mjs --status --strict   # [09-07] for any PR that adds a migration: no pending/drifted before merge; deploy.ps1 aborts otherwise
```

Plus, for any PR touching prompts: paste the before/after snapshot diff into the PR description so the reviewer sees exactly what the model will now be told.

Plus, for any PR that changes what a user sees: after the deploy, open the production persona page for the three demo creators (Lexy, Chloe, Jenny), confirm the observed state, and paste the observed strings into the PR. Local tests passing is not "shipped".

## Ordering and dependencies

```
P0.0 → P0.1 → P0.2 → P0.3 → P0.4 → P0.5 → P0.6
                                  ↘ P1.1 → P1.2 → P1.4 → P1.5 → P1.6
                                          P1.3 ↗
P1 done → P2 (any order with P3) · P4 needs P1 (+P2 for look lines, +P3 for judge touchpoints) · P5 last
```

Minimum viable flip = P0.0–P0.5 + P1.1–P1.6 + P4.1 + P4.3.

## Rollback matrix

| Phase | Mechanism | Data impact |
|---|---|---|
| 0 | revert PR; stored v2 blobs are still read by v1 code? **No** — so P0 is the one phase whose rollback needs `downgradeV2toV1()` (write it in P0.2 alongside the upgrade; 10 lines; tested). | none lost (`_legacy` + downgrade) |
| 1 | `PERSONA_GENERATOR=v1`; `PERSONA_BACKBONE` lowered | none — backbone data inert below `on`, never deleted |
| 2 | revert PR; new look tokens ignored by old clause builder | none |
| 3 | `PERSONA_FIT_JUDGE=off`; nullable columns | none |
| 4 | revert PR | none |
| 5 | revert PR | none |
